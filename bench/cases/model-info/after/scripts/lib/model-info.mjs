/**
 * Discovering a model's context window.
 *
 * No OpenAI-compatible server reports it in the standard `/v1/models` — the
 * spec's model object is id/created/object/owned_by, so every context field
 * below is a vendor extension. This module is the ONLY place that knows any
 * vendor dialect, and it branches on the *shape of a response*, never on a
 * provider's name (see adr/002).
 *
 * The rule that matters: a probe yields a `window` only when the field is the
 * window actually being SERVED. Fields that report a model's ceiling
 * (LM Studio's max_context_length, llama.cpp's n_ctx_train, Ollama's
 * <arch>.context_length) land in `ceiling`, which is display-only. Guarding on
 * a ceiling silently admits input the server then rejects, which is the exact
 * failure the size guard exists to prevent.
 */

import { authHeaders } from './client.mjs';

const PROBE_TIMEOUT_MS = 2000;

/**
 * Fetch JSON, yielding null for every failure mode — 404, HTML, bad JSON,
 * refused connection, timeout. The chain must be able to try the next dialect
 * without an error escaping.
 */
async function probeJson(url, { headers, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Where a server's non-/v1 endpoints live. Strips a trailing `/v1` so a reverse
 * proxy at `https://host/lmstudio/v1` still resolves to `https://host/lmstudio`.
 */
export function probeRoot(baseUrl) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  const root = path.endsWith('/v1') ? path.slice(0, -3) : path;
  return `${url.origin}${root}`;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** vLLM puts the served length on the standard model object. Costs no extra request. */
function readVllm(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const models = entries
    .filter((entry) => positiveInteger(entry?.max_model_len))
    .map((entry) => ({ id: entry.id, window: entry.max_model_len }));
  return models.length > 0 ? { models, source: 'vLLM /v1/models max_model_len' } : null;
}

/**
 * LM Studio. `loaded_context_length` appears only while a model is loaded; for
 * anything else we know just the ceiling, so the window stays unknown.
 */
function readLmStudio(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  if (!entries.some((entry) => entry?.max_context_length !== undefined)) return null;

  const models = entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    state: entry.state,
    window: entry.state === 'loaded' ? positiveInteger(entry.loaded_context_length) : undefined,
    ceiling: positiveInteger(entry.max_context_length),
  }));
  return { models, source: 'LM Studio /api/v0/models' };
}

/** llama.cpp's /props reports the window it is actually serving (-c). */
function readLlamaCpp(payload) {
  const window = positiveInteger(payload?.default_generation_settings?.n_ctx);
  if (!window) return null;
  // /props describes the one loaded model and does not name it, so the window
  // applies to whatever the server answers with.
  return { models: [], serverWindow: window, source: 'llama.cpp /props n_ctx' };
}

/** Text Generation Inference reports its configured limits at /info. */
function readTgi(payload) {
  const window = positiveInteger(payload?.max_total_tokens);
  if (!window) return null;
  return { models: [], serverWindow: window, source: 'TGI /info max_total_tokens' };
}

/**
 * oMLX. UNVERIFIED: this shape comes from documentation, not from a running
 * server, and it reportedly advertises a global default rather than the model's
 * real window — which is why every detected window is reported with its source.
 */
function readOmlx(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const models = entries
    .filter((entry) => positiveInteger(entry?.max_context_window))
    .map((entry) => ({ id: entry.id, window: entry.max_context_window }));
  return models.length > 0 ? { models, source: 'oMLX /v1/models/status (unverified)' } : null;
}

// Tried in order; the first recognisable shape wins. Each entry is a path
// relative to the probe root plus the reader for that dialect.
const NATIVE_PROBES = [
  { path: '/api/v0/models', read: readLmStudio },
  { path: '/props', read: readLlamaCpp },
  { path: '/info', read: readTgi },
  { path: '/v1/models/status', read: readOmlx },
];

/**
 * Model records for a provider, enriched with a context window wherever one can
 * be established. `models` always lists every id the server offers, even when no
 * dialect was recognised.
 */
export async function describeModels(profile, { modelsPayload, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const ids = Array.isArray(modelsPayload?.data)
    ? modelsPayload.data.map((entry) => (typeof entry === 'string' ? entry : entry?.id)).filter(Boolean)
    : [];

  const free = readVllm(modelsPayload);
  if (free) return merge(ids, free);

  const root = probeRoot(profile.baseUrl);
  const headers = authHeaders(profile);
  for (const probe of NATIVE_PROBES) {
    const payload = await probeJson(`${root}${probe.path}${profile.query ?? ''}`, { headers, timeoutMs });
    if (!payload) continue;
    const detected = probe.read(payload);
    if (detected) return merge(ids, detected);
  }

  return { models: ids.map((id) => ({ id })), source: null };
}

/**
 * The id list from /v1/models is authoritative for what can be requested; a
 * dialect only adds detail to those ids. A server-wide window (llama.cpp, TGI)
 * applies to every model, since those servers serve one at a time.
 */
function merge(ids, detected) {
  const byId = new Map(detected.models.map((model) => [model.id, model]));
  const models = (ids.length > 0 ? ids : detected.models.map((model) => model.id)).map((id) => ({
    id,
    ...byId.get(id),
    ...(detected.serverWindow ? { window: detected.serverWindow } : {}),
  }));
  return { models, source: detected.source };
}

/** The window to guard with, or undefined when only a ceiling (or nothing) is known. */
export function windowFor(described, modelId) {
  return described.models.find((model) => model.id === modelId)?.window;
}

/**
 * The window that will actually be used, and where it came from. Both the human
 * report and `--json` derive from this one function — computing it twice is how
 * two views of the same run end up disagreeing.
 */
export function effectiveWindow({ contextLength, defaultModel } = {}, described) {
  if (contextLength) return { window: contextLength, source: 'config' };
  if (!described) return { window: undefined, source: null };

  const chosen = defaultModel
    ? described.models.find((model) => model.id === defaultModel)
    : onlyCandidate(described);

  if (!chosen) {
    const candidates = chatCandidates(described);
    return { window: undefined, source: null, candidates: candidates.length };
  }
  return {
    window: chosen.window,
    ceiling: chosen.ceiling,
    modelId: chosen.id,
    source: chosen.window ? described.source : null,
    candidates: chatCandidates(described).length,
  };
}

function onlyCandidate(described) {
  const candidates = chatCandidates(described);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Models eligible for automatic selection: everything the server did not call an embedder. */
export function chatCandidates(described) {
  // A denylist, not an allowlist: the loaded chat model on the verification
  // machine reports type "vlm", and future types must keep working.
  return described.models.filter((model) => model.type !== 'embeddings');
}
