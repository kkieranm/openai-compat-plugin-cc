// Getting JSON back out of text that was not promised to be JSON.
//
// Split out of `tests/structured.test.js` alongside the module itself, and for
// the same reason: what a reply MEANS is `structured.mjs`'s question, while
// finding the JSON inside it is this one's. These three cases predate the split
// and are unchanged by it — they are what proves the move was behaviour-
// preserving rather than merely green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../scripts/lib/json-scan.mjs';

test('JSON is found bare, fenced, or wrapped in prose', () => {
  assert.equal(extractJson('{"a":1}').a, 1);
  assert.equal(extractJson('```json\n{"a":2}\n```').a, 2);
  assert.equal(extractJson('Here you go:\n{"a":3}\nHope that helps.').a, 3);
  assert.equal(extractJson('no json here'), null);
});

test('a brace inside a string does not end the object early', () => {
  const parsed = extractJson('preamble {"summary":"the } case","findings":[]} trailer');
  assert.equal(parsed.summary, 'the } case');
  assert.deepEqual(parsed.findings, []);
});

test('JSON is found after prose that contains braces of its own', () => {
  // The system prompt orders the model to quote the offending source line, so a
  // degraded reply routinely opens with code. Anchoring on the first `{` made a
  // quoted `if (…) { … }` swallow the anchor and threw away good findings.
  const reply =
    'Looking at the code, the guard reads:\n\nif (!contextLength) { return DEFAULT; }\n\nwhich is wrong.\n\n' +
    '{"analysis":"a","findings":[],"summary":"one defect"}';
  assert.equal(extractJson(reply)?.summary, 'one defect');
});

test('a reply of many unmatched brackets does not cost O(n^2)', () => {
  // scanFor used to restart a fresh scan from every candidate opener, so a run
  // of unmatched brackets re-scanned the same trailing suffix once per opener.
  // 200KB of bare '[' measured ~36s before the single-pass rewrite; a generous
  // 1s bound catches a regression back to the restart approach without being a
  // flaky tight timing assertion.
  const big = '['.repeat(200000);
  const started = Date.now();
  const result = extractJson(big);
  assert.ok(Date.now() - started < 1000, 'extractJson took too long on a large unmatched-bracket run');
  assert.equal(result, null);
});

test('nested brackets are found in opening-position order, not closing order', () => {
  // A stack alone emits a closed pair when its CLOSE is seen, which is
  // innermost-first for nested brackets — the opposite of what the old
  // restart-based scan produced and what a stateful `accept` (a caller that
  // remembers what it has already seen) can depend on. The rewrite must
  // re-order by opening position before calling `accept`.
  const seen = [];
  const accept = (value) => {
    seen.push(value);
    return false; // never actually accepted; this test only cares about call order
  };
  extractJson('prose before [[1],2]', accept);
  const arrayCalls = seen.filter(Array.isArray).map((v) => JSON.stringify(v));
  assert.deepEqual(arrayCalls, ['[[1],2]', '[1]'], 'the outer array must be evaluated before the inner one');
});

test('content fully inside a quote is no longer its own candidate — closed quote', () => {
  // Deliberate, pinned behavior change (not a regression): the old restart scan
  // entered every candidate opener with quote-tracking reset to false, so a
  // bracket-balanced run sitting entirely inside a CLOSED quoted string was
  // scanned as if it were bare JSON. Continuous string tracking now correctly
  // treats it as string content throughout and never candidates it.
  assert.equal(extractJson('prefix "quoted [1,2]" suffix'), null);
});

test('content fully inside a quote is no longer its own candidate — unclosed quote', () => {
  // Same underlying mechanism as the closed-quote case above, for a quote that
  // never closes — and the blast radius is wider than "the content inside the
  // quote": ONE unbalanced `"` flips string-tracking for the ENTIRE REMAINDER
  // of the text, not merely for whatever appears to follow it. A real,
  // recoverable payload arriving much later — not itself inside anything that
  // looks like a quoted string — is lost the same way. Plausible, not
  // hypothetical: a quoted source line with an odd `"` count (this repo's own
  // review prompt orders quoting one) is exactly this shape. The old restart
  // scan could land a later opener with a false "not in a string" reset and
  // recover such a payload; nothing here ever promised that recovery. This
  // returns the same `null` as "no candidate at all" — structured.mjs's
  // caller then treats it as NO_PAYLOAD (try the next channel), not as its
  // own UNREADABLE (this channel answered but the answer was unusable) —
  // this module knows nothing of that distinction, only that it found
  // nothing here to accept over an accidental find.
  assert.equal(extractJson('unfinished explanation "\n{"a":1}'), null);
});

test('an escaped quote does not end a string early', () => {
  // Continuous string tracking promoted `escaped` from per-restart scratch
  // state to load-bearing for the whole pass. A fixture with escaped quotes on
  // either side but NO bracket between them cannot catch a broken `escaped`
  // flag — the string closes and reopens in the same place either way, and the
  // gap survives "fixed" (this repo's own lesson: a control must reach the
  // code it controls). The close-bracket of the scanned type has to sit
  // BETWEEN the two escaped quotes, so a broken escaped-quote handler ends the
  // string one character early and the object's own closing `}` — now read as
  // plain string content — is never found as a candidate.
  const reply = 'prose {"summary":"the line is \\"}\\" here","findings":[]} after';
  const parsed = extractJson(reply);
  assert.deepEqual(parsed, { summary: 'the line is "}" here', findings: [] });
});
