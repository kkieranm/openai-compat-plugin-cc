import { START_HINTS } from './config.mjs';

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

export function renderSetupReport({ configPath, created, results, defaultProvider }) {
  const lines = [];
  lines.push(`Config: ${configPath}${created ? '  (created now with default providers)' : ''}`);
  lines.push('');

  for (const { profile, rawProfile, models, error, built } of results) {
    const isDefault = profile.name === defaultProvider;
    lines.push(`${error ? 'x' : 'ok'}  ${profile.name}${isDefault ? ' (default)' : ''} - ${profile.baseUrl}`);

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

    const context = profile.contextLength ? `  contextLength: ${profile.contextLength}` : '';
    const auth = describeAuth(profile, rawProfile, built);
    if (context || auth) lines.push(`     ${context}${auth}`);
  }

  const reachable = results.filter((result) => !result.error);
  lines.push('');
  if (reachable.length === 0) {
    lines.push('No provider is reachable. Start one of the servers above, or edit the config to point at the right port.');
  } else {
    lines.push(`Ready: ${reachable.map((result) => result.profile.name).join(', ')}. Delegate with /oai:task.`);
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
