import { UserError } from './errors.mjs';

// Deliberately crude: a real tokenizer differs per model, and this guard exists
// to catch "you sent 40k into a 4k window", not to be exact at the margin.
//
// But it must err toward refusing, never toward admitting input the server then
// rejects — that is the failure this guard exists to prevent. Measured against
// LM Studio on two real diffs: 50 KB counted 13,889 tokens (3.61 chars/token)
// and 156 KB counted 44,997 (3.48). Code and diffs pack denser than the prose 4
// assumed, so a review — which only ever sends code — was systematically
// over-estimating how much would fit.
//
// Set *below* the densest measurement rather than at it: at 3.5 the estimate
// still fell 300 tokens short of the second sample, and "close enough" is the
// wrong target for a number whose only job is to stay on the safe side.
const CHARS_PER_TOKEN = 3.4;

// Headroom left for the model's reply, since the window covers prompt + completion.
export const DEFAULT_RESERVE_TOKENS = 1024;

export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function formatTokens(count) {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/**
 * Refuse loudly when the input cannot fit the window. Returns a note describing
 * what was (or could not be) checked; never truncates silently.
 */
export function checkContextBudget({
  estimatedTokens,
  contextLength,
  reserveTokens,
  providerName,
  model,
  oversizeHint,
}) {
  // An explicit --max-tokens is the reply length actually requested, so it
  // replaces the guess in both directions: a bigger reply needs more headroom,
  // a deliberately small one frees the window up for more input.
  const reserve = reserveTokens ?? DEFAULT_RESERVE_TOKENS;

  if (!contextLength) {
    return {
      checked: false,
      note: `Context window unknown for ${model} — set "contextLength" for provider "${providerName}" in the config to enable the size check.`,
    };
  }

  // Otherwise the budget goes negative and the refusal blames the input size,
  // which no amount of trimming can fix.
  if (reserve >= contextLength) {
    throw new UserError(
      `The requested reply length (${formatTokens(reserve)} tokens) does not fit ${model}'s ${formatTokens(contextLength)} window on "${providerName}".`,
      { hint: 'Lower --max-tokens, or raise the model context length in the server and the provider config.' },
    );
  }

  const budget = contextLength - reserve;
  if (estimatedTokens > budget) {
    throw new UserError(
      `Input is roughly ${formatTokens(estimatedTokens)} tokens but ${model} on "${providerName}" has a ${formatTokens(contextLength)} window ` +
        `(${formatTokens(budget)} usable after reserving ${formatTokens(reserve)} for the reply).`,
      {
        // The caller knows what its input actually is. A review's input is a
        // diff chosen by --base/--commit, so "send fewer files" is advice for a
        // command the user did not run.
        hint:
          oversizeHint ??
          'Send fewer or smaller files, shorten the prompt, or raise the model context length in the server and config.',
        // The one refusal that sending less input can fix, so the one a caller
        // may retry smaller. The reserve refusal above is deliberately untagged.
        reason: 'oversize',
      },
    );
  }

  return {
    checked: true,
    note: `~${formatTokens(estimatedTokens)} of ${formatTokens(budget)} usable tokens.`,
  };
}
