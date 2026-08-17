// Whether a worker may send a credential minutes after the session that asked
// for the job has gone.
//
// `job-auth.mjs` shipped with OAI-3 untested on both sides (OAI-52 item 1),
// which mattered more than the other five gaps: the real gate compares the
// freshly resolved profile against the frozen `transport` endpoint (OAI-63),
// with the tautological origin check ahead of it catching only a hand-edited
// or corrupt row, and nothing executed either side. `tests/config.test.js`
// covers the foreground analogue — `resolveProfile` not carrying a key to
// another endpoint — which is adjacent evidence and not this.
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
      /credential-unavailable: provider "vendor" now resolves to a different endpoint than this job was authorised for/,
    );
  });
});

// OAI-63: the origin-only check this replaced would have let this through —
// same origin as TRANSPORT, different path. The endpoint check must not.
test('a profile that has since moved PATH, same origin, cannot lend its new key to the old endpoint either', () => {
  withConfig(vendorConfig('https://real.example/tenant-b', 'sk-b'), () => {
    assert.throws(
      () => resolveCredential(AUTHORISED, TRANSPORT),
      /credential-unavailable: provider "vendor" now resolves to a different endpoint than this job was authorised for/,
    );
  });
});

// Some gateways embed a credential in the PATH itself, not just the query —
// normalizeBaseUrl does nothing to forbid this, so a path-mismatch refusal
// must never echo either endpoint's raw value.
test('an endpoint-mismatch refusal never echoes either raw baseUrl, even one carrying a path-embedded secret', () => {
  withConfig(vendorConfig('https://real.example/PATH_SECRET', 'sk-b'), () => {
    assert.throws(
      () => resolveCredential(AUTHORISED, TRANSPORT),
      (error) => {
        assert.ok(!error.message.includes('PATH_SECRET'), `leaked the current path secret: ${error.message}`);
        assert.ok(!error.message.includes('/v1'), `leaked the transport path: ${error.message}`);
        return true;
      },
    );
  });
});

// The positive control the query mismatch cases below need: an IDENTICAL
// nonempty query on both sides must still authorise. Without this, an
// implementation that refused every nonempty query would pass every test
// below it.
test('identical nonempty queries on both sides still authorise', () => {
  const authorisedQuery = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example' };
  const transportQuery = { name: 'vendor', baseUrl: 'https://real.example/v1', query: '?tenant=a' };
  withConfig(vendorConfig('https://real.example/v1?tenant=a', 'sk-a'), () => {
    assert.equal(resolveCredential(authorisedQuery, transportQuery), 'sk-a');
  });
});

// A query string can itself carry a credential (a gateway that authenticates
// via ?api_key=) — the refusal message must never echo it.
test('a query mismatch refusal never echoes either query value', () => {
  const authorisedQuery = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example' };
  const transportQuery = { name: 'vendor', baseUrl: 'https://real.example/v1', query: '?api_key=old-secret' };
  withConfig(vendorConfig('https://real.example/v1?api_key=new-secret', 'sk-b'), () => {
    assert.throws(
      () => resolveCredential(authorisedQuery, transportQuery),
      (error) => {
        assert.ok(!error.message.includes('old-secret'), 'must not echo the transport query value');
        assert.ok(!error.message.includes('new-secret'), 'must not echo the resolved profile query value');
        assert.match(error.message, /now resolves to a different endpoint than this job was authorised for/);
        return true;
      },
    );
  });
});

// OAI-63's other confirmed variant: the same origin AND path, differing only
// in the QUERY string — a gateway that multiplexes tenants by ?tenant=. The
// old origin-only check would have missed this one too.
test('a profile that has since moved QUERY, same origin and path, cannot lend its new key to the old endpoint either', () => {
  const authorisedQuery = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example' };
  const transportQuery = { name: 'vendor', baseUrl: 'https://real.example/v1', query: '?tenant=a' };
  withConfig(vendorConfig('https://real.example/v1?tenant=b', 'sk-b'), () => {
    // Neither raw endpoint value is echoed — a gateway that multiplexes
    // tenants by query can carry a credential in it, so only a static
    // "different endpoint" refusal is shown.
    assert.throws(
      () => resolveCredential(authorisedQuery, transportQuery),
      /credential-unavailable: provider "vendor" now resolves to a different endpoint than this job was authorised for/,
    );
  });
});

// A row written before `transport` carried a `query` field at all must not
// false-mismatch on `undefined !== ''` and refuse a legitimate, unchanged profile.
test('an old-shape transport with no query field still matches a query-less profile', () => {
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    const oldShapeTransport = { name: 'vendor', baseUrl: 'https://real.example/v1' };
    assert.equal(resolveCredential(AUTHORISED, oldShapeTransport), 'sk-a');
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

// Regex-scrubbing a raw, unvetted underlying-error message was tried across
// several rounds and defeated each time by a narrower shape it didn't quite
// cover (a query string, embedded userinfo, a scheme-less credential, a
// fragment, a credential containing its own "@"). The fix that closes the
// whole class is structural, not a better regex: the catch below never
// forwards the underlying error's own message at all, so there is nothing
// left to scrub and nothing left to bypass. These cases are kept as
// regression guards against that structural property, not against any
// particular pattern.
const LEAK_SHAPES = [
  ['a query-embedded credential', 'not-a-url?api_key=SECRET-QUERY', 'SECRET-QUERY'],
  ['embedded userinfo', 'https://user:sk-secret-userinfo@real.example/v1', 'sk-secret-userinfo'],
  ['a scheme-less userinfo credential', 'user:sk-secret-schemeless@real.example/v1', 'sk-secret-schemeless'],
  ['a userinfo credential containing its own "@"', 'https://user:p@ssw0rd-tail@real.example/v1', 'ssw0rd-tail'],
  ['a fragment-embedded secret', 'not-a-url#api_key=SECRET-FRAGMENT', 'SECRET-FRAGMENT'],
];

for (const [label, baseUrl, secret] of LEAK_SHAPES) {
  test(`a malformed current baseUrl carrying ${label} never reaches the wrapped error`, () => {
    withConfig({ defaultProvider: 'vendor', providers: { vendor: { baseUrl } } }, () => {
      assert.throws(
        () => resolveCredential(AUTHORISED, TRANSPORT),
        (error) => {
          assert.ok(!error.message.includes(secret), `leaked the credential: ${error.message}`);
          assert.match(error.message, /provider "vendor" could not be resolved from the current config/);
          return true;
        },
      );
    });
  });
}

// The vector no regex round could ever have covered: a malformed CONFIG FILE,
// not a malformed URL. Node's JSON.parse quotes a snippet of the input around
// a syntax error in its own message, and loadConfig forwards that verbatim —
// so a syntax error placed near an apiKey line puts key material in the
// snippet, reaching this same catch by a route no URL-shaped scrub touches.
test('a config file with a JSON syntax error near a secret never leaks it through the wrapped error', () => {
  const { path } = writeConfig({ defaultProvider: 'vendor', providers: { vendor: {} } });
  // V8's "Unexpected token" JSON error quotes a snippet of the input around
  // the bad token — an unquoted value (a stray edit while pasting a key) puts
  // that snippet right where a secret would be.
  writeFileSync(path, '{"apiKey": sk-json-snippet-secret}', 'utf8');
  const previous = process.env.OAI_PLUGIN_CONFIG;
  process.env.OAI_PLUGIN_CONFIG = path;
  try {
    assert.throws(
      () => resolveCredential(AUTHORISED, TRANSPORT),
      (error) => {
        // V8 truncates its snippet, so checking for the FULL secret would miss
        // a partial leak — a short prefix is enough to prove even a truncated
        // snippet never reaches this message.
        assert.ok(!error.message.includes('sk-json'), `leaked the config secret: ${error.message}`);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previous;
  }
});

test('a profile deleted or stripped of its key since submission is a refusal, not a silent send', () => {
  withConfig({ defaultProvider: 'other', providers: { other: { baseUrl: 'https://real.example/v1' } } }, () => {
    assert.throws(() => resolveCredential(AUTHORISED, TRANSPORT), /provider "vendor" could not be resolved from the current config/);
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
      /now resolves to a different endpoint than this job was authorised for/,
      `wrong refusal: ${row.failure.message}`,
    );
    assert.ok(!row.failure.message.includes(':9/v1'), `leaked the current endpoint: ${row.failure.message}`);

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
