import { UserError } from './errors.mjs';

// Deliberately crude: a real tokenizer differs per model, and this guard exists
// to catch "you sent 40k into a 4k window", not to be exact at the margin.
const CHARS_PER_TOKEN = 4;

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
export function checkContextBudget({ estimatedTokens, contextLength, reserveTokens = DEFAULT_RESERVE_TOKENS, providerName, model }) {
  if (!contextLength) {
    return {
      checked: false,
      note: `Context window unknown for ${model} — set "contextLength" for provider "${providerName}" in the config to enable the size check.`,
    };
  }

  const budget = contextLength - reserveTokens;
  if (estimatedTokens > budget) {
    throw new UserError(
      `Input is roughly ${formatTokens(estimatedTokens)} tokens but ${model} on "${providerName}" has a ${formatTokens(contextLength)} window ` +
        `(${formatTokens(budget)} usable after reserving ${formatTokens(reserveTokens)} for the reply).`,
      { hint: 'Send fewer or smaller files, shorten the prompt, or raise the model context length in the server and config.' },
    );
  }

  return {
    checked: true,
    note: `~${formatTokens(estimatedTokens)} of ${formatTokens(budget)} usable tokens.`,
  };
}
