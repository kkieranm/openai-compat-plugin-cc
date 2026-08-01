// The transport, which exists because undici's 300s defaults were unreachable
// from fetch(). Budgets are driven in milliseconds against a deliberately slow
// local server, so the suite stays fast while exercising the same timers that
// bound a ten-minute prefill in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { closedPort } from './helpers.mjs';
import { isRetryable } from '../scripts/lib/failure-shape.mjs';
import { mediaType, send } from '../scripts/lib/http.mjs';
import { readJson, readText } from '../scripts/lib/body.mjs';
import { readSse } from '../scripts/lib/sse.mjs';

/** A server whose reply each test dictates. */
async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) };
}

async function collect(response, outcome) {
  const seen = [];
  for await (const event of readSse(response, 'test', outcome)) seen.push(event);
  return seen;
}

const caught = (promise) => promise.then(() => null, (error) => error);

// Whether the budget surfaces from `send` or from the body stream depends on
// something invisible: Node buffers response headers until the first write, so
// a server that only calls writeHead has not sent anything yet. Both shapes are
// asserted, and both must be the same UserError — a caller that handled one and
// not the other would crash on the other half of the same failure.
test('headers, then silence: the first-byte budget fires through the body stream', async () => {
  const server = await serve((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    // The exact shape undici killed at 301s — headers really on the wire, no body.
    response.flushHeaders();
  });

  const response = await send(server.url, { firstByteMs: 120 });
  const error = await caught(readText(response));
  await server.close();

  assert.equal(error?.reason, 'first-byte-timeout');
  assert.equal(error.name, 'UserError', 'cmd-setup rethrows anything that is not a UserError, crashing the whole report');
  assert.match(error.message, /no response body within/);
});

test('no headers at all: the same budget rejects the request itself', async () => {
  const server = await serve(() => {
    // Accepted and then ignored — nothing is ever flushed.
  });

  const error = await caught(send(server.url, { firstByteMs: 120 }).then(readText));
  await server.close();

  assert.equal(error?.reason, 'first-byte-timeout');
  assert.equal(error.name, 'UserError');
});

// The property the whole design rests on. undici could not express it: its
// bodyTimeout is inactivity-based too, but fixed at 300s and unreachable.
test('a slow but steady stream outlives a budget far shorter than its total duration', async () => {
  const server = await serve(async (request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (let i = 0; i < 6; i += 1) {
      await new Promise((r) => setTimeout(r, 30));
      response.write(`data: {"n":${i}}\n\n`);
    }
    response.end();
  });

  const started = Date.now();
  const response = await send(server.url, { firstByteMs: 120 });
  const seen = await collect(response);
  const elapsed = Date.now() - started;
  await server.close();

  assert.equal(seen.length, 6);
  assert.ok(elapsed > 120, `ran ${elapsed}ms; it must outlast the ${120}ms first-byte budget to prove the budget was retired`);
});

// The control plane's guarantee, and the reason the fetch ban is safe: /v1/models
// and the model-info probes are bounded totals today, and a drip must not be
// able to hold /oai:setup open forever.
test('an absolute deadline stops a peer that drips forever', async () => {
  const server = await serve(async (request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{');
    for (let i = 0; i < 50; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      if (!response.writableEnded) response.write(' ');
    }
  });

  const response = await send(server.url, { firstByteMs: 5_000, totalMs: 150 });
  const error = await caught(readText(response));
  await server.close();

  assert.equal(error?.reason, 'total-timeout', 'a steady drip clears every phase budget; only an absolute one ends it');
});

// A gzipped body would reach the parser as mojibake, yield no `data:` line, and
// die on a budget — a symptom indistinguishable from the bug this fixes.
test('a compressed response is refused by name, not parsed as noise', async () => {
  const server = await serve((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' });
    response.end('not really gzip');
  });

  const error = await caught(send(server.url, { firstByteMs: 5_000 }));
  await server.close();

  assert.match(error?.message ?? '', /gzip-compressed/);
  assert.equal(error.name, 'UserError');
});

test('the request announces identity encoding and what it accepts', async () => {
  let seen = null;
  const server = await serve((request, response) => {
    seen = request.headers;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });

  const response = await send(server.url, { firstByteMs: 5_000 });
  assert.deepEqual(await readJson(response, 'test'), { ok: true });
  await server.close();

  assert.equal(seen['accept-encoding'], 'identity');
  assert.match(seen.accept, /text\/event-stream/);
});

// fetch reported a refused connection as error.cause.code; node:http reports it
// as error.code, and an AggregateError hides it deeper still. describeFailure
// reads it, but only an assertion proves the provider hint reaches the user.
test('a refused connection surfaces its transport code, not a timeout', async () => {
  const port = await closedPort();
  const error = await caught(send(`http://127.0.0.1:${port}/`, { firstByteMs: 5_000 }));

  assert.equal(error?.code, 'ECONNREFUSED');
  // Not `transport`, and the change is the feature (OAI-22). A refusal will be
  // refused again — retrying it three times buys nothing, delays the
  // start-your-server hint hanging off the code above by ~4s of retry sleeps,
  // and files three phantom server failures in the attempt record against a
  // server that was never running. Still not a timeout, which is what this test
  // was written to pin.
  assert.equal(
    error.reason,
    'non-retryable-transport',
    'calling a refusal a timeout sends the user to the wrong fix; calling it retryable sends three requests to a closed port',
  );
  // The end-to-end proof that `requestErrorHandler` is still wired into `send`.
  // Its two branches are asserted directly in failure-shape.test.js, which can
  // reach a state the real socket race cannot be made to produce on demand.
  assert.equal(isRetryable(error), false);
});

test('a non-2xx reply keeps its status and body for the caller to discriminate', async () => {
  const server = await serve((request, response) => {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end('{"error":"response_format.type must be json_schema"}');
  });

  const response = await send(server.url, { firstByteMs: 5_000 });
  const body = await readText(response);
  await server.close();

  assert.equal(response.status, 400, 'structured.mjs isFormatRejection keys off this');
  assert.match(body, /response_format/, 'and off the body, so both must survive');
});

test('a bounded read stops early rather than swallowing an endless error body', async () => {
  const server = await serve(async (request, response) => {
    response.writeHead(500, { 'content-type': 'text/plain' });
    for (let i = 0; i < 200; i += 1) {
      if (response.writableEnded) return;
      response.write('x'.repeat(100));
      await new Promise((r) => setTimeout(r, 2));
    }
  });

  const response = await send(server.url, { firstByteMs: 5_000 });
  const body = await readText(response, { limit: 400 });
  await server.close();

  assert.equal(body.length, 400, 'an unbounded read of a hostile error body is its own hang');
});

test('the request body is sent whole, with a byte-accurate content-length', async () => {
  let record = null;
  const server = await serve((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      record = { method: request.method, length: request.headers['content-length'], body };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });

  const payload = JSON.stringify({ hello: 'wörld' });
  const response = await send(server.url, { method: 'POST', body: payload, firstByteMs: 5_000 });
  await readJson(response, 'test');
  await server.close();

  assert.equal(record.method, 'POST');
  assert.equal(record.body, payload);
  assert.equal(record.length, String(Buffer.byteLength(payload)), 'a multi-byte character must not truncate the body');
});

test('a non-JSON reply names what it was and quotes the start', async () => {
  const server = await serve((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html>proxy login page</html>');
  });

  const response = await send(server.url, { firstByteMs: 5_000 });
  const error = await caught(readJson(response, 'lmstudio'));
  await server.close();

  assert.match(error?.message ?? '', /^lmstudio returned a non-JSON response/);
  assert.match(error.hint, /proxy login page/, 'quoting the reply is what identifies a proxy in the path');
});

test('mediaType strips parameters and case', () => {
  assert.equal(mediaType('text/event-stream; charset=utf-8'), 'text/event-stream');
  assert.equal(mediaType('APPLICATION/JSON'), 'application/json');
  assert.equal(mediaType(undefined), '');
});
