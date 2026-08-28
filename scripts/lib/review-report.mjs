// How a finished review run is shown — the text report and the `--json` object.
//
// Split from cmd-review.mjs, which orchestrates the request. Kept out of
// review.mjs deliberately: that module is pure string-building, and this one
// writes to stdout and throws. The refusals that decide whether a run is
// REPORTABLE AT ALL left for `review-unparsed.mjs` at the size ratchet, so this
// file no longer owns them and this line no longer claims it does.
import { CONTEXT_SOURCES, positiveInteger } from './model-info.mjs';
import { renderTaskFooter } from './render.mjs';
import { renderFindings, unreadableNote, unsizedWindowNote } from './review.mjs';
import { reconstructServerConfig } from './run-context.mjs';
import { reasoningWitness } from './reasoning-witness.mjs';
import { unparsedReply } from './review-unparsed.mjs';

function reportFindings(parsed, { result, structured, profile, model, target, hunksOnly, skipped, salvaged, ledger }) {
  if (parsed) {
    process.stdout.write(
      renderFindings(
        { ...parsed, hunksOnly, unreadable: target.unreadable, skippedUnsizedWindow: skipped === 'unsized-window', salvaged },
        // The model that ANSWERED, not the one requested. This block heads the
        // report and the footer closes it; handing one the requested id and the
        // other the served id would produce a single report naming two different
        // models, which is worse than the silence it replaced.
        { label: target.label, profile, model: result.model || model },
      ),
    );
    return;
  }

  const text = unparsedReply(result, { structured, profile, ledger });
  // Every caveat, because a reply that came back as prose did not see more —
  // `salvaged` FIRST, same ordering as `caveats()` below: without it, a
  // salvage follow-up's prose reply carries no indication it came from a
  // conclude-now request rather than the original review, even
  // though this branch already disclaims completeness on its own terms.
  const notes = [
    salvaged
      ? 'WARNING: this reply came from a SALVAGE follow-up — a conclude-now request sent after the ' +
        'model ran out of time reasoning, not the original findings-first pass. Treat it as less ' +
        'reliable than an ordinary review.'
      : null,
    unsizedWindowNote(skipped === 'unsized-window', profile),
    unreadableNote(target.unreadable),
  ].filter(Boolean);
  process.stdout.write(
    `The model did not return findings in the requested shape. Its reply, verbatim:\n\n${text}\n\n` +
      `Nothing here has been checked against the code.${notes.length ? `\n\n${notes.join('\n\n')}` : ''}`,
  );
}

/**
 * What the run's wall clock was made of, and whether it took more than one try.
 *
 * The two halves of `durationMs` that a prompt cache treats differently: prefill
 * moves by ~37× between a cold and a warm run of the same prompt while
 * generation does not move at all, so a single total is two measurements welded
 * together — and the benchmark was averaging across the seam. Both are measured
 * inside the answering attempt rather than derived from `durationMs`, which
 * starts earlier and absorbs prompt building and any rejected attempt. Null on a
 * non-streamed reply, where no boundary was observed.
 *
 * `retried` is here because the timings cannot show it. They belong to the
 * attempt that answered; a refused attempt is rejected at request validation
 * before any generation, so it neither prefills nor warms a cache — but that is
 * a property of every server observed, not a guarantee. Against one that
 * prefilled before refusing, the prefill above would understate the run, and
 * this flag is what turns an undetectable limit into one a reader can see.
 *
 * **It counts both ladders, which the first version did not.** Deriving it from
 * `structured` alone saw only the `response_format` retry and missed the
 * `stream`/`stream_options` rungs in `postWithDegrade` — and those are not
 * hypothetical: `tests/stream-budget.test.js` drives three HTTP attempts for one
 * answer through the real CLI. A field whose own name promises "more than one
 * try" reporting `false` for a run that tried three times is the reported-state
 * class this repo keeps finding, in the field added to prevent it. `degraded` is
 * kept beside it for the narrower fact it actually names: the schema was refused
 * and the reply was parsed from prose.
 *
 * **Both were rewritten for when the default stopped sending a
 * schema.** `!structured` used to mean "we fell back", because a schema
 * was always asked for; now it is true of every ordinary run, so the old
 * expressions claimed a retry for a run that sent one request and a fallback for
 * a schema nobody requested. `degraded` therefore needs BOTH facts — asked for,
 * and not obtained — and `retried` needs none of them: the request count already
 * says what it means, across every ladder. Exactly the inversion this docstring
 * warns about, in the field added to prevent it, which is why it is written down
 * rather than quietly corrected.
 *
 * **Read off the shared ledger when one is available, not `result.requestCount`.**
 * `requestCount` is scoped to the one `answerWithRetry`
 * call that produced `result` — exactly right for the two ladders this
 * docstring already describes, both of which run inside a single call. Salvage
 * is a second, separate call on the same shared ledger: a review that failed
 * once and then salvaged successfully made at least two physical requests, but
 * the salvage call's own `requestCount` is 1 (it never retries itself), so
 * `retried` read `false` for a run that plainly was one. The ledger spans both
 * calls; `requestCount` only ever spans one.
 */
function runTimings(result, { structured, structuredOutput, ledger }) {
  return {
    prefillMs: result.prefillMs ?? null,
    generationMs: result.generationMs ?? null,
    retried: ledger ? ledger.entries().length > 1 : (result.requestCount ?? 1) > 1,
    degraded: Boolean(structuredOutput) && !structured,
  };
}

/**
 * What could be read out of the reply, or nulls where nothing was determined.
 *
 * Lifted out of `jsonReport` at the function size budget. The parse-derived
 * fields are `null` rather than `false`/`[]` for a reply that could not be read:
 * an empty findings list is indistinguishable from a clean review, and one of
 * those two is a failure.
 *
 * `analysisLength`/`analysisCap` are deliberately JSON-only, and that is not the
 * omission this file exists to prevent: `analysisCut` is the *caveat* and it is
 * in both renderings. These two are the measurement behind it — a character
 * count and the ceiling it is counted against — which a harness reads and a
 * human footer would only be cluttered by. The rule is that a fact changing what
 * the reader should believe cannot live on one path alone; a diagnostic that
 * changes nothing is free to.
 */
function parseFields(parsed, result, context) {
  return {
    parsed: Boolean(parsed),
    findings: parsed?.findings ?? null,
    summary: parsed?.summary ?? null,
    raw: parsed ? null : unparsedReply(result, context),
    dropped: parsed?.dropped ?? null,
    atCap: parsed?.atCap ?? null,
    analysisCut: parsed?.analysisCut ?? null,
    analysisLength: parsed?.analysisLength ?? null,
    analysisCap: parsed?.analysisCap ?? null,
  };
}

/**
 * The same run, as one object.
 *
 * Every caveat the text report carries appears here too. A caller reading only
 * `findings` would otherwise score a guillotined review as a clean pass. Where the reply
 * could not be read, the three parse-derived flags are `null` rather than
 * `false`: nothing was determined about them, and `false` would assert that a
 * list nobody could count did not hit its cap.
 *
 * Exported for the tests that pin those fields; the command calls `report`.
 */
export function jsonReport(parsed, context) {
  const { result, profile, model, target, hunksOnly, skipped, budget, estimatedTokens, durationMs, structured, ledger, salvaged, salvageTrim } = context;
  return {
    label: target.label,
    provider: profile.name,
    // A context-derived fact, not something read off the model's own reply —
    // same shape as `hunksOnly`/`skippedUnsizedWindow` below.
    // Non-negotiable: a salvaged review must never
    // read as an ordinary complete one, so this rides beside `findings` on
    // every path that can set it, never inferred from anything else here.
    salvaged: Boolean(salvaged),
    // The trim decision trySalvage made about the OUTGOING follow-up request —
    // same diagnostic class as budget/estimatedTokens/hunksOnly (a fact about
    // what WE sent), never the analysisCap class (a fact read off the model's
    // reply). Deliberately JSON-only, same posture as analysisLength/analysisCap
    // above. `null` when no salvage happened. `{ applied: false, ... }` when
    // salvage happened but trimming didn't apply — either the reason
    // (deadline-timeout) was scoped out, or the reasoning already fit under the
    // retention budget; this field alone doesn't distinguish the two.
    salvageTrim: salvageTrim ?? null,
    // What answered, not what was asked for: a server may serve a different
    // build than the id requested, and the run belongs to the one that ran.
    model: result.model || model,
    // …and what was asked for, beside it, because "the run belongs to the model
    // that ran" is only half the fact. Recording the served id alone is what let
    // a benchmark arm spend its whole wall clock on a model it did not claim to
    // test and leave a record that read as clean. Measured: LM Studio answers a
    // request for a model it does not have with a normal completion from
    // whatever IS loaded.
    //
    // No `substituted` boolean beside these: it is `model !== requestedModel`,
    // and a stored copy of a derived fact is the mirror-don't-generate defect.
    // Consumers call `substitution()`.
    // The `??` is unreachable — `finishAnswer` always returns it — and must stay
    // that way: were it ever taken, both fields would collapse and a reader
    // would see "checked, they matched" where nothing was determined.
    requestedModel: result.requestedModel ?? model,
    ...parseFields(parsed, result, context),
    hunksOnly,
    // The CAUSE `hunksOnly` cannot carry — it is equally true of `--diff-only`.
    // Read off the rung the ladder actually took, never recomputed from the
    // inputs that chose it: a second copy of the premise can outlive the branch.
    skippedUnsizedWindow: skipped === 'unsized-window',
    unreadable: target.unreadable,
    usage: result.usage ?? null,
    // The reasoning state OBSERVED in this reply — `reasoning-observed` /
    // `no-reasoning-observed` / `unknown`, derived from `usage`'s
    // `reasoning_tokens`. A fact read off the reply, distinct from
    // `serverConfig` (what the request carried): the thinking channel is set by
    // the server's chat template, unreachable over the wire, so the reply is the
    // only place a run's actual reasoning state is visible.
    reasoning: reasoningWitness(result.usage),
    finishReason: result.finishReason ?? null,
    // The vendor sampling/reasoning params requested for this run, or null — a
    // fact about the request, same class as `requestedModel`. On this success
    // path the request went out, so requested and sent coincide; the failure
    // envelope carries the same field (read off the thrown error), where
    // "requested" is the honest word since a pre-dispatch failure never sent it.
    sampling: context.sampling ?? null,
    // The server configuration this run resolved: the effective
    // context window and its provenance (`config` = operator-asserted, else the
    // server-detected source), the detected window when it conflicts with a
    // configured one, and which server-owned knobs were left at a default no API
    // exposes. A context-derived fact, same class as `sampling`; the failure
    // envelope reads the same four off the thrown error.
    contextWindow: context.contextWindow ?? null,
    contextSource: context.contextSource ?? null,
    detectedWindow: context.detectedWindow ?? null,
    serverConfig: context.serverConfig ?? null,
    estimatedTokens,
    // Whether `estimatedTokens` was ever tested against a window, and the note
    // saying so when it was not. The text footer has always carried this as
    // `contextNote`; omitting it here left `--json` reporting a bare number a
    // caller could not tell from a checked one — with the size guard disarmed,
    // which is exactly when an oversized request goes out unrefused. This file
    // was created to stop a caveat being true on one path and absent on the
    // next.
    contextChecked: budget.checked,
    contextNote: budget.checked ? null : budget.note,
    durationMs,
    ...runTimings(result, { structured, structuredOutput: context.structuredOutput, ledger }),
    // One entry per PHYSICAL request — the first try, a capability degrade, the
    // response_format fallback, a retry after the server dropped one. The
    // timings above belong to the attempt that *answered*; these are how the
    // benchmark separates recall (a property of logical runs) from reliability
    // (a property of every request that went on the wire). A failed attempt is
    // missing data, never an observed miss. See attempt-ledger.mjs.
    attempts: ledger ? ledger.entries() : null,
  };
}

/**
 * A run that failed, as one object — the other half of the `--json` contract.
 *
 * Without it, `--json` was machine-readable on success and prose on failure, so
 * a harness could tell *that* a run failed but never *why*: `bench/run.mjs`
 * stored the whole of stderr and could only distinguish a wall-clock cap from a
 * 500 by pattern-matching the message. This repo has hit that pattern
 * twice over, and the fix is the same one taken here — read the structured
 * field, not the prose.
 *
 * `reason` is the transport's own vocabulary where there is one
 * (`deadline-timeout`, `idle-timeout`, `oversize`, `protocol`, …) and `null`
 * otherwise, including for an internal failure. Null means "nothing was
 * determined", exactly as it does in `jsonReport` — never a guess, and never a
 * category invented here to fill the field.
 *
 * The prose is carried too rather than replaced: a reason is a category, and the
 * message is what actually happened.
 */
// Snapshot the source ONCE before validating it: a getter could otherwise pass
// `CONTEXT_SOURCES.has` on the first read and hand a different, foreign value to
// the second — the same read-twice hazard `reconstructServerConfig` guards.
function allowedSource(error) {
  const source = error?.contextSource;
  return CONTEXT_SOURCES.has(source) ? source : null;
}

export function errorReport(error) {
  return {
    error: true,
    reason: error?.reason ?? null,
    message: error?.message ?? String(error),
    hint: error?.hint ?? null,
    // `error.endpoint` / `error.responseBody` / `error.bodyExcerpt` /
    // `error.finishReason` are deliberately never copied here —
    // this object is what `publishFailure` persists into `jobs.db`, and all
    // four fields can be secret-shaped. Absence by construction: this is an
    // explicit field list, not a spread of `error`, so a new field on the
    // source error never reaches a persisted job by default.
    // The attempt record survives the failure path, and this is the path where
    // it matters most: a run whose every attempt died is the run carrying the
    // most reliability evidence, and the easiest place to lose it. `null` where
    // the failure happened before any request — nothing was determined, which is
    // not the same as no attempts having been made.
    attempts: error?.attemptRecords ?? null,
    // Which model the run asked for, where the failure happened late enough to
    // know. A run whose every attempt died produced no report, so this is the
    // only place the id survives — without it the reliability table cannot
    // attribute an all-failed sweep to the model that failed.
    requestedModel: error?.requestedModel ?? null,
    // The sampling params the run was REQUESTED with, attached to the error by
    // the command-level catch — so a post-dispatch runaway records what it ran
    // under, and a pre-dispatch failure records what it would have. Not
    // "sent": on a pre-dispatch failure no request went out, and this field is
    // present regardless, earlier than `requestedModel` (which needs the model
    // resolved). `null` on a background failure (the worker never runs that
    // catch) and on a parse failure (none were valid) — the same "cannot live on
    // one path alone" rule as requestedModel above.
    sampling: error?.sampling ?? null,
    // The server config the run resolved, reconstructed FAIL-CLOSED
    // because this object is what `publishFailure` persists into `jobs.db`: a
    // window only as a positive integer, a source only if it is one
    // `effectiveWindow` can produce, and `serverConfig` rebuilt as a fresh
    // three-knob map — a foreign object carrying a custom prototype or `toJSON`
    // can never reach the serialized output, and `null` where the failure
    // preceded resolution (the same "cannot live on one path alone" rule).
    contextWindow: positiveInteger(error?.contextWindow) ?? null,
    contextSource: allowedSource(error),
    detectedWindow: positiveInteger(error?.detectedWindow) ?? null,
    serverConfig: reconstructServerConfig(error?.serverConfig),
    // The observed reasoning state, on the failure path too so the success and
    // failure envelopes stay the same shape. No throw site sets `error.usage` —
    // the field this reads — so it is currently always `{ state: 'unknown',
    // tokens: null }`, even for a post-response failure whose reply did report
    // reasoning (the reply's usage lives on `error.answer` or in the unthrown
    // `result`, never here). Needs no fail-closed reconstruction the way
    // `serverConfig` does: `reasoningWitness` reads only a number and returns a
    // fresh constant-and-primitive object, so nothing off a foreign error can
    // reach the persisted output through it, and it never throws.
    reasoning: reasoningWitness(error?.usage),
    // What the model had already produced when the failure cut it off —
    // `stream-collect.mjs` attaches `.answer` to every
    // failure it catches, but most carry nothing (a pre-stream refusal, no
    // frame ever arrived). `null` unless there is real text — reasoning OR
    // content — to show for it, following the same "cannot live on one path
    // alone" rule as every other belief-changing field in this file.
    partial: error?.answer?.reasoning?.trim() || error?.answer?.content?.trim()
      ? { reasoning: error.answer.reasoning, content: error.answer.content }
      : null,
  };
}

/**
 * One run, two renderings, kept side by side so a fact present in one cannot
 * quietly go missing from the other — the rule `jsonRow` already follows in
 * `cmd-setup.mjs`. Both derive from the same parsed object and the same
 * refusals; only the shape differs.
 */
export function report(parsed, context) {
  if (context.json) {
    process.stdout.write(`${JSON.stringify(jsonReport(parsed, context), null, 2)}\n`);
    return;
  }

  reportFindings(parsed, context);
  const { profile, result, budget, estimatedTokens, durationMs } = context;
  process.stdout.write(
    `${renderTaskFooter({
      providerName: profile.name,
      model: result.model,
      requestedModel: result.requestedModel,
      usage: result.usage,
      durationMs,
      prefillMs: result.prefillMs,
      generationMs: result.generationMs,
      contextNote: budget.checked ? `~${estimatedTokens} tokens sent.` : budget.note,
      finishReason: result.finishReason,
    })}\n`,
  );
}
