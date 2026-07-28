import { UserError } from './errors.mjs';

/**
 * The refusal vocabulary of the transport.
 *
 * Split from `http.mjs` under the size ratchet, and the seam is a real one: these
 * are the four ways a request can fail *before* any caller-specific meaning is
 * attached, and every one of them must be a `UserError` — `cmd-setup.mjs` and
 * `delegate.mjs` rethrow anything else, so a plain Error turns one unreachable
 * provider into an exit-2 crash of the whole report.
 */

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
export function transportError(error, url) {
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

/**
 * `fetch` transparently decompressed; `node:http` does not, and it does not ask
 * for compression either. A gzipped body would reach the parser as mojibake,
 * produce no `data:` line, and die on the idle budget — a symptom
 * indistinguishable from the bug this module fixes. So the request asks for
 * `identity` and a server that compresses anyway is refused by name.
 */
export function assertDecodable(response, url) {
  const encoding = response.headers['content-encoding'];
  if (!encoding || encoding === 'identity') return null;
  const error = new UserError(`${url.host} sent a ${encoding}-compressed response, which this client cannot decode.`, {
    hint: 'The request asks for `accept-encoding: identity`; a proxy or server is overriding it.',
  });
  error.reason = 'protocol';
  error.serverResponded = true;
  return error;
}
