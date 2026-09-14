import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answeringAttempt, attemptRows } from '../bench/lib/attempt-rows.mjs';
import { caseRows } from '../bench/lib/case-rows.mjs';
import { renderReport } from '../bench/lib/report.mjs';
import { CASE, failedAttempt } from './bench-report-fixtures.mjs';

// Scoring reads LOGICAL runs — the attempt that answered — while
// reliability reads every PHYSICAL request. A run whose first two attempts died
// and whose third answered is one scored run and three requests, and a report
// that shows only the first number says a sick server is healthy.
//
// This suite is the ACCOUNTING half: is every physical request counted, in the
// right bucket, against the right denominator. The prose explaining what each
// reason code MEANS is `bench-reason-notes.test.js`.

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

test('the response split keeps legacy records out of BOTH answers, in a bucket of their own', () => {
  // The defect this exists to stop, and it is a silent one. `failedAttempt` here
  // is a record written before `serverResponded` existed — it carries none at all,
  // which is what every entry in `bench/results/` looks like. A two-bucket split
  // would file each of those as "nothing answered", turning missing
  // instrumentation into a measurement that a server went quiet, and the
  // reliability figure would be read off it.
  const stats = attemptRows([{ caseDef: CASE, runs: [{
    diffOnly: false, error: 'boom', reason: 'transport', requestedModel: 'm',
    attempts: [
      failedAttempt('transport', { serverResponded: true }),
      failedAttempt('non-retryable-transport', { serverResponded: false }),
      failedAttempt('transport'),
    ],
  }] }]);

  assert.deepEqual(stats.byServerResponded, [
    ['HTTP response obtained', 1],
    ['no HTTP response obtained', 1],
    ['not recorded', 1],
  ]);
});

test('a bucket nobody hit still prints when there ARE failures — a zero is a measurement', () => {
  // The mutation this kills, and it went unnoticed for a whole review pass:
  // dropping `RESPONSE_BUCKETS` from the tally left all 415 tests green. The
  // three-bucket test above populates every bucket organically, one attempt each,
  // so seeding changes nothing about its result; the render test below asserts
  // only the row that was populated. Neither could see the seed disappear.
  //
  // Here exactly one bucket is hit, so the other two exist ONLY because they were
  // seeded — which is the claim the seeding makes: `not recorded: 0` is what says
  // the other counts are complete, and a suppressed row cannot say it.
  const stats = attemptRows([{ caseDef: CASE, runs: [{
    diffOnly: false, error: 'boom', reason: 'transport', requestedModel: 'm',
    attempts: [failedAttempt('transport', { serverResponded: true })],
  }] }]);

  assert.deepEqual(stats.byServerResponded, [
    ['HTTP response obtained', 1],
    ['no HTTP response obtained', 0],
    ['not recorded', 0],
  ]);
});

test('a clean sweep prints no response table at all, like every other failure split', () => {
  // The other arm, and it must be a separate assertion from the one above or the
  // two rules collapse into each other. A zero ROW inside a populated table is a
  // measurement; the whole table on a sweep with no failures is a partition of
  // nothing. Seeding made `pairs.length` permanently 3, so `countTable`'s empty
  // guard could never fire for this one table — while every unseeded sibling
  // collapsed correctly, leaving three all-zero rows as the ONLY table in the
  // section, under a heading, with the prose that explains them suppressed.
  const clean = {
    diffOnly: false,
    report: {
      parsed: true, findings: [], analysisCut: false, finishReason: 'stop',
      usage: { prompt_tokens: 10 }, durationMs: 1000, prefillMs: 500, generationMs: 1500,
      requestedModel: 'm', attempts: [answered({ warmEligible: false })],
    },
    score: { matched: [], unmatched: [], byDefect: [], recall: { total: 0, found: 0, anchored: 0, ranged: 0 } },
  };
  const markdown = renderReport([{ caseDef: CASE, runs: [clean] }], {
    runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
  });

  assert.doesNotMatch(markdown, /Failures by whether an HTTP response was obtained/);
  // Asserted beside a sibling, so this pins CONSISTENCY with the section rather
  // than a rule of its own — if failure tables ever start printing at zero, this
  // should fail with them, not against them.
  assert.doesNotMatch(markdown, /Failures by whether first model text arrived/);
});

test('a non-boolean is reported as a writer defect, never laundered into `not recorded`', () => {
  // `undefined` means the field is absent — a record written before `serverResponded` existed. A
  // string means something WROTE it and wrote it wrong. Folding the second into
  // the first would let a live writer bug read as a benign old file, so it gets
  // its own row, outside the partition and deliberately unseeded: it prints only
  // when it happens.
  const markdown = renderReport([{ caseDef: CASE, runs: [{
    diffOnly: false, error: 'boom', reason: 'transport', requestedModel: 'm',
    attempts: [failedAttempt('transport', { serverResponded: 'true' })],
  }] }], { runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false });

  assert.match(markdown, /^\| `recorded as a non-boolean` \| 1 \|$/m);
  assert.match(markdown, /^\| `not recorded` \| 0 \|$/m, 'a malformed value is not a missing field');

  // And the completeness sentence has to DEFER to that row instead of contradicting
  // the table printed directly beneath it: `not recorded: 0` means the counts are
  // complete only if every failure actually answered the question, and this one
  // answered it unreadably.
  const note = markdown.split('\n').find((line) => line.startsWith('The last table splits'));
  assert.match(note, /does NOT mean the counts are complete/);
});

test('with every value a boolean, the completeness sentence takes its POSITIVE arm', () => {
  // The complement, and it is not padding: the branch has two arms and only the
  // pessimistic one was asserted, so a regression that always warned — the easy
  // way to write this wrong, since the cautious arm looks like the safe default —
  // would have left the suite green while telling every clean report its counts
  // could not be trusted.
  const markdown = renderReport([{ caseDef: CASE, runs: [{
    diffOnly: false, error: 'boom', reason: 'transport', requestedModel: 'm',
    attempts: [failedAttempt('transport', { serverResponded: false })],
  }] }], { runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false });

  const note = markdown.split('\n').find((line) => line.startsWith('The last table splits'));
  assert.match(note, /a zero there means every failure above answered the/);
  assert.doesNotMatch(note, /does NOT mean the counts are complete/);
});

test('the response split is described as a RESPONSE, never as a peer being reached', () => {
  // The substitution a reader makes for free, and the table's placement invites
  // it: this sits directly under a paragraph about reachability and reads like an
  // answer to it. A certificate rejection completes a connection to a real peer
  // and obtains no response, so the two axes disagree exactly where it matters.
  const markdown = renderReport([{ caseDef: CASE, runs: [{
    diffOnly: false, error: 'boom', reason: 'transport', requestedModel: 'm',
    attempts: [failedAttempt('transport', { serverResponded: false })],
  }] }], { runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false });

  // The ROW, not the title. A title assertion passes on the note sentence that
  // quotes the same words, so it would stay green with the `countTable` call
  // dropped entirely.
  //
  // That edit used to be easy to make by accident, because the note and the table
  // were separate pushes into the same array — and they did come apart, on the
  // zero-failure path. `respondedSection` returns them as one unit now, so the
  // structure carries what this comment used to have to warn about; the row
  // assertion stays because it is still the stronger check.
  assert.match(markdown, /^\| `no HTTP response obtained` \| 1 \|$/m);

  const note = markdown.split('\n').find((line) => line.startsWith('The last table splits'));
  assert.ok(note, 'the table ships with prose saying what it does not settle');
  assert.match(note, /not the same question as whether a peer was reached/);
  // And the legacy row is explained where it is printed, not left as a bare word.
  // It may NOT assert provenance: absence of the field does not establish that a
  // record predates it, and an earlier draft of this sentence said exactly that.
  assert.match(note, /counts attempts carrying no such field/);
  assert.doesNotMatch(note, /predates this field/);
});

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
  // the exact figure this report is read for.
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
