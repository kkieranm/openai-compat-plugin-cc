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
import { aggregateAttempts, allFailedError, partitionPasses, servedModelFailure } from './review-passes.mjs';
import { errorReport, report, reportPasses } from './review-report.mjs';
import { parseReviewLenses, windowRemedy, windowSource } from './review.mjs';
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
    'cache-buster', 'max-attempts', 'passes', 'lens', ...SAMPLING_FLAGS,
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
function reviewPlan({ profile, options, instructions, target, model, contextLength, numeric, sampling, ledger, lens }) {
  const { maxTokens, temperature, timeoutSeconds, maxSeconds, maxAttempts } = numeric;
  return {
    model,
    contextLength,
    target,
    instructions,
    // The lens for THIS pass (a name, or undefined on the lens-less path). Rides
    // into `requestFindings`'s ladder object; `prepareLadder` composes it at the
    // prompt tail. Undefined leaves the request byte-identical to a lens-less run.
    lens,
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
  // The collision is checked BEFORE the numeric parse below, so `--lens x --passes
  // nope` surfaces the more fundamental "cannot be combined" rather than a numeric
  // error about a value that was never going to be used. `--lens` and `--passes`
  // are different pass strategies with different agreement semantics, so combining
  // them is refused loudly rather than one silently winning.
  if (options.lens !== undefined && options.passes !== undefined) {
    throw new UserError('--lens and --passes cannot be combined.', {
      hint: 'Use --passes N for N plain passes, or --lens a,b,c for one pass per named lens.',
    });
  }
  const numeric = parseNumericOptions(options);
  // Named lenses, one pass each. Validated up front (unknown, empty or duplicate
  // names throw here, before any I/O). A lens run routes through the multi-pass
  // machinery even at a single lens, because the envelope must carry the lens
  // identity — the byte-identical single-pass promise is scoped to lens-LESS runs.
  const lenses = parseReviewLenses(options.lens);

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
    // Opt-in multi-pass: N independent passes unioned with an agreement count.
    // `passes === 1` (the default, and no flag) is byte-identical to the block
    // below — this branch is the whole extent of the feature's footprint on the
    // flagship path.
    const passCount = lenses.length || (numeric.passes ?? 1);
    // Multi-pass on either axis: more than one plain pass, OR one-or-more lenses
    // (a lens run always routes here so the envelope carries lens identity). A
    // lens-less `passCount === 1` never enters here — byte-identical as before.
    if (passCount > 1 || lenses.length) {
      await runMultiPass({ passCount, lenses, profile, options, instructions, target, model, contextLength, numeric, sampling, runContext });
      return;
    }
    const ledger = createLedger();
    const plan = reviewPlan({ profile, options, instructions, target, model, contextLength, numeric, sampling, ledger });
    // Up front, before the multi-minute run — not only in the after-the-fact
    // footer note. Without a window the size guard cannot be armed, so an
    // oversized request goes out unrefused and fails at the server minutes
    // later; saying so now lets the operator abort and configure the window
    // instead of waiting. The review still proceeds: a small or unreported
    // window usually succeeds, and refusing every one would deny work
    // `reserveFor` deliberately keeps. Emitted AFTER `reviewPlan`, whose
    // `reserveFor` refuses a too-small `--max-tokens` — so "Proceeding" never
    // precedes an immediate local refusal — and ad-hoc-aware, since an
    // ad-hoc `--base-url` run has no config entry to set "contextLength" on.
    if (!contextLength) {
      process.stderr.write(
        `WARNING: the context window for ${windowSource(profile)} could not be determined, so the ` +
          `input size cannot be checked and an oversized request may be rejected by the server. ` +
          `${windowRemedy(profile)} to enable the check. Proceeding.\n`,
      );
    }
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

/**
 * N independent passes of the same request, unioned into one report with an
 * agreement count per finding. Each pass is a full `requestFindings` +
 * `parseFindings` with its OWN fresh `reviewPlan` and ledger: the target is
 * shared (what makes the union comparable and the agreement count meaningful),
 * the attempt bookkeeping is not, so a pass's `attempts`/`retried` never spans
 * passes. A pass is structured to take its target as a parameter even though all
 * N are identical today, so OAI-11 (per-pass `{provider, model, lens}`) is a
 * config change, not a rewrite. Sequential: one local model, so concurrency buys
 * nothing here — the concurrent case is cross-provider (OAI-11). Called inside
 * `reviewFlow`'s post-resolution `try`, so its fail-closed throws carry the run
 * context like every other failure on this path.
 */
async function runMultiPass({ passCount, lenses = [], profile, options, instructions, target, model, contextLength, numeric, sampling, runContext }) {
  const outcomes = [];
  for (let index = 0; index < passCount; index += 1) {
    // The lens for THIS pass, or undefined on the plain `--passes` path. Carried
    // BY VALUE onto the outcome below so `mergePasses` can attribute each finding
    // to the lens that produced it — never by pass index, which shifts when a
    // middle pass fails and `reportPasses` compacts the readable outcomes.
    const lens = lenses[index];
    const ledger = createLedger();
    const plan = reviewPlan({ profile, options, instructions, target, model, contextLength, numeric, sampling, ledger, lens });
    // After the FIRST plan, for the same reason the single-pass path emits it
    // after `reviewPlan`: `reserveFor` refuses a too-small --max-tokens, so
    // "Proceeding" must never precede an immediate local refusal.
    if (index === 0 && !contextLength) {
      process.stderr.write(
        `WARNING: the context window for ${windowSource(profile)} could not be determined, so the ` +
          `input size cannot be checked and an oversized request may be rejected by the server. ` +
          `${windowRemedy(profile)} to enable the check. Proceeding.\n`,
      );
    }
    const startedAt = Date.now();
    process.stderr.write(`Reviewing ${target.label} with ${model} on ${profile.name} (pass ${index + 1}/${passCount})...\n`);
    try {
      const { result, structured, schema, budget, estimatedTokens, hunksOnly, skipped, salvaged, salvageTrim } = await withProgress(
        (onProgress) => requestFindings(profile, { ...plan, onProgress }),
      );
      // No per-pass substitution notice here, unlike the single-pass path: a
      // substitution makes `servedModelFailure` refuse the whole run below, so a
      // notice saying "results belong to the model that ran" would contradict the
      // refusal it precedes. A substituted pass that was ALSO a non-observation
      // escapes that guard (it is never in the readable set), but only the
      // parse-null subset (a reply arrived, so `pass.result` exists) has its served
      // model on its `passes[]` record, and only a CONFIRMED substitution there
      // (`modelReported === true`) gets the per-pass-line note — `reportPasses`
      // reads both off `pass.result`. A THROWN substituted pass carries no
      // `pass.result`, so its substitution is not disclosed — a known gap. The id is
      // not always gone: a stream drop AFTER a model-bearing frame leaves it on the
      // raw accumulator at `error.answer.model` (server-named — the accumulator's
      // default is null, only a frame sets it), but that accumulator never reached
      // `finishAnswer`, so it has no `modelReported`/`requestedModel` beside it, and
      // the thrown branch does not read it yet.
      outcomes.push({
        ok: true,
        lens: lens ?? null,
        parsed: parseFindings(result, { structured, schema }),
        result,
        structured,
        budget,
        estimatedTokens,
        hunksOnly,
        skipped,
        salvaged: Boolean(salvaged),
        salvageTrim: salvageTrim ?? null,
        durationMs: Date.now() - startedAt,
        ledger,
      });
    } catch (error) {
      outcomes.push({ ok: false, lens: lens ?? null, error, ledger, durationMs: Date.now() - startedAt });
    }
  }

  const { readable } = partitionPasses(outcomes);
  // Fail closed before any render: an all-unreadable run must not print
  // `findings: []` at exit 0, and a union across unconfirmed or disagreeing
  // models is not a measurement of one model. Both post-hoc failures carry the
  // completed passes' attempt records so their `--json` envelope reads
  // `attempts` like every other — `allFailedError` aggregates its own; the
  // served-model refusal is a bare `UserError`, so attach them here.
  if (readable.length === 0) throw allFailedError(outcomes, profile);
  const servedFailure = servedModelFailure(readable);
  if (servedFailure) {
    const attemptRecords = aggregateAttempts(outcomes);
    if (attemptRecords.length) servedFailure.attemptRecords = attemptRecords;
    throw servedFailure;
  }

  reportPasses(outcomes, {
    profile,
    model,
    target,
    structuredOutput: Boolean(options['structured-output']),
    sampling,
    json: Boolean(options.json),
    // The run's pass strategy and, on the lens path, the ordered lens list — the
    // envelope's identity for what varied across passes.
    strategy: lenses.length ? 'lenses' : 'passes',
    lenses,
    ...runContext,
  });
}
