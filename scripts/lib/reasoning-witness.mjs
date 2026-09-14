// The observed reasoning state of one reply, read off its usage rather than off
// the request. A reasoning model's thinking channel is set by the server's chat
// template (`enable_thinking`), which no OpenAI-compatible request field reaches,
// so a run cannot record what it ASKED for — but the reply reports what it DID:
// `usage.completion_tokens_details.reasoning_tokens`. This turns that one number
// into a labelled witness so a record self-describes which side of that switch it
// ran on, instead of two runs reading identical while the deciding variable is
// invisible.
//
// A separate axis from `run-context.mjs`'s `serverConfig`: that records what the
// REQUEST carried (`requested` vs `server-default-unobserved`), built at
// resolution before any reply exists; this records what the REPLY showed. The two
// are never merged — a zero here is not "thinking off", only "the reply reported
// zero reasoning tokens".
//
// A leaf, imports nothing, and NEVER THROWS: its output feeds `errorReport`'s
// jobs.db-persisted envelope, and it builds a fresh object of a constant string
// plus a validated number — no value off `usage` passes through — so it is
// fail-closed by construction, needing no reconstruction pass the way a
// pass-through foreign object (`serverConfig`) does.

// Exported so a branching sink (`render.mjs`'s footer) compares against the
// vocabulary rather than re-typing it — a rename here then breaks that sink
// loudly. A non-branching sink still embeds the whole `{ state, tokens }` object
// and never needs these.
export const OBSERVED = 'reasoning-observed';
export const NONE = 'no-reasoning-observed';
export const UNKNOWN = 'unknown';

/**
 * Classify one reply's reasoning usage into `{ state, tokens }`.
 *
 * `state`:
 *   - `'reasoning-observed'`     — `reasoning_tokens` is a finite number > 0.
 *   - `'no-reasoning-observed'`  — it is exactly 0 (the provider counted and got
 *     zero). Deliberately NOT "off": a zero can mean thinking disabled, thinking
 *     unavailable, or a provider that reports zero unreliably — this says only
 *     what the reply said.
 *   - `'unknown'`                — absent, non-numeric, a nonsensical negative, or
 *     `usage` itself null-ish: nothing was reported to classify.
 *
 * `tokens`: the raw count when finite, else `null`, carried beside the label so a
 * reader can audit the classification without the raw `usage` blob.
 *
 * The read is wrapped in `try/catch` because optional chaining does NOT suppress a
 * throwing getter or proxy trap on `completion_tokens_details`/`reasoning_tokens`:
 * that throws at the property read, before any guard runs. In practice `usage` is
 * `JSON.parse` output (plain data, no getters), so the wrap is defensive — but the
 * never-throw contract is real, and a caller on the persistence path relies on it.
 * `Number.isFinite` then rejects any non-number (and `NaN`/`Infinity`) WITHOUT
 * coercing, so a hostile `valueOf`/`toString` is never invoked — no separate
 * coercion guard is needed once the read itself cannot throw.
 */
export function reasoningWitness(usage) {
  let n;
  try {
    n = usage?.completion_tokens_details?.reasoning_tokens;
  } catch {
    return { state: UNKNOWN, tokens: null };
  }
  if (!Number.isFinite(n) || n < 0) return { state: UNKNOWN, tokens: null };
  if (n === 0) return { state: NONE, tokens: 0 };
  return { state: OBSERVED, tokens: n };
}
