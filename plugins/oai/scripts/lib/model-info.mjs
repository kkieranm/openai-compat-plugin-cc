/**
 * Discovering a model's context window.
 *
 * No OpenAI-compatible server reports it in the standard `/v1/models` — the
 * spec's model object is id/created/object/owned_by, so every context field
 * below is a vendor extension. This module is the ONLY place that knows any
 * vendor dialect, and it branches on the *shape of a response*, never on a
 * provider's name.
 *
 * The rule that matters: a probe yields a `window` only when the field is the
 * window actually being SERVED. Fields that report a model's ceiling
 * (LM Studio's max_context_length, llama.cpp's n_ctx_train, Ollama's
 * <arch>.context_length) land in `ceiling`, which is display-only. Guarding on
 * a ceiling silently admits input the server then rejects, which is the exact
 * failure the size guard exists to prevent.
 */

import { readJson, readText } from './body.mjs';
import { authHeaders } from './client.mjs';
import { send } from './http.mjs';
import { planSelection } from './model-selection.mjs';

const PROBE_TIMEOUT_MS = 2000;

/**
 * Fetch JSON, yielding null for every failure mode — 404, HTML, bad JSON,
 * refused connection, timeout. The chain must be able to try the next dialect
 * without an error escaping.
 *
 * `totalMs` as well as `firstByteMs`, because this is a probe, not a model call:
 * a server that dribbles a byte every second must not hold `/oai:setup` open,
 * and setup awaits every provider before it prints anything.
 */
async function probeJson(url, { headers, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  try {
    const response = await send(url, { headers, firstByteMs: timeoutMs, totalMs: timeoutMs });
    if (response.status < 200 || response.status >= 300) {
      response.dispose();
      return null;
    }
    return await readJson(response, 'probe');
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

export function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

// The source string each dialect reader below stamps on a detected window, and
// the `'config'` an operator-asserted `contextLength` carries. Named as constants
// so `CONTEXT_SOURCES` is built from the very values the readers emit — the set
// cannot drift from its producers — and `review-report.mjs` can validate a
// persisted `contextSource` against exactly what `effectiveWindow` can report,
// refusing a foreign string rather than serializing it into `jobs.db`.
const SOURCE_CONFIG = 'config';
const SOURCE_VLLM = '/v1/models max_model_len';
const SOURCE_LMSTUDIO = 'LM Studio /api/v0/models';
const SOURCE_LLAMACPP = 'llama.cpp /props n_ctx';
const SOURCE_TGI = 'TGI /info max_total_tokens';
const SOURCE_OMLX = 'oMLX /v1/models/status';
const SOURCE_VMLX = 'vMLX max_prompt_tokens';
export const CONTEXT_SOURCES = new Set([SOURCE_CONFIG, SOURCE_VLLM, SOURCE_LMSTUDIO, SOURCE_LLAMACPP, SOURCE_TGI, SOURCE_OMLX, SOURCE_VMLX]);

/** vLLM puts the served length on the standard model object. Costs no extra request. */
function readVllm(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const models = entries
    .filter((entry) => positiveInteger(entry?.max_model_len))
    .map((entry) => ({ id: entry.id, window: entry.max_model_len }));
  // NAMES THE FIELD, NOT A VENDOR (checked against a running oMLX).
  //
  // `max_model_len` is a convention vLLM popularised, not a fingerprint — oMLX
  // 0.5.7 publishes it too — and this reader runs FIRST, so naming the vendor
  // would report "detected via vLLM" for a server that is not vLLM. A correct
  // number under a wrong provenance is exactly what this repo's "a fact names its
  // source" rule exists against. The order stays (a window already in hand costs
  // no round trip); what it buys is the window, not a claim about the product.
  return models.length > 0 ? { models, source: SOURCE_VLLM } : null;
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
  return { models, source: SOURCE_LMSTUDIO };
}

/** llama.cpp's /props reports the window it is actually serving (-c). */
function readLlamaCpp(payload) {
  const window = positiveInteger(payload?.default_generation_settings?.n_ctx);
  if (!window) return null;
  // /props describes the one loaded model and does not name it, so the window
  // applies to whatever the server answers with.
  return { models: [], serverWindow: window, source: SOURCE_LLAMACPP };
}

/** Text Generation Inference reports its configured limits at /info. */
function readTgi(payload) {
  const window = positiveInteger(payload?.max_total_tokens);
  if (!window) return null;
  return { models: [], serverWindow: window, source: SOURCE_TGI };
}

/**
 * oMLX. **VERIFIED against a running oMLX 0.5.7.** The documented shape is HALF
 * wrong. Per-entry `max_context_window` is right; the ENVELOPE is not — oMLX
 * returns `{final_ceiling, model_count, loaded_count, models: [...]}`, so
 * entries sit under `models`, never `data`, and reading only `data` would
 * return null against every real oMLX. That failure would be INVISIBLE because
 * the cheaper `max_model_len` lens above detects the same window first and
 * reports it under its own correct source, so against a real oMLX a broken
 * reader here goes unnoticed in the plugin's own output.
 *
 * `data` is still accepted — dropping it would swap a verified shape for an
 * unverified assumption pointing the other way.
 */
function readOmlx(payload) {
  const entries = [payload?.models, payload?.data, payload].find(Array.isArray) ?? [];
  const models = entries
    .filter((entry) => positiveInteger(entry?.max_context_window))
    .map((entry) => ({ id: entry.id, window: entry.max_context_window }));
  return models.length > 0 ? { models, source: SOURCE_OMLX } : null;
}

/**
 * `/health`, reporting whether the reply was conclusive: `{ conclusive, payload }`.
 * A non-2xx status is conclusive (unless `send()` refuses the reply first), and
 * so is a 2xx body read to its end, JSON or not (`payload` is null when it is
 * not JSON). A request that fails, or a body that is cut, stalls or cannot be
 * decoded, is not: it says nothing about what is listening. The body is read
 * whole, under the probe's own time budget, because a truncated read would pass
 * for a complete non-JSON one.
 */
async function probeHealth(url, { headers, timeoutMs }) {
  let response;
  try {
    response = await send(url, { headers, firstByteMs: timeoutMs, totalMs: timeoutMs });
  } catch {
    return { conclusive: false, payload: null };
  }
  if (response.status < 200 || response.status >= 300) {
    response.dispose();
    return { conclusive: true, payload: null };
  }
  let text;
  try {
    text = await readText(response);
  } catch {
    return { conclusive: false, payload: null };
  }
  try {
    return { conclusive: true, payload: JSON.parse(text) };
  } catch {
    return { conclusive: true, payload: null };
  }
}

/**
 * vMLX, read from `/health` so that probing does not wake it. The desktop app's
 * gateway reloads a sleeping model for a request it routes to a session —
 * `/v1/capabilities` and `/props` among them — while it answers `/health` and
 * `/v1/models` itself; on a machine that holds one model at a time, a probe that
 * loads a model is not a read. So a recognised vMLX ends the probe chain whether
 * or not a window was found, and `/health` is sent without the profile's query
 * string, which would turn it into a routed request. The guarantee is for a
 * baseUrl that reaches the gateway at its own root without a query string: with
 * a query, `fetchModels` has already sent `/v1/models?…`, which the gateway
 * routes.
 *
 * The other native probes run only on evidence that the server is not vMLX: a
 * non-2xx `/health`, or a complete one of another shape. A `/health` that fails
 * or breaks off ends probing with the window unknown for this run — so a server
 * whose `/health` never completes in time loses its detected window every run.
 *
 * Two shapes. The gateway lists its sessions as backends with a status; it is
 * asked for `/v1/capabilities` only when every listed backend is `running`,
 * because remote sessions are listed alongside local ones without a type, and a
 * standby local session would be woken. A backend can still idle into standby
 * between the two requests; that race is not visible from outside vMLX. The
 * bare engine (`vmlx-serve`) carries the figure in `/health` itself, valid only
 * while `model_loaded`: an engine in standby still reports the last value.
 *
 * `max_prompt_tokens` is the prompt cap vMLX enforces before prefill — estimated
 * from free memory when the model loads and clamped to the model's declared
 * context, or set by `--max-prompt-tokens`. Using a prompt cap as the whole
 * window is conservative: whatever the guard admits has a prompt under it. An
 * explicit `--max-prompt-tokens` above the model's declared context is published
 * unclamped and cannot be caught here, since vMLX publishes no declared context;
 * by default vMLX refuses those prompts (`prompt_too_long`). An absent or null
 * cap leaves the window unknown.
 *
 * Returns null to let the other probes run, otherwise `{ detected }`, where
 * `detected` is null when no window and model id could be read without waking
 * the server.
 */
async function probeVmlx(root, { headers, timeoutMs, query = '' }) {
  const { conclusive, payload: health } = await probeHealth(`${root}/health`, { headers, timeoutMs });
  const vmlx = (window, id) => ({
    detected: window && typeof id === 'string' && id ? { models: [{ id, window }], source: SOURCE_VMLX } : null,
  });
  if (!conclusive) return vmlx();

  if (typeof health?.model_loaded === 'boolean' && typeof health?.engine_type === 'string') {
    const window = health.model_loaded ? positiveInteger(health.max_prompt_tokens) : undefined;
    return vmlx(window, health.served_model_name || health.model_name);
  }

  if (Array.isArray(health?.backends) && health?.gateway_port !== undefined) {
    const running = health.backends.length > 0 && health.backends.every((backend) => backend?.status === 'running');
    if (!running) return vmlx();
    const capabilities = await probeJson(`${root}/v1/capabilities${query}`, { headers, timeoutMs });
    return vmlx(positiveInteger(capabilities?.max_prompt_tokens), capabilities?.loaded_model || capabilities?.id);
  }

  return null;
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
  // First, because a recognised vMLX must receive no other native probe.
  const vmlx = await probeVmlx(root, { headers, timeoutMs, query: profile.query ?? '' });
  if (vmlx) {
    if (!vmlx.detected) return unrecognised(ids);
    // The one model vMLX reports is not a catalogue to refuse other names
    // against: its gateway matches a requested name loosely.
    const { catalogueIds, ...described } = merge(ids, vmlx.detected);
    return described;
  }
  for (const probe of NATIVE_PROBES) {
    const payload = await probeJson(`${root}${probe.path}${profile.query ?? ''}`, { headers, timeoutMs });
    if (!payload) continue;
    const detected = probe.read(payload);
    if (detected) return merge(ids, detected);
  }

  return unrecognised(ids);
}

function unrecognised(ids) {
  return { models: ids.map((id) => ({ id })), source: null };
}

/**
 * The id list from /v1/models is authoritative for what can be requested; a
 * dialect only adds detail to those ids. A server-wide window (llama.cpp, TGI)
 * applies to every model, since those servers serve one at a time.
 */
// The same model is spelled differently across a server's own endpoints — a
// quantization suffix on one side, different case on the other. An exact-match
// join drops `type` for those, and a record with no type passes the embeddings
// denylist trivially, which would put a chat request to an embedding model.
function matchKey(id) {
  return String(id).toLowerCase().split('@')[0].trim();
}

function merge(ids, detected) {
  const byId = new Map(detected.models.map((model) => [model.id, model]));
  const byKey = new Map(detected.models.map((model) => [matchKey(model.id), model]));
  const authoritative = ids.length > 0 ? ids : detected.models.map((model) => model.id);

  const models = authoritative.map((id) => {
    // How the record was joined, because the loose join is trustworthy for some
    // uses of it and not others. It is conservative for the `type` denylist — a
    // loose hit can only ADD an embedder exclusion — but a routing decision made
    // on it would send an id no evidence covers: a /v1/models offering
    // `qwen@4bit` while the dialect reports `qwen` as loaded must not be
    // selected as "the loaded one". Same data, two trust levels; see
    // `statesUsable` in model-selection.mjs.
    const exact = byId.get(id);
    return {
      ...(exact ?? byKey.get(matchKey(id)) ?? {}),
      // Keep the spelling the chat endpoint accepts, not the dialect's.
      id,
      exactMatch: Boolean(exact),
      ...(detected.serverWindow ? { window: detected.serverWindow } : {}),
    };
  });
  // The ids the DIALECT itself enumerated, carried separately because `models`
  // above is keyed on the /v1/models list and drops anything that list omits.
  //
  // Two jobs, and both need this rather than a boolean. It says whether the
  // dialect published a catalogue at all — llama.cpp's /props and TGI's /info
  // are recognised and carry a server-wide window while publishing
  // `models: []`, and those servers ignore the requested model name entirely,
  // so refusing an id absent from a catalogue nobody published would break a
  // working setup. And it is half of what `unservedProblem` tests membership
  // against: gating on "the dialect published a catalogue" while checking
  // "is it in the bare /v1/models list" mixes two sources in one decision, and
  // would refuse a model the dialect reports as `loaded` whenever /v1/models is
  // narrower — filtered, aliased or permission-scoped. Absence from a bare
  // /v1/models list is not evidence a model isn't loaded; this is what keeps
  // that true.
  return { models, source: detected.source, catalogueIds: detected.models.map((model) => model.id) };
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
export function effectiveWindow(profile = {}, described, explicitModel) {
  const configured = positiveInteger(profile.contextLength);
  const plan = planSelection(profile, explicitModel, described);
  const chosen = plan.modelId ? described?.models?.find((model) => model.id === plan.modelId) : undefined;

  if (configured) {
    // Report the conflict where it is known. A stale configured value outranks
    // detection silently, which is how a guard ends up sized to a window the
    // server is no longer serving.
    return {
      window: configured,
      source: SOURCE_CONFIG,
      modelId: plan.modelId,
      // Why that model, not just which. An auto-selected id is a fact with a
      // source, and a fact names its source so a guess never reads as a
      // measurement. Carried on every branch that carries
      // `modelId`, because a caveat true on one path and absent from the next is
      // how two views of one run come to disagree.
      because: plan.because,
      detected: chosen?.window && chosen.window !== configured ? chosen.window : undefined,
      problem: plan.problem,
    };
  }
  // `modelId` and `because` here too, for exactly the reason the comment above
  // gives. A server that is up but serves no `/v1/models` reaches here with
  // `described: null` and a `defaultModel` the planner resolves happily — so
  // without them the text report would print `ok` and list the provider under
  // "Ready:" while `--json` reported `selectedModel: null`. Two views of one run
  // disagreeing about whether a model had even been chosen, which is the defect
  // the line above declares itself against.
  if (!described) {
    return { window: undefined, source: null, modelId: plan.modelId, because: plan.because, problem: plan.problem };
  }

  return {
    window: chosen?.window,
    ceiling: chosen?.ceiling,
    modelId: plan.modelId,
    because: plan.because,
    source: chosen?.window ? described.source : null,
    problem: plan.problem,
  };
}
