// How long a request is likely to take, said before it is sent — or nothing.
//
// The point of this module is the "or nothing". A local model's prefill is the
// expensive, silent half: measured here at 191–335s on a dense model before a
// single token appears, against ~67s on the MoE for the same input. That is the
// difference between "leave it running" and "use --background", and it is
// invisible at the moment the decision has to be made.
//
// **Rates are configuration, never code.** ADR 001: providers are config data,
// so nothing here knows what a "dense model" is or which server is slow. A
// profile that has not been measured gets NO estimate, and the caller says so
// rather than printing a number derived from someone else's hardware.

/** Seconds, from tokens and a rate, or null when the rate is unknown. */
function seconds(tokens, rate) {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  return tokens / rate;
}

function human(total) {
  if (total < 90) return `${Math.round(total)}s`;
  const minutes = Math.floor(total / 60);
  const rest = Math.round(total % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
}

/**
 * What the two halves of a run are expected to cost, separately.
 *
 * Separately because they are not interchangeable and ADR 009 established that
 * no arithmetic on a footer recovers one from the other: prefill scales with the
 * input and is silent, generation scales with the reply and is visible. A single
 * blended figure would hide exactly the fact that makes `--background` the right
 * call — that most of the wait happens before anything appears.
 *
 * Returns `null` for a half whose rate the profile does not carry. A partial
 * estimate is still worth printing; an invented one is not.
 */
export function estimateRun({ estimatedTokens, maxTokens, profile }) {
  const prefill = seconds(estimatedTokens, profile?.prefillTokensPerSecond);
  // Without an explicit reply budget there is no token count to divide, and
  // guessing one would make the generation half fiction. Absent, not zero.
  const generation = maxTokens ? seconds(maxTokens, profile?.generationTokensPerSecond) : null;
  if (prefill === null && generation === null) return null;
  return { prefillSeconds: prefill, generationSeconds: generation };
}

/**
 * The estimate as one line for a person, or null.
 *
 * Always says it is an estimate and always names what it was derived from, so a
 * reader can tell a measured rate from a stale one. A figure whose provenance a
 * reader cannot check is the class this repo keeps having to retract.
 */
export function estimateNote(estimate) {
  if (!estimate) return null;
  const parts = [];
  if (estimate.prefillSeconds !== null) parts.push(`~${human(estimate.prefillSeconds)} reading the input`);
  if (estimate.generationSeconds !== null) parts.push(`~${human(estimate.generationSeconds)} generating`);
  return `Estimated from this provider's configured rates: ${parts.join(', ')}. An estimate, not a promise.`;
}

/**
 * What to say when no estimate could be made, once, so every caller says it the
 * same way and none of them invents a number instead.
 */
export const NO_RATE_NOTE =
  'No time estimate: this provider has no measured rates in the config. ' +
  'Set "prefillTokensPerSecond" and "generationTokensPerSecond" to enable one.';
