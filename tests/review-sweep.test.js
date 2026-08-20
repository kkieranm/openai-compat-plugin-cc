// The overnight sweep runs while nobody is watching, so every claim it makes in
// the morning has to survive being read cold. These tests drive the whole loop
// with injected executor, clock and git reader — no model, no child process, no
// waiting — which is the seam `bench/task-run.mjs` established precisely because
// `bench/run.mjs` cannot be imported and therefore has no test at all.
//
// The classification tests carry most of the weight. On this hardware a review
// that starved for tokens (OAI-115) and a review that found nothing both end
// with no findings, and the whole value of the report is that it refuses to say
// those are the same thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateCommits, optionsFrom, runSweep } from '../bench/review-sweep.mjs';
import { resolveDeadline } from '../bench/lib/sweep-window.mjs';
import { resolvePin } from '../bench/lib/sweep-window.mjs';
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

test('a review that reported defects is findings, and they are carried through', () => {
  const entry = classify(ok([{ file: 'a.mjs', line: 3, summary: 'a defect' }]));
  assert.equal(entry.outcome, 'findings');
  assert.equal(entry.findings.length, 1);
  assert.equal(entry.model, 'test-model');
});

test('an empty findings ARRAY is clean — the model read it and reported nothing', () => {
  assert.equal(classify(ok([])).outcome, 'clean');
});

// The pair that matters most, and the distinction that must be protected.
// `null` means the reply could not be read; `[]` means it was read and was
// empty. Collapsing them turns an unreadable night into a clean one.
test('a null findings list is UNREADABLE, never clean', () => {
  assert.equal(classify(ok(null, { parsed: false })).outcome, 'unreadable');
});

test('a token-exhausted run is starved, read off the reason field rather than the prose', () => {
  const entry = classify(envelope('token-exhaustion'));
  assert.equal(entry.outcome, 'starved');
  assert.equal(entry.reason, 'token-exhaustion');
});

// OAI-115: the same starvation, caught earlier by a live watchdog instead of
// the server's own terminal finish_reason — an UNSALVAGED cutoff is the same
// outcome as token-exhaustion, not a generic failure.
test('an unsalvaged token-reserve-cutoff is starved too, alongside token-exhaustion', () => {
  const entry = classify(envelope('token-reserve-cutoff'));
  assert.equal(entry.outcome, 'starved');
  assert.equal(entry.reason, 'token-reserve-cutoff');
});

test('any other failure envelope is failed, and keeps its reason for the report', () => {
  const entry = classify(envelope('transport'));
  assert.equal(entry.outcome, 'failed');
  assert.equal(entry.reason, 'transport');
});

// A substituted model answers perfectly well. Counted as `findings` it would
// attribute one model's review to another — which matters precisely because
// switching models to compare them is a thing this harness is for.
test('a different model answering is substituted, not a review by the model asked for', () => {
  const entry = classify(ok([{ file: 'a.mjs', summary: 'x' }], { model: 'other-model', requestedModel: 'test-model' }));
  assert.equal(entry.outcome, 'substituted');
});

test('a child that died without emitting an envelope is crashed, not clean', () => {
  assert.equal(classify({ status: 1, stdout: '' }).outcome, 'crashed');
  assert.equal(classify({ status: 139, stdout: 'Segmentation fault' }).outcome, 'crashed');
});

test('unparseable output from a child that exited 0 is unreadable, and never throws', () => {
  assert.equal(classify({ status: 0, stdout: 'not json at all' }).outcome, 'unreadable');
});

test('an ineligible commit is recorded as skipped, never silently dropped', () => {
  const { entries } = runSweep(
    [{ sha: 'aaa', subject: 'docs only', eligible: false }],
    OPTIONS,
    { execute: () => assert.fail('an ineligible commit must not be reviewed') },
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].outcome, 'skipped-no-code');
});

test('the deadline stops work being STARTED, and the rest are recorded as skipped', () => {
  let clock = 0;
  const { entries, stoppedBecause } = runSweep(commits('a', 'b', 'c'), { ...OPTIONS, deadline: 100 }, {
    // Each review costs 60; the second one therefore ends past the deadline.
    execute: () => { clock += 60; return ok([]); },
    now: () => clock,
  });
  assert.deepEqual(entries.map((entry) => entry.outcome), ['clean', 'clean', 'skipped-deadline']);
  assert.match(stoppedBecause, /deadline/);
});

// The review already running when the deadline passes is finished, not killed:
// the cap governs whether to BEGIN. Overshoot is bounded by --max-seconds
// instead, which is the same discipline awaitTurn keeps in job-queue.mjs.
test('a review already in flight when the deadline passes is not truncated', () => {
  let clock = 0;
  const { entries } = runSweep(commits('a'), { ...OPTIONS, deadline: 10 }, {
    execute: () => { clock += 5000; return ok([{ file: 'a.mjs', summary: 'found late' }]); },
    now: () => clock,
  });
  assert.equal(entries[0].outcome, 'findings');
});

test('consecutive transport failures abort the sweep rather than burning the night', () => {
  const executed = [];
  const { entries, stoppedBecause } = runSweep(commits('a', 'b', 'c', 'd', 'e'), OPTIONS, {
    execute: (args) => { executed.push(args); return envelope('transport'); },
  });
  // Three reviews attempted, then no more — the point of aborting.
  assert.equal(executed.length, 3);
  // …but all five commits are still in the record. Asserting `entries.length`
  // was 3 here is what let the truncating `break` look correct.
  assert.equal(entries.length, 5);
  assert.match(stoppedBecause, /server looks gone/);
});

// Without the reset a sweep that failed twice at 01:00 and then ran happily for
// hours would abort on its next single blip.
test('the transport failure counter resets on any success', () => {
  const script = [envelope('transport'), envelope('transport'), ok([]), envelope('transport'), envelope('transport')];
  let call = 0;
  const { entries, stoppedBecause } = runSweep(commits('a', 'b', 'c', 'd', 'e'), OPTIONS, {
    execute: () => script[call++],
  });
  assert.equal(entries.length, 5);
  assert.equal(stoppedBecause, 'every enumerated commit was settled');
});

// A starved run is not the server's fault, so it must not trip the fail-fast.
// Otherwise three big commits in a row would look like an outage and end a sweep
// that was working exactly as designed.
test('starvation does not count as a transport failure', () => {
  const { entries } = runSweep(commits('a', 'b', 'c', 'd'), OPTIONS, { execute: () => envelope('token-exhaustion') });
  assert.equal(entries.length, 4);
  assert.ok(entries.every((entry) => entry.outcome === 'starved'));
});

const gitStub = (log, paths) => (args) => {
  if (args[0] === 'log' && args.includes('--format=%H')) return log.join('\n');
  if (args[0] === 'log') return `subject for ${args[args.length - 1]}`;
  return (paths[args[args.length - 1]] ?? []).join('\n');
};

test('--max-commits counts ELIGIBLE commits, not the documentation walked past', () => {
  const found = enumerateCommits(
    { include: ['scripts'], maxCommits: 2, scanLimit: 100 },
    gitStub(['c1', 'c2', 'c3', 'c4', 'c5'], {
      c1: ['HANDOVER.md'], c2: ['BACKLOG.md'], c3: ['scripts/lib/a.mjs'], c4: ['plans/x.md'], c5: ['scripts/lib/b.mjs'],
    }),
  );
  // It had to walk past three doc commits to find two eligible ones — and it
  // kept them, so the report can say they were passed over.
  assert.equal(found.filter((commit) => commit.eligible).length, 2);
  assert.deepEqual(found.map((commit) => commit.sha), ['c1', 'c2', 'c3', 'c4', 'c5']);
});

test('enumeration stops at the scan limit rather than walking all of history', () => {
  const found = enumerateCommits(
    { include: ['scripts'], maxCommits: 10, scanLimit: 2 },
    gitStub(['c1', 'c2'], { c1: ['docs.md'], c2: ['docs.md'] }),
  );
  assert.equal(found.length, 2);
  assert.equal(found.filter((commit) => commit.eligible).length, 0);
});

test('a path is included only on a real segment boundary, not a shared prefix', () => {
  const found = enumerateCommits(
    { include: ['bench'], maxCommits: 5, scanLimit: 10 },
    gitStub(['c1', 'c2'], { c1: ['benchmarks/notes.md'], c2: ['bench/run.mjs'] }),
  );
  assert.deepEqual(found.map((commit) => commit.eligible), [false, true]);
});

test('--until resolves to the NEXT occurrence, so a bedtime 06:00 is tomorrow', () => {
  const elevenPm = new Date(2026, 7, 8, 23, 0, 0).getTime();
  const deadline = resolveDeadline({ until: '06:00' }, elevenPm);
  assert.equal(new Date(deadline).getHours(), 6);
  assert.ok(deadline > elevenPm, 'a deadline in the past would end the sweep before it began');
  assert.ok(deadline - elevenPm < 8 * 3_600_000);
});

test('--minutes is measured from the start', () => {
  assert.equal(resolveDeadline({ minutes: '90' }, 1_000), 1_000 + 90 * 60_000);
});

// A stop condition must not be reachable by omission: an unattended sweep with
// no deadline is not the thing that was asked for.
test('a sweep with no stop condition is refused', () => {
  assert.throws(() => resolveDeadline({}, 0), /stop condition is required/);
  assert.throws(() => resolveDeadline({ until: '06:00', minutes: '10' }, 0), /not both/);
  assert.throws(() => resolveDeadline({ until: '25:00' }, 0), /HH:MM/);
});

test("a crashed child keeps its stderr, the only text that says why", () => {
  assert.equal(classify({ status: 1, stdout: '', stderr: 'ENOENT: no such model' }).stderr, 'ENOENT: no such model');
});

// A fixed 24h and "the next local calendar date" differ by an hour across a DST
// boundary, and the overnight run is precisely what crosses one.
test('--until advances the local calendar date, not a fixed 24 hours', () => {
  const start = new Date(2026, 2, 28, 23, 0, 0).getTime();
  const deadline = new Date(resolveDeadline({ until: '06:00' }, start));
  assert.equal(deadline.getHours(), 6, 'the requested local hour must survive a DST transition');
  assert.equal(deadline.getDate(), 29);
});

// OAI-124: without a pinned start, a commit landing between benchmark arms
// shifts the window and two arms review different work.
test('--from pins where enumeration starts, and defaults to HEAD', () => {
  const seen = [];
  const git = (args) => {
    seen.push(args);
    if (args[0] === 'log' && args.includes('--format=%H')) return 'c1';
    if (args[0] === 'log') return 'subject';
    return 'scripts/a.mjs';
  };
  enumerateCommits({ include: ['scripts'], maxCommits: 1, scanLimit: 10, from: 'deadbeef' }, git);
  assert.ok(seen[0].includes('deadbeef'), 'the revision must reach git log');

  seen.length = 0;
  enumerateCommits({ include: ['scripts'], maxCommits: 1, scanLimit: 10 }, git);
  assert.ok(seen[0].includes('HEAD'), 'and HEAD is the default');
});

// --- pass-1 batch: an auditable window, and a run that admits it fell short ---

// The stub CAPTURES what was asked for. The previous one returned its configured
// SHA for any arguments at all, so hardcoding the call to `['rev-parse','HEAD']`
// — dropping both the ref and the `^{commit}` peel — left the suite green. A
// stub that cannot disagree with the code is not a test.
const capturingGit = (resolved) => {
  const seen = [];
  const git = (args) => { seen.push(args); return resolved; };
  git.seen = seen;
  return git;
};

// …and the failure stub THROWS, because that is what git does: `rev-parse` on an
// unknown revision exits 128, so `execFileSync` throws. A stub returning empty
// string was gentler than reality and made the refusal below unreachable in
// production while the test stayed green.
const throwingGit = () => { throw new Error('Command failed: git rev-parse'); };

test('the requested ref and the commit peel both reach git', () => {
  const git = capturingGit('abc123def456\n');
  assert.equal(resolvePin('main', git), 'abc123def456');
  assert.deepEqual(git.seen[0], ['rev-parse', 'main^{commit}']);
});

// Without `^{commit}` an annotated tag resolves to the TAG object, and the
// recorded window would be a SHA no `git log` walk starts at.
test('the peel is what makes a tag resolve to its commit', () => {
  const git = capturingGit('deadbeef\n');
  resolvePin('v1.2.3', git);
  assert.ok(git.seen[0][1].endsWith('^{commit}'), `no commit peel in ${git.seen[0][1]}`);
});

// A leading dash reaches git as an OPTION, not a revision.
test('a revision that git would read as a flag is refused before it gets there', () => {
  const git = capturingGit('x');
  assert.throws(() => resolvePin('--all', git), /must be a revision/);
  assert.equal(git.seen.length, 0, 'it must be refused BEFORE git is called');
});

test('a revision git rejects is reported as a refusal, not as a raw command failure', () => {
  assert.throws(() => resolvePin('nosuchref', throwingGit), /did not resolve/);
});

// The other way to fail: a git that exits 0 with nothing to say.
test('an empty resolution is refused too', () => {
  assert.throws(() => resolvePin('weird', capturingGit('')), /did not resolve/);
});
