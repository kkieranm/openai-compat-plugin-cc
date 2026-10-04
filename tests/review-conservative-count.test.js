// What a review discloses when the conservative non-ASCII count, rather than
// the input's real size, shaped the request.
//
// The context guard counts non-ASCII text conservatively, about threefold for
// common Chinese. Two effects of that reach an ADMITTED review:
// the whole-file rung can be refused and the review falls back to hunks, and
// the reply budget yields to the input further than a typical count would make
// it. Each is disclosed only when a typical count would have changed the
// outcome — an ASCII review shrunk or shed for size alone is the designed
// behaviour and says nothing new.
//
// The witness for what was sent is the fake server's REQUEST LOG; the report is
// what the code claims it did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSERVATIVE_NOTE, checkContextBudget, estimateTokens, typicalTokens } from '../plugins/oai/scripts/lib/context-guard.mjs';
import { prepareRequest } from '../plugins/oai/scripts/lib/delegate.mjs';
import { reserveFor } from '../plugins/oai/scripts/lib/review-request.mjs';
import {
  chatRequests,
  completion,
  createRepo,
  git,
  modelList,
  respondJson,
  runCompanion,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';

const FINDINGS = JSON.stringify({ analysis: 'a', findings: [], summary: 'No defects found.' });
const WINDOW = 32_768;
const FALLBACK_NOTE = /did not fit the window as counted/;
const RESERVE_NOTE = /reply budget was reduced/;
const OUTSIDE_THE_HUNK = 'const farFromAnyHunk = "only-in-the-whole-file";';

const guard = (estimatedTokens, typical) => () =>
  checkContextBudget({ estimatedTokens, contextLength: 1000, reserveTokens: 100, providerName: 'p', model: 'm', typicalTokens: typical });

test('the oversize refusal is tagged conservative exactly when it carries the conservative note', () => {
  const tagged = (fn) => {
    try {
      fn();
    } catch (error) {
      return { conservative: error.conservative, noted: error.message.includes(CONSERVATIVE_NOTE) };
    }
    assert.fail('expected a refusal');
  };
  assert.deepEqual(tagged(guard(2000, 800)), { conservative: true, noted: true }, 'a typical count would fit');
  assert.deepEqual(tagged(guard(2000, 2000)), { conservative: false, noted: false }, 'ASCII: the counts agree');
  assert.deepEqual(tagged(guard(2000, undefined)), { conservative: false, noted: false }, 'no typical count given');
});

const request = (prompt) =>
  prepareRequest({ profile: { name: 'p' }, prompt, files: [], model: 'm', contextLength: WINDOW, maxTokens: 16_384, minReserve: 4096, system: '' });

test('the reserve is flagged only when the conservative count itself cut it', () => {
  const cjk = request('中'.repeat(8000));
  assert.ok(cjk.reserve < 16_384, 'the reserve was cut');
  assert.equal(cjk.conservativeReserveCut, true);

  // The discriminating negative: cut just as hard, but by size alone.
  const ascii = request('x'.repeat(8000 * 3 * 3.4));
  assert.ok(ascii.reserve < 16_384, 'the reserve was cut');
  assert.equal(ascii.conservativeReserveCut, false, 'a typical count would have cut it the same');

  assert.equal(request('中'.repeat(100)).conservativeReserveCut, false, 'nothing was cut');

  // Cut for size, with a little non-ASCII on top: the conservative charge took
  // a few hundred tokens of a ~10k reserve, under the 10% that counts.
  const incidental = request(`${'x'.repeat(70_000)}${'中'.repeat(150)}`);
  assert.ok(incidental.reserve < 16_384, 'the reserve was cut');
  assert.equal(incidental.conservativeReserveCut, false, 'an immaterial share');
});

/** A server that answers both the model listing and the review. */
async function reviewServer(body = FINDINGS) {
  return startFakeServer((req, response) => {
    if (req.url.includes('/models')) return respondJson(response, modelList('test-model'));
    return respondJson(response, completion(body));
  });
}

function configFor(server) {
  return writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: WINDOW } },
  }).path;
}

const sentPrompt = (server) => chatRequests(server)[0].body.messages[1].content;
const sentMaxTokens = (server) => chatRequests(server)[0].body.max_tokens;

/**
 * A tracked file whose body carries `padding` far from the edit, so only the
 * whole-file rung sends it.
 */
async function repoWithPaddedBody(padding) {
  const dir = await createRepo();
  const filler = Array.from({ length: 20 }, (_, index) => `const filler${index} = ${index};`).join('\n');
  const body = (tail) => `${OUTSIDE_THE_HUNK}\n// ${padding}\n${filler}\nexport const tail = ${tail};\n`;
  writeFileSync(join(dir, 'code.js'), body(0));
  await git(['add', 'code.js'], dir);
  await git(['commit', '--quiet', '-m', 'code'], dir);
  writeFileSync(join(dir, 'code.js'), body(1));
  return dir;
}

// Over the whole-file budget as counted (3 per character), well inside it at a
// typical 1 per character.
const CJK_BODY = '中'.repeat(10_000);
// Over the whole-file budget at either count.
const ASCII_BODY = 'x'.repeat(110_000);

test('a body refused only by the conservative count falls back to hunks, and says why', async () => {
  assert.ok(estimateTokens(CJK_BODY) > WINDOW - 4096 && typicalTokens(CJK_BODY) < (WINDOW - 4096) / 2, 'fixture premise');
  const dir = await repoWithPaddedBody(CJK_BODY);
  const server = await reviewServer();
  const configPath = configFor(server);

  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const sent = sentPrompt(server);
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  assert.ok(!sent.includes(OUTSIDE_THE_HUNK), 'the body never went');
  assert.match(sent, /--- DIFF ---/, 'the diff still did');
  const report = JSON.parse(json.stdout);
  assert.equal(report.hunksOnly, true);
  assert.equal(report.skippedConservativeCount, true);
  assert.equal(report.skippedUnsizedWindow, false, 'the window was known');
  assert.equal(report.conservativeReserveCut, false, 'the hunks request left the full reserve');
  assert.match(text.stdout, FALLBACK_NOTE);
  assert.doesNotMatch(text.stdout, /at least one pass/, 'a single review is one request');
  assert.doesNotMatch(text.stdout, RESERVE_NOTE);
});

test('a body too big at any count falls back without blaming the count', async () => {
  // Negative control: the same fallback, by size alone.
  const dir = await repoWithPaddedBody(ASCII_BODY);
  const server = await reviewServer();
  const configPath = configFor(server);

  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const sent = sentPrompt(server);
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  assert.ok(!sent.includes(OUTSIDE_THE_HUNK), 'the body never went: the fallback did happen');
  const report = JSON.parse(json.stdout);
  assert.equal(report.hunksOnly, true);
  assert.equal(report.skippedConservativeCount, false);
  assert.equal(report.conservativeReserveCut, false);
  assert.doesNotMatch(text.stdout, FALLBACK_NOTE);
  assert.doesNotMatch(text.stdout, RESERVE_NOTE);
});

test('a reply that could not be parsed still discloses the conservative fallback', async () => {
  const dir = await repoWithPaddedBody(CJK_BODY);
  const server = await reviewServer('I had a look and I am not sure.');
  const result = await runCompanion(['review'], { configPath: configFor(server), cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.match(result.stdout, FALLBACK_NOTE);
});

/** An untracked file, which always goes whole, so its size sets the reserve. */
async function repoWithNewFile(content) {
  const dir = await createRepo();
  writeFileSync(join(dir, 'brand-new.js'), `export const text = "${content}";\n`);
  return dir;
}

test('a reply budget cut by the conservative count says so', async () => {
  const dir = await repoWithNewFile('中'.repeat(7000));
  const server = await reviewServer();
  const configPath = configFor(server);

  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const maxTokens = sentMaxTokens(server);
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  assert.ok(maxTokens < reserveFor(WINDOW), `the sent max_tokens (${maxTokens}) was cut`);
  const report = JSON.parse(json.stdout);
  assert.equal(report.conservativeReserveCut, true);
  assert.equal(report.skippedConservativeCount, false);
  assert.match(text.stdout, RESERVE_NOTE);
  assert.doesNotMatch(text.stdout, /at least one pass/, 'a single review is one request');
  assert.doesNotMatch(text.stdout, FALLBACK_NOTE);
});

test('a reply budget cut by size alone says nothing new', async () => {
  // Negative control: the budget is cut on the wire just the same.
  const dir = await repoWithNewFile('x'.repeat(70_000));
  const server = await reviewServer();
  const configPath = configFor(server);

  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const maxTokens = sentMaxTokens(server);
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  assert.ok(maxTokens < reserveFor(WINDOW), `the sent max_tokens (${maxTokens}) was cut`);
  assert.equal(JSON.parse(json.stdout).conservativeReserveCut, false);
  assert.doesNotMatch(text.stdout, RESERVE_NOTE);
});

test('a multi-pass union carries both conservative-count facts', async () => {
  const dir = await repoWithPaddedBody(CJK_BODY);
  const server = await reviewServer();
  const configPath = configFor(server);

  const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review', '--passes', '2'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.skippedConservativeCount, true);
  assert.equal(report.conservativeReserveCut, false);
  assert.ok(report.passes.every((pass) => pass.skippedConservativeCount === true), 'and each pass record');
  assert.match(text.stdout, /in at least one pass, the diff-covered changed files did not fit/,
    'a union ORs passes whose requests can differ, so it claims only at least one');
});

test('a reply that could not be parsed still discloses the conservative reserve cut', async () => {
  const dir = await repoWithNewFile('中'.repeat(7000));
  const server = await reviewServer('I had a look and I am not sure.');
  const result = await runCompanion(['review'], { configPath: configFor(server), cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.match(result.stdout, RESERVE_NOTE);
});

test('a multi-pass run carries the conservative reserve cut on each pass and the union', async () => {
  const dir = await repoWithNewFile('中'.repeat(7000));
  const server = await reviewServer();
  const configPath = configFor(server);

  const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review', '--passes', '2'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.conservativeReserveCut, true);
  assert.ok(report.passes.every((pass) => pass.conservativeReserveCut === true), 'and each pass record');
  assert.match(text.stdout, /in at least one pass, the reply budget was reduced/);
});

test('--structured-output carries both conservative-count facts for the request it sends', async () => {
  const fallbackDir = await repoWithPaddedBody(CJK_BODY);
  const fallbackServer = await reviewServer();
  const fallback = await runCompanion(['review', '--structured-output', '--json'], { configPath: configFor(fallbackServer), cwd: fallbackDir });
  const fallbackSent = sentPrompt(fallbackServer);
  const fallbackFormat = chatRequests(fallbackServer)[0].body.response_format;
  await fallbackServer.close();

  assert.equal(fallback.status, 0, fallback.stderr);
  assert.ok(fallbackFormat, 'the structured path sent a schema');
  assert.ok(!fallbackSent.includes(OUTSIDE_THE_HUNK), 'the body never went');
  assert.equal(JSON.parse(fallback.stdout).skippedConservativeCount, true);

  const reserveDir = await repoWithNewFile('中'.repeat(7000));
  const reserveServer = await reviewServer();
  const reserve = await runCompanion(['review', '--structured-output', '--json'], { configPath: configFor(reserveServer), cwd: reserveDir });
  const maxTokens = sentMaxTokens(reserveServer);
  const reserveFormat = chatRequests(reserveServer)[0].body.response_format;
  await reserveServer.close();

  assert.equal(reserve.status, 0, reserve.stderr);
  assert.ok(reserveFormat, 'the structured path sent a schema');
  assert.ok(maxTokens < reserveFor(WINDOW), `the sent max_tokens (${maxTokens}) was cut`);
  assert.equal(JSON.parse(reserve.stdout).conservativeReserveCut, true);
});

test('an unreadable pass still records what its request was', async () => {
  // One pass's reply is prose. Its passes[] entry is a non-observation, kept
  // out of the union, but the request it answered was still narrowed.
  const dir = await repoWithPaddedBody(CJK_BODY);
  let reviews = 0;
  const server = await startFakeServer((req, response) => {
    if (req.url.includes('/models')) return respondJson(response, modelList('test-model'));
    if (req.url.includes('/chat/completions')) reviews += 1;
    return respondJson(response, completion(reviews === 1 ? 'I had a look and I am not sure.' : FINDINGS));
  });
  const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath: configFor(server), cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  const unreadable = JSON.parse(json.stdout).passes.find((pass) => pass.ok === false);
  assert.ok(unreadable, 'one pass could not be read');
  assert.equal(unreadable.hunksOnly, true);
  assert.equal(unreadable.skippedConservativeCount, true);
  assert.equal(unreadable.skippedUnsizedWindow, false);
  assert.equal(unreadable.conservativeReserveCut, false);
});
