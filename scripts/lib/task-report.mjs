// How a finished `/oai:task` run is shown — the answer, the footer under it,
// and the refusal that decides whether there is an answer to show at all.
//
// Split from cmd-task.mjs, which makes the request, exactly as
// `review-report.mjs` is split from cmd-review.mjs. Kept out of `render.mjs`
// deliberately, for the reason that file gives: that module is pure
// string-building, and this one writes to stdout and throws.
import { requireAnswer } from './client.mjs';
import { renderTaskFooter } from './render.mjs';
import { templateNotes } from './task-template.mjs';

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
export function report(outcome) {
  // Fails loudly rather than printing nothing: an empty answer with a footer
  // reads as a successful run that had nothing to say.
  process.stdout.write(requireAnswer(outcome.result, outcome.profile).trim());
  writeFooter(outcome);
  // Same builder `cmd-result.mjs` calls for the same run collected later, and
  // the same seam `renderTaskFooter` already uses: one pure builder, and each
  // path does its own writing. Instance 16 in `.claude/REPO_TRAPS.md` is this
  // repo showing a caveat on one of two renderings of one run — what prevents
  // that is the single builder, not a shared writer.
  for (const note of templateNotes({ name: outcome.template, estimatedTokens: outcome.estimatedTokens })) {
    process.stdout.write(`\n${note}\n`);
  }
}
