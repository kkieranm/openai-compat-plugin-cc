import { budgetError } from './http-errors.mjs';

/**
 * The largest delay `setTimeout` can express, in seconds.
 *
 * Above 2,147,483,647 ms Node clamps the delay to **1 ms** — so a budget of a
 * hundred days would not be a long budget, it would be an immediate one, and a
 * run would die instantly under a flag its author read as generous. Refused at
 * the boundary rather than surviving as a timer that means the opposite of what
 * it says. ~24.8 days, which no real review approaches.
 *
 * It lives here, beside the timers it describes, rather than in `delegate.mjs`
 * where the flags are parsed: `config.mjs` needs it too, and `delegate.mjs`
 * reaches `config.mjs` through `client.mjs` → `provider.mjs`, so importing it
 * from there would have closed a cycle. This module imports nothing but the
 * error vocabulary.
 */
export const MAX_BUDGET_SECONDS = 2_147_483;

/**
 * The timers that bound a request, and the rule for which one gets to explain a
 * failure when two are due at once.
 *
 * Split from `http.mjs` under the size ratchet, and the seam is a real one: that
 * file connects, sends and reads, while this one decides when to stop waiting.
 * The two have different reasons to change — a new transport concern versus a
 * new *budget*, and this feature added a budget.
 *
 * `arm` is exported because the idle budget is armed from two places in
 * `http.mjs` that this module cannot own: once per body chunk, and once from
 * `setIdle` after headers. Those are opt-in and phase-specific; these two are
 * armed before a byte is written.
 */

export function arm(ms, onFire) {
  const timer = setTimeout(onFire, ms);
  // A pending budget must never be the reason a CLI stays alive.
  timer.unref?.();
  return timer;
}

/**
 * Arms the transport-level budgets. Both destroy the request and settle, because
 * `destroy()` does not reliably emit `'error'` across Node lines and a fired
 * budget that only destroys would hang forever.
 *
 * ## Which budget gets to explain a failure when two are due at once
 *
 * Never `setTimeout`'s registration order. Node documents equal-delay ordering
 * as approximate, and which failure a user is told about — and, through
 * `serverResponded`, what they are told to do about it — is not a thing to leave
 * to the scheduler. Both ambiguous pairs are decided explicitly instead, and
 * they need opposite answers:
 *
 * - **A caller-set cap due no later than the first-byte budget subsumes it.**
 *   Someone passing equal `--timeout` and `--max-seconds` wants to hear about
 *   the outer bound they set, so the inner timer is not armed at all.
 * - **The control plane's `total` is the reverse**: a backstop *behind*
 *   first-byte, sharing its exact value in `fetchModels`. It cannot be
 *   suppressed — it still has to catch a slow drip after the first byte — so
 *   when it fires with nothing received it reports `first-byte` instead. That
 *   keeps `/v1/models` against a silent host reporting `first-byte-timeout`,
 *   which is what `cmd-setup.mjs` reads to decide whether to tell someone to
 *   start a server it never heard from.
 *
 * `state.settled` is read **inside** each callback, never captured when the
 * timer is armed — at arm time it is always false, so a cap firing after headers
 * would have reported that nothing was heard.
 */
export function armBudgets(request, state, { firstByteMs, totalMs, totalBudget, totalReportMs, host, fail }) {
  const fire = (budget, ms, options) => () => {
    state.aborted = budgetError(budget, ms, state.received, host, options);
    request.destroy();
    fail(state.aborted);
  };
  const capSubsumesFirstByte = totalMs > 0 && totalBudget !== 'total' && totalMs <= firstByteMs;
  // Armed before anything is written, and cleared by the first body character
  // rather than by the headers.
  if (!capSubsumesFirstByte) {
    // `state.settled` here too, not just on the timer below. With only one of
    // the two call sites passing it, the equal-delay control-plane pair produced
    // the same *reason* either way but a different `serverResponded` — the field
    // this module's own note says must not be raced, decided by which timer ran
    // last. Headers are a response, so a server that sent them and then stalled
    // is answering whichever budget names the failure.
    //
    // And note the arrow, which is not decoration. Writing the options object
    // directly as an argument to `arm` evaluates `state.settled` *now*, when it
    // is always false — the identical trap the total timer below already carries
    // a paragraph about, reintroduced here by copying its shape without its
    // wrapper. It was written that way, and the test three lines from this
    // comment caught it within a minute.
    state.firstByteTimer = arm(firstByteMs, () =>
      fire('first-byte', firstByteMs, { serverResponded: state.settled })());
  }
  // The timer runs for what is *left* of the budget while the message names the
  // budget the caller configured — the same split `createDeadline` makes in
  // chat.mjs. With one expiry shared across retries, a later attempt's remaining
  // time is not a number anyone set, so "within the 150s cap" would send someone
  // to change a value that was never the cause.
  if (totalMs > 0) {
    state.totalTimer = arm(totalMs, () => {
      const subsumed = totalBudget === 'total' && state.received === 0 && firstByteMs <= totalMs;
      // `totalMs` either way, never `firstByteMs`. The subsumed branch is only
      // reachable when the two are equal — a strictly smaller first-byte budget
      // would have fired and destroyed the request before this timer ran — so
      // today they are the same number. Reporting the delay that actually
      // elapsed keeps that a fact rather than a coincidence: if the condition is
      // ever loosened, the message still names when the timer fired instead of
      // naming a budget that had not yet expired.
      fire(
        subsumed ? 'first-byte' : totalBudget,
        subsumed ? totalMs : totalReportMs ?? totalMs,
        { serverResponded: state.settled },
      )();
    });
  }
}
