import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProvider } from '../plugins/oai/scripts/lib/delegate.mjs';
import { CONTEXT_SOURCES, windowFor } from '../plugins/oai/scripts/lib/model-info.mjs';
import { planSelection } from '../plugins/oai/scripts/lib/model-selection.mjs';
import { errorReport } from '../plugins/oai/scripts/lib/review-report.mjs';
import { respondJson, startFakeServer } from './helpers.mjs';

// MTPLX lists its one chat model with `max_model_len` set to the configured
// window, which an operator may set above what fits in memory; only `/health`'s
// `execution_window.tokens` is the window it serves. These tests drive discovery
// against a fake MTPLX and assert every URL sent.

const MTPLX_ID = 'mtplx-qwen38-27b-optimized-speed';
const MTPLX_SOURCE = 'MTPLX /health execution_window';
const mtplxModels = (window) => ({
  object: 'list',
  data: [{ id: MTPLX_ID, object: 'model', owned_by: 'mtplx', capability: 'chat',
    context_length: window, max_context_length: window, max_model_len: window }],
});
const mtplxHealth = (tokens) => ({
  status: 'ok', model: MTPLX_ID, context_window: 131072,
  execution_window: { tokens, basis: 'machine_fit', configured_tokens: 131072, machine_fit_tokens: 57344, allow_swap: false },
});

/** Routes keyed on the path before `?`; a function route gets (request, response). 404 otherwise. */
async function discover(routes, { query } = {}) {
  const server = await startFakeServer((request, response) => {
    const route = routes[request.url.split('?')[0]];
    if (typeof route === 'function') return route(request, response);
    if (route) return respondJson(response, route);
    return respondJson(response, { error: 'not found' }, 404);
  });
  try {
    const profile = { name: 'p', baseUrl: server.baseUrl, ...(query ? { query } : {}) };
    const described = await describeProvider(profile);
    return { described, urls: server.requests.map((request) => request.url) };
  } finally {
    await server.close();
  }
}

test('a window configured above the machine fit is read from /health, not the listing', async () => {
  const { described, urls } = await discover({ '/v1/models': mtplxModels(131072), '/health': mtplxHealth(57344) });
  assert.equal(windowFor(described, MTPLX_ID), 57344);
  assert.equal(described.source, MTPLX_SOURCE);
  assert.ok(CONTEXT_SOURCES.has(described.source));
  assert.deepEqual(urls, ['/v1/models', '/health']);
});

test('the default start, where both agree, reports the window under the MTPLX source', async () => {
  const { described } = await discover({ '/v1/models': mtplxModels(57344), '/health': mtplxHealth(57344) });
  assert.equal(windowFor(described, MTPLX_ID), 57344);
  assert.equal(described.source, MTPLX_SOURCE);
});

test('a /health that 404s leaves no window, and the listed model is still chosen', async () => {
  const { described } = await discover({ '/v1/models': mtplxModels(131072) });
  assert.equal(windowFor(described, MTPLX_ID), undefined);
  assert.equal(described.source, null);
  assert.equal(planSelection({}, undefined, described).modelId, MTPLX_ID);
});

test('a /health with no usable execution_window leaves no window', async () => {
  const bodies = [
    { status: 'ok', model: MTPLX_ID },
    mtplxHealth(0),
    mtplxHealth(57344.5),
    mtplxHealth('57344'),
  ];
  for (const health of bodies) {
    const { described } = await discover({ '/v1/models': mtplxModels(131072), '/health': health });
    assert.equal(windowFor(described, MTPLX_ID), undefined, JSON.stringify(health));
  }
});

test('a /health that is not JSON, or that closes without a reply, leaves no window', async () => {
  const routes = [
    (request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('ok'); },
    (request, response) => response.socket.destroy(),
  ];
  for (const health of routes) {
    const { described } = await discover({ '/v1/models': mtplxModels(131072), '/health': health });
    assert.equal(windowFor(described, MTPLX_ID), undefined);
  }
});

test('a vLLM listing is not sent /health', async () => {
  const listing = { object: 'list', data: [{ id: 'chat-a', object: 'model', max_model_len: 32768 }] };
  const { described, urls } = await discover({ '/v1/models': listing, '/health': mtplxHealth(1024) });
  assert.equal(windowFor(described, 'chat-a'), 32768);
  assert.equal(described.source, '/v1/models max_model_len');
  assert.deepEqual(urls, ['/v1/models']);
});

test('a listing MTPLX owns only part of takes the vLLM path, each id its own window', async () => {
  const listing = {
    object: 'list',
    data: [...mtplxModels(131072).data, { id: 'chat-a', object: 'model', owned_by: 'vllm', max_model_len: 32768 }],
  };
  const { described, urls } = await discover({ '/v1/models': listing, '/health': mtplxHealth(57344) });
  assert.equal(windowFor(described, MTPLX_ID), 131072);
  assert.equal(windowFor(described, 'chat-a'), 32768);
  assert.deepEqual(urls, ['/v1/models']);
});

test('an id MTPLX does not list is refused, whether or not /health gave the window', async () => {
  for (const routes of [
    { '/v1/models': mtplxModels(57344), '/health': mtplxHealth(57344) },
    { '/v1/models': mtplxModels(57344) },
  ]) {
    const { described } = await discover(routes);
    assert.ok(planSelection({}, 'qwen-typo', described).problem, 'an explicit --model is refused');
    assert.ok(planSelection({ defaultModel: 'qwen-typo' }, undefined, described).problem, 'a configured defaultModel is refused');
    assert.equal(planSelection({}, MTPLX_ID, described).problem, undefined);
  }
});

test('a profile with a query sends it to /v1/models and /health alike', async () => {
  const { described, urls } = await discover(
    { '/v1/models': mtplxModels(131072), '/health': mtplxHealth(57344) },
    { query: '?key=k' },
  );
  assert.equal(windowFor(described, MTPLX_ID), 57344);
  assert.deepEqual(urls, ['/health', '/v1/models?key=k', '/health?key=k']);
});

test('the MTPLX source survives the failure record', () => {
  assert.equal(errorReport({ message: 'x', contextSource: MTPLX_SOURCE }).contextSource, MTPLX_SOURCE);
});
