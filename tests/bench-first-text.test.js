import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptRows } from '../bench/lib/attempt-rows.mjs';
import { renderReport } from '../bench/lib/report.mjs';
import { CASE } from './bench-report-fixtures.mjs';
import {
  completionFrames,
  deltaFrame,
  respondStream,
  reviewScenario,
  runCompanion,
  scriptOf,
} from './helpers.mjs';

// OAI-24. A failed attempt's timings are already kept — `attempt-outcome.mjs`
// retains them so the record can say "whether failures cluster before or after
// the first token". This suite guards the reader of that, and in particular
// guards the two ways its claim could quietly become false: counting a record
// that predates the field as a measurement, and printing the paragraph on a
// sweep that observed no failure at all.
//
// Its own file rather than `bench-reliability.test.js`, which was close to the
// 300-line ratchet when this was written. OAI-31 later split that file — the
// reason-code prose guards are now in `bench-reason-notes.test.js` — so the
// pressure is gone, but the seam still holds: this asks what a `prefillMs`
// establishes, which is neither attempt accounting nor reason-code prose. A
// line count is deliberately not quoted here; the one that was went stale.

const failed = (reason, extra = {}) => ({
  index: 1, cause: { answerAttempt: 1, degrade: null }, warmEligible: false, waitedMs: 0,
  outcome: 'failed', reason, prefillMs: null, generationMs: null, ...extra,
});

const answered = (extra = {}) => ({
  index: 2, cause: { answerAttempt: 2, degrade: null }, warmEligible: false, waitedMs: 0,
  outcome: 'answered', reason: null, prefillMs: 500, generationMs: 1500, ...extra,
});

const deadRun = (attempts) => ({ diffOnly: false, error: 'boom', reason: 'transport', attempts });

const render = (runs) => renderReport([{ caseDef: CASE, runs }], {
  runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
});

// Two without a prefill against one with, never one-and-one. A symmetric
// fixture cannot fail: inverting the comparison in `attempt-rows.mjs` merely
// swaps the two labels' counts, both rows still read 1, and the rendered table
// is byte-identical — so the mutation check would pass a broken split.
const ASYMMETRIC = [
  failed('empty-completion'),
  failed('transport'),
  failed('transport', { prefillMs: 42_000, generationMs: 900 }),
];

test('failures split on whether a prefill was measured, counted separately', () => {
  const stats = attemptRows([{ caseDef: CASE, runs: [deadRun(ASYMMETRIC)] }]);
  assert.equal(stats.failed, 3);
  assert.deepEqual(stats.byFirstText, [
    ['first model text observed', 1],
    ['no first model text observed', 2],
  ]);
});

test('an attempt recorded before the field existed is not counted as a measurement', () => {
  // `undefined`, not `null` — the shape a record written by an older build
  // carries. A strict `=== null` files it under "first model text observed",
  // which is the report asserting a prefill that was never measured.
  const legacy = failed('transport');
  delete legacy.prefillMs;
  const stats = attemptRows([{ caseDef: CASE, runs: [deadRun([legacy])] }]);
  assert.deepEqual(stats.byFirstText, [['no first model text observed', 1]]);
});

test('the split is rendered with the paragraph that bounds what it means', () => {
  const markdown = render([deadRun(ASYMMETRIC)]);
  assert.match(markdown, /Failures by whether first model text arrived/);
  assert.match(markdown, /\| `first model text observed` \| 1 \|/);
  assert.match(markdown, /\| `no first model text observed` \| 2 \|/);
  // The bounding clauses, each pinned on its own: the paragraph's whole job is
  // to stop a reader promoting "no prefill recorded" into a cause.
  assert.match(markdown, /happened \*after\* that boundary/);
  assert.match(markdown, /does \*\*not\*\* say what killed the stream/);
  assert.match(markdown, /absence of the measurement is not evidence of a cause/);
});

// Everything above hand-builds attempts, which proves the READER. This proves
// the claim the reader rests on: that a `prefillMs` is absent exactly when no
// model text arrived. `stream-collect.mjs` starts `firstTextAt` at null and only
// sets it when a frame carried text, and `timings()` returns a null pair on
// exactly that — but nothing guarded the link, so the paragraph's central
// sentence was asserted rather than tested. An empty completion is the shape
// that matters: it is the dominant historical failure and the one the split is
// consulted about.
test('a real dropped request records no prefill, and the reader files it as such', async () => {
  const blank = (response) => respondStream(response, [
    deltaFrame({ role: 'assistant', content: '' }),
    { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]);
  const findings = JSON.stringify({
    analysis: 'read each changed file in full',
    findings: [{ file: 'seed.txt', line: 2, severity: 'high', summary: 'a defect', evidence: 'edited' }],
    summary: 'One defect found.',
  });
  const { dir, server, configPath } = await reviewScenario(
    scriptOf([blank, (response) => respondStream(response, completionFrames(findings))]),
    { contextLength: 131_072 },
  );
  // Async, never spawnSync: a sync spawn blocks the event loop, the in-process
  // server can never answer, and the run hangs until the client timeout.
  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout);
  const [dropped, answered_] = report.attempts;
  assert.equal(dropped.outcome, 'failed');
  assert.equal(dropped.prefillMs, null, 'no text arrived, so no prefill was measured');
  assert.ok(answered_.prefillMs !== null, 'the attempt that answered did measure one');

  // Through the real reader, on the real record — the end the paragraph claims.
  const stats = attemptRows([{ caseDef: CASE, runs: [{ diffOnly: false, report }] }]);
  assert.deepEqual(stats.byFirstText, [['no first model text observed', 1]]);
});

test('a sweep that observed no failure prints neither the table nor the paragraph', () => {
  // Gated on a count of failures, not on a reason name. The sibling paragraphs
  // are gated by `sawReason`, whose exact match is one loosened operator from
  // printing a note about a code that never occurred; this must not add a
  // second instance of that shape.
  const clean = {
    diffOnly: false,
    report: {
      parsed: true, findings: [], analysisCut: false, finishReason: 'stop',
      usage: { prompt_tokens: 10 }, durationMs: 1000, prefillMs: 500, generationMs: 1500,
      requestedModel: 'test-model', attempts: [answered()],
    },
    score: {
      matched: [], unmatched: [], byDefect: [{ id: 'the-defect', found: false }],
      recall: { total: 1, found: 0, anchored: 0, ranged: 0 },
    },
  };
  const markdown = render([clean]);
  assert.doesNotMatch(markdown, /Failures by whether first model text arrived/);
  assert.doesNotMatch(markdown, /absence of the measurement is not evidence of a cause/);
});
