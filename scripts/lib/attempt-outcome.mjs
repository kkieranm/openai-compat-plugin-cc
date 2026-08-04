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
 * Did this failed request obtain an HTTP RESPONSE — did headers arrive?
 *
 * A different question from `reachedTheModel` above, and the two must never be
 * folded together even though both read `error.status`. They read it for
 * OPPOSITE answers: a status means an HTTP response WAS obtained and the model's
 * prefill was NOT reached. `reachedTheModel` decides warm-eligibility, where
 * over-marking deletes a real cold measurement with no trace; this decides only
 * what the record says happened, and nothing downstream of it touches
 * `dispatched`.
 *
 * Four witnesses, which PARTITION the failure families rather than making every
 * site redundant — a distinction an earlier draft of this comment got wrong, and
 * a `lean-wide` verifier proved wrong by tracing the sites:
 *
 *   - a `status` — an HTTP status IS a response; nothing else can produce one.
 *     Covers the validation refusals, which `provider.mjs` also flags. Typed,
 *     not merely present: `status: null` carries no status and must not read as
 *     one, which a `!== undefined` check let through.
 *   - a completion shape — a reply document arrived and `finishAnswer` judged it
 *     unusable, so bytes were served whatever the verdict on them.
 *   - `serverResponded` — the transport saw headers and said so. This one carries
 *     the post-response transport and protocol family: `sse.mjs`, `body.mjs` and
 *     `http.mjs` mint `protocol`, `bad-json` and `transport` failures with no
 *     `.status` and no completion shape.
 *   - a measured `prefillMs` — stamped at the first frame carrying actual text,
 *     so model output was served, so headers were. See below: this is the only
 *     witness that survives a site forgetting.
 *
 * The fourth exists because the third turned out to be a single point of
 * forgetting in fact and not just in theory. A verifier DELETED the flag write
 * in `body.mjs`'s `bad-json` branch and the whole suite stayed green — so
 * "the flag is their only evidence" was true, and the guard for it was not
 * there. `prefillMs` comes from the timings the caller measured rather than from
 * anything a minting site remembered to set, which is exactly the failure that
 * proved real. It cannot produce a false positive: model text implies headers.
 *
 * It is honestly a BACKSTOP, not a live path. Every production site that can
 * measure a prefill already sets the flag — `sse.mjs`, `http.mjs`, and
 * `budgetError` via `state.settled` — and the deadline paths that pass
 * `serverResponded: false` carry no prefill. So today it fires only on a record
 * that is already self-contradictory. That is the point: the record cannot say
 * "model text at 7ms" and "nothing answered" at once, whatever a future site
 * forgets.
 *
 * And it has a cost, which the next review found and this comment must not hide:
 * a witness that reconstructs the value can MASK a test written to guard a site.
 * The end-to-end case for the delivered-body path measured a prefill, so it went
 * on passing with the flag write deleted. `tests/attempt-response-sites.test.js`
 * now drives each covered site with no model text at all, so the flag is the only
 * witness there and deleting it reddens exactly one case. That file also names
 * the two sites it does NOT reach — read it before believing any site here is
 * guarded, because two rounds of this comment claimed more than it could.
 *
 * What it does NOT establish is reachability. `false` is the absence of an
 * obtained response, not evidence about what was at the other end.
 */
function obtainedResponse(error, { prefillMs } = {}) {
  if (error?.serverResponded === true) return true;
  // A status CODE, not a property that happens to exist. `!== undefined` admitted
  // `null`; `typeof === 'number'` still admitted `NaN`, `0` and `Infinity`, none
  // of which any server sent. Each loosening turned "no response" into "a
  // response" for a request that never got one.
  if (Number.isInteger(error?.status) && error.status >= 100) return true;
  if (COMPLETION_SHAPES.has(error?.reason)) return true;
  // Likewise a MEASUREMENT, not merely a non-null. A `NaN` here would be a
  // failed measurement claiming to be one, and it would flip an `ECONNREFUSED`
  // that correctly recorded `false`.
  return Number.isFinite(prefillMs) && prefillMs >= 0;
}

/**
 * The entry, with a hook letting a layer that never held its handle reclassify
 * it. Non-enumerable: entries are serialized straight into the benchmark record,
 * and a function there would be dropped by `JSON.stringify` anyway — this keeps
 * it out of the recorded shape entirely.
 *
 * It writes `outcome` and `reason` and deliberately not `serverResponded`, which
 * is load-bearing rather than an omission. There is exactly ONE route in —
 * `pendUntilReplaced` → `pend` → `refusalSlot.settle()` in `attempt-ledger.mjs` →
 * here — and `pendUntilReplaced` has already written `true` unconditionally, so
 * every entry arriving here carries it. Writing the field again would be
 * deriving it from an error this layer does not have: `refuseLast()` forwards
 * none. If a second route to `markRefused` is ever added, it has to set the flag
 * itself or mint `{outcome: 'refused', serverResponded: false}` — a record
 * claiming nothing answered a request that was answered with a refusal.
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
  // Unconditional, NOT `obtainedResponse(error)`. A shape rejection is an HTTP
  // response by definition — something read the request and answered it with a
  // refusal — so this follows from the outcome rather than from evidence about
  // the error. "Something", not "the model server": a proxy or gateway can
  // return a 400 without the server behind it ever seeing the request, which is
  // why the flag is worded as a response obtained and never as a peer reached.
  // Deriving it would also be wrong twice over in practice:
  // `refuseLast()` is called with no error at all, which would overwrite the
  // `true` a preceding `fail()` correctly recorded from the 400's status, and a
  // `refuse({ reason: null })` would mint a refused entry claiming nothing
  // answered it.
  entry.serverResponded = true;
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
      // Also from the outcome, not from evidence: an attempt cannot answer
      // without a response having been obtained.
      entry.serverResponded = true;
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
      // The only closer that has to WEIGH this rather than knowing it: a failure
      // is the one ending that can fall on either side.
      entry.serverResponded = obtainedResponse(error, { prefillMs });
      entry.prefillMs = prefillMs;
      entry.generationMs = generationMs;
      if (reachedTheModel(error, { prefillMs })) dispatched.add(key);
    },
  };
}
