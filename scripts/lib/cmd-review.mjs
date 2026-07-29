// `/oai:review`: a command line in, a rendered report out.
//
// What the request *is* — the reply budget, the whole-files-or-diff ladder, and
// the retry when a server refuses the schema — lives in `review-request.mjs`.
import { assertNoFlagsInPrompt, parseCommandLine } from './args.mjs';
import { loadConfig, resolveProfile } from './config.mjs';
import { parseNumericOptions, resolveIdle, resolveTarget, resolveTimeout } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { collectTarget } from './git-diff.mjs';
import { withProgress } from './progress.mjs';
import { report } from './review-report.mjs';
import { requestFindings, reserveFor } from './review-request.mjs';
import { parseFindings } from './structured.mjs';

// Exported so `tests/plugin.test.js` can prove every flag this command accepts
// is documented in `commands/review.md`. The markdown is the only description a
// user ever sees, and nothing but a test notices when a flag outlives its docs.
export const REVIEW_SPEC = {
  valueFlags: [
    'provider', 'base-url', 'model', 'base', 'commit', 'timeout', 'max-tokens', 'temperature', 'cache-buster',
  ],
  booleanFlags: ['staged', 'diff-only', 'json'],
  repeatableFlags: ['file'],
};

export async function runReview(argv) {
  const { options, prompt: instructions, terminated } = parseCommandLine(argv, REVIEW_SPEC);
  if (instructions && !terminated) assertNoFlagsInPrompt(instructions, REVIEW_SPEC);
  // --file has no diff, so "the diff alone" would be nothing at all. Refusing
  // beats sending an empty review that reads as a clean pass.
  if (options['diff-only'] && options.file?.length) {
    throw new UserError('--diff-only cannot be combined with --file: there is no diff, only whole files.', {
      hint: 'Drop --diff-only to review the files, or use --commit/--base/--staged to review a diff.',
    });
  }
  const { maxTokens, temperature, timeoutSeconds } = parseNumericOptions(options);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  if (profile.credentialWithheld) {
    process.stderr.write(
      `Note: "${profile.name}" has a credential, but --base-url points at a different host, so it was not sent.\n`,
    );
  }

  const target = await collectTarget(options);
  const { model, contextLength } = await resolveTarget(profile, options);
  const reserve = reserveFor(contextLength, maxTokens);

  const startedAt = Date.now();
  process.stderr.write(`Reviewing ${target.label} with ${model} on ${profile.name}...\n`);

  // A review is the long silent run this exists for: whole-file passes measured
  // 38–245s before, and a cold prefill alone is minutes.
  const { result, structured, schema, budget, estimatedTokens, hunksOnly } = await withProgress((onProgress) =>
    requestFindings(profile, {
      model,
      contextLength,
      target,
      instructions,
      reserve,
      temperature,
      cacheBuster: options['cache-buster'],
      timeoutMs: resolveTimeout(profile, timeoutSeconds),
      idleMs: resolveIdle(profile),
      onProgress,
    }),
  );

  report(parseFindings(result, { structured, schema }), {
    result,
    structured,
    profile,
    model,
    target,
    hunksOnly,
    budget,
    estimatedTokens,
    durationMs: Date.now() - startedAt,
    json: Boolean(options.json),
  });
}
