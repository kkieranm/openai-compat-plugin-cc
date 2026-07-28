// SSE framing. Split from http.test.js the same way sse.mjs is split from
// http.mjs, and for the same reason: framing defects are invisible to a fake
// server that writes one whole frame per call, so these drive the byte
// boundaries a real TCP connection produces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeServer } from './helpers.mjs';
import { send } from '../scripts/lib/http.mjs';
import { createSseParser, readSse } from '../scripts/lib/sse.mjs';

/** Drive the parser directly — no socket, so a case is a list of strings. */
function parse(...chunks) {
  const seen = [];
  const parser = createSseParser((payload) => seen.push(payload));
  let done = false;
  for (const chunk of chunks) done = parser.push(chunk) || done;
  if (!done) done = parser.end();
  return { seen, done };
}

async function stream(handler) {
  const server = await startFakeServer(handler);
  // finally, not a trailing close: a parse failure throws mid-iteration, and a
  // server left listening keeps the whole test process alive — which looks like
  // a hung suite rather than a failing test.
  try {
    const response = await send(`${server.baseUrl}/x`, { firstByteMs: 5_000 });
    const outcome = {};
    const seen = [];
    for await (const event of readSse(response, 'test', outcome)) seen.push(event);
    return { seen, outcome };
  } finally {
    await server.close();
  }
}

test('a frame split mid-JSON across chunks is reassembled', () => {
  assert.deepEqual(parse('data: {"half":', '"yes"}\n\n').seen, ['{"half":"yes"}']);
});

test('a data line split immediately after its field name still parses', () => {
  assert.deepEqual(parse('data:', ' {"a":1}\n\n').seen, ['{"a":1}']);
});

test('CRLF, lone CR, and a CRLF split across chunks all frame identically', () => {
  assert.deepEqual(parse('data: {"a":1}\r\n\r\n').seen, ['{"a":1}']);
  assert.deepEqual(parse('data: {"a":1}\r\r').seen, ['{"a":1}']);
  // The split case is the one that silently doubles a line ending: a buffer
  // ending in a bare \r must wait for the next chunk before deciding.
  assert.deepEqual(parse('data: {"a":1}\r', '\n\r\n').seen, ['{"a":1}']);
});

test('multiple events in one chunk are all delivered, in order', () => {
  assert.deepEqual(parse('data: {"a":1}\n\ndata: {"b":2}\n\n').seen, ['{"a":1}', '{"b":2}']);
});

test('comment keepalives carry no data and never become events', () => {
  // A proxy holding a connection open emits these indefinitely. Parsed as data
  // they would hit JSON.parse and fail the whole stream.
  assert.deepEqual(parse(': keep-alive\n\n', 'data: {"a":1}\n\n').seen, ['{"a":1}']);
  assert.deepEqual(parse(':\n\n:\n\n').seen, []);
});

test('event, id and retry fields are ignored; only data accumulates', () => {
  assert.deepEqual(parse('event: message\nid: 7\nretry: 100\ndata: {"a":1}\n\n').seen, ['{"a":1}']);
});

test('multiple data lines in one event join with newlines', () => {
  // A server that pretty-prints its JSON would otherwise lose every line but
  // the first.
  assert.deepEqual(parse('data: {"a":\ndata: 1}\n\n').seen, ['{"a":\n1}']);
});

test('exactly one leading space is stripped, and the value is never trimmed', () => {
  // A token delta is legitimately " the". Trimming eats the space that joins two
  // words, and every fixture built from single words hides it.
  assert.deepEqual(parse('data:  the\n\n').seen, [' the']);
  assert.deepEqual(parse('data: {"t":" the"}\n\n').seen, ['{"t":" the"}']);
});

test('a final event with no trailing blank line is still delivered at EOF', () => {
  // On LM Studio this is the frame carrying `usage`.
  const { seen, done } = parse('data: {"a":1}\n\ndata: {"usage":{"total_tokens":9}}');
  assert.deepEqual(seen, ['{"a":1}', '{"usage":{"total_tokens":9}}']);
  assert.equal(done, false, 'EOF is not [DONE]');
});

test('an empty data field is a legal event carrying nothing, not a parse failure', () => {
  // Spec-legal filler, emitted by proxies beside `:` comments. Dispatching it as
  // `''` sent an empty string to JSON.parse and killed a run whose answer had
  // already fully arrived — with no degrade rung able to retry it.
  assert.deepEqual(parse('data:\n\n').seen, []);
  assert.deepEqual(parse('data: \n\n').seen, []);
  assert.deepEqual(parse('data:\n\ndata: {"a":1}\n\n').seen, ['{"a":1}']);
});

test('a final [DONE] terminated by a bare CR is still the terminator', () => {
  // scanLines holds back a trailing `\r` in case it is half of a split `\r\n`.
  // At EOF it is a line ending, and leaving it attached made the payload
  // "[DONE]\r" — failing the equality test and reaching JSON.parse, so a
  // complete reply was reported as a protocol failure.
  const { seen, done } = parse('data: {"a":1}\r\rdata: [DONE]\r');
  assert.deepEqual(seen, ['{"a":1}']);
  assert.equal(done, true);
});

test('[DONE] terminates and is never emitted as an event', () => {
  const { seen, done } = parse('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"after":true}\n\n');
  assert.deepEqual(seen, ['{"a":1}'], 'nothing after the terminator is read');
  assert.equal(done, true);
});

test('a multi-byte character split across TCP chunks is not corrupted', async () => {
  const text = 'héllo — wörld 🌍';
  const frame = Buffer.from(`data: ${JSON.stringify({ text })}\n\n`, 'utf8');
  const cut = frame.indexOf(Buffer.from('🌍', 'utf8')) + 2;

  const { seen } = await stream(async (record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(frame.subarray(0, cut));
    await new Promise((r) => setTimeout(r, 20));
    response.end(frame.subarray(cut));
  });

  assert.deepEqual(seen, [{ text }], 'decoding per chunk would mojibake the split code point');
});

test('an event that is not JSON names the server and quotes the payload', async () => {
  const failed = await stream((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"broken":\n\n');
  }).then(() => null, (error) => error);

  assert.match(failed?.message ?? '', /test sent an event that is not JSON/);
  assert.match(failed.message, /\{"broken":/);
  assert.equal(failed.name, 'UserError');
});

test('sawDone distinguishes a terminated stream from a truncated one', async () => {
  const terminated = await stream((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"a":1}\n\ndata: [DONE]\n\n');
  });
  assert.equal(terminated.outcome.sawDone, true);

  const truncated = await stream((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"a":1}\n\n');
  });
  assert.equal(truncated.outcome.sawDone, false, 'the accumulator cannot tell finished from cut short unless this is honest');
});
