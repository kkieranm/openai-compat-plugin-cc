// The server configuration a run resolved and acted on — the effective context
// window and its provenance, and which server-owned sampling/reasoning knobs
// were left at a default this repo could not observe. Covers the leaf
// (`run-context.mjs`), its persistence-boundary reader (`errorReport`), the
// bench failure reducer (`failedRun`), and the `--json` envelope on both the
// success and failure paths through the real CLI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failedRun } from '../bench/run.mjs';
import { MAX_NOTE, boundNote } from '../bench/lib/sweep-ledger.mjs';
import { persistRequest } from '../scripts/lib/job-request.mjs';
import { CONTEXT_SOURCES, describeModels, effectiveWindow } from '../scripts/lib/model-info.mjs';
import { errorReport } from '../scripts/lib/review-report.mjs';
import { attachRunContext, reconstructServerConfig, serverConfigFrom } from '../scripts/lib/run-context.mjs';
import {
  completionFrames, modelList, respondJson, respondStream, reviewScenario, runCompanion, startFakeServer, writeConfig,
} from './helpers.mjs';

// --- serverConfigFrom -------------------------------------------------------

test('serverConfigFrom: nothing requested reads all three unobserved', () => {
  assert.deepEqual(serverConfigFrom({}), {
    reasoningEffort: 'server-default-unobserved',
    temperature: 'server-default-unobserved',
    thinking: 'server-default-unobserved',
  });
});

test('serverConfigFrom: reasoningEffort requested flips only that knob', () => {
  assert.deepEqual(serverConfigFrom({ sampling: { reasoningEffort: 'low' } }), {
    reasoningEffort: 'requested',
    temperature: 'server-default-unobserved',
    thinking: 'server-default-unobserved',
  });
});

test('serverConfigFrom: temperature requested flips only that knob', () => {
  assert.deepEqual(serverConfigFrom({ temperature: 0.5 }), {
    reasoningEffort: 'server-default-unobserved',
    temperature: 'requested',
    thinking: 'server-default-unobserved',
  });
});

test('serverConfigFrom: thinking is always unobserved', () => {
  const both = serverConfigFrom({ sampling: { reasoningEffort: 'low' }, temperature: 0.5 });
  assert.equal(both.thinking, 'server-default-unobserved');
});

// --- attachRunContext --------------------------------------------------------

test('attachRunContext overwrites a pre-existing foreign value', () => {
  const e = new Error('x');
  e.contextWindow = { toJSON() { return 'HACK'; } };
  attachRunContext(e, { contextWindow: 4096, contextSource: 'config', detectedWindow: null, serverConfig: null });
  assert.equal(e.contextWindow, 4096);
});

test('attachRunContext no-ops on a bare-primitive throw', () => {
  const result = attachRunContext('str', { contextWindow: 4096, contextSource: 'config', detectedWindow: null, serverConfig: null });
  assert.equal(result, 'str');
});

test('attachRunContext attaches nothing when ctx is null', () => {
  const e = new Error('y');
  attachRunContext(e, null);
  assert.equal(e.contextWindow, undefined);
});

// --- reconstructServerConfig -------------------------------------------------

test('reconstructServerConfig round-trips a valid three-knob map', () => {
  const value = { reasoningEffort: 'requested', temperature: 'server-default-unobserved', thinking: 'server-default-unobserved' };
  assert.deepEqual(reconstructServerConfig(value), value);
});

test('reconstructServerConfig rejects an array', () => {
  assert.equal(reconstructServerConfig(['requested']), null);
});

test('reconstructServerConfig drops extra keys', () => {
  const value = { reasoningEffort: 'requested', temperature: 'requested', thinking: 'server-default-unobserved', EVIL: 'x' };
  const result = reconstructServerConfig(value);
  assert.deepEqual(Object.keys(result).sort(), ['reasoningEffort', 'temperature', 'thinking']);
  assert.equal('EVIL' in result, false);
});

test('reconstructServerConfig nulls a knob carrying a foreign value', () => {
  const value = { reasoningEffort: 'bogus', temperature: 'requested', thinking: 'server-default-unobserved' };
  const result = reconstructServerConfig(value);
  assert.equal(result.reasoningEffort, null);
  assert.equal(result.temperature, 'requested');
});

test('reconstructServerConfig rebuilds a fresh plain object even off a hostile prototype', () => {
  const hostile = Object.assign(Object.create({ toJSON() { return 'X'; } }), {
    reasoningEffort: 'requested', temperature: 'server-default-unobserved', thinking: 'server-default-unobserved',
  });
  const result = reconstructServerConfig(hostile);
  assert.equal(JSON.stringify(result).includes('X'), false);
  assert.deepEqual(result, { reasoningEffort: 'requested', temperature: 'server-default-unobserved', thinking: 'server-default-unobserved' });
});

test('reconstructServerConfig: null, undefined and a string all yield null', () => {
  assert.equal(reconstructServerConfig(null), null);
  assert.equal(reconstructServerConfig(undefined), null);
  assert.equal(reconstructServerConfig('nope'), null);
});

// --- errorReport coercion -----------------------------------------------------

test('errorReport coerces contextWindow: negative and fractional are dropped, a positive integer survives', () => {
  assert.equal(errorReport(Object.assign(new Error('e'), { contextWindow: -5 })).contextWindow, null);
  assert.equal(errorReport(Object.assign(new Error('e'), { contextWindow: 3.5 })).contextWindow, null);
  assert.equal(errorReport(Object.assign(new Error('e'), { contextWindow: 4096 })).contextWindow, 4096);
});

test('errorReport allows only a recognised contextSource', () => {
  assert.equal(errorReport(Object.assign(new Error('e'), { contextSource: 'config' })).contextSource, 'config');
  assert.equal(errorReport(Object.assign(new Error('e'), { contextSource: 'totally-made-up' })).contextSource, null);
});

test('errorReport rejects an array serverConfig and reconstructs a valid one', () => {
  assert.equal(errorReport(Object.assign(new Error('e'), { serverConfig: ['requested'] })).serverConfig, null);

  const valid = { reasoningEffort: 'requested', temperature: 'server-default-unobserved', thinking: 'server-default-unobserved' };
  assert.deepEqual(errorReport(Object.assign(new Error('e'), { serverConfig: valid })).serverConfig, valid);
});

test('errorReport: a bare error carries all four run-context fields as null', () => {
  const report = errorReport(new Error('bare'));
  assert.equal(report.contextWindow, null);
  assert.equal(report.contextSource, null);
  assert.equal(report.detectedWindow, null);
  assert.equal(report.serverConfig, null);
});

// --- bench/run.mjs failedRun --------------------------------------------------

test('failedRun copies the run-context fields off a failed run\'s --json stdout', () => {
  const err = {
    stdout: JSON.stringify({
      error: true,
      reason: 'reasoning-only',
      contextWindow: 61696,
      contextSource: 'config',
      detectedWindow: null,
      serverConfig: { reasoningEffort: 'server-default-unobserved', temperature: 'server-default-unobserved', thinking: 'server-default-unobserved' },
    }),
    stderr: '',
  };
  const record = failedRun(err, {}, {}, false);
  assert.equal(record.contextWindow, 61696);
  assert.equal(record.contextSource, 'config');
  assert.deepEqual(record.serverConfig, { reasoningEffort: 'server-default-unobserved', temperature: 'server-default-unobserved', thinking: 'server-default-unobserved' });
});

// --- CONTEXT_SOURCES drift guard ----------------------------------------------

test('CONTEXT_SOURCES stays in sync with what describeModels actually reports', async () => {
  const described = await describeModels(
    { baseUrl: 'http://127.0.0.1:1/v1' },
    { modelsPayload: { object: 'list', data: [{ id: 'm', max_model_len: 8192 }] } },
  );
  assert.ok(CONTEXT_SOURCES.has(described.source), `${described.source} must be listed in CONTEXT_SOURCES`);
  assert.ok(CONTEXT_SOURCES.has('config'));
  assert.ok(CONTEXT_SOURCES.has('LM Studio /api/v0/models'));
});

// --- integration: the --json envelope through the real CLI -------------------

async function serverStreaming(frames) {
  return startFakeServer((request, response) => {
    if (request.url.includes('/chat/completions')) return respondStream(response, frames);
    if (request.url.includes('/models')) return respondJson(response, modelList('small'));
    return respondJson(response, {}, 404);
  });
}

function configFor(server) {
  return writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: `http://127.0.0.1:${server.port}/v1`, defaultModel: 'small', contextLength: 8192 } },
  }).path;
}

function offlineConfig() {
  return writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'small', contextLength: 8192 } },
  }).path;
}

test('a successful task --json envelope carries the resolved context window', async () => {
  const server = await serverStreaming(completionFrames('the answer', { model: 'small' }));
  try {
    const result = await runCompanion(['task', '--json', 'a question'], { configPath: configFor(server) });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.contextWindow, 8192);
    assert.equal(envelope.contextSource, 'config');
  } finally {
    await server.close();
  }
});

test('a reasoning-only task FAILURE envelope still carries the resolved context window', async () => {
  // The motivating case: the stream finishes cleanly with content empty and the
  // whole reply on the reasoning channel, so the failure is thrown after
  // resolution — the window must not read as null just because the model never
  // answered.
  const server = await serverStreaming(completionFrames('thinking and never answering', { channel: 'reasoning', model: 'small' }));
  try {
    const result = await runCompanion(['task', '--json', 'a question'], { configPath: configFor(server) });
    assert.notEqual(result.status, 0, 'a reasoning-only reply must fail, not pass');
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    assert.equal(envelope.contextWindow, 8192);
  } finally {
    await server.close();
  }
});

test('a transport failure thrown inside executeTask carries the resolved window', async () => {
  // The models probe resolves the window, then the chat request fails at the
  // transport — thrown from chatCompletion inside executeTask, BEFORE report, so
  // only executeTask's own post-resolution wrap can attach the run context here
  // (taskFlow's report-catch never sees it).
  const server = await startFakeServer((request, response) => {
    if (request.url.includes('/chat/completions')) return respondJson(response, { error: 'boom' }, 500);
    if (request.url.includes('/models')) return respondJson(response, modelList('small'));
    return respondJson(response, {}, 404);
  });
  try {
    const result = await runCompanion(['task', '--json', '--max-attempts', '1', 'a question'], { configPath: configFor(server) });
    assert.notEqual(result.status, 0, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    assert.equal(envelope.contextWindow, 8192);
  } finally {
    await server.close();
  }
});

// Review's own reasoning-only failure envelope is not covered here: driving it
// needs a real git repo (reviewScenario in helpers.mjs), which is a second,
// heavier fixture measuring the same attach-on-throw path task's failure test
// above already exercises. Skipped rather than built to avoid duplicating that
// fixture weight for no new coverage.

test('a PRE-resolution task failure records contextWindow as null — no request was sent', async () => {
  // No prompt: resolvePrompt throws before resolveTarget does any network work,
  // so nothing was resolved at all.
  const result = await runCompanion(['task', '--json'], { configPath: offlineConfig() });
  assert.notEqual(result.status, 0, result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.error, true);
  assert.equal(envelope.contextWindow, null);
});

test('an explicit --model reads that model\'s own detected window, not the default\'s', async () => {
  const server = await startFakeServer((request, response) => {
    if (request.url.includes('/chat/completions')) return respondStream(response, completionFrames('answer', { model: 'big' }));
    if (request.url.includes('/models')) {
      return respondJson(response, {
        object: 'list',
        data: [
          { id: 'small', object: 'model', max_model_len: 8192 },
          { id: 'big', object: 'model', max_model_len: 32768 },
        ],
      });
    }
    return respondJson(response, {}, 404);
  });
  try {
    // No contextLength in config — the window must come from detection, not
    // from an operator-asserted value that would mask a dropped --model.
    const configPath = writeConfig({
      defaultProvider: 'local',
      providers: { local: { baseUrl: `http://127.0.0.1:${server.port}/v1`, defaultModel: 'small' } },
    }).path;
    const result = await runCompanion(['task', '--json', '--model', 'big', 'q'], { configPath });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.contextWindow, 32768);
    assert.equal(envelope.contextSource, '/v1/models max_model_len');
  } finally {
    await server.close();
  }
});

test('a review FAILURE envelope carries the resolved window (a reserveFor refusal, thrown by reviewPlan)', async () => {
  // --max-tokens below the review reserve floor makes reviewPlan's reserveFor throw
  // AFTER resolveTarget but BEFORE the request — the post-resolution failure the
  // whole-body wrap must cover. This is the motivating bench-review path. No chat
  // request is sent (reserveFor throws first), so /models is the only route needed.
  // A detected window (32768) that CONFLICTS with the configured one (8192): config
  // wins the window and source, and the conflicting detected value rides out as
  // `detectedWindow` — a positive control for that field on a FAILURE envelope.
  const { dir, server, configPath } = await reviewScenario((request, response) => {
    if (request.url.includes('/models')) {
      return respondJson(response, { object: 'list', data: [{ id: 'test-model', object: 'model', max_model_len: 32768 }] });
    }
    return respondJson(response, {}, 500);
  }, { contextLength: 8192 });
  try {
    const result = await runCompanion(['review', '--json', '--max-tokens', '100'], { configPath, cwd: dir });
    assert.notEqual(result.status, 0, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    assert.equal(envelope.contextWindow, 8192);
    assert.equal(envelope.contextSource, 'config');
    assert.equal(envelope.detectedWindow, 32768);
    assert.deepEqual(envelope.serverConfig, {
      reasoningEffort: 'server-default-unobserved',
      temperature: 'server-default-unobserved',
      thinking: 'server-default-unobserved',
    });
  } finally {
    await server.close();
  }
});

test('effectiveWindow surfaces detectedWindow when a configured window conflicts with the detected one', () => {
  // The field's whole reason to exist: a stale configured value outranking a
  // different detected one. Config wins the window, and the conflicting detected
  // value rides out as `detected` so a reader can see the disagreement.
  const described = { models: [{ id: 'm', window: 40000, state: 'loaded' }], source: 'LM Studio /api/v0/models' };
  const resolved = effectiveWindow({ contextLength: 8192, defaultModel: 'm' }, described, 'm');
  assert.equal(resolved.window, 8192);
  assert.equal(resolved.source, 'config');
  assert.equal(resolved.detected, 40000);
});

test('a persisted background request DTO carries NO run-context — the worker records the fields null', () => {
  // The background-null invariant (decision F): runContext on prep must not reach
  // the persisted DTO. Sibling fields are asserted present so the absence below is
  // a real omission, not a shape the test failed to build.
  const dto = persistRequest({
    profile: {}, numeric: {}, messages: [{ role: 'user', content: 'x' }], budget: { checked: true },
    template: 'advisor', estimatedTokens: 42,
    runContext: { contextWindow: 8192, contextSource: 'config', detectedWindow: null, serverConfig: {} },
  });
  assert.equal(dto.template, 'advisor');
  assert.equal(dto.estimatedTokens, 42);
  assert.equal('runContext' in dto, false);
  assert.equal('contextWindow' in dto, false);
  assert.equal('serverConfig' in dto, false);
});

test('reconstructServerConfig reads each knob once — a getter cannot slip a second, foreign value through', () => {
  let reads = 0;
  const hostile = { temperature: 'server-default-unobserved', thinking: 'server-default-unobserved' };
  Object.defineProperty(hostile, 'reasoningEffort', {
    enumerable: true,
    get() { reads += 1; return reads === 1 ? 'requested' : { toJSON() { return 'FOREIGN'; } }; },
  });
  const result = reconstructServerConfig(hostile);
  assert.equal(result.reasoningEffort, 'requested');
  assert.equal(JSON.stringify(result).includes('FOREIGN'), false);
});

test('errorReport reads contextSource once — a getter cannot pass validation then serialize a foreign value', () => {
  let reads = 0;
  const error = new Error('boom');
  Object.defineProperty(error, 'contextSource', {
    enumerable: true,
    get() { reads += 1; return reads === 1 ? 'config' : { toJSON() { return 'FOREIGN'; } }; },
  });
  const report = errorReport(error);
  assert.equal(report.contextSource, 'config');
  assert.equal(JSON.stringify(report).includes('FOREIGN'), false);
});

test('boundNote keeps the whole result within MAX_NOTE and never splits a surrogate pair', () => {
  assert.equal(boundNote('a short note'), 'a short note');
  assert.equal(boundNote(null), null);
  assert.equal(boundNote(undefined), null);
  // Astral-heavy input over the cap: `.length` counts UTF-16 units (2 per emoji),
  // so a code-point-based truncation would blow past MAX_NOTE — this asserts units.
  const bounded = boundNote('😀'.repeat(1200));
  assert.equal(bounded.length <= MAX_NOTE, true);
  assert.equal(bounded.endsWith('… [note truncated]'), true);
  // Odd-parity input so the cut lands mid-pair and the surrogate back-off actually
  // runs: a leading 'x' shifts every emoji's high half onto an odd index, and the
  // cut index (MAX_NOTE - marker length = 1982) is odd, so slice ends on a lone
  // high surrogate the back-off must drop. Even-parity input (above) lands on a
  // pair boundary and never exercises the branch — deleting it keeps that case green.
  const straddling = boundNote(`x${'😀'.repeat(1200)}`);
  assert.equal(straddling.length <= MAX_NOTE, true);
  assert.equal(straddling.endsWith('… [note truncated]'), true);
  const head = straddling.slice(0, -'… [note truncated]'.length);
  assert.equal(/[\ud800-\udbff]$/.test(head), false);
  assert.equal(straddling.isWellFormed(), true);
});
