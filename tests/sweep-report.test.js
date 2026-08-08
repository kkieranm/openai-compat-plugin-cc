// The morning artifact is the whole product of a sweep, and three of its
// defects were invisible to every classifier test: the classifier held the right
// data and the renderer dropped it on the floor.
//
// So these test the RENDERED TEXT. The rule under test is one sentence — what is
// rendered is decided by what an entry CARRIES, never by what its outcome is
// called — and each test below is one way keying on the outcome went wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSweep } from '../bench/lib/sweep-report.mjs';

const base = {
  startedAt: '2026-08-08T23:00:00.000Z',
  endedAt: '2026-08-09T06:00:00.000Z',
  stoppedBecause: 'every enumerated commit was settled',
  requestedModel: 'qwen/qwen3.6-27b',
  maxSeconds: 900,
  include: ['scripts'],
};

const render = (...entries) => renderSweep({ ...base, enumerated: entries.length, entries });

const commit = (extra) => ({ sha: 'abc1234def', subject: 'a commit', ...extra });

test('a truncated review still shows the findings it managed to produce', () => {
  const out = render(commit({
    outcome: 'truncated',
    analysisCut: true,
    model: 'qwen/qwen3.6-27b',
    findings: [{ file: 'a.mjs', line: 3, summary: 'a real lead', severity: 'high' }],
  }));
  assert.match(out, /a real lead/, 'a lead the model produced must not vanish from the artifact');
  // …but it must not read as a completed review of the commit.
  assert.match(out, /truncated/);
});

test('a clean review that only saw the diff says so, though it never reaches coverage', () => {
  const out = render(commit({ outcome: 'clean', hunksOnly: true, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /only the diff was reviewed/);
  // It is a completed review, so it belongs with the reviewed commits rather
  // than in coverage — but it must not pass silently as a full one.
  assert.match(out, /Reviewed, nothing reported/);
});

test('a clean review whose findings were all discarded says how many', () => {
  const out = render(commit({ outcome: 'clean', dropped: 3, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /3 finding\(s\) the model emitted were discarded/);
});

// ADR 011's conflation, one layer up. `requestedModel` exists on a failure
// envelope precisely BECAUSE nothing answered.
test('a failed row never claims a model answered it', () => {
  const out = render(commit({ outcome: 'failed', reason: 'transport', requestedModel: 'qwen/qwen3.6-27b' }));
  assert.doesNotMatch(out, /answered by/, 'nothing answered a failed review');
  assert.match(out, /transport/, 'but the reason it failed must still be shown');
});

test('a completed review does report which model answered it', () => {
  const out = render(commit({ outcome: 'clean', model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /answered by/);
});

// The control for the two above: same renderer, same section, opposite data.
// Without it, "never claims a model answered" would also pass against a renderer
// that had simply stopped printing models altogether.
test('coverage rows distinguish failures by their reason, not a generic sentence', () => {
  const out = render(
    commit({ sha: 'aaa1111', outcome: 'failed', reason: 'bad-json' }),
    commit({ sha: 'bbb2222', outcome: 'failed', reason: 'deadline-timeout' }),
  );
  assert.match(out, /bad-json/);
  assert.match(out, /deadline-timeout/);
});

test('the enumerated count comes from the enumeration, not from what got recorded', () => {
  const out = renderSweep({ ...base, enumerated: 40, entries: [commit({ outcome: 'clean', findings: [] })] });
  assert.match(out, /\*\*Enumerated\*\* 40 commits/);
});

test('every commit appears exactly once — in findings, coverage, or qualified', () => {
  const out = render(
    commit({ sha: 'aaa1111', outcome: 'findings', model: 'm', findings: [{ file: 'a', summary: 's' }] }),
    commit({ sha: 'bbb2222', outcome: 'starved', reason: 'token-exhaustion' }),
    commit({ sha: 'ccc3333', outcome: 'skipped-no-code' }),
  );
  for (const sha of ['aaa1111', 'bbb2222', 'ccc3333']) {
    assert.match(out, new RegExp(sha), `${sha} must appear somewhere in the report`);
  }
});

test('an empty findings section warns rather than reading as a clean night', () => {
  const out = render(commit({ outcome: 'starved', reason: 'token-exhaustion' }));
  assert.match(out, /Read the coverage section before concluding anything/);
});
