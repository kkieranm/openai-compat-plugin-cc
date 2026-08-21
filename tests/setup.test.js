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
  const server = await startFakeServer(route({ models: () => modelList('qwen3-coder') }));
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['setup'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok\s+local \(default\)/);
  assert.match(result.stdout, /1 model\(s\): qwen3-coder/);
  assert.match(result.stdout, /Ready: local/);
});

test('setup does not promise delegation when the model is ambiguous', async () => {
  // Two models and no defaultModel: a task here would refuse to guess, so
  // setup must not print "ok"/"Ready". This test previously asserted the
  // opposite and so encoded the defect.
  const server = await startFakeServer(route({ models: () => modelList('qwen3-coder', 'llama-3.2') }));
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const setup = await runCompanion(['setup'], { configPath: path });
  const task = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(setup.status, 0, setup.stderr);
  assert.doesNotMatch(setup.stdout, /Ready: local/);
  assert.match(setup.stdout, /cannot run here: This provider offers 2 models/);
  assert.equal(task.status, 1, 'the task must indeed refuse, or setup was right to promise');
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

test('setup still shows a probe failure\'s echoed response body in the text view', async () => {
  // /oai:setup is unambiguously interactive — the operator's own terminal,
  // echoing their own config back to them — so it must not lose diagnostic
  // detail just because .message itself is now generic. The marker
  // sits only in the /v1/models response body here, never in baseUrl, so a
  // pass would be meaningless if it only reflected the (separately accepted,
  // unconditional) baseUrl display on the provider's own header line.
  //
  // Text-only here: the --json view of this same case is covered separately
  // below.
  const marker = 'SECRET_MARKER_probebody';
  const server = await startFakeServer((request, response) => {
    respondJson(response, { error: `no models here: ${marker}` }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  try {
    const text = await runCompanion(['setup'], { configPath: path });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, new RegExp(marker), 'the text view must still show the echoed body');
  } finally {
    await server.close();
  }
});

test('setup --json reports a reachable-but-no-model-list provider via listUnavailable', async () => {
  // Mirrors the text-view test above, but for the --json view, which used to
  // omit this case entirely (`reachable: true, error: null`, indistinguishable
  // from a healthy provider) because `jsonRow` never read `listUnavailable`.
  const marker = 'SECRET_MARKER_jsonprobebody';
  const server = await startFakeServer((request, response) => {
    respondJson(response, { error: `no models here: ${marker}` }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  try {
    const result = await runCompanion(['setup', '--json'], { configPath: path });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const row = report.providers[0];
    assert.equal(row.reachable, true, 'the server did answer, so it is reachable');
    assert.equal(row.error, null);
    assert.match(row.listUnavailable, new RegExp(marker), 'the --json view must surface the echoed body too');
  } finally {
    await server.close();
  }
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
