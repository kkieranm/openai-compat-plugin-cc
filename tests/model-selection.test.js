// Which model gets chosen, and how big its context window is believed to be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completion, modelList, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

test('task fails clearly when the server has no models and none was named', async () => {
  const server = await startFakeServer((request, response) => {
    if (request.url.split('?')[0].endsWith('/models')) return respondJson(response, modelList());
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Provider "local" offers no model that can answer a chat request/);
  assert.match(result.stderr, /pass --model <id>/);
});

test('setup reports the window of the model a task would use, not any loaded model', async () => {
  // defaultModel names an unloaded model while a different one is loaded.
  // Reporting the loaded model's window would promise a guard that task,
  // which will run the unloaded model, does not actually have.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [
          { id: 'loaded-one', type: 'llm', state: 'loaded', max_context_length: 131072, loaded_context_length: 58112 },
          { id: 'wanted-one', type: 'llm', state: 'not-loaded', max_context_length: 131072 },
        ],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('loaded-one', 'wanted-one'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'wanted-one' } },
  });

  const result = await runCompanion(['setup'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /58\.1k/, 'must not report another model’s window');
  assert.match(result.stdout, /only a 131\.1k ceiling for wanted-one/);
});

test('a window that cannot be detected does not stop the task', async () => {
  // With defaultModel set, only the window is missing. A server that cannot
  // list models must still take the work, warning about the unknown window —
  // the behaviour that existed before detection.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('ran anyway'));
    return respondJson(response, { error: 'no models endpoint here' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'm' } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ran anyway/);
  assert.match(result.stdout, /Context window unknown for m/);
});

test('setup --json reports the same window the text report does', async () => {
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'only-chat', type: 'llm', state: 'loaded', max_context_length: 131072, loaded_context_length: 8192 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('only-chat'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const text = await runCompanion(['setup'], { configPath: path });
  const json = await runCompanion(['setup', '--json'], { configPath: path });
  await server.close();

  assert.match(text.stdout, /context: 8\.2k \(detected via LM Studio/);
  const report = JSON.parse(json.stdout).providers[0];
  assert.equal(report.contextWindow, 8192, 'json must not under-report a guard the text report claims');
  assert.match(report.contextSource, /LM Studio/);
});

test('setup does not call an embeddings-only provider ready', async () => {
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'embed-only', type: 'embeddings', state: 'loaded', max_context_length: 2048, loaded_context_length: 2048 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('embed-only'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const setup = await runCompanion(['setup'], { configPath: path });
  const task = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  // setup must not promise what task then refuses.
  assert.doesNotMatch(setup.stdout, /Ready: local/);
  assert.match(setup.stdout, /no model that can answer a chat request/);
  assert.equal(task.status, 1);
});

test('an embedding model is never chosen automatically', async () => {
  // The chat model here is type "vlm", so selection must exclude embedders
  // rather than allowlist a "llm" type.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [
          { id: 'text-embedding-nomic', type: 'embeddings', state: 'not-loaded', max_context_length: 2048 },
          { id: 'qwen-chat', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 58112 },
        ],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('text-embedding-nomic', 'qwen-chat'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('picked correctly'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const chat = server.requests.find((request) => request.url.endsWith('/chat/completions'));
  assert.equal(chat.body.model, 'qwen-chat');
});

test('the detected window arms the guard with no contextLength configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-detect-'));
  const file = join(dir, 'big.txt');
  writeFileSync(file, 'x'.repeat(40_000)); // ~10k tokens, over an 8k window

  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'only-chat', type: 'llm', state: 'loaded', max_context_length: 131072, loaded_context_length: 8192 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('only-chat'));
    return respondJson(response, completion('should never be reached'));
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', '--file', file, 'summarize'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  // The 8.2k loaded window, not the 131.1k ceiling.
  assert.match(result.stderr, /has a 8\.2k window/);
  assert.equal(
    server.requests.some((request) => request.url.endsWith('/chat/completions')),
    false,
    'must refuse before sending',
  );
});

test('a ceiling-only server leaves the guard disarmed rather than guessing', async () => {
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      // Not loaded: only a ceiling is known.
      return respondJson(response, {
        data: [{ id: 'only-chat', type: 'llm', state: 'not-loaded', max_context_length: 131072 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('only-chat'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('ran anyway'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Context window unknown for only-chat/);
});

test('several candidate models with none named is refused, listing them', async () => {
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/models')) return respondJson(response, modelList('chat-a', 'chat-b'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /offers 2 models: chat-a, chat-b/);
  assert.match(result.stderr, /Pass --model <id>/);
});
