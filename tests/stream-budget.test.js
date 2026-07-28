// The budgets that mean "the model is working", driven end to end through the
// real CLI.
//
// These exist because the first implementation bounded *bytes*, and bytes are
// the wrong unit: a keepalive comment is socket activity that proves nothing
// about generation, so a server emitting one forever would have held the budget
// open forever while the plugin reported it armed. That is the defect class this
// whole feature exists to remove, so it gets a test rather than a comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completion, deltaFrame, modelList, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

/** A chat endpoint that writes `chunks` forever, every `everyMs`, until closed. */
async function endlessServer(chunks, everyMs = 40) {
  const timers = [];
  const server = await startFakeServer((record, response) => {
    if (record.url.includes('/models')) return respondJson(response, modelList('test-model'));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    let i = 0;
    const timer = setInterval(() => {
      if (response.writableEnded || response.destroyed) return;
      response.write(chunks[Math.min(i, chunks.length - 1)]);
      i += 1;
    }, everyMs);
    timers.push(timer);
    return undefined;
  });
  const close = async () => {
    for (const timer of timers) clearInterval(timer);
    await server.close();
  };
  return { server, close };
}

function configFor(server, extra = {}) {
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: {
      local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, ...extra },
    },
  });
  return path;
}

test('a server that only sends keepalives is stopped, however busy the socket looks', async () => {
  // Bytes never stop arriving. Only the absence of a *token* is the failure, and
  // a byte-driven budget would never fire here.
  const { server, close } = await endlessServer([': keep-alive\n\n']);
  const configPath = configFor(server, { timeoutSeconds: 1, idleSeconds: 1 });

  const result = await runCompanion(['task', 'hello'], { configPath });
  await close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sent no output within/);
  assert.doesNotMatch(result.stderr, /stopped after/, 'nothing was ever generated, so this is not a stall mid-answer');
});

test('a server that emits a role-only frame and then nothing is stopped too', async () => {
  // The opening frame of every real stream carries `content: null`. Counting it
  // as progress would retire the first-token budget on frame one of every run.
  const opening = `data: ${JSON.stringify(deltaFrame({ role: 'assistant', content: null }))}\n\n`;
  const { server, close } = await endlessServer([opening, ': keep-alive\n\n']);
  const configPath = configFor(server, { timeoutSeconds: 1, idleSeconds: 1 });

  const result = await runCompanion(['task', 'hello'], { configPath });
  await close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /sent no output within/);
});

test('a server refusing BOTH stream_options and streaming still gets an answer', async () => {
  // The first shape of the ladder returned the second rung's retry from inside
  // the first rung's catch, so a `stream` rejection arriving *after*
  // stream_options had been dropped escaped with no fallback at all — breaking
  // exactly the providers the ladder exists to keep working.
  const seen = [];
  const server = await startFakeServer((record, response) => {
    if (record.url.includes('/models')) return respondJson(response, modelList('test-model'));
    seen.push(record.body);
    if (record.body.stream_options) {
      return respondJson(response, { error: { message: "unknown field 'stream_options'" } }, 400);
    }
    if (record.body.stream === true) {
      return respondJson(response, { error: { message: 'stream is not supported by this deployment' } }, 400);
    }
    return respondJson(response, completion('the answer after two degrades'));
  });
  const configPath = configFor(server);

  const result = await runCompanion(['task', 'hello'], { configPath });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /the answer after two degrades/);
  assert.equal(seen.length, 3, 'one attempt per rung, and each capability dropped at most once');
  assert.equal(seen[2].stream, false);
  assert.equal(seen[2].stream_options, undefined);
});

test('a whole-JSON reply that stalls mid-document is bounded, not waited on forever', async () => {
  // The degrade path reads a finite document, so bytes are the right signal —
  // and without an idle bound the first chunk retires the only budget and the
  // command hangs indefinitely despite a configured timeout.
  const server = await startFakeServer((record, response) => {
    if (record.url.includes('/models')) return respondJson(response, modelList('test-model'));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"choices":[{"message":{"content":"half a rep');
    return undefined; // …and never finishes.
  });
  const configPath = configFor(server, { timeoutSeconds: 10, idleSeconds: 1 });

  const result = await runCompanion(['task', 'hello'], { configPath });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stopped after \d+ characters/);
});

test('an error body that stalls cannot park the degrade ladder before it starts', async () => {
  // A 400 whose body dribbles one byte and then holds the socket open: the size
  // cap on the error read is not a time cap, and this read is what the ladder
  // classifies against.
  const server = await startFakeServer((record, response) => {
    if (record.url.includes('/models')) return respondJson(response, modelList('test-model'));
    response.writeHead(400, { 'content-type': 'application/json' });
    response.write('{');
    return undefined;
  });
  const configPath = configFor(server, { timeoutSeconds: 30, idleSeconds: 30 });

  const started = Date.now();
  const result = await runCompanion(['task', 'hello'], { configPath });
  const elapsed = Date.now() - started;
  await server.close();

  assert.equal(result.status, 1);
  assert.ok(elapsed < 25_000, `took ${elapsed}ms — the error-body read has its own short deadline, not the request's`);
});

test('a connection reset mid-body is a clean failure, not a crash', async () => {
  // Node destroys the *response* on a mid-body reset, so the request's error
  // handler never runs. The raw `Error: aborted` then escaped the transport and
  // sailed past the `instanceof UserError` gates in cmd-setup.mjs and
  // delegate.mjs — turning one dropped connection into an exit-2 crash of the
  // whole report. Exit 1 is the assertion: it means a UserError got there.
  const server = await startFakeServer((record, response) => {
    if (record.url.includes('/models')) return respondJson(response, modelList('test-model'));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify(deltaFrame({ content: 'half' }))}\n\n`);
    setTimeout(() => response.socket?.destroy(), 30);
    return undefined;
  });
  const configPath = configFor(server, { timeoutSeconds: 10, idleSeconds: 10 });

  const result = await runCompanion(['task', 'hello'], { configPath });
  await server.close();

  assert.equal(result.status, 1, `expected a handled failure, got exit ${result.status}: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /at \w+ \(/, 'a stack trace means it was reported as a bug, not a server problem');
});

test('"streaming is not supported" degrades, not just the bare parameter name', async () => {
  // Matching only /\bstream\b/ left the fallback unreachable for the more
  // natural vendor phrasing, so the ladder would never fire for it.
  const seen = [];
  const server = await startFakeServer((record, response) => {
    if (record.url.includes('/models')) return respondJson(response, modelList('test-model'));
    seen.push(record.body);
    if (record.body.stream === true) {
      return respondJson(response, { error: { message: 'streaming is not supported for this model' } }, 400);
    }
    return respondJson(response, completion('answered without streaming'));
  });
  const configPath = configFor(server);

  const result = await runCompanion(['task', 'hello'], { configPath });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /answered without streaming/);
  assert.equal(seen.at(-1).stream, false);
});

test('a stall after real output is reported as a stall, and says how much arrived', async () => {
  const first = `data: ${JSON.stringify(deltaFrame({ content: 'partial answer' }))}\n\n`;
  const { server, close } = await endlessServer([first, ': keep-alive\n\n']);
  const configPath = configFor(server, { timeoutSeconds: 10, idleSeconds: 1 });

  const result = await runCompanion(['task', 'hello'], { configPath });
  await close();

  assert.equal(result.status, 1);
  // The distinction is the point: "never started" and "started then stopped"
  // need different fixes, and the old blanket "raise --timeout" hint fitted
  // neither.
  assert.match(result.stderr, /stopped after 14 characters/);
  assert.doesNotMatch(result.stderr, /raise --timeout/, 'raising the timeout cannot help a model that stalled mid-answer');
});
