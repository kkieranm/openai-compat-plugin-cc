// The SUCCESS path (`buildProfile`) always splits a baseUrl's query string
// out via `normalizeBaseUrl` before anything is displayed — a provider
// configured with a query-embedded credential never has it echoed. But
// `probeProvider`'s FAILURE path (when `buildProfile` throws, e.g. because a
// configured `apiKeyEnv`'s environment variable is unset) used to build its
// fallback row straight from the raw, un-normalized `rawProfile.baseUrl`,
// bypassing that redaction entirely — `render.mjs` then prints it to stdout
// verbatim (OAI-72(b)). This file pins the fix that closes it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { probeProvider } from '../scripts/lib/cmd-setup.mjs';

test('a buildProfile failure never echoes a query-embedded credential', async () => {
  const previous = process.env.OAI_SETUP_TEST_KEY;
  delete process.env.OAI_SETUP_TEST_KEY;
  try {
    const row = await probeProvider('leaky', {
      baseUrl: 'http://localhost:1234/v1?api_key=SECRET-VALUE',
      apiKeyEnv: 'OAI_SETUP_TEST_KEY',
    });

    assert.equal(row.built, false, 'buildProfile must actually have failed for this to be the case under test');
    assert.doesNotMatch(row.profile.baseUrl, /SECRET-VALUE/);
    assert.doesNotMatch(row.profile.baseUrl, /\?/, 'the query string itself must not survive, not just the secret substring');
    assert.equal(row.profile.baseUrl, 'http://localhost:1234/v1', 'the normalized, query-free form should still be shown');
  } finally {
    if (previous === undefined) delete process.env.OAI_SETUP_TEST_KEY;
    else process.env.OAI_SETUP_TEST_KEY = previous;
  }
});

// The redaction above only touches `row.profile.baseUrl` — `row.error` is the
// SAME UserError buildProfile threw, and both render.mjs's text report and
// jsonRow's --json output print `error.message` verbatim. A row that failed
// to build a profile because its baseUrl embeds userinfo credentials used to
// leak the plaintext password through THIS field even after profile.baseUrl
// was redacted, since normalizeBaseUrl's own thrown message quoted the raw
// input. Fixed at the source (normalizeBaseUrl no longer quotes it at all,
// see tests/config.test.js), proven here end to end through the actual row.
test('a userinfo-embedded credential never survives in row.error.message either', async () => {
  const row = await probeProvider('leaky2', { baseUrl: 'http://admin:SuperSecret123@localhost:1234/v1' });

  assert.equal(row.built, false, 'buildProfile must actually have failed for this to be the case under test');
  assert.ok(row.error, 'this scenario is expected to produce an error object, which is exactly what leaked');
  assert.doesNotMatch(row.error.message, /SuperSecret123/);
  assert.doesNotMatch(row.error.message, /admin:/);
  // This scenario exercises `fallbackBaseUrl`'s catch branch via the
  // credentials-embedded throw specifically (not the generic "not a valid
  // URL" throw the placeholder tests below use) — pin its output for this
  // branch too, not just for the throw shape those other tests cover.
  assert.equal(row.profile.baseUrl, '(unparseable baseUrl)');
});

test('an unparseable baseUrl falls back to a placeholder, never the raw string', async () => {
  const row = await probeProvider('broken', { baseUrl: 'not a url' });

  assert.equal(row.built, false);
  assert.equal(row.profile.baseUrl, '(unparseable baseUrl)');
});

test('a missing baseUrl falls back to the no-baseUrl placeholder', async () => {
  const row = await probeProvider('empty', {});

  assert.equal(row.built, false);
  assert.equal(row.profile.baseUrl, '(no baseUrl)');
});
