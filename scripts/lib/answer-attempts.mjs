import { createLedger, withLedger } from './attempt-ledger.mjs';
import { createNegotiation, postWithDegrade } from './chat.mjs';
import { finishAnswer } from './completion.mjs';
import { isRetryable } from './failure-shape.mjs';
import { budgetError } from './http-errors.mjs';

/**
 * Sending the request again when the server dropped it, rather than reporting a
 * dead request as a bad answer.
 *
 * Measured: across four full-corpus benchmark invocations, 27 of
 * 72 runs (37.5%) died server-side on LM Studio, on both a dense and an MoE
 * model. Nothing in the request path retried — the only loops were capability
 * ladders — so a flaky server made the benchmark unable to produce a number at
 * all, and the arm that was supposed to re-establish a baseline closed blocked.
 *
 * The loop lives here, spanning `postWithDegrade` **and** `finishAnswer`,
 * because that pair is the smallest unit that can see every failure shape: the
 * transport raises one of them and `finishAnswer` raises the other three. Wider
 * would be worse, not better — wrapping `requestFindings` would re-run prompt
 * sizing and the oversize ladder, retrying the wrong thing entirely.
 */

/** One original plus two retries. Enough that a 37.5% per-attempt failure rate leaves ~5%. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * The pause before a retry.
 *
 * The observed failures correlate with the server under sustained load, and one
 * incident needed a manual unload to clear — so retrying instantly is retrying
 * into the same condition that just failed. Fixed rather than exponential: with
 * at most two retries an exponential schedule is two numbers pretending to be a
 * policy. Recorded on the attempt, so the next characterization run can say
 * whether pacing helped instead of us guessing again.
 */
export const RETRY_DELAY_MS = 2_000;

/**
 * Deliberately **not** `unref`'d, unlike every other timer in this codebase.
 *
 * Those are budgets — watchdogs that must never be the reason a process stays
 * alive. This one is the opposite: it is the work. An unref'd retry delay lets
 * Node find an empty event loop and exit **0** in the middle of the wait, so a
 * run that failed and was about to try again reports success and prints nothing.
 * Caught by the existing suite, which is exactly the kind of thing it is for.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The cap, as the error that names it — one shape, wherever expiry is noticed. */
function capExpired(profile, maxMs) {
  return budgetError('deadline', maxMs ?? 0, 0, profile.name, { serverResponded: false });
}

/** Is there another attempt to be had, and is this failure one worth spending it on? */
function worthRetrying(error, attempt, maxAttempts) {
  return attempt < maxAttempts && isRetryable(error);
}

/** Has the caller's wall-clock cap already passed? */
function expired(expiresAt) {
  return Number.isFinite(expiresAt) && performance.now() >= expiresAt;
}

/**
 * One answer attempt: the request, then the judgement of what came back.
 *
 * The handle stays open across `finishAnswer` deliberately. `postChat` returns
 * *successfully* for an empty completion, a blank completion and an unfinished
 * stream — they are only detected here — so settling inside the transport would
 * record those as answered physical attempts with no reason code, and the
 * reliability figure this whole feature exists to produce would count them as
 * successes.
 */
async function attemptAnswer(profile, budgets, negotiation, finish) {
  const result = await postWithDegrade(profile, budgets, negotiation);
  const timings = { prefillMs: result.prefillMs, generationMs: result.generationMs };
  try {
    const answer = finish(result);
    // Exposed BEFORE `settle()`, closing over this exact physical attempt's
    // handle, so a caller that later judges the content unusable (reasoning
    // arrived, the answer channel did not) can reclassify the ledger entry
    // `settle()` is about to close as `answered` — without this, that entry
    // stays `answered` forever even once the caller rejects it and tries
    // again, leaving two `answered` entries in one run's `attempts[]`.
    // Non-enumerable so it never reaches a caller that only reads the answer
    // as data (a report, a JSON envelope) and never needs to know a ledger
    // exists.
    if (result.handle) {
      Object.defineProperty(answer, 'markUnanswered', {
        value: (error) => result.handle.markUnanswered(error),
      });
    }
    result.handle?.settle(timings);
    return answer;
  } catch (error) {
    result.handle?.fail(error, timings);
    throw error;
  }
}

/**
 * The answer, or the last failure — with the ledger attached either way.
 *
 * An unrecognised failure is **not** retried. The predicate is a whitelist of
 * delivery shapes, so a new failure mode costs one request and an honest error
 * rather than three requests and a misleading one.
 */
export async function answerWithRetry(profile, body, options) {
  const { maxAttempts = DEFAULT_MAX_ATTEMPTS, expiresAt, maxMs, requestedModel, retryDelayMs = RETRY_DELAY_MS, ...rest } = options;
  // Always a ledger, even when the caller did not bring one. It is the only
  // place the *physical* request count exists now, so a local fallback is what
  // keeps `retried` honest for a degrade ladder that sent three requests inside
  // a single answer attempt — the count this field was added to stop losing.
  const ledger = options.ledger ?? createLedger();
  const negotiation = createNegotiation(body);
  // Where this answer's own requests start in the shared ledger. `requestCount`
  // means "how many requests THIS answer cost", and a review shares one ledger
  // across two completion calls — so the raw total would charge the degraded
  // request for the schema request's attempts as well.
  const startedAtEntry = ledger.entries().length;
  let waitedMs = 0;

  for (let attempt = 1; ; attempt += 1) {
    const budgets = { ...rest, expiresAt, maxMs, ledger, answerAttempt: attempt, waitedMs };
    try {
      return await attemptAnswer(profile, budgets, negotiation, (result) =>
        finishAnswer(result.answer, {
          profile,
          requestedModel,
          sawDone: result.sawDone,
          streamed: result.streamed,
          prefillMs: result.prefillMs,
          generationMs: result.generationMs,
          requestCount: ledger.entries().length - startedAtEntry,
        }),
      );
    } catch (error) {
      if (!worthRetrying(error, attempt, maxAttempts)) throw withLedger(error, ledger);
      // The cap outranks the delivery error once it has fallen due, and says so.
      // The post-wait check below does the same; rethrowing the delivery error
      // here instead would file a wall-clock kill as a server drop depending
      // only on which side of the sleep the deadline happened to land on.
      if (expired(expiresAt)) throw withLedger(capExpired(profile, maxMs), ledger);
      process.stderr.write(
        `${profile.name} ${error.reason} on attempt ${attempt} of ${maxAttempts}; retrying in ${retryDelayMs / 1000}s.\n`,
      );
      // Bounded by what is LEFT of the cap, never the full delay. Sleeping the
      // whole 2s with 200ms remaining overruns a cap this plugin promises covers
      // retries — and then rethrows the delivery error rather than the
      // deadline one, so the benchmark files a wall-clock kill as a server drop.
      waitedMs = Number.isFinite(expiresAt) ? Math.max(0, Math.min(retryDelayMs, expiresAt - performance.now())) : retryDelayMs;
      await sleep(waitedMs);
      // Re-checked after the wait, not only before it: the cap can fall due
      // during the pause, and dispatching then would spend a round trip that
      // `capBudgets` is about to refuse anyway.
      // The cap is what ended this run, so the cap is what the error must name.
      // Rethrowing the delivery error here would file a wall-clock kill as a
      // server drop — inventing unreliability out of a limit we imposed, in the
      // record built to tell those two apart.
      if (expired(expiresAt)) throw withLedger(capExpired(profile, maxMs), ledger);
    }
  }
}
