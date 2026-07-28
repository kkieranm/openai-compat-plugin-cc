import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { UserError } from './errors.mjs';

/**
 * This repo's only HTTP client, and it exists because of a bug the previous one
 * could not express. Node's global `fetch` is undici, and undici applies its own
 * `headersTimeout` and `bodyTimeout` — both 300s, neither reachable from
 * `fetch()`'s options. An `AbortSignal.timeout()` beside them can only *lower*
 * the effective bound, never raise it, so a configured 1800s was silently
 * `min(1800s, 300s)`: 14 of 18 benchmark runs died at five minutes while the
 * config insisted otherwise. See ADR 007.
 *
 * This module bounds only what a transport can honestly measure:
 *
 *   firstByteMs — connect, send, and the model's prefill. Legitimately silent —
 *                 a 52k-token prompt measured 393.7s before its first token.
 *   totalMs     — an optional absolute deadline for the whole exchange.
 *
 * **There is deliberately no byte-level idle budget**, because bytes are the
 * wrong unit and a plausible-looking one here would be worse than none. An SSE
 * comment (`: keepalive`), a role-only delta or a half-delivered frame are all
 * "activity" that proves nothing about generation, so a server emitting `:\n\n`
 * every 30 seconds would hold a byte-driven timer open forever while the plugin
 * reported it armed. Whether progress is real is a question only the chat layer
 * can answer — it owns the first-token and idle budgets, reset by parsed deltas.
 *
 * `totalMs` is what keeps the control plane safe. `/v1/models` and the
 * `model-info` probes are bounded totals today (10s and 2s) and can never reach
 * undici's 300s; handing them a phase-based budget with no ceiling would let a
 * slow drip block `/oai:setup` forever, since it awaits every provider. Chat
 * omits it — a run still producing tokens is working however long it takes.
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

export function budgetError(budget, budgetMs, received, host) {
  // Rounding alone reports a sub-second budget as "0s", which reads as a bug in
  // the plugin rather than a short deadline.
  const seconds = budgetMs < 10_000 ? `${(budgetMs / 1000).toFixed(1)}` : Math.round(budgetMs / 1000);
  const messages = {
    'first-byte': [
      `${host} sent no response body within ${seconds}s.`,
      'A large prompt can take minutes to ingest before the first token — raise --timeout, or timeoutSeconds in the config.',
    ],
    total: [
      `${host} did not finish within its ${seconds}s deadline.`,
      'This is a control-plane request with a fixed budget, not a model call.',
    ],
    'first-token': [
      `${host} sent no output within ${seconds}s of the request.`,
      'A large prompt can take minutes to ingest before the first token — raise --timeout, or timeoutSeconds in the config.',
    ],
    idle: [
      `${host} stopped after ${received} characters, with no further output for ${seconds}s.`,
      'The model began answering and then stalled — check the server log; raising --timeout will not help.',
    ],
  };
  const [message, hint] = messages[budget];
  const error = new UserError(message, { hint });
  error.reason = `${budget}-timeout`;
  error.budgetMs = budgetMs;
  error.received = received;
  // Anything past the first byte means a status line arrived, so the server is
  // up and answering — the distinction cmd-setup.mjs draws to avoid telling
  // someone to restart a server that is already running.
  if (budget !== 'first-byte') error.serverResponded = true;
  return error;
}

/**
 * Every failure leaving this module is a `UserError`, and that is a contract,
 * not a nicety: `cmd-setup.mjs:28` and `delegate.mjs:59` both rethrow anything
 * else, so a plain Error turns one unreachable provider into an exit-2 crash of
 * the whole report and makes an optional probe fatal.
 */
function transportError(error, url) {
  // Node 18.18 turned on address-family autoselection, so a host resolving to
  // both A and AAAA fails as an AggregateError whose useful code sits in
  // `errors[]` — and `error.code` on the outer object is undefined. Reading only
  // the outer one turns "connection refused", with its start-the-server hint,
  // into a bare "Request failed".
  const cause = error.code ? error : (error.errors?.find((inner) => inner?.code) ?? error);
  const wrapped = new UserError(`Request to ${url.host} failed: ${cause.message ?? error.message}`);
  wrapped.reason = 'transport';
  // describeFailure already reads `error?.cause?.code ?? error?.code`, and the
  // provider-specific start hints hang off this.
  wrapped.code = cause.code;
  wrapped.cause = cause;
  return wrapped;
}

function arm(ms, onFire) {
  const timer = setTimeout(onFire, ms);
  // A pending budget must never be the reason a CLI stays alive.
  timer.unref?.();
  return timer;
}

/**
 * `fetch` transparently decompressed; `node:http` does not, and it does not ask
 * for compression either. A gzipped body would reach the parser as mojibake,
 * produce no `data:` line, and die on the idle budget — a symptom
 * indistinguishable from the bug this module fixes. So the request asks for
 * `identity` and a server that compresses anyway is refused by name.
 */
function assertDecodable(response, url) {
  const encoding = response.headers['content-encoding'];
  if (!encoding || encoding === 'identity') return null;
  const error = new UserError(`${url.host} sent a ${encoding}-compressed response, which this client cannot decode.`, {
    hint: 'The request asks for `accept-encoding: identity`; a proxy or server is overriding it.',
  });
  error.reason = 'protocol';
  error.serverResponded = true;
  return error;
}

/**
 * The body as an async iterable of strings, carrying the idle budget.
 *
 * A generator with a `finally`, because a consumer that stops early — `readSse`
 * returns at `[DONE]` — must still release the timer and the socket. Without it
 * a live timer sits behind a half-read connection.
 */
async function* bodyStream(request, response, state, { url }) {
  try {
    for await (const chunk of response) {
      if (state.received === 0) {
        // The first-byte budget is retired here and only here. Clearing it when
        // the *headers* arrive would disarm it entirely: on a streaming server
        // headers come back at 0.0s. Nothing replaces it — see the module note
        // on why a byte-level idle budget would be worse than none.
        clearTimeout(state.firstByteTimer);
        state.firstByteTimer = null;
      }
      state.received += chunk.length;
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
      error.reason = 'transport';
      error.serverResponded = true;
      throw error;
    }
  } catch (error) {
    // Ours outranks the socket's: destroying after a budget fires produces an
    // ECONNRESET a tick later, and that generic message is what the user would
    // otherwise see in place of which budget elapsed.
    throw state.aborted ?? error;
  } finally {
    // Both, and on every exit path — completion, `break`, or a throw. The total
    // deadline deliberately keeps running across the body, so only the end of
    // the iteration retires it.
    clearTimeout(state.firstByteTimer);
    clearTimeout(state.totalTimer);
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

/**
 * Arms the transport-level budgets. Both destroy the request and settle, because
 * `destroy()` does not reliably emit `'error'` across Node lines and a fired
 * budget that only destroys would hang forever.
 */
function armBudgets(request, state, { firstByteMs, totalMs, host, fail }) {
  const fire = (budget, ms) => () => {
    state.aborted = budgetError(budget, ms, state.received, host);
    request.destroy();
    fail(state.aborted);
  };
  // Armed before anything is written, and cleared by the first body character
  // rather than by the headers.
  state.firstByteTimer = arm(firstByteMs, fire('first-byte', firstByteMs));
  // The absolute deadline, for control-plane calls that must not outlive it
  // however steadily the peer drips. Chat omits it deliberately.
  if (totalMs > 0) state.totalTimer = arm(totalMs, fire('total', totalMs));
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
    dispose: () => {
      release();
      request.destroy();
    },
  });
}

export function send(url, { method = 'GET', headers = {}, body, firstByteMs, totalMs } = {}) {
  const target = new URL(url);
  const transport = TRANSPORTS[target.protocol];
  if (!transport) throw new UserError(`Unsupported protocol "${target.protocol}" in ${url}.`);
  // A plain Error, not a UserError: a missing budget is a bug in this repo, and
  // silently defaulting one is the exact failure this module exists to remove.
  if (!(firstByteMs > 0)) throw new Error('send(): firstByteMs is required');

  return new Promise((resolve, reject) => {
    const state = { aborted: null, received: 0, settled: false, firstByteTimer: null, totalTimer: null };
    const release = () => {
      clearTimeout(state.firstByteTimer);
      clearTimeout(state.totalTimer);
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

    armBudgets(request, state, { firstByteMs, totalMs, host: target.host, fail });

    // Attached before the body is written: a refused connection otherwise
    // throws unhandled instead of reaching describeFailure.
    request.on('error', (error) => {
      state.aborted ??= transportError(error, target);
      fail(state.aborted);
    });

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

