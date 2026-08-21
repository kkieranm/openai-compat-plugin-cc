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
 * **Read the three cases above as HISTORY, not as the live justification.** All
 * three decoy BEFORE the payload, and `extractJson` now ranks by last-outermost,
 * so position alone already defeats them — this rule no longer contributes
 * anything there. What it still buys is a decoy that TRAILS the payload and
 * contains NO genuinely named element — position argues for the decoy there,
 * and only content can refuse it. **This was never full coverage of every
 * trailing decoy, and still is not**: a trailing decoy containing at least one
 * genuinely named object — mixed with junk or not, one well-formed
 * `{"file":...,"summary":...}` on its own is enough — is admitted by `named`
 * exactly as a genuine reply would be, and then wins on position. Accepting a
 * real payload that happens to be mixed and refusing a decoy that happens to
 * be mixed are the same predicate; this file accepts both, and a fully
 * well-formed trailing decoy was never distinguishable from a real reply by
 * content alone, before or after this fix.
 *
 * That is worth stating because the rule looks redundant if you read only the
 * cases that motivated it, and deleting it costs a REAL behaviour: a genuine
 * prose-wrapped clean review `Here are the findings: {"findings":[]}` is
 * reported unreadable, because it is byte-identical to a quoted empty-findings
 * example. That is a deliberate choice between two failures, not an oversight —
 * `unreadable` is visible and retryable, while accepting it would let a trailing
 * quoted empty beat real findings and report a SILENT clean review. Note too
 * that an empty list is accepted only for a WHOLE reply, vacuously via
 * `every(record)` below, so relaxing that would promote every trailing bare
 * `[]`, not merely the wrapped spelling.
 *
 * **`some`, never `every`, AS THE SOLE GATE — `every` still appears below, but
 * only alongside a `some` it can never substitute for.** Learned the hard way
 * three times, and none of the three is safe to "tidy":
 *
 *   - `every` broke the guarantee that a bare array is the SAME REPLY as
 *     `{findings: […]}`. A mixed `[valid, {evidence:"…"}]` was rejected whole
 *     when wrapped in prose, while the identical payload as a whole reply or as
 *     an object kept the valid finding and counted the other as dropped. A
 *     future edit back to `every` ALONE on `named` reopens exactly that.
 *   - Applying the rule to arrays only left the object branch lenient, and since
 *     the scanner tried objects first, the lenient branch decided everything. A
 *     quoted `{"findings": []}` example was accepted vacuously and the review was
 *     reported CLEAN — the same false-clean the array branch had just been fixed
 *     for, through the spelling the fix never touched.
 *   - `record` — the predicate below that used to be called `objects` and used
 *     `every` as its SOLE gate — had the identical defect and nobody had fixed
 *     it: one non-object sibling, `[{"file":"a.js","summary":"real bug"},"junk"]`,
 *     vetoed a candidate that had a real finding in it, discarding the whole
 *     reply as no payload rather than keeping the finding and counting `"junk"`
 *     as dropped. `normalizeFinding` already tolerates a non-object entry safely
 *     — the break was candidate *selection* rejecting the list before
 *     normalization ever ran, the same shape as the `named` fix above, on the
 *     sibling predicate that history never touched. The fix was never "delete
 *     `every`" — `usable`'s whole-reply branch below still uses
 *     `list.every(record)`, deliberately, to preserve the legacy all-objects
 *     boundary (an all-object, none-named list still reads `UNREADABLE`, and an
 *     all-primitive list is still not a candidate at all). What changed is that
 *     `every(record)` is no longer the ONLY door in: `some(named)` is the second
 *     one, admitting a candidate the old sole `every`-gate would have vetoed.
 *
 * A decoy `named` REJECTS is not this function's problem: it is handled by
 * POSITION, in `extractJson`, which takes the last outermost candidate.
 * Content and position each cover what the other cannot for that case, and
 * trying to make this predicate cover both is what produced the two defects
 * above. **Known limit, not closed**: a trailing decoy `named` ACCEPTS —
 * because it contains at least one genuinely named object, whether or not
 * anything else in the list is junk — is covered by neither. Content admits
 * it, and position then picks it over an earlier real payload. Narrowing
 * `named` to refuse a mixed list would reopen the one-malformed-sibling-
 * discards-everything class this file exists to fix, and narrowing it to
 * refuse a well-formed single-object decoy is not possible at all: nothing
 * here can distinguish a one-finding real reply from a one-finding decoy by
 * content, and never could.
 */
export function findingsShaped(value, whole = false) {
  const record = (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
  // TWO decisions, and each has its own witness because one test cannot
  // discriminate both — `"" || ""` and `"" && ""` are alike false.
  //
  //   - Non-empty, not merely present. `file: ""` is a string, so a decoy
  //     carrying empty keys passed selection, won, normalized to nothing, and
  //     took the real payload down with it through the all-dropped rule.
  //   - AND, not OR, matching `normalizeFinding`'s minimum identity. Under OR a
  //     WRAPPER `{analysis, findings: [...], summary}` sitting inside an array
  //     was itself named — by its own `summary` — so the array was accepted,
  //     containment absorbed the wrapper as a part of it, and the real payload
  //     inside was lost.
  //
  // Known limit, not closed: an array element that IS a wrapper and ALSO
  // carries a non-empty `file` and `summary` still passes, and is then kept as
  // the finding in place of the payload it wraps. It needs a model to emit a
  // wrapper carrying finding keys, which no prompt here asks for.
  //
  // `record(item)` gates first, by short-circuit — `named` no longer assumes
  // every list element is already an object before it runs, which `usable`
  // (below) stopped guaranteeing once a non-object sibling became admissible.
  const named = (item) =>
    record(item) &&
    typeof item.file === 'string' &&
    Boolean(item.file.trim()) &&
    typeof item.summary === 'string' &&
    Boolean(item.summary.trim());
  // A whole reply is usable if EVERY element is a real object (the original
  // gate, vacuously true on `[]` — still a clean review) OR some element is a
  // genuinely named finding. `list.some(record)` alone was tried and is too
  // permissive: for `[{"findings":[valid]}, "junk"]`, the outer array is a
  // real-object-containing list, so it would win as the candidate at that
  // position, then normalize to nothing and report UNREADABLE — discarding a
  // valid finding that a REJECTED outer array would have let a later scan
  // recover from the wrapper nested inside it. `every(record)` preserves the
  // original "all objects, none named" path to `UNREADABLE` (`[{"id":1}]`) and
  // the original "no objects at all" path to not-a-candidate (`[1,2,3]`,
  // preserving the NO_PAYLOAD boundary); `some(named)` is the fix itself,
  // admitting a candidate the old `every`-based gate on `record` alone would
  // have vetoed for one non-object sibling. A scanned candidate needs
  // SOME named finding, exactly as before — `record` is folded into `named`
  // there rather than gated separately, so one non-object sibling can no
  // longer veto a scanned candidate that has a real finding beside it, and a
  // wrapper sitting among scanned siblings was never admissible this way to
  // begin with (a wrapper has no `file`/`summary` of its own to satisfy
  // `named`), so the scanned branch never had the whole-reply regression above.
  const usable = (list) => (whole ? list.every(record) || list.some(named) : list.some(named));
  if (Array.isArray(value)) return usable(value);
  if (!value || typeof value !== 'object' || !Array.isArray(value.findings)) return false;
  return usable(value.findings);
}
