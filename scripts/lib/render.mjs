import { START_HINTS } from './config.mjs';
import { formatTokens } from './context-guard.mjs';
import { effectiveWindow, planSelection } from './model-info.mjs';
import { formatRate, tokensPerSecond } from './throughput.mjs';

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
 * Formats whatever `effectiveWindow` resolved, and says where it came from.
 *
 * Naming the source matters: a detected number and a hand-set one carry
 * different confidence, and one probe shape (oMLX) is documented rather than
 * verified. Reporting the window of the model a task would actually use is the
 * point — naming some other loaded model's window would promise a guard the task
 * will not have.
 */
function describeContext(profile, described) {
  const resolved = effectiveWindow(profile, described);

  if (resolved.source === 'config') {
    const conflict = resolved.detected
      ? ` — but the server reports it is serving ${formatTokens(resolved.detected)}; the configured value wins and may be stale`
      : '';
    return `context: ${formatTokens(resolved.window)} (set in config)${conflict}`;
  }
  // A problem means no single model is determined, so no window can be either.
  if (resolved.problem) return `context: not determined — ${resolved.problem.message}`;
  if (resolved.window) return `context: ${formatTokens(resolved.window)} (detected via ${resolved.source})`;
  if (resolved.ceiling) {
    return `context: unknown — the server reports only a ${formatTokens(resolved.ceiling)} ceiling for ${resolved.modelId}, not the window it is serving; set contextLength to arm the size check`;
  }
  return 'context: unknown — set contextLength to arm the size check';
}

/**
 * Whether a task against this provider could actually pick a model. A named
 * defaultModel is taken on trust: it may be downloaded but not yet loaded, and
 * the server will load it on demand.
 */
function canDelegate(profile, described) {
  return !planSelection(profile, undefined, described).problem;
}

export function renderSetupReport({ configPath, created, results, defaultProvider }) {
  const lines = [];
  lines.push(`Config: ${configPath}${created ? '  (created now with default providers)' : ''}`);
  lines.push('');

  for (const { profile, rawProfile, models, error, built, described, listUnavailable } of results) {
    const isDefault = profile.name === defaultProvider;
    // "ok" must mean a task would actually run. A server offering only
    // embedders is reachable but has nothing to delegate to, and saying "ok"
    // there sends the user to a command that fails immediately.
    const usable = !error && canDelegate(profile, described);
    lines.push(`${error ? 'x' : usable ? 'ok' : '!'}  ${profile.name}${isDefault ? ' (default)' : ''} - ${profile.baseUrl}`);

    if (error) {
      lines.push(`      ${error.message}`);
      const hint = error.hint ?? START_HINTS[profile.name];
      if (hint) lines.push(`      ${hint}`);
    } else if (listUnavailable) {
      lines.push(`      reachable, but it does not serve a model list (${listUnavailable}).`);
      lines.push('      Delegation still works with a configured defaultModel or an explicit --model.');
    } else if (models.length === 0) {
      lines.push('      reachable, but no models are loaded or downloaded.');
    } else {
      const shown = models.slice(0, MAX_LISTED_MODELS);
      const extra = models.length - shown.length;
      lines.push(`      ${models.length} model(s): ${shown.join(', ')}${extra > 0 ? `, +${extra} more` : ''}`);
      if (profile.defaultModel) lines.push(`      defaultModel: ${profile.defaultModel}`);
    }

    if (!error && !usable) {
      // The exact message a task would fail with, from the same planner.
      const { problem } = planSelection(profile, undefined, described);
      lines.push(`      reachable, but /oai:task cannot run here: ${problem.message}`);
      lines.push(`      ${problem.hint}`);
    }

    // Shown on error rows too: --json reports the configured window regardless,
    // and the two views must not disagree about the same run.
    const context = describeContext(profile, described);
    if (context) lines.push(`      ${context}`);

    const auth = describeAuth(profile, rawProfile, built);
    if (auth) lines.push(`     ${auth}`);
  }

  const ready = results.filter((result) => !result.error && canDelegate(result.profile, result.described));
  lines.push('');
  if (ready.length === 0) {
    lines.push('No provider can take a task right now. Start one of the servers above, or load a chat model in one that is already running.');
  } else {
    lines.push(`Ready: ${ready.map((result) => result.profile.name).join(', ')}. Delegate with /oai:task.`);
  }
  return lines.join('\n');
}

/**
 * Prefill is on the human path too, not JSON-only.
 *
 * The rule this file follows is that a diagnostic changing nothing may live on
 * one path, but a fact changing what the reader should believe may not — and
 * this one does. A bare `424.6s` invites "the model is slow"; `424.6s | prefill:
 * 421.7s` says the model spent 421 of those seconds reading the prompt, and that
 * the same request served from the server's cache costs 14s. Measured, both
 * figures, on one prompt. See ADR 009.
 *
 * Omitted rather than zeroed when unknown: on a non-streamed reply there is no
 * first-token boundary to have measured.
 */
function timingParts(durationMs, prefillMs) {
  const total = `${(durationMs / 1000).toFixed(1)}s`;
  if (!Number.isFinite(prefillMs)) return [total];
  return [total, `prefill: ${(prefillMs / 1000).toFixed(1)}s`];
}

export function renderTaskFooter({
  providerName, model, usage, durationMs, prefillMs, generationMs, contextNote, finishReason,
}) {
  const parts = [`provider: ${providerName}`, `model: ${model}`, ...timingParts(durationMs, prefillMs)];
  if (usage?.prompt_tokens !== undefined) {
    parts.push(`tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens ?? '?'} out`);
  }
  // On the human path for the same reason prefill is, and it fails the same test
  // if left off: "is this model too slow to use" is a fact that changes what the
  // reader should believe, and it cannot be worked out from the numbers already
  // here — ADR 009 established that `durationMs - prefillMs` is not generation,
  // so no arithmetic on this footer recovers the rate.
  //
  // Omitted, never zeroed, when either operand is missing. See throughput.mjs.
  const rate = formatRate(tokensPerSecond(usage, generationMs));
  if (rate) parts.push(`${rate} tok/s`);
  if (finishReason && finishReason !== 'stop') parts.push(`finish_reason: ${finishReason}`);
  const lines = [`\n---\n${parts.join('  |  ')}`];
  if (contextNote) lines.push(contextNote);
  return lines.join('\n');
}
