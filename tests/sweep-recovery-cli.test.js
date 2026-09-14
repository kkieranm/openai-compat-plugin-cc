// What the recovery command REFUSES, driven through the real CLI.
//
// These answer one class of defect: an invocation that was accepted and then
// quietly did the wrong thing. One wrote a report contradicting the finished
// run's own report; one swallowed a documented flag; one recovered the first of
// two ledgers and dropped the second. None is visible from the module's exports,
// because all of them live in argument handling and in what is on disk beside
// the ledger — so these run the command.
//
// **They assert ARTIFACTS, not stderr.** An earlier version of this file matched
// only the printed messages, so a regression that announced the right paths and
// wrote nothing would have passed every one of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { envelopeFor, openLedger } from '../bench/lib/sweep-ledger.mjs';
import { writeSweep } from '../bench/lib/sweep-report.mjs';
import { tempDir as sharedTempDir } from './helpers.mjs';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const CLI = join(ROOT, 'bench/recover-sweep.mjs');
const SHA = 'abc123def';

const tempDir = () => sharedTempDir('recover-cli-');
const recover = (args) => run('node', [CLI, ...args], { cwd: ROOT });
const commits = [{ sha: SHA, subject: 'the subject', eligible: true }];
const envelope = () => envelopeFor({ from: 'abc', include: ['**/*.mjs'], abortAfter: 3, maxSeconds: 900 }, commits, 0);

/**
 * A ledger holding one settled commit, which recovery can render.
 *
 * The header comes from the real `envelopeFor` rather than a hand-built object,
 * so the fixture cannot drift into a shape the sweep never writes.
 */
function ledgerIn(dir, stamp = '2026-08-13T09-00-00-000Z') {
  const ledger = openLedger(dir, stamp);
  ledger.header(envelope());
  ledger.entry({ sha: SHA, subject: 'the subject', outcome: 'clean', startedAt: '2026-08-13T09:00:00.000Z', endedAt: '2026-08-13T09:01:00.000Z' });
  return { path: ledger.path, stamp };
}

/**
 * A COMPLETED run's artifacts, written by the real `writeSweep`.
 *
 * Hand-rolling the record is what put a bare `{}` here in the first place, and
 * that fixture agreed with a wrong model: it made "the file exists" look like
 * proof the run finished, so the test could never have caught that a file killed
 * mid-write exists too.
 */
function finishedRunIn(dir, stamp) {
  writeSweep(dir, stamp, {
    ...envelope(),
    endedAt: '2026-08-13T10:00:00.000Z',
    stoppedBecause: 'every enumerated commit was settled',
    entries: [{ sha: SHA, subject: 'the subject', outcome: 'clean' }],
  });
}

/** The recovered report must exist AND name the commit the ledger held. */
function assertRecovered(dir, stamp) {
  const report = join(dir, `review-sweep-${stamp}-recovered.md`);
  assert.equal(existsSync(report), true, `no recovered report at ${report}`);
  assert.equal(existsSync(join(dir, `review-sweep-${stamp}-recovered.json`)), true);
  assert.match(readFileSync(report, 'utf8'), new RegExp(SHA.slice(0, 9)));
}

function assertNothingRecovered(dir, stamp) {
  assert.equal(existsSync(join(dir, `review-sweep-${stamp}-recovered.md`)), false);
  assert.equal(existsSync(join(dir, `review-sweep-${stamp}-recovered.json`)), false);
}

test('a run that finished is not recovered over', async () => {
  // Recovering anyway would put a second report saying THE RUN DID NOT FINISH
  // beside the real one saying it did — sorting together, the false one newer.
  const dir = tempDir();
  const { path, stamp } = ledgerIn(dir);
  finishedRunIn(dir, stamp);
  await assert.rejects(recover([path]), (error) => {
    assert.match(error.stderr, /That run finished/);
    return true;
  });
  assertNothingRecovered(dir, stamp);
});

test('a record that exists but does NOT parse is a killed write, and is recovered', async () => {
  // The defect this refusal shipped with: `writeSweep` writes the record with a
  // single writeFileSync, which truncates and then fills, so a process killed
  // mid-write leaves a file that EXISTS and is a fragment. Reading existence as
  // proof of completion refused to recover at exactly the moment recovery was
  // needed. A prefix of a stringified record can never parse — that is what the
  // check now rests on.
  const dir = tempDir();
  const { path, stamp } = ledgerIn(dir);
  finishedRunIn(dir, stamp);
  const record = join(dir, `review-sweep-${stamp}.json`);
  const whole = readFileSync(record, 'utf8');
  writeFileSync(record, whole.slice(0, Math.floor(whole.length / 2)));
  await recover([path]);
  assertRecovered(dir, stamp);
});

test('a record that parses but is not a FINISHED run does not block recovery', async () => {
  // The identity witness, which is a different job from the durability one: a
  // recovered record parses perfectly well and carries `endedAt: null`.
  const dir = tempDir();
  const { path, stamp } = ledgerIn(dir);
  finishedRunIn(dir, stamp);
  const record = join(dir, `review-sweep-${stamp}.json`);
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), endedAt: null }));
  await recover([path]);
  assertRecovered(dir, stamp);
});

test('--force recovers from a finished run anyway, which is what makes the refusal safe', async () => {
  const dir = tempDir();
  const { path, stamp } = ledgerIn(dir);
  finishedRunIn(dir, stamp);
  await recover(['--force', path]);
  assertRecovered(dir, stamp);
});

test('a ledger with no finished report beside it recovers with no flag at all', async () => {
  // The negative control for the refusal above: without it, a passing --force
  // test could not distinguish "the flag works" from "the check never fires".
  const dir = tempDir();
  const { path, stamp } = ledgerIn(dir);
  const { stderr } = await recover([path]);
  assert.match(stderr, /Recovered 1 of 1/);
  assertRecovered(dir, stamp);
});

test('an option written AFTER the ledger path is refused, never silently ignored', async () => {
  // `parseArgs` stops reading flags at the first positional, so this form parsed
  // `--out-dir` as a filename and wrote beside the ledger instead — while the
  // usage text documented exactly this order.
  const dir = tempDir();
  const { path, stamp } = ledgerIn(dir);
  const out = tempDir();
  await assert.rejects(recover([path, '--out-dir', out]), (error) => {
    assert.match(error.stderr, /options must come BEFORE the ledger path/);
    return true;
  });
  assertNothingRecovered(dir, stamp);
  assertNothingRecovered(out, stamp);
});

test('a SECOND ledger path is refused rather than silently dropped', async () => {
  // The first version of that guard looked only for a leading `--`, so passing
  // two ledgers recovered the first and discarded the second in silence — the
  // same defect one door along from the one it was written to close.
  const dir = tempDir();
  const { path, stamp } = ledgerIn(dir);
  const other = tempDir();
  const second = ledgerIn(other);
  await assert.rejects(recover([path, second.path]), (error) => {
    assert.match(error.stderr, /recovers exactly one ledger/);
    return true;
  });
  assertNothingRecovered(dir, stamp);
  assertNothingRecovered(other, second.stamp);
});

test('the options-first form is the one that works, and it honours --out-dir', async () => {
  const dir = tempDir();
  const { path, stamp } = ledgerIn(dir);
  const out = tempDir();
  await recover(['--out-dir', out, path]);
  assertRecovered(out, stamp);
  assertNothingRecovered(dir, stamp);
});
