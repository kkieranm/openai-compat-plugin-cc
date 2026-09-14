#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { assertNoFlagsInPrompt, parseCommandLine } from './lib/args.mjs';
import { chatCompletion, DEFAULT_TIMEOUT_MS, fetchModels } from './lib/client.mjs';
import { describeModels, effectiveWindow, planSelection, windowFor } from './lib/model-info.mjs';
import { buildProfile, loadConfig, resolveProfile } from './lib/config.mjs';
import { checkContextBudget, estimateTokens } from './lib/context-guard.mjs';
import { UserError } from './lib/errors.mjs';
import { buildMessages, DEFAULT_SYSTEM_PROMPT, readFileBlocks, readStdin } from './lib/prompt.mjs';
import { renderSetupReport, renderTaskFooter } from './lib/render.mjs';

const PROBE_TIMEOUT_MS = 5000;

const TASK_SPEC = {
  valueFlags: ['provider', 'base-url', 'model', 'prompt-file', 'system', 'timeout', 'max-tokens', 'temperature'],
  repeatableFlags: ['file'],
};

// `min` is inclusive: temperature 0 is the standard value for deterministic
// sampling, so it must be accepted even though timeouts must exceed zero.
function parseNumber(raw, flag, { integer = false, min, max } = {}) {
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
 * setup is a report: one unusable profile must become a row with an error, not
 * abort the whole command. Profile construction can itself throw (bad baseUrl,
 * unset apiKeyEnv), so it happens inside the guard too.
 */
async function probeProvider(name, rawProfile) {
  let profile;
  try {
    profile = buildProfile(name, rawProfile);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    // `built: false` — nothing about this profile's credential was resolved, so
    // the report must not claim its key is missing.
    return { profile: { name, baseUrl: rawProfile?.baseUrl ?? '(no baseUrl)' }, rawProfile, models: [], error, built: false };
  }

  try {
    const described = await describeProvider(profile);
    return { profile, rawProfile, built: true, models: described.models.map((model) => model.id), described };
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    // A server that answers but does not serve /v1/models is up, and a task
    // with a configured model still runs against it. Reporting that as
    // unreachable would tell the user to restart a server that is working.
    if (error.serverResponded) {
      return { profile, rawProfile, built: true, models: [], described: null, listUnavailable: error.message };
    }
    return { profile, rawProfile, built: true, models: [], error };
  }
}

async function runSetup(argv) {
  const { options } = parseCommandLine(argv, { booleanFlags: ['json'] });
  const { path, config, created } = loadConfig();
  const results = await Promise.all(
    Object.entries(config.providers).map(([name, rawProfile]) => probeProvider(name, rawProfile)),
  );

  if (options.json) {
    // Never emit apiKey — only whether one is configured.
    const providers = results.map(({ profile, rawProfile, models, error, described }) => {
      // Derived from the same resolver the text report uses; computing it
      // separately is how the two views come to disagree about the same run.
      const resolved = effectiveWindow(profile, described);
      return {
        name: profile.name,
        baseUrl: profile.baseUrl,
        reachable: !error,
        error: error ? error.message : null,
        models,
        defaultModel: profile.defaultModel ?? null,
        contextLength: profile.contextLength ?? null,
        contextWindow: resolved.window ?? null,
        contextSource: resolved.source ?? null,
        detectedWindow: resolved.detected ?? null,
        // The model a task would use, or why it could not pick one — from the
        // same planner the text report and the task path use.
        selectedModel: resolved.modelId ?? null,
        cannotDelegate: resolved.problem?.message ?? null,
        hasApiKey: Boolean(profile.apiKey),
        apiKeyEnv: rawProfile?.apiKeyEnv ?? null,
      };
    });
    process.stdout.write(`${JSON.stringify({ configPath: path, created, defaultProvider: config.defaultProvider, providers }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderSetupReport({ configPath: path, created, results, defaultProvider: config.defaultProvider })}\n`);
}

function resolvePrompt(options, inlinePrompt, terminated) {
  const inline = inlinePrompt.trim();

  if (options['prompt-file']) {
    // Silently preferring one over the other loses half the request.
    if (inline) {
      throw new UserError(`--prompt-file was given alongside request text ("${inline.slice(0, 60)}").`, {
        hint: 'Pass one or the other, so it is unambiguous which text is the request.',
      });
    }
    try {
      return readFileSync(options['prompt-file'], 'utf8').trim();
    } catch (error) {
      throw new UserError(`Could not read --prompt-file ${options['prompt-file']}: ${error.message}`);
    }
  }

  if (inline) {
    // After an explicit `--` the flag region is closed by the user's own
    // instruction, so a flag-looking word is plainly part of the request.
    if (!terminated) assertNoFlagsInPrompt(inline, TASK_SPEC);
    return inline;
  }
  const piped = process.stdin.isTTY ? '' : readStdin().trim();
  if (piped) return piped;
  throw new UserError('No prompt given.', {
    hint: 'Pass the request as text, or use --prompt-file <path> for multi-line prompts.',
  });
}

/**
 * Model records for a provider, fetched once and reused for both selection and
 * the context window.
 */
async function describeProvider(profile, { required = true } = {}) {
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

function selectModel(profile, explicit, described) {
  const plan = planSelection(profile, explicit, described);
  if (plan.problem) {
    throw new UserError(`Provider "${profile.name}": ${plan.problem.message}`, { hint: plan.problem.hint });
  }
  return plan.modelId;
}

/**
 * Assemble the request and prove it fits the window before anything is sent.
 */
function prepareRequest(options, { profile, prompt, files, model, contextLength, maxTokens }) {
  const messages = buildMessages({ system: options.system ?? DEFAULT_SYSTEM_PROMPT, prompt, files });
  const estimatedTokens = estimateTokens(messages.map((message) => message.content).join('\n'));

  const budget = checkContextBudget({
    estimatedTokens,
    contextLength,
    reserveTokens: maxTokens,
    providerName: profile.name,
    model,
  });

  return { messages, estimatedTokens, budget };
}

/**
 * Validate every numeric flag before any network work, so a bad flag fails in
 * milliseconds instead of after a round trip that was never going to be used.
 * The window covers prompt + completion, so --max-tokens is also the headroom
 * the guard must reserve.
 */
function parseNumericOptions(options) {
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
 * Which model to send to, and how big its window is. The server is consulted
 * only for what the config does not already answer, so a fully configured
 * profile performs no probes at all.
 */
async function resolveTarget(profile, options) {
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

async function runTask(argv) {
  const { options, prompt: inlinePrompt, terminated } = parseCommandLine(argv, TASK_SPEC);
  const { maxTokens, temperature, timeoutSeconds } = parseNumericOptions(options);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  if (profile.credentialWithheld) {
    process.stderr.write(
      `Note: "${profile.name}" has a credential, but --base-url points at a different host, so it was not sent.\n`,
    );
  }
  const prompt = resolvePrompt(options, inlinePrompt, terminated);
  const files = readFileBlocks(options.file);
  const { model, contextLength } = await resolveTarget(profile, options);

  const { messages, estimatedTokens, budget } = prepareRequest(options, {
    profile,
    prompt,
    files,
    model,
    contextLength,
    maxTokens,
  });

  const timeoutMs = timeoutSeconds ? timeoutSeconds * 1000 : (profile.timeoutSeconds ?? 0) * 1000 || DEFAULT_TIMEOUT_MS;

  // Non-streaming against a slow local model looks like a hang without this.
  process.stderr.write(`Contacting ${profile.name} (${model}) with ${files.length} file(s), ~${estimatedTokens} tokens...\n`);

  const startedAt = Date.now();
  const result = await chatCompletion(profile, {
    model,
    messages,
    timeoutMs,
    temperature,
    maxTokens,
  });

  process.stdout.write(result.content.trim());
  process.stdout.write(
    `${renderTaskFooter({
      providerName: profile.name,
      model: result.model,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      contextNote: budget.checked ? null : budget.note,
      finishReason: result.finishReason,
    })}\n`,
  );
}

const COMMANDS = { setup: runSetup, task: runTask };

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    throw new UserError(`Unknown command "${command ?? ''}". Expected one of: ${Object.keys(COMMANDS).join(', ')}.`);
  }
  await handler(rest);
}

main().catch((error) => {
  if (error instanceof UserError) {
    process.stderr.write(`${error.message}\n`);
    if (error.hint) process.stderr.write(`${error.hint}\n`);
    process.exit(1);
  }
  process.stderr.write(`Unexpected failure: ${error?.stack ?? error}\n`);
  process.exit(2);
});
