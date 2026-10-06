// The task bench's loop, driven without a model.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderReport, requestArgs, runSweep } from '../bench/task-run.mjs';
import { loadTaskCases } from '../bench/lib/task-corpus.mjs';
import { fileURLToPath } from 'node:url';
import { modelList, respondJson, startFakeServer, tempDir, writeConfig } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CASES = loadTaskCases(ROOT);

/** An executor that answers with whatever text the caller maps per arm. */
function answering(byArm) {
  const seen = [];
  const execute = (caseDef, arm) => {
    seen.push({ id: caseDef.id, arm });
    return { content: byArm[arm] ?? '', model: 'stub', requestedModel: 'stub', attempts: [] };
  };
  return { execute, seen };
}

test('every case runs BOTH arms, and the report never averages them', async () => {
  // Framing was the dominant variable measured. A single figure across
  // both arms would describe a measurement nobody made.
  const { execute } = answering({
    pointed: 'the lookup uses bracket notation; prototype members leak; use Object.hasOwn',
    neutral: 'it is hardcoded and inextensible',
  });
  const sweep = runSweep(CASES, { runs: 1 }, { execute });
  const markdown = renderReport(sweep);

  const proto = sweep.results.find((r) => r.caseDef.id === 'prototype-lookup');
  const pointed = proto.runs.find((r) => r.arm === 'pointed');
  const neutral = proto.runs.find((r) => r.arm === 'neutral');
  assert.equal(pointed.score.profile, 'exact');
  assert.equal(neutral.score.profile, 'missed');

  // Both arms appear as their own rows; no row merges them.
  assert.match(markdown, /\| prototype-lookup \| neutral \|/);
  assert.match(markdown, /\| prototype-lookup \| pointed \|/);
});

test('a single-arm sweep declares itself INCOMPLETE rather than looking finished', async () => {
  const { execute } = answering({ pointed: 'bracket notation, prototype, Object.hasOwn' });
  const sweep = runSweep(CASES, { runs: 1, arm: ['pointed'] }, { execute });
  const markdown = renderReport(sweep);
  assert.match(markdown, /INCOMPLETE/);
  assert.match(markdown, /only the pointed arm ran/);
});

test('arm ORDER alternates across repetitions, so one arm cannot always pay the cold prefill', async () => {
  // Both arms send a nearly identical prefix and a server-side cache moves first
  // token latency by tens of times — measured at 421.7s cold against 11.5s
  // warm on the same prefix here. A fixed order would bill one arm the cold run
  // every time and report the difference as a property of the framing.
  const { execute, seen } = answering({ pointed: 'x', neutral: 'y' });
  runSweep([CASES[0]], { runs: 4 }, { execute });
  const arms = seen.map((s) => s.arm);
  assert.deepEqual(arms.slice(0, 2), ['neutral', 'pointed']);
  assert.deepEqual(arms.slice(2, 4), ['pointed', 'neutral'], 'the second repetition must reverse');
  assert.deepEqual(arms.slice(4, 6), ['neutral', 'pointed']);
});

test('a failed run is recorded as missing data, never as an observed miss', async () => {
  const execute = () => ({ error: true, message: 'the model is on fire', attempts: null });
  const sweep = runSweep([CASES[0]], { runs: 1 }, { execute });
  for (const run of sweep.results[0].runs) {
    assert.equal(run.score, undefined, 'a run with no answer cannot have a profile');
    assert.equal(run.report.error, true);
  }
  // And the report counts it as failed rather than as a miss.
  assert.match(renderReport(sweep), /\| 0 \| 0 \| 0 \| 0 \| 1 \|/);
});

test('the report always states what the numbers are not', async () => {
  const { execute } = answering({ pointed: 'x', neutral: 'y' });
  const markdown = renderReport(runSweep(CASES, { runs: 1 }, { execute }));
  assert.match(markdown, /## What these numbers are not/);
  assert.match(markdown, /never that it understood/);
  assert.match(markdown, /not the Stage 2 gate/);
});

test('the request carries the template, the attachments and the prompt LAST', async () => {
  const args = requestArgs(CASES[0], 'pointed', { model: 'm', 'max-seconds': 600 });
  assert.equal(args[0], 'task');
  assert.ok(args.includes('--json'));
  assert.equal(args[args.length - 1], CASES[0].prompts.pointed, 'flags stop at the first prompt word');
  const templateAt = args.indexOf('--template');
  assert.ok(templateAt > 0 && templateAt < args.length - 1);
  assert.equal(args[templateAt + 1], CASES[0].template);
});

test('the run records the prompt that was SENT, not the label it came from', async () => {
  const { execute } = answering({ pointed: 'x', neutral: 'y' });
  const sweep = runSweep([CASES[0]], { runs: 1 }, { execute });
  for (const run of sweep.results[0].runs) {
    assert.equal(run.prompt, CASES[0].prompts[run.arm]);
    assert.ok(run.prompt.length > 0);
  }
});

test('the task bench refuses a stray positional BEFORE any case starts', async () => {
  // The only provider the child can reach is this in-process server, which counts every request, so a
  // case that did start reaches no real model and is seen here.
  const server = await startFakeServer((request, response) => respondJson(response, modelList('test-model')));
  const { path: configPath } = writeConfig({
    defaultProvider: 'fake',
    providers: { fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192 } },
  });
  const env = { ...process.env, OAI_PLUGIN_CONFIG: configPath, OAI_PLUGIN_STATE: tempDir('task-bench-state-') };
  const child = spawn(process.execPath, [join(ROOT, 'bench/task-run.mjs'), 'x', '--model', 'wanted'], { cwd: ROOT, env });
  let out = '';
  let startedCase = false;
  const read = (data) => {
    out += data;
    if (!startedCase && /run \d+\/\d+/.test(out)) {
      startedCase = true;
      child.kill('SIGKILL');
    }
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const [code, signal] = await new Promise((resolve) => child.on('close', (c, s) => resolve([c, s])));
  clearTimeout(timer);
  const hits = server.requests.length;
  await server.close();
  assert.equal(hits, 0, `a refused command sent a request to the model server: ${out.slice(0, 300)}`);
  assert.equal(startedCase, false, `a stray positional let a case start: ${out.slice(0, 300)}`);
  assert.equal(signal, null, out.slice(0, 300));
  assert.notEqual(code, 0);
  assert.match(out, /Refusing: "x", "--model", "wanted" is not an option this command takes/);
  assert.doesNotMatch(out, /\n\s+at /, 'a refusal, not a stack trace');
});

test('a `|` in a case id keeps its report row at the header\'s column count', async () => {
  const { execute } = answering({ pointed: 'x', neutral: 'y' });
  const sweep = runSweep([{ ...CASES[0], id: 'a|b' }], { runs: 1 }, { execute });
  const rows = renderReport(sweep).split('\n').filter((line) => line.startsWith('|'));
  const pipes = (line) => line.split('|').length;
  assert.ok(rows.some((row) => row.startsWith('| a.b |')), rows.join('\n'));
  for (const row of rows) assert.equal(pipes(row), pipes(rows[0]), row);
});

test('a model id prints verbatim inside a code span, with an unconfirmed id\'s `?` outside it', async () => {
  const execute = (caseDef, arm) => ({
    content: 'x',
    model: 'qwen3_coder-q4_k_m',
    modelReported: arm === 'neutral' ? false : true,
    attempts: [],
  });
  const markdown = renderReport(runSweep([CASES[0]], { runs: 1 }, { execute }));
  assert.ok(markdown.includes('| pointed | `qwen3_coder-q4_k_m` |'), markdown);
  assert.ok(markdown.includes('| neutral | `qwen3_coder-q4_k_m`? |'), markdown);
});

test('a `|` in a model id keeps its report row at the header\'s column count', async () => {
  const execute = () => ({ content: 'x', model: 'm|n', attempts: [] });
  const rows = renderReport(runSweep([CASES[0]], { runs: 1 }, { execute })).split('\n').filter((line) => line.startsWith('|'));
  const pipes = (line) => line.split('|').length;
  assert.ok(rows.some((row) => row.includes('| `m.n` |')), rows.join('\n'));
  for (const row of rows) assert.equal(pipes(row), pipes(rows[0]), row);
});
