import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProvider } from '../plugins/oai/scripts/lib/delegate.mjs';
import { UserError } from '../plugins/oai/scripts/lib/errors.mjs';
import { windowFor } from '../plugins/oai/scripts/lib/model-info.mjs';
import { respondJson, startFakeServer } from './helpers.mjs';

// The vMLX desktop gateway answers only the exact paths `/health` and
// `/v1/models` itself and routes every other request — `/v1/models?…` included —
// to a session, reloading a sleeping model. These tests drive the whole
// discovery sequence and assert every URL sent, query included.

const VMLX_ID = 'lmstudio-community/Qwen3.8-27B-MLX-4bit';
const VMLX_MODELS = { object: 'list', data: [{ id: VMLX_ID, object: 'model', owned_by: 'vmlx-engine' }] };
const vmlxGateway = (status) => ({
  status: 'ok', gateway_port: 8080, active_requests: 0, single_model_mode: true,
  backends: [{ id: 'b1', model: VMLX_ID, status, port: 8001 }],
});
const VLLM_MODELS = { object: 'list', data: [{ id: 'chat-a', object: 'model', max_model_len: 32768 }] };
const vmlxCapabilities = { id: VMLX_ID, loaded_model: VMLX_ID, max_prompt_tokens: 129049 };
const vmlxEngine = {
  status: 'healthy', model_loaded: true, model_name: VMLX_ID, served_model_name: null,
  engine_type: 'batched', max_prompt_tokens: 64000,
};

/** Routes keyed on the path before `?`; a function route gets (request, response). 404 otherwise. */
async function discover(routes, { query = '?key=k', required = true } = {}) {
  const server = await startFakeServer((request, response) => {
    const route = routes[request.url.split('?')[0]];
    if (typeof route === 'function') return route(request, response);
    if (route) return respondJson(response, route);
    return respondJson(response, { error: 'not found' }, 404);
  });
  try {
    const profile = { name: 'p', baseUrl: server.baseUrl, ...(query ? { query } : {}) };
    const outcome = await describeProvider(profile, { required }).then(
      (described) => ({ described }),
      (error) => ({ error }),
    );
    return { ...outcome, urls: server.requests.map((request) => request.url) };
  } finally {
    await server.close();
  }
}

test('a sleeping vMLX gateway with a query is sent /health and a query-free /v1/models, nothing else', async () => {
  const { described, urls } = await discover({
    '/health': vmlxGateway('standby'),
    '/v1/models': VMLX_MODELS,
    '/v1/capabilities': vmlxCapabilities,
  });
  assert.deepEqual(urls, ['/health', '/v1/models']);
  assert.deepEqual(described.models.map((model) => model.id), [VMLX_ID]);
  assert.equal(windowFor(described, VMLX_ID), undefined);
});

test('a running vMLX gateway with a query has every discovery request sent without it', async () => {
  const { described, urls } = await discover({
    '/health': vmlxGateway('running'),
    '/v1/models': VMLX_MODELS,
    '/v1/capabilities': vmlxCapabilities,
  });
  assert.deepEqual(urls, ['/health', '/v1/models', '/v1/capabilities']);
  assert.equal(windowFor(described, VMLX_ID), 129049);
  assert.equal(described.source, 'vMLX max_prompt_tokens');
});

test('the bare vMLX engine with a query is read from /health and a query-free /v1/models', async () => {
  const { described, urls } = await discover({ '/health': vmlxEngine, '/v1/models': VMLX_MODELS });
  assert.deepEqual(urls, ['/health', '/v1/models']);
  assert.equal(windowFor(described, VMLX_ID), 64000);
});

test('a proxy that refuses the query-free /v1/models with 401 or 403 gets it resent with the query, which is then kept', async () => {
  for (const status of [401, 403]) {
    const gated = (payload) => (request, response) =>
      request.url.includes('key=k') ? respondJson(response, payload) : respondJson(response, { error: 'refused' }, status);
    const { described, urls } = await discover({
      '/health': vmlxGateway('running'),
      '/v1/models': gated(VMLX_MODELS),
      '/v1/capabilities': gated(vmlxCapabilities),
    });
    assert.deepEqual(urls, ['/health', '/v1/models', '/v1/models?key=k', '/v1/capabilities?key=k'], `${status}`);
    assert.equal(windowFor(described, VMLX_ID), 129049, `${status}`);
  }
});

test('any other status for the query-free /v1/models is not resent, since the resend would wake the model', async () => {
  for (const status of [302, 404, 407, 500, 503]) {
    const { error, urls } = await discover({
      '/health': vmlxGateway('standby'),
      '/v1/models': (request, response) => respondJson(response, { error: 'no' }, status),
    });
    assert.deepEqual(urls, ['/health', '/v1/models'], `${status}`);
    assert.equal(error?.status, status, `${status}`);
    assert.ok(error instanceof UserError, `${status}`);
    assert.equal(error.serverResponded, true, `${status}`);
  }
});

test('when the resend is refused too, its error is reported, and optional discovery still degrades', async () => {
  const routes = {
    '/health': vmlxGateway('standby'),
    '/v1/models': (request, response) =>
      respondJson(response, { error: 'refused' }, request.url.includes('key=k') ? 403 : 401),
  };
  const { error, urls } = await discover(routes);
  assert.deepEqual(urls, ['/health', '/v1/models', '/v1/models?key=k']);
  assert.equal(error?.status, 403, 'the resend describes the configured request');
  assert.ok(error instanceof UserError);

  const optional = await discover(routes, { required: false });
  assert.deepEqual(optional.described, { models: [], source: null });
});

test('a query-free /v1/models that fails without an HTTP status is not resent', async () => {
  const routes = {
    '/health': vmlxGateway('running'),
    '/v1/models': (request, response) => response.socket.destroy(),
  };
  const { error, urls } = await discover(routes);
  assert.ok(error instanceof UserError);
  assert.deepEqual(urls, ['/health', '/v1/models']);

  const optional = await discover(routes, { required: false });
  assert.deepEqual(optional.urls, ['/health', '/v1/models']);
  assert.deepEqual(optional.described, { models: [], source: null });
});

test('a server that is not vMLX keeps its query, and /health is sent once', async () => {
  const lmStudio = {
    data: [{ id: 'chat-a', type: 'llm', state: 'loaded', max_context_length: 262144, loaded_context_length: 58112 }],
  };
  const { described, urls } = await discover({
    '/health': (request, response) => respondJson(response, { error: 'Unexpected endpoint or method. (GET /health)' }, 404),
    '/v1/models': { object: 'list', data: [{ id: 'chat-a', object: 'model' }] },
    '/api/v0/models': lmStudio,
  });
  assert.deepEqual(urls, ['/health', '/v1/models?key=k', '/api/v0/models?key=k']);
  assert.equal(windowFor(described, 'chat-a'), 58112);
});

test('an inconclusive /health leaves the server unidentified: the query is kept and probing ends', async () => {
  const { described, urls } = await discover({
    '/health': (request, response) => response.socket.destroy(),
    '/v1/models': VMLX_MODELS,
    '/api/v0/models': { data: [{ id: VMLX_ID, state: 'loaded', loaded_context_length: 4096 }] },
  });
  assert.deepEqual(urls, ['/health', '/v1/models?key=k']);
  assert.equal(windowFor(described, VMLX_ID), undefined);
});

test('a vLLM-shaped listing with a query still yields its window after a non-vMLX /health', async () => {
  const { described, urls } = await discover({
    '/health': (request, response) => response.writeHead(200).end(),
    '/v1/models': VLLM_MODELS,
  });
  assert.deepEqual(urls, ['/health', '/v1/models?key=k']);
  assert.equal(windowFor(described, 'chat-a'), 32768);
});

test('a profile without a query is listed before /health is read', async () => {
  const vmlx = await discover(
    { '/health': vmlxGateway('running'), '/v1/models': VMLX_MODELS, '/v1/capabilities': vmlxCapabilities },
    { query: '' },
  );
  assert.deepEqual(vmlx.urls, ['/v1/models', '/health', '/v1/capabilities']);
  assert.equal(windowFor(vmlx.described, VMLX_ID), 129049);

  const vllm = await discover(
    { '/v1/models': VLLM_MODELS },
    { query: '' },
  );
  assert.deepEqual(vllm.urls, ['/v1/models']);
});
