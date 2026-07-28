// Sizing the review reply. The cap on `analysis` is derived per run from the
// reply budget actually granted, so these are tests about arithmetic and about
// what the code is allowed to *claim* — the second mattering as much as the
// first, since the defect this replaces was a constant that silently disagreed
// with the budget beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisCapFor,
  ANALYSIS_CEILING,
  ANALYSIS_FLOOR,
  MIN_REVIEW_RESERVE_TOKENS,
  RESERVED_CHARS,
  reviewSchemaFor,
  REVIEW_SCHEMA,
} from '../scripts/lib/review-schema.mjs';
import { CHARS_PER_TOKEN } from '../scripts/lib/context-guard.mjs';
import { REVIEW_MIN_TOKENS } from '../scripts/lib/cmd-review.mjs';
import { parseFindings } from '../scripts/lib/structured.mjs';

const payload = (analysis) => JSON.stringify({ analysis, findings: [], summary: 'none' });

test('the cap follows the reserve, which is the whole point of deriving it', () => {
  // A 47k-token diff on a 58k window leaves ~11k for the reply; a 1.6k-token one
  // leaves the lot. The old flat 28,000 was handed to both.
  const tight = analysisCapFor(11_043);
  const roomy = analysisCapFor(29_056);
  assert.ok(tight < roomy, `expected the tight reserve to buy less room: ${tight} vs ${roomy}`);
  assert.equal(tight, Math.floor(11_043 * CHARS_PER_TOKEN) - RESERVED_CHARS);
});

test('the ceiling is wall clock and binds before the window does', () => {
  // Past this a review stops being worth waiting for — ~28 minutes of generation
  // on a dense 27B — however much window is spare.
  assert.equal(analysisCapFor(1_000_000), ANALYSIS_CEILING);
  assert.equal(REVIEW_SCHEMA.properties.analysis.maxLength, ANALYSIS_CEILING, 'the widest schema is the ceiling');
});

test('the floor holds when the reserve cannot pay for the allowance', () => {
  assert.equal(analysisCapFor(1), ANALYSIS_FLOOR);
  assert.equal(analysisCapFor(0), ANALYSIS_FLOOR);
});

test('the minimum reserve is the one that can carry the floor plus the allowance', () => {
  // Not a bound on the reply — see RESERVED_CHARS, which is explicitly an
  // estimate — but the point below which the request would advertise room the
  // budget cannot pay for even in principle.
  assert.ok(MIN_REVIEW_RESERVE_TOKENS * CHARS_PER_TOKEN >= ANALYSIS_FLOOR + RESERVED_CHARS);
  assert.equal(analysisCapFor(MIN_REVIEW_RESERVE_TOKENS), ANALYSIS_FLOOR);
});

test('a real review can never be handed the bare floor, however large its input', () => {
  // The reserve shrinks as the input grows, so without this the biggest diffs
  // would draw the least reasoning — and a review at the floor still returns
  // valid JSON, so it would degrade quietly instead of failing. What prevents it
  // is REVIEW_MIN_TOKENS sitting above MIN_REVIEW_RESERVE_TOKENS: the shrink
  // stops at the former. That relationship spans two modules and nothing else
  // would notice it inverting.
  assert.ok(
    REVIEW_MIN_TOKENS >= MIN_REVIEW_RESERVE_TOKENS,
    `the reply floor (${REVIEW_MIN_TOKENS}) must clear the schema's minimum (${MIN_REVIEW_RESERVE_TOKENS})`,
  );
  assert.ok(
    analysisCapFor(REVIEW_MIN_TOKENS) > ANALYSIS_FLOOR,
    'the smallest reserve a shrink can reach must still buy more than the backstop',
  );
});

test('every string and array in a derived schema still carries a ceiling', () => {
  // The same guard the constant schema had, now applied to what the factory
  // produces — a field added without a cap would otherwise pass unnoticed at
  // every reserve except the one the old test happened to check.
  for (const reserve of [MIN_REVIEW_RESERVE_TOKENS, 8_000, 16_384, 32_768, 200_000]) {
    const missing = [];
    const walk = (node, path) => {
      if (node.type === 'string' && !node.enum && node.maxLength === undefined) missing.push(path);
      if (node.type === 'array' && node.maxItems === undefined) missing.push(path);
      if (node.items) walk(node.items, `${path}[]`);
      for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.${key}`);
    };
    walk(reviewSchemaFor(reserve), `schema@${reserve}`);
    assert.deepEqual(missing, [], `uncapped fields at reserve ${reserve}`);
  }
});

test('a structured reply parsed without the schema that was sent is a hard error', () => {
  // The cap is per run, so a caller falling back to some other schema would
  // compare the reply against a number never sent and report `analysisCut:
  // false` for a guillotined run. Deleting the default is not enough on its own
  // — JavaScript would pass `undefined` straight through — so the omission is
  // raised rather than absorbed.
  assert.throws(
    () => parseFindings({ content: payload('short'), reasoning: '' }, { structured: true }),
    /needs the exact schema/,
  );
});

test('a cut is judged against the schema this run sent, not against a constant', () => {
  const small = reviewSchemaFor(MIN_REVIEW_RESERVE_TOKENS);
  const atSmallCap = payload('x'.repeat(small.properties.analysis.maxLength));

  assert.equal(
    parseFindings({ content: atSmallCap, reasoning: '' }, { structured: true, schema: small }).analysisCut,
    true,
  );
  // The identical reply, judged against a roomier run's schema, was not cut —
  // it stopped early. Reading it as cut is the failure mode a shared constant
  // would have produced silently.
  assert.equal(
    parseFindings({ content: atSmallCap, reasoning: '' }, { structured: true, schema: REVIEW_SCHEMA }).analysisCut,
    false,
  );
});

test('a degraded reply reports no cap, because no grammar enforced one', () => {
  // On that rung the schema is prose in the prompt. Reporting a ceiling would
  // name one that was never applied, and a reader comparing analysisLength
  // against it would be comparing against fiction.
  const parsed = parseFindings({ content: payload('reasoned freely'), reasoning: '' }, { structured: false });
  assert.equal(parsed.analysisCap, null);
  assert.equal(parsed.analysisCut, false);
  assert.equal(parsed.analysisLength, 'reasoned freely'.length, 'the length is still observable');
});
