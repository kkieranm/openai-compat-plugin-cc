// The observed reasoning-state classifier: one number off a reply's usage becomes
// a `{ state, tokens }` witness. Pins the three-state boundary (a 0 is NOT
// observed) and the never-throw contract its persistence-path callers rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasoningWitness } from '../scripts/lib/reasoning-witness.mjs';

const usage = (reasoning_tokens) => ({
  prompt_tokens: 100,
  completion_tokens: 200,
  completion_tokens_details: { reasoning_tokens },
});

test('a positive count reads as reasoning-observed, carrying the count', () => {
  assert.deepEqual(reasoningWitness(usage(5998)), { state: 'reasoning-observed', tokens: 5998 });
});

test('an explicit zero reads as no-reasoning-observed, not off, carrying 0', () => {
  assert.deepEqual(reasoningWitness(usage(0)), { state: 'no-reasoning-observed', tokens: 0 });
});

test('a missing completion_tokens_details reads as unknown', () => {
  assert.deepEqual(
    reasoningWitness({ prompt_tokens: 100, completion_tokens: 200 }),
    { state: 'unknown', tokens: null },
  );
});

test('a present details object with no reasoning_tokens reads as unknown', () => {
  assert.deepEqual(
    reasoningWitness({ completion_tokens_details: {} }),
    { state: 'unknown', tokens: null },
  );
});

test('a non-numeric reasoning_tokens reads as unknown', () => {
  assert.deepEqual(reasoningWitness(usage('12')), { state: 'unknown', tokens: null });
  assert.deepEqual(reasoningWitness(usage(NaN)), { state: 'unknown', tokens: null });
  assert.deepEqual(reasoningWitness(usage(Infinity)), { state: 'unknown', tokens: null });
});

test('a negative count is a nonsensical value and reads as unknown', () => {
  assert.deepEqual(reasoningWitness(usage(-1)), { state: 'unknown', tokens: null });
});

test('a null or undefined usage reads as unknown, never throws', () => {
  assert.deepEqual(reasoningWitness(null), { state: 'unknown', tokens: null });
  assert.deepEqual(reasoningWitness(undefined), { state: 'unknown', tokens: null });
});

test('a throwing getter on the traversal is swallowed to unknown, never propagated', () => {
  const hostileInner = {
    get reasoning_tokens() {
      throw new Error('hostile getter must not escape the witness');
    },
  };
  const hostileUsage = { completion_tokens_details: hostileInner };
  assert.doesNotThrow(() => reasoningWitness(hostileUsage));
  assert.deepEqual(reasoningWitness(hostileUsage), { state: 'unknown', tokens: null });

  const hostileOuter = {
    get completion_tokens_details() {
      throw new Error('hostile getter must not escape the witness');
    },
  };
  assert.doesNotThrow(() => reasoningWitness(hostileOuter));
  assert.deepEqual(reasoningWitness(hostileOuter), { state: 'unknown', tokens: null });
});

test('a hostile valueOf/toString on reasoning_tokens does not throw and reads as unknown', () => {
  const hostile = { valueOf() { throw new Error('no'); }, toString() { throw new Error('no'); } };
  assert.doesNotThrow(() => reasoningWitness(usage(hostile)));
  assert.deepEqual(reasoningWitness(usage(hostile)), { state: 'unknown', tokens: null });
});
