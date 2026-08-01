import { UserError } from './errors.mjs';
import { NON_RETRYABLE_TRANSPORT, TRANSIENT_CONNECT_CODES, TRANSPORT } from './failure-shape.mjs';

/**
 * The refusal vocabulary of the transport.
 *
 * Split from `http.mjs` under the size ratchet, and the seam is a real one: these
 * are the ways a request can fail *before* any caller-specific meaning is
 * attached, and every one of them must be a `UserError` — `cmd-setup.mjs` and
 * `delegate.mjs` rethrow anything else, so a plain Error turns one unreachable
 * provider into an exit-2 crash of the whole report.
 */

/**
 * What each budget says, and what to do about it.
 *
 * Lifted out of `budgetError` at the function size budget. A function rather
 * than a constant because two of the entries read `received` — a hint that
 * asserts the model was working when nothing arrived is the same class of
 * false report as a `reason` that claims the server answered.
 */
function budgetMessages(host, seconds, received) {
  return {

    'first-byte': [
      `${host} sent no response body within ${seconds}s.`,
      'A large prompt can take minutes to ingest before the first token — raise --timeout, or timeoutSeconds in the config.',
    ],
    total: [
      `${host} did not finish within its ${seconds}s deadline.`,
      'This is a control-plane request with a fixed budget, not a model call.',
    ],
    // Separate from `total`, which it otherwise resembles, because the two say
    // different things to the person reading them: `total` is a fixed
    // control-plane ceiling nobody chose, this is a wall-clock cap the caller
    // set on a model call. Reusing the key would have printed "not a model
    // call" for a model call.
    //
    // The hint is caller-neutral on purpose. The same cap is on `/oai:task`,
    // and a transport-layer error cannot assume the caller is reviewing code —
    // "review a smaller target" would be review-specific remediation arriving
    // from a generic command.
    //
    // **`received` means something different here, and neither line may call it
    // generation.** From `chat.mjs` this parameter carries model text; from the
    // transport it carries raw body bytes, framing and keepalives included. A
    // first draft branched on it to say "the model was still generating", which
    // is the very inference `http.mjs` refuses in its own module note — a server
    // emitting `:\n\n` every 30 seconds moves this counter while producing
    // nothing. That would have sent someone to buy more time from a model that
    // had generated no output at all, in the field added to stop a hint
    // asserting what nobody observed.
    //
    // So both branches say only what the counter can support: bytes arrived, or
    // they did not. Labelled `bytes`, not `characters`, because the SSE envelope
    // around each delta is ~130 bytes and calling that output would overstate a
    // reply by an order of magnitude — and because the `idle` entry below prints
    // the same word for a genuine character count.
    deadline: [
      `${host} did not finish within the ${seconds}s cap${received ? `, after ${received} bytes` : ''}.`,
      received
        ? 'The stream was still open when the cap fired. Bytes on the wire are not evidence the model was '
          + 'generating — a keepalive moves that counter — so this says the run was cut, not that it was '
          + 'productive. Raise --max-seconds, or send a smaller request.'
        : 'Nothing had arrived when the cap fired, so this says nothing about whether the model was working — '
          + 'raise --max-seconds, or check the server is answering.',
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
}

export function budgetError(budget, budgetMs, received, host, { serverResponded } = {}) {
  // Rounding alone reports a sub-second budget as "0s", which reads as a bug in
  // the plugin rather than a short deadline.
  const seconds = budgetMs < 10_000 ? `${(budgetMs / 1000).toFixed(1)}` : Math.round(budgetMs / 1000);
  const messages = budgetMessages(host, seconds, received);
  // A plain Error, like `send()`'s missing-budget check and for the same reason:
  // an unrecognised budget name is a bug in this repo, not a user's problem.
  // Without it `messages[budget]` is undefined, the destructure throws a
  // TypeError, and that escapes past cmd-setup.mjs's and delegate.mjs's
  // `instanceof UserError` gates as an exit-2 crash of the whole report —
  // `totalBudget` is a free-form string threaded through three modules, so this
  // is one typo away rather than hypothetical.
  if (!messages[budget]) throw new Error(`budgetError(): unknown budget "${budget}"`);
  const [message, hint] = messages[budget];
  const error = new UserError(message, { hint });
  error.reason = `${budget}-timeout`;
  error.budgetMs = budgetMs;
  error.received = received;
  // Anything past the first byte means a status line arrived, so the server is
  // up and answering — the distinction cmd-setup.mjs draws to avoid telling
  // someone to restart a server that is already running.
  //
  // The name is only a *proxy* for that fact, and the proxy breaks as soon as a
  // budget spans every phase: `deadline` is armed before DNS, so a black-holed
  // provider that hits the cap would be reported as having answered — false
  // evidence about a server nobody heard from. Callers that know the real state
  // pass it, and the name is used only where it is still a safe stand-in.
  const responded = serverResponded ?? budget !== 'first-byte';
  if (responded) error.serverResponded = true;
  return error;
}

/**
 * Every failure leaving this module is a `UserError`, and that is a contract,
 * not a nicety: `cmd-setup.mjs:28` and `delegate.mjs:59` both rethrow anything
 * else, so a plain Error turns one unreachable provider into an exit-2 crash of
 * the whole report and makes an optional probe fatal.
 */
export function transportError(error, url, { delivered = false } = {}) {
  // Node 18.18 turned on address-family autoselection, so a host resolving to
  // both A and AAAA fails as an AggregateError whose useful code sits in
  // `errors[]` — and `error.code` on the outer object is undefined. Reading only
  // the outer one turns "connection refused", with its start-the-server hint,
  // into a bare "Request failed".
  const cause = error.code ? error : (error.errors?.find((inner) => inner?.code) ?? error);
  const wrapped = new UserError(`Request to ${url.host} failed: ${cause.message ?? error.message}`);
  // `delivered` comes from the CALL SITE, not from the code, and that is the
  // whole design. This function has two callers with opposite meanings: the
  // body-stream catch in `http.mjs`, which only ever runs past headers, and the
  // request `'error'` handler, which usually does not. Classifying by `code`
  // alone would file the first as non-retryable whenever Node hands over a
  // code-less `Error: aborted` — a genuinely retryable delivery failure marked
  // not worth retrying, which is this whole change inverted. Whether Node
  // populates `code` there is version-dependent and unverifiable from here, so
  // the code that KNOWS which phase it is in says so, exactly as
  // `failure-shape.mjs` requires of every tag.
  wrapped.reason = delivered || TRANSIENT_CONNECT_CODES.has(cause.code) ? TRANSPORT : NON_RETRYABLE_TRANSPORT;
  // Headers are a response, so `delivered` settles the other question this error
  // is asked: `cmd-setup.mjs` reads `serverResponded` to decide whether to tell
  // someone to start a server. Without it a body reset mid-`/v1/models` reported
  // a running server as unreachable — and the sibling branch in `http.mjs` that
  // detects the same cut a different way has always set it, so the two paths
  // disagreed about a server they had both heard from.
  if (delivered) wrapped.serverResponded = true;
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
