// The notice about a persisted endpoint must not itself disclose one.
//
// Every one of these reaches `insertJob` — the notice really fires — because
// that is the whole lesson of this defect. The version this replaces was
// asserted about across four review passes, and every assertion ran on a refusal
// path where the notice never fired, so a real injected leak reported green. An
// assertion that cannot fail is not evidence, so each test here proves the notice
// fired, by matching its whole line, while proving what it does not say.
//
// The last two deliberately return no job id: they drive the partial failure the
// notice's wording exists for — a worker that never starts, leaving a row nobody
// was given an id for.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, readJob, readJobs, stateDir, submitWithSlowStderr, waitForState } from './job-helpers.mjs';

/** The token a leak would print. Distinctive enough that a match is never a coincidence. */
const SECRET = 'SUPERSECRET123';

/**
 * The whole sentence, written out here ON PURPOSE rather than imported from
 * `task-submit.mjs`.
 *
 * Importing it was tried and is worse than the duplication it removes: the
 * expectation would move with the code, so adding "accessible only to your
 * account" would change both sides at once and pass — exactly the class this
 * assertion exists to catch. Where the wording IS the security property, the
 * test is the specification and a second copy is the guard; drift between these
 * two strings is the signal, not a defect.
 */
const NOTICE =
  'Note: if this submission creates a job record, its full endpoint — including any query string — ' +
  'will be written to jobs.db; a later worker-start failure does not remove it.';

/**
 * The notice as a WHOLE LINE, or nothing.
 *
 * `stderr.includes(NOTICE)` was the previous form and could not fail on the case
 * that matters most: appending " It is accessible only to your account." inside
 * the notice leaves the expected substring intact, so the suite passed the exact
 * regression the literal duplication was introduced to catch.
 *
 * **Stated limit:** this pins the notice's own line. A reassurance added as a
 * SEPARATE stderr line is not caught, and nothing here claims otherwise — that
 * needs a whitelist of every line the command may print, which the estimate note
 * and the substitution warning already make a moving target.
 */
function noticeLine(stderr) {
  return stderr.split('\n').includes(NOTICE);
}

/** Answers the probe, then one non-streaming completion, on any path. */
function modelsAndChat(id = 'test-model') {
  return (request, response) => {
    if (request.url.includes('/models')) {
      respondJson(response, { data: [{ id, object: 'model' }] });
      return;
    }
    respondJson(response, {
      model: id,
      choices: [{ message: { content: 'the answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    });
  };
}

/**
 * Submit one background job against a fake server at `baseUrl`, and let the
 * worker finish before the server goes away.
 *
 * The wait is not incidental: a detached worker outliving its fake server is
 * how these tests produce noise that looks like a failure somewhere else.
 */
async function submitAgainst(baseUrl, { viaConfig = false } = {}) {
  const server = await startFakeServer(modelsAndChat());
  const state = stateDir();
  // `viaConfig` puts the endpoint where a real user's usually lives. Every other
  // case here passes `--base-url`, so without this one a regression that gated
  // the notice on that FLAG would leave the whole file green while a configured
  // provider's query credential went unannounced.
  const endpoint = baseUrl(server);
  const { path: configPath } = writeConfig({
    providers: {
      fake: {
        baseUrl: viaConfig ? endpoint : server.baseUrl,
        defaultModel: 'test-model',
        contextLength: 8192,
        timeoutSeconds: 5,
      },
    },
    defaultProvider: 'fake',
  });

  try {
    const submit = await runCompanion(
      [
        'task',
        '--background',
        ...(viaConfig ? [] : ['--base-url', endpoint]),
        '--model',
        'test-model',
        'summarise this',
      ],
      { configPath, env: { OAI_PLUGIN_STATE: state } },
    );
    assert.equal(submit.status, 0, `submit failed: ${submit.stderr}`);
    const id = submit.stdout.trim();
    assert.match(id, /^[0-9a-f]{8}$/, `expected a job id, got ${JSON.stringify(submit.stdout)}`);
    await waitForState(state, id, ['completed', 'failed']);
    return { submit, row: readJob(state, id) };
  } finally {
    await server.close();
  }
}

test('a credential in the query string is never printed by the notice about it', { skip: NEEDS_SQLITE }, async () => {
  const { submit, row } = await submitAgainst((server) => `${server.baseUrl}?api_key=${SECRET}`);

  // Fired — proved first, so the two assertions below are anchored to a path
  // that ran rather than to one that returned early.
  assert.ok(noticeLine(submit.stderr), `notice did not fire exactly: ${JSON.stringify(submit.stderr)}`);
  assert.ok(!submit.stderr.includes(SECRET), `the notice printed the credential: ${JSON.stringify(submit.stderr)}`);
  assert.ok(!submit.stdout.includes(SECRET), `the credential reached stdout: ${JSON.stringify(submit.stdout)}`);

  // …and the notice is TRUE, which nothing above shows: a notice that is merely
  // not leaky would still pass if `buildJob` stopped persisting the query. This
  // is the assertion that ties the wording to the storage it describes.
  assert.ok(
    row.transport.query.includes(SECRET),
    `the notice claims the endpoint is persisted, but the row holds ${JSON.stringify(row.transport)}`,
  );
});

test('a credential in the URL path is covered too, and also not printed', { skip: NEEDS_SQLITE }, async () => {
  // The case the old notice missed ENTIRELY: `normalizeBaseUrl` keeps a path in
  // `baseUrl`, which is persisted with the same consequence, and matches no
  // test of `profile.query`. So this is a coverage claim as well as a leak one.
  const { submit, row } = await submitAgainst((server) => `${server.baseUrl}/${SECRET}`);

  assert.ok(noticeLine(submit.stderr), `notice did not fire exactly: ${JSON.stringify(submit.stderr)}`);
  assert.ok(!submit.stderr.includes(SECRET), `the notice printed the credential: ${JSON.stringify(submit.stderr)}`);
  // "full endpoint" has to mean the path too, or the notice is false exactly
  // where the old one was silent.
  assert.ok(
    row.transport.baseUrl.includes(SECRET),
    `the path credential was not persisted where the notice says: ${JSON.stringify(row.transport)}`,
  );
});

test('the notice is unconditional — a plain endpoint still says what is stored', { skip: NEEDS_SQLITE }, async () => {
  // Pins the trigger. A future change that gates the notice on "looks like a
  // secret" has to fail here, because such a gate cannot be written correctly:
  // `?SUPERSECRET123` parses as a parameter NAME with no value.
  const { submit } = await submitAgainst((server) => server.baseUrl);

  assert.ok(noticeLine(submit.stderr), `notice did not fire exactly: ${JSON.stringify(submit.stderr)}`);
});

test('the notice promises nothing about who can read the file', { skip: NEEDS_SQLITE }, async () => {
  // `job-store.mjs` hardens best-effort and swallows every failure (OAI-95), so
  // "readable only by you" was a guarantee the code could not give. The exact
  // match is what enforces it: any REPLACEMENT assurance changes the sentence,
  // and a changed sentence fails — which naming one phrase cannot do.
  const { submit } = await submitAgainst((server) => `${server.baseUrl}?api_key=${SECRET}`);

  assert.ok(noticeLine(submit.stderr), `notice did not fire exactly: ${JSON.stringify(submit.stderr)}`);
  assert.ok(!/readable only by you/i.test(submit.stderr), `the notice made a permission promise: ${submit.stderr}`);
});

test('a query credential in the CONFIGURED provider is announced too', { skip: NEEDS_SQLITE }, async () => {
  // No `--base-url` anywhere: the endpoint comes from the config file, which is
  // where a real one lives. Pins the notice to submission rather than to a flag.
  const { submit, row } = await submitAgainst((server) => `${server.baseUrl}?api_key=${SECRET}`, { viaConfig: true });

  assert.ok(noticeLine(submit.stderr), `notice did not fire exactly: ${JSON.stringify(submit.stderr)}`);
  assert.ok(!submit.stderr.includes(SECRET), `the notice printed the credential: ${JSON.stringify(submit.stderr)}`);
  assert.ok(
    row.transport.query.includes(SECRET),
    `the configured credential was not persisted where the notice says: ${JSON.stringify(row.transport)}`,
  );
});

test('the notice survives a preamble larger than the pipe buffer', { skip: NEEDS_SQLITE }, async () => {
  // The defect both approvers rejected this feature over, and the reason the
  // call sits ABOVE `prepareTask` rather than below it: `process.exit(2)`
  // discards undrained stderr, and the unbounded provider name in the preamble
  // pushed the notice past the pipe buffer, losing it on a run that had already
  // written the row. Measured: 131245 bytes, notice absent, one row on disk.
  // `adr/019` carries the account, including the `writeSync` remedy that did not
  // work and why the endpoint here must come from the CONFIG — `--base-url`
  // replaces the provider name in the preamble, so with that flag only ~1 KB is
  // written, nothing truncates, and this test passes against the reverted fix.
  const server = await startFakeServer(modelsAndChat());
  const state = stateDir();
  mkdirSync(join(state, 'logs', '1.log'), { recursive: true });
  const name = 'p'.repeat(1_000_000);
  const { path: configPath } = writeConfig({
    providers: {
      [name]: {
        baseUrl: `${server.baseUrl}?api_key=${SECRET}`,
        defaultModel: 'test-model',
        contextLength: 8192,
        timeoutSeconds: 5,
      },
    },
    defaultProvider: name,
  });

  try {
    const submit = await submitWithSlowStderr(['task', '--background', '--model', 'test-model', 'x'], { configPath, state });

    assert.notEqual(submit.status, 0, 'the worker must still fail to start');
    // The conjunction is the point: a delivered notice with no row, or a row
    // with no notice, would each pass half of this.
    const rows = readJobs(state);
    assert.equal(rows.length, 1, `expected the orphaned row: ${JSON.stringify(rows)}`);
    assert.ok(noticeLine(submit.stderr), 'the notice was lost behind the preamble — the row exists and nothing said so');
    assert.ok(!submit.stderr.includes(SECRET), `the notice printed the credential: ${JSON.stringify(submit.stderr.slice(-2000))}`);
  } finally {
    await server.close();
  }
});

test('a worker that never starts still leaves the row the notice warned about', { skip: NEEDS_SQLITE }, async () => {
  // Killed wording #4, made executable — the case the whole sentence is built
  // around, and the one the five SUCCESSFUL cases above are blind to. (The
  // delivery test above also fails after `insertJob`, for a different invariant.)
  //
  // `spawnWorker` opens `logs/<seq>.log` AFTER `insertJob` has written the row.
  // Putting a directory at that path makes the open fail, so the submission dies
  // exactly where the notice says it can: row on disk, credential in it, no job
  // id, nonzero exit. Nothing here touches `job-spawn.mjs`; it is driven through
  // its real code path by an unopenable file.
  const server = await startFakeServer(modelsAndChat());
  const state = stateDir();
  mkdirSync(join(state, 'logs', '1.log'), { recursive: true });
  const { path: configPath } = writeConfig({
    providers: {
      fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 },
    },
    defaultProvider: 'fake',
  });

  try {
    const submit = await runCompanion(
      ['task', '--background', '--base-url', `${server.baseUrl}?api_key=${SECRET}`, '--model', 'test-model', 'x'],
      { configPath, env: { OAI_PLUGIN_STATE: state } },
    );

    assert.notEqual(submit.status, 0, 'a worker that cannot start must not report success');
    assert.ok(!/^[0-9a-f]{8}$/m.test(submit.stdout.trim()), `no job id should be reported: ${submit.stdout}`);
    // The notice fired anyway — which is the point. It was emitted before the
    // row existed, so it is true even though the submission failed.
    assert.ok(noticeLine(submit.stderr), `notice did not fire exactly: ${JSON.stringify(submit.stderr)}`);
    assert.ok(!submit.stderr.includes(SECRET), `the notice printed the credential: ${JSON.stringify(submit.stderr)}`);

    // …and the row really is there, with the credential, unreachable by any job
    // id the caller was given. "A later worker-start failure does not remove it"
    // is now a tested claim rather than a careful sentence.
    const rows = readJobs(state);
    assert.equal(rows.length, 1, `expected the orphaned row to survive: ${JSON.stringify(rows)}`);
    assert.ok(
      JSON.stringify(rows[0].transport).includes(SECRET),
      `the orphaned row lost the credential the notice describes: ${JSON.stringify(rows[0].transport)}`,
    );
  } finally {
    await server.close();
  }
});
