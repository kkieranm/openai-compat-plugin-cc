// Getting JSON back out of text that was not promised to be JSON.
//
// Split out of `structured.mjs` when a repair pushed that file past this repo's
// size budget — the moment the repo's own rule says to extract rather than raise
// the ceiling. The seam is not arbitrary: `structured.mjs` opens by calling
// itself "the one module that encodes structured-output dialect", and scanning
// prose for a balanced object is not dialect. Nothing here knows what a finding
// is, what a schema is, or which channel a reply arrived on.

const FENCE = /```(?:json)?\s*\n([\s\S]*?)```/;

/**
 * Find the balanced `open`…`close` run starting at or after `from`. String-aware,
 * so a bracket inside a quoted value (`"summary": "the } case"`) does not close
 * it early.
 */
function balanced(text, from, open, close) {
  const start = text.indexOf(open, from);
  if (start === -1) return null;
  // `start` is entered with `inString` false whatever the true document state,
  // because nothing here has read the text before `from`. An `open` living
  // inside a quoted string is therefore entered as if it were JSON, and the
  // string's CLOSING quote then turns quote-tracking ON for the remainder — so
  // this function reports failure on inputs that are not malformed at all. That
  // is why a failure below is one dead START POSITION and never a verdict about
  // the text; `scanFor` is what has to know the difference.

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return { json: text.slice(start, index + 1), start, end: index + 1 };
    }
  }
  // An opener that never balances. Distinct from "no opener left", and the two
  // were returned as the same `null` for four passes: `scanFor` read a dead
  // start position as exhaustion of the whole bracket type and stopped, so one
  // stray `[` in quoted source hid every real candidate after it.
  return { json: null, start };
}

/**
 * EVERY balanced `open`…`close` run in `text` that parses and is accepted, each
 * with the span it occupies.
 *
 * It used to return the first and stop, which is what made position a trap: the
 * first accepted candidate is routinely a quoted example and the real answer is
 * further down. Deciding between candidates needs all of them, and deciding
 * *correctly* needs their extents, not just their starts — see `extractJson`.
 */
function scanFor(text, open, close, accept) {
  const found = [];
  let from = 0;
  for (;;) {
    const run = balanced(text, from, open, close);
    if (!run) return found;
    if (run.json === null) {
      // One dead start position — skip past it and keep going. Deliberately its
      // OWN advance rather than a fall-through to the one below: folding them
      // into a single statement would leave two guards that one mutation
      // defeats together, which is this feature's most repeated defect.
      from = run.start + 1;
      continue;
    }
    try {
      const value = JSON.parse(run.json);
      if (accept(value)) found.push({ value, start: run.start, end: run.end });
    } catch {
      // Not it — an unparseable candidate is expected here.
    }
    // Resume past this candidate's opening bracket, so a nested or adjacent one
    // later in the reply still gets its turn.
    from = run.start + 1;
  }
}

/**
 * Parse JSON out of a reply that may be bare, fenced, or wrapped in prose.
 *
 * Every balanced object is tried, not just the first. The system prompt orders
 * the model to quote the offending source line, so a degraded reply routinely
 * opens with code — and anchoring on the first `{` meant a quoted `if (x) { … }`
 * swallowed the anchor and a perfectly good findings object was thrown away,
 * with the user told the *model* returned the wrong shape. That is this repo's
 * most-repeated defect class, reported against ourselves.
 *
 * The bare and fenced candidates are tried with `JSON.parse` whole, so a reply
 * that IS a top-level array survives this function intact. What that array then
 * means is the caller's question, not this one's.
 *
 * Arrays are scanned for as well as objects, and `accept` is how the two are
 * told apart WITHOUT this module learning what a finding is. A prose-wrapped
 * array used to be lost here — the scan anchored on `{`, so
 * `Here are the findings: [{…},{…}]` yielded the first ELEMENT, which has no
 * `findings` key, and a recoverable reply was reported unreadable.
 *
 * Scanning objects to exhaustion first does NOT fix that on its own, which is
 * worth stating because it is the obvious fix: the object scan does not find
 * nothing, it finds the array's first element — unless the caller's predicate
 * rejects that element, which for a findings payload it does.
 *
 * **Among OUTERMOST candidates, the LAST one wins.** Two earlier rules were
 * tried and both were wrong, and the way they were wrong is the point:
 *
 *   - *Earliest wins.* A quoted array of objects before the real payload beat
 *     it, and the reply came back clean or unreadable with real findings gone.
 *   - *An accepted object outranks an accepted array.* This looked safe and is
 *     not: it is unconditional on position, so a real BARE-ARRAY payload sitting
 *     FIRST loses to an unrelated findings-shaped object appearing later. It
 *     also only ever masked the predicate rather than helping it.
 *
 * Position is the right signal, pointing the other way. The reply is a review,
 * and its prompt orders the model to quote the offending source line — so
 * bracketed prose comes BEFORE the answer, and the answer is last. **That is a
 * judgement about how models reply, not a measurement**; the corpus cannot check
 * it, because a decoy that wins still parses and is recorded as a clean run. Its
 * symmetric failure is a reply that trails commentary containing JSON after the
 * payload, judged rarer than leading quoted source. See ADR 003.
 *
 * `outermost` is what makes "last" safe, and without it last-wins is broken:
 * every accepted `{findings: […]}` wrapper CONTAINS an accepted array — its own
 * `findings` value — which starts later. Taking the last candidate globally
 * would therefore return a wrapper's own array, losing `analysis` and `summary`,
 * and under a schema the reconstructed value would then fail conformance. So a
 * candidate contained by another accepted candidate is a PART of it, not a
 * competitor, and only the survivors are ranked.
 *
 * Containment is structural, so none of this teaches the module what a finding
 * is. `whole` is passed to `accept` for the same reason — only this function
 * knows whether a candidate was the entire reply or was dug out of prose, and
 * only the caller knows what to do with that.
 */
export function extractJson(text, accept = () => true) {
  const trimmed = text.trim();
  const fenced = trimmed.match(FENCE);
  // A fence counts as the whole reply only when it IS the whole reply. Matching
  // one anywhere let a model fence a quoted fixture mid-prose and have it
  // accepted under the generous whole-reply rule, skipping both the scanned
  // predicate and the ranking below — so a fenced `[]` before real findings
  // reported a clean review.
  const whole = [trimmed, fenced?.[0] === trimmed ? fenced[1] : null];
  for (const candidate of whole) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate);
      if (accept(value, true)) return value;
    } catch {
      // Try the next shape; an unparseable candidate is expected here.
    }
  }

  const scan = (open, close) => scanFor(text, open, close, (value) => accept(value, false));
  const candidates = [...scan('{', '}'), ...scan('[', ']')];
  const outermost = candidates.filter(
    (one) => !candidates.some((other) => other !== one && other.start <= one.start && other.end >= one.end),
  );
  if (!outermost.length) return null;
  return outermost.reduce((last, one) => (one.start > last.start ? one : last)).value;
}
