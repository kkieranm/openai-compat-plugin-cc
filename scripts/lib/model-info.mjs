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

import { readJson } from './body.mjs';
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

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** vLLM puts the served length on the standard model object. Costs no extra request. */
function readVllm(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const models = entries
    .filter((entry) => positiveInteger(entry?.max_model_len))
    .map((entry) => ({ id: entry.id, window: entry.max_model_len }));
  // NAMES THE FIELD, NOT A VENDOR (corrected 2026-08-09, against a running oMLX).
  //
  // This said "vLLM /v1/models max_model_len". `max_model_len` is a convention
  // vLLM popularised, not a fingerprint — oMLX 0.5.7 publishes it too — and this
  // reader runs FIRST, so the plugin reported "detected via vLLM" for a server
  // that is not vLLM. A correct number under a wrong provenance is exactly what
  // this repo's "a fact names its source" rule exists against; here the source
  // line was itself the guess. The order stays (a window already in hand costs no
  // round trip); what it buys is the window, not a claim about the product.
  return models.length > 0 ? { models, source: '/v1/models max_model_len' } : null;
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
 * oMLX. **VERIFIED 2026-08-09 against a running oMLX 0.5.7.** This said
 * "UNVERIFIED: from documentation, not a running server", and the doubt was
 * earned: the documented shape was HALF wrong. Per-entry `max_context_window` is
 * right; the ENVELOPE is not — oMLX returns `{final_ceiling, model_count,
 * loaded_count, models: [...]}`, so entries sit under `models`, never `data`, and
 * reading only `data` made this return null against every real oMLX there has
 * been. The failure was INVISIBLE because the cheaper `max_model_len` lens above
 * detects the same window, so the plugin printed a right number with a wrong
 * source. The unit test could not catch it either: it was written from the same
 * documentation as the code and asserted the same mistake.
 *
 * `data` is still accepted — dropping it would swap a verified shape for an
 * unverified assumption pointing the other way.
 */
function readOmlx(payload) {
  const entries = [payload?.models, payload?.data, payload].find(Array.isArray) ?? [];
  const models = entries
    .filter((entry) => positiveInteger(entry?.max_context_window))
    .map((entry) => ({ id: entry.id, window: entry.max_context_window }));
  return models.length > 0 ? { models, source: 'oMLX /v1/models/status' } : null;
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
  // narrower — filtered, aliased or permission-scoped. adr/011 says in as many
  // words that absence from a bare /v1/models list is not evidence; this is
  // what keeps that true. Found by the lean review, reproduced end to end.
  //
  // Not every dialect's list is exhaustive, and that is safe rather than
  // overlooked: `readVllm` and `readOmlx` keep only entries carrying a window,
  // so their ids are a FILTERED view. Both build from the `/v1/models` payload
  // itself, so what they filter out is still in `ids` above and still in the
  // union `unservedProblem` tests — the two halves cover each other. Only
  // `readLmStudio` can contribute an id `/v1/models` lacks, and it filters
  // nothing. So there is no id this pair can both miss while the server would
  // serve it. Raised as a completeness-provenance gap; kept as is because no
  // failing case exists, and a `catalogueComplete` flag would be ceremony
  // asserting something no caller could act on.
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
      source: 'config',
      modelId: plan.modelId,
      // Why that model, not just which. An auto-selected id is a fact with a
      // source, and adr/002's rule is that a fact names its source so a guess
      // never reads as a measurement. Carried on every branch that carries
      // `modelId`, because a caveat true on one path and absent from the next is
      // how two views of one run come to disagree.
      because: plan.because,
      detected: chosen?.window && chosen.window !== configured ? chosen.window : undefined,
      problem: plan.problem,
    };
  }
  // `modelId` and `because` here too, and the comment above is exactly why this
  // branch was wrong to omit them. A server that is up but serves no
  // `/v1/models` reaches here with `described: null` and a `defaultModel` the
  // planner resolves happily — so the text report printed `ok` and listed the
  // provider under "Ready:" while `--json` reported `selectedModel: null`. Two
  // views of one run disagreeing about whether a model had even been chosen,
  // which is the defect the line above declares itself against. Found by the
  // built-in review, reproduced by execution.
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
