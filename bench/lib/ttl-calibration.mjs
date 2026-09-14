import { EXPOSURE_MARGIN } from './ttl-verdict.mjs';

/**
 * The calibration gate: may the experiment proceed, and if not, WHY.
 *
 * Split from the decision rule at the size ratchet, and the seam is real — this
 * module answers "is the sweep licensed", `ttl-verdict.mjs` answers "what did it
 * find".
 *
 * Everything here is enumerated rather than collapsed into a boolean, because
 * every collapse produced a message naming one of several simultaneous causes.
 * That happened twice in consecutive review rounds: first the precondition and
 * the exposure bar, then the exposure bar and the request outcome.
 */

/**
 * WHY the calibration did not clear, as a list.
 *
 * INDEPENDENT failure modes are reported together; entailed ones are not. A
 * calibration whose prefill comfortably cleared the bar and then died would
 * otherwise be told "the prefill did not clear the shortened TTL, lower the TTL"
 * — false, and another 45 minutes spent on the wrong knob. Conversely no response
 * entails no prefill, so listing both would invent a second fault to chase.
 */
export function calibrationCauses({ obtainedResponse, failed, prefillMs, challengeTtlMs }) {
  // No response ENTAILS no prefill, so reporting both is noise that sends the
  // operator looking for a second, independent fault. Only genuinely independent
  // causes are listed — which is the whole point of listing them.
  if (!obtainedResponse) return ['no-response'];
  const causes = [];
  if (failed) causes.push('request-failed');
  if (typeof prefillMs !== 'number') causes.push('no-prefill-measured');
  else if (!(prefillMs > challengeTtlMs * EXPOSURE_MARGIN)) causes.push('prefill-short');
  return causes;
}

/**
 * Did the calibration establish a prefill that clears the challenge bar?
 *
 * A MEASURED first token, never a duration standing in for one: the withdrawn
 * draft used `firstTokenMs ?? durationMs`, so a calibration that timed out at
 * 1,800s "cleared" a 180s bar without the model ever emitting a token — the gate
 * reading a failure as proof of the very thing it exists to establish.
 */
export function calibrationCleared(input) {
  return calibrationCauses(input).length === 0;
}

/** What each cause means, and what the operator should do about that ONE cause. */
const CAUSE_TEXT = {
  // NOT "check the server is up": `obtainedResponse` is false for a client-side
  // refusal and a malformed reply too, so naming one candidate cause would send
  // the operator to the wrong component for another 45 minutes.
  'no-response': ['no HTTP response was obtained', 'see the attempt record for how far the request got'],
  'request-failed': ['the request failed', 'see the attempt record for why'],
  'no-prefill-measured': ['no first token was ever measured', 'see the attempt record for why'],
  'prefill-short': ['its prefill did not clear the shortened TTL by the exposure margin',
    'lower the TTL or pick a longer case'],
};

/**
 * The sentence a voided calibration prints, naming EVERY cause it had.
 *
 * Broken preconditions and measurement failures are independent, so both are
 * reported and both remedies are offered. Naming only the first would have the
 * operator fix it, spend another 45 minutes, and meet the other.
 */
export function calibrationSays(failures, causes = []) {
  const why = [];
  const remedy = [];
  if (failures?.length) {
    why.push(`it ran without the conditions this experiment requires (${failures.join(', ')})`);
    remedy.push('fix the precondition');
  }
  for (const cause of causes) {
    const text = CAUSE_TEXT[cause];
    if (!text) continue;
    why.push(text[0]);
    remedy.push(text[1]);
  }
  return 'The calibration cannot license this sweep: '
    + `${why.length ? why.join(', and ') : 'it did not clear the gate'}.`
    + ` Nothing here tested the mechanism.${remedy.length ? ` To re-run: ${remedy.join('; ')}.` : ''}`;
}
