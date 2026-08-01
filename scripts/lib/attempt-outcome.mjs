import { COMPLETION_SHAPES } from './failure-shape.mjs';

/**
 * How one attempt ends: the three outcomes an entry can close as, the reason
 * codes they carry, and the evidence that decides warm-eligibility.
 *
 * Lifted out of `attempt-ledger.mjs` at the file size budget, and the seam is a
 * real one: that file owns the *sequence* — which requests happened, in what
 * order, and which of them replaced which — while this one owns what a single
 * request's ending MEANS. The two are asked different questions. "How many
 * requests did this run cost" is a property of the sequence; "was this one a
 * dropped request or a refused shape" is a property of the ending.
 *
 * See ADR 012 and BACKLOG.md OAI-20/OAI-23.
 */

/**
 * The server rejected the request's SHAPE, and no replacement was ever sent.
 *
 * Not in `failure-shape.mjs`, and the boundary is **retryability**, not which
 * file the words live in — both modules name how a request ended. That file's
 * shapes are the ones a second attempt could plausibly survive, and they feed
 * `RETRYABLE` directly. This is an HTTP validation rejection: the request was
 * wrong and would be wrong again, so it must never be retried, and putting it
 * there would invite exactly that coupling.
 *
 * It exists because a 400 from `provider.mjs` carries `.status` and never
 * `.reason`, so an abandoned refusal would record `reason: null` and be tallied
 * as `unclassified` beside genuinely unrecognised failures — a hole in the one
 * record reliability is read off. Named distinctly from the `refused` *outcome*
 * so the two never read as synonyms: `refused` means a different shape was
 * accepted afterwards, and this means nothing was.
 */
export const SHAPE_REJECTED = 'shape-rejected';

/**
 * Did this failed request plausibly reach the model's prefill?
 *
 * `error.status` is the discriminator: an HTTP error status is a validation
 * refusal, returned before any generation — the reading `review-report.mjs`
 * already states as this repo's observed behaviour. It matters because a
 * capability degrade is exactly that shape and changes only
 * `stream`/`stream_options`, leaving the messages byte-identical. Counting one
 * as a dispatch marked every degraded run's *answering* attempt warm-eligible,
 * and so silently emptied the benchmark's cold prefill column on any server that
 * refuses `stream_options`.
 *
 * The conservatism runs deliberately in this direction. Over-marking DELETES
 * real measurements with no trace; under-marking quotes a possibly warm figure
 * beside a caveat that says so. Only the second failure is one a reader can see.
 */
function reachedTheModel(error, timings) {
  // A status is an HTTP-level refusal: the server rejected the request shape
  // and never read the prompt as a prompt.
  if (error?.status !== undefined) return false;
  // A completion-level refusal means bytes DID arrive — the server produced a
  // reply document and `finishAnswer` judged it unusable — so the prompt was
  // processed and a repeat of it could be served warm.
  if (COMPLETION_SHAPES.has(error?.reason)) return true;
  // Otherwise the evidence has to be MODEL output, not bytes. `received` counts
  // every byte off the socket including SSE keepalive comments and role-only
  // frames, none of which prove the prompt was prefilled — and a connection that
  // died carrying only those never delivered a prompt worth caching. A measured
  // `prefillMs` is the honest signal: it is stamped at the first frame that
  // carried actual text, so it exists only once the model has begun answering.
  return timings?.prefillMs !== null && timings?.prefillMs !== undefined;
}

/**
 * The entry, with a hook letting a layer that never held its handle reclassify
 * it. Non-enumerable: entries are serialized straight into the benchmark record,
 * and a function there would be dropped by `JSON.stringify` anyway — this keeps
 * it out of the recorded shape entirely.
 */
export function reclassifiable(entry) {
  return Object.defineProperty(entry, 'markRefused', {
    value: (error) => {
      entry.outcome = 'refused';
      // `null`, NOT `SHAPE_REJECTED`. That code means "the shape was rejected and
      // nothing replaced it", so stamping it on an entry that WAS replaced makes
      // the record assert both at once — the same misleading-serialized-entry
      // defect this feature removes, moved from the outcome into the reason. It
      // also keeps a `refused` entry byte-identical to the records made before
      // this change, which the OAI-19 re-measure is differenced against.
      entry.reason = error?.reason ?? null;
    },
  });
}

/**
 * Close an entry as the terminal failure it currently is, and predict that a
 * replacement will follow.
 *
 * The prediction is settled by `begin` — the dispatch of the replacement — never
 * by the statement itself, so a refusal that turns out to be terminal is left
 * saying so. That is the whole of OAI-23: `capBudgets` can refuse the
 * replacement before `begin` is reached, and an entry marked `refused` in
 * advance files a run that died as benign capability negotiation.
 *
 * It sits in this module rather than beside the slot it feeds, which is a seam
 * question a reviewer raised and this answers: what it *writes* is an ending —
 * the outcome and reason of one request — while "did a replacement follow" is
 * sequence state, and the slot holding that stays in `attempt-ledger.mjs`. The
 * alternative was tried on paper and rejected: `closeHandle.refuse` below calls
 * this, so moving it would make this module import from the one that imports it.
 *
 * Deliberately NOT routed through `fail()`. That consults `reachedTheModel` and
 * can add the request key to `dispatched`, which is what makes a later identical
 * request `warmEligible` — and over-marking DELETES a real cold measurement with
 * no trace. On this path `reachedTheModel` returns false anyway, so the
 * difference is invisible today; it is invisible by accident, and this keeps the
 * two apart on purpose.
 */
export function pendUntilReplaced(entry, error, pend) {
  entry.outcome = 'failed';
  entry.reason = error?.reason ?? SHAPE_REJECTED;
  pend({ entry, error });
}

/**
 * The three ways an entry can close, lifted out of `begin` at the function size
 * budget. `dispatched` is threaded in because warm-eligibility is decided by
 * what a request turned out to be, not by what it was when it left.
 */
export function closeHandle(entry, key, dispatched, pend) {
  return {
    settle({ prefillMs = null, generationMs = null } = {}) {
      entry.outcome = 'answered';
      entry.prefillMs = prefillMs;
      entry.generationMs = generationMs;
      dispatched.add(key);
    },
    /**
     * The server rejected the request SHAPE, and the plugin is about to send a
     * different one. `refused` is a third outcome rather than a failure, because
     * capability negotiation is routine and permanent — a server that refuses
     * `stream_options` refuses it every time — and counting it as unreliability
     * would report a server answering 100% of shaped requests as failing half of
     * them: the inversion this record exists to prevent, running the other way.
     *
     * "About to send" is a prediction, so it is recorded as one: the entry
     * closes as a failure now and is reclassified only if the replacement is
     * actually created. See `pendUntilReplaced`.
     */
    refuse(error) {
      pendUntilReplaced(entry, error, pend);
    },
    /**
     * Timings are kept for a failure too, when there are any. A stream that
     * died after 50,000 characters of reasoning measured a real prefill and
     * a real partial generation, and discarding them leaves the record
     * unable to say whether failures cluster before or after the first
     * token — which is the first question anyone asks of this data.
     */
    fail(error, timings = {}) {
      const { prefillMs = null, generationMs = null } = timings;
      entry.outcome = 'failed';
      entry.reason = error?.reason ?? null;
      entry.prefillMs = prefillMs;
      entry.generationMs = generationMs;
      if (reachedTheModel(error, { prefillMs })) dispatched.add(key);
    },
  };
}
