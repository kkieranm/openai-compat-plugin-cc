#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { assertNoFlagsInPrompt, parseCommandLine } from './lib/args.mjs';
import { chatCompletion, DEFAULT_TIMEOUT_MS, listModels } from './lib/client.mjs';
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
    return { profile, rawProfile, built: true, models: await listModels(profile, { timeoutMs: PROBE_TIMEOUT_MS }) };
  } catch (error) {
    if (error instanceof UserError) return { profile, rawProfile, built: true, models: [], error };
    throw error;
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
    const providers = results.map(({ profile, rawProfile, models, error }) => ({
      name: profile.name,
      baseUrl: profile.baseUrl,
      reachable: !error,
      error: error ? error.message : null,
      models,
      defaultModel: profile.defaultModel ?? null,
      contextLength: profile.contextLength ?? null,
      hasApiKey: Boolean(profile.apiKey),
      apiKeyEnv: rawProfile?.apiKeyEnv ?? null,
    }));
    process.stdout.write(`${JSON.stringify({ configPath: path, created, defaultProvider: config.defaultProvider, providers }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderSetupReport({ configPath: path, created, results, defaultProvider: config.defaultProvider })}\n`);
}

function resolvePrompt(options, inlinePrompt) {
  if (options['prompt-file']) {
    try {
      return readFileSync(options['prompt-file'], 'utf8').trim();
    } catch (error) {
      throw new UserError(`Could not read --prompt-file ${options['prompt-file']}: ${error.message}`);
    }
  }
  const inline = inlinePrompt.trim();
  if (inline) {
    assertNoFlagsInPrompt(inline, TASK_SPEC);
    return inline;
  }
  const piped = process.stdin.isTTY ? '' : readStdin().trim();
  if (piped) return piped;
  throw new UserError('No prompt given.', {
    hint: 'Pass the request as text, or use --prompt-file <path> for multi-line prompts.',
  });
}

async function resolveModel(profile, explicit) {
  if (explicit) return explicit;
  if (profile.defaultModel) return profile.defaultModel;
  const models = await listModels(profile, { timeoutMs: PROBE_TIMEOUT_MS });
  if (models.length === 0) {
    throw new UserError(`Provider "${profile.name}" reports no available models.`, {
      hint: 'Load a model in the server, or pass --model <id> to have it loaded on demand.',
    });
  }
  return models[0];
}

async function runTask(argv) {
  const { options, prompt: inlinePrompt } = parseCommandLine(argv, TASK_SPEC);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  const prompt = resolvePrompt(options, inlinePrompt);
  const files = readFileBlocks(options.file);
  const model = await resolveModel(profile, options.model);

  const messages = buildMessages({ system: options.system ?? DEFAULT_SYSTEM_PROMPT, prompt, files });
  const estimatedTokens = estimateTokens(messages.map((message) => message.content).join('\n'));
  const budget = checkContextBudget({
    estimatedTokens,
    contextLength: profile.contextLength,
    providerName: profile.name,
    model,
  });

  const timeoutMs = options.timeout
    ? parseNumber(options.timeout, 'timeout', { min: 1 }) * 1000
    : (profile.timeoutSeconds ?? 0) * 1000 || DEFAULT_TIMEOUT_MS;

  // Non-streaming against a slow local model looks like a hang without this.
  process.stderr.write(`Contacting ${profile.name} (${model}) with ${files.length} file(s), ~${estimatedTokens} tokens...\n`);

  const startedAt = Date.now();
  const result = await chatCompletion(profile, {
    model,
    messages,
    timeoutMs,
    temperature:
      options.temperature === undefined ? undefined : parseNumber(options.temperature, 'temperature', { min: 0, max: 2 }),
    maxTokens:
      options['max-tokens'] === undefined
        ? undefined
        : parseNumber(options['max-tokens'], 'max-tokens', { integer: true, min: 1 }),
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
