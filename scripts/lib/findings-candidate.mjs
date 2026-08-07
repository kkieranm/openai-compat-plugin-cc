// Which JSON value in a reply is the findings payload — and which is a quoted
// example that merely looks like one.
//
// Split out of `structured.mjs` when the fix for a candidate-selection defect
// pushed that file past this repo's size budget, which is the point its own rule
// says to extract rather than raise the ceiling. The seam holds: `structured.mjs`
// is structured-output dialect — schemas, channels, `response_format` — and
// deciding which of several bracketed runs in a model's prose is the answer is
// not dialect. `json-scan.mjs` sits on the other side and knows nothing about
// findings at all; this module is the one place that knows both.

/**
 * The two spellings this module reads as findings, and nothing else.
 *
 * `whole` says the candidate WAS the entire reply (bare or fenced), rather than
 * something the scanner dug out of prose. It is the whole difference between a
 * generous rule and a strict one, and it has to be a parameter because only the
 * scanner knows which happened.
 *
 * A candidate that is the whole reply competes with nothing, so a bare array of
 * objects is accepted there — empty included, an empty findings list being a
 * clean review.
 *
 * A SCANNED bare array is held to more, because the review system prompt orders
 * the model to quote the offending source line and a quoted fixture or config
 * array is therefore an ordinary thing to find sitting before the real payload.
 * Three ways that went wrong, all reproduced against this code:
 *
 *   - `["alpha", "beta"]` — rejected already, elements are not objects.
 *   - `const names = [];` — accepted vacuously, won on position, and the reply
 *     came back as a CLEAN REVIEW with the real findings discarded.
 *   - `const rules = [{"id":1}]` — accepted, every element dropped for naming no
 *     file and no defect, and the all-dropped rule then reported the whole reply
 *     unreadable while the real payload sat intact further down.
 *
 * So a scanned list must be non-empty and at least one element must look like a
 * finding. That is a weaker test than `normalizeFinding` on purpose: this decides
 * which candidate to READ, and normalization still decides what survives.
 *
 * **`some`, never `every`, and the same rule on BOTH spellings.** Both halves of
 * that sentence were learned the hard way and neither is safe to "tidy":
 *
 *   - `every` broke the guarantee that a bare array is the SAME REPLY as
 *     `{findings: […]}`. A mixed `[valid, {evidence:"…"}]` was rejected whole
 *     when wrapped in prose, while the identical payload as a whole reply or as
 *     an object kept the valid finding and counted the other as dropped. A
 *     future edit back to `every` reopens exactly that.
 *   - Applying the rule to arrays only left the object branch lenient, and since
 *     the scanner tried objects first, the lenient branch decided everything. A
 *     quoted `{"findings": []}` example was accepted vacuously and the review was
 *     reported CLEAN — the same false-clean the array branch had just been fixed
 *     for, through the spelling the fix never touched.
 *
 * A decoy that survives `some(named)` is not this function's problem: it is
 * handled by POSITION, in `extractJson`, which takes the last outermost
 * candidate. Content and position each cover what the other cannot, and trying
 * to make this predicate cover both is what produced the two defects above.
 */
export function findingsShaped(value, whole = false) {
  const objects = (list) => list.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  // Non-empty, not merely present. `file: ""` is a string, so a decoy carrying
  // empty keys passed selection, won, normalized to nothing, and took the real
  // payload down with it through the all-dropped rule.
  const named = (item) => Boolean(item.file?.trim?.() || item.summary?.trim?.());
  const usable = (list) => objects(list) && (whole || (list.length > 0 && list.some(named)));
  if (Array.isArray(value)) return usable(value);
  if (!value || typeof value !== 'object' || !Array.isArray(value.findings)) return false;
  return usable(value.findings);
}
