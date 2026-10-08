import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProvider } from '../plugins/oai/scripts/lib/delegate.mjs';
import { CONTEXT_SOURCES, windowFor } from '../plugins/oai/scripts/lib/model-info.mjs';
import { planSelection } from '../plugins/oai/scripts/lib/model-selection.mjs';
import {
  chatRequests, completionFrames, respondJson, respondStream, runCompanion, startFakeServer, writeConfig,
} from './helpers.mjs';

// Unsloth Studio lists every model on disk. Only the loaded entry carries
// `context_length`, the budget Studio fitted for it, which sits below the
// architectural `max_context_length`. The listing carries no model type, so each
// loaded model's kind is asked of Studio's check-embedding endpoint. These tests
// drive discovery against a fake Studio and assert every URL sent.

const LOADED = 'lmstudio-community/Qwen3.5-9B-MLX-8bit';
const UNLOADED_A = 'unsloth/Qwen3.8-27B-GGUF';
const UNLOADED_B = 'unsloth/Qwen3.8-4B-GGUF';
const SERVED = 'Qwen3.5-9B-MLX-8bit';
const UNSLOTH_SOURCE = 'Unsloth /v1/models context_length';
const FITTED = 246528;
const CEILING = 262144;

const loadedEntry = (id = LOADED) => ({
  id, object: 'model', owned_by: 'unsloth-studio', context_length: FITTED, native_context_length: CEILING,
  max_context_length: CEILING, context_length_fitted: FITTED, context_length_enforced: false,
  context_unbounded_when_batched: true, parallel_slots: 4, loaded: true,
});
const unloadedEntry = (id) => ({
  id, object: 'model', owned_by: 'unsloth-studio', loaded: false, quant: 'UD-Q4_K_XL',
  display_name: id.split('/').pop(),
});
const listing = (...data) => ({ object: 'list', data });
const mixedListing = () => listing(unloadedEntry(UNLOADED_A), loadedEntry(), unloadedEntry(UNLOADED_B));

const CHECK_PREFIX = '/api/models/check-embedding/';

/** Studio's answer for a chat model, which a fake Studio gives unless a test routes the check itself. */
function chatModelCheck(path, response) {
  return respondJson(response, { model_name: decodeURIComponent(path.slice(CHECK_PREFIX.length)), is_embedding: false });
}

/**
 * Routes keyed on the path before `?`; a function route gets (request, response). An unrouted
 * check-embedding path answers as a chat model; a route of `null` makes it 404. 404 otherwise.
 */
async function discover(routes, { query } = {}) {
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    const route = routes[path];
    if (typeof route === 'function') return route(request, response);
    if (route) return respondJson(response, route);
    if (route === undefined && path.startsWith(CHECK_PREFIX)) return chatModelCheck(path, response);
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

test('the loaded model is sized by the context budget Studio advertises, not its architectural ceiling', async () => {
  const { described, urls } = await discover({ '/v1/models': mixedListing() });
  assert.equal(windowFor(described, LOADED), FITTED);
  assert.equal(described.source, UNSLOTH_SOURCE);
  assert.ok(CONTEXT_SOURCES.has(described.source));
  assert.deepEqual(urls, ['/v1/models', `/api/models/check-embedding/${encodeURIComponent(LOADED)}`]);
  const states = new Map(described.models.map((model) => [model.id, model.state]));
  assert.deepEqual(
    [states.get(UNLOADED_A), states.get(LOADED), states.get(UNLOADED_B)],
    ['not-loaded', 'loaded', 'not-loaded'],
  );
});

const checkPath = (id) => `/api/models/check-embedding/${encodeURIComponent(id)}`;

test('unloaded models, which Studio is never asked the kind of, are named as candidates, not chat models', async () => {
  const EMBED = 'nomic-ai/nomic-embed-text-v1.5';
  const { described } = await discover({ '/v1/models': listing(unloadedEntry(UNLOADED_A), unloadedEntry(EMBED)) });
  assert.equal(planSelection({}, undefined, described).problem.message,
    `This provider offers 2 candidates for a chat request, but none of them is loaded: ${UNLOADED_A}, ${EMBED}.`);
});

test('with a loaded embedder filtered out, the counts name only the candidates', async () => {
  const EMBED = 'nomic-ai/nomic-embed-text-v1.5';
  const B = 'unsloth/Qwen3.8-14B-GGUF';
  const unknown = await discover({
    '/v1/models': listing(loadedEntry(), unloadedEntry(UNLOADED_A), loadedEntry(EMBED)),
    [checkPath(LOADED)]: null,
    [checkPath(EMBED)]: { model_name: EMBED, is_embedding: true },
  });
  assert.equal(planSelection({}, undefined, unknown.described).problem.message,
    `This provider offers 2 candidates for a chat request: ${LOADED}, ${UNLOADED_A}.`);
  const twoLoaded = await discover({
    '/v1/models': listing(loadedEntry(), loadedEntry(B), loadedEntry(EMBED)),
    [checkPath(EMBED)]: { model_name: EMBED, is_embedding: true },
  });
  assert.equal(planSelection({}, undefined, twoLoaded.described).problem.message,
    `This provider has 2 chat models loaded: ${LOADED}, ${B}.`);
});

test('a loaded model Studio says is an embedding model is never chosen as the chat model', async () => {
  const EMBED = 'nomic-ai/nomic-embed-text-v1.5';
  const { described } = await discover({
    '/v1/models': listing(unloadedEntry(UNLOADED_A), loadedEntry(EMBED), unloadedEntry(UNLOADED_B)),
    [checkPath(EMBED)]: { model_name: EMBED, is_embedding: true },
  });
  assert.equal(described.models.find((model) => model.id === EMBED).type, 'embeddings');
  const plan = planSelection({}, undefined, described);
  assert.equal(plan.modelId, undefined);
  assert.match(plan.problem.message, /none of them is loaded/);
});

test('a clear no from Studio keeps the loaded model a chat model', async () => {
  const { described } = await discover({ '/v1/models': mixedListing(), [checkPath(LOADED)]: { model_name: LOADED, is_embedding: false } });
  const loaded = described.models.find((model) => model.id === LOADED);
  assert.equal(loaded.type, undefined);
  assert.equal(loaded.state, 'loaded');
  assert.equal(planSelection({}, undefined, described).modelId, LOADED);
});

test('an embedding check with no clear answer for that model leaves its state unknown, so selection asks', async () => {
  const replies = [
    null, // the check 404s
    { model_name: LOADED, is_embedding: 'true' },
    { model_name: 'someone/else', is_embedding: false },
    { model_name: 'someone/else', is_embedding: true },
  ];
  for (const reply of replies) {
    const { described } = await discover({ '/v1/models': mixedListing(), [checkPath(LOADED)]: reply });
    const loaded = described.models.find((model) => model.id === LOADED);
    assert.equal(loaded.state, undefined, JSON.stringify(reply));
    assert.equal(loaded.type, undefined, JSON.stringify(reply));
    const plan = planSelection({}, undefined, described);
    assert.equal(plan.modelId, undefined, JSON.stringify(reply));
    assert.match(plan.problem.message, /offers 3 candidates for a chat request/, JSON.stringify(reply));
  }
});

test('the embedding check carries the profile query, as a proxy that authenticates by query requires', async () => {
  const EMBED = 'nomic-ai/nomic-embed-text-v1.5';
  const { described, urls } = await discover({
    '/v1/models': listing(unloadedEntry(UNLOADED_A), loadedEntry(EMBED), unloadedEntry(UNLOADED_B)),
    [checkPath(EMBED)]: (request, response) => (request.url.endsWith('?key=k')
      ? respondJson(response, { model_name: EMBED, is_embedding: true })
      : respondJson(response, { error: 'unauthorized' }, 401)),
  }, { query: '?key=k' });
  assert.ok(urls.includes(`${checkPath(EMBED)}?key=k`), urls.join(' '));
  assert.equal(described.models.find((model) => model.id === EMBED).type, 'embeddings');
});

test('an unloaded model is never asked about', async () => {
  const { urls } = await discover({ '/v1/models': listing(unloadedEntry(UNLOADED_A), unloadedEntry(UNLOADED_B)) });
  assert.deepEqual(urls, ['/v1/models']);
});

test('a profile with a query reads the same window under the same source', async () => {
  const { described } = await discover({ '/v1/models': mixedListing() }, { query: '?key=k' });
  assert.equal(windowFor(described, LOADED), FITTED);
  assert.equal(described.source, UNSLOTH_SOURCE);
});

test('with several models on disk, selection picks the one that is loaded', async () => {
  const { described } = await discover({ '/v1/models': mixedListing() });
  const plan = planSelection({}, undefined, described);
  assert.equal(plan.modelId, LOADED);
  assert.equal(plan.because, 'loaded');
});

test('with nothing loaded, selection says none is and no window is detected', async () => {
  const { described } = await discover({
    '/v1/models': listing(unloadedEntry(UNLOADED_A), unloadedEntry(UNLOADED_B)),
  });
  const plan = planSelection({}, undefined, described);
  assert.equal(plan.modelId, undefined);
  assert.match(plan.problem.message, /none of them is loaded/);
  assert.equal(windowFor(described, UNLOADED_A), undefined);
  assert.equal(windowFor(described, UNLOADED_B), undefined);
});

test('an entry that does not say whether it is loaded has no state, and selection does not pick', async () => {
  const unreported = { id: UNLOADED_A, object: 'model', owned_by: 'unsloth-studio' };
  const { described } = await discover({ '/v1/models': listing(loadedEntry(), unreported) });
  assert.equal(described.models.find((model) => model.id === UNLOADED_A).state, undefined);
  const plan = planSelection({}, undefined, described);
  assert.equal(plan.modelId, undefined);
  assert.match(plan.problem.message, /offers 2 candidates for a chat request/);
});

test('a sole loaded model is selected, and a sole unloaded one is not', async () => {
  const loaded = await discover({ '/v1/models': listing(loadedEntry()) });
  assert.equal(planSelection({}, undefined, loaded.described).modelId, LOADED);
  const unloaded = await discover({ '/v1/models': listing(unloadedEntry(UNLOADED_A)) });
  const plan = planSelection({}, undefined, unloaded.described);
  assert.equal(plan.modelId, undefined);
  assert.equal(plan.problem.message, `The one candidate this provider offers for a chat request is not loaded: ${UNLOADED_A}.`);
  const EMBED = 'nomic-ai/nomic-embed-text-v1.5';
  const embedder = await discover({ '/v1/models': listing(unloadedEntry(EMBED)) });
  assert.equal(planSelection({}, undefined, embedder.described).problem.message,
    `The one candidate this provider offers for a chat request is not loaded: ${EMBED}.`);
});

test('filtering out a loaded embedder does not leave its unloaded neighbour picked unasked', async () => {
  const EMBED = 'nomic-ai/nomic-embed-text-v1.5';
  const { described } = await discover({
    '/v1/models': listing(unloadedEntry(UNLOADED_A), loadedEntry(EMBED)),
    [checkPath(EMBED)]: { model_name: EMBED, is_embedding: true },
  });
  const plan = planSelection({}, undefined, described);
  assert.equal(plan.modelId, undefined);
  assert.equal(plan.problem.message, `The one candidate this provider offers for a chat request is not loaded: ${UNLOADED_A}.`);
  // A pinned model is still sent, for Studio to load or refuse.
  assert.equal(planSelection({ defaultModel: UNLOADED_A }, undefined, described).modelId, UNLOADED_A);
});

test('a sole model whose embedding check has no clear answer is not picked unasked', async () => {
  const EMBED = 'nomic-ai/nomic-embed-text-v1.5';
  const cases = [
    { '/v1/models': listing(loadedEntry()), [checkPath(LOADED)]: null },
    { '/v1/models': listing(loadedEntry(), loadedEntry(EMBED)), [checkPath(LOADED)]: null,
      [checkPath(EMBED)]: { model_name: EMBED, is_embedding: true } },
  ];
  for (const routes of cases) {
    const { described } = await discover(routes);
    const plan = planSelection({}, undefined, described);
    assert.equal(plan.modelId, undefined, Object.keys(routes).join(' '));
    assert.equal(plan.problem.message, `No model this provider offers is established as a loaded chat model; the one candidate is ${LOADED}.`);
  }
});

test('an id Studio does not list is refused, and a listed unloaded one is left to the server', async () => {
  const { described } = await discover({ '/v1/models': mixedListing() });
  assert.ok(planSelection({}, 'no-such/model-xyz', described).problem, 'an explicit --model is refused');
  assert.ok(planSelection({ defaultModel: 'no-such/model-xyz' }, undefined, described).problem, 'a configured defaultModel is refused');
  const plan = planSelection({ defaultModel: UNLOADED_A }, undefined, described);
  assert.equal(plan.problem, undefined);
  assert.equal(plan.modelId, UNLOADED_A);
  assert.equal(windowFor(described, UNLOADED_A), undefined);
});

test('a listing Studio owns only part of is not read as Studio', async () => {
  const foreign = { id: 'chat-a', object: 'model', owned_by: 'vllm', max_model_len: 32768 };
  const { described } = await discover({ '/v1/models': listing(loadedEntry(), foreign) });
  assert.notEqual(described.source, UNSLOTH_SOURCE);
  assert.notEqual(windowFor(described, LOADED), FITTED);
});

// --- through the companion ----------------------------------------------------

function studio(handlerForChat) {
  return startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions') && handlerForChat) return handlerForChat(request, response);
    if (path.endsWith('/models')) return respondJson(response, mixedListing());
    if (path.startsWith(CHECK_PREFIX)) return chatModelCheck(path, response);
    return respondJson(response, { error: 'not found' }, 404);
  });
}

test('setup selects the loaded model and shows its detected window, which a configured contextLength overrides', async () => {
  const server = await studio();
  try {
    const detected = writeConfig({ defaultProvider: 'unsloth', providers: { unsloth: { baseUrl: server.baseUrl } } });
    const [row] = JSON.parse((await runCompanion(['setup', '--json'], { configPath: detected.path })).stdout).providers;
    assert.equal(row.selectedModel, LOADED);
    assert.equal(row.selectedModelReason, 'loaded');
    assert.equal(row.contextWindow, FITTED);

    const pinned = writeConfig({
      defaultProvider: 'unsloth',
      providers: { unsloth: { baseUrl: server.baseUrl, contextLength: 61696 } },
    });
    const [pinnedRow] = JSON.parse((await runCompanion(['setup', '--json'], { configPath: pinned.path })).stdout).providers;
    assert.equal(pinnedRow.contextWindow, 61696);
    assert.equal(pinnedRow.detectedWindow, FITTED);
  } finally {
    await server.close();
  }
});

test('a task answered under the bare id completes against the listed id when servedModelIds declares it', async () => {
  const server = await studio((request, response) => respondStream(response, completionFrames('the answer', { model: SERVED })));
  try {
    const { path } = writeConfig({
      defaultProvider: 'unsloth',
      providers: {
        unsloth: { baseUrl: server.baseUrl, timeoutSeconds: 5, retrySeconds: 0, servedModelIds: { [LOADED]: SERVED } },
      },
    });
    const result = await runCompanion(['task', '--json', 'hello'], { configPath: path });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.requestedModel, LOADED);
    assert.equal(report.model, SERVED);
    assert.equal(report.declaredServedModel, SERVED);
    const [sent] = chatRequests(server);
    assert.equal(sent.body.model, LOADED);
  } finally {
    await server.close();
  }
});
