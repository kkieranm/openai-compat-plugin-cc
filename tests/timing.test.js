// What a run spent waiting versus what it spent generating.
//
// These are one measurement split in two because a server-side prompt cache
// moves one half and not the other: the same 56,805-token prompt reached its
// first token in 421.7s cold and 11.5s warm, generating for ~3s in both. A
// single total welded them together, and the benchmark ranged `13–425` across
// three runs of one case and printed it as a result. See ADR 009.
//
// The delays below are what make these tests guards rather than restatements. A
// fake server answering instantly cannot tell a stamp taken at the first token
// from one taken when the request was sent — both read ~0 — so the boundary has
// to be pushed somewhere a wrong stamp cannot reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  completion,
  completionFrames,
  reasoningFrames,
  respondJson,
  respondStream,
  reviewScenario as scenario,
  runCompanion,
} from './helpers.mjs';

const PREFILL_MS = 220;
const GENERATION_MS = 180;

const reply = JSON.stringify({
  analysis: 'read each changed file in full',
  findings: [],
  summary: 'Nothing found.',
});

/**
 * A server that stalls before its first token, then again before its last.
 *
 * **Two delays, not one.** With only the first, a reply whose text and terminator
 * arrive together lets `prefillMs` and the total land in the same millisecond, so
 * `prefillMs < durationMs` would be flaky rather than false — it would pass a
 * stamp taken at the wrong end whenever the machine was quick. The second delay
 * puts real time on the far side of the boundary, so the two halves are
 * distinguishable by construction.
 *
 * Written out here rather than added to `respondStream`: the frames must reach
 * the client as separate writes with time between them, and a helper that took a
 * delay would invite being called with one delay and silently proving nothing.
 */
function stalledStream(frames) {
  return (request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    const [first, ...rest] = frames;
    setTimeout(() => {
      response.write(`data: ${JSON.stringify(first)}\n\n`);
      setTimeout(() => {
        for (const frame of rest) response.write(`data: ${JSON.stringify(frame)}\n\n`);
        response.write('data: [DONE]\n\n');
        response.end();
      }, GENERATION_MS);
    }, PREFILL_MS);
  };
}

test('prefill is measured from the first token, not from when the request was sent', async () => {
  // The first frame carries text, so it *is* the boundary — the opening
  // role-only frame that a real server sends is dropped here on purpose, so a
  // stamp taken on "any frame" rather than "a frame with text" is not what this
  // measures. That distinction has its own test below.
  const frames = reasoningFrames(reply).slice(1);
  const { dir, server, configPath } = await scenario(stalledStream(frames), { contextLength: 131_072 });

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0, result.stderr);
  // The lower bound is what a stamp at request time cannot satisfy: it would
  // report a prefill of roughly zero for a server that waited 220ms.
  assert.ok(
    report.prefillMs >= PREFILL_MS * 0.8,
    `prefill ${report.prefillMs}ms should be at least the ${PREFILL_MS}ms the server stalled`,
  );
  // And the upper bound is what a stamp at the *end* cannot satisfy: it would
  // swallow the generation stall too.
  assert.ok(
    report.prefillMs < report.durationMs,
    `prefill ${report.prefillMs}ms must be strictly inside the run's ${report.durationMs}ms`,
  );
  assert.ok(
    report.generationMs >= GENERATION_MS * 0.8,
    `generation ${report.generationMs}ms should cover the ${GENERATION_MS}ms after the first token`,
  );
});

test('a role-only frame is not the first token — it carries no text', async () => {
  // A real server opens with `{ role: 'assistant', content: null }`. Counting it
  // as the boundary would put the start of generation before the model had
  // produced anything, which is the whole quantity being separated out here.
  const [role, ...text] = reasoningFrames(reply);
  const handler = (request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    response.write(`data: ${JSON.stringify(role)}\n\n`);
    setTimeout(() => {
      for (const frame of text) response.write(`data: ${JSON.stringify(frame)}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
    }, PREFILL_MS);
  };
  const { dir, server, configPath } = await scenario(handler, { contextLength: 131_072 });

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.ok(
    report.prefillMs >= PREFILL_MS * 0.8,
    `the role frame arrived immediately; prefill ${report.prefillMs}ms must still span the ${PREFILL_MS}ms wait for text`,
  );
});

test('a non-streamed reply reports null, never a number nobody measured', async () => {
  // A server ignoring `stream: true` sends one whole document. There is no
  // boundary between waiting and generating to observe, so reporting the elapsed
  // time as either half would assert a server-side fact from no evidence — the
  // same reason `analysisCut` is null rather than false when nothing parsed.
  const { dir, server, configPath } = await scenario(
    (request, response) => respondJson(response, completion(reply)),
    { contextLength: 131_072 },
  );

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.prefillMs, null);
  assert.equal(report.generationMs, null);
  // And the footer says nothing rather than "prefill: 0.0s".
  assert.doesNotMatch(result.stdout, /prefill:/);
});

test('the text report carries prefill too, not just --json', async () => {
  // The rule this repo keeps re-learning: a fact that changes what the reader
  // should believe cannot live on one output path alone. A bare total invites
  // "the model is slow" for a run that spent 99% of it reading the prompt.
  const { dir, server, configPath } = await scenario(
    (request, response) => respondStream(response, completionFrames(reply)),
    { contextLength: 131_072 },
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /prefill: \d+\.\d+s/);
});

test('a run that took two requests says so, so an odd prefill can be explained', async () => {
  // The timings belong to the attempt that answered. A refused attempt is
  // rejected at request validation before generation, so it warms nothing — but
  // that is an observation about servers, not a guarantee, and a reader staring
  // at a suspiciously fast prefill has no other way to learn a retry happened.
  let seen = 0;
  const handler = (request, response) => {
    seen += 1;
    if (seen === 1) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'response_format is not supported' } }));
      return;
    }
    respondStream(response, completionFrames(reply));
  };
  const { dir, server, configPath } = await scenario(handler, { contextLength: 131_072 });

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(seen, 2, 'the degrade path is what this test is about');
  assert.equal(report.degraded, true);
  // And the timings are the second attempt's, not the whole ordeal's.
  assert.ok(report.prefillMs < report.durationMs);
});

test('an ordinary run is not marked degraded', async () => {
  const { dir, server, configPath } = await scenario(
    (request, response) => respondStream(response, reasoningFrames(reply)),
    { contextLength: 131_072 },
  );

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(JSON.parse(result.stdout).degraded, false);
});

test('a retry in the transport ladder counts too, not just the schema one', async () => {
  // The case the first version of this flag missed. A server that refuses
  // `stream_options` but accepts `stream` sends two requests and still streams,
  // so a measured prefill sits beside a retry — and deriving "did it retry" from
  // the schema outcome alone reported false for a run that tried twice, in the
  // field whose name promises otherwise.
  let seen = 0;
  const handler = (request, response) => {
    seen += 1;
    if (seen === 1) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'stream_options is not supported' } }));
      return;
    }
    respondStream(response, reasoningFrames(reply));
  };
  const { dir, server, configPath } = await scenario(handler, { contextLength: 131_072 });

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(seen, 2, 'the transport ladder is what this test is about');
  assert.equal(report.retried, true, 'two requests were sent, so the run retried');
  // And `degraded` stays false: the schema was never refused, so the reply was
  // parsed from the grammar as usual. Two facts, two fields — conflating them is
  // what produced the gap this test closes.
  assert.equal(report.degraded, false);
});
