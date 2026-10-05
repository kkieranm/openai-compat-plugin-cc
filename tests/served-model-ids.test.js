// A provider whose replies name its model under a different id than the one it
// lists: Unsloth Studio lists `lmstudio-community/Qwen3.8-27B-MLX-4bit` and every
// reply reports `Qwen3.8-27B-MLX-4bit`. `servedModelIds` declares that pairing in
// providers.json, and a reply under the declared id is then not a substitution
// wherever one is judged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  completionFrames,
  createRepo,
  modelList,
  respondJson,
  respondStream,
  runCompanion,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';
import { NEEDS_SQLITE, readJob, stateDir, waitForState } from './job-helpers.mjs';

const REQUESTED = 'lmstudio-community/Qwen3.8-27B-MLX-4bit';
const SERVED = 'Qwen3.8-27B-MLX-4bit';
const SWAP_WARNING = /asked for "lmstudio-community\/Qwen3\.8-27B-MLX-4bit" but Qwen3\.8-27B-MLX-4bit answered/;

const findings = JSON.stringify({
  analysis: 'read each changed file in full',
  findings: [{ file: 'seed.txt', line: 2, severity: 'high', summary: 'a defect', evidence: 'edited' }],
  summary: 'One defect found.',
});

/** Lists the requested id, and answers every chat request as the bare id. */
function bareIdServer(text = 'the answer', frameOptions = {}) {
  return startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) {
      return respondStream(response, completionFrames(text, { model: SERVED, ...frameOptions }));
    }
    if (path.endsWith('/models')) return respondJson(response, modelList(REQUESTED));
    return respondJson(response, { error: 'not found' }, 404);
  });
}

function config(baseUrl, { declared = true } = {}) {
  return writeConfig({
    defaultProvider: 'unsloth',
    providers: {
      unsloth: {
        baseUrl,
        defaultModel: REQUESTED,
        contextLength: 131_072,
        timeoutSeconds: 5,
        retrySeconds: 0,
        ...(declared ? { servedModelIds: { [REQUESTED]: SERVED } } : {}),
      },
    },
  }).path;
}

async function reviewRepo() {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  return dir;
}

test('task: a reply under the declared id raises no swap warning and a clean footer', async () => {
  const server = await bareIdServer();
  try {
    const result = await runCompanion(['task', 'hello'], { configPath: config(server.baseUrl) });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, SWAP_WARNING);
    assert.match(result.stdout, /model: Qwen3\.8-27B-MLX-4bit/);
    assert.doesNotMatch(result.stdout, /\(requested /);
  } finally {
    await server.close();
  }
});

test('task: without the declaration the same reply is reported as a substitution', async () => {
  const server = await bareIdServer();
  try {
    const result = await runCompanion(['task', 'hello'], { configPath: config(server.baseUrl, { declared: false }) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, SWAP_WARNING);
    assert.match(result.stdout, /model: Qwen3\.8-27B-MLX-4bit \(requested lmstudio-community\/Qwen3\.8-27B-MLX-4bit\)/);
  } finally {
    await server.close();
  }
});

test('task --json carries the declared id beside the pair, and null without one', async () => {
  const server = await bareIdServer();
  try {
    const declared = JSON.parse((await runCompanion(['task', '--json', 'hello'], { configPath: config(server.baseUrl) })).stdout);
    assert.equal(declared.requestedModel, REQUESTED);
    assert.equal(declared.model, SERVED);
    assert.equal(declared.declaredServedModel, SERVED);

    const plain = JSON.parse(
      (await runCompanion(['task', '--json', 'hello'], { configPath: config(server.baseUrl, { declared: false }) })).stdout,
    );
    assert.ok('declaredServedModel' in plain, 'present, not merely absent, when nothing is declared');
    assert.equal(plain.declaredServedModel, null);
  } finally {
    await server.close();
  }
});

test('task --json failure envelope reports the declared id as null beside a null requested id', async () => {
  // A reply only in the reasoning channel is refused; the task failure envelope
  // carries neither id.
  const server = await bareIdServer('thinking only', { channel: 'reasoning' });
  try {
    const result = await runCompanion(['task', '--json', 'hello'], { configPath: config(server.baseUrl) });
    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.error, true);
    assert.equal(report.requestedModel, null);
    assert.ok('declaredServedModel' in report);
    assert.equal(report.declaredServedModel, null);
  } finally {
    await server.close();
  }
});

test('review: a reply under the declared id raises no swap warning and a clean footer', async () => {
  const server = await bareIdServer(findings);
  try {
    const result = await runCompanion(['review'], { configPath: config(server.baseUrl), cwd: await reviewRepo() });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, SWAP_WARNING);
    assert.match(result.stdout, /model: Qwen3\.8-27B-MLX-4bit/);
    assert.doesNotMatch(result.stdout, /\(requested /);

    const undeclared = await runCompanion(['review'], {
      configPath: config(server.baseUrl, { declared: false }),
      cwd: await reviewRepo(),
    });
    assert.equal(undeclared.status, 0, undeclared.stderr);
    assert.match(undeclared.stderr, SWAP_WARNING);
    assert.match(undeclared.stdout, /\(requested lmstudio-community\/Qwen3\.8-27B-MLX-4bit\)/);
  } finally {
    await server.close();
  }
});

test('review --json carries the declared id, and null without one', async () => {
  const server = await bareIdServer(findings);
  try {
    const result = await runCompanion(['review', '--json'], { configPath: config(server.baseUrl), cwd: await reviewRepo() });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, SWAP_WARNING);
    const report = JSON.parse(result.stdout);
    assert.equal(report.requestedModel, REQUESTED);
    assert.equal(report.model, SERVED);
    assert.equal(report.declaredServedModel, SERVED);

    const plain = JSON.parse((await runCompanion(['review', '--json'], {
      configPath: config(server.baseUrl, { declared: false }),
      cwd: await reviewRepo(),
    })).stdout);
    assert.ok('declaredServedModel' in plain);
    assert.equal(plain.declaredServedModel, null);
  } finally {
    await server.close();
  }
});

test('review --json failure envelope carries the declared id beside the requested one', async () => {
  // Cut at the token budget: a review failure thrown after the model resolved.
  const server = await bareIdServer('{"analysis":"reading ', { finishReason: 'length' });
  try {
    const result = await runCompanion(['review', '--json'], { configPath: config(server.baseUrl), cwd: await reviewRepo() });
    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.error, true);
    assert.equal(report.requestedModel, REQUESTED);
    assert.equal(report.declaredServedModel, SERVED);
  } finally {
    await server.close();
  }
});

test('review --passes: a declared id is not a substitution to the multi-pass guard', async () => {
  const server = await bareIdServer(findings);
  try {
    const result = await runCompanion(['review', '--passes', '2', '--json'], {
      configPath: config(server.baseUrl),
      cwd: await reviewRepo(),
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'multi-pass-review');
    assert.equal(report.requestedModel, REQUESTED);
    assert.equal(report.declaredServedModel, SERVED);
    assert.deepEqual(report.passes.map((pass) => pass.declaredServedModel), [SERVED, SERVED]);

    // Without the declaration the same replies are a substituted pass, and the
    // union fails closed exactly as before.
    const undeclared = await runCompanion(['review', '--passes', '2', '--json'], {
      configPath: config(server.baseUrl, { declared: false }),
      cwd: await reviewRepo(),
    });
    assert.notEqual(undeclared.status, 0);
    const failure = JSON.parse(undeclared.stdout);
    assert.equal(failure.reason, 'served-model-disagreement');
    assert.equal(failure.declaredServedModel, null);
  } finally {
    await server.close();
  }
});

test('review --passes: an unreadable pass carries the declared id and is not noted as another model', async () => {
  // The first pass reads and names the requested id exactly; every later reply
  // is prose nothing can parse, named under the bare id.
  let chats = 0;
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) {
      chats += 1;
      return respondStream(response, chats === 1
        ? completionFrames(findings, { model: REQUESTED })
        : completionFrames('no findings here, just prose', { model: SERVED }));
    }
    if (path.endsWith('/models')) return respondJson(response, modelList(REQUESTED));
    return respondJson(response, { error: 'not found' }, 404);
  });
  try {
    const json = await runCompanion(['review', '--passes', '2', '--json'], { configPath: config(server.baseUrl), cwd: await reviewRepo() });
    assert.equal(json.status, 0, json.stderr);
    const unreadable = JSON.parse(json.stdout).passes.find((pass) => pass.ok === false);
    assert.ok(unreadable, 'one pass must be a parse-null non-observation');
    assert.equal(unreadable.model, SERVED);
    assert.equal(unreadable.declaredServedModel, SERVED);

    chats = 0;
    const text = await runCompanion(['review', '--passes', '2'], { configPath: config(server.baseUrl), cwd: await reviewRepo() });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /pass 2: /);
    assert.doesNotMatch(text.stdout, /served a different model/);

    chats = 0;
    const undeclared = await runCompanion(['review', '--passes', '2'], {
      configPath: config(server.baseUrl, { declared: false }),
      cwd: await reviewRepo(),
    });
    assert.equal(undeclared.status, 0, undeclared.stderr);
    assert.match(undeclared.stdout, /served a different model/, 'positive control: the note fires without the declaration');
  } finally {
    await server.close();
  }
});

test('background: the declaration survives submission, the worker and /oai:result', { skip: NEEDS_SQLITE }, async () => {
  const server = await bareIdServer();
  const state = stateDir();
  const configPath = config(server.baseUrl);
  try {
    const submit = await runCompanion(['task', '--background', 'hello'], { configPath, env: { OAI_PLUGIN_STATE: state } });
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();

    const row = await waitForState(state, id, ['completed', 'failed']);
    assert.equal(row.state, 'completed', JSON.stringify(row.failure));
    // Frozen at submission as the one entry for the resolved model.
    assert.deepEqual(row.request.servedModelIds, { [REQUESTED]: SERVED });
    // Read by the worker's own `finishAnswer`, not re-derived later.
    assert.equal(row.outcome.requestedModel, REQUESTED);
    assert.equal(row.outcome.model, SERVED);
    assert.equal(row.outcome.declaredServedModel, SERVED);

    const shown = await runCompanion(['result', id], { configPath, env: { OAI_PLUGIN_STATE: state } });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /model: Qwen3\.8-27B-MLX-4bit/);
    assert.doesNotMatch(shown.stdout, /\(requested /);
    assert.doesNotMatch(shown.stderr, SWAP_WARNING);
  } finally {
    await server.close();
  }
});

test('background: the frozen entry is the resolved model\'s, not the profile default\'s', { skip: NEEDS_SQLITE }, async () => {
  const OTHER = 'org/other-model';
  const OTHER_SERVED = 'other-model';
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) {
      return respondStream(response, completionFrames('the answer', { model: OTHER_SERVED }));
    }
    if (path.endsWith('/models')) return respondJson(response, modelList(REQUESTED, OTHER));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const state = stateDir();
  const configPath = writeConfig({
    defaultProvider: 'unsloth',
    providers: {
      unsloth: {
        baseUrl: server.baseUrl,
        defaultModel: REQUESTED,
        contextLength: 131_072,
        timeoutSeconds: 5,
        retrySeconds: 0,
        servedModelIds: { [REQUESTED]: SERVED, [OTHER]: OTHER_SERVED },
      },
    },
  }).path;
  try {
    const submit = await runCompanion(['task', '--background', '--model', OTHER, 'hello'], {
      configPath,
      env: { OAI_PLUGIN_STATE: state },
    });
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();

    const row = await waitForState(state, id, ['completed', 'failed']);
    assert.equal(row.state, 'completed', JSON.stringify(row.failure));
    assert.deepEqual(row.request.servedModelIds, { [OTHER]: OTHER_SERVED });
    assert.equal(row.outcome.requestedModel, OTHER);
    assert.equal(row.outcome.model, OTHER_SERVED);
    assert.equal(row.outcome.declaredServedModel, OTHER_SERVED);
  } finally {
    await server.close();
  }
});

test('--base-url to a different endpoint drops the declaration, so the swap is reported', async () => {
  const server = await bareIdServer();
  // The provider's own endpoint is somewhere else; nothing contacts it.
  const elsewhere = writeConfig({
    defaultProvider: 'unsloth',
    providers: {
      unsloth: {
        baseUrl: 'http://127.0.0.1:9/v1',
        defaultModel: REQUESTED,
        contextLength: 131_072,
        timeoutSeconds: 5,
        retrySeconds: 0,
        servedModelIds: { [REQUESTED]: SERVED },
      },
    },
  }).path;
  try {
    const crossed = await runCompanion(['task', '--provider', 'unsloth', '--base-url', server.baseUrl, '--json', 'hello'], {
      configPath: elsewhere,
    });
    assert.equal(crossed.status, 0, crossed.stderr);
    assert.match(crossed.stderr, SWAP_WARNING);
    assert.equal(JSON.parse(crossed.stdout).declaredServedModel, null);

    // Positive control: the same override onto the provider's own endpoint keeps it.
    const same = await runCompanion(['task', '--provider', 'unsloth', '--base-url', server.baseUrl, '--json', 'hello'], {
      configPath: config(server.baseUrl),
    });
    assert.equal(same.status, 0, same.stderr);
    assert.doesNotMatch(same.stderr, SWAP_WARNING);
    assert.equal(JSON.parse(same.stdout).declaredServedModel, SERVED);
  } finally {
    await server.close();
  }
});

test('background: with nothing declared the request carries no entry and the swap is reported', { skip: NEEDS_SQLITE }, async () => {
  const server = await bareIdServer();
  const state = stateDir();
  const configPath = config(server.baseUrl, { declared: false });
  try {
    const submit = await runCompanion(['task', '--background', 'hello'], { configPath, env: { OAI_PLUGIN_STATE: state } });
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();

    const row = await waitForState(state, id, ['completed', 'failed']);
    assert.equal(row.state, 'completed', JSON.stringify(row.failure));
    assert.ok(!('servedModelIds' in row.request), 'absent, never an empty map, when nothing is declared');
    assert.equal(row.outcome.declaredServedModel, null);
    assert.equal(readJob(state, id).outcome.declaredServedModel, null);

    const shown = await runCompanion(['result', id], { configPath, env: { OAI_PLUGIN_STATE: state } });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /\(requested lmstudio-community\/Qwen3\.8-27B-MLX-4bit\)/);
    assert.match(shown.stderr, SWAP_WARNING);
  } finally {
    await server.close();
  }
});
