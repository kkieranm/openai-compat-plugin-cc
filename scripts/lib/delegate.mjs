// The delegation path shared by every command that sends work to a model:
// which model, how big its window is, and does the request fit.
import { fetchModels, DEFAULT_IDLE_MS, DEFAULT_TIMEOUT_MS } from './client.mjs';
import { checkContextBudget, estimateTokens } from './context-guard.mjs';
import { UserError } from './errors.mjs';
import { describeModels, planSelection, windowFor } from './model-info.mjs';
import { buildMessages, DEFAULT_SYSTEM_PROMPT } from './prompt.mjs';

export const PROBE_TIMEOUT_MS = 5000;

// `min` is inclusive: temperature 0 is the standard value for deterministic
// sampling, so it must be accepted even though timeouts must exceed zero.
export function parseNumber(raw, flag, { integer = false, min, max } = {}) {
  const value = Number(raw);
  const valid =
    Number.isFinite(value) &&
    (!integer || Number.isInteger(value)) &&
    (min === undefined || value >= min) &&
    (max === undefined || value <= max);

  if (!valid) {
    const range = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
    throw new UserError(`--${flag} must be ${integer ? 'an integer' : 'a number'} ${range}, got "${raw}".`);
  }
  return value;
}

/**
 * Validate every numeric flag before any network work, so a bad flag fails in
 * milliseconds instead of after a round trip that was never going to be used.
 * The window covers prompt + completion, so --max-tokens is also the headroom
 * the guard must reserve.
 */
export function parseNumericOptions(options) {
  return {
    maxTokens:
      options['max-tokens'] === undefined
        ? undefined
        : parseNumber(options['max-tokens'], 'max-tokens', { integer: true, min: 1 }),
    temperature:
      options.temperature === undefined ? undefined : parseNumber(options.temperature, 'temperature', { min: 0, max: 2 }),
    timeoutSeconds: options.timeout === undefined ? undefined : parseNumber(options.timeout, 'timeout', { min: 1 }),
  };
}

/**
 * Model records for a provider, fetched once and reused for both selection and
 * the context window.
 */
export async function describeProvider(profile, { required = true } = {}) {
  try {
    const modelsPayload = await fetchModels(profile, { timeoutMs: PROBE_TIMEOUT_MS });
    return await describeModels(profile, { modelsPayload });
  } catch (error) {
    // Choosing a model needs the list, so that failure is fatal. Merely sizing
    // the window does not: a server that cannot list models (or 404s /models
    // entirely) must still take the task, with the window left unknown and
    // warned about — the behaviour that existed before detection.
    if (required || !(error instanceof UserError)) throw error;
    return { models: [], source: null };
  }
}

export function selectModel(profile, explicit, described) {
  const plan = planSelection(profile, explicit, described);
  if (plan.problem) {
    throw new UserError(`Provider "${profile.name}": ${plan.problem.message}`, { hint: plan.problem.hint });
  }
  return plan.modelId;
}

/**
 * Which model to send to, and how big its window is. The server is consulted
 * only for what the config does not already answer, so a fully configured
 * profile performs no probes at all.
 */
export async function resolveTarget(profile, options) {
  const mustChooseModel = !options.model && !profile.defaultModel;
  const mustDetectWindow = !profile.contextLength;

  let described = { models: [], source: null };
  if (mustChooseModel || mustDetectWindow) {
    // Probing precedes the "Contacting…" line and can stall on an endpoint that
    // black-holes unknown paths, so say what is happening before it starts.
    process.stderr.write(`Checking ${profile.name} for available models and context window...\n`);
    described = await describeProvider(profile, { required: mustChooseModel });
  }

  const model = selectModel(profile, options.model, described);
  return { model, contextLength: profile.contextLength ?? windowFor(described, model) };
}

/**
 * Assemble the request and prove it fits the window before anything is sent.
 */
export function prepareRequest({
  profile,
  prompt,
  files,
  model,
  contextLength,
  maxTokens,
  minReserve,
  system,
  oversizeHint,
}) {
  const messages = buildMessages({ system: system ?? DEFAULT_SYSTEM_PROMPT, prompt, files });
  const estimatedTokens = estimateTokens(messages.map((message) => message.content).join('\n'));

  // With a floor set, the reply budget yields to the input rather than the
  // input being refused. A generous fixed reserve otherwise withholds the
  // window from the prompt on behalf of a reply that usually never arrives —
  // and refuses work that would have fit comfortably with a shorter answer.
  // Never below the floor: past that the reply is too small to be worth having,
  // and the refusal should name the floor so it describes the real limit.
  let reserve = maxTokens;
  if (minReserve && contextLength && maxTokens) {
    const available = contextLength - estimatedTokens;
    if (available < maxTokens) reserve = Math.max(minReserve, available);
  }

  const budget = checkContextBudget({
    estimatedTokens,
    contextLength,
    reserveTokens: reserve,
    providerName: profile.name,
    model,
    oversizeHint,
  });

  return { messages, estimatedTokens, budget, reserve };
}

/**
 * How long to wait for the model's *first token* — connect and prefill, which
 * are legitimately silent. It used to mean total wall clock, and meant nothing
 * above five minutes: undici capped it at 300s regardless (ADR 007).
 */
export function resolveTimeout(profile, timeoutSeconds) {
  if (timeoutSeconds) return timeoutSeconds * 1000;
  return (profile.timeoutSeconds ?? 0) * 1000 || DEFAULT_TIMEOUT_MS;
}

/**
 * How long a gap between tokens may be once output has started. Separate from
 * the above because the two silences mean different things: a long prefill is
 * normal, whereas a model that began answering and then stopped has stalled.
 */
export function resolveIdle(profile, idleSeconds) {
  if (idleSeconds) return idleSeconds * 1000;
  return (profile.idleSeconds ?? 0) * 1000 || DEFAULT_IDLE_MS;
}
