// How a finished `/oai:task` run is shown — the answer, the footer under it,
// and the refusal that decides whether there is an answer to show at all.
//
// Split from cmd-task.mjs, which makes the request, exactly as
// `review-report.mjs` is split from cmd-review.mjs. Kept out of `render.mjs`
// deliberately, for the reason that file gives: that module is pure
// string-building, and this one writes to stdout and throws.
import { requireAnswer } from './client.mjs';
import { renderTaskFooter } from './render.mjs';
import { artifactNote } from './task-artifact.mjs';
import { artifactKind, templateNotes } from './task-template.mjs';

/**
 * One finished run as one object — the machine-readable half of this command.
 *
 * Beside `report` on purpose, following the rule `review-report.mjs` states for
 * its own pair: two renderings of one run, kept side by side so a fact present
 * in one cannot quietly go missing from the other. Both take the same `outcome`
 * and both sit behind the same refusal.
 *
 * `notes` is the load-bearing one. The text path prints the template's caveats
 * under the footer; an envelope that omitted them would leave a harness reading
 * a large, crowded advisor reply with no indication it was crowded. It is an
 * ARRAY rather than joined text for the same reason as
 * the attachments line: a delimiter inside a value is a forgeable
 * entry, and an array has no delimiter to forge.
 *
 * The answer itself stays an opaque string. A template asks for its shape in
 * prose and nothing parses it; structuring the transport does not change that,
 * and this envelope must not grow a field claiming the reply conformed.
 */
function jsonTaskReport(outcome, answer) {
  const { result, profile, model, budget, estimatedTokens, durationMs, template, ledger } = outcome;
  return {
    provider: profile.name,
    // What answered, beside what was asked for — the same pair, for the same
    // reason, as the review envelope: a server may serve a build nobody asked
    // for, and a record naming only one cannot show it.
    //
    model: result.model || model,
    requestedModel: result.requestedModel ?? model,
    // **Whether `model` above is something the server SAID, or the requested id
    // echoed back.** `completion.mjs` collapses the two deliberately, so that a
    // server naming nothing cannot produce a substitution report nothing
    // observed — a decision this envelope does not overturn. But the collapse
    // makes attribution unfalsifiable downstream, and a benchmark that credits a
    // run to a model needs to know which it has. Recorded rather than inferred,
    // because by this point the difference is gone.
    modelReported: result.modelReported ?? false,
    content: answer,
    template: template ?? null,
    notes: templateNotes({ name: template, estimatedTokens }),
    // The objective half, where there is one: `applies` | `rejected` | `absent` |
    // `unavailable`, never a boolean — "there was no diff", "the diff was broken"
    // and "nothing could check it" are three different failures.
    artifact: outcome.artifact ?? null,
    usage: result.usage ?? null,
    finishReason: result.finishReason ?? null,
    // The vendor sampling/reasoning params requested for this run, or null — a
    // fact about the request, echoed the same way the review envelope does. This
    // is the success path, so requested and sent coincide; the failure envelope
    // uses the same "requested" framing for the pre-dispatch case.
    sampling: outcome.sampling ?? null,
    estimatedTokens,
    // Whether the size guard was ever armed, and the note saying so when it was
    // not. Omitting these would report a bare token count a caller could not
    // tell from a checked one.
    contextChecked: budget.checked,
    contextNote: budget.checked ? null : budget.note,
    durationMs,
    prefillMs: result.prefillMs ?? null,
    generationMs: result.generationMs ?? null,
    // One entry per PHYSICAL request, so a reader can separate what the answer
    // cost from what the run cost. `null` where no ledger reached this far.
    //
    // **No `retried` boolean beside it, and that is another deliberate
    // divergence from the review envelope.** `retried` there is
    // `(requestCount ?? 1) > 1` — a second source for a fact this list already
    // holds, which is the mirror-don't-generate defect the review envelope
    // itself avoids for `substituted`. Two sources disagree eventually; a
    // consumer counts `attempts`.
    attempts: ledger ? ledger.entries() : null,
  };
}

/**
 * Every field the human path shows, named in one place.
 *
 * Being one place is the point: `/oai:review` renders the same footer from
 * `review-report.mjs`, and a figure added to one call site and forgotten at the
 * other is how a fact ends up true on one path and absent on the next.
 */
function writeFooter({ result, profile, budget, durationMs }) {
  process.stdout.write(
    `${renderTaskFooter({
      providerName: profile.name,
      model: result.model,
      requestedModel: result.requestedModel,
      usage: result.usage,
      durationMs,
      prefillMs: result.prefillMs,
      generationMs: result.generationMs,
      contextNote: budget.checked ? null : budget.note,
      finishReason: result.finishReason,
    })}\n`,
  );
}

/**
 * One finished run, as text.
 *
 * `requireAnswer` refuses here rather than in the executor so that it stays
 * *behind* the substitution notice the command writes: a server answering from
 * a model nobody asked for is a fact about the run whether or not the run then
 * had nothing to say, and refusing first is how that warning goes missing from
 * exactly the runs that failed.
 */
export function report(outcome, { json = false } = {}) {
  // Fails loudly rather than printing nothing, and BEFORE either rendering: an
  // empty answer with a footer reads as a successful run that had nothing to
  // say, and an empty answer inside an envelope reads the same way to a harness
  // — which is the reader least able to tell. The refusal is the one thing both
  // shapes must share, so it happens above the branch rather than inside one.
  const answer = requireAnswer(outcome.result, outcome.profile).trim();

  if (json) {
    process.stdout.write(`${JSON.stringify(jsonTaskReport(outcome, answer), null, 2)}\n`);
    return;
  }

  process.stdout.write(answer);
  writeFooter(outcome);
  // Above the template's own notes, because it is the more specific fact: the
  // discipline line says the answer is unverified in general, this says exactly
  // what was verified about it.
  if (outcome.artifact) process.stdout.write(`\n${artifactNote(outcome.artifact)}\n`);
  // Same builder `cmd-result.mjs` calls for the same run collected later, and
  // the same seam `renderTaskFooter` already uses: one pure builder, and each
  // path does its own writing, so a caveat on one of two renderings of one run
  // can't happen — what prevents that is the single builder, not a shared writer.
  for (const note of templateNotes({ name: outcome.template, estimatedTokens: outcome.estimatedTokens })) {
    process.stdout.write(`\n${note}\n`);
  }
}
