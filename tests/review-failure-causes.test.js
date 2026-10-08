// What a FAILED review says about the request it sent.
//
// A review whose request the conservative non-ASCII count narrowed — the
// whole-file rung refused, or the reply budget cut — fails for the same reasons
// any review can, and the narrowing may be why. Every failure site that knew the
// request attaches its causes to the error it throws, so the `--json` failure
// envelope carries them and the text failure names them; a multi-pass run names
// them on the failed pass's own line. A task or job envelope gains no key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withReviewCauses } from '../plugins/oai/scripts/lib/review-ladder.mjs';
import { allFailedError } from '../plugins/oai/scripts/lib/review-passes.mjs';
import { errorReport, report } from '../plugins/oai/scripts/lib/review-report.mjs';
import { reserveFor } from '../plugins/oai/scripts/lib/review-request.mjs';
import {
  chatRequests,
  completion,
  createRepo,
  deltaFrame,
  git,
  modelList,
  respondJson,
  reviewScenario,
  runCompanion,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';

const FINDINGS = JSON.stringify({ analysis: 'a', findings: [], summary: 'No defects found.' });
const PROSE = 'I had a look and I am not sure.';
const CAUSE_KEYS = ['hunksOnly', 'skippedUnsizedWindow', 'skippedConservativeCount', 'conservativeReserveCut'];
const RESERVE_NOTE = /reply budget was reduced/;
const FALLBACK_NOTE = /did not fit the window as counted/;
const PASS_RESERVE_NOTE = "the review request's reply budget reduced by the conservative non-ASCII count";
const PASS_SALVAGE_NOTE = 'its reply came from a salvage follow-up';

// The window and the untracked-file repo `tests/review-conservative-count.test.js`
// uses: the file goes whole, and its CJK body makes the conservative count cut
// the reply budget.
const WINDOW = 32_768;

async function repoWithNewFile(content) {
  const dir = await createRepo();
  writeFileSync(join(dir, 'brand-new.js'), `export const text = "${content}";\n`);
  return dir;
}

const reserveCutRepo = () => repoWithNewFile('中'.repeat(7000));

// A copy of the tracked-file repo `tests/review-conservative-count.test.js` uses
// for the whole-file fallback: the CJK padding sits outside the hunk, so only the
// whole-file rung would send it, and as counted it does not fit.
async function fallbackRepo() {
  const dir = await createRepo();
  const filler = Array.from({ length: 20 }, (_, index) => `const filler${index} = ${index};`).join('\n');
  const body = (tail) => `const farFromAnyHunk = 1;\n// ${'中'.repeat(10_000)}\n${filler}\nexport const tail = ${tail};\n`;
  writeFileSync(join(dir, 'code.js'), body(0));
  await git(['add', 'code.js'], dir);
  await git(['commit', '--quiet', '-m', 'code'], dir);
  writeFileSync(join(dir, 'code.js'), body(1));
  return dir;
}

function configFor(server) {
  return writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: WINDOW } },
  }).path;
}

/**
 * A server that lists the model and answers the Nth chat request with
 * `reply(n)`; any other probe gets the plain completion the conservative-count
 * tests' server gives it.
 */
async function scriptedServer(reply) {
  let chats = 0;
  return startFakeServer((req, response) => {
    if (req.url.includes('/models')) return respondJson(response, modelList('test-model'));
    if (!req.url.includes('/chat/completions')) return respondJson(response, completion(FINDINGS));
    chats += 1;
    return reply(chats, response);
  });
}

/** A completion cut off at the token limit. */
function lengthCompletion(content) {
  return completion(content, {
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'length' }],
  });
}

const causeFields = (envelope) => Object.fromEntries(CAUSE_KEYS.map((key) => [key, envelope[key]]));

const RESERVE_CUT = {
  hunksOnly: false,
  skippedUnsizedWindow: false,
  skippedConservativeCount: false,
  conservativeReserveCut: true,
};

const passLine = (stdout, number) => stdout.split('\n').find((line) => line.startsWith(`  pass ${number}:`));

test('errorReport carries the review causes only when the failure recorded them', () => {
  const recorded = errorReport({
    message: 'failed',
    reviewCauses: { skipped: 'conservative-count', conservativeReserveCut: true, hunksOnly: true },
  });
  assert.deepEqual(causeFields(recorded), {
    hunksOnly: true,
    skippedUnsizedWindow: false,
    skippedConservativeCount: true,
    conservativeReserveCut: true,
  });

  const plain = errorReport({ message: 'failed' });
  for (const key of CAUSE_KEYS) assert.equal(Object.hasOwn(plain, key), false, `${key} is absent`);
});

test('withReviewCauses attaches only what a request-shaped object knows, and never overwrites', () => {
  const unbuilt = withReviewCauses(new Error('x'), undefined);
  assert.equal(unbuilt.reviewCauses, undefined, 'nothing was built');

  const partial = withReviewCauses(new Error('x'), { structured: false, conservativeReserveCut: true });
  assert.equal(partial.reviewCauses, undefined, 'a context without `skipped` asserts nothing');

  const existing = { skipped: 'unsized-window', conservativeReserveCut: false, hunksOnly: true };
  const kept = Object.assign(new Error('x'), { reviewCauses: existing });
  withReviewCauses(kept, { skipped: null, conservativeReserveCut: true, hunksOnly: false });
  assert.equal(kept.reviewCauses, existing, 'the innermost site wins');

  const built = withReviewCauses(new Error('x'), { skipped: null, conservativeReserveCut: 1, hunksOnly: 0 });
  assert.deepEqual(built.reviewCauses, { skipped: null, conservativeReserveCut: true, hunksOnly: false });
});

test('a reply cut off at the token limit after a conservative reserve cut says so', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((_, response) => respondJson(response, lengthCompletion('{"findings": [')));
  const configPath = configFor(server);
  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const maxTokens = chatRequests(server)[0].body.max_tokens;
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  assert.ok(maxTokens < reserveFor(WINDOW), `the sent max_tokens (${maxTokens}) was cut`);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.reason, 'token-exhaustion');
  assert.deepEqual(causeFields(envelope), RESERVE_CUT);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /ran out of tokens/);
  assert.match(text.stderr, RESERVE_NOTE);
  assert.doesNotMatch(text.stderr, FALLBACK_NOTE);
  assert.doesNotMatch(text.stderr, /at least one pass/, 'a single review is one request');
  assert.doesNotMatch(text.stderr, /salvage follow-up/, 'no salvage ran');
  // A higher ceiling cannot be sent once the count cut the budget to fit.
  assert.doesNotMatch(envelope.hint, /Raising --max-tokens/);
  assert.doesNotMatch(text.stderr, /Raising --max-tokens/);
});

test('a reply cut off at the token limit with no reserve cut keeps the --max-tokens remedy', async () => {
  const dir = await repoWithNewFile('plain ascii');
  const server = await scriptedServer((_, response) => respondJson(response, lengthCompletion('{"findings": [')));
  const json = await runCompanion(['review', '--json'], { configPath: configFor(server), cwd: dir });
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.reason, 'token-exhaustion');
  assert.equal(envelope.conservativeReserveCut, false);
  assert.match(envelope.hint, /Raising --max-tokens helps only when the window has room to spare/);
});

/** A clean stream that never left its reasoning channel, too short to salvage. */
function reasoningOnlyReply(_, response) {
  const frame = (delta, finishReason) => `data: ${JSON.stringify({
    id: 'chatcmpl-test', object: 'chat.completion.chunk', model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`${frame({ reasoning_content: 'thinking, briefly.' }, null)}${frame({}, 'stop')}data: [DONE]\n\n`);
}

async function reasoningOnlyEnvelope(args, dir) {
  const server = await scriptedServer(reasoningOnlyReply);
  const result = await runCompanion([args[0], '--json', ...args.slice(1)], { configPath: configFor(server), cwd: dir });
  await server.close();
  assert.equal(result.status, 1, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.match(envelope.message, /returned only internal reasoning and no answer/);
  assert.equal(typeof envelope.hint, 'string');
  return envelope;
}

test('a reasoning-only review after a reserve cut does not suggest raising --max-tokens', async () => {
  const envelope = await reasoningOnlyEnvelope(['review'], await reserveCutRepo());
  assert.equal(envelope.reason, 'reasoning-only');
  assert.equal(envelope.conservativeReserveCut, true);
  assert.match(envelope.hint, /narrower question/);
  assert.doesNotMatch(envelope.hint, /Raise --max-tokens/);
});

test('a reasoning-only review with no reserve cut keeps the --max-tokens remedy', async () => {
  const envelope = await reasoningOnlyEnvelope(['review'], await repoWithNewFile('plain ascii'));
  assert.equal(envelope.reason, 'reasoning-only');
  assert.equal(envelope.conservativeReserveCut, false);
  assert.match(envelope.hint, /Raise --max-tokens/);
});

test('a reasoning-only task keeps the --max-tokens remedy', async () => {
  const envelope = await reasoningOnlyEnvelope(['task', 'a question'], await createRepo());
  assert.match(envelope.hint, /Raise --max-tokens/);
});

test('a salvaged prose reply after a reserve cut names the review request\'s budget', () => {
  const context = {
    json: false,
    result: { content: PROSE, finishReason: 'stop', model: 'test-model' },
    profile: { name: 'local' },
    model: 'test-model',
    target: { label: 'working tree', unreadable: [] },
    hunksOnly: false,
    salvaged: true,
    conservativeReserveCut: true,
    budget: { checked: true },
    estimatedTokens: 100,
    durationMs: 1,
  };
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    report(null, context);
  } finally {
    process.stdout.write = write;
  }
  assert.match(out, /SALVAGE follow-up/);
  assert.match(out, /the review request's reply budget was reduced/);
  assert.doesNotMatch(out, /less room to reason and answer/);
});

/**
 * CJK reasoning that trips the reserve watchdog and whose salvage follow-up is
 * refused before dispatch — the fixture `tests/salvage.test.js` uses for the
 * oversized follow-up.
 */
const CJK_CHUNK = '推理'.repeat(25);
const CJK_FRAMES = 130;

function cutoffHandler(record, response) {
  if (!record.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
  for (let i = 0; i < CJK_FRAMES; i += 1) {
    response.write(`data: ${JSON.stringify(deltaFrame({ reasoning_content: CJK_CHUNK }))}\n\n`);
  }
  // No end() — the reserve watchdog is what stops this stream.
}

test('a reasoning cutoff whose salvage was refused reports its causes and no stale hint', async () => {
  const { dir, server, configPath } = await reviewScenario(cutoffHandler);
  let json;
  let text;
  try {
    json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(chatRequests(server).length, 1, 'no follow-up went out');
    text = await runCompanion(['review'], { configPath, cwd: dir });
  } finally {
    await server.close();
  }

  assert.equal(json.status, 1);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.reason, 'token-reserve-cutoff');
  assert.deepEqual(causeFields(envelope), {
    hunksOnly: false,
    skippedUnsizedWindow: false,
    skippedConservativeCount: false,
    conservativeReserveCut: false,
  });
  assert.equal(text.status, 1);
  assert.doesNotMatch(text.stderr, /Attempting to conclude/);
  assert.match(text.stderr, /No answer could be concluded from the partial reasoning/);
});

/**
 * A server whose first chat request streams reasoning until the reserve
 * watchdog cuts it off, and whose later chat requests are answered by
 * `later(n, response)`.
 */
async function cutoffThen(later) {
  let chats = 0;
  return startFakeServer((req, response) => {
    if (req.url.includes('/models')) return respondJson(response, modelList('test-model'));
    if (!req.url.includes('/chat/completions')) return respondJson(response, completion(FINDINGS));
    chats += 1;
    if (chats > 1) return later(chats, response);
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    // ASCII reasoning, so the trimmed follow-up still fits the window.
    for (let i = 0; i < 400; i += 1) {
      response.write(`data: ${JSON.stringify(deltaFrame({ reasoning_content: 'thinking hard. '.repeat(10) }))}\n\n`);
    }
  });
}

test('a salvage follow-up that runs out of tokens is named, and the cut is the review request\'s', async () => {
  const dir = await reserveCutRepo();
  // One server per run: the cutoff answers only a server's first chat request.
  const run = async (args) => {
    const server = await cutoffThen((_, response) => respondJson(response, lengthCompletion('{"findings": [')));
    const result = await runCompanion(args, { configPath: configFor(server), cwd: dir });
    const budgets = chatRequests(server).map((request) => request.body.max_tokens);
    await server.close();
    return { result, budgets };
  };
  const { result: json, budgets } = await run(['review', '--json']);
  const { result: text } = await run(['review']);

  assert.equal(budgets.length, 2, `a salvage follow-up went out: ${budgets}`);
  assert.equal(json.status, 1, json.stderr);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.reason, 'token-exhaustion');
  assert.equal(envelope.conservativeReserveCut, true);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /ran out of tokens in the salvage follow-up/);
  assert.match(text.stderr, /the review request's reply budget was reduced/);
  assert.doesNotMatch(text.stderr, /--max-tokens/, 'no remedy that cannot reach the follow-up');
});

test('a salvaged pass in a mixed run names the follow-up on its own line', async () => {
  const dir = await reserveCutRepo();
  const server = await cutoffThen((n, response) =>
    respondJson(response, n === 2 ? lengthCompletion('{"findings": [') : completion(FINDINGS)));
  const text = await runCompanion(['review', '--passes', '2'], { configPath: configFor(server), cwd: dir });
  await server.close();

  assert.equal(text.status, 0, text.stderr);
  const failed = passLine(text.stdout, 1);
  assert.ok(failed?.includes(PASS_SALVAGE_NOTE), text.stdout);
  assert.ok(failed.includes(PASS_RESERVE_NOTE), failed);
  assert.ok(passLine(text.stdout, 2), text.stdout);
  assert.ok(!passLine(text.stdout, 2).includes(PASS_SALVAGE_NOTE), 'a readable pass line names no follow-up');
});

test('a --structured-output request that fails at the server reports its causes', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((_, response) => respondJson(response, { error: { message: 'boom' } }, 500));
  const json = await runCompanion(['review', '--structured-output', '--json'], { configPath: configFor(server), cwd: dir });
  const format = chatRequests(server)[0].body.response_format;
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  assert.ok(format, 'the structured path sent a schema');
  assert.deepEqual(causeFields(JSON.parse(json.stdout)), RESERVE_CUT);
});

test('a thrown pass in a mixed run carries its causes on its own record and line', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((n, response) =>
    (n % 2 === 1
      ? respondJson(response, { error: { message: 'unauthorized' } }, 401)
      : respondJson(response, completion(FINDINGS))));
  const configPath = configFor(server);
  const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review', '--passes', '2'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  const [failed, readable] = JSON.parse(json.stdout).passes;
  assert.equal(failed.ok, false);
  assert.equal(readable.ok, undefined, 'the second pass was readable');
  assert.deepEqual(causeFields(failed), RESERVE_CUT);
  assert.equal(text.status, 0, text.stderr);
  assert.ok(passLine(text.stdout, 1)?.includes(PASS_RESERVE_NOTE), text.stdout);
  assert.ok(passLine(text.stdout, 2), text.stdout);
  assert.ok(!passLine(text.stdout, 2).includes(PASS_RESERVE_NOTE), 'a readable pass line carries no note');
});

test('every pass cut off at the token limit reports the run\'s causes', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((_, response) => respondJson(response, lengthCompletion('{"findings": [')));
  const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath: configFor(server), cwd: dir });
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.reason, 'token-exhaustion');
  assert.deepEqual(causeFields(envelope), RESERVE_CUT);
});

test('every pass answering unreadable prose reports the run\'s causes, scoped to at least one pass', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((_, response) => respondJson(response, completion(PROSE)));
  const configPath = configFor(server);
  const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review', '--passes', '2'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.reason, 'all-passes-unreadable');
  assert.deepEqual(causeFields(envelope), RESERVE_CUT);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /NOTE: in at least one pass, the review request's reply budget was reduced/);
});

test('an all-failed run ORs the causes its passes recorded, whichever pass recorded them', () => {
  const thrown = (reviewCauses) => ({ ok: false, error: Object.assign(new Error('failed'), { reviewCauses }) });
  const error = allFailedError([
    thrown({ skipped: 'conservative-count', conservativeReserveCut: false, hunksOnly: true }),
    thrown({ skipped: null, conservativeReserveCut: true, hunksOnly: false }),
  ], { name: 'local' });

  assert.deepEqual(error.reviewCauses, {
    skipped: 'conservative-count',
    conservativeReserveCut: true,
    hunksOnly: true,
    multiPass: true,
  });
  assert.deepEqual(causeFields(errorReport(error)), {
    hunksOnly: true,
    skippedUnsizedWindow: false,
    skippedConservativeCount: true,
    conservativeReserveCut: true,
  });
});

test('an all-failed run whose passes never built a request asserts no cause', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((_, response) => respondJson(response, completion(FINDINGS)));
  const configPath = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 4096 } },
  }).path;
  const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  const sent = chatRequests(server).length;
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  assert.equal(sent, 0, 'every pass was refused before a request went out');
  const envelope = JSON.parse(json.stdout);
  for (const key of CAUSE_KEYS) assert.equal(Object.hasOwn(envelope, key), false, `${key} is absent`);
});

test('a multi-pass run refused for an unconfirmed served model reports its causes', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((_, response) => respondJson(response, completion(FINDINGS, { model: null })));
  const configPath = configFor(server);
  const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review', '--passes', '2'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.reason, 'unconfirmed-served-model');
  assert.deepEqual(causeFields(envelope), RESERVE_CUT);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /NOTE: in at least one pass, the review request's reply budget was reduced/);
});

test('the cause notes reach the text failure only, leaving the --json hint its own meaning', async () => {
  const dir = await reserveCutRepo();
  const cut = await scriptedServer((_, response) => respondJson(response, lengthCompletion('{"findings": [')));
  const cutConfig = configFor(cut);
  const json = await runCompanion(['review', '--json'], { configPath: cutConfig, cwd: dir });
  await cut.close();

  assert.equal(json.status, 1, json.stderr);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.conservativeReserveCut, true);
  assert.doesNotMatch(envelope.hint ?? '', /NOTE:/, 'the envelope carries the flags, not the prose');
  assert.match(json.stderr, RESERVE_NOTE);

  // A refusal stating a cap no smaller than the budget it was sent deletes the
  // hint on purpose: repeating that budget is no remedy.
  const capped = await startFakeServer((req, response) => {
    if (req.url.includes('/models')) return respondJson(response, modelList('test-model'));
    if (!req.url.includes('/chat/completions')) return respondJson(response, completion(FINDINGS));
    return respondJson(response, {
      detail: `Requested max output tokens exceed projected safe Metal headroom: requested=${req.body.max_tokens}, ` +
        `safe_cap=${req.body.max_tokens}. Reduce max_tokens or free memory.`,
    }, 413);
  });
  const refused = await runCompanion(['review', '--json'], { configPath: configFor(capped), cwd: dir });
  await capped.close();

  assert.equal(refused.status, 1, refused.stderr);
  const refusal = JSON.parse(refused.stdout);
  assert.equal(refusal.reason, 'request-too-large');
  assert.equal(refusal.conservativeReserveCut, true);
  assert.equal(refusal.hint, null);
  assert.match(refused.stderr, RESERVE_NOTE);
});

test('a failure note says what the request carried, never what a model saw', async () => {
  const dir = await fallbackRepo();
  const server = await scriptedServer((_, response) => respondJson(response, { error: { message: 'boom' } }, 500));
  const text = await runCompanion(['review'], { configPath: configFor(server), cwd: dir });

  const unsized = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model' } },
  }).path;
  const json = await runCompanion(['review', '--json'], { configPath: unsized, cwd: dir });
  await server.close();

  assert.equal(text.status, 1);
  assert.match(text.stderr, /the request carried only their hunks/);
  assert.doesNotMatch(text.stderr, /the model saw only/);
  assert.equal(json.status, 1);
  assert.equal(JSON.parse(json.stdout).skippedUnsizedWindow, true);
  assert.doesNotMatch(json.stderr, /NOTE: the context window/, 'no unsized-window remedy on a failure');
});

test('a failure after the whole files were withheld by the conservative count says so', async () => {
  const dir = await fallbackRepo();
  const server = await scriptedServer((_, response) => respondJson(response, lengthCompletion('{"findings": [')));
  const configPath = configFor(server);
  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.reason, 'token-exhaustion');
  assert.equal(envelope.skippedConservativeCount, true);
  assert.equal(envelope.hunksOnly, true);
  assert.equal(text.status, 1);
  assert.match(text.stderr, FALLBACK_NOTE);
});

test('a whitespace-only answer after a conservative reserve cut says so', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((_, response) => respondJson(response, completion('   ')));
  const configPath = configFor(server);
  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 1, json.stderr);
  const envelope = JSON.parse(json.stdout);
  assert.match(envelope.message, /returned an empty answer/);
  assert.deepEqual(causeFields(envelope), RESERVE_CUT);
  assert.equal(text.status, 1);
  assert.match(text.stderr, RESERVE_NOTE);
});

test('an unreadable pass in a mixed run names its causes on its own line', async () => {
  const dir = await reserveCutRepo();
  const server = await scriptedServer((n, response) => respondJson(response, completion(n === 1 ? PROSE : FINDINGS)));
  const text = await runCompanion(['review', '--passes', '2'], { configPath: configFor(server), cwd: dir });
  await server.close();

  assert.equal(text.status, 0, text.stderr);
  assert.ok(passLine(text.stdout, 1)?.includes(PASS_RESERVE_NOTE), text.stdout);
  assert.ok(passLine(text.stdout, 2), text.stdout);
  assert.ok(!passLine(text.stdout, 2).includes(PASS_RESERVE_NOTE), 'a readable pass line carries no note');
});
