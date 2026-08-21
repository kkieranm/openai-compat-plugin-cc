// The wall-clock cap, and the machine-readable reason a capped run reports.
//
// Both halves of the original failure path. Before this, `--timeout` bounded only the
// wait for the *first* token: once text arrived the idle budget took over and
// reset on every text-bearing frame, so a model that kept emitting ran forever
// and a 6-case corpus at N=3 had no worst case at all. And when a run did fail,
// the CLI wrote prose to stderr and nothing else, so a harness could tell *that*
// a run failed but never *why* — a wall-clock cap and a 500 were the same blob.
//
// The server below is what makes these guards rather than restatements. It emits
// a frame every DRIP_MS, which is far *under* the idle budget — that is the whole
// point. A server that simply stalled would trip the idle timer and the test
// would pass with the cap never armed, which is precisely the bug this feature
// fixes wearing the costume of a passing test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepo, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { reviewScenario as scenario } from './helpers.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Comfortably under the 60s idle budget, so only the cap can end this run. */
const DRIP_MS = 120;

/**
 * A server that starts answering and then never stops.
 *
 * Frames go out as separate `write` calls with real time between them: batched
 * into one chunk they would reach `collectStream` as a single frame and the
 * stream would look instantaneous. `unref` on the interval so a leaked timer
 * cannot hold the test runner open if an assertion throws first.
 */
function endlessStream() {
  const timers = new Set();
  const handler = (record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    const timer = setInterval(() => {
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        model: 'test-model',
        choices: [{ index: 0, delta: { content: 'still thinking ' }, finish_reason: null }],
      })}\n\n`);
    }, DRIP_MS);
    timer.unref?.();
    timers.add(timer);
  };
  return { handler, stop: () => timers.forEach(clearInterval) };
}

test('--max-seconds ends a run that is still producing output', async () => {
  const { handler, stop } = endlessStream();
  const { dir, server, configPath } = await scenario(handler);
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });

    assert.equal(result.status, 1);
    // The reason, not the prose. A harness reading this must not have to
    // pattern-match a message to tell a cap from a server error — that matcher
    // is a fragile-guessing class of bug.
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    assert.equal(envelope.reason, 'deadline-timeout');
    // And the human still gets prose on stderr, unchanged.
    assert.match(result.stderr, /cap/);
    assert.match(envelope.hint, /--max-seconds/);
  } finally {
    stop();
    await server.close();
  }
});

test('the cap does not fire on a run that finishes inside it', async () => {
  // The false-positive guard. Without it, a cap that fired unconditionally —
  // or one armed with the wrong sign — would pass the test above and break
  // every real run.
  const reply = JSON.stringify({ analysis: 'read it', findings: [], summary: 'Nothing found.' });
  const { dir, server, configPath } = await scenario((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: { content: reply }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
  });
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '60'], { configPath, cwd: dir });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).parsed, true);
  } finally {
    await server.close();
  }
});

test('--max-seconds is refused before any request when it is not a number', async () => {
  const { dir, server, configPath } = await scenario((record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', 'soon'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /max-seconds/);
    // The envelope covers validation too, not only failures out on the wire.
    // Scoping it to "operational errors after validation" was the first draft,
    // and it left four failure modes prose-only under a flag documented as
    // machine-readable — a contract broader than its implementation.
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    // Null, not an invented category. Nothing determined a transport reason
    // here, and filling the field would be a guess wearing a schema.
    assert.equal(envelope.reason, null);
  } finally {
    await server.close();
  }
});

test('a failure the guards catch is reported as JSON too, not only on the wire', async () => {
  const { dir, server, configPath } = await scenario((record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  try {
    const result = await runCompanion(['review', '--json', '--diff-only', '--file', 'seed.txt'], {
      configPath,
      cwd: dir,
    });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    assert.match(envelope.message, /--diff-only cannot be combined with --file/);
  } finally {
    await server.close();
  }
});

test('maxSeconds in the provider config caps a run with no flag passed', async () => {
  // `buildProfile`'s whitelist carries its own warning: "a key added to
  // validation and forgotten here validates fine and then does nothing". This is
  // the third key to go through both lists by hand, and the only thing that
  // catches a miss is a test that sets it in the file and passes no flag.
  const { handler, stop } = endlessStream();
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const server = await startFakeServer(handler);
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: {
      local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, maxSeconds: 1 },
    },
  });

  try {
    const result = await runCompanion(['review', '--json'], { configPath: path, cwd: dir });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).reason, 'deadline-timeout');
  } finally {
    stop();
    await server.close();
  }
});

test('a budget larger than a timer can express is refused, not silently made immediate', async () => {
  // Above 2,147,483,647 ms Node clamps a setTimeout delay to 1 ms, so an
  // enormous cap would arm an *immediate* timeout — the exact opposite of what
  // anyone typing it means, and invisible until a run died in milliseconds under
  // a flag its author read as generous. Both duration flags carry the ceiling;
  // `--timeout` had the same latent flaw before this feature and is fixed with it.
  const { dir, server, configPath } = await scenario((record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  try {
    const capped = await runCompanion(['review', '--json', '--max-seconds', '99999999'], { configPath, cwd: dir });
    assert.equal(capped.status, 1);
    assert.match(capped.stderr, /max-seconds/);

    const timeout = await runCompanion(['review', '--json', '--timeout', '99999999'], { configPath, cwd: dir });
    assert.equal(timeout.status, 1);
    assert.match(timeout.stderr, /timeout/);
  } finally {
    await server.close();
  }
});

test('the same ceiling applies to a budget set in the config file', async () => {
  // And only to the budgets: `contextLength` is a token count, not a duration,
  // and is exempt by name. That exemption is the kind of thing a later edit
  // removes without noticing, so both halves are asserted.
  const dir = await createRepo();
  const server = await startFakeServer((record, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  const huge = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', maxSeconds: 99_999_999 } },
  });
  const bigWindow = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 99_999_999 } },
  });

  try {
    const rejected = await runCompanion(['review'], { configPath: huge.path, cwd: dir });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /maxSeconds/);

    const accepted = await runCompanion(['review'], { configPath: bigWindow.path, cwd: dir });
    assert.doesNotMatch(accepted.stderr, /above the .* a timer can express/);
  } finally {
    await server.close();
  }
});
