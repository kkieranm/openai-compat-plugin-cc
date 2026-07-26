import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completion, modelList, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

function route({ models = () => modelList('test-model'), chat = () => completion('local model says hi') } = {}) {
  return (request, response) => {
    if (request.url.endsWith('/models')) return respondJson(response, models(request));
    if (request.url.endsWith('/chat/completions')) return respondJson(response, chat(request));
    return respondJson(response, { error: 'no such route' }, 404);
  };
}

test('task round-trips a prompt and prints the answer with a footer', async () => {
  const server = await startFakeServer(route({ chat: () => completion('The file defines two exports.') }));
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'what does this do'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /The file defines two exports\./);
  assert.match(result.stdout, /provider: local\s+\|\s+model: test-model/);
  assert.match(result.stdout, /tokens: 11 in \/ 7 out/);
  assert.match(result.stderr, /Contacting local \(test-model\)/);

  const chat = server.requests.find((request) => request.url.endsWith('/chat/completions'));
  assert.equal(chat.body.stream, false);
  assert.equal(chat.body.messages.at(-1).content, 'what does this do');
});

test('task accepts the whole flag string as one argument, as $ARGUMENTS delivers it', async () => {
  const server = await startFakeServer(route());
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', '--model pinned-model summarize the repo'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const chat = server.requests.find((request) => request.url.endsWith('/chat/completions'));
  assert.equal(chat.body.model, 'pinned-model');
  assert.equal(chat.body.messages.at(-1).content, 'summarize the repo');
});

test('task sends prose containing an apostrophe through unchanged', async () => {
  const server = await startFakeServer(route());
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', "--model m explain what the file's header does"], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const chat = server.requests.find((request) => request.url.endsWith('/chat/completions'));
  assert.equal(chat.body.messages.at(-1).content, "explain what the file's header does");
});

test('task accepts temperature 0 for deterministic sampling', async () => {
  const server = await startFakeServer(route());
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', '--temperature', '0', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const chat = server.requests.find((request) => request.url.endsWith('/chat/completions'));
  assert.equal(chat.body.temperature, 0);
});

test('task rejects a temperature outside the valid range', async () => {
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: 'http://127.0.0.1:1/v1' } } });

  const result = await runCompanion(['task', '--temperature', '5', '--model', 'm', 'hello'], { configPath: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--temperature must be a number between 0 and 2/);
});

test('task attaches files with delimiters and sends an api key', async () => {
  const server = await startFakeServer(route());
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-files-'));
  const file = join(dir, 'sample.js');
  writeFileSync(file, 'export const answer = 42;\n');
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, apiKey: 'k-123' } },
  });

  const result = await runCompanion(['task', '--file', file, 'explain'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const chat = server.requests.find((request) => request.url.endsWith('/chat/completions'));
  assert.equal(chat.headers.authorization, 'Bearer k-123');
  assert.match(chat.body.messages.at(-1).content, /--- FILE: .*sample\.js ---/);
  assert.match(chat.body.messages.at(-1).content, /export const answer = 42;/);
});

test('task reads a multi-line prompt verbatim from --prompt-file', async () => {
  const server = await startFakeServer(route());
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-prompt-'));
  const promptFile = join(dir, 'prompt.txt');
  writeFileSync(promptFile, 'line one\nline "two"\nline three');
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', '--prompt-file', promptFile], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const chat = server.requests.find((request) => request.url.endsWith('/chat/completions'));
  assert.equal(chat.body.messages.at(-1).content, 'line one\nline "two"\nline three');
});

test('task refuses input that cannot fit the context window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-big-'));
  const file = join(dir, 'big.txt');
  writeFileSync(file, 'x'.repeat(5000));
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'small', contextLength: 2000 } },
  });

  const result = await runCompanion(['task', '--file', file, 'summarize'], { configPath: path });

  assert.equal(result.status, 1);
  // The exact estimate shifts with the system prompt wording; the contract is
  // that both the measured size and the window are named.
  assert.match(result.stderr, /Input is roughly 1\.\dk tokens but small on "local" has a 2\.0k window/);
  assert.match(result.stderr, /Send fewer or smaller files/);
});

test('a requested --max-tokens counts against the window, not the default reserve', async () => {
  // 8k window, ~1.3k of input: fine with the default 1k reserve, but not when
  // the caller explicitly asks for a 7k reply.
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-reserve-'));
  const file = join(dir, 'input.txt');
  writeFileSync(file, 'x'.repeat(5000));
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'small', contextLength: 8192 } },
  });

  const allowed = await runCompanion(['task', '--file', file, 'summarize'], { configPath: path });
  assert.match(allowed.stderr, /Contacting local/, 'should pass the guard with the default reserve');

  const refused = await runCompanion(['task', '--max-tokens', '7000', '--file', file, 'summarize'], { configPath: path });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /reserving 7\.0k for the reply/);
});

test('task warns, but proceeds, when the context window is unknown', async () => {
  const server = await startFakeServer(route());
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Context window unknown for test-model/);
});

test('task fails clearly when the server has no models and none was named', async () => {
  const server = await startFakeServer(route({ models: () => modelList() }));
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Provider "local" reports no available models/);
  assert.match(result.stderr, /pass --model <id>/);
});

test('task fails clearly on a missing file', async () => {
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: 'http://127.0.0.1:1/v1' } } });

  const result = await runCompanion(['task', '--file', '/nope/missing.js', 'explain'], { configPath: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /File not found: \/nope\/missing\.js/);
});

test('task surfaces an HTTP error from the server', async () => {
  const server = await startFakeServer((request, response) => {
    if (request.url.endsWith('/models')) return respondJson(response, modelList('test-model'));
    return respondJson(response, { error: { message: 'model failed to load' } }, 500);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /returned HTTP 500/);
  assert.match(result.stderr, /model failed to load/);
});

test('an unknown flag is rejected rather than sent as prompt text', async () => {
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: 'http://127.0.0.1:1/v1' } } });

  const result = await runCompanion(['task', '--modle', 'x', 'hello'], { configPath: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option "--modle"/);
});

test('an unknown subcommand is rejected', async () => {
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: 'http://127.0.0.1:1/v1' } } });

  const result = await runCompanion(['frobnicate'], { configPath: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command "frobnicate"/);
});

test('a broken config file fails loudly and names the path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-broken-'));
  const path = join(dir, 'providers.json');
  writeFileSync(path, '{ this is not json');

  const result = await runCompanion(['setup'], { configPath: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not valid JSON/);
  assert.ok(result.stderr.includes(path), 'error should name the config path');
});
