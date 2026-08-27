// `/oai:review`: a command line in, a rendered report out.
//
// What the request *is* — the reply budget, the whole-files-or-diff ladder, and
// the retry when a server refuses the schema — lives in `review-request.mjs`.
import { assertNoFlagsInPrompt, parseCommandLine } from './args.mjs';
import { createLedger } from './attempt-ledger.mjs';
import { loadConfig, resolveProfile } from './config.mjs';
import { parseNumericOptions, resolveIdle, resolveMax, resolveRetryDelay, resolveTarget, resolveTimeout } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { collectTarget } from './git-diff.mjs';
import { substitutionNotice } from './model-identity.mjs';
import { withProgress } from './progress.mjs';
import { errorReport, report } from './review-report.mjs';
import { requestFindings, reserveFor } from './review-request.mjs';
import { attachRunContext, buildRunContext } from './run-context.mjs';
import { SAMPLING_FLAGS, attachSampling, parseSampling } from './sampling.mjs';
import { parseFindings } from './structured.mjs';

// Exported so `tests/plugin.test.js` can prove every flag this command accepts
// is documented in `commands/review.md`. The markdown is the only description a
// user ever sees, and nothing but a test notices when a flag outlives its docs.
export const REVIEW_SPEC = {
  valueFlags: [
    'provider', 'base-url', 'model', 'base', 'commit', 'timeout', 'max-seconds', 'max-tokens', 'temperature',
    'cache-buster', 'max-attempts', ...SAMPLING_FLAGS,
  ],
  booleanFlags: ['staged', 'diff-only', 'json', 'structured-output'],
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
  // Declared out here so the catch can attach it: the failures worth recording
  // the settings on — a reasoning-only runaway — are thrown by the report stage
  // *after* the model call returned, so this is the one scope that sees them all.
  let sampling;
  try {
    sampling = parseSampling(options);
    await reviewFlow(options, instructions, terminated, sampling);
  } catch (error) {
    // Record the run's sampling on the error so the --json failure envelope can
    // report it — including for a runaway refused after the model call returned.
    attachSampling(error, sampling);
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

/**
 * Everything the request needs, assembled in one place.
 *
 * Lifted out of `reviewFlow` at the function size budget. The seam: this decides
 * *what to ask for*, while the caller runs it and renders what comes back.
 */
function reviewPlan({ profile, options, instructions, target, model, contextLength, numeric, sampling, ledger }) {
  const { maxTokens, temperature, timeoutSeconds, maxSeconds, maxAttempts } = numeric;
  return {
    model,
    contextLength,
    target,
    instructions,
    reserve: reserveFor(contextLength, maxTokens),
    temperature,
    // The validated vendor sampling params, threaded onto `send` in
    // `requestFindings` and echoed in the report.
    sampling,
    cacheBuster: options['cache-buster'],
    timeoutMs: resolveTimeout(profile, timeoutSeconds),
    idleMs: resolveIdle(profile),
    retryDelayMs: resolveRetryDelay(profile),
    // Minted once, and shared by every attempt the answer costs — the
    // capability ladder in chat.mjs and the response_format ladder in
    // review-request.mjs both retry, and a per-attempt cap would let three
    // tries run for three times the number the caller set.
    maxMs: resolveMax(profile, maxSeconds),
    maxAttempts,
    // OFF by default since 2026-08-04, and the default is the whole point.
    // Sending `response_format` makes LM Studio's LLGuidance build a grammar
    // whose lexer exhausts a 250,000-state budget at ~14k generated tokens,
    // which raises a fatal exception in the MLX generation thread and SEGFAULTS
    // the model process — a ~38% request failure rate this repo spent four days
    // attributing to an unreliable server.
    //
    // A flag rather than a deletion, because the fault is in one backend's
    // grammar engine and this plugin is generic by construction: a
    // server that enforces a schema without that engine is still better served
    // by one. The default protects the machine in front of us; the flag keeps
    // the capability honest for the ones that are not.
    structuredOutput: Boolean(options['structured-output']),
    // One ledger for the whole review, shared by every request the answer costs.
    ledger,
  };
}

async function reviewFlow(options, instructions, terminated, sampling) {
  assertAskable(options, instructions, terminated);
  const numeric = parseNumericOptions(options);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  if (profile.credentialWithheld) {
    process.stderr.write(
      `Note: "${profile.name}" has a credential, but --base-url points at a different endpoint, so it was not sent.\n`,
    );
  }

  const target = await collectTarget(options);
  const { model, contextLength, contextSource, detectedWindow } = await resolveTarget(profile, options);
  // The server configuration this run resolved — the effective
  // window and its provenance, and which server-owned knobs were left at a
  // default nothing here could observe. Built once, attached to every failure
  // below and echoed on the success envelope.
  const runContext = buildRunContext({ contextLength, contextSource, detectedWindow }, { sampling, temperature: numeric.temperature });
  // Attached to anything thrown from here on. The model is usually resolved from
  // providers.json rather than passed as a flag, so a caller reading the failure
  // envelope — the benchmark's reliability table — could not otherwise say which
  // model an all-failed run had asked for, and bucketed every one as "unknown";
  // the run context is here for the same reason — the qwen runaway that scored
  // 0/6 is a report-stage throw, and only the window on its record makes it
  // readable. The window is resolved here rather than at command entry, so it
  // rides this closure rather than `runReview`'s catch the way `sampling` does.
  const named = (error) =>
    attachRunContext(Object.assign(error, { requestedModel: error.requestedModel ?? model }), runContext);

  // The WHOLE post-resolution body under one catch — `reviewPlan` INCLUDED, since
  // its `reserveFor` refuses a too-small `--max-tokens`: a review that fails there
  // must still carry the run context, not a null failure envelope. And a
  // reasoning-only runaway thrown by the report stage — after the model call
  // returned — carries it too, not just a failure from `requestFindings`.
  try {
    const ledger = createLedger();
    const plan = reviewPlan({ profile, options, instructions, target, model, contextLength, numeric, sampling, ledger });
    const startedAt = Date.now();
    process.stderr.write(`Reviewing ${target.label} with ${model} on ${profile.name}...\n`);
    // A review is the long silent run this exists for: whole-file passes measured
    // 38–245s before, and a cold prefill alone is minutes.
    const { result, structured, schema, budget, estimatedTokens, hunksOnly, skipped, salvaged, salvageTrim } = await withProgress((onProgress) =>
      requestFindings(profile, { ...plan, onProgress }),
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
      skipped,
      salvaged: Boolean(salvaged),
      salvageTrim: salvageTrim ?? null,
      // What was ASKED for, beside `structured` which is what was obtained. Only
      // the pair distinguishes "fell back after a refusal" from "never wanted a
      // schema" — since 2026-08-04 the second is the ordinary case, and the two
      // were indistinguishable for exactly as long as the first was the only one.
      structuredOutput: Boolean(options['structured-output']),
      budget,
      estimatedTokens,
      durationMs: Date.now() - startedAt,
      json: Boolean(options.json),
      // What we sent, echoed on the success envelope — the failure envelope reads
      // it off the thrown error instead (see runReview's catch).
      sampling: plan.sampling,
      // The server config, echoed on the success envelope beside `sampling` — the
      // failure envelope reads these off the thrown error (attached by `named`).
      ...runContext,
      ledger,
    });
  } catch (error) {
    throw named(error);
  }
}
