import { closeHandle, pendUntilReplaced, reclassifiable } from './attempt-outcome.mjs';

/**
 * Every request that actually went on the wire, and how each one ended.
 *
 * The benchmark scores *logical runs* — the attempt that answered — while
 * reliability is a property of *physical requests*, and conflating the two is
 * how a server that failed twice before answering reads as a healthy one. So
 * one entry per HTTP request, whatever caused it: the first try, a capability
 * degrade, the `response_format` fallback, or a retry after a delivery failure.
 * A failed attempt is missing data, never an observed miss — it must never reach
 * a recall denominator.
 *
 * One ledger per command, not per call. `review-request.mjs` can call
 * `chatCompletion` twice for one review (the schema request, then the degraded
 * one), and a ledger scoped to a call would restart its indexes half way through
 * and drop the structured request out of the record entirely — which is the same
 * shape as the counter reset that `retried` has been papering over with
 * `|| !structured`.
 *
 * What an individual entry's ending means lives in `attempt-outcome.mjs`.
 */

/**
 * The one refusal that may be awaiting its replacement, and the act of settling
 * it. Lifted out of `createLedger` at the function size budget.
 *
 * One slot, because a refusal is registered immediately before its replacement
 * is dispatched and nothing dispatches concurrently against one ledger: the rung
 * path loops straight from `refuse()` into the next `begin`, and `degraded()`'s
 * next model operation is the replacement. It holds the ENTRY, not "the last
 * one", so the flip can only land on the request it was registered for.
 */
function refusalSlot() {
  let awaiting = null;
  return {
    pend(pending) {
      awaiting = pending;
    },
    settle() {
      if (!awaiting) return;
      awaiting.entry.markRefused(awaiting.error);
      awaiting = null;
    },
  };
}

/**
 * The open entry for a request about to go out, and the cache key it is filed
 * under. Lifted out of `begin` at the function size budget.
 *
 * The key pairs the requested model with the serialized messages, because
 * warm-eligibility is a question about the prompt a server could have cached —
 * not about which attempt number this is.
 */
function newEntry(index, { body, cause, waitedMs }, dispatched) {
  const serialized = JSON.stringify(body?.messages ?? null);
  const key = `${body?.model ?? ''} ${serialized}`;
  return {
    key,
    entry: {
      index,
      cause,
      // Request size — the
      // axis that says whether failures cluster on large prompts. Characters
      // rather than tokens: this layer has no tokenizer, so a character count
      // is a measurement where a token figure would be an estimate.
      promptChars: serialized === 'null' ? null : serialized.length,
      warmEligible: dispatched.has(key),
      // Time spent deliberately waiting before this request, so the cost of
      // pacing is visible in the record rather than hidden inside the run's
      // total duration.
      waitedMs,
      outcome: null,
      reason: null,
      // Whether an HTTP RESPONSE was obtained — headers arrived — which is the
      // one axis this flag settles. `false` never means "no host was reachable":
      // `ECONNREFUSED` reached a host whose stack answered with a reset, and a
      // TLS rejection reached a peer outright, yet both record `false` beside an
      // `ENOTFOUND` that contacted nothing. Minted here rather than only in the
      // closers because every closing path must leave the same key set, which
      // `tests/bench-reason-notes.test.js` pins.
      serverResponded: false,
      prefillMs: null,
      generationMs: null,
    },
  };
}

/**
 * A shared ledger, plus the prompt history that decides warm-eligibility.
 *
 * `warmEligible` means **an earlier dispatch in this ledger carried a
 * cache-compatible prompt** — the same requested model and byte-identical
 * messages. It does not mean the cache was warm, and the distinction is not
 * pedantry: nothing here can observe a server-side cache hit, exactly as the
 * benchmark's existing cache caveat already says of its own figures.
 *
 * It is computed from the serialized messages rather than from "is this attempt
 * number greater than one", because those are different questions. A retry after
 * a delivery failure re-sends the same prompt and *is* eligible; the
 * `response_format` fallback is also a later attempt but rewrites the prompt with
 * schema instructions, so it is not. Getting this from the attempt index would
 * have marked the fallback eligible and quietly excluded a genuinely cold
 * measurement from the benchmark's cold sample.
 */
export function createLedger() {
  const entries = [];
  const dispatched = new Set();
  const refusal = refusalSlot();

  return {
    /**
     * Record that a request is about to go out; returns the handle that closes it.
     *
     * The handle is deliberately not closed here. A request can fail at the
     * transport — in which case whoever caught it closes it — or it can return
     * bytes and still be refused one layer up by `finishAnswer`, which is where
     * three of the four failure shapes are detected. Closing an entry the moment
     * the bytes arrive would file those as **successful** physical attempts with
     * no reason code, which is precisely the corruption this ledger exists to
     * prevent.
     */
    begin({ body, cause, waitedMs = 0 }) {
      const { entry, key } = newEntry(entries.length + 1, { body, cause, waitedMs }, dispatched);
      entries.push(reclassifiable(entry));
      // Settled only once the replacement entry EXISTS, so after the push, not
      // before: `newEntry` serializes the body and `JSON.stringify` can throw,
      // and settling first would reclassify the refusal with no replacement to
      // show for it — this same defect in miniature. The only place `refused` is
      // ever written.
      refusal.settle();
      return closeHandle(entry, key, dispatched, refusal.pend);
    },

    /**
     * The most recent entry is a refusal whose replacement is about to be sent.
     *
     * Called by the layer that actually sends the different shape — never
     * inferred from a status code. A 400 alone does not mean negotiation
     * happened: a context-limit rejection and an invalid request are also 400s,
     * no fallback follows them, and marking those `refused` would hide a
     * terminal failure from the reliability count while claiming a different
     * shape was accepted.
     *
     * And "about to be sent" is not "was sent" — the narrower version of the
     * same defect, since the replacement's own cap check can refuse it before it
     * reaches the wire. So this registers the reclassification and leaves the
     * entry closed as the failure it is; `begin` settles it.
     */
    refuseLast(error) {
      const entry = entries.at(-1);
      if (entry) pendUntilReplaced(entry, error, refusal.pend);
    },

    entries: () => entries,
  };
}

/**
 * The ledger, carried out on the error.
 *
 * Attached at every terminal rethrow rather than only at exhaustion: a run whose
 * attempts all failed is the run with the *most* reliability evidence, and it is
 * the one whose evidence is easiest to lose — the error path is the path where
 * nobody thinks to look for a record.
 */
export function withLedger(error, ledger) {
  // `attemptRecords`, not `attempts`. `finishAnswer` already returns a numeric
  // `requestCount`, and the record carries an `attempts` array; a third meaning
  // of the same word on the error path is how a grep stops being trustworthy.
  if (error && ledger && error.attemptRecords === undefined) error.attemptRecords = ledger.entries();
  return error;
}
