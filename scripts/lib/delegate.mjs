// The delegation path shared by every command that sends work to a model:
// which model, how big its window is, and does the request fit.
import { fetchModels, DEFAULT_IDLE_MS, DEFAULT_TIMEOUT_MS } from './client.mjs';
import { checkContextBudget, estimateTokens } from './context-guard.mjs';
import { UserError } from './errors.mjs';
import { MAX_BUDGET_SECONDS } from './http-budgets.mjs';
import { describeModels, windowFor } from './model-info.mjs';
import { planSelection } from './model-selection.mjs';
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
 * A ceiling on `--max-attempts`, for the reason `MAX_BUDGET_SECONDS` exists.
 *
 * Retries multiply an already-unbounded wall clock: without `--max-seconds` a
 * single attempt is up to the first-token budget plus generation that only the
 * idle budget bounds, so a large attempt count is a run nobody can wait out.
 */
export const MAX_ATTEMPTS_CEILING = 10;

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
    // Both bounded above, for the reason MAX_BUDGET_SECONDS states. `--timeout`
    // carried the same latent flaw before this feature existed; it is one
    // expression away and left unfixed only if you decide a known immediate-fire
    // bug is fine next to the one you just closed.
    timeoutSeconds:
      options.timeout === undefined
        ? undefined
        : parseNumber(options.timeout, 'timeout', { min: 1, max: MAX_BUDGET_SECONDS }),
    maxSeconds:
      options['max-seconds'] === undefined
        ? undefined
        : parseNumber(options['max-seconds'], 'max-seconds', { min: 1, max: MAX_BUDGET_SECONDS }),
    // Answer attempts, not physical requests — the two differ, and deliberately.
    // A capability degrade already costs an extra request inside one answer
    // attempt, so capping physical requests at 1 would disable the degrade
    // ladder rather than disabling retry. `1` here means "behave exactly as the
    // plugin did before retry existed", which is what makes it usable as the
    // control arm when measuring how often the server drops a request.
    //
    // Bounded above for the same reason the budgets are: `--max-attempts 1e9` is
    // a typo, and the honest response is a refusal in milliseconds rather than a
    // run nobody can stop.
    maxAttempts:
      options['max-attempts'] === undefined
        ? undefined
        : parseNumber(options['max-attempts'], 'max-attempts', { integer: true, min: 1, max: MAX_ATTEMPTS_CEILING }),
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
 * Which model to send to, and how big its window is.
 *
 * The server is consulted every time, and it did not used to be: a profile
 * answering both questions in config — `defaultModel` plus `contextLength` —
 * skipped the probe entirely, which ADR 002 recorded as a feature. That became
 * untenable the moment `planSelection` could refuse an id for being absent from
 * the catalogue, because `/oai:setup` probes unconditionally and this did not.
 * Same authority, two different inputs: setup printed `reachable, but /oai:task
 * cannot run here` and `No provider can take a task right now`, while the task
 * it was describing ran perfectly well.
 *
 * That is this repo's most-repeated defect class with its sign flipped — the
 * REPO_TRAPS entry says two review rounds produced nine instances of setup
 * promising what a task refused, and that "the cure was a single authority, not
 * a better approximation". Calling one planner is not enough if the two callers
 * feed it different evidence, and the only fix with ONE authority is one input.
 * Teaching setup this function's probing rule would be a second copy of it.
 *
 * The cost is one `/v1/models` GET, against a server the next line is about to
 * post a whole prompt to. `required: mustChooseModel` is unchanged, so a probe
 * that fails is still only fatal when there is no configured model to fall back
 * on. Found by the built-in review, reproduced end to end.
 */
export async function resolveTarget(profile, options) {
  const mustChooseModel = !options.model && !profile.defaultModel;

  // Probing precedes the "Contacting…" line and can stall on an endpoint that
  // black-holes unknown paths, so say what is happening before it starts.
  process.stderr.write(`Checking ${profile.name} for available models and context window...\n`);
  const described = await describeProvider(profile, { required: mustChooseModel });

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

/**
 * The wall-clock cap on the model call, or `undefined` when nobody set one.
 *
 * **No default, deliberately.** The two budgets above have one because a request
 * with no bound at all is a hang; this one is a ceiling on work that is
 * *succeeding*, and a default would be a number picked from the successful runs
 * this repo happens to have observed. That is precisely the shape OAI-15 had to
 * undo on the `analysis` cap, which was set "above every observed successful
 * run" from a sample that had not yet seen a normal run reason long, and spent
 * its life truncating working reviews. So the unset case is the old behaviour,
 * exactly: unbounded once tokens are flowing.
 *
 * `undefined` rather than 0. They behave alike downstream — `armBudgets` gates
 * on `totalMs > 0` — but 0 reads as "instant" to anyone who finds it.
 */
export function resolveMax(profile, maxSeconds) {
  const seconds = maxSeconds ?? profile.maxSeconds;
  return seconds ? seconds * 1000 : undefined;
}

/**
 * The pause before a retry, in milliseconds.
 *
 * Configurable per provider because it is a guess about *that server*: the
 * failures it answers correlate with sustained load, and how long a server needs
 * to recover is a property of the server, not of this plugin. Zero is a
 * meaningful setting — it is what the test suite uses so a retry path costs
 * nothing in wall clock — so `?? `, never `||`, or a deliberate 0 would silently
 * become the default.
 */
export function resolveRetryDelay(profile) {
  const seconds = profile.retrySeconds;
  return seconds === undefined || seconds === null ? undefined : seconds * 1000;
}
