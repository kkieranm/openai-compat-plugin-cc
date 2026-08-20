import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { NON_RETRYABLE_TRANSPORT, TRANSPORT, isRetryable } from '../scripts/lib/failure-shape.mjs';
import { transportError } from '../scripts/lib/http-errors.mjs';
import { requestErrorHandler, send } from '../scripts/lib/http.mjs';
import { request } from '../scripts/lib/provider.mjs';

/** The rejection, or a failure saying nothing was thrown. */
async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('expected a rejection');
}

// OAI-22. `transport` used to be one bucket holding everything the request
// layer could raise, and `isRetryable` said yes to all of it — so a permanent
// failure this client could recognise, such as a TLS certificate rejection, cost
// three requests and two 2-second sleeps to establish what the first one already
// proved.
//
// Note what this is NOT, because the plan's first draft claimed it and the
// evidence refuted it: an unresolvable hostname was never retried three times.
// `provider.mjs` `describeFailure` rewrote those errors and dropped `reason`
// entirely, so they arrived unclassified and unretried — which is its own defect,
// fixed here too and pinned at the bottom of this file.
//
// These tests pin the split, decided at the CALL SITE rather than by the code on
// the error, because the two callers of `transportError` mean opposite things.
// The axis is retryability, never blame: `EAI_AGAIN` and a pre-response
// `ECONNRESET` are `transport` and carried no response at all, so a `transport`
// tally is not a count of server misbehaviour.

test('a name that will never resolve is not retried, so a typo costs one request', () => {
  const url = new URL('http://nope.invalid/');
  const error = transportError(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), url);

  assert.equal(error.reason, NON_RETRYABLE_TRANSPORT);
  assert.equal(isRetryable(error), false);
  // The code survives the classification: `describeFailure` and the
  // provider-specific hints hang off it, and losing it to buy a reason code
  // would trade one honest message for another.
  assert.equal(error.code, 'ENOTFOUND');
});

test('a refused connection is not retried either — the hint is the fix, and retrying only delays it', () => {
  const error = transportError(
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    new URL('http://127.0.0.1:1/'),
  );

  assert.equal(error.reason, NON_RETRYABLE_TRANSPORT);
  assert.equal(isRetryable(error), false);
});

test('a DNS "try again" IS retried, because that is precisely what the resolver said', () => {
  const error = transportError(
    Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }),
    new URL('http://example.test/'),
  );

  assert.equal(error.reason, TRANSPORT, 'a transient code is the one connect-phase case worth another attempt');
  assert.equal(isRetryable(error), true);
});

test('an unrecognised connect-phase code costs ONE honest request, not three misleading ones', () => {
  // The whitelist direction, which is the safety property. A TLS rejection or a
  // parser error reached a peer and is not "unreachable" — but neither is it
  // known to be transient, so it is not retried and the reader takes `.code`.
  const error = transportError(
    Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
    new URL('https://example.test/'),
  );

  assert.equal(error.reason, NON_RETRYABLE_TRANSPORT);
  assert.equal(isRetryable(error), false);
});

test('a delivery failure stays retryable even with NO code, because the CALL SITE knows', () => {
  // Node hands the body-stream catch a bare `Error: aborted` for a reset after
  // headers, and whether it carries a `code` is version-dependent and not
  // verifiable from here. Classifying by code alone would file this — the one
  // shape most worth retrying — as not worth retrying. `delivered` comes from
  // the generator that only ever runs past headers.
  const error = transportError(new Error('aborted'), new URL('http://example.test/'), { delivered: true });

  assert.equal(error.reason, TRANSPORT);
  assert.equal(isRetryable(error), true);
});

test('the request handler classifies on whether a response was already obtained, not on the code', () => {
  // The competing-event path. `request.on('error')` is usually the connect
  // phase, but it can fire after headers — and it stores into `state.aborted`,
  // which `bodyStream` then gives priority over whatever the iterator threw. So
  // an after-headers request error escapes through the body path, and blind
  // classification would file a live delivery failure as terminal.
  const target = new URL('http://example.test/');
  const bare = () => new Error('aborted');

  const after = { aborted: null, settled: true };
  requestErrorHandler(after, target, () => {})(bare());
  assert.equal(after.aborted.reason, TRANSPORT, 'headers had resolved, so the response was being delivered');
  assert.equal(isRetryable(after.aborted), true);

  const before = { aborted: null, settled: false };
  requestErrorHandler(before, target, () => {})(bare());
  assert.equal(before.aborted.reason, NON_RETRYABLE_TRANSPORT, 'no response, no recognised transient code');
  assert.equal(isRetryable(before.aborted), false);
});

test('the handler still reports the failure, not only classifies it', () => {
  // `fail` is what rejects the send() promise. A handler that classified and
  // returned would leave the request hanging until a budget fired, which is a
  // worse failure than the one being fixed.
  const state = { aborted: null, settled: false };
  const failures = [];
  requestErrorHandler(state, new URL('http://example.test/'), (error) => failures.push(error))(
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0], state.aborted, 'the reported error and the stored one must be the same object');
});

test('a body cut off mid-flight is retryable — the shape OAI-20 exists to survive', async () => {
  // The `!response.complete` branch, which had NO test at all before OAI-22 and
  // is the most retryable shape here: the server took the prompt, generated, and
  // the socket died part way. It is also the one place `reason` is set without
  // going through `transportError`, so the classification tests above cannot
  // reach it — which is exactly how it could have diverged unnoticed.
  //
  // A declared content-length the server never delivers, then a destroyed
  // socket. Whether Node ends the iteration cleanly (leaving `response.complete`
  // false) or raises on the stream first, both paths must land on the same
  // retryable verdict — and asserting the verdict rather than the path is what
  // keeps this test about the invariant.
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '4096' });
    response.write('partial');
    setTimeout(() => response.socket?.destroy(), 10);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  let error = null;
  try {
    const response = await send(url, { firstByteMs: 5_000 });
    for await (const _chunk of response.stream) { /* drain until it dies */ }
  } catch (thrown) {
    error = thrown;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.ok(error, 'a truncated body must not read as a complete answer');
  assert.equal(error.reason, TRANSPORT, 'a dropped delivery is the one thing worth sending again');
  assert.equal(isRetryable(error), true);
});

test('a pre-headers reset is retryable, the whitelist member that actually occurs there', () => {
  // EAI_AGAIN above covers the DNS entry; this covers the socket one. Same
  // branch, but the whitelist is precisely the thing a later edit would prune,
  // and an unexercised member is an invitation.
  const error = transportError(
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    new URL('http://example.test/'),
  );

  assert.equal(error.reason, TRANSPORT);
  assert.equal(isRetryable(error), true);
});

// Through the REAL provider wrapper, which the tests above do not cross.
//
// `describeFailure` rewords three connect codes with provider-specific messages,
// and it used to build fresh errors to do it — dropping `reason`, `code` and
// `cause` on exactly the codes this feature classifies. Every test above would
// still have passed: they call `transportError` directly, one layer below the
// place the classification was being thrown away. Found by the OAI-22
// adversarial review; these are what stop it coming back.

test('a classified failure keeps its reason through the provider rewording', async () => {
  const error = await caught(request({ name: 'p', baseUrl: 'http://127.0.0.1:1/v1' }, '/models', { firstByteMs: 3_000 }));

  assert.equal(error.reason, NON_RETRYABLE_TRANSPORT, 'the ledger records this reason — bare, it tallies as `unclassified`');
  assert.equal(error.code, 'ECONNREFUSED', 'and the start-your-server hint hangs off the code');
  assert.equal(isRetryable(error), false);
  // The provider's message is the point of the rewording, so it must survive too.
  assert.match(error.message, /connection refused/);
});

test('EAI_AGAIN is marked retryable upstream — half of the pair the next test completes', () => {
  // The EAI_AGAIN worry, pinned by composition rather than by a test seam.
  //
  // `describeFailure` rewords `ENOTFOUND` and `EAI_AGAIN` on ONE branch, in one
  // call, with one message — so the test below proving that branch keeps the
  // transport's reason proves it for both codes. What differs between them is
  // only what `transportError` decided upstream, and that is pinned separately:
  // EAI_AGAIN is classified retryable in the unit test above.
  //
  // Composing them is deliberate. A real `EAI_AGAIN` needs a resolver answering
  // "try again" on demand, which a network-free suite cannot arrange, and the
  // alternative — exporting the private `reword` purely so a test can reach it —
  // is production indirection bought for testability, which this repo defers
  // rather than takes (BACKLOG.md OAI-25).
  const direct = transportError(
    Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }),
    new URL('http://example.test/v1'),
  );
  assert.equal(isRetryable(direct), true, 'half one: the transport marks this code retryable');
  // Half two is the next test: the rewording branch it shares keeps the reason.
});

test('an unresolvable host keeps a NAMED reason, so the ledger does not tally it as unclassified', async () => {
  const error = await caught(
    request({ name: 'p', baseUrl: 'http://no-such-host.invalid/v1' }, '/models', { firstByteMs: 3_000 }),
  );

  assert.equal(error.reason, NON_RETRYABLE_TRANSPORT);
  assert.equal(error.code, 'ENOTFOUND');
  assert.equal(isRetryable(error), false);
});

test('a server that sent headers is not reported as one that never answered', async () => {
  // `cmd-setup` reads `serverResponded` to decide whether to say "start the
  // server". A body reset after headers came from a server we had heard from,
  // and the sibling detection in http.mjs has always said so — these two paths
  // must not disagree about a server they both reached.
  const server = createServer((request_, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '4096' });
    response.write('{"dat');
    setTimeout(() => response.socket?.destroy(), 10);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  const error = await caught(
    (async () => {
      const response = await request({ name: 'p', baseUrl }, '/models', { firstByteMs: 5_000 });
      for await (const _chunk of response.stream) { /* drain until it dies */ }
    })(),
  );
  await new Promise((resolve) => server.close(resolve));

  assert.equal(error.reason, TRANSPORT, 'a delivery that broke is retryable');
  assert.equal(error.serverResponded, true, 'it sent headers, so telling the user to start it is wrong');
});

// OAI-185. `describeFailure`'s three `reword(...)` sites used to bake
// `profile.baseUrl` into `.message`, which `errorReport()` persists into
// `jobs.db` and which an uncaught worker error also writes to its own job log.
// `baseUrl` can be secret-shaped, so the endpoint now travels on a separate
// `.endpoint` field and never on `.message` — these tests pin that split at
// each of the three sites, through the real `request()` wrapper.

test('a connection refusal names the endpoint on .endpoint, never on .message', async () => {
  const marker = 'http://127.0.0.1:1/SECRET_MARKER/v1';
  const error = await caught(request({ name: 'p', baseUrl: marker }, '/models', { firstByteMs: 3_000 }));

  assert.equal(error.endpoint, marker);
  assert.doesNotMatch(error.message, /SECRET_MARKER/);
  assert.match(error.message, /connection refused/);
});

test('an unresolvable host names the endpoint on .endpoint, never on .message', async () => {
  const marker = 'http://no-such-host.invalid/SECRET_MARKER/v1';
  const error = await caught(request({ name: 'p', baseUrl: marker }, '/models', { firstByteMs: 3_000 }));

  assert.equal(error.endpoint, marker);
  assert.doesNotMatch(error.message, /SECRET_MARKER/);
});

test('the generic fallback (a non-transport, non-UserError throw) omits the endpoint', async () => {
  // `send()`'s `new URL(url)` is the one throw in this repo's request path that
  // is NEITHER wrapped by `transportError` (both `http.mjs` catch sites already
  // are) NOR already a `UserError` — every other failure `describeFailure` sees
  // is one or the other, and both of those return before reaching the generic
  // `reword()` site. A malformed concatenated URL is what actually reaches it.
  const marker = 'SECRET_MARKER';
  const error = await caught(request({ name: 'p', baseUrl: `http://${marker} not a valid url/v1` }, '/models', { firstByteMs: 3_000 }));

  assert.doesNotMatch(error.message, new RegExp(marker), 'the endpoint must not appear in .message');
  assert.equal(error.endpoint, `http://${marker} not a valid url/v1`, 'it still travels on the structured field');
});

// OAI-185. `assertOk`'s non-2xx branch used to embed up to 400 chars of the
// SERVER's own response body into `.message` — and a server routinely echoes
// the request path/query back in a 404/405 body, which can carry the same
// secret-shaped `baseUrl` segment the tests above cover. The body now lives on
// `.responseBody`, never on `.message`.

test('a non-2xx response body lands on .responseBody, never on .message', async () => {
  const marker = 'SECRET_MARKER';
  const server = createServer((request_, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `Unexpected endpoint or method. (POST /${marker}/v1/chat/completions)` }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/${marker}/v1`;

  const error = await caught(request({ name: 'p', baseUrl }, '/chat/completions', { firstByteMs: 3_000 }));
  await new Promise((resolve) => server.close(resolve));

  assert.equal(error.status, 404);
  assert.match(error.responseBody, new RegExp(marker), 'the echoed body is preserved, on the structured field');
  assert.doesNotMatch(error.message, new RegExp(marker), 'the endpoint-shaped body text must not reach .message');
});

test('a redirect Location header lands on .responseBody, never on .message', async () => {
  const marker = 'SECRET_MARKER';
  const server = createServer((request_, response) => {
    response.writeHead(302, { location: `http://elsewhere.invalid/${marker}` });
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  const error = await caught(request({ name: 'p', baseUrl }, '/chat/completions', { firstByteMs: 3_000 }));
  await new Promise((resolve) => server.close(resolve));

  assert.match(error.responseBody, new RegExp(marker), 'the redirect target is preserved, on the structured field');
  assert.doesNotMatch(error.message, new RegExp(marker), 'the redirect target must not reach .message');
});

test('an empty-body 400 with only a reason phrase still carries it on .responseBody', async () => {
  // Pass-7 finding: dropping statusText outright (rather than folding it in,
  // like the redirect Location) broke capability-fallback detection for a
  // server that signals a refusal purely through the HTTP reason phrase with
  // no body — isFormatRejection/refusedField read only .responseBody now.
  const server = createServer((request_, response) => {
    response.writeHead(400, 'response_format unsupported');
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  const error = await caught(request({ name: 'p', baseUrl }, '/chat/completions', { firstByteMs: 3_000 }));
  await new Promise((resolve) => server.close(resolve));

  assert.equal(error.status, 400);
  assert.match(error.responseBody, /response_format unsupported/);
});
