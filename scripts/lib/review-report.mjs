// How a finished review run is shown — the text report, the `--json` object,
// and the refusals that decide whether a run is reportable at all.
//
// Split from cmd-review.mjs, which orchestrates the request. Kept out of
// review.mjs deliberately: that module is pure string-building, and this one
// writes to stdout and throws.
import { requireAnswer } from './client.mjs';
import { UserError } from './errors.mjs';
import { renderTaskFooter } from './render.mjs';
import { renderFindings, unreadableNote } from './review.mjs';

/**
 * The verbatim reply, for the paths that could not read findings out of it —
 * and the two refusals that have to fire before anything is shown.
 *
 * Shared by the text report and `--json` rather than copied into each. These
 * are decisions about whether the run is reportable at all, so a second copy
 * would be free to disagree, and this repo keeps relearning that fixing the
 * branch in front of you leaves the adjacent one wrong (trap instance 11).
 */
function unparsedReply(result, { structured, profile }) {
  // A reply we cut off mid-object is a token-budget problem, not a shape
  // problem. Showing the fragment and calling it a bad shape blames the model
  // for damage we did, and hides the one flag that fixes it.
  if (result.finishReason === 'length') {
    // The old hint said "raise --max-tokens" and stopped there, which is now
    // sometimes advice that cannot work: below the wall-clock ceiling every
    // extra token widens `analysis`, not the findings tail, so a reply overrun
    // by its ninth long finding fails again at a larger budget — and on a big
    // input `prepareRequest` may shrink the raised value straight back to the
    // window's leftovers. Reviewing less is the lever that moves both.
    throw new UserError(`${profile.name} ran out of tokens before it finished writing its findings.`, {
      hint:
        'Review a smaller target — a single commit with --commit, or specific files with --file. '
        + 'Raising --max-tokens helps only when the window has room to spare: past that it buys more '
        + 'reasoning rather than more room for the findings themselves.',
    });
  }

  // Under a schema the reasoning channel carries the constrained output, so it
  // is legitimate to show; without one it is only the model's scratchpad.
  // Either way an empty reply falls through to requireAnswer, which refuses —
  // returning an empty "verbatim" block would report a run that produced
  // nothing as one that merely said something odd.
  const constrained = structured ? result.content.trim() || result.reasoning.trim() : '';
  return constrained || requireAnswer(result, profile).trim();
}

function reportFindings(parsed, { result, structured, profile, model, target, hunksOnly }) {
  if (parsed) {
    process.stdout.write(
      renderFindings(
        { ...parsed, hunksOnly, unreadable: target.unreadable },
        // The model that ANSWERED, not the one requested. This block heads the
        // report and the footer closes it; handing one the requested id and the
        // other the served id would produce a single report naming two different
        // models, which is worse than the silence it replaced.
        { label: target.label, provider: profile.name, model: result.model || model },
      ),
    );
    return;
  }

  const text = unparsedReply(result, { structured, profile });
  // The same caveat as the parsed path: a file that never arrived is a fact
  // about the request, and this output is just as derived from it.
  const missing = unreadableNote(target.unreadable);
  process.stdout.write(
    `The model did not return findings in the requested shape. Its reply, verbatim:\n\n${text}\n\n` +
      `Nothing here has been checked against the code.${missing ? `\n\n${missing}` : ''}`,
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
 * non-streamed reply, where no boundary was observed. See ADR 009.
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
 * **Both were rewritten on 2026-08-04, when the default stopped sending a
 * schema (OAI-51).** `!structured` used to mean "we fell back", because a schema
 * was always asked for; now it is true of every ordinary run, so the old
 * expressions claimed a retry for a run that sent one request and a fallback for
 * a schema nobody requested. `degraded` therefore needs BOTH facts — asked for,
 * and not obtained — and `retried` needs none of them: the request count already
 * says what it means, across every ladder. Exactly the inversion this docstring
 * warns about, in the field added to prevent it, which is why it is written down
 * rather than quietly corrected.
 */
function runTimings(result, { structured, structuredOutput }) {
  return {
    prefillMs: result.prefillMs ?? null,
    generationMs: result.generationMs ?? null,
    retried: (result.requestCount ?? 1) > 1,
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
 * `findings` would otherwise score a guillotined review as a clean pass — trap
 * instance 14, the defect ADR 004 shipped and `528faba` fixed. Where the reply
 * could not be read, the three parse-derived flags are `null` rather than
 * `false`: nothing was determined about them, and `false` would assert that a
 * list nobody could count did not hit its cap.
 *
 * Exported for the tests that pin those fields; the command calls `report`.
 */
export function jsonReport(parsed, context) {
  const { result, profile, model, target, hunksOnly, budget, estimatedTokens, durationMs, structured, ledger } = context;
  return {
    label: target.label,
    provider: profile.name,
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
    unreadable: target.unreadable,
    usage: result.usage ?? null,
    finishReason: result.finishReason ?? null,
    estimatedTokens,
    // Whether `estimatedTokens` was ever tested against a window, and the note
    // saying so when it was not. The text footer has always carried this as
    // `contextNote`; omitting it here left `--json` reporting a bare number a
    // caller could not tell from a checked one — with the size guard disarmed,
    // which is exactly when an oversized request goes out unrefused. This file
    // was created to stop a caveat being true on one path and absent on the
    // next, and it shipped doing that. Instance 16.
    contextChecked: budget.checked,
    contextNote: budget.checked ? null : budget.note,
    durationMs,
    ...runTimings(result, { structured, structuredOutput: context.structuredOutput }),
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
 * 500 by pattern-matching the message. This repo has that pattern on file as a
 * defect class twice over (OAI-13 items 1 and 2), and the fix recorded there is
 * the same one taken here — read the structured field, not the prose.
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
export function errorReport(error) {
  return {
    error: true,
    reason: error?.reason ?? null,
    message: error?.message ?? String(error),
    hint: error?.hint ?? null,
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
