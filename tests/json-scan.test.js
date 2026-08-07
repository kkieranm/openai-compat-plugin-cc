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
