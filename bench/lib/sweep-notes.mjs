// Every reason one entry's review is less than it appears, as sentences.
//
// Three renderers call this — the findings list, a coverage row and the
// reviewed-nothing section — so it is the report's only shared vocabulary
// rather than a helper belonging to any one of them, and it is the piece that
// grows every time the CLI learns to report a new way of coming up short.
import { safeInline } from './markdown-safe.mjs';

/**
 * The caveats that ride along with a review that DID complete.
 *
 * `atCap` and `dropped` do not stop a review counting — findings were produced —
 * but both mean the list is shorter than what the model had to say, and a reader
 * comparing two commits' counts needs to know which.
 */
export function incompleteness(entry) {
  const notes = [];
  // First, and the loudest of these — salvage. A salvaged review must never
  // read as an ordinary complete one. These findings did not come from the
  // model's ordinary findings-first pass; its normal run produced reasoning but
  // no answer, and what is shown is a second, separate request asking it to
  // conclude from that reasoning.
  if (entry.salvaged) notes.push("SALVAGED: the model's reply held reasoning but no answer; these findings come from a follow-up request asking it to conclude from what it had already worked out, not from its ordinary findings-first pass — treat as less reliable than an ordinary review");
  // Read from the entry, never inferred from the outcome name: an entry whose
  // outcome was overridden — a substituted model whose analysis was also cut —
  // carries the fact only as a field.
  if (entry.analysisCut) notes.push('the analysis was cut off before the model finished looking, so this is not a complete review of the commit');
  if (entry.atCap) notes.push('the findings list hit the reporting cap, so it is not the whole of what was found');
  if (entry.dropped) notes.push(`${safeInline(entry.dropped) || 'an unknown number of'} finding(s) the model emitted were discarded as unusable (they named no file or no defect)`);
  // State, not cause — `--diff-only` reaches this too. The cause is the next
  // line, and it is separate so that neither has to guess at the other.
  if (entry.hunksOnly) notes.push('the diff-covered changed files were reviewed only as hunks, not whole; files covered by no diff — untracked, or given with --file — may still have been sent whole');
  if (entry.skippedUnsizedWindow) notes.push('the provider\'s context window could not be determined, so the whole-file rung was skipped rather than sent unmeasured — set "contextLength" for the provider to enable it');
  if (entry.rawTruncated) notes.push('the raw reply was truncated in the machine record');
  if (entry.stderrTruncated) notes.push('the captured stderr was truncated in the machine record');
  if (entry.signal) notes.push(`the child was terminated by signal ${safeInline(entry.signal)}`);
  return notes;
}
