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
  assert.equal(normalizeBaseUrl('http://localhost:1234'), 'http://localhost:1234/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/'), 'http://localhost:1234/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/api/v0/'), 'http://localhost:1234/api/v0');
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
