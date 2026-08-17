// Recovery, and the one check that matters: a REAL crash.
//
// The temptation is an injected sink asserting it was "called 3 times". That is
// this repo's signature failure — a check that cannot fail on the thing at
// stake, because it proves the loop calls a function, not that a byte reached a
// disk before the process died. So the crash test below spawns a child, has it
// `SIGKILL` itself mid-loop, and reads what is on disk afterwards. Its positive
// control writes the header and suppresses only the per-entry writes, which is
// what isolates the write at each settlement point as the thing under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readLedger, ledgerPathFor, envelopeFor } from '../bench/lib/sweep-ledger.mjs';
import { renderSweep } from '../bench/lib/sweep-report.mjs';
import { mergeManifest, recoveredRecord, stampFrom } from '../bench/recover-sweep.mjs';
import { runSweep } from '../bench/review-sweep.mjs';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'sweep-recovery-'));
}

const at9 = '2026-08-13T09:00:00.000Z';

test('every enumerated commit is disposed of, whether or not the run reached it', () => {
  const commits = [{ sha: 'a', eligible: true }, { sha: 'b', eligible: true }, { sha: 'c', eligible: false }];
  const merged = mergeManifest(commits, [{ sha: 'a', outcome: 'clean' }]);
  assert.deepEqual(merged.map((entry) => entry.outcome), ['clean', 'unobserved', 'unobserved']);
});

test('a recovered record refuses to claim an end it never saw', () => {
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 2, abortAfter: 3 }, [{ sha: 'a', eligible: true }, { sha: 'b', eligible: true }], 0),
    entries: [{ sha: 'a', outcome: 'clean', startedAt: '2026-08-13T01:00:00.000Z', endedAt: '2026-08-13T01:10:00.000Z' }],
    discarded: 0,
  });
  assert.equal(record.endedAt, null);
  assert.match(record.stoppedBecause, /DID NOT FINISH/);
  assert.match(record.stoppedBecause, /1 enumerated commit\(s\) have no ledger entry/);
  assert.match(record.stoppedBecause, /Last activity observed at 2026-08-13T01:10:00\.000Z/);
});

// OAI-165 (adversarial review): every header this codebase WRITES now carries
// `repo` via `envelopeFor`, so every fixture built from it does too — which
// means the "no `repo` key at all" shape a PRE-OAI-165 ledger actually has on
// disk was never exercised. Built by hand, deliberately without the key,
// rather than by calling `envelopeFor`.
test('a header from before OAI-165, with no `repo` key at all, recovers and renders without crashing', () => {
  const header = { maxSeconds: 900, abortAfter: 3, include: ['scripts'], from: 'abc', requestedCommits: 1, eligible: 1, scanLimit: 200, walked: 1, enumerated: 1, commits: [{ sha: 'a', eligible: true }] };
  assert.ok(!('repo' in header), 'the fixture must omit the key, not merely set it to null');
  const record = recoveredRecord({ header, entries: [{ sha: 'a', outcome: 'clean' }], discarded: 0 });
  assert.equal(record.repo, undefined);
  assert.match(renderSweep(record), /\*\*Repository\*\* `\(not recorded\)`/);
});

test('a run killed before its first review still recovers into a report', () => {
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 1, abortAfter: 3 }, [{ sha: 'a', eligible: true }], 0),
    entries: [],
    discarded: 0,
  });
  assert.equal(record.endedAt, null);
  assert.match(record.stoppedBecause, /No commit had reached the ledger when it was read/);
  assert.equal(record.entries.length, 1);
});

test('settled-but-never-attempted is not reported as nothing settled', () => {
  // A skipped commit is settled without the clock being read, so it carries no
  // `endedAt`. Reading the last entry's unconditionally said "no commit was
  // settled" over a ledger holding four of them.
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 2, abortAfter: 3 }, [{ sha: 'a' }, { sha: 'b' }], 0),
    entries: [{ sha: 'a', outcome: 'skipped-no-code' }],
    discarded: 0,
  });
  assert.match(record.stoppedBecause, /1 commit\(s\) reached the ledger but none carries a review time/);
  assert.doesNotMatch(record.stoppedBecause, /No commit reached the ledger/);
});

test('the last ATTEMPTED commit supplies the observation time, not the last entry', () => {
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 3, abortAfter: 3 }, [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }], 0),
    entries: [
      { sha: 'a', outcome: 'clean', startedAt: at9, endedAt: at9 },
      { sha: 'b', outcome: 'skipped-no-code' },
    ],
    discarded: 0,
  });
  assert.match(record.stoppedBecause, /Last activity observed at 2026-08-13T09:00:00\.000Z/);
});

test('a discarded line is disclosed in the recovered report, not swallowed', () => {
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 1, abortAfter: 3 }, [{ sha: 'a', eligible: true }], 0),
    entries: [],
    discarded: 2,
  });
  assert.match(record.stoppedBecause, /2 ledger line\(s\) could not be parsed/);
});

test('recovered artifacts are named for the run they describe', () => {
  assert.equal(stampFrom('/x/review-sweep-2026-08-13T01-00-00-000Z.ledger.jsonl'), '2026-08-13T01-00-00-000Z');
  assert.throws(() => stampFrom('/x/something-else.json'), /Not a sweep ledger filename/);
});

test('a ledger write that fails does not cost the night its remaining commits', () => {
  // A recording fault must never destroy review coverage — that is the failure
  // this whole mechanism exists to remove, and an unguarded sink would have
  // reintroduced it at the settlement point.
  const commits = [{ sha: 'a', eligible: true }, { sha: 'b', eligible: true }, { sha: 'c', eligible: true }];
  const warnings = [];
  let n = 0;
  const { entries } = runSweep(commits, { deadline: Number.MAX_SAFE_INTEGER, maxSeconds: 1, maxAttempts: 1, abortAfter: 3 }, {
    execute: () => ({ status: 0, stdout: JSON.stringify({ findings: [], model: 'm' }) }),
    sink: () => {
      n += 1;
      if (n === 2) throw new Error('ENOSPC: no space left on device');
    },
    warn: (message) => warnings.push(message),
  });
  assert.equal(entries.length, 3);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Could not append b to the ledger.*ENOSPC/);
});

test('a declared gap is NOT reported as a commit that was never settled', () => {
  // The reviewer's own guard against a failing disk is what makes "never
  // settled" false: the commit WAS settled and only its record was lost.
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 2, abortAfter: 3 }, [{ sha: 'a' }, { sha: 'b' }], 0),
    entries: [],
    gaps: [{ sha: 'a', why: 'ENOSPC' }],
    discarded: 0,
  });
  assert.deepEqual(record.entries.map((entry) => entry.outcome), ['unrecorded', 'unobserved']);
  assert.match(record.stoppedBecause, /1 commit\(s\) WERE settled and their record could not be written/);
});

test('a ledger of nothing but gaps does not say no commit reached it', () => {
  // It said which commits were settled and lost, then said none was settled.
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 1, abortAfter: 3 }, [{ sha: 'a' }], 0),
    entries: [],
    gaps: [{ sha: 'a', why: 'ENOSPC' }],
    discarded: 0,
  });
  assert.doesNotMatch(record.stoppedBecause, /No commit reached the ledger/);
  assert.match(record.stoppedBecause, /1 commit\(s\) reached the ledger but none carries a review time/);
});

test('a run whose every commit reached the ledger is not told commits are missing', () => {
  // A kill after the last entry was written and before the artifacts were is
  // fully represented; telling that reader "commits are missing" is its own
  // false statement.
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 1, abortAfter: 3 }, [{ sha: 'a' }], 0),
    entries: [{ sha: 'a', outcome: 'clean', startedAt: at9, endedAt: at9 }],
    discarded: 0,
  });
  assert.equal(record.timelineComplete, true);
  assert.match(record.stoppedBecause, /Every enumerated commit reached the ledger/);
  assert.doesNotMatch(record.stoppedBecause, /have no ledger entry/);
});

test('an absent entry is described as ambiguous, never as never-settled', () => {
  const record = recoveredRecord({
    header: envelopeFor({ maxCommits: 1, abortAfter: 3 }, [{ sha: 'a' }], 0),
    entries: [],
    discarded: 0,
  });
  assert.match(record.stoppedBecause, /either never reached or was settled and lost its write/);
  assert.doesNotMatch(record.stoppedBecause, /were never settled and are listed/);
  // Everything derived from a holed timeline must know it is holed.
  assert.equal(record.timelineComplete, false);
});

// The child driven by both crash cases below. It runs the real `runSweep` with a
// fake executor against a real ledger, and kills itself partway through the
// third commit — with no chance to flush, which is the point.
const CRASH_CHILD = `
import { runSweep } from '${ROOT}bench/review-sweep.mjs';
import { openLedger, envelopeFor } from '${ROOT}bench/lib/sweep-ledger.mjs';
const [outDir, mode] = process.argv.slice(2);
const commits = [
  { sha: 'aaa', subject: 'one', eligible: true },
  { sha: 'bbb', subject: 'two', eligible: true },
  { sha: 'ccc', subject: 'three', eligible: true },
  { sha: 'ddd', subject: 'four', eligible: true },
];
const options = { deadline: Number.MAX_SAFE_INTEGER, maxSeconds: 1800, maxCommits: 4, abortAfter: 3, include: ['scripts'], from: 'HEAD', scanLimit: 200 };
const ledger = openLedger(outDir, 'crash');
ledger.header(envelopeFor(options, commits, 0));
let n = 0;
runSweep(commits, options, {
  sink: mode === 'suppressed' ? () => {} : ledger.entry,
  execute: () => {
    n += 1;
    if (n === 3) process.kill(process.pid, 'SIGKILL');
    return { status: 0, stdout: JSON.stringify({ findings: [], model: 'm' }) };
  },
});
`;

async function crash(mode) {
  const dir = tempDir();
  const script = join(dir, 'child.mjs');
  writeFileSync(script, CRASH_CHILD);
  // execFile, never execFileSync: a sync spawn blocks this process's event loop.
  await run(process.execPath, [script, dir, mode]).then(
    () => assert.fail('the child was supposed to die'),
    (error) => assert.equal(error.signal, 'SIGKILL'),
  );
  return { dir, ledgerPath: ledgerPathFor(dir, 'crash') };
}

test('a killed sweep leaves on disk everything it had settled', async () => {
  const { dir, ledgerPath } = await crash('recording');
  const read = readLedger(ledgerPath);
  assert.equal(read.header.enumerated, 4);
  assert.deepEqual(read.entries.map((entry) => entry.sha), ['aaa', 'bbb']);

  await run(process.execPath, [join(ROOT, 'bench', 'recover-sweep.mjs'), ledgerPath]);
  const report = readdirSync(dir).find((name) => name.endsWith('-recovered.md'));
  const text = readFileSync(join(dir, report), 'utf8');
  assert.match(text, /THE RUN DID NOT FINISH/);
  assert.match(text, /ended\*\* not observed/);
  // The header's arithmetic and the coverage section must agree. Before the
  // manifest was carried, the header said "enumerated 4" while coverage
  // concluded every enumerated commit had been reviewed.
  assert.match(text, /\*\*Enumerated\*\* 4 commits · \*\*reviewed\*\* 2 · \*\*no review\*\* 2/);
  assert.match(text, /2 of 4 enumerated commits produced no review/);
  assert.match(text, /`ccc` three — \*\*unobserved\*\*/);
  assert.match(text, /`ddd` four — \*\*unobserved\*\*/);
});

// POSITIVE CONTROL. Same child, same kill, same ledger and header — only the
// per-entry write is suppressed. Without this the test above proves that files
// exist, not that the settlement write is what put the commits in them.
test('with the per-settlement write suppressed, the same crash recovers nothing', async () => {
  const { dir, ledgerPath } = await crash('suppressed');
  const read = readLedger(ledgerPath);
  assert.equal(read.entries.length, 0);

  await run(process.execPath, [join(ROOT, 'bench', 'recover-sweep.mjs'), ledgerPath]);
  const report = readdirSync(dir).find((name) => name.endsWith('-recovered.md'));
  assert.ok(existsSync(join(dir, report)));
  const text = readFileSync(join(dir, report), 'utf8');
  assert.match(text, /No commit had reached the ledger when it was read/);
  assert.match(text, /4 of 4 enumerated commits produced no review/);
});

test('a missing INELIGIBLE commit does not make the health timeline incomplete', () => {
  // The warning exists because a hole can distort the streak. An ineligible
  // commit can only ever reach `skipped-no-code`, which returns before the clock
  // and before the counter — so a crash before a trailing docs-only commit leaves
  // the health timeline whole, and warning over it is a caveat with nothing
  // behind it. Coverage is a different completeness: it still renders `unobserved`.
  const commits = [{ sha: 'a', eligible: true }, { sha: 'z', eligible: false }];
  const record = recoveredRecord({
    header: envelopeFor({ abortAfter: 3 }, commits, 0),
    entries: [{ sha: 'a', outcome: 'clean', startedAt: at9, endedAt: at9 }],
    discarded: 0,
  });
  assert.equal(record.timelineComplete, true);
  assert.equal(record.entries[1].outcome, 'unobserved');
});

test('a missing ELIGIBLE commit still does, whether it left a gap line or nothing', () => {
  const commits = [{ sha: 'a', eligible: true }, { sha: 'b', eligible: true }];
  const header = envelopeFor({ abortAfter: 3 }, commits, 0);
  const entries = [{ sha: 'a', outcome: 'clean', startedAt: at9, endedAt: at9 }];
  assert.equal(recoveredRecord({ header, entries, discarded: 0 }).timelineComplete, false);
  // A gap PROVES the commit was attempted and its outcome lost, so the streak it
  // would have contributed to is unknowable — the fix for the ineligible case
  // must not swallow this one.
  const gapped = recoveredRecord({ header, entries, gaps: [{ sha: 'b', why: 'ENOSPC' }], discarded: 0 });
  assert.equal(gapped.timelineComplete, false);
  assert.equal(gapped.entries[1].outcome, 'unrecorded');
});
