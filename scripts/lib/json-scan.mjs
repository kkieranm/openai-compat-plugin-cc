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
      if (depth === 0) return { json: text.slice(start, index + 1), start };
    }
  }
  return null;
}

/**
 * The first balanced `open`…`close` run in `text` that parses AND is accepted,
 * with where it started — so two scans can be compared by position.
 */
function scanFor(text, open, close, accept) {
  let from = 0;
  for (;;) {
    const found = balanced(text, from, open, close);
    if (!found) return null;
    try {
      const value = JSON.parse(found.json);
      if (accept(value)) return { value, start: found.start };
    } catch {
      // Not it — an unparseable candidate is expected here.
    }
    // Resume past this candidate's opening bracket, so a nested or adjacent one
    // later in the reply still gets its turn.
    from = found.start + 1;
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
 * Scanning objects to exhaustion first does NOT fix that, which is worth stating
 * because it is the obvious fix and it fails: the object scan does not find
 * nothing, it finds the array's first element. Nor does "earliest candidate
 * wins" — a quoted source line is the shape this function exists for, and
 * `["alpha","beta"]` inside one is a perfectly good JSON array sitting before
 * the real payload.
 *
 * So the caller supplies `accept`, both openers are scanned, and the accepted
 * candidate that starts EARLIER wins. Quoted brackets are rejected by the
 * caller's predicate and the scan moves on; a prose-wrapped array is accepted
 * and outranks the element object inside it, which starts one character later.
 * Nothing here knows why a value is acceptable.
 */
export function extractJson(text, accept = () => true) {
  for (const candidate of [text.trim(), text.match(FENCE)?.[1]]) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate);
      if (accept(value)) return value;
    } catch {
      // Try the next shape; an unparseable candidate is expected here.
    }
  }

  const found = [scanFor(text, '{', '}', accept), scanFor(text, '[', ']', accept)].filter(Boolean);
  if (!found.length) return null;
  return found.reduce((earliest, one) => (one.start < earliest.start ? one : earliest)).value;
}
