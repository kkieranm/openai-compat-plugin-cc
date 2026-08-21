import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { UserError } from './errors.mjs';
import { TRANSPORT } from './failure-shape.mjs';
import { arm, armBudgets } from './http-budgets.mjs';
import { assertDecodable, budgetError, transportError } from './http-errors.mjs';

/**
 * This repo's only HTTP client, and it exists because of a bug the previous one
 * could not express. Node's global `fetch` is undici, and undici applies its own
 * `headersTimeout` and `bodyTimeout` — both 300s, neither reachable from
 * `fetch()`'s options. An `AbortSignal.timeout()` beside them can only *lower*
 * the effective bound, never raise it, so a configured 1800s was silently
 * `min(1800s, 300s)`: 14 of 18 benchmark runs died at five minutes while the
 * config insisted otherwise.
 *
 * This module bounds only what a transport can honestly measure:
 *
 *   firstByteMs — connect, send, and the model's prefill. Legitimately silent —
 *                 a 52k-token prompt measured 393.7s before its first token.
 *   totalMs     — an optional absolute deadline for the whole exchange.
 *
 * `idleMs` bounds the gap between body chunks, and it is **only ever correct for
 * reading a finite document** — a JSON body, or an error body. There, bytes are
 * the whole signal: the document is a fixed size and a gap means the peer
 * stopped. It is emphatically wrong for a *stream*, where an SSE comment
 * (`: keepalive`), a role-only delta or a half-delivered frame are all activity
 * that proves nothing about generation — a server emitting `:\n\n` every 30
 * seconds would hold a byte-driven timer open forever while the plugin reported
 * it armed. So the chat path omits it and owns first-token and idle budgets of
 * its own, reset by parsed deltas carrying text.
 *
 * `totalMs` is what keeps the control plane safe. `/v1/models` and the
 * `model-info` probes are bounded totals today (10s and 2s) and can never reach
 * undici's 300s; handing them a phase-based budget with no ceiling would let a
 * slow drip block `/oai:setup` forever, since it awaits every provider. Chat
 * omits it by default — a run still producing tokens is working however long it
 * takes — but passes it, labelled `deadline` via `totalBudget`, when a caller
 * sets `--max-seconds`. That is the only ceiling on a streamed run: the
 * first-token budget is retired once text arrives and the idle budget resets on
 * every text-bearing frame, so a model that keeps emitting is otherwise
 * unbounded. `totalBudget` exists because the two uses need different prose and
 * different tie-break priority; see `armBudgets`.
 *
 * **There are no default budgets here on purpose.** A default in this module
 * would be the same invisible number it was written to abolish, so every caller
 * names one and `send` refuses without it. Status handling is deliberately *not*
 * here either: the message a caller needs carries the provider's name and the
 * 400-character body that `structured.mjs` pattern-matches, and this module
 * knows neither.
 */

const TRANSPORTS = { 'http:': httpRequest, 'https:': httpsRequest };

/** The media type alone — `text/event-stream; charset=utf-8` is routine. */
export function mediaType(headerValue) {
  return String(headerValue ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/**
 * The body as an async iterable of strings, carrying the idle budget.
 *
 * A generator with a `finally`, because a consumer that stops early — `readSse`
 * returns at `[DONE]` — must still release the timer and the socket. Without it
 * a live timer sits behind a half-read connection.
 *
 * Exported for the test, not for a caller — same reason as `requestErrorHandler`
 * below. Both ways of cutting a body that Node can be measured with on 26.3
 * (a short content-length, chunked with no terminator) raise on the stream
 * instead of ending cleanly, so neither the `!response.complete` branch below
 * nor the catch's code-less path is reachable through a real `node:http`
 * server. A stub async iterable reaches both directly.
 */
export async function* bodyStream(request, response, state, { url }) {
  try {
    for await (const chunk of response) {
      if (state.received === 0) {
        // The first-byte budget is retired here and only here. Clearing it when
        // the *headers* arrive would disarm it entirely: on a streaming server
        // headers come back at 0.0s.
        clearTimeout(state.firstByteTimer);
        state.firstByteTimer = null;
      }
      state.received += chunk.length;
      // Only when a caller asked for it — see setIdle, and the module note on
      // why bytes are the wrong unit for a stream but the right one for a
      // finite document.
      if (state.idleMs) {
        clearTimeout(state.idleTimer);
        state.idleTimer = arm(state.idleMs, () => {
          state.aborted = budgetError('idle', state.idleMs, state.received, url.host);
          request.destroy();
        });
      }
      yield chunk;
    }
    if (state.aborted) throw state.aborted;
    // A socket cut mid-body can end the iteration with no 'error' event at all.
    // Treating that as a complete answer is how a truncated reply becomes a
    // confident wrong one.
    if (!response.complete) {
      const error = new UserError(
        `${url.host} closed the connection before the response finished (${state.received} characters received).`,
      );
      // The constant, not the literal it was. This is the one branch reaching
      // `reason` without passing through `transportError`, and it carries the
      // most retryable shape here — so a bare string is exactly the divergence
      // `failure-shape.mjs` argues against: rename the code and this silently
      // stops being retried.
      error.reason = TRANSPORT;
      error.serverResponded = true;
      throw error;
    }
  } catch (error) {
    // Ours outranks the socket's: destroying after a budget fires produces an
    // ECONNRESET a tick later, and that generic message is what the user would
    // otherwise see in place of which budget elapsed.
    //
    // The wrap is not belt-and-braces. A connection reset *after* headers is
    // destroyed by Node on the response object, not the request, so the
    // `request.on('error')` handler never runs, `state.aborted` stays null, and
    // a raw `Error: aborted` escaped this module — past cmd-setup.mjs's and
    // delegate.mjs's `instanceof UserError` gates, turning one dropped
    // connection into a crash of the whole /oai:setup report. The
    // `!response.complete` branch below cannot catch it either: the iterator
    // throws before the loop can exit normally.
    if (state.aborted) throw state.aborted;
    // `delivered`, unconditionally: this generator only runs once headers have
    // resolved, so whatever broke here broke a response that was already being
    // carried. That is retryable regardless of whether the error arrived with a
    // `code` — see `transportError`.
    throw error instanceof UserError ? error : transportError(error, url, { delivered: true });
  } finally {
    // Both, and on every exit path — completion, `break`, or a throw. The total
    // deadline deliberately keeps running across the body, so only the end of
    // the iteration retires it.
    clearTimeout(state.firstByteTimer);
    clearTimeout(state.totalTimer);
    clearTimeout(state.idleTimer);
    if (!response.complete) request.destroy();
  }
}

/**
 * One request. Resolves as soon as response headers arrive, handing back a body
 * stream still under both budgets. Non-2xx is *not* an error here — the caller
 * owns that, so it can name the provider and keep the body the degrade path
 * pattern-matches.
 */
function requestOptions(target, method, headers) {
  return {
    protocol: target.protocol,
    // `hostname`, not `host`: it drops the brackets an IPv6 literal carries.
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method,
    // `fetch` supplied an Accept and an Accept-Encoding of its own; raw
    // node:http sends neither, and a server choosing a default for us is how a
    // JSON endpoint starts answering HTML.
    headers: { accept: 'application/json, text/event-stream', 'accept-encoding': 'identity', ...headers },
    // No connection pool. A handful of requests per process, and a pooled
    // socket outliving the last one is a way for a CLI to hang at exit.
    agent: false,
  };
}


/** Headers have arrived: hand back a reader, or refuse what we cannot decode. */
function onResponse({ request, response, state, target, resolve, fail, release }) {
  if (state.settled) {
    response.resume();
    return;
  }
  const undecodable = assertDecodable(response, target);
  if (undecodable) {
    response.resume();
    fail(undecodable);
    request.destroy();
    return;
  }
  state.settled = true;
  // Strings, not Buffers: IncomingMessage decodes through a StringDecoder, which
  // holds back a multi-byte sequence split across TCP chunks.
  response.setEncoding('utf8');
  resolve({
    status: response.statusCode,
    statusText: response.statusMessage || '',
    headers: response.headers,
    contentType: mediaType(response.headers['content-type']),
    stream: bodyStream(request, response, state, { url: target }),
    /**
     * Bound the gap between body chunks from here on.
     *
     * Opt-in, and settable *after* headers, because one response can need both
     * answers: a 200 SSE body must never be bounded by bytes, while the error
     * body of that same request — read only once the status is known to be a
     * failure — has no stream to protect and must not be able to hang.
     */
    setIdle: (ms) => {
      state.idleMs = ms > 0 ? ms : null;
      // Armed immediately, not on the first chunk. A non-2xx reply with a
      // *zero-byte* body never enters the loop, so an arm-on-chunk budget was
      // never created at all — leaving the chat path (which passes no totalMs)
      // bounded only by the 600s first-token budget. Worse, the caller swallows
      // that eventual failure, so the error body arrives empty and
      // structured.mjs cannot see the field name its degrade path matches on.
      clearTimeout(state.idleTimer);
      if (!state.idleMs) return;
      state.idleTimer = arm(state.idleMs, () => {
        state.aborted = budgetError('idle', state.idleMs, state.received, target.host);
        request.destroy();
      });
    },
    dispose: () => {
      release();
      request.destroy();
    },
  });
}

/**
 * The request-level `'error'` handler, lifted out so its one decision is testable.
 *
 * Usually this fires before any response — a refused connection, a name that
 * does not resolve — but **not always**, and the difference is not cosmetic. It
 * assigns `state.aborted` *before* `fail` consults `state.settled`, and
 * `bodyStream`'s catch gives a stored `state.aborted` priority over whatever the
 * iterator threw. So a request error arriving after headers is stashed here and
 * surfaces through the body path, where classifying it blind would file a live
 * delivery failure as one not worth retrying. `state.settled` is the answer: set
 * when headers resolve, it means "a response was obtained".
 *
 * Exported for the test, not for a caller — `TRANSPORTS` is module-private and
 * `send` takes no transport seam, so the post-header race cannot be driven end
 * to end. That the handler is still wired in is covered by the
 * refused-connection test.
 */
export function requestErrorHandler(state, target, fail) {
  return (error) => {
    state.aborted ??= transportError(error, target, { delivered: state.settled });
    fail(state.aborted);
  };
}

export function send(url, options = {}) {
  const { method = 'GET', headers = {}, body, firstByteMs, totalMs, totalBudget = 'total', totalReportMs } = options;
  const target = new URL(url);
  const transport = TRANSPORTS[target.protocol];
  if (!transport) throw new UserError(`Unsupported protocol "${target.protocol}" in ${url}.`);
  // A plain Error, not a UserError: a missing budget is a bug in this repo, and
  // silently defaulting one is the exact failure this module exists to remove.
  if (!(firstByteMs > 0)) throw new Error('send(): firstByteMs is required');

  return new Promise((resolve, reject) => {
    const state = {
      aborted: null,
      received: 0,
      settled: false,
      firstByteTimer: null,
      totalTimer: null,
      idleMs: null,
      idleTimer: null,
    };
    const release = () => {
      clearTimeout(state.firstByteTimer);
      clearTimeout(state.totalTimer);
      clearTimeout(state.idleTimer);
    };
    const fail = (error) => {
      if (state.settled) return;
      state.settled = true;
      release();
      reject(error);
    };

    const request = transport(requestOptions(target, method, headers), (response) =>
      onResponse({ request, response, state, target, resolve, fail, release }),
    );

    armBudgets(request, state, { firstByteMs, totalMs, totalBudget, totalReportMs, host: target.host, fail });

    // Attached before the body is written: a refused connection otherwise
    // throws unhandled instead of reaching describeFailure.
    request.on('error', requestErrorHandler(state, target, fail));

    if (body !== undefined) {
      const payload = Buffer.from(body, 'utf8');
      // Explicit, because a multi-byte character makes byte length and string
      // length disagree and the server would read a truncated body.
      request.setHeader('content-length', payload.length);
      request.write(payload);
    }
    request.end();
  });
}

