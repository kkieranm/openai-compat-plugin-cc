// Whether a worker may send a credential minutes after the session that asked
// for the job has gone.
//
// `job-auth.mjs` shipped untested on both sides,
// which mattered more than the other five gaps: the real gate compares the
// freshly resolved profile against the frozen `transport` endpoint,
// with the tautological origin check ahead of it catching only a hand-edited
// or corrupt row, and nothing executed either side. `tests/config.test.js`
// covers the foreground analogue — `resolveProfile` not carrying a key to
// another endpoint — which is adjacent evidence and not this.
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { authPolicyFor, queryCommitment, querySalt, resolveCredential } from '../scripts/lib/job-auth.mjs';
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

const vendorEnvConfig = (baseUrl, apiKeyEnv) => ({
  defaultProvider: 'vendor',
  providers: {
    vendor: { baseUrl, apiKeyEnv, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 },
  },
});

/**
 * Set an env var for the duration of one call, restoring whatever was there
 * before — `await`s `fn()` itself, since an async `fn` returns a pending
 * promise synchronously and a bare `finally` would restore the env var before
 * the awaited body (a real background submission and worker, for the
 * end-to-end case) ever runs.
 */
async function withEnv(name, value, fn) {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

const AUTHORISED = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example' };
const TRANSPORT = { name: 'vendor', baseUrl: 'https://real.example/v1', query: '' };

test('the policy records where a key was authorised, never the key', () => {
  const policy = authPolicyFor({
    name: 'vendor',
    baseUrl: 'https://real.example/v1?tenant=7',
    apiKey: 'sk-a',
    credentialSource: { kind: 'inline' },
  });

  assert.deepEqual(policy, {
    mode: 'profile',
    profile: 'vendor',
    authorizedOrigin: 'https://real.example',
    apiKeyAuthorized: true,
    credentialSource: { kind: 'inline' },
  });
  assert.ok(!JSON.stringify(policy).includes('sk-a'), 'the credential must not reach the row');
});

// The widening this item adds: a profile with NO apiKey but a non-empty query
// (and not ad hoc) still gets `mode: 'profile'`, so a worker can re-resolve the
// query later — but `apiKeyAuthorized` records that no key was ever authorised,
// which is the fact that stops a key gained later from being sent.
test('a query-only profile is widened to carry provenance, with the key marked unauthorised', () => {
  const policy = authPolicyFor({ name: 'vendor', baseUrl: 'https://real.example/v1', query: '?tenant=7' });

  assert.deepEqual(policy, {
    mode: 'profile',
    profile: 'vendor',
    authorizedOrigin: 'https://real.example',
    apiKeyAuthorized: false,
  });
});

// The widening is keyed on `!adHoc && query`, never on the query alone — an ad
// hoc `--base-url` carrying any query string must stay `mode: 'none'`, or a
// worker later sends its synthetic `custom` profile through `resolveProfile`
// and fails every such job with `Unknown provider "custom"`.
test('an ad hoc profile carrying a query string is never widened', () => {
  const policy = authPolicyFor({ name: 'custom', baseUrl: 'http://127.0.0.1:1/v1', query: '?api-version=2024-02-01', adHoc: true });

  assert.deepEqual(policy, { mode: 'none' });
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
    // AUTHORISED is the legacy (pre-`apiKeyAuthorized`) shape, so schemaVersion 1
    // is what makes the legacy default apply and return the key.
    assert.deepEqual(resolveCredential(AUTHORISED, TRANSPORT, 1), { apiKey: 'sk-a', query: '' });
  });
});

// The fail-open regression two review rounds were spent finding: `AUTHORISED`
// is the un-updated `{mode, profile, authorizedOrigin}` shape, with no
// `apiKeyAuthorized` field at all — exactly what every row written before that
// field existed looks like. Read literally against the new rule
// (`auth.apiKeyAuthorized ?? (auth.mode === 'profile')` done wrong, or omitted),
// such a row would return no key AND raise no refusal: an unauthenticated
// request sent to an endpoint that was authorised with a key, reported
// `completed` if the server answers. The legacy default must read this shape as
// authorised. This must not be "fixed" by adding `apiKeyAuthorized: true` to
// `AUTHORISED` — doing so would remove the only fixture this repo has for a
// pre-field row and let a fail-open implementation pass silently.
test('a legacy v1 auth blob with no apiKeyAuthorized still yields its key — the fail-open regression', () => {
  assert.ok(
    !('apiKeyAuthorized' in AUTHORISED),
    'AUTHORISED must stay the un-updated legacy shape for this test to mean anything',
  );
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    // The legacy default is scoped to schemaVersion === 1 — pass it explicitly,
    // since that scoping is exactly what this test exists to prove.
    assert.deepEqual(resolveCredential(AUTHORISED, TRANSPORT, 1), { apiKey: 'sk-a', query: '' });
  });
});

// The legacy default is scoped to `schemaVersion === 1`, not to "the field is
// missing" — a v2 row can legitimately carry `mode: 'profile'` with
// `apiKeyAuthorized: false` (a query-only credential), so treating any missing
// field as legacy-safe would silently authorize a key on a malformed,
// partially written or hand-edited v2 row, reproducing the escalation one
// layer down. `AUTHORISED` here stands in for such a row: same shape as the
// v1 fixture above, but read with schemaVersion 2.
test('a v2 auth blob missing apiKeyAuthorized does NOT fall back to the legacy default', () => {
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    assert.deepEqual(resolveCredential(AUTHORISED, TRANSPORT, 2), { apiKey: undefined, query: '' });
  });
});

// The credential SOURCE gate. A repointed `apiKeyEnv` (or an
// env/inline transition) between submission and execution must be refused,
// but a legitimate rotation — a new value behind the SAME source — must not.
const AUTHORISED_ENV_A = {
  mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example',
  apiKeyAuthorized: true, credentialSource: { kind: 'env', name: 'OAI183_KEY_A' },
};
const AUTHORISED_INLINE = {
  mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example',
  apiKeyAuthorized: true, credentialSource: { kind: 'inline' },
};

test('an apiKeyEnv repointed to a different variable, endpoint unchanged, is refused', async () => {
  await withEnv('OAI183_KEY_A', 'sk-a', () => withEnv('OAI183_KEY_B', 'sk-b', () => {
    withConfig(vendorEnvConfig('https://real.example/v1', 'OAI183_KEY_B'), () => {
      assert.throws(
        () => resolveCredential(AUTHORISED_ENV_A, TRANSPORT, 3),
        /credential-unavailable: provider "vendor" now resolves its credential from a different source than this job was authorised for/,
      );
    });
  }));
});

test('the same apiKeyEnv name with a rotated value still authorises', async () => {
  await withEnv('OAI183_KEY_A', 'sk-a-rotated', () => {
    withConfig(vendorEnvConfig('https://real.example/v1', 'OAI183_KEY_A'), () => {
      assert.deepEqual(resolveCredential(AUTHORISED_ENV_A, TRANSPORT, 3), { apiKey: 'sk-a-rotated', query: '' });
    });
  });
});

test('an inline apiKey edited in place still authorises — the documented scope boundary', () => {
  withConfig(vendorConfig('https://real.example/v1', 'sk-edited'), () => {
    assert.deepEqual(resolveCredential(AUTHORISED_INLINE, TRANSPORT, 3), { apiKey: 'sk-edited', query: '' });
  });
});

test('an env-to-inline transition is refused', () => {
  withConfig(vendorConfig('https://real.example/v1', 'sk-now-inline'), () => {
    assert.throws(
      () => resolveCredential(AUTHORISED_ENV_A, TRANSPORT, 3),
      /credential-unavailable: provider "vendor" now resolves its credential from a different source than this job was authorised for/,
    );
  });
});

test('an inline-to-env transition is refused', async () => {
  await withEnv('OAI183_KEY_A', 'sk-now-env', () => {
    withConfig(vendorEnvConfig('https://real.example/v1', 'OAI183_KEY_A'), () => {
      assert.throws(
        () => resolveCredential(AUTHORISED_INLINE, TRANSPORT, 3),
        /credential-unavailable: provider "vendor" now resolves its credential from a different source than this job was authorised for/,
      );
    });
  });
});

test('a v1 row with no source pin still authorises — legacy pass-through', () => {
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    assert.deepEqual(resolveCredential(AUTHORISED, TRANSPORT, 1), { apiKey: 'sk-a', query: '' });
  });
});

test('a v2 row with no source pin still authorises — legacy pass-through', () => {
  const v2Authorised = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example', apiKeyAuthorized: true };
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    assert.deepEqual(resolveCredential(v2Authorised, TRANSPORT, 2), { apiKey: 'sk-a', query: '' });
  });
});

test('a v3 row with apiKeyAuthorized true and no source pin fails closed', () => {
  const v3NoPin = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example', apiKeyAuthorized: true };
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    assert.throws(
      () => resolveCredential(v3NoPin, TRANSPORT, 3),
      /credential-unavailable: provider "vendor" now resolves its credential from a different source than this job was authorised for/,
    );
  });
});

test('a v3 row with a malformed source pin (bad kind) fails closed', () => {
  const malformed = {
    mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example',
    apiKeyAuthorized: true, credentialSource: { kind: 'bogus' },
  };
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    assert.throws(() => resolveCredential(malformed, TRANSPORT, 3), /now resolves its credential from a different source/);
  });
});

test('a v3 row with an env pin carrying an empty name fails closed', async () => {
  const emptyName = {
    mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example',
    apiKeyAuthorized: true, credentialSource: { kind: 'env', name: '' },
  };
  await withEnv('OAI183_KEY_A', 'sk-a', () => {
    withConfig(vendorEnvConfig('https://real.example/v1', 'OAI183_KEY_A'), () => {
      assert.throws(() => resolveCredential(emptyName, TRANSPORT, 3), /now resolves its credential from a different source/);
    });
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

// The origin-only check this replaced would have let this through —
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
    // Legacy-shaped auth (no apiKeyAuthorized) — schemaVersion 1 is what makes
    // the default apply.
    assert.deepEqual(resolveCredential(authorisedQuery, transportQuery, 1), { apiKey: 'sk-a', query: '?tenant=a' });
  });
});

// The commitment path's own positive and negative controls: the raw-query
// fixtures above exercise `transport.query` directly, but a row whose query was
// committed at submission carries `queryHash`/`querySalt` instead, and nothing
// above ever builds one.
test('the commitment path authorises a matching query without the row ever storing it raw', () => {
  const salt = querySalt();
  const authorisedQuery = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example', apiKeyAuthorized: true };
  const transportQuery = {
    name: 'vendor',
    baseUrl: 'https://real.example/v1',
    queryHash: queryCommitment(salt, '?tenant=a'),
    querySalt: salt,
  };
  withConfig(vendorConfig('https://real.example/v1?tenant=a', 'sk-a'), () => {
    // schemaVersion 2: the commitment path's own subject, not the source pin —
    // an unversioned call now falls into the new fail-closed branch and
    // requires a pin this fixture never carries.
    assert.deepEqual(resolveCredential(authorisedQuery, transportQuery, 2), { apiKey: 'sk-a', query: '?tenant=a' });
  });
});

test('the commitment path refuses a drifted query, same as the raw path', () => {
  const salt = querySalt();
  const authorisedQuery = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example', apiKeyAuthorized: true };
  const transportQuery = {
    name: 'vendor',
    baseUrl: 'https://real.example/v1',
    queryHash: queryCommitment(salt, '?tenant=a'),
    querySalt: salt,
  };
  withConfig(vendorConfig('https://real.example/v1?tenant=b', 'sk-b'), () => {
    assert.throws(
      () => resolveCredential(authorisedQuery, transportQuery),
      /credential-unavailable: provider "vendor" now resolves to a different endpoint than this job was authorised for/,
    );
  });
});

// `queryHash` must be tested for PRESENCE, not truthiness — a hand-edited row
// carrying an empty-but-present hash must still take the commitment path and
// refuse on a mismatch. Under truthiness this falls through to the raw
// compare (`current.query !== (transport.query ?? '')`), and against a
// query-less live profile that compare is `'' !== ''` — passing, and handing
// back a key with no query ever having been verified at all.
test('an empty but PRESENT queryHash still takes the commitment path, not the raw fallback', () => {
  const authorisedQuery = { mode: 'profile', profile: 'vendor', authorizedOrigin: 'https://real.example', apiKeyAuthorized: true };
  const transportQuery = {
    name: 'vendor',
    baseUrl: 'https://real.example/v1',
    queryHash: '',
    querySalt: '',
  };
  withConfig(vendorConfig('https://real.example/v1', 'sk-a'), () => {
    assert.throws(
      () => resolveCredential(authorisedQuery, transportQuery),
      /credential-unavailable: provider "vendor" now resolves to a different endpoint than this job was authorised for/,
      'a present-but-empty queryHash must refuse on a commitment mismatch, not fall through to the raw compare and silently authorise',
    );
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

// Another confirmed variant: the same origin AND path, differing only
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
    // An old-shape TRANSPORT and an old-shape AUTH blob are the same row —
    // schemaVersion 1.
    assert.deepEqual(resolveCredential(AUTHORISED, oldShapeTransport, 1), { apiKey: 'sk-a', query: '' });
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
    // schemaVersion 1: without it, an un-authorized-for-key legacy row would
    // now correctly return no key rather than throw — this test needs the
    // "was authorized, key vanished" case specifically.
    assert.throws(() => resolveCredential(AUTHORISED, TRANSPORT, 1), /provider "vendor" no longer supplies a credential/);
  });
});

/**
 * A real submission, a real detached worker, and a queue held open so the config
 * can be edited in the window between them.
 *
 * The blocker is a synthetic `running` row naming this test process as its
 * worker: a live pid blocks the queue and no reconciler will touch it, so the
 * window is opened and closed by hand rather than by a timer.
 *
 * `configFor` defaults to the keyed, query-less profile every existing caller
 * relies on; a caller wanting a query-bearing or query-only profile passes its
 * own, which is what puts a query-bearing job on the commitment path at all.
 */
async function heldScenario({ configFor = (server) => vendorConfig(server.baseUrl, 'key-a') } = {}) {
  const server = await startFakeServer((request, response) => {
    if (!request.url.includes('chat/completions')) respondJson(response, modelList('test-model'));
    else respondJson(response, completion('ok'));
  });
  const { path: configPath } = writeConfig(configFor(server));
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

// The end-to-end arm: every other env-sourced case in the matrix above is
// unit-level (a hand-built `auth` blob) — this is the one that proves a real
// `--background` submission under an `apiKeyEnv` profile actually persists an
// `{kind:'env'}` pin, not just that `resolveCredential` accepts one if handed it.
test('a real background submission under an apiKeyEnv profile persists an env-kind credential source', { skip: NEEDS_SQLITE }, async () => {
  await withEnv('OAI183_E2E_KEY', 'key-env', async () => {
    const scenario = await heldScenario({ configFor: (server) => vendorEnvConfig(server.baseUrl, 'OAI183_E2E_KEY') });
    try {
      const submitted = await scenario.submit();
      assert.equal(submitted.status, 0, submitted.stderr);
      const id = submitted.stdout.trim();
      await waitForWaiter(scenario.state, id);
      scenario.release();

      const row = await waitForState(scenario.state, id, ['completed', 'failed']);
      assert.equal(row.state, 'completed', JSON.stringify(row.failure));
      assert.deepEqual(row.auth.credentialSource, { kind: 'env', name: 'OAI183_E2E_KEY' });

      const chats = scenario.chats();
      assert.equal(chats.length, 1);
      assert.equal(chats[0].headers.authorization, 'Bearer key-env');
    } finally {
      await scenario.server.close();
    }
  });
});

// A query-bearing sibling of the positive control just above: that one uses a
// query-less `baseUrl`, so it only ever exercises the unchanged raw path. This
// puts the job on the commitment path end to end — the row must carry
// `queryHash`/`querySalt` rather than a raw query, and the worker must still
// re-resolve and send the real query alongside the key.
test('a query-bearing profile also reaches the model, carrying both the key and the re-resolved query', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await heldScenario({ configFor: (server) => vendorConfig(`${server.baseUrl}?tenant=a`, 'key-a') });
  try {
    const submitted = await scenario.submit();
    assert.equal(submitted.status, 0, submitted.stderr);
    const id = submitted.stdout.trim();
    await waitForWaiter(scenario.state, id);
    scenario.release();

    const row = await waitForState(scenario.state, id, ['completed', 'failed']);
    assert.equal(row.state, 'completed', JSON.stringify(row.failure));
    assert.ok(row.transport.queryHash, `expected the commitment shape: ${JSON.stringify(row.transport)}`);
    assert.ok(!('query' in row.transport), `a query-bearing named profile must not also store it raw: ${JSON.stringify(row.transport)}`);

    const chats = scenario.chats();
    assert.equal(chats.length, 1);
    assert.equal(chats[0].headers.authorization, 'Bearer key-a');
    assert.ok(chats[0].url.includes('tenant=a'), `expected the re-resolved query on the request: ${chats[0].url}`);
  } finally {
    await scenario.server.close();
  }
});

// The escalation `authPolicyFor`'s widening must not honour: a query-only
// profile (no `apiKey` at submission) that GAINS one while the job sits queued
// must still send no key. "Sent no key" is satisfiable by a job that never
// reached the model at all, which is the defect the positive control above
// exists to close — so this needs the same anchor: `completed`, exactly one
// chat completion, and no `authorization` header on it.
test('a query-only profile that later gains an apiKey still sends no key', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await heldScenario({ configFor: (server) => vendorConfig(`${server.baseUrl}?tenant=q`, undefined) });
  try {
    const submitted = await scenario.submit();
    assert.equal(submitted.status, 0, submitted.stderr);
    const id = submitted.stdout.trim();
    await waitForWaiter(scenario.state, id);

    // Same endpoint, same query — only a key is added, exactly as an operator
    // adding `apiKey` to `providers.json` between submission and the worker's
    // turn would do.
    writeFileSync(scenario.configPath, JSON.stringify(vendorConfig(`${scenario.server.baseUrl}?tenant=q`, 'sk-late')));
    scenario.release();

    const row = await waitForState(scenario.state, id, ['completed', 'failed']);
    assert.equal(row.state, 'completed', JSON.stringify(row.failure));

    const chats = scenario.chats();
    assert.equal(chats.length, 1, `expected exactly one chat completion: ${JSON.stringify(scenario.server.requests.map((r) => r.url))}`);
    assert.equal(chats[0].headers.authorization, undefined, `the late key leaked into the request: ${JSON.stringify(chats[0].headers)}`);
  } finally {
    await scenario.server.close();
  }
});

// The hash-path fail-closed guard `transportProfile` carries, exercised end to
// end: a hand-edited row can carry `queryHash` under `auth.mode === 'none'`
// (`resolveCredential` returns early for that mode, resolving nothing), which
// would otherwise be the one path left standing that could silently send an
// unauthenticated request to an endpoint whose auth IS the query string.
test('a hand-edited row carrying queryHash under auth.mode "none" fails closed rather than running unauthenticated', { skip: NEEDS_SQLITE }, async () => {
  const server = await startFakeServer((request, response) => {
    if (!request.url.includes('chat/completions')) respondJson(response, modelList('test-model'));
    else respondJson(response, completion('ok'));
  });
  const state = stateDir();
  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = state;
  try {
    const salt = querySalt();
    const seq = insertSynthetic(state, {
      id: 'hand-edited',
      transport: JSON.stringify({
        name: 'vendor',
        baseUrl: server.baseUrl,
        queryHash: queryCommitment(salt, '?tenant=x'),
        querySalt: salt,
      }),
      auth: JSON.stringify({ mode: 'none' }),
    });

    const { runTaskWorker } = await import('../scripts/lib/cmd-task-worker.mjs');
    await assert.rejects(
      () => runTaskWorker(['--seq', String(seq)]),
      /credential-unavailable: job hand-edited needs its query re-resolved but none came back/,
    );

    assert.equal(
      server.requests.filter((request) => request.url.includes('chat/completions')).length,
      0,
      'must never have reached the model',
    );
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
    await server.close();
  }
});

// A v1 row is a raw `{name, baseUrl, query}` shape, WITH a key — and it must
// still be executed correctly by this build. This needs a real worker, not a
// unit test of `resolveCredential` alone: `transportProfile` is not exported,
// so a `resolveCredential`-only test would never exercise the branch actually
// being changed (`onHashPath ? resolved.query : job.transport.query || ''`).
// "Executed correctly" is otherwise vacuously satisfiable — a job can complete
// while sending neither the key nor the query — so this anchors on both
// landing on the actual request.
test('a v1 row with a raw query and a key is still executed correctly by a real worker', { skip: NEEDS_SQLITE }, async () => {
  const server = await startFakeServer((request, response) => {
    if (!request.url.includes('chat/completions')) respondJson(response, modelList('test-model'));
    else respondJson(response, completion('ok'));
  });
  const query = '?tenant=v1';
  const { path: configPath } = writeConfig(vendorConfig(`${server.baseUrl}${query}`, 'key-v1'));
  const state = stateDir();
  const previousConfig = process.env.OAI_PLUGIN_CONFIG;
  const previousState = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_CONFIG = configPath;
  process.env.OAI_PLUGIN_STATE = state;
  try {
    const seq = insertSynthetic(state, {
      id: 'v1-raw-query',
      // The un-updated legacy `auth` shape too — no `apiKeyAuthorized` field —
      // so this is also live coverage of the fail-open default reading a real
      // row, not just the hand-built fixture above.
      transport: JSON.stringify({ name: 'vendor', baseUrl: server.baseUrl, query }),
      auth: JSON.stringify({ mode: 'profile', profile: 'vendor', authorizedOrigin: new URL(server.baseUrl).origin }),
    });

    const { runTaskWorker } = await import('../scripts/lib/cmd-task-worker.mjs');
    await runTaskWorker(['--seq', String(seq)]);

    const row = readJob(state, 'v1-raw-query');
    assert.equal(row.state, 'completed', JSON.stringify(row.failure));

    const chats = server.requests.filter((request) => request.url.includes('chat/completions'));
    assert.equal(chats.length, 1);
    assert.equal(chats[0].headers.authorization, 'Bearer key-v1', `the frozen row's key never reached the request: ${JSON.stringify(chats[0].headers)}`);
    assert.ok(chats[0].url.includes('tenant=v1'), `the frozen raw query never reached the request: ${chats[0].url}`);
  } finally {
    if (previousConfig === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previousConfig;
    if (previousState === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previousState;
    await server.close();
  }
});
