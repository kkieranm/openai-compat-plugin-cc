// A server that refuses the reply budget and states the one it could take —
// vMLX's HTTP 413 `safe_cap=<N>` when `max_tokens` exceeds its projected memory
// headroom. `/oai:review` re-plans the whole request once at that budget;
// `/oai:task` does not retry, and names the budget instead — unless it already
// asked for no more than the stated cap, where naming it would be no remedy.
//
// The window is 61,696 tokens throughout, so a small review's first reserve is
// half of it: 30,848.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../plugins/oai/scripts/lib/attempt-ledger.mjs';
import { REVIEW_MIN_TOKENS, TOKEN_RESERVE_TOKENS, requestFindings } from '../plugins/oai/scripts/lib/review-request.mjs';
import { MIN_REVIEW_RESERVE_TOKENS, reviewSchemaFor } from '../plugins/oai/scripts/lib/review-schema.mjs';
import {
  chatRequests,
  completionFrames,
  modelList,
  respondJson,
  respondStream,
  reviewScenario,
  runCompanion,
  scriptOf,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';

const WINDOW = 61_696;
const FIRST_RESERVE = 30_848;
const SAFE_CAP = 26_885;

const FINDINGS = JSON.stringify({
  findings: [{ file: 'seed.txt', line: 2, severity: 'high', summary: 'the seed is wrong', evidence: 'edited' }],
  analysis: 'walked each changed hunk',
  summary: 'one real defect',
});

/** The refusal vMLX sends, stating `cap` as the budget it could take. */
const refuseAbove = (cap, status = 413) => (response, request) =>
  respondJson(
    response,
    {
      detail:
        `Requested max output tokens exceed projected safe Metal headroom: requested=${request.body.max_tokens}, ` +
        `safe_cap=${cap}. Reduce max_tokens or free memory.`,
    },
    status,
  );

/** The same refusal, stating a cap `delta` tokens from the budget the request carried. */
const refuseBeside = (delta) => (response, request) => refuseAbove(request.body.max_tokens + delta)(response, request);

/** An input large enough that the first reserve shrinks below `FIRST_RESERVE`. */
const LARGE_SEED = `seed\n${'const x = 1;\n'.repeat(5_000)}`;

const answer = (response) => respondStream(response, completionFrames(FINDINGS));

/** The `analysis` ceiling a request's prose schema instruction states. */
function statedAnalysisCap(record) {
  const text = record.body.messages.map((message) => message.content).join('\n');
  const match = /"analysis":\{"type":"string","maxLength":(\d+)\}/.exec(text);
  return match ? Number(match[1]) : null;
}

async function review(scripts, args = [], { seed } = {}) {
  const { dir, server, configPath } = await reviewScenario(scriptOf(scripts), { contextLength: WINDOW, seed });
  try {
    const result = await runCompanion(['review', '--json', ...args], { configPath, cwd: dir });
    return { result, chats: chatRequests(server) };
  } finally {
    await server.close();
  }
}

test('a review refused at its budget is re-planned once at the stated cap, and completes', async () => {
  const { result, chats } = await review([refuseAbove(SAFE_CAP), answer]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chats.length, 2);
  assert.deepEqual(chats.map((chat) => chat.body.max_tokens), [FIRST_RESERVE, SAFE_CAP]);
  // The retry is rebuilt from the cap, not merely re-sent with a smaller number.
  assert.equal(statedAnalysisCap(chats[1]), reviewSchemaFor(SAFE_CAP).properties.analysis.maxLength);
  assert.match(result.stderr, new RegExp(`${FIRST_RESERVE}\\b[^\\n]*\\b${SAFE_CAP}\\b`), 'stderr names both budgets');

  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.attempts.map((entry) => entry.maxTokens), [FIRST_RESERVE, SAFE_CAP]);
  assert.equal(report.attempts[0].reason, 'request-too-large');
  assert.equal(report.attempts[0].outcome, 'refused', 'a refusal the retry answered is negotiation, not a failed attempt');
  assert.equal(report.attempts[1].outcome, 'answered');
});

test('the retried analysis ceiling derives from the stated cap', async () => {
  // 26,885 and 30,848 both clamp to the analysis ceiling, so they cannot tell a
  // rebuilt request from a re-sent one; a cap of 20,000 can.
  const cap = 20_000;
  const { result, chats } = await review([refuseAbove(cap), answer]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chats[1].body.max_tokens, cap);
  const expected = reviewSchemaFor(cap).properties.analysis.maxLength;
  assert.notEqual(expected, statedAnalysisCap(chats[0]), 'the two budgets must give different ceilings here');
  assert.equal(statedAnalysisCap(chats[1]), expected);
});

test('the retry arms the reasoning watchdog against the stated cap, not the refused budget', async () => {
  // 80,000 reasoning characters: past the cutoff a 26,885-token budget sets
  // ((26,885 - 2,048) x 3 = 74,511) and short of the 30,848 one (86,400). A
  // watchdog armed at the refused budget lets the content after it through.
  assert.ok(SAFE_CAP >= REVIEW_MIN_TOKENS && REVIEW_MIN_TOKENS >= 2 * TOKEN_RESERVE_TOKENS);
  const longReasoning = (response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    const frame = (delta) =>
      `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'test-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
    for (let i = 0; i < 80; i += 1) response.write(frame({ reasoning_content: 'r'.repeat(1_000) }));
    for (const item of completionFrames(FINDINGS)) response.write(`data: ${JSON.stringify(item)}\n\n`);
    response.end('data: [DONE]\n\n');
  };
  const { result, chats } = await review([refuseAbove(SAFE_CAP), longReasoning, answer]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chats.length, 3, 'the cutoff fired on the retry and a salvage follow-up concluded it');
  assert.deepEqual(chats.map((chat) => chat.body.max_tokens), [FIRST_RESERVE, SAFE_CAP, TOKEN_RESERVE_TOKENS]);
  assert.equal(JSON.parse(result.stdout).attempts[1].reason, 'token-reserve-cutoff');
});

test('a second refusal is final, even when it states a smaller cap again', async () => {
  const { result, chats } = await review([refuseAbove(SAFE_CAP), refuseAbove(20_000), answer]);

  assert.equal(result.status, 1);
  assert.equal(chats.length, 2, 'one retry, never a third request');
  const report = JSON.parse(result.stdout);
  assert.equal(report.reason, 'request-too-large');
  assert.deepEqual(report.attempts.map((entry) => entry.maxTokens), [FIRST_RESERVE, SAFE_CAP]);
  assert.equal(report.attempts.at(-1).reason, 'request-too-large');
});

test('a second refusal below what a review reply needs points at /oai:task, not --max-tokens', async () => {
  const cap = 3_000;
  assert.ok(cap < MIN_REVIEW_RESERVE_TOKENS);
  const { result, chats } = await review([refuseAbove(SAFE_CAP), refuseAbove(cap), answer]);

  assert.equal(result.status, 1);
  assert.equal(chats.length, 2);
  const report = JSON.parse(result.stdout);
  assert.match(report.hint, /\b3000\b/);
  assert.match(report.hint, /\/oai:task/);
  assert.doesNotMatch(report.hint, /--max-tokens/, 'a review refuses --max-tokens this small');
});

test('a stated cap below the review floor is not retried, and the hint names it', async () => {
  // 4,000 sits between the smallest budget --max-tokens accepts (3,912) and
  // REVIEW_MIN_TOKENS (4,096), the least the review retries at: it is not
  // retried, but an explicit --max-tokens 4000 is a budget a review takes.
  const { result, chats } = await review([refuseAbove(4_000), answer]);

  assert.equal(result.status, 1);
  assert.equal(chats.length, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reason, 'request-too-large');
  assert.match(report.hint, /--max-tokens 4000\b/);
  assert.doesNotMatch(report.hint, /\/oai:task/);
});

test('a stated cap equal to an explicit --max-tokens gets no budget remedy', async () => {
  const { result, chats } = await review([refuseAbove(4_000), answer], ['--max-tokens', '4000']);

  assert.equal(result.status, 1);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].body.max_tokens, 4_000, 'the refused request sent the budget the cap names');
  const report = JSON.parse(result.stdout);
  assert.equal(report.reason, 'request-too-large');
  assert.equal(report.hint, null, 'repeating the refused budget is no remedy');
});

test('a stated cap below what a review reply needs points at /oai:task, not --max-tokens', async () => {
  const cap = 3_000;
  assert.ok(cap < MIN_REVIEW_RESERVE_TOKENS);
  const { result, chats } = await review([refuseAbove(cap), answer]);

  assert.equal(result.status, 1);
  assert.equal(chats.length, 1);
  const report = JSON.parse(result.stdout);
  assert.match(report.hint, /\b3000\b/);
  assert.match(report.hint, /\/oai:task/);
  assert.doesNotMatch(report.hint, /--max-tokens/, 'a review refuses --max-tokens this small');
});

test('with a shrunk reserve, the retry is judged against the budget sent, not the ceiling', async () => {
  // A cap between the shrunk reserve and the ceiling would rebuild the same
  // request: the input still needs the window, so the reserve shrinks again.
  const above = await review([refuseBeside(4_000), answer], [], { seed: LARGE_SEED });
  const shrunk = above.chats[0].body.max_tokens;
  assert.ok(shrunk > REVIEW_MIN_TOKENS + 4_000 && shrunk + 4_000 < FIRST_RESERVE, `the reserve must shrink (sent ${shrunk})`);
  assert.equal(above.result.status, 1);
  assert.equal(above.chats.length, 1, 'a cap above the budget sent is not retried');

  const below = await review([refuseBeside(-4_000), answer], [], { seed: LARGE_SEED });
  assert.equal(below.chats[0].body.max_tokens, shrunk);
  assert.equal(below.result.status, 0, below.result.stderr);
  assert.deepEqual(below.chats.map((chat) => chat.body.max_tokens), [shrunk, shrunk - 4_000]);
  assert.match(below.result.stderr, new RegExp(`budget of ${shrunk} tokens[^\\n]*\\b${shrunk - 4_000}\\b`));
  assert.doesNotMatch(below.result.stderr, new RegExp(`\\b${FIRST_RESERVE}\\b`), 'the ceiling was never sent');
});

test('a 422 stating a cap is not a budget refusal: one request, failed, no retry', async () => {
  const { result, chats } = await review([refuseAbove(SAFE_CAP, 422), answer]);

  assert.equal(result.status, 1);
  assert.equal(chats.length, 1, 'only a 413 states a cap the review retries at');
  assert.doesNotMatch(result.stderr, /Retrying once/);
  const report = JSON.parse(result.stdout);
  // The report carries a stated cap only through its hint, so neither may name it.
  assert.equal(report.hint, null);
  assert.ok(!result.stdout.includes(String(SAFE_CAP)), 'the error report names the cap');
  assert.equal(report.attempts[0].outcome, 'failed');
  assert.equal(report.attempts[0].reason, null);
});

test('the retry keeps the capabilities the server already refused', async () => {
  // `stream_options` refused before the 413: the retry must not offer it again,
  // which would cost a round trip and re-announce a settled refusal.
  const refuseStreamOptions = (response) => respondJson(response, { error: 'stream_options is not supported' }, 400);
  const { result, chats } = await review([refuseStreamOptions, refuseAbove(SAFE_CAP), answer]);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(chats[0].body.stream_options, 'the first request offers stream_options');
  assert.equal(chats.length, 3, 'refusal, degraded 413, retry — no further round trip');
  assert.equal(chats[1].body.stream_options, undefined);
  assert.equal(chats[2].body.stream_options, undefined);
  assert.equal(chats[2].body.max_tokens, SAFE_CAP);
});

test('under --structured-output, a retry after a refused response_format sends none', async () => {
  const refuseFormat = (response) => respondJson(response, { error: 'response_format is not supported' }, 400);
  const { result, chats } = await review([refuseFormat, refuseAbove(SAFE_CAP), answer], ['--structured-output']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chats.length, 3);
  assert.ok(chats[0].body.response_format, 'the first request carries the schema');
  assert.equal(chats[1].body.response_format, undefined);
  assert.equal(chats[2].body.response_format, undefined, 'the retry does not offer the refused grammar again');
  assert.equal(chats[2].body.max_tokens, SAFE_CAP);
  assert.equal(result.stderr.match(/Retrying without it/g)?.length, 1, 'the format refusal is announced once');
});

test('a stated cap no smaller than the refused budget is not retried', async () => {
  for (const cap of [FIRST_RESERVE, FIRST_RESERVE + 1]) {
    const { result, chats } = await review([refuseAbove(cap), answer]);

    assert.equal(result.status, 1, `cap ${cap}`);
    assert.equal(chats.length, 1, `cap ${cap} would rebuild the request it refused`);
    assert.equal(JSON.parse(result.stdout).hint, null, `cap ${cap} names no budget smaller than the one refused`);
  }
});

// The deadline cases run in-process, where the clock can be moved at the instant
// the refusal is served. `capBudgets` and `requestFindings` read the bare
// `performance.now()`, so the stub needs no seam in production code.

async function withClock(body) {
  const real = globalThis.performance;
  let offset = 0;
  globalThis.performance = { now: () => real.now() + offset };
  try {
    return await body((ms) => {
      offset += ms;
    });
  } finally {
    globalThis.performance = real;
  }
}

function inProcessPlan(server, ledger, maxMs) {
  return {
    model: 'test-model',
    contextLength: WINDOW,
    reserve: FIRST_RESERVE,
    target: { label: 'the edit', diff: 'diff --git a/seed.txt b/seed.txt\n+edited\n', files: [], changed: [], unreadable: [] },
    timeoutMs: 5_000,
    idleMs: 5_000,
    maxMs,
    maxAttempts: 1,
    retryDelayMs: 0,
    structuredOutput: false,
    ledger,
  };
}

const caught = (promise) => promise.then(() => assert.fail('expected a rejection'), (error) => error);

test('a deadline already spent when the refusal arrives sends no retry', async () => {
  const cap = 30_000;
  await withClock(async (advance) => {
    const server = await startFakeServer((request, response) => {
      if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
      advance(cap * 2);
      return refuseAbove(SAFE_CAP)(response, request);
    });
    try {
      const ledger = createLedger();
      const error = await caught(requestFindings({ name: 'p', baseUrl: server.baseUrl }, inProcessPlan(server, ledger, cap)));

      assert.equal(chatRequests(server).length, 1);
      assert.equal(error.reason, 'request-too-large', 'the refusal is the failure reported');
      assert.equal(ledger.entries().length, 1);
    } finally {
      await server.close();
    }
  });
});

test('the retry runs inside what is left of the deadline, never a fresh one', async () => {
  // 200ms of a 10s cap remain when the retry goes out, and the retry's reply
  // takes 1.5s: it must be cut off. A re-minted deadline would let it answer.
  const cap = 10_000;
  await withClock(async (advance) => {
    let chats = 0;
    const server = await startFakeServer((request, response) => {
      if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
      chats += 1;
      if (chats === 1) {
        advance(cap - 200);
        return refuseAbove(SAFE_CAP)(response, request);
      }
      return setTimeout(() => answer(response), 1_500);
    });
    try {
      const ledger = createLedger();
      const error = await caught(requestFindings({ name: 'p', baseUrl: server.baseUrl }, inProcessPlan(server, ledger, cap)));

      assert.equal(chatRequests(server).length, 2, 'the retry was dispatched');
      assert.equal(chatRequests(server)[1].body.max_tokens, SAFE_CAP);
      assert.equal(error.reason, 'deadline-timeout');
    } finally {
      await server.close();
    }
  });
});

async function task(args) {
  const server = await startFakeServer(scriptOf([refuseAbove(SAFE_CAP), answer]));
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });
  try {
    const result = await runCompanion(['task', ...args, 'hello'], { configPath: path });
    return { result, chats: chatRequests(server) };
  } finally {
    await server.close();
  }
}

test('/oai:task without --max-tokens names the stated cap', async () => {
  const { result, chats } = await task([]);

  assert.equal(result.status, 1);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].body.max_tokens, undefined, 'the task sent no budget of its own');
  assert.match(result.stderr, new RegExp(`--max-tokens ${SAFE_CAP}\\b`));
});

test('/oai:task already under the stated cap is not told to pass it', async () => {
  const { result, chats } = await task(['--max-tokens', '20000']);

  assert.equal(result.status, 1);
  assert.equal(chats.length, 1);
  assert.doesNotMatch(result.stderr, /--max-tokens/);
});

test('/oai:task does not retry a refused budget, and names the stated cap', async () => {
  const server = await startFakeServer(scriptOf([refuseAbove(SAFE_CAP), answer]));
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });
  try {
    const result = await runCompanion(['task', '--max-tokens', '30000', 'hello'], { configPath: path });

    assert.equal(result.status, 1);
    assert.equal(chatRequests(server).length, 1);
    assert.match(result.stderr, new RegExp(`--max-tokens ${SAFE_CAP}\\b`));
  } finally {
    await server.close();
  }
});
