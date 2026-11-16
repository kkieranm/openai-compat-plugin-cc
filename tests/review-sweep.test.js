// The overnight sweep runs while nobody is watching, so every claim it makes in
// the morning has to survive being read cold. These tests drive the whole loop
// with injected executor, clock and git reader — no model and no waiting. The
// enumeration and pin tests replay the git calls they recorded through real git.
//
// The classification tests carry most of the weight. On this hardware a review
// that starved for tokens and a review that found nothing both end
// with no findings, and the whole value of the report is that it refuses to say
// those are the same thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enumerateCommits, optionsFrom, runSweep } from '../bench/review-sweep.mjs';
import { resolveDeadline } from '../bench/lib/sweep-window.mjs';
import { resolvePin } from '../bench/lib/sweep-window.mjs';
import { classify, serverUnwell } from '../bench/lib/sweep-outcome.mjs';
import { UserError } from '../plugins/oai/scripts/lib/errors.mjs';
import { createRepo, git, tempDir } from './helpers.mjs';

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

// The same starvation, caught earlier by a live watchdog instead of
// the server's own terminal finish_reason — an UNSALVAGED cutoff is the same
// outcome as token-exhaustion, not a generic failure.
test('an unsalvaged token-reserve-cutoff is starved too, alongside token-exhaustion', () => {
  const entry = classify(envelope('token-reserve-cutoff'));
  assert.equal(entry.outcome, 'starved');
  assert.equal(entry.reason, 'token-reserve-cutoff');
});

// The same starvation, discovered post-hoc rather than via a live cutoff — a
// clean stream that never left its reasoning channel. An UNSALVAGED
// reasoning-only failure is starved too, not a generic failure.
test('an unsalvaged reasoning-only is starved too, alongside token-exhaustion', () => {
  const entry = classify(envelope('reasoning-only'));
  assert.equal(entry.outcome, 'starved');
  assert.equal(entry.reason, 'reasoning-only');
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
// the cap governs whether to BEGIN — the same discipline awaitTurn keeps in
// job-queue.mjs.
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

const revisionOf = (args) => (args.includes('--') ? args[args.indexOf('--') - 1] : args[args.length - 1]);

const gitStub = (log, paths) => (args) => {
  if (args[0] === 'log' && args.includes('--format=%H')) return log.join('\n');
  if (args[0] === 'log') return `subject for ${revisionOf(args)}`;
  assert.ok(args.includes('-z'), `a path listing must be NUL-delimited: ${args.join(' ')}`);
  return (paths[revisionOf(args)] ?? []).join('\0');
};

test('a commit is classified by its paths as stored, neither split at a newline nor trimmed', () => {
  const found = enumerateCommits(
    { include: ['scripts'], maxCommits: 5, scanLimit: 10 },
    gitStub(['c1', 'c2'], { c1: ['docs/x\nscripts/y.mjs'], c2: [' scripts/a.mjs'] }),
  );
  assert.deepEqual(found.map((commit) => commit.eligible), [false, false]);
});

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

// enumerateCommits reads git synchronously and tests may not spawn synchronously,
// so its calls are recorded against a stub, replayed unchanged through real git,
// and then answered from what real git said.
test('enumeration runs beside root files named after the commits it walks', async () => {
  const dir = await createRepo();
  const seed = (await git(['rev-parse', 'HEAD'], dir)).trim();
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts', 'a.mjs'), 'a\n');
  await git(['add', 'scripts'], dir);
  await git(['commit', '--quiet', '-m', 'add a script'], dir);
  const tip = (await git(['rev-parse', 'HEAD'], dir)).trim();
  for (const id of [tip, seed]) writeFileSync(join(dir, id), 'a file named after a commit\n');
  const options = { include: ['scripts'], maxCommits: 5, scanLimit: 10, from: tip };

  const recorded = [];
  enumerateCommits(options, (args) => {
    recorded.push(args);
    if (args[0] === 'log' && args.includes('--format=%H')) return `${tip}\n${seed}`;
    return args[0] === 'log' ? 'subject' : '';
  });
  assert.equal(recorded.length, 5, 'the history walk, then a subject and a path listing for each commit');

  const answers = new Map(await Promise.all(recorded.map(async (args) => [JSON.stringify(args), await git(args, dir)])));
  const found = enumerateCommits(options, (args) => {
    const key = JSON.stringify(args);
    assert.ok(answers.has(key), `a git call the recording did not make: ${args.join(' ')}`);
    return answers.get(key);
  });

  assert.deepEqual(found, [
    { sha: tip, subject: 'add a script', eligible: true },
    { sha: seed, subject: 'seed', eligible: false },
  ]);
});

const ID40 = 'a'.repeat(40);
const ID64 = 'b'.repeat(64);
const firstCall = (from) => ['-c', 'core.disambiguate=committish', 'rev-parse', '--verify', from];

// resolvePin reads git synchronously too, so each call it makes is run through
// real git and answered on a later pass from what real git said: its stdout, or
// its rejection rethrown. A call with no answer yet ends that pass; resolvePin's
// catch turns the throw into a refusal, which is discarded. The calls are checked
// after resolvePin returns, because anything thrown inside the replay would be
// caught and read as the expected refusal.
async function pinThroughRealGit(from, dir) {
  const answers = new Map();
  for (let pass = 0; pass < 3; pass += 1) {
    const calls = [];
    let unanswered = null;
    let outcome;
    try {
      outcome = {
        value: resolvePin(from, (args) => {
          calls.push(args);
          const answer = answers.get(JSON.stringify(args));
          if (!answer) {
            unanswered = args;
            throw new Error('not yet run through git');
          }
          if (answer.error) throw answer.error;
          return answer.stdout;
        }),
      };
    } catch (error) {
      outcome = { error };
    }
    if (!unanswered) return { ...outcome, calls };
    answers.set(JSON.stringify(unanswered), await git(unanswered, dir).then((stdout) => ({ stdout }), (error) => ({ error })));
  }
  assert.fail(`resolvePin kept making new git calls for ${from}`);
}

const refusedFor = (from) => (error) => error instanceof UserError && error.message === `--from did not resolve to a commit: "${from}".`;

test('a --from is pinned to the one commit it names, or refused, through real git', async () => {
  const dir = await createRepo();
  const seed = (await git(['rev-parse', 'HEAD'], dir)).trim();
  writeFileSync(join(dir, 'next.txt'), 'next\n');
  await git(['add', 'next.txt'], dir);
  await git(['commit', '--quiet', '-m', 'next'], dir);
  const tip = (await git(['rev-parse', 'HEAD'], dir)).trim();
  await git(['-c', 'tag.gpgSign=false', 'tag', '-a', 'v1', '-m', 'v1', seed], dir);
  for (const name of ['nope', 'HEAD']) writeFileSync(join(dir, name), 'a file named like a revision\n');
  const named = async (from) => (await git(['rev-parse', '--verify', from], dir)).trim();

  // `:/seed|.` matches the newest commit; with `^{commit}` appended to it the
  // search would be for `seed|.^{commit}` and find seed instead.
  for (const [from, sha] of [['HEAD', tip], ['main', tip], ['v1', seed], [':/seed', seed], [':/seed|.', tip]]) {
    const { value, error, calls } = await pinThroughRealGit(from, dir);
    assert.equal(error, undefined, `${from}: ${error?.message}`);
    assert.equal(value, sha, from);
    assert.deepEqual(calls, [firstCall(from), ['rev-parse', '--verify', `${await named(from)}^{commit}`]], from);
  }
  // Refused at the first step: not one full id.
  for (const from of ['nope', 'HEAD~1..HEAD', '^HEAD~1', 'nosuchref']) {
    const { error, calls } = await pinThroughRealGit(from, dir);
    assert.ok(refusedFor(from)(error), `${from}: ${error?.message}`);
    assert.deepEqual(calls, [firstCall(from)], from);
  }
  // Refused at the second step: one full id, but not a commit.
  for (const from of ['HEAD^{tree}', 'HEAD:seed.txt', '0'.repeat(tip.length)]) {
    const { error, calls } = await pinThroughRealGit(from, dir);
    assert.ok(refusedFor(from)(error), `${from}: ${error?.message}`);
    assert.deepEqual(calls, [firstCall(from), ['rev-parse', '--verify', `${await named(from)}^{commit}`]], from);
  }
});

test('a SHA-256 repository pins its 64-character commit id through real git', async (t) => {
  const dir = tempDir('oai-plugin-sha256-');
  try {
    await git(['init', '--quiet', '--object-format=sha256', '--initial-branch=main'], dir);
  } catch {
    return t.skip('this git cannot create a SHA-256 repository');
  }
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  await git(['-c', 'commit.gpgSign=false', 'commit', '--quiet', '--allow-empty', '-m', 'seed'], dir);
  const head = (await git(['rev-parse', 'HEAD'], dir)).trim();

  const { value, error, calls } = await pinThroughRealGit('HEAD', dir);
  assert.equal(error, undefined, error?.message);
  assert.match(value, /^[0-9a-f]{64}$/);
  assert.equal(value, head);
  assert.deepEqual(calls, [firstCall('HEAD'), ['rev-parse', '--verify', `${head}^{commit}`]]);
});

test('a short id a commit shares with a blob pins the commit, through real git', async (t) => {
  const dir = tempDir('oai-plugin-short-id-');
  try {
    await git(['init', '--quiet', '--object-format=sha1'], dir);
  } catch {
    return t.skip('this git cannot be asked for a SHA-1 repository');
  }
  const objects = tempDir('oai-plugin-short-id-objects-');
  const write = async (type, name, content) => {
    writeFileSync(join(objects, name), content);
    return (await git(['hash-object', '-w', '--no-filters', '-t', type, join(objects, name)], dir)).trim();
  };
  const tree = await write('tree', 'tree', '');
  const commit = await write('commit', 'commit', `tree ${tree}\nauthor Test <test@example.com> 0 +0000\ncommitter Test <test@example.com> 0 +0000\n\nfixed\n`);
  const blob = await write('blob', 'blob', 'collide 95968\n');
  assert.deepEqual([tree, commit, blob], [
    '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    'a898e3b81c4c8ada24fd0e3c11faa861862eeed6',
    'a8982c8a92793cf5a82cb10d5696da4cc273ae2a',
  ]);
  // Exactly these two objects share the prefix, so it names no one object unaided.
  assert.deepEqual((await git(['rev-parse', '--disambiguate=a898'], dir)).split('\n').filter(Boolean).sort(), [blob, commit]);

  const { value, error, calls } = await pinThroughRealGit('a898', dir);
  assert.equal(error, undefined, error?.message);
  assert.equal(value, commit);
  assert.deepEqual(calls, [firstCall('a898'), ['rev-parse', '--verify', `${commit}^{commit}`]]);
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

// Without a pinned start, a commit landing between benchmark arms
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

// The stub CAPTURES what was asked for, so a test can disagree with the call:
// a stub that answers any arguments at all would pass code that dropped the ref
// or the `^{commit}` peel.
const capturingGit = (resolved) => {
  const seen = [];
  const git = (args) => { seen.push(args); return resolved; };
  git.seen = seen;
  return git;
};

// …and the failure stub THROWS, because that is what git does: `rev-parse` on an
// unknown revision exits 128, so `execFileSync` throws.
const throwingGit = () => { throw new Error('Command failed: git rev-parse'); };

test('the requested ref and the commit peel both reach git', () => {
  const git = capturingGit(`${ID40}\n`);
  assert.equal(resolvePin('main', git), ID40);
  assert.deepEqual(git.seen, [firstCall('main'), ['rev-parse', '--verify', `${ID40}^{commit}`]]);
});

// Without `^{commit}` an annotated tag resolves to the TAG object, and the
// recorded window would be a SHA no `git log` walk starts at.
test('the peel is what makes a tag resolve to its commit', () => {
  const git = capturingGit(`${ID40}\n`);
  resolvePin('v1.2.3', git);
  assert.ok(git.seen.at(-1).at(-1).endsWith('^{commit}'), `no commit peel in ${git.seen.at(-1).at(-1)}`);
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

// The other way to fail: git exits 0 but prints something other than one id.
test('only one full commit id is pinned from what git printed', () => {
  assert.equal(resolvePin('main', capturingGit(`${ID40}\n`)), ID40);
  assert.equal(resolvePin('main', capturingGit(`  ${ID64}\n`)), ID64);
  for (const out of ['', '\n', 'abc123def456\n', `${ID40}0\n`, `${'A'.repeat(40)}\n`, `^${ID40}\n`, 'nope^{commit}\n', `${ID40}\n${ID40}\n`, `${ID40} extra\n`]) {
    assert.throws(() => resolvePin('main', capturingGit(out)), /did not resolve/, JSON.stringify(out));
  }
});

// Each answer is checked on its own: a first step that resolved does not let a
// failing or malformed second one through, and a malformed first answer is
// refused even when its peel would print one id.
test('the peeled commit is checked as closely as the first resolution', () => {
  const answering = (...outs) => () => {
    const out = outs.shift();
    if (out instanceof Error) throw out;
    return out;
  };
  assert.equal(resolvePin('v1', answering(`${ID40}\n`, `${ID64}\n`)), ID64);
  for (const second of [new Error('Command failed: git rev-parse'), '', `^${ID40}\n`, `${ID40}\n${ID40}\n`, 'nope\n']) {
    assert.throws(() => resolvePin('v1', answering(`${ID40}\n`, second)), /did not resolve/, String(second));
  }
  for (const first of ['', `^${ID40}\n`, `${ID40}\n${ID40}\n`, 'nope\n']) {
    assert.throws(() => resolvePin('v1', answering(first, `${ID40}\n`)), /did not resolve/, `first ${first}`);
  }
});
