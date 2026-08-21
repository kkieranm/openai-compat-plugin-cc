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
 * EVERY balanced `open`…`close` run OUTSIDE a quoted string in `text` that
 * parses and is accepted, each with the span it occupies — found in ONE linear
 * pass with a stack, not by restarting a fresh scan from every candidate
 * opener. A run sitting inside a quoted string is scanner-tracked as string
 * content, not JSON structure — see the quote-tracking note below.
 *
 * The restart approach used to cost O(n²) on a reply of many unmatched openers
 * (a 200KB run of bare `[` took ~36s): each restart scanned all the way to the
 * end of `text` before discovering the opener never closes, and the next
 * restart re-scanned the same trailing suffix again. A single pass with a
 * stack of open positions never re-reads a byte: a `close` pops the most
 * recently opened, still-unclosed `open` — exactly the LIFO pairing a
 * depth-counted restart from that opener would have found — and an opener
 * left unpopped at the end of the pass produces no candidate, same as an
 * opener a restart scan could never balance.
 *
 * String/escape tracking is now CONTINUOUS across the whole pass, not reset to
 * "not in a string" at every restart position the way the old per-opener scan
 * did. That reset was a documented, accepted inaccuracy (an `open` living
 * inside a quoted string used to be entered as if it were JSON) — continuous
 * tracking closes it, at a wider cost than "content inside a quote is no
 * longer its own candidate" suggests: ONE unbalanced `"` ANYWHERE in `text`
 * flips `inString` for the entire remainder of the pass, not just for the
 * span that quote appears to open. A reply that quotes a source line with an
 * odd count of `"` characters — plausible, not hypothetical, since this
 * repo's own review prompt orders exactly that — can blind the scan to a
 * genuine payload arriving much later, with nothing resembling a "quoted
 * string" around it. Nothing here recovers from it — this module returns
 * `null`, the same value it returns for "no candidate here at all", and
 * knows nothing about what the caller does with that; see `structured.mjs`
 * for what `null` means to the caller that actually reads it. See
 * `tests/json-scan.test.js` for the two pinned instances of that trade, and
 * its own broader framing of the mechanism.
 *
 * `accept` is evaluated in OPENING-POSITION order, matching the old restart
 * scan's order and preserving it for a caller with a stateful `accept` — a
 * stack alone would emit in CLOSING order (the innermost candidate first),
 * which is why open records are also appended to an ordered list and that
 * list, not the stack, drives evaluation once the pass completes.
 */
function scanFor(text, open, close, accept) {
  const opened = []; // every opener seen, in opening-position order; `end` filled in on its matching close
  const stack = []; // indices into `opened`, for LIFO matching only
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
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
    else if (character === open) {
      stack.push(opened.length);
      opened.push({ start: index, end: null });
    } else if (character === close && stack.length > 0) {
      opened[stack.pop()].end = index + 1;
    }
  }

  const found = [];
  for (const record of opened) {
    if (record.end === null) continue; // never closed — no candidate, same as an unbalanced restart scan
    try {
      const value = JSON.parse(text.slice(record.start, record.end));
      if (accept(value)) found.push({ value, start: record.start, end: record.end });
    } catch {
      // Not it — an unparseable candidate is expected here.
    }
  }
  return found;
}

/**
 * Parse JSON out of a reply that may be bare, fenced, or wrapped in prose.
 *
 * Every balanced object outside a quoted string is tried, not just the first. The system prompt orders
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
 * payload, judged rarer than leading quoted source.
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
