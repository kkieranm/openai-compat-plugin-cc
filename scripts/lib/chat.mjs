import { readJson } from './body.mjs';
import { applyCompletion, emptyAnswer } from './completion.mjs';
import { budgetError } from './http-errors.mjs';

/** A completion far larger than any context window could produce. */
const MAX_COMPLETION_CHARS = 8_000_000;
import { request } from './provider.mjs';
import { RUNGS } from './capability-ladder.mjs';
import { collectStream } from './stream-collect.mjs';

/**
 * Obtaining one chat completion: the budgets that mean "the model is working",
 * and the ladder that degrades when a server refuses a capability.
 *
 * Split from `client.mjs` under the size ratchet. The seam is where "make an
 * HTTP request to a provider" ends and "get an answer out of a model" begins —
 * which is also the seam between budgets a transport can measure (bytes) and
 * budgets only this layer can (tokens).
 */

/**
 * The negotiated request, owned by the caller so it survives an answer retry.
 *
 * `removed` and `payload` used to be locals here, reset on every call — which
 * was fine while nothing retried this function, and a defect the moment
 * something did. The sequence: a server refuses `stream_options`, the degraded
 * request streams and is then truncated, and an answer retry starting from the
 * original body knowingly re-sends the field the server already rejected,
 * collects the same 400, and reclimbs the whole ladder. One wasted round trip
 * per retry, and a stderr line blaming a capability that was settled two
 * requests ago.
 */
export function createNegotiation(body) {
  return { removed: new Set(), payload: body, lastRung: null };
}

/**
 * One answer's worth of requests, degrading as capabilities are refused.
 *
 * Every iteration is one physical request and gets one ledger entry. The entry
 * for the request that *returns bytes* is handed back still open: three of the
 * four delivery failures are only detected by `finishAnswer`, one layer up, so
 * closing it here would file a dead request as a successful attempt.
 */
export async function postWithDegrade(profile, budgets, negotiation) {
  let dispatches = 0;
  for (;;) {
    // Refused BEFORE anything is recorded, and evaluated ONCE. An entry minted
    // ahead of the check files a request that never went on the wire as a failed
    // physical attempt, inventing server unreliability out of a deadline this
    // plugin imposed — and a *second* evaluation downstream reopens the same gap
    // one call frame later. See `capBudgets` (OAI-22, OAI-23).
    const budget = capBudgets(profile, budgets.expiresAt, budgets.maxMs);
    const handle = budgets.ledger?.begin({
      body: negotiation.payload,
      cause: { answerAttempt: budgets.answerAttempt ?? 1, degrade: negotiation.lastRung },
      // Only the FIRST request of an answer attempt followed the retry sleep.
      // The degrade rungs after it are immediate, and stamping them with the
      // same wait would triple the recorded cost of pacing.
      waitedMs: dispatches === 0 ? budgets.waitedMs ?? 0 : 0,
    });
    dispatches += 1;
    try {
      const result = await postChat(profile, negotiation.payload, budgets, budget);
      return { ...result, handle };
    } catch (error) {
      const rung = RUNGS.find((candidate) => !negotiation.removed.has(candidate.name) && candidate.matches(error));
      // A refused SHAPE is negotiation, not unreliability — but only once the
      // different shape has actually been dispatched. `refuse` closes the entry
      // as the failure it is and reclassifies it when the next iteration reaches
      // `ledger.begin`, which is *after* the `capBudgets` above: a cap that falls
      // due in between ends the run with nothing replaced (OAI-23).
      //
      // That entry is now proof of dispatch, not merely of intent to dispatch:
      // OAI-22 removed `postChat`'s second cap check, so nothing between
      // `ledger.begin` and the socket can refuse the request any more.
      if (rung) handle?.refuse(error);
      else handle?.fail(error, error?.timings ?? {});
      if (!rung) throw error;
      negotiation.removed.add(rung.name);
      negotiation.lastRung = rung.name;
      // Said out loud, like the response_format retry beside it: a silent
      // degrade hides a request this plugin got wrong as well as it hides a
      // server that cannot take one.
      process.stderr.write(`${profile.name} ${rung.note}.\n`);
      negotiation.payload = rung.apply(negotiation.payload);
    }
  }
}

/**
 * What is left of the caller's wall-clock cap, or `undefined` when there is none.
 *
 * The cap is passed down as an **instant**, not a duration, and that is the whole
 * point of it. An earlier design armed a fresh `maxMs` inside each attempt, which
 * makes the name a lie: `postWithDegrade` retries this function, and the
 * `response_format` ladder in `review-request.mjs` retries *that*, so three
 * attempts under `--max-seconds 600` could run for 1,800s while every individual
 * attempt honoured its cap. The defence for it — a refused capability is rejected
 * before any generation — is a claim this repo has already written down as
 * unverified: `review-report.mjs` records that a server may prefill before
 * refusing a field and that nothing here detects it.
 *
 * So one expiry is minted per command and every attempt subtracts from it.
 * `performance.now()` because a wall-clock step must not lengthen a cap.
 *
 * Called ONCE per dispatch and the result carried into `postChat`, never
 * re-evaluated there: two evaluations straddling `ledger.begin` can disagree,
 * and the one that falls due in between mints an entry for a request refused
 * before the socket.
 *
 * The carried `totalMs` is slightly generous in exchange, and the honest bound
 * is *the synchronous work between here and the socket* — not "sub-millisecond",
 * which was this comment's first claim and overstated it. No `await` sits in the
 * gap, but `ledger.begin` serializes the messages for `promptChars` and
 * `request` serializes the body again, so on a 60k-token prompt it is
 * milliseconds, against a cap measured in seconds. A request dispatched a hair
 * after expiry is then granted the duration that remained at the check. Bounded
 * and immaterial at these scales — and the price of never recording a request
 * that was not sent. OAI-22; ADR 012.
 */
function capBudgets(profile, expiresAt, maxMs) {
  if (!Number.isFinite(expiresAt)) return {};
  const totalMs = expiresAt - performance.now();
  // Refused rather than dispatched. A request sent with a non-positive budget
  // would be aborted by its own timer a tick later, so the round trip is pure
  // waste — and worse, `armBudgets` gates on `totalMs > 0`, so a zero would arm
  // *nothing* and the attempt would run unbounded past a cap that had already
  // expired. The same error a live expiry produces, because it is the same fact.
  //
  // Reported as the cap the caller *set*, not as the nothing that was left —
  // the same choice `createDeadline` makes above, and for the same reason:
  // "did not finish within the 0.0s cap" sends someone to change a number
  // nobody configured.
  if (totalMs <= 0) throw budgetError('deadline', maxMs ?? 0, 0, profile.name, { serverResponded: false });
  return { totalMs, totalBudget: 'deadline', totalReportMs: maxMs };
}

/**
 * `budget` is REQUIRED, and is the caller's already-evaluated cap — never
 * recomputed here, which would reopen the window OAI-22 closed (see
 * `capBudgets`). Required rather than defaulted so a future caller cannot omit
 * the contract and run a request the cap should have refused.
 */
async function postChat(profile, body, { onProgress, firstTokenMs, idleMs, reasoningReserveTokens }, budget) {
  // One absolute deadline for the whole attempt. Arming the semantic budget with
  // a *fresh* firstTokenMs after the transport has already waited would grant up
  // to twice the number the config advertises — the same double-count as
  // re-arming at headers, one layer up.
  const deadlineAt = Date.now() + firstTokenMs;
  // Stamped per attempt, not per call. `postWithDegrade` retries this function
  // when a server refuses a capability, so an answer can cost two or three
  // requests — and timing from the *first* of them would charge the answering
  // attempt for a round trip it never made. Each refused attempt is rejected at
  // request validation before any generation (see the ladder above), so it
  // neither prefills nor warms a cache, and the attempt that answers is the one
  // whose cost is real.
  const startedAt = performance.now();
  const response = await request(profile, '/chat/completions', {
    method: 'POST',
    body,
    firstByteMs: firstTokenMs,
    ...budget,
  });
  const answer = emptyAnswer();
  // Chosen by response shape, not by config: a server that ignores `stream`
  // answers with a whole JSON completion, and that is the same answer read a
  // different way (ADR 002's shape-not-name rule).
  if (response.contentType !== 'text/event-stream') {
    // A finite document, so bytes are the right signal — and without this the
    // first chunk retires the only budget and a stalled body hangs forever.
    response.setIdle(idleMs);
    // No deltas will arrive on this path, so the heartbeat would otherwise sit
    // on `prefill` while the model was actively generating a whole answer.
    onProgress?.(answer, 'waiting');
    // Bounded: the idle budget stops a *stalled* body, but a steady endless one
    // would be accumulated until the process died. A completion is small — the
    // model's own token limit bounds it — so this only ever trips on a peer that
    // is not sending a completion at all.
    applyCompletion(answer, await readJson(response, profile.name, { maxChars: MAX_COMPLETION_CHARS }));
    // Null, not zero, and not the elapsed time. Nothing here observed the
    // boundary between waiting and generating — the whole reply arrived at
    // once — so any number would be this layer asserting a server-side fact it
    // has no evidence for. `analysisCut` already uses null for "not determined".
    return { answer, sawDone: true, streamed: false, prefillMs: null, generationMs: null };
  }
  const remaining = Math.max(1, deadlineAt - Date.now());
  const streamed = await collectStream(response, profile, {
    startedAt,
    firstTokenMs: remaining,
    reportMs: firstTokenMs,
    idleMs,
    onProgress,
    reasoningReserveTokens,
    // A value distinct from `reasoningReserveTokens` — the request's own raw
    // completion-token budget, not the merged reserve (OAI-115). `body` is
    // already in scope; `body.max_tokens` is only set when the caller passed
    // one (see `chatCompletion` above), so this is `undefined` for a caller
    // that never named a budget.
    maxTokens: body.max_tokens,
  });
  return { ...streamed, streamed: true };
}
