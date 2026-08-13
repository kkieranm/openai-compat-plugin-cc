// The task bench's loop, driven without a model.
//
// `bench/run.mjs` cannot be tested at all — it runs `main()` at import, which is
// why `warm-up.mjs` had to take its loop as an injected parameter. This runner
// was built the other way round from the start, and these tests are the reason
// that mattered: the arm alternation and the incomplete-sweep guard are decisions
// about what a number MEANS, and neither is observable from a report.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport, requestArgs, runSweep } from '../bench/task-run.mjs';
import { loadTaskCases } from '../bench/lib/task-corpus.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
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
