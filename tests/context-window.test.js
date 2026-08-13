// How the context window is detected, reported, and used to arm the guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completion, modelList, respondJson, runCompanion, startFakeServer, writeConfig } from "./helpers.mjs";

test('setup reports the window of the model a task would use, not any loaded model', async () => {
  // defaultModel names an unloaded model while a different one is loaded.
  // Reporting the loaded model's window would promise a guard that task,
  // which will run the unloaded model, does not actually have.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [
          { id: 'loaded-one', type: 'llm', state: 'loaded', max_context_length: 131072, loaded_context_length: 58112 },
          { id: 'wanted-one', type: 'llm', state: 'not-loaded', max_context_length: 131072 },
        ],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('loaded-one', 'wanted-one'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'wanted-one' } },
  });

  const result = await runCompanion(['setup'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /58\.1k/, 'must not report another model’s window');
  assert.match(result.stdout, /only a 131\.1k ceiling for wanted-one/);
});

test('a window that cannot be detected does not stop the task', async () => {
  // With defaultModel set, only the window is missing. A server that cannot
  // list models must still take the work, warning about the unknown window —
  // the behaviour that existed before detection.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('ran anyway'));
    return respondJson(response, { error: 'no models endpoint here' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'm' } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ran anyway/);
  assert.match(result.stdout, /Context window unknown for m/);
});

test('setup --json reports the same window the text report does', async () => {
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'only-chat', type: 'llm', state: 'loaded', max_context_length: 131072, loaded_context_length: 8192 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('only-chat'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const text = await runCompanion(['setup'], { configPath: path });
  const json = await runCompanion(['setup', '--json'], { configPath: path });
  await server.close();

  assert.match(text.stdout, /context: 8\.2k \(detected via LM Studio/);
  const report = JSON.parse(json.stdout).providers[0];
  assert.equal(report.contextWindow, 8192, 'json must not under-report a guard the text report claims');
  assert.match(report.contextSource, /LM Studio/);
});

test('a non-numeric contextLength is rejected, not silently treated as a guard', async () => {
  // "8k" made every comparison in the guard NaN, so it reported an armed check
  // that in fact tested nothing.
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: 'http://127.0.0.1:1/v1', contextLength: '8k' } },
  });

  const result = await runCompanion(['task', '--model', 'm', 'hello'], { configPath: path });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /"contextLength": "8k" — expected a positive whole number/);
});

test('a configured window that disagrees with the server is flagged as possibly stale', async () => {
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'only-chat', type: 'llm', state: 'loaded', max_context_length: 262144, loaded_context_length: 8192 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('only-chat'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, contextLength: 131072 } },
  });

  const result = await runCompanion(['setup'], { configPath: path });
  await server.close();

  assert.match(result.stdout, /context: 131\.1k \(set in config\)/);
  assert.match(result.stdout, /server reports it is serving 8\.2k/);
});

test('a fully configured profile lists models anyway, so setup and task agree', async () => {
  // This asserted the OPPOSITE until OAI-16, and the reversal is deliberate.
  // A fully configured profile used to skip the probe to save a round trip.
  // That became untenable once `planSelection` could refuse a model for being
  // absent from the catalogue: `/oai:setup` probes unconditionally, so it printed
  // "cannot run here" and "No provider can take a task right now" about a task
  // that then ran fine. One planner fed two different inputs is the same defect
  // class as two planners — REPO_TRAPS records nine instances of it — and the
  // only fix with one authority is one input.
  //
  // Still proven by counting requests, which is what caught the original
  // regression: the fully-configured tests all pointed at an unreachable port
  // where an extra probe failed silently.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('done'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'm', contextLength: 8192 } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const paths = server.requests.map((request) => request.url.split('?')[0]);
  assert.deepEqual(
    paths.filter((requestPath) => !requestPath.endsWith('/chat/completions')),
    ['/v1/models'],
    'the catalogue is fetched so the task sees what setup sees — and nothing more than that',
  );
});

test('the detected window arms the guard with no contextLength configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-detect-'));
  const file = join(dir, 'big.txt');
  writeFileSync(file, 'x'.repeat(40_000)); // ~10k tokens, over an 8k window

  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'only-chat', type: 'llm', state: 'loaded', max_context_length: 131072, loaded_context_length: 8192 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('only-chat'));
    return respondJson(response, completion('should never be reached'));
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', '--file', file, 'summarize'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  // The 8.2k loaded window, not the 131.1k ceiling.
  assert.match(result.stderr, /has a 8\.2k window/);
  assert.equal(
    server.requests.some((request) => request.url.endsWith('/chat/completions')),
    false,
    'must refuse before sending',
  );
});

test('a ceiling-only server leaves the guard disarmed rather than guessing', async () => {
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      // Not loaded: only a ceiling is known.
      return respondJson(response, {
        data: [{ id: 'only-chat', type: 'llm', state: 'not-loaded', max_context_length: 131072 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('only-chat'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('ran anyway'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Context window unknown for only-chat/);
});
