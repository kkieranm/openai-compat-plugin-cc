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
    throw new UserError(`${profile.name} ran out of tokens before it finished writing its findings.`, {
      hint: 'Raise --max-tokens, or review a smaller target — the model reasons at length before reporting.',
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
        { label: target.label, provider: profile.name, model },
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
  const { result, profile, model, target, hunksOnly, budget, estimatedTokens, durationMs } = context;
  return {
    label: target.label,
    provider: profile.name,
    // What answered, not what was asked for: a server may serve a different
    // build than the id requested, and the run belongs to the one that ran.
    model: result.model || model,
    parsed: Boolean(parsed),
    // Never an empty findings list for a reply we could not read — that is
    // indistinguishable from a clean review, and one of the two is a failure.
    findings: parsed?.findings ?? null,
    summary: parsed?.summary ?? null,
    raw: parsed ? null : unparsedReply(result, context),
    dropped: parsed?.dropped ?? null,
    atCap: parsed?.atCap ?? null,
    analysisCut: parsed?.analysisCut ?? null,
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
      usage: result.usage,
      durationMs,
      contextNote: budget.checked ? `~${estimatedTokens} tokens sent.` : budget.note,
      finishReason: result.finishReason,
    })}\n`,
  );
}
