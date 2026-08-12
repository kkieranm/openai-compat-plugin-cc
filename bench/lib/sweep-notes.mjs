// Every reason one entry's review is less than it appears, as sentences.
//
// Extracted from `sweep-report.mjs` at the size ratchet when OAI-139 added a
// second cause behind `hunksOnly`. The seam is real: three renderers already
// called this — the findings list, a coverage row and the reviewed-nothing
// section — so it was the report's only shared vocabulary rather than a helper
// belonging to any one of them, and it is the piece that grows every time the
// CLI learns to report a new way of coming up short.

/**
 * The caveats that ride along with a review that DID complete.
 *
 * `atCap` and `dropped` do not stop a review counting — findings were produced —
 * but both mean the list is shorter than what the model had to say, and a reader
 * comparing two commits' counts needs to know which.
 */
export function incompleteness(entry) {
  const notes = [];
  // Read from the entry, never inferred from the outcome name. `analysisCut`
  // used to reach the artifact only by surviving as the `truncated` verdict, so
  // an entry whose outcome was overridden — a substituted model whose analysis
  // was ALSO cut — lost the fact entirely.
  if (entry.analysisCut) notes.push('the analysis was cut off before the model finished looking, so this is not a complete review of the commit');
  if (entry.atCap) notes.push('the findings list hit the reporting cap, so it is not the whole of what was found');
  if (entry.dropped) notes.push(`${entry.dropped} finding(s) the model emitted were discarded as unusable (they named no file or no defect)`);
  // State, not cause — `--diff-only` reaches this too, so the wording this
  // replaced ("the changed files did not fit the window") was already false for
  // that flag before there was a second cause. The cause is the next line, and
  // it is separate so that neither has to guess at the other.
  if (entry.hunksOnly) notes.push('the diff-covered changed files were reviewed only as hunks, not whole; files covered by no diff — untracked, or given with --file — may still have been sent whole');
  if (entry.skippedUnsizedWindow) notes.push('the provider\'s context window could not be determined, so the whole-file rung was skipped rather than sent unmeasured — set "contextLength" for the provider to enable it');
  if (entry.rawTruncated) notes.push('the raw reply was truncated in the machine record');
  if (entry.stderrTruncated) notes.push('the captured stderr was truncated in the machine record');
  if (entry.signal) notes.push(`the child was terminated by signal ${entry.signal}`);
  return notes;
}
