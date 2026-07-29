// `/oai:review`: a command line in, a rendered report out.
//
// What the request *is* — the reply budget, the whole-files-or-diff ladder, and
// the retry when a server refuses the schema — lives in `review-request.mjs`.
import { assertNoFlagsInPrompt, parseCommandLine } from './args.mjs';
import { loadConfig, resolveProfile } from './config.mjs';
import { parseNumericOptions, resolveIdle, resolveMax, resolveTarget, resolveTimeout } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { collectTarget } from './git-diff.mjs';
import { substitutionNotice } from './model-identity.mjs';
import { withProgress } from './progress.mjs';
import { errorReport, report } from './review-report.mjs';
import { requestFindings, reserveFor } from './review-request.mjs';
import { parseFindings } from './structured.mjs';

// Exported so `tests/plugin.test.js` can prove every flag this command accepts
// is documented in `commands/review.md`. The markdown is the only description a
// user ever sees, and nothing but a test notices when a flag outlives its docs.
export const REVIEW_SPEC = {
  valueFlags: [
    'provider', 'base-url', 'model', 'base', 'commit', 'timeout', 'max-seconds', 'max-tokens', 'temperature',
    'cache-buster',
  ],
  booleanFlags: ['staged', 'diff-only', 'json'],
  repeatableFlags: ['file'],
};

/**
 * The command, minus the one thing that cannot be reported as JSON.
 *
 * Splitting here is what makes `--json` honest on the failure path. The envelope
 * has to cover *everything after parsing* — the two guards below, the numeric
 * flag validation, and an internal crash — because a contract that says "stdout
 * is machine-readable" while four failure modes stay prose-only is a claim
 * broader than its implementation, which is the class this repo keeps finding.
 *
 * The one honest exception is the command line itself: parsing is what
 * establishes that `--json` was passed at all, so a malformed one cannot know to
 * emit JSON. Documented in `commands/review.md` rather than left as an edge
 * someone discovers.
 */
export async function runReview(argv) {
  const { options, prompt: instructions, terminated } = parseCommandLine(argv, REVIEW_SPEC);
  try {
    await reviewFlow(options, instructions, terminated);
  } catch (error) {
    // Written before the rethrow, so the companion still writes prose to stderr
    // and exits 1 (or 2) exactly as it did. Additive: nothing that worked
    // before reads differently.
    if (options.json) process.stdout.write(`${JSON.stringify(errorReport(error))}\n`);
    throw error;
  }
}

/**
 * Refusals that can be made from the command line alone, before any I/O.
 *
 * Together rather than scattered because they share a deadline: both must fire
 * before git is walked or a provider is contacted, so a mistyped command costs
 * nothing. Lifted out of `reviewFlow` at the function size budget, and the seam
 * is real — these decide whether the request is *askable*, while everything
 * below builds it.
 */
function assertAskable(options, instructions, terminated) {
  if (instructions && !terminated) assertNoFlagsInPrompt(instructions, REVIEW_SPEC);
  // --file has no diff, so "the diff alone" would be nothing at all. Refusing
  // beats sending an empty review that reads as a clean pass.
  if (options['diff-only'] && options.file?.length) {
    throw new UserError('--diff-only cannot be combined with --file: there is no diff, only whole files.', {
      hint: 'Drop --diff-only to review the files, or use --commit/--base/--staged to review a diff.',
    });
  }
}

async function reviewFlow(options, instructions, terminated) {
  assertAskable(options, instructions, terminated);
  const { maxTokens, temperature, timeoutSeconds, maxSeconds } = parseNumericOptions(options);

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

  const maxMs = resolveMax(profile, maxSeconds);
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
      // Minted here, once, and shared by every attempt the answer costs — the
      // capability ladder in chat.mjs and the response_format ladder in
      // review-request.mjs both retry, and a per-attempt cap would let three
      // tries run for three times the number the caller set.
      maxMs,
      onProgress,
    }),
  );

  // On stderr and before `report`, because `--json` routes around every human
  // rendering: a harness gets the pair in the envelope, an operator gets it here.
  const notice = substitutionNotice(result);
  if (notice) process.stderr.write(notice);

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
