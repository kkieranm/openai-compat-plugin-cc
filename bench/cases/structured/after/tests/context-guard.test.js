// The size estimate itself. Promoted to a test because the constant is load-
// bearing and invisible: a review confirmed that reverting CHARS_PER_TOKEN from
// 3.5 to 4 left every other test in the suite passing, so nothing would have
// noticed the guard going soft again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContextBudget, estimateTokens } from '../scripts/lib/context-guard.mjs';

test('the estimate assumes code density, not prose density', () => {
  // Measured live against LM Studio on two real diffs: 3.61 and 3.48
  // chars/token. At 4 the guard admitted input the server then rejected, which
  // is the one failure it exists to prevent (ADR 003).
  assert.equal(estimateTokens('x'.repeat(3400)), 1000);
  assert.ok(estimateTokens('x'.repeat(50_000)) >= 14_000, 'a 50 KB diff counted 13.9k tokens on the server');
});

test('the estimate never claims more room than the server gives', () => {
  // Erring high is safe (a needless refusal, loudly explained); erring low
  // sends a request the server rejects.
  const observed = [
    { chars: 50_022, serverTokens: 13_889 },
    { chars: 156_376, serverTokens: 44_997 },
  ];
  for (const { chars, serverTokens } of observed) {
    assert.ok(
      estimateTokens('x'.repeat(chars)) >= serverTokens,
      `${chars} chars measured ${serverTokens} tokens; the estimate must not fall below that`,
    );
  }
});

test('an input that fits is reported with what it used', () => {
  const budget = checkContextBudget({
    estimatedTokens: 100,
    contextLength: 8192,
    reserveTokens: 1024,
    providerName: 'local',
    model: 'm',
  });
  assert.equal(budget.checked, true);
  assert.match(budget.note, /100 of 7.2k usable tokens/);
});

test('an unknown window disarms the check rather than guessing', () => {
  const budget = checkContextBudget({ estimatedTokens: 100, contextLength: undefined, providerName: 'local', model: 'm' });
  assert.equal(budget.checked, false);
  assert.match(budget.note, /Context window unknown/);
});
