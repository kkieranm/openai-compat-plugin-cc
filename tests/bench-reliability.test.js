import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answeringAttempt, attemptRows } from '../bench/lib/attempt-rows.mjs';
import { caseRows } from '../bench/lib/case-rows.mjs';
import { renderReport } from '../bench/lib/report.mjs';
import { CASE } from './bench-report-fixtures.mjs';

// OAI-20. Scoring reads LOGICAL runs — the attempt that answered — while
// reliability reads every PHYSICAL request. A run whose first two attempts died
// and whose third answered is one scored run and three requests, and a report
// that shows only the first number says a sick server is healthy.

const failedAttempt = (reason, extra = {}) => ({
  index: 1, cause: { answerAttempt: 1, degrade: null }, warmEligible: false, waitedMs: 0,
  outcome: 'failed', reason, prefillMs: null, generationMs: null, ...extra,
});

const answered = (extra = {}) => ({
  index: 2, cause: { answerAttempt: 2, degrade: null }, warmEligible: true, waitedMs: 2000,
  outcome: 'answered', reason: null, prefillMs: 500, generationMs: 1500, ...extra,
});

/** One logical run that succeeded on its second physical attempt. */
function retriedRun() {
  return {
    diffOnly: false,
    report: {
      parsed: true, findings: [], analysisCut: false, finishReason: 'stop',
      usage: { prompt_tokens: 10 }, durationMs: 1000, prefillMs: 500, generationMs: 1500,
      requestedModel: 'test-model', attempts: [failedAttempt('blank-completion'), answered()],
    },
    score: {
      matched: [], unmatched: [], byDefect: [{ id: 'the-defect', found: false }],
      recall: { total: 1, found: 0, anchored: 0, ranged: 0 },
    },
  };
}

test('a retried run is ONE logical run and TWO physical attempts', () => {
  const stats = attemptRows([{ caseDef: CASE, runs: [retriedRun()] }]);
  assert.equal(stats.total, 2);
  assert.equal(stats.answered, 1);
  assert.equal(stats.failed, 1);
  assert.deepEqual(stats.byReason, [['blank-completion', 1]]);
});

test('attempts from a run that failed outright are counted too — the run with the most evidence', () => {
  // The failure path carries `attempts` on the run itself, not under a report,
  // because there is no report. Missing this is how the case that says the most
  // about the server contributes nothing to the reliability figure.
  const dead = { diffOnly: false, error: 'boom', reason: 'transport', attempts: [failedAttempt('transport')] };
  const stats = attemptRows([{ caseDef: CASE, runs: [retriedRun(), dead] }]);
  assert.equal(stats.total, 3);
  assert.equal(stats.failed, 2);
  assert.deepEqual(stats.byReason, [['blank-completion', 1], ['transport', 1]]);
});

test('no attempt record at all reports nothing, rather than a 0% failure rate nobody measured', () => {
  const bare = { diffOnly: false, report: { parsed: true, findings: [] } };
  assert.equal(attemptRows([{ caseDef: CASE, runs: [bare] }]), null);
});

test('exactly one attempt answers, and it is the one the headline timings came from', () => {
  const attempt = answeringAttempt(retriedRun());
  assert.equal(attempt.outcome, 'answered');
  assert.equal(attempt.prefillMs, 500);
});

test('a warm-eligible answering attempt is excluded from the cold prefill samples', () => {
  // The trap this closes: `--cold` mints its cache-buster per RUN, but a retry
  // re-sends the prompt byte-for-byte on purpose. So the answering attempt's
  // prefill may be a cache hit, and quoting it as a cold measurement corrupts
  // the exact figure OAI-19 reads off this report.
  const [row] = caseRows([{ caseDef: CASE, runs: [retriedRun()] }], { cold: true });
  assert.deepEqual(row.prefill.values, [], 'a warm-eligible prefill is not a prefill sample');
  assert.deepEqual(row.generation.values, [1500], 'generation is untouched by a prompt cache, so it stays');
});

test('a cold answering attempt keeps its prefill', () => {
  const run = retriedRun();
  run.report.attempts = [failedAttempt('blank-completion'), answered({ warmEligible: false })];
  const [row] = caseRows([{ caseDef: CASE, runs: [run] }], { cold: true });
  assert.deepEqual(row.prefill.values, [500]);
});

test('the report states both denominators, and names logical runs as logical', () => {
  const dead = { diffOnly: false, error: 'boom', reason: 'transport', attempts: [failedAttempt('transport')] };
  const markdown = renderReport([{ caseDef: CASE, runs: [retriedRun(), dead] }], {
    runsPerCase: 2, model: 'm', provider: 'p', diffOnly: false, cold: true,
  });

  assert.match(markdown, /## Physical-attempt reliability/);
  assert.match(markdown, /2 logical run\(s\): 1 completed, 1 did not\./);
  assert.match(markdown, /3 physical attempt\(s\): 1 answered, 2 failed \(66\.7%\)\./);
  // Renamed so the two headings read as the pair they are. A run answered by its
  // third attempt completed, and belongs under neither heading.
  assert.match(markdown, /## Logical runs that did not complete/);
  assert.doesNotMatch(markdown, /## Runs that did not complete/);
});

test('warm-eligible is reported as could-have-been, never as an observed cache hit', () => {
  const markdown = renderReport([{ caseDef: CASE, runs: [retriedRun()] }], {
    runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: true,
  });
  assert.match(markdown, /not an observed cache hit/);
  assert.doesNotMatch(markdown, /cache hit observed|was served from cache/);
});

test('refused attempts are counted, but never as failures', () => {
  const refused = {
    index: 1, cause: { answerAttempt: 1, degrade: null }, warmEligible: false, waitedMs: 0,
    outcome: 'refused', reason: null, prefillMs: null, generationMs: null,
  };
  const run = retriedRun();
  run.report.attempts = [refused, answered({ warmEligible: false })];
  const stats = attemptRows([{ caseDef: CASE, runs: [run] }]);

  assert.equal(stats.total, 2, 'it was a real request');
  assert.equal(stats.refused, 1);
  assert.equal(stats.failed, 0, 'negotiation is not unreliability');
  assert.deepEqual(stats.byReason, []);
});

test('a substituted run completed, so it is not counted as a run that did not', () => {
  // The adjacent section says these completed and were timed. Two lines about
  // the same runs must not contradict each other.
  const substituted = {
    diffOnly: false, error: 'served a different model', reason: 'model-substituted',
    report: { requestedModel: 'asked', model: 'served', attempts: [answered({ warmEligible: false })] },
  };
  const markdown = renderReport([{ caseDef: CASE, runs: [substituted] }], {
    runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
  });
  assert.match(markdown, /1 logical run\(s\): 1 completed, 0 did not\./);
});

test('an all-failed run still names the model it asked for', () => {
  const dead = {
    diffOnly: false, error: 'boom', reason: 'transport', requestedModel: 'qwen/qwen3.6-27b',
    attempts: [failedAttempt('transport')],
  };
  const stats = attemptRows([{ caseDef: CASE, runs: [dead] }]);
  assert.deepEqual(stats.byModel, [['qwen/qwen3.6-27b', 1]], 'never bucketed as unknown');
});

test('without --cold the retry-warmed prefill stays in the sample it belongs to', () => {
  // Without --cold the report never promised independent prefills — every one is
  // cache-affected and the caveats say so. Dropping only the retry-warmed ones
  // would bias the sample rather than clean it.
  const [row] = caseRows([{ caseDef: CASE, runs: [retriedRun()] }], { cold: false });
  assert.deepEqual(row.prefill.values, [500]);
});
