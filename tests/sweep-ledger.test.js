// The ledger module itself: what one line means, and what happens when a write
// fails. The crash test that proves the whole mechanism lives beside it in
// `sweep-recovery.test.js` — split only because this file reached the repo's
// size ratchet, the same reason `sweep-cap-default.test.js` exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envelopeFor, openLedger, readLedger } from '../bench/lib/sweep-ledger.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'sweep-ledger-'));
}

test('a ledger round-trips its header and every entry', () => {
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header({ from: 'abc', enumerated: 2, commits: [{ sha: 'a' }, { sha: 'b' }] });
  ledger.entry({ sha: 'a', outcome: 'clean' });
  ledger.entry({ sha: 'b', outcome: 'findings', findings: [{ summary: 'x' }] });
  const read = readLedger(ledger.path);
  assert.equal(read.header.from, 'abc');
  assert.deepEqual(read.entries.map((entry) => entry.sha), ['a', 'b']);
  assert.equal(read.discarded, 0);
});

test('the header records the review-request knobs a cross-sweep comparison needs', () => {
  const envelope = envelopeFor(
    { include: [], abortAfter: 3, maxSeconds: 900, diffOnly: true, maxAttempts: 5, provider: 'lmstudio' },
    [{ sha: 'a', eligible: true }],
    0,
  );
  assert.equal(envelope.diffOnly, true);
  assert.equal(envelope.maxAttempts, 5);
  assert.equal(envelope.provider, 'lmstudio');
});

test('an unset provider is recorded as null, never left undefined', () => {
  const envelope = envelopeFor({ include: [], abortAfter: 3, maxSeconds: 900, diffOnly: false, maxAttempts: 3 }, [], 0);
  assert.equal(envelope.provider, null);
  assert.equal(envelope.diffOnly, false);
});

test('a --base-url override nulls the provider label, since it no longer names the endpoint', () => {
  const overridden = envelopeFor({ include: [], abortAfter: 3, maxSeconds: 900, diffOnly: false, maxAttempts: 3, provider: 'lmstudio', 'base-url': 'http://other:1234' }, [], 0);
  assert.equal(overridden.provider, null);
  // Without an override the named profile is recorded as-is.
  const named = envelopeFor({ include: [], abortAfter: 3, maxSeconds: 900, diffOnly: false, maxAttempts: 3, provider: 'lmstudio' }, [], 0);
  assert.equal(named.provider, 'lmstudio');
});

test('a torn final line is discarded and counted, never thrown on', () => {
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header({ from: 'abc', commits: [] });
  ledger.entry({ sha: 'a', outcome: 'clean' });
  // Exactly what an interruption mid-write leaves behind. The leading newline is
  // part of the record the writer emits, so a torn one carries it.
  writeFileSync(ledger.path, `${readFileSync(ledger.path, 'utf8')}\n{"kind":"entry","entry":{"sha":"b"`);
  const read = readLedger(ledger.path);
  assert.equal(read.entries.length, 1);
  assert.equal(read.discarded, 1);
});

test('a ledger with no header reports one rather than inventing an envelope', () => {
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.entry({ sha: 'a', outcome: 'clean' });
  assert.equal(readLedger(ledger.path).header, null);
});

test('an entry carrying its own `kind` cannot decide how its line is read', () => {
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header({ commits: [] });
  // A model reply is another process's JSON. Spreading it into the line object
  // would let this field masquerade as the harness's own tag.
  ledger.entry({ sha: 'a', outcome: 'clean', kind: 'header' });
  const read = readLedger(ledger.path);
  assert.equal(read.entries.length, 1);
  assert.equal(read.entries[0].sha, 'a');
});

function failing(sha) {
  // A 256KB entry can hit a limit an 80-byte one does not, which is exactly the
  // case the fallback exists for.
  const entry = { sha, outcome: 'findings', raw: 'x' };
  Object.defineProperty(entry, 'toJSON', { value: () => { throw new Error('ENOSPC: no space left on device'); } });
  return entry;
}

test('an entry that cannot be written declares a gap rather than vanishing', () => {
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header({ commits: [{ sha: 'a' }] });
  assert.throws(() => ledger.entry(failing('a')), /ENOSPC/);
  const read = readLedger(ledger.path);
  assert.equal(read.entries.length, 0);
  assert.equal(read.gaps.length, 1);
  assert.equal(read.gaps[0].sha, 'a');
  assert.match(read.gaps[0].why, /ENOSPC/);
  // The gap says the record was lost. It must NOT carry the outcome, or every
  // reader downstream has to explain why a fact it holds is described as lost.
  assert.equal('outcome' in read.gaps[0], false);
});

test('writing a gap does not make the append have succeeded', () => {
  // Swallowing the original error here silences runSweep's one-warning-per-
  // failed-append, and makes "the sink write succeeded" mean "a gap was
  // written instead".
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header({ commits: [] });
  assert.throws(() => ledger.entry(failing('a')), /ENOSPC/);
});

test('an entry after a fragment AND a failed gap is not fused into it', () => {
  // The case a trailing-newline writer loses: entry write fails part-written,
  // the gap write fails too, and the NEXT successful entry fuses onto the
  // fragment — so a line whose own write succeeded is destroyed by a fault that
  // happened before it.
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header({ commits: [{ sha: 'a' }, { sha: 'b' }] });
  writeFileSync(ledger.path, `${readFileSync(ledger.path, 'utf8')}\n{"kind":"entry","entry":{"sha":"a"`);
  const read = readLedger(ledger.path);
  assert.equal(read.discarded, 1);
  // A perfectly ordinary entry, written after the damage.
  ledger.entry({ sha: 'b', outcome: 'clean' });
  const after = readLedger(ledger.path);
  assert.deepEqual(after.entries.map((entry) => entry.sha), ['b']);
  assert.equal(after.discarded, 1);
});

test('a gap survives a fragment left by the write it is replacing', () => {
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header({ commits: [{ sha: 'a' }] });
  // A partial line with no terminator — what a write that failed midway leaves.
  writeFileSync(ledger.path, `${readFileSync(ledger.path, 'utf8')}\n{"kind":"entry","entry":{"sha":"a"`);
  assert.throws(() => ledger.entry(failing('a')), /ENOSPC/);
  const read = readLedger(ledger.path);
  // Appended without a leading newline the two fuse into one unparseable line,
  // and the fault destroys the declaration written to report it.
  assert.equal(read.gaps.length, 1);
  assert.equal(read.gaps[0].sha, 'a');
});

test('a stamp collision is refused rather than appended into', () => {
  // Two runs sharing one ledger file would interleave into a document that still
  // PARSES — recovery would render the pair as one run — where the report and
  // record beside it would visibly clobber. A silent merge is the worse failure,
  // so the second open is refused rather than disambiguated.
  const dir = tempDir();
  openLedger(dir, 'stamp').header({ commits: [] });
  assert.throws(() => openLedger(dir, 'stamp'), /already exists/);
});

test('the ledger is created private, because it holds captured output verbatim', () => {
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  assert.equal(statSync(ledger.path).mode & 0o777, 0o600);
});

test('a header envelope with no manifest is DISCARDED, not accepted as the run', () => {
  // Measured, not reasoned. Before this, a header line that parsed as an object
  // carrying no `commits` slipped past the "no header" refusal, and the real CLI
  // printed "Recovered 2 of 0" and rendered a confident report saying enumerated
  // 0, reviewed 0, none reported by a completed review — over a ledger holding
  // two settled entries, one of them carrying findings. Silently wrong, where
  // the array case at least crashed the renderer loudly.
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header({ from: 'abc', include: ['**/*.mjs'] });
  ledger.entry({ sha: 'a', outcome: 'findings' });
  const read = readLedger(ledger.path);
  assert.equal(read.header, null);
  assert.equal(read.discarded, 1);
  // The entry itself is still readable — only the unusable envelope is dropped.
  assert.deepEqual(read.entries.map((entry) => entry.sha), ['a']);
});

test('an array envelope is refused for the same reason', () => {
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header([{ sha: 'a' }]);
  assert.equal(readLedger(ledger.path).header, null);
});

test('a real envelope carrying its manifest is accepted', () => {
  // The positive control: without it the two refusals above could pass because
  // nothing is ever accepted.
  const dir = tempDir();
  const ledger = openLedger(dir, 'stamp');
  ledger.header(envelopeFor({ include: [], abortAfter: 3 }, [{ sha: 'a', eligible: true }], 0));
  const read = readLedger(ledger.path);
  assert.equal(read.discarded, 0);
  assert.deepEqual(read.header.commits.map((c) => c.sha), ['a']);
});
