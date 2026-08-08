// What one finished review MEANS — the classifier, on its own.
//
// Split from `review-sweep.test.js` when that file reached its size budget, and
// the seam is the module seam: `sweep-outcome.mjs` decides what a reply means,
// the harness decides what to do next.
//
// The premise under test: a review that starved for tokens and a review that
// genuinely found nothing are both an empty findings list, and the CLI already
// says which in FIELDS rather than prose. Reading `findings` and none of the
// caveat fields is how the first version of this classifier reported a truncated
// analysis as `clean`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSweep } from '../bench/review-sweep.mjs';
import { classify, serverUnwell } from '../bench/lib/sweep-outcome.mjs';

const ok = (findings, extra = {}) => ({
  status: 0,
  stdout: JSON.stringify({ parsed: true, findings, model: 'test-model', requestedModel: 'test-model', ...extra }),
});

const envelope = (reason, extra = {}) => ({
  status: 1,
  stdout: JSON.stringify({ error: true, reason, message: 'it went wrong', ...extra }),
});

const OPTIONS = { deadline: Infinity, maxSeconds: 900, maxAttempts: 3, abortAfter: 3 };
const commits = (...shas) => shas.map((sha) => ({ sha, subject: `subject ${sha}`, eligible: true }));

// The defect this whole feature exists to prevent, committed in its own
// classifier: `analysisCut` is the CLI's word for "the model never finished
// looking", and reading only `findings` called that a clean review.
test('a truncated analysis is NOT clean, even with a well-formed empty findings list', () => {
  const entry = classify(ok([], { analysisCut: true }));
  assert.equal(entry.outcome, 'truncated');
  assert.notEqual(entry.outcome, 'clean');
});

test('a truncated analysis is not findings either, however much it managed to say', () => {
  assert.equal(classify(ok([{ file: 'a.mjs', summary: 'x' }], { analysisCut: true })).outcome, 'truncated');
});

// atCap and dropped do NOT demote a review — findings were produced — but both
// mean the list is shorter than what the model had to say.
test('atCap and dropped ride along without demoting a real review', () => {
  const entry = classify(ok([{ file: 'a.mjs', summary: 'x' }], { atCap: true, dropped: 2 }));
  assert.equal(entry.outcome, 'findings');
  assert.equal(entry.atCap, true);
  assert.equal(entry.dropped, 2);
});

test('hunksOnly is carried, because it falsifies "the files were reviewed whole"', () => {
  assert.equal(classify(ok([], { hunksOnly: true })).hunksOnly, true);
});

// The measured dominant outage on this hardware (27/72 runs). Omitting these
// meant the guard could not fire on the one shape it was written for.
test('the completion shapes count as the server being unwell', () => {
  for (const reason of ['empty-completion', 'stream-unfinished', 'blank-completion']) {
    assert.equal(serverUnwell(reason), true, reason);
  }
});

// NARROWED at pass 2. This test previously asserted that ANY `*-timeout`
// counts, which is what made the guard abort healthy sweeps: `first-byte-timeout`
// is what a large prompt looks like while the server ingests it, and
// `http-errors.mjs` advises raising the timeout rather than reporting a death.
test('only the timeouts that mean the server stopped producing count', () => {
  assert.equal(serverUnwell('deadline-timeout'), true);
  assert.equal(serverUnwell('idle-timeout'), true);
  assert.equal(serverUnwell('first-byte-timeout'), false);
});

// The control for the two above: starvation is the MODEL's budget, not the
// server's health, so three large commits must never read as an outage.
test('starvation and input refusals are NOT the server being unwell', () => {
  assert.equal(serverUnwell('token-exhaustion'), false);
  assert.equal(serverUnwell('oversize'), false);
});

test('a stream-drop outage trips the fail-fast, which it previously could not', () => {
  const { entries, stoppedBecause } = runSweep(commits('a', 'b', 'c', 'd', 'e'), OPTIONS, {
    execute: () => envelope('empty-completion'),
  });
  assert.match(stoppedBecause, /server looks gone/);
  assert.equal(entries.filter((entry) => entry.outcome === 'failed').length, 3);
});

// A wrong --model is the likeliest unattended misconfiguration, and it produces
// a failure envelope with no reason at all.
test('a failure envelope with no reason still trips the fail-fast', () => {
  const { stoppedBecause } = runSweep(commits('a', 'b', 'c', 'd'), OPTIONS, {
    execute: () => ({ status: 1, stdout: JSON.stringify({ error: true, message: 'no such model' }) }),
  });
  assert.match(stoppedBecause, /server looks gone/);
});

// Aborting must never shorten the record: an outage is exactly when the reader
// most needs the list of what went unreviewed.
test('every enumerated commit survives an abort, as skipped-abort', () => {
  const { entries } = runSweep(commits('a', 'b', 'c', 'd', 'e'), OPTIONS, { execute: () => envelope('transport') });
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.slice(3).map((entry) => entry.outcome), ['skipped-abort', 'skipped-abort']);
});

test("the harness's own capture limit is not reported as the child dying", () => {
  const entry = classify({ status: null, stdout: 'partial', code: 'ENOBUFS' });
  assert.equal(entry.outcome, 'output-too-large');
  assert.notEqual(entry.outcome, 'crashed');
});

test('the raw reply is retained for the machine record, and truncation is recorded', () => {
  assert.equal(classify(ok([])).rawTruncated, false);
  const huge = { status: 0, stdout: `${'x'.repeat(300_000)}` };
  assert.equal(classify(huge).rawTruncated, true);
  assert.equal(classify(huge).raw.length, 256_000);
});


// --- pass 2 batch: what the entry CARRIES, not what its outcome is called ---

// A truncated review is not a review of the commit — but the leads it did emit
// are still leads, and the first fix dropped them from the morning artifact.
test('a truncated review keeps the findings it produced', () => {
  const entry = classify(ok([{ file: 'a.mjs', summary: 'real lead' }], { analysisCut: true }));
  assert.equal(entry.outcome, 'truncated');
  assert.equal(entry.findings.length, 1);
});

// The reproduced crash: a non-string reason threw out of runSweep and erased
// every commit that had not been reached.
test('a non-string reason cannot crash the sweep or erase later commits', () => {
  assert.equal(serverUnwell({ kind: 'timeout' }), false);
  const { entries } = runSweep(commits('a', 'b', 'c'), OPTIONS, {
    execute: () => ({ status: 1, stdout: JSON.stringify({ error: true, reason: { kind: 'timeout' } }) }),
  });
  assert.equal(entries.length, 3);
});

// first-byte-timeout is what a LARGE PROMPT looks like, not a dead server —
// http-errors.mjs says so and advises raising the timeout.
test('a slow first byte is not the server being unwell', () => {
  assert.equal(serverUnwell('first-byte-timeout'), false);
  assert.equal(serverUnwell('deadline-timeout'), true);
  assert.equal(serverUnwell('idle-timeout'), true);
});

test('stderr is bounded too, and its truncation is recorded separately', () => {
  const entry = classify({ status: 1, stdout: '', stderr: 'x'.repeat(300_000) });
  assert.equal(entry.stderrTruncated, true);
  assert.equal(entry.stderr.length, 256_000);
  assert.equal(entry.rawTruncated, false, 'a small stdout must not mask a truncated stderr');
});

test('a signal-killed child is distinguishable from an ordinary crash', () => {
  assert.equal(classify({ status: null, stdout: '', signal: 'SIGKILL' }).signal, 'SIGKILL');
  assert.equal(classify({ status: 1, stdout: '' }).signal, null);
});

// ADR 011's conflation, one layer up: nothing answered, so nothing may be
// reported as having answered.
test('a failed run reports no answering model, only the one it asked for', () => {
  const entry = classify({ status: 1, stdout: JSON.stringify({ error: true, reason: 'transport', requestedModel: 'qwen/qwen3.6-27b' }) });
  assert.equal(entry.model, undefined, 'a failed run had nothing answer it');
  assert.equal(entry.requestedModel, 'qwen/qwen3.6-27b');
});

// The harness's own capture ceiling must not be diagnosed as the server dying.
test('the capture limit never trips the outage abort', () => {
  const { entries, stoppedBecause } = runSweep(commits('a', 'b', 'c', 'd'), OPTIONS, {
    execute: () => ({ status: null, stdout: 'partial', code: 'ENOBUFS' }),
  });
  assert.equal(entries.length, 4);
  assert.ok(entries.every((entry) => entry.outcome === 'output-too-large'));
  assert.equal(stoppedBecause, 'every enumerated commit was settled');
});

test('an ineligible commit after an abort is skipped-no-code, not blamed on the outage', () => {
  const mixed = [...commits('a', 'b', 'c'), { sha: 'd', subject: 'docs', eligible: false }, ...commits('e')];
  const { entries } = runSweep(mixed, OPTIONS, { execute: () => envelope('transport') });
  assert.equal(entries[3].outcome, 'skipped-no-code');
  assert.equal(entries[4].outcome, 'skipped-abort');
});
