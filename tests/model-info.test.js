import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_SOURCES, describeModels, probeRoot, windowFor } from '../plugins/oai/scripts/lib/model-info.mjs';
import { chatCandidates, planSelection } from '../plugins/oai/scripts/lib/model-selection.mjs';
import { respondJson, startFakeServer } from './helpers.mjs';

const OPENAI_MODELS = { object: 'list', data: [{ id: 'chat-a', object: 'model', owned_by: 'x' }] };

/** A server that answers only the given native paths, 404ing everything else. */
function nativeServer(routes) {
  return (request, response) => {
    const path = request.url.split('?')[0];
    if (typeof routes[path] === 'function') return routes[path](response);
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

  // NOT "vLLM ...". `max_model_len` is a field convention, not a fingerprint:
  // oMLX publishes it too, and this reader runs first, so a vLLM label would name
  // the wrong product for every server that is not vLLM.
  assert.equal(described.source, '/v1/models max_model_len');
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

// CAPTURED FROM A RUNNING oMLX 0.5.7, trimmed to the fields this reader touches
// plus enough envelope to be recognisable. Not the DOCUMENTED `{data: [...]}`
// shape, which a real oMLX does not serve here: a fixture written from the same
// source as the implementation cannot falsify it.
const OMLX_STATUS = {
  final_ceiling: 30111512115,
  model_count: 1,
  loaded_count: 0,
  models: [{
    id: 'mlx-community--Qwen3-14B-4bit',
    loaded: false,
    is_loading: false,
    estimated_size: 8723293439,
    model_context_length: 40960,
    max_context_window: 40960,
    max_tokens: 32768,
    model_type: 'llm',
    source_repo_id: 'mlx-community/Qwen3-14B-4bit',
  }],
};

// The real `/v1/models` beside it, captured in the same session. oMLX puts
// `max_model_len` here too, so the `max_model_len` lens detects the same window
// and reports it under its own source — which is how a broken oMLX reader would
// go unnoticed at runtime.
const OMLX_MODELS = {
  object: 'list',
  data: [{
    id: 'mlx-community--Qwen3-14B-4bit', object: 'model', owned_by: 'omlx', max_model_len: 40960,
  }],
};

test('oMLX is read from the REAL envelope, whose entries are under `models`', async () => {
  const described = await describeAgainst({ '/v1/models/status': OMLX_STATUS }, OMLX_MODELS);

  assert.equal(windowFor(described, 'mlx-community--Qwen3-14B-4bit'), 40960);
  // The window is right, and BOTH lenses agree on it — which is precisely why a
  // broken reader would go unnoticed at runtime. What must never come back is
  // the provenance claim: this server is oMLX, and nothing here may call it
  // vLLM.
  assert.doesNotMatch(described.source, /vLLM/);
  assert.doesNotMatch(described.source, /unverified/);
});

test('the oMLX envelope is read when nothing cheaper answers', async () => {
  // Same status payload, but /v1/models carries no max_model_len — so the native
  // probe is reached and its own source is what gets reported.
  const described = await describeAgainst(
    { '/v1/models/status': OMLX_STATUS },
    { object: 'list', data: [{ id: 'mlx-community--Qwen3-14B-4bit', object: 'model' }] },
  );

  assert.equal(windowFor(described, 'mlx-community--Qwen3-14B-4bit'), 40960);
  assert.equal(described.source, 'oMLX /v1/models/status');
});

test('THE NEGATIVE TWIN: `data` is still accepted, so the oMLX reader is not one guess swapped for another', async () => {
  const described = await describeAgainst({
    '/v1/models/status': { data: [{ id: 'chat-a', max_context_window: 32768 }] },
  });

  assert.equal(windowFor(described, 'chat-a'), 32768);
});

test('an oMLX envelope carrying no window is DECLINED, not reported as zero', async () => {
  // The empty-but-successful probe: mlx_lm.server returns HTTP 200 with
  // `{object: 'list', data: []}` on this path. A reader that
  // treated that as an answer would shadow the working /v1/models.
  const described = await describeAgainst({
    '/v1/models/status': { object: 'list', data: [] },
  });

  assert.equal(windowFor(described, 'chat-a'), undefined);
  assert.doesNotMatch(described.source ?? '', /oMLX/);
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

// --- vMLX -------------------------------------------------------------------

const VMLX_ID = 'lmstudio-community/Qwen3.8-27B-MLX-4bit';
const VMLX_MODELS = { object: 'list', data: [{ id: VMLX_ID, object: 'model', owned_by: 'vmlx-engine' }] };
// Trimmed from vMLX 1.6.73's desktop gateway (:8080) and engine (:8001).
const vmlxGateway = (status) => ({
  status: 'ok', gateway_port: 8080, active_requests: 0, single_model_mode: true,
  backends: [{ id: 'b1', model: VMLX_ID, status, port: 8001 }],
});
const vmlxCapabilities = (maxPromptTokens) => ({
  id: VMLX_ID, loaded_model: VMLX_ID, family: 'qwen3_5', max_prompt_tokens: maxPromptTokens,
});
const vmlxEngine = (modelLoaded, maxPromptTokens) => ({
  status: 'healthy', model_loaded: modelLoaded, model_name: VMLX_ID, served_model_name: null,
  engine_type: 'batched', max_prompt_tokens: maxPromptTokens,
});

/** Like describeAgainst, but also returns the paths (and raw urls) the server was asked for. */
async function describeRecording(routes, modelsPayload = VMLX_MODELS, { query = '' } = {}) {
  const server = await startFakeServer(nativeServer(routes));
  try {
    const profile = { name: 'p', baseUrl: server.baseUrl, ...(query ? { query } : {}) };
    const described = await describeModels(profile, { modelsPayload, timeoutMs: 1500 });
    const urls = server.requests.map((request) => request.url);
    return { described, urls, paths: urls.map((url) => url.split('?')[0]) };
  } finally {
    await server.close();
  }
}

test('vMLX gateway with a running backend: the served prompt cap is the window', async () => {
  const { described, paths } = await describeRecording({
    '/health': vmlxGateway('running'),
    '/v1/capabilities': vmlxCapabilities(129049),
  });

  assert.equal(windowFor(described, VMLX_ID), 129049);
  assert.equal(described.source, 'vMLX max_prompt_tokens');
  assert.ok(CONTEXT_SOURCES.has(described.source));
  assert.deepEqual(paths, ['/health', '/v1/capabilities']);
});

test('a vMLX gateway is asked for capabilities only when every listed backend is running', async () => {
  // Remote sessions are listed beside local ones with no type, so one running
  // backend says nothing about a standby local one that the request would wake.
  const mixed = vmlxGateway('running');
  mixed.backends.push({ id: 'b2', model: 'other', status: 'standby', port: 8002 });
  const empty = { ...vmlxGateway('running'), backends: [] };
  for (const [label, health] of [['mixed', mixed], ['empty', empty]]) {
    const { described, paths } = await describeRecording({ '/health': health, '/v1/capabilities': vmlxCapabilities(129049) });
    assert.deepEqual(paths, ['/health'], label);
    assert.equal(windowFor(described, VMLX_ID), undefined, label);
  }
});

test('/health is sent without the profile query, which would make the vMLX gateway route it', async () => {
  const { urls } = await describeRecording(
    { '/health': vmlxGateway('running'), '/v1/capabilities': vmlxCapabilities(129049) },
    VMLX_MODELS,
    { query: '?key=k' },
  );
  assert.deepEqual(urls, ['/health', '/v1/capabilities?key=k']);
});

test('a /health that fails or breaks off ends probing, since it shows nothing about what is listening', async () => {
  const everyOtherPath = {
    '/api/v0/models': { data: [{ id: VMLX_ID, state: 'loaded', max_context_length: 262144, loaded_context_length: 4096 }] },
    '/props': { default_generation_settings: { n_ctx: 4096 } },
  };
  const broken = {
    'no answer': (response) => response.socket.destroy(),
    'body cut after headers': (response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"status":');
      setImmediate(() => response.socket.destroy());
    },
    'undecodable reply': (response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      response.end('x');
    },
  };
  for (const [label, health] of Object.entries(broken)) {
    const { described, paths } = await describeRecording({ ...everyOtherPath, '/health': health });
    assert.deepEqual(paths, ['/health'], `${label}: the probes a vMLX gateway would route are not sent`);
    assert.equal(windowFor(described, VMLX_ID), undefined, label);
  }
});

test('a complete /health of another shape, or a non-2xx one, lets the other probes run', async () => {
  const everyOtherPath = {
    '/api/v0/models': { data: [{ id: VMLX_ID, state: 'loaded', max_context_length: 262144, loaded_context_length: 4096 }] },
  };
  const elsewhere = {
    'a 404': (response) => respondJson(response, { error: 'Unexpected endpoint or method. (GET /health)' }, 404),
    'an empty 200': (response) => {
      response.writeHead(200);
      response.end();
    },
    'a non-JSON 200': (response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('OK');
    },
  };
  for (const [label, health] of Object.entries(elsewhere)) {
    const { described, paths } = await describeRecording({ ...everyOtherPath, '/health': health });
    assert.deepEqual(paths, ['/health', '/api/v0/models'], label);
    assert.equal(windowFor(described, VMLX_ID), 4096, label);
  }
});

test('a sleeping vMLX gateway is sent /health and nothing else, so probing does not wake it', async () => {
  // Every other native path is served here, so a probe that fell through or
  // ran first would be answered — and recorded.
  const { described, paths } = await describeRecording({
    '/health': vmlxGateway('standby'),
    '/v1/capabilities': vmlxCapabilities(129049),
    '/api/v0/models': { data: [{ id: VMLX_ID, state: 'loaded', max_context_length: 262144, loaded_context_length: 4096 }] },
    '/props': { default_generation_settings: { n_ctx: 4096 } },
    '/info': { max_total_tokens: 4096 },
    '/v1/models/status': { models: [{ id: VMLX_ID, max_context_window: 4096 }] },
  });

  assert.deepEqual(paths, ['/health']);
  assert.equal(windowFor(described, VMLX_ID), undefined);
  assert.equal(described.source, null);
});

test('the bare vMLX engine is read from /health alone, and only while its model is loaded', async () => {
  const loaded = await describeRecording({ '/health': vmlxEngine(true, 129049), '/v1/capabilities': vmlxCapabilities(1) });
  assert.equal(windowFor(loaded.described, VMLX_ID), 129049);
  assert.deepEqual(loaded.paths, ['/health']);

  // In standby the engine still reports the last cap; it is not a served window.
  const asleep = await describeRecording({ '/health': vmlxEngine(false, 129049) });
  assert.equal(windowFor(asleep.described, VMLX_ID), undefined);
  assert.deepEqual(asleep.paths, ['/health']);
});

test('an empty served-model alias on the engine falls back to the model name', async () => {
  const health = { ...vmlxEngine(true, 129049), served_model_name: '' };
  const { described } = await describeRecording({ '/health': health });
  assert.equal(windowFor(described, VMLX_ID), 129049);
});

test('capabilities that name the model only by id still give the window', async () => {
  const capabilities = { ...vmlxCapabilities(129049), loaded_model: '' };
  const { described } = await describeRecording({ '/health': vmlxGateway('running'), '/v1/capabilities': capabilities });
  assert.equal(windowFor(described, VMLX_ID), 129049);
});

test('a vMLX that names no model claims no window', async () => {
  const health = { ...vmlxEngine(true, 129049), served_model_name: '', model_name: '' };
  const { described } = await describeRecording({ '/health': health });
  // The source is what can fail here: a window filed under an empty id joins
  // no listed model, so `windowFor` alone would read undefined either way.
  assert.equal(described.source, null);
  assert.equal(windowFor(described, VMLX_ID), undefined);
});

test('a /health is taken for vMLX only on its distinguishing fields', async () => {
  const everyOtherPath = { '/props': { default_generation_settings: { n_ctx: 4096 } } };
  const lookalikes = {
    'model_loaded without engine_type': { model_loaded: true, model_name: VMLX_ID, max_prompt_tokens: 129049 },
    'backends without gateway_port': { status: 'ok', backends: [{ model: VMLX_ID, status: 'standby' }] },
  };
  for (const [label, health] of Object.entries(lookalikes)) {
    const { described, paths } = await describeRecording({ ...everyOtherPath, '/health': health });
    assert.notEqual(described.source, 'vMLX max_prompt_tokens', label);
    assert.ok(paths.includes('/props'), `${label}: not recognised, so the other probes run`);
  }
});

test('an engine /health without a cap (vMLX omits it when there is no session limit) leaves the window unknown', async () => {
  const health = vmlxEngine(true, 1);
  delete health.max_prompt_tokens;
  const { described, paths } = await describeRecording({ '/health': health });
  assert.equal(windowFor(described, VMLX_ID), undefined);
  assert.deepEqual(paths, ['/health']);
});

test('a vMLX cap of null or 0 (no session limit), or not a positive integer, leaves the window unknown', async () => {
  for (const cap of [null, 0, -1]) {
    const gateway = await describeRecording({ '/health': vmlxGateway('running'), '/v1/capabilities': vmlxCapabilities(cap) });
    assert.equal(windowFor(gateway.described, VMLX_ID), undefined, `gateway cap ${cap}`);
    const engine = await describeRecording({ '/health': vmlxEngine(true, cap) });
    assert.equal(windowFor(engine.described, VMLX_ID), undefined, `engine cap ${cap}`);
  }
});

test('a detected vMLX window does not make the plugin refuse names the gateway accepts', async () => {
  // The gateway matches a requested name loosely, so the one model it reports
  // is no catalogue: a name accepted while vMLX sleeps is accepted while it runs.
  for (const status of ['running', 'standby']) {
    const { described } = await describeRecording({ '/health': vmlxGateway(status), '/v1/capabilities': vmlxCapabilities(129049) });
    assert.equal(planSelection({ defaultModel: 'qwen3.8-27b' }, undefined, described).problem, undefined, status);
    assert.equal(planSelection({}, VMLX_ID, described).problem, undefined, status);
  }
  // The window attaches to the model as /v1/models names it; a loose name gets none.
  const { described } = await describeRecording({ '/health': vmlxGateway('running'), '/v1/capabilities': vmlxCapabilities(129049) });
  assert.equal(windowFor(described, VMLX_ID), 129049);
  assert.equal(windowFor(described, 'qwen3.8-27b'), undefined);
});

test('an explicit vMLX cap above the model\'s own context is adopted as published', async () => {
  // vMLX publishes no declared context, so a `--max-prompt-tokens 65536` on a
  // 32k model reads as 65,536 here; by default vMLX itself refuses such prompts
  // (`prompt_too_long`).
  const { described } = await describeRecording({ '/health': vmlxGateway('running'), '/v1/capabilities': vmlxCapabilities(65536) });
  assert.equal(windowFor(described, VMLX_ID), 65536);
});

test('a /health that is not vMLX\'s leaves the other probes to run in order', async () => {
  const { described, paths } = await describeRecording(
    { '/health': { status: 'ok' }, '/v1/models/status': { models: [{ id: 'chat-a', max_context_window: 32768 }] } },
    OPENAI_MODELS,
  );
  assert.equal(windowFor(described, 'chat-a'), 32768);
  assert.deepEqual(paths, ['/health', '/api/v0/models', '/props', '/info', '/v1/models/status']);
});
