import { applyFrame, emptyAnswer } from './completion.mjs';
import { UserError } from './errors.mjs';
import { budgetError } from './http-errors.mjs';
import { readSse } from './sse.mjs';

/**
 * Reasoning prose is a different population from the input code/diffs
 * `context-guard.mjs`'s CHARS_PER_TOKEN (3.4) was measured against — no
 * measurement here supports reusing that number. 3.0 deliberately errs toward
 * triggering the reserve watchdog early: guessing too low only costs a little
 * preserved reasoning before asking for conclusions, guessing too high risks
 * losing the review outright or overrunning the salvage follow-up's own
 * context check.
 */
const REASONING_CHARS_PER_TOKEN = 3.0;

/**
 * Reading a streamed completion under the budgets that mean "the model is
 * working", and timing both sides of its first token.
 *
 * Split from `chat.mjs` under the size ratchet, and the seam is a real one: that
 * file decides what to SEND and how to degrade when a server refuses a
 * capability, while this one decides how long to keep listening once bytes are
 * coming back. They have different reasons to change — a new capability rung
 * versus a new notion of "still generating" — and only this half needs to know
 * that a keepalive comment is not progress.
 */

/**
 * The budget that actually means "the model is working".
 *
 * Reset only by a delta carrying text — never by bytes. A keepalive comment, a
 * role-only frame or a half-delivered frame are all socket activity that prove
 * nothing about generation, so a byte-driven timer would let a server emitting
 * `:\n\n` every 30 seconds run forever while the plugin reported it bounded.
 */
function createDeadline({ firstTokenMs, idleMs, reportMs, onExpire }) {
  let started = false;
  let timer = null;
  const set = (budget, ms, reported = ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => onExpire(budget, reported), ms);
    timer.unref?.();
  };
  // The timer runs for what is *left* of the budget; the message names the
  // budget the user actually configured. Reporting the remainder produced
  // "sent no output within 5s" — and at the floor, "within 0.0s" — for a value
  // nobody set, which sends someone to change a number that was never the cause.
  set('first-token', firstTokenMs, reportMs ?? firstTokenMs);
  return {
    progress() {
      started = true;
      set('idle', idleMs);
    },
    get started() {
      return started;
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

/**
 * How long the model spent before its first token, and how long it spent after.
 *
 * Two numbers rather than one, because a server-side prompt cache moves one of
 * them by ~37× and leaves the other alone: the same 56,805-token prompt reached
 * its first token in 421.7s cold and 11.5s warm on this machine, generating for
 * ~3s in both. A single total welds the two together, and the benchmark then
 * ranged `13–425` across three runs of one case and called it a result.
 *
 * `performance.now()`, not `Date.now()`. A 400-second prefill is long enough for
 * a wall-clock adjustment to land inside it, and a duration measured across one
 * would be a reported figure that is not the figure.
 *
 * Both are null when no text ever arrived — there is no boundary to measure, and
 * `finishAnswer` refuses that reply anyway.
 */
function timings(startedAt, firstTextAt, endedAt) {
  if (firstTextAt === null) return { prefillMs: null, generationMs: null };
  // Rounded, because `performance.now()` returns sub-millisecond floats and
  // these sit in `--json` beside an integer `durationMs`. Sub-millisecond
  // precision on a figure whose interesting range is 10s to 400s is noise that
  // reads as significance.
  return { prefillMs: Math.round(firstTextAt - startedAt), generationMs: Math.round(endedAt - firstTextAt) };
}

export async function collectStream(
  response,
  profile,
  { startedAt, firstTokenMs, reportMs, idleMs, onProgress, maxTokens, reasoningReserveTokens },
) {
  const answer = emptyAnswer();
  const outcome = {};
  let expired = null;
  let firstTextAt = null;
  const deadline = createDeadline({
    firstTokenMs,
    reportMs,
    idleMs,
    onExpire: (budget, ms) => {
      // Idempotent: throwing the token-reserve cutoff from inside the
      // for-await loop still triggers IteratorClose on `readSse`'s async
      // generator before this function's own `catch` ever runs, and that
      // cleanup can itself await — a real gap in which this timer can fire
      // and overwrite an `expired` a cutoff already set. Once something has
      // already claimed `expired`, a later timer firing has nothing left to
      // report.
      if (expired !== null) return;
      expired = budgetError(budget, ms, answer.content.length + answer.reasoning.length, profile.name);
      response.dispose();
    },
  });

  // Opt-in only: `reasoningReserveTokens` is undefined for every
  // caller that never asked for it — `/oai:task`, capability probes, and the
  // salvage follow-up itself (`review-request.mjs` never puts it on the
  // shared `send` object precisely so this stays disarmed there). Watches a
  // reasoning model spending its whole `max_tokens` pool on reasoning and
  // never reaching `content`, cutting the stream before that happens instead
  // of after — there is no timeout to catch this the way `createDeadline`
  // catches a stalled server.
  //
  // `cutoffChars > 0` is a second, defensive arm guard beyond the caller's own
  // (review-request.mjs only passes `reasoningReserveTokens` when
  // `maxTokens >= 2 * reserve`): if that guard were ever skipped, a
  // non-positive cutoff would otherwise fire on the very first reasoning
  // delta, which is exactly the failure this repo has twice built a guard to
  // prevent elsewhere.
  const reserveArmed = reasoningReserveTokens !== undefined && Number.isFinite(maxTokens);
  const cutoffChars = reserveArmed ? (maxTokens - reasoningReserveTokens) * REASONING_CHARS_PER_TOKEN : 0;

  try {
    for await (const frame of readSse(response, profile.name, outcome)) {
      const reasoningBefore = answer.reasoning.length;
      // The same condition the idle budget uses, and deliberately so: a frame
      // that carried text is the only evidence that generation has begun. A
      // role-only frame or a keepalive would put the boundary before the model
      // had produced anything, which is the figure this measurement exists to
      // separate out.
      if (applyFrame(answer, frame)) {
        firstTextAt ??= performance.now();
        deadline.progress();
      }
      // Permanently disarmed the moment any content appears (raw length, not
      // trimmed) — a model that has started answering is never interrupted,
      // even if it later pauses. No plateau/rate-of-growth heuristic: only
      // reasoning that just grew this frame is eligible, so a stall cannot
      // trip this on its own — that is `createDeadline`'s job, not this one's.
      if (
        expired === null
        && reserveArmed
        && cutoffChars > 0
        && answer.content.length === 0
        && answer.reasoning.length > reasoningBefore
        && answer.reasoning.length >= cutoffChars
      ) {
        const reasoningChars = answer.reasoning.length;
        const failure = new UserError(
          `${profile.name} was still reasoning and had not written an answer when the client stopped the stream at the reasoning cutoff.`,
          { hint: 'Attempting to conclude from the partial reasoning instead.' },
        );
        failure.reason = 'token-reserve-cutoff';
        failure.maxTokens = maxTokens;
        failure.reserveTokens = reasoningReserveTokens;
        failure.reasoningChars = reasoningChars;
        failure.estimatedReasoningTokens = Math.ceil(reasoningChars / REASONING_CHARS_PER_TOKEN);
        failure.serverResponded = true;
        expired = failure;
        // Cleared here, not left to the outer `finally` — belt and suspenders
        // alongside `onExpire`'s own idempotency guard above: throwing out of
        // a `for-await` loop still runs `IteratorClose` on `readSse`'s async generator
        // BEFORE this function's own `catch` ever executes, and that
        // generator's cleanup can itself await — a real gap, reproduced
        // directly with a delayed iterator `return()`, in which the idle
        // timer could otherwise still fire and race `expired`. Disarming the
        // timer outright removes that race rather than merely surviving it.
        deadline.clear();
        response.dispose();
        // Thrown immediately, never left to a later async rejection:
        // `readSse` can have MORE than one event already buffered from the
        // same physical chunk — a finish frame and `[DONE]` can arrive
        // alongside the frame that crossed the threshold, and `drain()`
        // yields all of them synchronously with no await in between, so a
        // bare `dispose()` here would let the loop keep consuming those
        // buffered events and return a normal success, discarding `expired`
        // entirely. A separate race exists in the same block — the deadline
        // watchdog's own `onExpire` unconditionally overwriting `expired` —
        // closed above by the idempotency guard and the early
        // `deadline.clear()`, not by this throw.
        throw failure;
      }
      onProgress?.(answer);
    }
  } catch (error) {
    // Ours outranks the socket's: disposing produces a generic transport error a
    // tick later, and that would replace "stalled after 4,210 characters" with
    // nothing useful.
    const failure = expired ?? error;
    // Measured, then carried out on the error rather than discarded. A stream
    // that died 50,000 characters into reasoning observed a real prefill and a
    // real partial generation; throwing them away leaves the attempt record
    // unable to say whether failures cluster before or after the first token,
    // which is the first question this data gets asked.
    if (failure && failure.timings === undefined) {
      failure.timings = timings(startedAt, firstTextAt, performance.now());
    }
    // Same move, same reasoning, for the text itself rather than just its
    // duration. `answer` is this function's own accumulator —
    // in scope here regardless of which budget produced `failure` (deadline,
    // idle, a raw transport drop) — so attaching it is unconditional and cheap;
    // content/reasoning are simply empty when nothing had streamed yet.
    if (failure && failure.answer === undefined) {
      failure.answer = answer;
    }
    throw failure;
  } finally {
    deadline.clear();
  }
  return { answer, sawDone: outcome.sawDone, ...timings(startedAt, firstTextAt, performance.now()) };
}

