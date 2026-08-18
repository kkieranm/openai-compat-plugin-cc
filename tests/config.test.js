import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, resolveProfile } from '../scripts/lib/config.mjs';

const CONFIG = {
  defaultProvider: 'lmstudio',
  providers: {
    lmstudio: { baseUrl: 'http://localhost:1234/v1', contextLength: 8192 },
    omlx: { baseUrl: 'http://localhost:8000/v1', defaultModel: 'mlx-qwen' },
  },
};

test('appends /v1 only when the base URL carries no path', () => {
  assert.equal(normalizeBaseUrl('http://localhost:1234').baseUrl, 'http://localhost:1234/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/').baseUrl, 'http://localhost:1234/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/v1').baseUrl, 'http://localhost:1234/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/api/v0/').baseUrl, 'http://localhost:1234/api/v0');
});

test('a query string is kept for the request, not folded into the base URL', () => {
  const { baseUrl, query } = normalizeBaseUrl('https://api.example.com/v1?api-version=2024');
  assert.equal(baseUrl, 'https://api.example.com/v1');
  assert.equal(query, '?api-version=2024');
});

test('credentials embedded in the URL are refused rather than dropped', () => {
  assert.throws(() => normalizeBaseUrl('https://user:pw@api.example.com/v1'), /embeds credentials in the URL/);
});

// OAI-72(b): a caller that displays or logs a UserError's message (cmd-setup.mjs's
// report, or an uncaught throw reaching oai-companion.mjs's top-level stderr
// write) must never end up echoing the raw input this function was asked to
// validate — the whole reason it's being validated is that it isn't trusted
// yet, and it may carry a query-string API key or embedded userinfo credentials.
// Every throw site is exercised, not just the credentials one, since a
// malformed URL can carry a query-string secret too.
test('none of normalizeBaseUrl\'s error messages ever quote the raw input', () => {
  const secret = 'https://user:CorrectHorseBatteryStaple@api.example.com/v1?api_key=LEAKED-SECRET-9999';
  const cases = [
    secret,
    'not-a-url-but-has-a-fake-secret?api_key=LEAKED-SECRET-9999',
    'localhost:1234?api_key=LEAKED-SECRET-9999',
  ];
  for (const raw of cases) {
    assert.throws(
      () => normalizeBaseUrl(raw),
      (error) => {
        assert.doesNotMatch(error.message, /LEAKED-SECRET-9999/);
        assert.doesNotMatch(error.message, /CorrectHorseBatteryStaple/);
        assert.doesNotMatch(error.message, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      },
    );
  }
});

test('rejects a malformed base URL', () => {
  // "localhost:1234" is a parseable URL (scheme "localhost:") with a null
  // origin, so it has to be caught by the protocol check, not by URL parsing.
  assert.throws(() => normalizeBaseUrl('localhost:1234'), /not a valid http\(s\) URL/);
  assert.throws(() => normalizeBaseUrl('ftp://localhost:1234'), /not a valid http\(s\) URL/);
  assert.throws(() => normalizeBaseUrl('not a url'), /not a valid URL/);
});

test('falls back to the configured default provider', () => {
  const profile = resolveProfile(CONFIG, {});
  assert.equal(profile.name, 'lmstudio');
  assert.equal(profile.contextLength, 8192);
});

test('--provider selects a named profile', () => {
  const profile = resolveProfile(CONFIG, { provider: 'omlx' });
  assert.equal(profile.name, 'omlx');
  assert.equal(profile.defaultModel, 'mlx-qwen');
});

test('--base-url outranks the named provider but keeps its other settings', () => {
  const profile = resolveProfile(CONFIG, { provider: 'lmstudio', baseUrl: 'http://127.0.0.1:9999' });
  assert.equal(profile.baseUrl, 'http://127.0.0.1:9999/v1');
  assert.equal(profile.contextLength, 8192);
});

test('a credential is never forwarded to a different endpoint via --base-url', () => {
  const config = {
    defaultProvider: 'p',
    providers: { p: { baseUrl: 'https://real.example/v1', apiKey: 'sk-secret-123' } },
  };

  const elsewhere = resolveProfile(config, { provider: 'p', baseUrl: 'http://other.host:1/v1' });
  assert.equal(elsewhere.apiKey, undefined, 'key must not follow the request to another origin');
  assert.equal(elsewhere.credentialWithheld, true);

  // OAI-63(c): same host, DIFFERENT path — on a path-multiplexed gateway
  // (LiteLLM, Azure APIM, Cloudflare AI Gateway) that is a different tenant,
  // not "still the provider the key belongs to". The key must not follow.
  const samePath = resolveProfile(config, { provider: 'p', baseUrl: 'https://real.example/v2' });
  assert.equal(samePath.apiKey, undefined, 'key must not follow the request to another path on the same origin');
  assert.equal(samePath.credentialWithheld, true);

  // The positive control this defect needed: the SAME endpoint, byte for byte
  // after normalization — no trailing slash, no query — still gets the key.
  const samePlace = resolveProfile(config, { provider: 'p', baseUrl: 'https://real.example/v1' });
  assert.equal(samePlace.apiKey, 'sk-secret-123');
  assert.equal(samePlace.credentialWithheld, false);

  // Normalization must not itself create a false mismatch: a trailing slash
  // and an implicit /v1 both canonicalize to the same endpoint as above.
  const trailingSlash = resolveProfile(config, { provider: 'p', baseUrl: 'https://real.example/v1/' });
  assert.equal(trailingSlash.apiKey, 'sk-secret-123');
  assert.equal(trailingSlash.credentialWithheld, false);

  const implicitV1 = resolveProfile(config, { provider: 'p', baseUrl: 'https://real.example' });
  assert.equal(implicitV1.apiKey, 'sk-secret-123');
  assert.equal(implicitV1.credentialWithheld, false);

  // Same host and path, differing only in QUERY — a gateway that multiplexes
  // tenants by query string. The key must not follow.
  const sameQuery = resolveProfile(config, { provider: 'p', baseUrl: 'https://real.example/v1?tenant=b' });
  assert.equal(sameQuery.apiKey, undefined, 'key must not follow the request to another query on the same origin and path');
  assert.equal(sameQuery.credentialWithheld, true);
});

test('a mistyped --provider is rejected even when --base-url is given', () => {
  // Silently accepting it dropped the real profile's contextLength and left the
  // oversized-input guard disarmed.
  assert.throws(
    () => resolveProfile(CONFIG, { provider: 'lmstduio', baseUrl: 'http://localhost:1234' }),
    /Unknown provider "lmstduio"/,
  );
});

test('an unknown provider lists the configured ones', () => {
  assert.throws(() => resolveProfile(CONFIG, { provider: 'nope' }), /Unknown provider "nope"\. Configured: lmstudio, omlx/);
});

test('apiKeyEnv reads the environment and fails loudly when unset', () => {
  const config = { providers: { p: { baseUrl: 'http://x.test/v1', apiKeyEnv: 'OAI_TEST_KEY' } }, defaultProvider: 'p' };
  process.env.OAI_TEST_KEY = 'secret-value';
  assert.equal(resolveProfile(config, {}).apiKey, 'secret-value');
  delete process.env.OAI_TEST_KEY;
  assert.throws(() => resolveProfile(config, {}), /apiKeyEnv "OAI_TEST_KEY" but that variable is empty/);
});
