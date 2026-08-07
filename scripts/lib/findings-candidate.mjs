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
 * So a scanned array must be non-empty AND every element must look like a
 * finding. That is a weaker test than `normalizeFinding` on purpose: this decides
 * which candidate to READ, and normalization still decides what survives.
 *
 * What this does NOT catch, stated because it is a real limit and not an
 * oversight: a complete `{findings: […]}` wrapper quoted as an example ahead of
 * the real one wins, both being objects and position deciding within a scan. No
 * positional rule separates a schema-shaped example from a schema-shaped answer,
 * and under a schema `matchesSchema` cannot either, since both conform. It
 * behaves identically in the version before any of this — see ADR 003.
 */
export function findingsShaped(value, whole = false) {
  const objects = (list) => list.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  const named = (item) => typeof item.file === 'string' || typeof item.summary === 'string';
  if (Array.isArray(value)) {
    if (!objects(value)) return false;
    return whole || (value.length > 0 && value.every(named));
  }
  // The wrapped spelling's items were never checked at all, so a sample
  // `{"findings": ["hello","world"]}` quoted ahead of the real payload won on
  // position. The `findings` key is strong evidence on its own, so requiring
  // objects is enough here — it need not also require they be named.
  if (!value || typeof value !== 'object' || !Array.isArray(value.findings)) return false;
  return objects(value.findings);
}
