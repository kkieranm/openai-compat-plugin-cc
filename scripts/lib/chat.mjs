import { readJson } from './body.mjs';
import { applyCompletion, applyFrame, emptyAnswer } from './completion.mjs';
import { budgetError } from './http-errors.mjs';

/** A completion far larger than any context window could produce. */
const MAX_COMPLETION_CHARS = 8_000_000;
import { request } from './provider.mjs';
import { readSse } from './sse.mjs';

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

async function collectStream(response, profile, { startedAt, firstTokenMs, reportMs, idleMs, onProgress }) {
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
    throw expired ?? error;
  } finally {
    deadline.clear();
  }
  return { answer, sawDone: outcome.sawDone, ...timings(startedAt, firstTextAt, performance.now()) };
}

/** A 400 that names the field it refused, rather than the request as a whole. */
function refusedField(error, pattern) {
  if (error?.status !== 400 && error?.status !== 422) return false;
  return pattern.test(error.message ?? '');
}

/**
 * The capability this failure blames, or null if it is not a capability problem.
 *
 * `\bstream\b` does not match inside `stream_options` — `_` is a word character,
 * so there is no boundary — which is what keeps the two rungs distinct.
 */
const RUNGS = [
  {
    name: 'stream_options',
    matches: (error) => refusedField(error, /stream_options/i),
    note: 'rejected stream_options; retrying without it (token counts will be unavailable)',
    apply: ({ stream_options: _dropped, ...rest }) => rest,
  },
  {
    name: 'stream',
    // `streaming is not supported` is at least as likely a vendor phrasing as
    // the bare parameter name, and matching only the latter would leave the
    // fallback unreachable for it. Neither alternative matches `stream_options`:
    // `_` is a word character, so there is no boundary after `stream`.
    matches: (error) => refusedField(error, /\bstream(ing)?\b/i),
    note: 'rejected streaming; retrying without it (no progress will be shown)',
    apply: ({ stream_options: _dropped, ...rest }) => ({ ...rest, stream: false }),
  },
];

export async function postWithDegrade(profile, body, budgets) {
  const removed = new Set();
  let payload = body;
  // Counted and returned, because the timings above belong to the attempt that
  // answered and nothing else would show that earlier ones existed. A server
  // refusing `stream_options` but accepting `stream` sends two requests and
  // still streams, so a measured prefill can sit beside a retry that no output
  // mentions — which is exactly the situation the reader needs to know about.
  let attempts = 0;
  for (;;) {
    try {
      attempts += 1;
      return { ...(await postChat(profile, payload, budgets)), attempts };
    } catch (error) {
      const rung = RUNGS.find((candidate) => !removed.has(candidate.name) && candidate.matches(error));
      if (!rung) throw error;
      removed.add(rung.name);
      // Said out loud, like the response_format retry beside it: a silent
      // degrade hides a request this plugin got wrong as well as it hides a
      // server that cannot take one.
      process.stderr.write(`${profile.name} ${rung.note}.\n`);
      payload = rung.apply(payload);
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

async function postChat(profile, body, { onProgress, firstTokenMs, idleMs, expiresAt, maxMs }) {
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
    ...capBudgets(profile, expiresAt, maxMs),
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
  });
  return { ...streamed, streamed: true };
}
