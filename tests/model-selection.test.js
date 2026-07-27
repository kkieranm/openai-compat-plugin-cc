// Which model a task will use, and whether setup agrees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completion, modelList, respondJson, runCompanion, startFakeServer, writeConfig } from "./helpers.mjs";

test('task fails clearly when the server has no models and none was named', async () => {
  const server = await startFakeServer((request, response) => {
    if (request.url.split('?')[0].endsWith('/models')) return respondJson(response, modelList());
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Provider "local": This provider offers no model that can answer a chat request/);
  assert.match(result.stderr, /pass --model <id>/);
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

test('a server that does not serve /v1/models is not called unreachable', async () => {
  // It answers chat requests, so telling the user to restart it would be wrong.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('worked'));
    return respondJson(response, { error: 'no such endpoint' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'm', contextLength: 8192 } },
  });

  const setup = await runCompanion(['setup'], { configPath: path });
  const task = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(task.status, 0, 'the task works, so setup must not say the provider is down');
  assert.match(setup.stdout, /Ready: local/);
  assert.match(setup.stdout, /does not serve a model list/);
});

test('an id spelled differently across endpoints keeps its type', async () => {
  // A quantization suffix on one endpoint and not the other dropped `type`,
  // and a record with no type passes the embeddings denylist trivially.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'nomic-embed-text-v1.5', type: 'embeddings', state: 'loaded', max_context_length: 2048 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('nomic-embed-text-v1.5@f32'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1, 'an embedder must not be chosen just because the ids differ in spelling');
  assert.match(result.stderr, /no model that can answer a chat request/);
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
