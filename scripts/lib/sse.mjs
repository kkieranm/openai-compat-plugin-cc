import { UserError } from './errors.mjs';

/**
 * Server-sent event framing — the subset OpenAI-compatible servers actually
 * emit, parsed incrementally.
 *
 * Kept apart from `http.mjs` so every framing defect below is reproducible from
 * an array of strings with no socket involved. Framing bugs are invisible in
 * end-to-end tests, because a fake server that writes one whole frame per call
 * exercises none of the cases a real TCP connection produces.
 */

/**
 * A frame's `data` payload, assembled across chunks.
 *
 * `push` returns true once `[DONE]` has been seen, so a caller can stop reading
 * rather than waiting on a keep-alive connection that will never close.
 */
/**
 * The `data` value of one line, or null if the line carries none.
 *
 * `:` opens a comment — proxies emit `: keep-alive` purely to hold a connection
 * open, and treated as data it would fail the whole stream. `event:`, `id:` and
 * `retry:` are not ours to interpret.
 */
function dataValue(raw) {
  if (raw.startsWith(':')) return null;
  const colon = raw.indexOf(':');
  if ((colon === -1 ? raw : raw.slice(0, colon)) !== 'data') return null;
  const value = colon === -1 ? '' : raw.slice(colon + 1);
  // Exactly one leading space is stripped, per the spec — never trimmed. A token
  // delta is legitimately " the", and trimming eats the space that joins two
  // words. Every fixture built from single words hides this.
  return value.startsWith(' ') ? value.slice(1) : value;
}

/**
 * Feed every complete line in `buffer` to `line`, returning the unconsumed tail.
 *
 * A frame splits across TCP chunks routinely, so the tail is carried forward
 * rather than parsed. `stop()` lets the caller abandon the rest of a buffer once
 * the terminator has been seen.
 */
function scanLines(buffer, line, stop) {
  const separator = /\r\n|\n|\r/g;
  let consumed = 0;
  let match = separator.exec(buffer);
  while (match !== null) {
    // A buffer ending in a bare `\r` may be the first half of a split `\r\n`.
    // Stop and let the next chunk decide: consuming it here turns one line
    // ending into two, and dispatches the event a frame early.
    if (match[0] === '\r' && match.index + 1 === buffer.length) break;
    line(buffer.slice(consumed, match.index));
    consumed = match.index + match[0].length;
    if (stop()) return '';
    separator.lastIndex = consumed;
    match = separator.exec(buffer);
  }
  return buffer.slice(consumed);
}

export function createSseParser(onEvent) {
  let buffer = '';
  let data = [];
  let done = false;

  const dispatch = () => {
    // A block of comments carries no data and is not an event. Emitting one as
    // `''` would put an empty string through JSON.parse and fail the stream.
    if (data.length === 0) return;
    const payload = data.join('\n');
    data = [];
    if (payload === '[DONE]') {
      done = true;
      return;
    }
    // A lone `data:` with no value is a legal event that carries nothing, and
    // servers and proxies emit them as filler beside `:` comments. Passing `''`
    // to JSON.parse would kill a run whose answer had already fully arrived.
    if (payload === '') return;
    onEvent(payload);
  };

  const line = (raw) => {
    if (raw === '') {
      dispatch();
      return;
    }
    const value = dataValue(raw);
    if (value !== null) data.push(value);
  };

  return {
    push(chunk) {
      buffer = scanLines(buffer + chunk, line, () => done);
      if (done) buffer = '';
      return done;
    },

    /**
     * The stream ended. A server that closes without a trailing blank line
     * still leaves one complete event in hand, and on LM Studio that is the
     * frame carrying `usage`.
     */
    end() {
      // scanLines holds back a trailing bare `\r` in case it is half of a split
      // `\r\n`. At EOF it is a line terminator, and leaving it attached makes
      // `[DONE]\r` fail the terminator test and reach JSON.parse — reporting a
      // complete reply as a protocol failure.
      if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1);
      if (buffer) line(buffer);
      buffer = '';
      dispatch();
      return done;
    },
  };
}

/**
 * Each event of an SSE response, parsed.
 *
 * `outcome.sawDone` is reported through an object rather than a return value
 * because a `for await` consumer never sees a generator's return. It matters:
 * an EOF without `[DONE]` is not automatically a complete answer, and the
 * accumulator has to be able to tell a finished reply from a truncated one.
 */
export async function* readSse(response, what, outcome = {}) {
  const pending = [];
  const parser = createSseParser((payload) => pending.push(payload));
  let done = false;
  outcome.sawDone = false;

  const drain = function* () {
    while (pending.length) {
      const payload = pending.shift();
      try {
        yield JSON.parse(payload);
      } catch (error) {
        // The payload is server-controlled, and JSON.parse's own error
        // quotes a fragment of it — the streaming sibling of body.mjs's
        // non-JSON leak. Neither may go on .message or .hint,
        // which errorReport() persists into jobs.db and which an uncaught
        // worker error also writes to its own job log; the excerpt travels
        // on .bodyExcerpt instead.
        const failure = new UserError(`${what} sent an event that is not JSON.`);
        failure.reason = 'protocol';
        failure.serverResponded = true;
        failure.bodyExcerpt = payload.slice(0, 200);
        throw failure;
      }
    }
  };

  for await (const chunk of response.stream) {
    done = parser.push(chunk);
    yield* drain();
    // Returning here rather than reading to EOF matters: the generator's
    // `finally` in http.mjs closes the socket, so a keep-alive server that
    // holds the connection open past the terminator cannot park us.
    if (done) {
      outcome.sawDone = true;
      return;
    }
  }
  done = parser.end();
  yield* drain();
  outcome.sawDone = done;
}
