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
  assert.match(out, /reviewed only as hunks/);
  // It is a completed review, so it belongs with the reviewed commits rather
  // than in coverage — but it must not pass silently as a full one.
  assert.match(out, /Reviewed, nothing reported/);
});

test('an unsized-window review says WHY, and never re-asserts a measurement', () => {
  // The two notes are separate on purpose. `hunksOnly` is the state and is
  // equally true of `--diff-only`; this is the cause, and it carries a remedy a
  // reader can act on. A single merged sentence would have to guess at one.
  const out = render(commit({
    outcome: 'clean', hunksOnly: true, skippedUnsizedWindow: true, model: 'qwen/qwen3.6-27b', findings: [],
  }));
  assert.match(out, /reviewed only as hunks/, 'the state');
  assert.match(out, /context window could not be determined/, 'and the cause');
  assert.match(out, /contextLength/, 'and the remedy');
  // The forbidden claim, not merely the required ones. Without this the test stays
  // green if the renderer re-appends "did not fit the window" — a MEASUREMENT nobody
  // took, and the precise error the state/cause split exists to prevent.
  assert.doesNotMatch(out, /did not fit/, 'nothing measured this window');
});

test('the state note is scoped to diff-covered files, not to the whole request', () => {
  // It said "only the diff was reviewed" flatly, which is FALSE for a mixed target:
  // collectTarget can pair diff-covered tracked files with untracked or --file bodies that
  // are sent WHOLE and are never droppable. Found by codex-adversarial at 0.99.
  const out = render(commit({ outcome: 'clean', hunksOnly: true, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /diff-covered changed files were reviewed only as hunks/);
  assert.match(out, /may still have been sent whole/, 'the pinned files are not covered by this note');
});

test('a diff-only review with no cause recorded does not invent one', () => {
  // `--diff-only`, or any older record predating the field. Attributing this to
  // an unsizeable window sends the reader after a config key that would change
  // nothing — the failure mode the state/cause split exists to prevent.
  const out = render(commit({ outcome: 'clean', hunksOnly: true, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /reviewed only as hunks/);
  assert.doesNotMatch(out, /context window could not be determined/);
  assert.doesNotMatch(out, /contextLength/);
});

test('the report-wide caveat never claims every commit was seen whole', () => {
  // It covers every entry, so it has to be true of the worst one. It said "its
  // changed files in full" flatly, which is false for any diff-only row in the
  // same file — and this section is what a reader weeks later believes.
  const out = render(commit({ outcome: 'clean', hunksOnly: true, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /Commit-local leads/);
  assert.doesNotMatch(out, /its changed files in full/);
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

// COUNTS, not presence. Its predecessor asserted `assert.match(out, /sha/)`,
// which one occurrence and ten both satisfy — so it had failure power on absence
// and NONE on duplication, the exact half its name advertised. A positive control
// rendered a sha twice and it stayed green.
//
// The fixture matters as much as the assertion: it must contain a NON-REVIEWED
// entry that carries findings, which is the only shape that can be disposed of
// twice. The old fixture could not produce one, so swapping match for a count
// would still not have caught it.
test('every commit is disposed of exactly once', () => {
  const out = render(
    commit({ sha: 'aaa1111', outcome: 'findings', model: 'm', findings: [{ file: 'a', summary: 's' }] }),
    commit({ sha: 'bbb2222', outcome: 'starved', reason: 'token-exhaustion' }),
    commit({ sha: 'ccc3333', outcome: 'skipped-no-code' }),
    commit({ sha: 'ddd4444', outcome: 'clean', model: 'm', findings: [] }),
    // The shape that broke it: not reviewed, yet carrying real leads.
    commit({ sha: 'eee5555', outcome: 'truncated', analysisCut: true, model: 'm', findings: [{ file: 'b', summary: 'lead' }] }),
    commit({ sha: 'fff6666', outcome: 'substituted', model: 'other', findings: [{ file: 'c', summary: 'lead' }] }),
  );
  for (const sha of ['aaa1111', 'bbb2222', 'ccc3333', 'ddd4444', 'eee5555', 'fff6666']) {
    const seen = out.split(sha.slice(0, 9)).length - 1;
    assert.equal(seen, 1, `${sha} was disposed of ${seen} times, not once`);
  }
});

// …and the leads a disqualified review produced still reach the reader, with the
// same detail a completed review's would. Losing them is what OAI-120 was.
test('a disqualified review still shows what it reported, in full', () => {
  const out = render(commit({
    outcome: 'substituted',
    model: 'other-model',
    hunksOnly: true,
    findings: [{ file: 'a.mjs', line: 7, severity: 'high', summary: 'a real lead', evidence: 'the line' }],
  }));
  assert.match(out, /a real lead/);
  assert.match(out, /a\.mjs:7/);
  assert.match(out, /high/);
  assert.match(out, /the line/);
  assert.match(out, /other-model/);
  assert.match(out, /reviewed only as hunks/);
  assert.match(out, /leads only/);
});

test('an empty findings section warns rather than reading as a clean night', () => {
  const out = render(commit({ outcome: 'starved', reason: 'token-exhaustion' }));
  assert.match(out, /Read the coverage section before concluding anything/);
});

// The window this run walked. Without it the artifact cannot say what it
// enumerated FROM, so two benchmark arms cannot be shown to have reviewed the
// same commits — which is the whole purpose of pinning.
test('the report names the revision it enumerated from', () => {
  const out = renderSweep({ ...base, from: 'abc123def456', enumerated: 1, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.match(out, /Enumerated from.*abc123def456/);
});

// A short arm must not read as a completed one.
test('a run that found fewer commits than asked for says so', () => {
  const short = renderSweep({ ...base, from: 'abc', requestedCommits: 10, eligible: 6, enumerated: 6, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.match(short, /only 6 of the 10 requested commits were eligible/);

  const full = renderSweep({ ...base, from: 'abc', requestedCommits: 10, eligible: 10, enumerated: 10, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.doesNotMatch(full, /requested commits were eligible/, 'a complete run must not carry the warning');
});

// F1: one attribution per commit, not two. The old tests asserted the string was
// PRESENT, which one occurrence and two both satisfy.
test('a coverage row carrying findings names the answering model exactly once', () => {
  const out = render(commit({
    outcome: 'substituted', model: 'other-model',
    findings: [{ file: 'a.mjs', line: 7, summary: 'a lead' }],
  }));
  assert.equal(out.split('other-model').length - 1, 1, 'the model was named more than once for one commit');
});

// L1: the sentence must name WHICH cause applied. A pinned start makes "the
// history simply ran out" routine, and blaming the scan limit sends a reader to
// tune a knob that was never the constraint.
test('a shortfall names the cause the record supports', () => {
  const ranOut = renderSweep({ ...base, from: 'abc', requestedCommits: 10, eligible: 5, scanLimit: 200, walked: 12, enumerated: 12, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.match(ranOut, /only 12 commits are reachable from that revision/);
  assert.doesNotMatch(ranOut, /scan-limit/, 'the scan limit was never approached');

  const hitLimit = renderSweep({ ...base, from: 'abc', requestedCommits: 40, eligible: 5, scanLimit: 12, walked: 12, enumerated: 12, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.match(hitLimit, /scan-limit.*12/);
});

// L3: analysisCut is rendered from the ENTRY, so an overridden verdict cannot
// erase it. A substituted model whose analysis was also cut used to lose it.
test('a substituted entry whose analysis was cut still says so', () => {
  const out = render(commit({
    outcome: 'substituted', model: 'other', analysisCut: true,
    findings: [{ file: 'a.mjs', summary: 'a lead' }],
  }));
  assert.match(out, /cut off before the model finished looking/);
});
