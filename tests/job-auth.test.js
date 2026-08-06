// Whether a worker may send a credential minutes after the session that asked
// for the job has gone.
//
// `job-auth.mjs` shipped with OAI-3 untested on both sides (OAI-52 item 1),
// which mattered more than the other five gaps: the three-way origin check
// exists *because* the plan gate found the two-term version tautological, and
// nothing executed it. `tests/config.test.js` covers the foreground analogue —
// `resolveProfile` not carrying a key to another origin — which is adjacent
// evidence and not this. The foreground path has no third term to check.
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { authPolicyFor, resolveCredential } from '../scripts/lib/job-auth.mjs';
import { finish } from '../scripts/lib/job-record.mjs';
import { completion, modelList, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, insertSynthetic, readJob, stateDir, waitForState, withStore } from './job-helpers.mjs';

/**
 * A config on disk for the duration of one call.
 *
 * The profile is never called `lmstudio`, `omlx` or `unsloth`: `loadConfig`
 * seeds a default config when the file is missing, so a test that names a
 * seeded provider can resolve one it never wrote and pass for the wrong reason.
 */
function withConfig(config, fn) {
  const { path } = writeConfig(config);
  const previous = process.env.OAI_PLUGIN_CONFIG;
  process.env.OAI_PLUGIN_CONFIG = path;
  try {
    return fn(path);
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previous;
  }
}

const vendorConfig = (baseUrl, apiKey) => ({
  defaultProvider: 'vendor',
  providers: {
    vendor: { baseUrl, apiKey, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 },
  },
});

const AUTHORISED = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example' };
const TRANSPORT = { name: 'vendor', baseUrl: 'https://real.example/v1', query: '' };

test('the policy records where a key was authorised, never the key', () => {
  const policy = authPolicyFor({ name: 'vendor', baseUrl: 'https://real.example/v1?tenant=7', apiKey: 'sk-a' });

  assert.deepEqual(policy, { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example' });
  assert.ok(!JSON.stringify(policy).includes('sk-a'), 'the credential must not reach the row');
});

test('no key at submission means no key later, whatever the config says by then', () => {
  // One shape covering three cases: an open server, a profile whose key
  // `resolveProfile` deliberately withheld because `--base-url` moved the
  // request, and a bare `--base-url` whose synthetic profile will not be in
  // `providers.json` when the worker looks it up.
  assert.deepEqual(authPolicyFor({ name: 'custom', baseUrl: 'http://127.0.0.1:1/v1' }), { mode: 'none' });
  assert.equal(resolveCredential({ mode: 'none' }, TRANSPORT), undefined);
  assert.equal(resolveCredential(null, TRANSPORT), undefined);
});

test('the profile still pointing where the job was authorised supplies the key', () => {
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    assert.equal(resolveCredential(AUTHORISED, TRANSPORT), 'sk-a');
  });
});

test('a profile that has since moved origin cannot lend its new key to the old endpoint', () => {
  // The informative leg. `authorizedOrigin` and the transport both came from
  // submission, so checking one against the other passes by construction; the
  // current config is the only term carrying information.
  withConfig(vendorConfig('https://elsewhere.example/v1', 'sk-b'), () => {
    assert.throws(
      () => resolveCredential(AUTHORISED, TRANSPORT),
      /credential-unavailable: provider "vendor" now points at https:\/\/elsewhere\.example, not the https:\/\/real\.example this job was authorised for/,
    );
  });
});

test('a job whose own record disagrees with itself is refused before the config is read', () => {
  // Tautological between two submission-time values, and kept for the case they
  // are not both submission-time values any more: a hand-edited or corrupt row.
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    assert.throws(
      () => resolveCredential(AUTHORISED, { ...TRANSPORT, baseUrl: 'https://elsewhere.example/v1' }),
      /authorised for https:\/\/real\.example but targets https:\/\/elsewhere\.example/,
    );
  });
});

test('a profile deleted or stripped of its key since submission is a refusal, not a silent send', () => {
  withConfig({ defaultProvider: 'other', providers: { other: { baseUrl: 'https://real.example/v1' } } }, () => {
    assert.throws(() => resolveCredential(AUTHORISED, TRANSPORT), /provider "vendor" is no longer configured/);
  });
  withConfig(vendorConfig('https://real.example/v1', undefined), () => {
    assert.throws(() => resolveCredential(AUTHORISED, TRANSPORT), /provider "vendor" no longer supplies a credential/);
  });
});

/**
 * A real submission, a real detached worker, and a queue held open so the config
 * can be edited in the window between them.
 *
 * The blocker is a synthetic `running` row naming this test process as its
 * worker: a live pid blocks the queue and no reconciler will touch it, so the
 * window is opened and closed by hand rather than by a timer.
 */
async function heldScenario() {
  const server = await startFakeServer((request, response) => {
    if (!request.url.includes('chat/completions')) respondJson(response, modelList('test-model'));
    else respondJson(response, completion('ok'));
  });
  const { path: configPath } = writeConfig(vendorConfig(server.baseUrl, 'key-a'));
  const state = stateDir();
  const blocker = insertSynthetic(state, { id: 'blocker', state: 'running', workerPid: process.pid, beatAgoMs: 0 });
  const env = { OAI_PLUGIN_STATE: state };

  return {
    server,
    state,
    configPath,
    chats: () => server.requests.filter((request) => request.url.includes('chat/completions')),
    submit: () => runCompanion(['task', '--background', 'do it'], { configPath, env }),
    release: () => withStore(state, (db) => finish(db, blocker, { state: 'completed', at: new Date().toISOString() })),
  };
}

/** Queued is not enough: the worker must be waiting, or the window is not open. */
async function waitForWaiter(state, id, { timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = readJob(state, id);
    if (row?.waiter_pid) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${id} never had a worker register`);
}

test('a worker refuses to send a key the profile earned somewhere else, and sends nothing at all', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await heldScenario();
  try {
    const submitted = await scenario.submit();
    assert.equal(submitted.status, 0, submitted.stderr);
    const id = submitted.stdout.trim();
    await waitForWaiter(scenario.state, id);

    // The window: the profile is repointed at another origin and given a new
    // key, exactly as an edit to `providers.json` between submission and the
    // worker's turn would do.
    writeFileSync(scenario.configPath, JSON.stringify(vendorConfig('http://127.0.0.1:9/v1', 'key-b')));
    // Submission's own probes legitimately carried `key-a` — it was authorised,
    // in the foreground, before the edit. So the line is drawn here rather than
    // over the whole recording.
    const beforeTheWorkerRan = scenario.server.requests.length;
    scenario.release();

    const row = await waitForState(scenario.state, id, ['completed', 'failed']);
    assert.equal(row.state, 'failed', `expected a refusal, got ${row.state}`);
    assert.match(
      row.failure.message,
      /now points at http:\/\/127\.0\.0\.1:9, not the http:\/\/127\.0\.0\.1:\d+ this job was authorised for/,
      `wrong refusal: ${row.failure.message}`,
    );

    assert.equal(scenario.chats().length, 0, 'the job must never have reached the model');
    assert.deepEqual(
      scenario.server.requests.slice(beforeTheWorkerRan).map((request) => request.url),
      [],
      'a refused worker must not contact the endpoint at all, with or without a key',
    );
  } finally {
    await scenario.server.close();
  }
});

test('the same fixture, config left alone, reaches the model carrying the key', { skip: NEEDS_SQLITE }, async () => {
  // The positive control. Without it the test above is satisfied by a worker
  // that never got as far as `resolveCredential` — a broken fixture and a
  // working refusal produce the same three assertions.
  const scenario = await heldScenario();
  try {
    const submitted = await scenario.submit();
    assert.equal(submitted.status, 0, submitted.stderr);
    const id = submitted.stdout.trim();
    await waitForWaiter(scenario.state, id);
    scenario.release();

    const row = await waitForState(scenario.state, id, ['completed', 'failed']);
    assert.equal(row.state, 'completed', JSON.stringify(row.failure));

    const chats = scenario.chats();
    assert.equal(chats.length, 1);
    assert.equal(chats[0].headers.authorization, 'Bearer key-a');
  } finally {
    await scenario.server.close();
  }
});
