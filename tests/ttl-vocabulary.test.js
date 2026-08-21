import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CONCLUSIVE, EPISODE_VERDICTS, SWEEP_VERDICTS, episodeVerdict, summarize,
} from '../bench/lib/ttl-verdict.mjs';

/**
 * The instrument's VOCABULARY contract, split from the decision rule at
 * the size ratchet.
 *
 * Two separate sets of names (per-episode verdicts, per-sweep outcomes) and one
 * subset of the second (the outcomes that mean the run produced a result). All
 * three are quoted in prose and in BACKLOG.md's done-condition, and all three
 * have already drifted from the code once: the documented outcome table lost a
 * row it still licensed, and its "the mapping is now a test" claim sat under the
 * sweep table while only the episode set had a guard.
 */

const ttlMs = 120_000;
const past = 300_000;
const short = 130_000;
const ok = { ttlMs, failed: false, unloadObserved: false, obtainedResponse: true, invalid: [] };

test('the emitted verdict set is exactly the documented one', () => {
  // A documented table lost a row once to exactly this drift — an outcome the
  // code could produce that no table listed. A recurring defect class graduates
  // from a reviewer's prompt to a guard.
  const emitted = new Set();
  for (const failed of [false, true]) {
    for (const unloadObserved of [false, true]) {
      for (const prefillMs of [past, short, null]) {
        emitted.add(episodeVerdict({ ...ok, failed, unloadObserved, prefillMs }));
      }
    }
  }
  emitted.add(episodeVerdict({ ...ok, prefillMs: past, obtainedResponse: false }));
  emitted.add(episodeVerdict({ ...ok, prefillMs: past, invalid: ['sole-tenancy'] }));
  assert.deepEqual([...emitted].sort(), [...EPISODE_VERDICTS].sort());
});


test('the emitted SWEEP outcome set is exactly the documented one', () => {
  // The documented outcome table lists SWEEP outcomes, not episode verdicts, and
  // amendment claiming "the mapping is now a test" sat directly under it while
  // the only guard covered the episode set. Two vocabularies, one claim.
  //
  // Every sequence up to the canonical three episodes, not singletons and
  // survivor-led pairs: a combination-specific return could otherwise be missing
  // from SWEEP_VERDICTS while this guard still passed, which is the exact drift
  // it exists to catch. 7 + 49 + 343 sequences, plus the calibration variants.
  const emitted = new Set();
  for (const cleared of [true, false]) {
    for (const failures of [[], ['sole-tenancy']]) {
      emitted.add(summarize([], { calibrationCleared: cleared, calibrationFailures: failures }).verdict);
    }
  }
  const seqs = [[]];
  for (let depth = 0; depth < 3; depth += 1) {
    for (const seq of [...seqs]) {
      if (seq.length === depth) for (const v of EPISODE_VERDICTS) seqs.push([...seq, v]);
    }
  }
  for (const seq of seqs) if (seq.length) emitted.add(summarize(seq).verdict);
  assert.deepEqual([...emitted].sort(), [...SWEEP_VERDICTS].sort());
});


test('only the outcomes that actually produced a result count as conclusive', () => {
  // `no-exposure` and `contradictory-evidence` both ask to be re-run in their own
  // text, so "any verdict other than instrument-failed" is not completion — the
  // done-condition said exactly that until a wide review caught it.
  assert.deepEqual([...CONCLUSIVE], ['deterministic-form-refuted', 'inconclusive-failure']);
  for (const verdict of SWEEP_VERDICTS.filter((v) => !CONCLUSIVE.includes(v))) {
    const says = verdict === 'instrument-failed'
      ? summarize(['not-dispatched']).says
      : summarize(verdict === 'no-exposure' ? ['no-exposure'] : ['survived-despite-unload']).says;
    assert.match(says, /re-run|says NOTHING/i, `"${verdict}" must tell the operator to re-run`);
  }
});


test('the tracker names the same verdicts the code calls conclusive', () => {
  // The exit code and the tracker are claimed to read ONE list. Only the driver
  // imports CONCLUSIVE — BACKLOG.md restates the strings in prose — so without
  // this the claimed single source does not exist.
  //
  // Set equality on the verdicts NAMED in the done-condition, not a doesNotMatch
  // on one phrasing: an earlier version only caught the literal "other than
  // `instrument-failed`", so adding "and `no-exposure`" to the acceptance clause
  // would have passed. A guard that looks exhaustive and is not is worse than
  // none.
  // Reads BACKLOG_DONE.md, not BACKLOG.md: the entry this test tracks was
  // completed and moved. The guard followed it rather than being retired,
  // because the entry still states which verdicts were acceptable — a later
  // change to CONCLUSIVE would silently falsify a historical claim, which is
  // the same drift in a file nobody re-reads. It failed CLOSED on the move
  // (the anchor assert below), which is how the relocation was caught rather
  // than missed.
  const backlog = readFileSync(new URL('../BACKLOG_DONE.md', import.meta.url), 'utf8');
  const start = backlog.indexOf('- **OAI-34**');
  // The NEXT entry, not a named neighbour: this file is newest-first, so pinning
  // whichever item happens to sit below would need editing every time one lands.
  const end = backlog.indexOf('\n- **OAI-', start + 1);
  // Both markers validated and ordered. Unchecked indexOf returns -1, and
  // `slice(start, -1)` would still contain OAI-34 — so the test would pass while
  // reading a region it did not mean to.
  assert.ok(start !== -1, 'the OAI-34 entry must exist');
  assert.ok(end > start, 'an entry must follow it');
  const entry = backlog.slice(start, end);

  // One LINE with a stable prefix, rather than a parser guessing where a
  // markdown sentence ends — the first attempt stopped at nested bold markup and
  // extracted a region naming no verdicts at all, which would have compared two
  // empty-ish sets and looked fine.
  const line = entry.split('\n').find((l) => l.trim().startsWith('Accepted verdicts:'));
  assert.ok(line, 'the OAI-34 entry must carry an "Accepted verdicts:" line');
  const named = new Set(SWEEP_VERDICTS.filter((v) => line.includes(`\`${v}\``)));
  assert.deepEqual([...named].sort(), [...CONCLUSIVE].sort(),
    'the accepted verdicts must be exactly the conclusive ones');
});
