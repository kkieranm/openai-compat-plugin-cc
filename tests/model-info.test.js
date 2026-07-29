import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeModels, probeRoot, windowFor } from '../scripts/lib/model-info.mjs';
import { chatCandidates } from '../scripts/lib/model-selection.mjs';
import { respondJson, startFakeServer } from './helpers.mjs';

const OPENAI_MODELS = { object: 'list', data: [{ id: 'chat-a', object: 'model', owned_by: 'x' }] };

/** A server that answers only the given native paths, 404ing everything else. */
function nativeServer(routes) {
  return (request, response) => {
    const path = request.url.split('?')[0];
    if (routes[path]) return respondJson(response, routes[path]);
    return respondJson(response, { error: 'not found' }, 404);
  };
}

async function describeAgainst(routes, modelsPayload = OPENAI_MODELS) {
  const server = await startFakeServer(nativeServer(routes));
  try {
    const profile = { name: 'p', baseUrl: server.baseUrl };
    return await describeModels(profile, { modelsPayload, timeoutMs: 1500 });
  } finally {
    await server.close();
  }
}

test('probeRoot strips a trailing /v1 so proxied mounts still resolve', () => {
  assert.equal(probeRoot('http://localhost:1234/v1'), 'http://localhost:1234');
  assert.equal(probeRoot('https://host/lmstudio/v1'), 'https://host/lmstudio');
  assert.equal(probeRoot('http://localhost:8080/api/v0'), 'http://localhost:8080/api/v0');
});

test('LM Studio: a loaded model yields its served window, not its ceiling', async () => {
  const described = await describeAgainst({
    '/api/v0/models': {
      data: [
        { id: 'chat-a', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 58112 },
      ],
    },
  });

  assert.equal(described.source, 'LM Studio /api/v0/models');
  assert.equal(windowFor(described, 'chat-a'), 58112, 'must use loaded_context_length');
  assert.equal(described.models[0].ceiling, 262144);
});

test('LM Studio: a model that is not loaded has no known window', async () => {
  // Only the ceiling is reported before a JIT load, and the window it will
  // actually get is not knowable in advance.
  const described = await describeAgainst({
    '/api/v0/models': {
      data: [{ id: 'chat-a', type: 'llm', state: 'not-loaded', max_context_length: 262144 }],
    },
  });

  assert.equal(windowFor(described, 'chat-a'), undefined, 'a ceiling must never become a window');
  assert.equal(described.models[0].ceiling, 262144);
});

test('no ceiling reaches the window on any path', async () => {
  // Each of these carries a plausible-looking number that is NOT the window the
  // server is serving. The guard divides by `window`, so a leak here silently
  // admits input the server rejects.
  const leaky = {
    'still loading': { id: 'm', state: 'loading', max_context_length: 131072, loaded_context_length: 4096 },
    'loaded but no served length': { id: 'm', state: 'loaded', max_context_length: 131072 },
    'nonsense zero': { id: 'm', state: 'loaded', loaded_context_length: 0, max_context_length: 131072 },
    'non-numeric': { id: 'm', state: 'loaded', loaded_context_length: '8192', max_context_length: 131072 },
  };

  for (const [label, entry] of Object.entries(leaky)) {
    const described = await describeAgainst({ '/api/v0/models': { data: [entry] } }, { data: [{ id: 'm' }] });
    assert.equal(windowFor(described, 'm'), undefined, `${label}: must stay unknown`);
  }
});

test('vLLM is read from the models payload we already fetched, with no extra request', async () => {
  const server = await startFakeServer(nativeServer({}));
  const described = await describeModels(
    { name: 'p', baseUrl: server.baseUrl },
    {
      modelsPayload: { object: 'list', data: [{ id: 'chat-a', max_model_len: 8192 }] },
      timeoutMs: 1500,
    },
  );
  await server.close();

  assert.equal(described.source, 'vLLM /v1/models max_model_len');
  assert.equal(windowFor(described, 'chat-a'), 8192);
  assert.equal(server.requests.length, 0, 'the free path must not probe native endpoints');
});

test('llama.cpp /props gives a server-wide window that applies to the served model', async () => {
  const described = await describeAgainst({
    '/props': { default_generation_settings: { n_ctx: 4096 }, total_slots: 1 },
  });

  assert.equal(described.source, 'llama.cpp /props n_ctx');
  assert.equal(windowFor(described, 'chat-a'), 4096);
});

test('TGI /info reports its configured total', async () => {
  const described = await describeAgainst({ '/info': { max_total_tokens: 16384 } });

  assert.equal(described.source, 'TGI /info max_total_tokens');
  assert.equal(windowFor(described, 'chat-a'), 16384);
});

test('oMLX is read, and its source says the shape is unverified', async () => {
  const described = await describeAgainst({
    '/v1/models/status': { data: [{ id: 'chat-a', max_context_window: 32768 }] },
  });

  assert.equal(windowFor(described, 'chat-a'), 32768);
  assert.match(described.source, /unverified/);
});

test('an unrecognised server still lists its models, with no window', async () => {
  const described = await describeAgainst({});

  assert.equal(described.source, null);
  assert.deepEqual(described.models, [{ id: 'chat-a' }]);
  assert.equal(windowFor(described, 'chat-a'), undefined);
});

test('a probe that answers HTML or nonsense is ignored rather than throwing', async () => {
  const server = await startFakeServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html>not json</html>');
  });
  const described = await describeModels({ name: 'p', baseUrl: server.baseUrl }, { modelsPayload: OPENAI_MODELS, timeoutMs: 1500 });
  await server.close();

  assert.equal(described.source, null);
  assert.deepEqual(described.models, [{ id: 'chat-a' }]);
});

test('embedding models are excluded from automatic selection, other types are kept', async () => {
  // Denylist, not allowlist: the real chat model reports type "vlm".
  const described = await describeAgainst(
    {
      '/api/v0/models': {
        data: [
          { id: 'embed-1', type: 'embeddings', state: 'not-loaded', max_context_length: 2048 },
          { id: 'chat-a', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 58112 },
        ],
      },
    },
    { object: 'list', data: [{ id: 'embed-1' }, { id: 'chat-a' }] },
  );

  assert.deepEqual(
    chatCandidates(described).map((model) => model.id),
    ['chat-a'],
  );
});
