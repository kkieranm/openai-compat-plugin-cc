import { START_HINTS } from './config.mjs';
import { formatTokens } from './context-guard.mjs';
import { substitution } from './model-identity.mjs';
import { effectiveWindow } from './model-info.mjs';
import { listModelIds, planSelection } from './model-selection.mjs';
import { formatRate, tokensPerSecond } from './throughput.mjs';

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
 * Everything under one provider's header line. Extracted to keep both this and
 * `renderSetupReport` under the size ratchet, and given the row's already-made
 * `plan` rather than re-deriving it: three calls to the same authority in one
 * row is how two lines of one report come to disagree.
 */
function providerLines({ profile, rawProfile, models, error, built, described, listUnavailable }, plan) {
  const lines = [];
  if (error) {
    // No `transportDetail` composition here (unlike `listUnavailable` below):
    // every error `probeProvider` stores in this field is pre-response
    // (ECONNREFUSED/ENOTFOUND/the generic fallback), which carries only
    // `.endpoint` — always `profile.baseUrl`, already shown unconditionally
    // on this row's own header line above. A `serverResponded` failure with
    // real body detail always takes the `listUnavailable` branch instead, so
    // composing it here would be dead weight.
    lines.push(`      ${error.message}`);
    const hint = error.hint ?? START_HINTS[profile.name];
    if (hint) lines.push(`      ${hint}`);
  } else if (listUnavailable) {
    lines.push(`      reachable, but it does not serve a model list (${listUnavailable}).`);
    lines.push('      Delegation still works with a configured defaultModel or an explicit --model.');
  } else if (models.length === 0) {
    lines.push('      reachable, but no models are loaded or downloaded.');
  } else {
    lines.push(`      ${models.length} model(s): ${listModelIds(models)}`);
    if (profile.defaultModel) lines.push(`      defaultModel: ${profile.defaultModel}`);
    // Name the evidence, not just the outcome: several models were on offer and
    // this one was picked because the server reports it resident. Saying only
    // "selected: x" would read as a preference the config never expressed.
    //
    // "the chat model", not "the only model": the count behind `because` is over
    // chat candidates, and an embedder may be loaded beside it. Claiming sole
    // residency would assert something the selection never measured.
    if (plan.because === 'loaded') {
      lines.push(`      selected: ${plan.modelId} — the chat model the server reports loaded`);
    }
  }

  if (!error && plan.problem) {
    // The exact message a task would fail with, from the same planner.
    lines.push(`      reachable, but /oai:task cannot run here: ${plan.problem.message}`);
    lines.push(`      ${plan.problem.hint}`);
  }

  // Shown on error rows too: --json reports the configured window regardless,
  // and the two views must not disagree about the same run.
  const context = describeContext(profile, described);
  if (context) lines.push(`      ${context}`);

  const auth = describeAuth(profile, rawProfile, built);
  if (auth) lines.push(`     ${auth}`);
  return lines;
}

export function renderSetupReport({ configPath, created, results, defaultProvider }) {
  const lines = [];
  lines.push(`Config: ${configPath}${created ? '  (created now with default providers)' : ''}`);
  lines.push('');

  // One plan per provider, for the row and for the closing summary alike. The
  // marker and the "Ready:" list are the same claim stated twice, and deriving
  // them from two calls is how they came to disagree in the first place.
  const rows = results.map((result) => ({ result, plan: planSelection(result.profile, undefined, result.described) }));

  for (const { result, plan } of rows) {
    const { profile, error } = result;
    const isDefault = profile.name === defaultProvider;
    // "ok" must mean a task would actually run. A server offering only
    // embedders is reachable but has nothing to delegate to, and saying "ok"
    // there sends the user to a command that fails immediately.
    const usable = !error && !plan.problem;
    lines.push(`${error ? 'x' : usable ? 'ok' : '!'}  ${profile.name}${isDefault ? ' (default)' : ''} - ${profile.baseUrl}`);
    lines.push(...providerLines(result, plan));
  }

  const ready = rows.filter(({ result, plan }) => !result.error && !plan.problem).map(({ result }) => result);
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
 * figures, on one prompt.
 *
 * Omitted rather than zeroed when unknown: on a non-streamed reply there is no
 * first-token boundary to have measured.
 */
function timingParts(durationMs, prefillMs) {
  const parts = [];
  // `durationMs` is a real number on every foreground and worker-written call
  // site; the guard only fires when a caller is rendering an `outcome` this
  // build itself never wrote (`/oai:result` reading a foreign payload), where
  // fabricating "NaNs" would be worse than omitting the figure.
  if (Number.isFinite(durationMs)) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  if (Number.isFinite(prefillMs)) parts.push(`prefill: ${(prefillMs / 1000).toFixed(1)}s`);
  return parts;
}

/**
 * What answered, and what was asked for when they differ.
 *
 * Inside the `model:` part rather than on a line of its own: this is the field a
 * reader goes to in order to learn which model produced the output, so the
 * correction belongs where the mistake would otherwise be read. A separate
 * warning line is skimmed past; this one cannot be, because there is no way to
 * read the model without reading it.
 *
 * Measured, and the reason this exists: LM Studio answers a request for a model
 * it does not have with a normal completion from whatever is loaded. See
 * model-identity.mjs.
 */
function modelPart(model, requestedModel) {
  // `undefined` means the field is missing from the payload entirely — a
  // foreign `outcome` shape, never this build's own success path, which
  // always writes at least `null`. Left distinct from that legitimate `null`
  // case (a server that answered without naming a model), which this
  // function already renders as `model: null` today.
  if (model === undefined) return 'model: unknown';
  const swap = substitution(requestedModel, model);
  return swap ? `model: ${swap.served} (requested ${swap.requested})` : `model: ${model}`;
}

/**
 * Unlike `model`, there is no legitimate case where `providerName` is meaningfully `null` — every
 * real submission sets `transport.name` to a real profile-name string — so `undefined` and `null`
 * both collapse to "unknown" here rather than `null` falling through to a literal `provider: null`.
 * The caller (`cmd-result.mjs`'s `validateOutcomeShape`) only rules out a hostile non-string value;
 * this is what keeps a legitimately-absent name from printing the literal string "undefined".
 */
function providerPart(providerName) {
  return providerName === undefined || providerName === null ? 'provider: unknown' : `provider: ${providerName}`;
}

export function renderTaskFooter({
  providerName, model, requestedModel, usage, durationMs, prefillMs, generationMs, contextNote, finishReason,
}) {
  const parts = [providerPart(providerName), modelPart(model, requestedModel), ...timingParts(durationMs, prefillMs)];
  // `Number.isFinite`, not `!== undefined`: a real API's `usage` object always
  // carries numbers here, so this rejects nothing legitimate — but `usage` is
  // an unvalidated field of a background job's persisted `outcome`, and an
  // unguarded interpolation of a non-numeric value below would throw on the
  // same class of object `modelPart` above is guarded against.
  if (Number.isFinite(usage?.prompt_tokens)) {
    const completion = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : '?';
    parts.push(`tokens: ${usage.prompt_tokens} in / ${completion} out`);
  }
  // On the human path for the same reason prefill is, and it fails the same test
  // if left off: "is this model too slow to use" is a fact that changes what the
  // reader should believe, and it cannot be worked out from the numbers already
  // here — `durationMs - prefillMs` is not generation, so no arithmetic on this
  // footer recovers the rate.
  //
  // Omitted, never zeroed, when either operand is missing. See throughput.mjs.
  const rate = formatRate(tokensPerSecond(usage, generationMs));
  if (rate) parts.push(`${rate} tok/s`);
  if (finishReason && finishReason !== 'stop') parts.push(`finish_reason: ${finishReason}`);
  const lines = [`\n---\n${parts.join('  |  ')}`];
  if (contextNote) lines.push(contextNote);
  return lines.join('\n');
}
