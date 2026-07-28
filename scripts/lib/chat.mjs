import { readJson } from './body.mjs';
import { applyCompletion, applyFrame, emptyAnswer } from './completion.mjs';
import { budgetError } from './http-errors.mjs';
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
function createDeadline({ firstTokenMs, idleMs, onExpire }) {
  let started = false;
  let timer = null;
  const set = (budget, ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => onExpire(budget, ms), ms);
    timer.unref?.();
  };
  set('first-token', firstTokenMs);
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

async function collectStream(response, profile, { firstTokenMs, idleMs, onProgress }) {
  const answer = emptyAnswer();
  const outcome = {};
  let expired = null;
  const deadline = createDeadline({
    firstTokenMs,
    idleMs,
    onExpire: (budget, ms) => {
      expired = budgetError(budget, ms, answer.content.length + answer.reasoning.length, profile.name);
      response.dispose();
    },
  });

  try {
    for await (const frame of readSse(response, profile.name, outcome)) {
      if (applyFrame(answer, frame)) deadline.progress();
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
  return { answer, sawDone: outcome.sawDone };
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
  for (;;) {
    try {
      return await postChat(profile, payload, budgets);
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

async function postChat(profile, body, { onProgress, firstTokenMs, idleMs }) {
  // One absolute deadline for the whole attempt. Arming the semantic budget with
  // a *fresh* firstTokenMs after the transport has already waited would grant up
  // to twice the number the config advertises — the same double-count as
  // re-arming at headers, one layer up.
  const deadlineAt = Date.now() + firstTokenMs;
  const response = await request(profile, '/chat/completions', { method: 'POST', body, firstByteMs: firstTokenMs });
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
    applyCompletion(answer, await readJson(response, profile.name));
    return { answer, sawDone: true, streamed: false };
  }
  const remaining = Math.max(1, deadlineAt - Date.now());
  const streamed = await collectStream(response, profile, { firstTokenMs: remaining, idleMs, onProgress });
  return { ...streamed, streamed: true };
}
