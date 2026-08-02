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

// OAI-26. `Failures by reason` is a bare count table, and three of its codes are
// ones a reader will misread in exactly the direction the attempt record exists
// to prevent: `shape-rejected` sits among the delivery failures and is a client
// stop; `transport` is a retryability verdict rather than a count of server
// misbehaviour; and `non-retryable-transport` says only that a retry was not
// attempted — NOT, as an earlier draft of both the tracker item and this comment
// asserted, that the peer was reached. `ENOTFOUND` and `ECONNREFUSED` carry that
// reason and reached nothing, which is why the claim had to be withdrawn.
/** One outright-failed run whose single attempt died with `reason`. */
const deadRunWith = (reason) => ({
  diffOnly: false, error: 'boom', reason, requestedModel: 'm', attempts: [failedAttempt(reason)],
});

const renderWith = (reason) => renderReport([{ caseDef: CASE, runs: [deadRunWith(reason)] }], {
  runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
});

test('shape-rejected is explained as the terminal twin of refused, not as a dropped request', () => {
  const markdown = renderWith('shape-rejected');
  assert.match(markdown, /`shape-rejected`/);
  assert.match(markdown, /nothing replaced it/, 'the whole point: no replacement was ever dispatched');
  assert.match(markdown, /not a server dropping requests/);
});

/** One paragraph out of the report, so a negative assertion names the prose it judges. */
function paragraphAbout(markdown, code) {
  const found = markdown.split('\n').find((line) => line.startsWith(`\`${code}\` below`));
  assert.ok(found, `no paragraph rendered for \`${code}\``);
  return found;
}

test('non-retryable-transport claims a retry decision, never that a peer was or was not reached', () => {
  // Scoped to the paragraph, not the whole report. The sibling `shape-rejected`
  // paragraph legitimately says "never reached the wire" about the CLIENT's own
  // outbound request, so a report-wide negative here fails on innocent prose and
  // names this paragraph for it.
  const para = paragraphAbout(renderWith('non-retryable-transport'), 'non-retryable-transport');
  assert.match(para, /before any response was obtained/);
  // The claim that was WRONG and had to be withdrawn: `ENOTFOUND` and
  // `ECONNREFUSED` are outside the transient whitelist, so they carry this
  // reason — and they reached no peer at all. Saying "not a reachability
  // finding" of the whole code asserted a fact that is false of part of it.
  assert.doesNotMatch(para, /not a reachability finding/);
  assert.match(para, /ENOTFOUND/, 'the exceptions must be named, not generalised away');
  assert.match(para, /ECONNREFUSED/);
  assert.doesNotMatch(para, /was unreachable|unreachable host|server was down|could not reach/);
});

test('the transport disclaimer prints for a transport-only sweep, which is when it is needed', () => {
  // The defect this locks out: the disclaimer used to live inside the
  // `non-retryable-transport` block, so a sweep of pre-response EAI_AGAIN or
  // ECONNRESET — every one of them tagged `transport` — printed a bare row with
  // nothing anywhere forbidding the server-blame reading.
  const para = paragraphAbout(renderWith('transport'), 'transport');
  assert.match(para, /not\*\* a count of server misbehaviour|not a count of server misbehaviour/);
  assert.match(para, /EAI_AGAIN/);
  assert.doesNotMatch(para, /non-retryable-transport/, 'it must stand on its own code, not a neighbour\'s');
});

// Three drafts of this paragraph tried to tell the reader where the underlying
// error code could be found, and review refuted all three. The last is why the
// promise is gone rather than reworded: whether a dead run's message names the
// code depends entirely on the error, and the paragraph's own examples are the
// ones where it does not. So the paragraph may claim only what the attempt
// record holds, and these two fixtures are the pair that proves the difference —
// the second is the shape the first was, in effect, chosen to avoid.
for (const [shape, error] of [
  ['a syscall error, whose Node message embeds the code', 'Request to localhost:1234 failed: connect EHOSTUNREACH 10.0.0.1:1234'],
  // The real TLS wording, per tests/transport-classification.test.js — code
  // CERT_HAS_EXPIRED, message "certificate has expired", which names no code.
  ['a TLS rejection, whose message names no code at all', 'Request to localhost:1234 failed: certificate has expired'],
]) {
  test(`the non-retryable-transport paragraph promises nothing about the cause — ${shape}`, () => {
    const run = deadRunWith('non-retryable-transport');
    run.error = error;
    const markdown = renderReport([{ caseDef: CASE, runs: [run] }], {
      runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
    });

    const para = paragraphAbout(markdown, 'non-retryable-transport');
    assert.doesNotMatch(para, /not carried in this report/, 'refuted draft 2');
    assert.doesNotMatch(para, /names the underlying code|read `?\.code/, 'refuted drafts 1 and 3');
    // It may say what the record holds, and that is all.
    assert.match(para, /the reason code is all an attempt record carries/);
    // The listing is a real section of the same document — asserted against the
    // document, not against the paragraph the phrase came from.
    assert.match(markdown, /^## Logical runs that did not complete$/m);
  });
}

test('the shape-rejected paragraph follows the refused one it calls itself the twin of', () => {
  // The combination OAI-26 was written for, and the one the gates make easy to
  // get wrong: the paragraph names `refused` because both are gated, so ORDER is
  // what makes the pair readable rather than a forward reference to prose that
  // may not print at all.
  const refused = {
    index: 1, cause: { answerAttempt: 1, degrade: null }, warmEligible: false, waitedMs: 0,
    outcome: 'refused', reason: null, prefillMs: null, generationMs: null,
  };
  const run = deadRunWith('shape-rejected');
  run.attempts = [refused, failedAttempt('shape-rejected')];
  const markdown = renderReport([{ caseDef: CASE, runs: [run] }], {
    runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
  });

  const refusedAt = markdown.indexOf('refused for their shape');
  const twinAt = markdown.indexOf('terminal twin of the `refused` outcome');
  assert.ok(refusedAt > -1 && twinAt > -1, 'both paragraphs print');
  assert.ok(refusedAt < twinAt, 'the twin reference must point BACKWARDS at printed prose');
});

test('a sweep explains only the codes it actually saw — a results section, not a glossary', () => {
  const markdown = renderWith('transport');
  assert.match(markdown, /\| `transport` \| 1 \|/, 'the failure itself is still counted');
  assert.doesNotMatch(markdown, /shape-rejected/);
  assert.doesNotMatch(markdown, /`non-retryable-transport` below/);
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
