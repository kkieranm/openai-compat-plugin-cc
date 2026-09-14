// Salvage tier 3: a reply that finished its stream CLEANLY (a normal
// finish_reason, no cutoff) but left content empty after real reasoning.
// Distinct fixture shape from salvage.test.js/token-reserve-cutoff.test.js:
// those two both need the stream to be CUT (by --max-seconds or the live
// watchdog), so their fixtures stream forever until the client stops
// waiting. This one needs the stream to finish on its own, so the fixture
// closes it — reasoningFrames() already does exactly that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionFrames, reasoningFrames, respondJson, respondStream, reviewScenario, runCompanion } from './helpers.mjs';

/** Comfortably between SALVAGE_MIN_REASONING_CHARS (500) and the default
 * reviewScenario's watchdog cutoff (6144 chars at contextLength 8192), so
 * the live watchdog never arms ahead of this clean finish. */
const SUBSTANTIAL_REASONING = 'still reasoning about this commit in great detail. '.repeat(20); // 1020 chars

/** A server whose FIRST chat request streams substantial reasoning then
 * finishes cleanly with empty content; every later request gets
 * `onFollowUp(record, response)` instead — the salvage attempt. */
function reasoningOnlyThenFollowUp(reasoning, onFollowUp) {
  let requestCount = 0;
  return (record, response) => {
    if (!record.url.includes('/chat/completions')) {
      respondJson(response, { object: 'list', data: [{ id: 'test-model', object: 'model' }] });
      return;
    }
    requestCount += 1;
    if (requestCount > 1) {
      onFollowUp(record, response);
      return;
    }
    respondStream(response, reasoningFrames(reasoning));
  };
}

test('a reasoning-only clean finish is salvaged, tagged salvaged: true, at the small reserve', async () => {
  const handler = reasoningOnlyThenFollowUp(SUBSTANTIAL_REASONING, (record, response) => {
    respondStream(response, completionFrames(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from partial reasoning' }],
      summary: 'salvaged',
    })));
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);

    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.findings.length, 1);
    assert.equal(envelope.findings[0].summary, 'concluded from partial reasoning');

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 2, 'exactly one salvage attempt, on top of the original');
    // Pins the reserve fix: a reasoning-only follow-up gets the small,
    // fixed TOKEN_RESERVE_TOKENS reserve, not the full original built.reserve
    // (which, re-reserved on top of the reasoning appended back in, would
    // very likely overrun the context-budget check on a real large trace).
    assert.equal(chatRequests[1].body.max_tokens, 2048);
  } finally {
    await server.close();
  }
});

test('a salvage attempt that itself fails falls back to reporting reasoning-only plainly', async () => {
  const handler = reasoningOnlyThenFollowUp(SUBSTANTIAL_REASONING, (record, response) => {
    respondJson(response, { error: 'internal error' }, 500);
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);

    assert.equal(envelope.reason, 'reasoning-only');
    assert.equal(envelope.salvaged, undefined);
    // Tier 1's guarantee: the partial reasoning survives even when salvage fails.
    assert.ok(envelope.partial?.reasoning?.includes(SUBSTANTIAL_REASONING.trim().slice(0, 50)));
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 2);
  } finally {
    await server.close();
  }
});

test('a salvage follow-up that itself lands empty-handed falls back to the original tag, not a fresh untagged failure', async () => {
  // `chatCompletion` succeeding for the follow-up is not the same as the
  // follow-up ANSWERING — a model repeating its own reasoning-only quirk on
  // retry is the modal failure shape for this specific reason, since a
  // near-identical prompt is exactly what triggered it the first time.
  // Without the guard this reads as `salvaged: true` and fails much later
  // with a fresh, untagged error that `bench/lib/sweep-outcome.mjs`'s
  // `isOutage` misreads as a server outage.
  const handler = reasoningOnlyThenFollowUp(SUBSTANTIAL_REASONING, (record, response) => {
    respondStream(response, reasoningFrames(SUBSTANTIAL_REASONING));
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);

    assert.equal(envelope.reason, 'reasoning-only');
    assert.equal(envelope.salvaged, undefined);
    assert.ok(envelope.partial?.reasoning?.includes(SUBSTANTIAL_REASONING.trim().slice(0, 50)));
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 2);
  } finally {
    await server.close();
  }
});

test('reasoning below SALVAGE_MIN_REASONING_CHARS is not worth a follow-up request', async () => {
  const handler = (record, response) => {
    if (!record.url.includes('/chat/completions')) {
      respondJson(response, { object: 'list', data: [{ id: 'test-model', object: 'model' }] });
      return;
    }
    respondStream(response, reasoningFrames('reasoned but never answered')); // 28 chars, well under 500
  };
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'reasoning-only');
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1, 'no follow-up attempted at all');
  } finally {
    await server.close();
  }
});
