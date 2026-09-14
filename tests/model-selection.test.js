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

/**
 * An LM Studio-shaped provider: the dialect's catalogue at `/api/v0/models`
 * beside the ids `/v1/models` lists, which is the pair `merge` joins. The two
 * lists are the same by default, so a test that needs them to differ says so.
 */
function lmStudioServer(entries, ids = entries.map((entry) => entry.id)) {
  return startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) return respondJson(response, { data: entries });
    if (path.endsWith('/models')) return respondJson(response, modelList(...ids));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('answered'));
    return respondJson(response, { error: 'not found' }, 404);
  });
}

/**
 * One catalogue entry. `max_context_length` is what makes the payload
 * recognisable as LM Studio's at all; `state` is left off entirely when none is
 * given, which is the stateless response `readLmStudio` still writes a `state`
 * key for — undefined, but present.
 */
function chatModel(id, state) {
  return {
    id,
    type: 'llm',
    max_context_length: 8192,
    ...(state ? { state } : {}),
    ...(state === 'loaded' ? { loaded_context_length: 4096 } : {}),
  };
}

const localConfig = (server) => writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

test('the model the server reports loaded is the one an unnamed selection picks', async () => {
  const server = await lmStudioServer([
    chatModel('chat-a', 'not-loaded'), chatModel('chat-b', 'loaded'), chatModel('chat-c', 'not-loaded'),
  ]);
  const { path } = localConfig(server);

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const chat = server.requests.find((request) => request.url.endsWith('/chat/completions'));
  assert.equal(chat.body.model, 'chat-b', 'residency is the evidence, so the resident model is what gets sent');
});

test('setup names the evidence for an automatic choice, on both renderings', async () => {
  // "selected: x" alone would read as a preference the config never expressed,
  // and a caveat true on the human path and absent from --json is how two views
  // of one run come to disagree.
  const server = await lmStudioServer([chatModel('chat-a', 'not-loaded'), chatModel('chat-b', 'loaded')]);
  const { path } = localConfig(server);

  const setup = await runCompanion(['setup'], { configPath: path });
  const json = await runCompanion(['setup', '--json'], { configPath: path });
  await server.close();

  assert.match(setup.stdout, /selected: chat-b — the chat model the server reports loaded/);
  assert.match(setup.stdout, /Ready: local/);
  const [provider] = JSON.parse(json.stdout).providers;
  assert.equal(provider.selectedModel, 'chat-b');
  assert.equal(provider.selectedModelReason, 'loaded');
});

test('several chat models with none loaded is a different refusal from having none', async () => {
  // Conflating them is this repo's signature class: one needs a download, the
  // other needs a load.
  const server = await lmStudioServer([
    chatModel('chat-a', 'not-loaded'), chatModel('chat-b', 'not-loaded'), chatModel('chat-c', 'not-loaded'),
  ]);
  const { path } = localConfig(server);

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /offers 3 chat models, but none of them is loaded/);
  assert.doesNotMatch(result.stderr, /no model that can answer a chat request/, 'three of them can; none is resident');
});

test('two loaded models are ambiguous, and only the loaded ones are named', async () => {
  const server = await lmStudioServer([
    chatModel('chat-a', 'loaded'), chatModel('chat-b', 'loaded'), chatModel('chat-c', 'not-loaded'),
  ]);
  const { path } = localConfig(server);

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /has 2 models loaded: chat-a, chat-b/);
  assert.doesNotMatch(result.stderr, /chat-c/, 'a model nobody said was loaded must not be offered as a candidate');
});

test('a catalogue that reports no state at all falls back to naming every candidate', async () => {
  // The subtle one. `readLmStudio` writes `state: entry.state` unconditionally,
  // so the key exists on every LM-Studio-shaped record and key presence proves
  // nothing — reading it as observable would report "none is loaded" about a
  // server that never said.
  const server = await lmStudioServer([chatModel('chat-a'), chatModel('chat-b'), chatModel('chat-c')]);
  const { path } = localConfig(server);

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /offers 3 models: chat-a, chat-b, chat-c/);
  assert.doesNotMatch(result.stderr, /none of them is loaded/, 'nothing measured residency, so nothing may be said about it');
});

test('partial state coverage decides nothing, so nothing is selected', async () => {
  // A candidate whose state is unknown might also be loaded, so a 1-loaded
  // conclusion drawn over an incomplete set asserts something nobody measured.
  const server = await lmStudioServer([chatModel('chat-a', 'loaded'), chatModel('chat-b')]);
  const { path } = localConfig(server);

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /offers 2 models: chat-a, chat-b/);
  assert.doesNotMatch(result.stderr, /none of them is loaded/);
  assert.equal(
    server.requests.filter((request) => request.url.includes('/chat/completions')).length,
    0,
    'the one model with a state must not be sent to on the strength of an incomplete set',
  );
});

test('a loosely joined id is never selected as the loaded one', async () => {
  // The second half of `statesUsable`. The loose `matchKey` join is conservative
  // for the embeddings denylist — a loose hit can only ADD an exclusion — but as
  // a routing decision it would send `qwen@4bit` on the strength of the server
  // reporting `qwen` resident: an id no evidence covers. Same data, two trust
  // levels.
  const server = await lmStudioServer(
    [chatModel('chat-a', 'not-loaded'), chatModel('qwen', 'loaded')],
    ['chat-a', 'qwen@4bit'],
  );
  const { path } = localConfig(server);

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /offers 2 models: chat-a, qwen@4bit/);
  assert.equal(
    server.requests.filter((request) => request.url.includes('/chat/completions')).length,
    0,
    'an id the dialect never named must not be sent as the resident model',
  );
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
