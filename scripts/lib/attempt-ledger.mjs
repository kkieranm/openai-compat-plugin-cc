import { COMPLETION_SHAPES } from './failure-shape.mjs';

/**
 * Every request that actually went on the wire, and how each one ended.
 *
 * The benchmark scores *logical runs* — the attempt that answered — while
 * reliability is a property of *physical requests*, and conflating the two is
 * how a server that failed twice before answering reads as a healthy one. So
 * one entry per HTTP request, whatever caused it: the first try, a capability
 * degrade, the `response_format` fallback, or a retry after a delivery failure.
 * A failed attempt is missing data, never an observed miss — it must never reach
 * a recall denominator. See ADR 012 and BACKLOG.md OAI-20.
 *
 * One ledger per command, not per call. `review-request.mjs` can call
 * `chatCompletion` twice for one review (the schema request, then the degraded
 * one), and a ledger scoped to a call would restart its indexes half way through
 * and drop the structured request out of the record entirely — which is the same
 * shape as the counter reset that `retried` has been papering over with
 * `|| !structured`.
 */

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
function reclassifiable(entry) {
  return Object.defineProperty(entry, 'markRefused', {
    value: (error) => {
      entry.outcome = 'refused';
      entry.reason = error?.reason ?? null;
    },
  });
}

/**
 * The three ways an entry can close, lifted out of `begin` at the function size
 * budget. `dispatched` is threaded in because warm-eligibility is decided by
 * what a request turned out to be, not by what it was when it left.
 */
function closeHandle(entry, key, dispatched) {
  return {
    settle({ prefillMs = null, generationMs = null } = {}) {
      entry.outcome = 'answered';
      entry.prefillMs = prefillMs;
      entry.generationMs = generationMs;
      dispatched.add(key);
    },
    /**
     * The server rejected the request SHAPE, and the plugin then sent a
     * different one that worked. A third outcome rather than a failure,
     * because capability negotiation is routine and permanent — a server
     * that refuses `stream_options` refuses it every time — and counting it
     * as unreliability would report a server answering 100% of shaped
     * requests as failing half of them. That is the inversion this whole
     * record exists to prevent, running the other way.
     */
    refuse(error) {
      entry.outcome = 'refused';
      entry.reason = error?.reason ?? null;
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
      const serialized = JSON.stringify(body?.messages ?? null);
      const key = `${body?.model ?? ''} ${serialized}`;
      const entry = {
        index: entries.length + 1,
        cause,
        // Request size, which OAI-20 asks the characterization to record — the
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
        prefillMs: null,
        generationMs: null,
      };
      entries.push(reclassifiable(entry));
      return closeHandle(entry, key, dispatched);
    },

    /**
     * Re-close the most recent entry as negotiation rather than failure.
     *
     * Called by the layer that actually SENT a different shape — never inferred
     * from a status code. A 400 alone does not mean negotiation happened: a
     * context-limit rejection and an invalid request are also 400s, no fallback
     * follows them, and marking those `refused` would hide a terminal failure
     * from the reliability count while claiming a different shape was accepted.
     */
    refuseLast(error) {
      entries.at(-1)?.markRefused?.(error);
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
