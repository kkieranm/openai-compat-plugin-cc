import { START_HINTS } from './config.mjs';
import { formatTokens } from './context-guard.mjs';
import { chatCandidates, effectiveWindow } from './model-info.mjs';

const MAX_LISTED_MODELS = 12;

/**
 * Describe where a provider's credential comes from, never the value. When the
 * profile failed to build, no credential was resolved, so say nothing about
 * whether the variable is set rather than guessing it is missing.
 */
function describeAuth(profile, rawProfile, built) {
  if (rawProfile?.apiKeyEnv) return ` auth: $${rawProfile.apiKeyEnv}${built ? ' (set)' : ''}`;
  if (profile.apiKey) return ' auth: api key from config (redacted)';
  return '';
}

/**
 * Where the guard's window comes from. Naming the source matters: a detected
 * number and a hand-set one carry different confidence, and one probe shape
 * (oMLX) is documented rather than verified.
 */
/**
 * Formats whatever effectiveWindow resolved. Reporting the window of the model
 * a task would actually use is the point: naming some other loaded model's
 * window would promise a guard the task will not have.
 */
function describeContext(profile, described) {
  const resolved = effectiveWindow(profile, described);

  if (resolved.source === 'config') return `context: ${formatTokens(resolved.window)} (set in config)`;
  if (resolved.window) return `context: ${formatTokens(resolved.window)} (detected via ${resolved.source})`;
  if (resolved.ceiling) {
    return `context: unknown — the server reports only a ${formatTokens(resolved.ceiling)} ceiling for ${resolved.modelId}, not the window it is serving; set contextLength to arm the size check`;
  }
  if (resolved.candidates > 1) {
    return `context: depends which model — ${resolved.candidates} candidates; pass --model or set defaultModel`;
  }
  return 'context: unknown — set contextLength to arm the size check';
}

/**
 * Whether a task against this provider could actually pick a model. A named
 * defaultModel is taken on trust: it may be downloaded but not yet loaded, and
 * the server will load it on demand.
 */
function canDelegate(profile, described, models = []) {
  if (profile.defaultModel) return true;
  if (!described) return models.length > 0;
  return chatCandidates(described).length > 0;
}

export function renderSetupReport({ configPath, created, results, defaultProvider }) {
  const lines = [];
  lines.push(`Config: ${configPath}${created ? '  (created now with default providers)' : ''}`);
  lines.push('');

  for (const { profile, rawProfile, models, error, built, described } of results) {
    const isDefault = profile.name === defaultProvider;
    // "ok" must mean a task would actually run. A server offering only
    // embedders is reachable but has nothing to delegate to, and saying "ok"
    // there sends the user to a command that fails immediately.
    const usable = !error && canDelegate(profile, described, models);
    lines.push(`${error ? 'x' : usable ? 'ok' : '!'}  ${profile.name}${isDefault ? ' (default)' : ''} - ${profile.baseUrl}`);

    if (error) {
      lines.push(`      ${error.message}`);
      const hint = error.hint ?? START_HINTS[profile.name];
      if (hint) lines.push(`      ${hint}`);
    } else if (models.length === 0) {
      lines.push('      reachable, but no models are loaded or downloaded.');
    } else {
      const shown = models.slice(0, MAX_LISTED_MODELS);
      const extra = models.length - shown.length;
      lines.push(`      ${models.length} model(s): ${shown.join(', ')}${extra > 0 ? `, +${extra} more` : ''}`);
      if (profile.defaultModel) lines.push(`      defaultModel: ${profile.defaultModel}`);
    }

    if (!error && !usable && models.length > 0) {
      lines.push('      reachable, but it offers no model that can answer a chat request (embeddings only).');
      lines.push('      Load a chat model in the server; setting contextLength will not help.');
    }

    if (!error) {
      const context = describeContext(profile, described);
      if (context) lines.push(`      ${context}`);
    }

    const auth = describeAuth(profile, rawProfile, built);
    if (auth) lines.push(`     ${auth}`);
  }

  const ready = results.filter((result) => !result.error && canDelegate(result.profile, result.described, result.models));
  lines.push('');
  if (ready.length === 0) {
    lines.push('No provider can take a task right now. Start one of the servers above, or load a chat model in one that is already running.');
  } else {
    lines.push(`Ready: ${ready.map((result) => result.profile.name).join(', ')}. Delegate with /oai:task.`);
  }
  return lines.join('\n');
}

export function renderTaskFooter({ providerName, model, usage, durationMs, contextNote, finishReason }) {
  const parts = [`provider: ${providerName}`, `model: ${model}`, `${(durationMs / 1000).toFixed(1)}s`];
  if (usage?.prompt_tokens !== undefined) {
    parts.push(`tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens ?? '?'} out`);
  }
  if (finishReason && finishReason !== 'stop') parts.push(`finish_reason: ${finishReason}`);
  const lines = [`\n---\n${parts.join('  |  ')}`];
  if (contextNote) lines.push(contextNote);
  return lines.join('\n');
}
