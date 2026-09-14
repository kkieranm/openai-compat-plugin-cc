import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chatRequests,
  scriptOf,
  reviewScenario,
  completionFrames,
  deltaFrame,
  modelList,
  respondJson,
  respondStream,
  runCompanion,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';

// LM Studio can silently drop long requests without retrying, so a dropped
// request gets reported as a bad answer and the benchmark can't produce a
// number. These pin the shapes that are retried, the ones that must not be,
// and the record that separates the two.

/**
 * A server that plays `scripts` in order, one per **chat** request.
 *
 * Only `/chat/completions` advances the script. `model-info.mjs` probes
 * `/props`, `/info` and `/v1/models/status` by response shape before any chat
 * happens, and an earlier version of this helper fed those to the script — so
 * the first real request already received the third entry and every assertion
 * here was measuring the probe sequence.
 */
async function scriptedServer(scripts) {
  let call = 0;
  const server = await startFakeServer((request, response) => {
    if (request.url.includes('/chat/completions')) {
      const script = scripts[Math.min(call, scripts.length - 1)];
      call += 1;
      return script(response, request);
    }
    if (request.url.endsWith('/models')) return respondJson(response, modelList('test-model'));
    // Everything else is a capability probe; a plain OpenAI server has none of
    // them, and 404 is what makes the shape detection conclude that.
    return respondJson(response, { error: 'not found' }, 404);
  });
  // `retrySeconds: 0` — the pause is real behaviour and worth having, but paying
  // it here would add seconds of pure sleep to the suite for every retry case.
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, retrySeconds: 0 } },
  });
  return { server, configPath: path };
}

/** A completion whose channels are present and both exactly empty — shape 4. */
const blank = (response) =>
  respondStream(response, [
    deltaFrame({ role: 'assistant', content: '' }),
    { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]);

/** A completion with no message channel at all — shape 1. */
const noMessage = (response) =>
  respondStream(response, [
    deltaFrame({}),
    { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]);

const answers = (response) => respondStream(response, completionFrames('All good.'));

/** A schema-shaped review reply, for the `--json` record assertions below. */
const FINDINGS = JSON.stringify({
  analysis: 'read each changed file in full',
  findings: [{ file: 'seed.txt', line: 2, severity: 'high', summary: 'a defect', evidence: 'edited' }],
  summary: 'One defect found.',
});

test('a dropped request is sent again, and the retry answers', async () => {
  const { server, configPath } = await scriptedServer([blank, answers]);
  const result = await runCompanion(['task', 'explain this'], { configPath });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All good\./);
  assert.equal(chatRequests(server).length, 2, 'the failed request was re-sent');
});

/**
 * Text, then the stream stops with no terminator and no finish_reason — shape 2.
 *
 * This is the shape the *observed* incidents most likely landed on: the
 * 2026-07-30 arms recorded stream drops around 50,000 characters into reasoning.
 * Worth pinning explicitly rather than assuming, because if a real drop lands on
 * the transport shape instead, `stream-unfinished` is a branch the taxonomy
 * claims and nothing ever reaches.
 */
const cutShort = (response) =>
  respondStream(response, [deltaFrame({ role: 'assistant', content: 'thinking' })], { done: false });

test('a stream that stops without finishing is a delivery failure, not a short answer', async () => {
  const { server, configPath } = await scriptedServer([cutShort, answers]);
  const result = await runCompanion(['task', 'explain this'], { configPath });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All good\./);
  assert.equal(chatRequests(server).length, 2, 'a truncated stream must be re-sent, not reported as the answer');
});

test('every delivery shape is retried, not just the one that was easiest to spot', async () => {
  for (const shape of [blank, noMessage, cutShort]) {
    const { server, configPath } = await scriptedServer([shape, answers]);
    const result = await runCompanion(['task', 'explain this'], { configPath });
    await server.close();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(chatRequests(server).length, 2);
  }
});

test('--max-attempts 1 reproduces the behaviour that existed before retry — the control arm', async () => {
  // The whole point of exposing the flag: without a control arm the benchmark
  // can measure the retried failure rate and nothing else, so it could never
  // say what retry was worth.
  const { server, configPath } = await scriptedServer([blank, answers]);
  const result = await runCompanion(['task', '--max-attempts 1 explain this'], { configPath });
  await server.close();

  assert.equal(result.status, 1);
  assert.equal(chatRequests(server).length, 1, 'no retry was permitted');
});

test('attempts are bounded — a server that never recovers is not retried forever', async () => {
  const { server, configPath } = await scriptedServer([blank]);
  const result = await runCompanion(['task', '--max-attempts 2 explain this'], { configPath });
  await server.close();

  assert.equal(result.status, 1);
  assert.equal(chatRequests(server).length, 2);
});

test('a refusal is not a dropped request, so it is not retried', async () => {
  // The predicate is a whitelist of delivery shapes. A 400 means the request was
  // wrong and will be wrong again; sending it twice more spends the cap and
  // reports the same error later than it could have.
  const { server, configPath } = await scriptedServer([
    (response) => respondJson(response, { error: { message: 'bad request' } }, 400),
  ]);
  const result = await runCompanion(['task', 'explain this'], { configPath });
  await server.close();

  assert.equal(result.status, 1);
  assert.equal(chatRequests(server).length, 1, 'a refusal must not be re-sent');
});

test('a capability already negotiated away is not offered again on a retry', async () => {
  // The sequence that made this necessary: the server refuses stream_options,
  // the degraded request streams and is then dropped, and an answer retry
  // starting from the original body knowingly re-sends the field the server
  // already rejected. One wasted round trip per retry, blaming a capability
  // settled two requests ago.
  const { server, configPath } = await scriptedServer([
    (response) => respondJson(response, { error: { message: 'stream_options is not supported' } }, 400),
    blank,
    answers,
  ]);
  const result = await runCompanion(['task', 'explain this'], { configPath });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const sent = chatRequests(server);
  assert.equal(sent.length, 3);
  assert.ok(sent[0].body.stream_options, 'the first request offered it');
  assert.ok(!sent[2].body.stream_options, 'the retry must resume from the negotiated payload, not the original');
});

/**
 * The attempt record, end to end through the real command.
 *
 * The counts above prove retry *happens*; these prove the deliverable a
 * caller actually needs — a record that separates the run that was scored
 * from the requests the server dropped. Without these the deliverable is untested and only its side
 * effect is covered.
 */
test('--json carries one entry per physical request, with the failure classified', async () => {
  const { dir, server, configPath } = await reviewScenario(
    scriptOf([blank, (response) => respondStream(response, completionFrames(FINDINGS))]),
    { contextLength: 131_072 },
  );
  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.attempts.length, 2, 'one entry per request that went on the wire');

  const [first, second] = report.attempts;
  assert.equal(first.outcome, 'failed');
  assert.equal(first.reason, 'blank-completion', 'a code, never prose');
  assert.equal(second.outcome, 'answered');

  // The retry re-sent the prompt byte-for-byte, so the server COULD have served
  // its prefill from cache. Computed from the serialized messages, not from
  // "this is attempt 2" — the response_format fallback is also a later attempt
  // and rewrites the prompt, so an index-based answer would be wrong there.
  assert.equal(second.warmEligible, true);
  assert.equal(first.warmEligible, false);

  // Scoring reads the attempt that answered; reliability reads them all.
  assert.equal(report.prefillMs, second.prefillMs);
  assert.equal(report.generationMs, second.generationMs);
  assert.equal(report.retried, true);
});

test('a run whose every attempt died still carries its attempts — the error path keeps the evidence', async () => {
  const { dir, server, configPath } = await reviewScenario(scriptOf([blank]), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--json', '--max-attempts=2'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.error, true);
  assert.equal(envelope.reason, 'blank-completion');
  // The run with the most to say about the server is the one whose record is
  // easiest to lose, because nobody looks for a record on the failure path.
  assert.equal(envelope.attempts.length, 2);
  assert.ok(envelope.attempts.every((attempt) => attempt.outcome === 'failed'));
});
