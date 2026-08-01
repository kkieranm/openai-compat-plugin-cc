import { applyFrame, emptyAnswer } from './completion.mjs';
import { budgetError } from './http-errors.mjs';
import { readSse } from './sse.mjs';

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
 * ranged `13–425` across three runs of one case and called it a result. See
 * ADR 009.
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

export async function collectStream(response, profile, { startedAt, firstTokenMs, reportMs, idleMs, onProgress }) {
  const answer = emptyAnswer();
  const outcome = {};
  let expired = null;
  let firstTextAt = null;
  const deadline = createDeadline({
    firstTokenMs,
    reportMs,
    idleMs,
    onExpire: (budget, ms) => {
      expired = budgetError(budget, ms, answer.content.length + answer.reasoning.length, profile.name);
      response.dispose();
    },
  });

  try {
    for await (const frame of readSse(response, profile.name, outcome)) {
      // The same condition the idle budget uses, and deliberately so: a frame
      // that carried text is the only evidence that generation has begun. A
      // role-only frame or a keepalive would put the boundary before the model
      // had produced anything, which is the figure this measurement exists to
      // separate out.
      if (applyFrame(answer, frame)) {
        firstTextAt ??= performance.now();
        deadline.progress();
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
    throw failure;
  } finally {
    deadline.clear();
  }
  return { answer, sawDone: outcome.sawDone, ...timings(startedAt, firstTextAt, performance.now()) };
}

