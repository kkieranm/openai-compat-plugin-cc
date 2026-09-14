import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closedPort, completion, modelList, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

function route({ models = () => modelList('test-model'), chat = () => completion('local model says hi') } = {}) {
  return (request, response) => {
    if (request.url.endsWith('/models')) return respondJson(response, models(request));
    if (request.url.endsWith('/chat/completions')) return respondJson(response, chat(request));
    return respondJson(response, { error: 'no such route' }, 404);
  };
}

test('setup reports a reachable provider with its models', async () => {
  const server = await startFakeServer(route({ models: () => modelList('qwen3-coder', 'llama-3.2') }));
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['setup'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok\s+local \(default\)/);
  assert.match(result.stdout, /2 model\(s\): qwen3-coder, llama-3\.2/);
  assert.match(result.stdout, /Ready: local/);
});

test('setup reports an unreachable provider with remediation and still exits 0', async () => {
  const port = await closedPort();
  const { path } = writeConfig({
    defaultProvider: 'lmstudio',
    providers: { lmstudio: { baseUrl: `http://127.0.0.1:${port}/v1` } },
  });

  const result = await runCompanion(['setup'], { configPath: path });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /connection refused/);
  assert.match(result.stdout, /Start LM Studio/);
  assert.match(result.stdout, /No provider can take a task right now/);
});

test('setup --json reports that a key is configured without ever printing it', async () => {
  const server = await startFakeServer(route());
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, apiKey: 'super-secret-value' } },
  });

  const result = await runCompanion(['setup', '--json'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /super-secret-value/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.providers[0].hasApiKey, true);
});

test('setup still reports healthy providers when another profile is unusable', async () => {
  // setup is a report: a malformed profile is a row with an error, not an
  // aborted command that hides the provider which is actually running.
  const server = await startFakeServer(route({ models: () => modelList('good-model') }));
  const { path } = writeConfig({
    defaultProvider: 'good',
    providers: {
      broken: { baseUrl: 'localhost:9999' },
      needsKey: { baseUrl: 'https://api.example.test/v1', apiKeyEnv: 'OAI_DEFINITELY_UNSET_KEY' },
      good: { baseUrl: server.baseUrl },
    },
  });

  const result = await runCompanion(['setup'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not a valid http\(s\) URL/);
  assert.match(result.stdout, /OAI_DEFINITELY_UNSET_KEY/);
  assert.match(result.stdout, /good-model/);
  assert.match(result.stdout, /Ready: good/);
});

test('setup seeds a config file when none exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-fresh-'));
  const path = join(dir, 'nested', 'providers.json');

  const result = await runCompanion(['setup'], { configPath: path });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(path), 'config should have been created');
  assert.match(result.stdout, /created now with default providers/);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(config.providers), ['lmstudio', 'omlx', 'unsloth']);
});
