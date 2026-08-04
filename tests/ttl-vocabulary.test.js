import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CONCLUSIVE, EPISODE_VERDICTS, SWEEP_VERDICTS, episodeVerdict, summarize,
} from '../bench/lib/ttl-verdict.mjs';

/**
 * OAI-34 — the instrument's VOCABULARY contract, split from the decision rule at
 * the size ratchet.
 *
 * Two separate sets of names (per-episode verdicts, per-sweep outcomes) and one
 * subset of the second (the outcomes that mean the run produced a result). All
 * three are quoted in ADR 013 and in BACKLOG.md's done-condition, and all three
 * have already drifted from the code once: the ADR's outcome table lost a row it
 * still licensed, and its "the mapping is now a test" claim sat under the sweep
 * table while only the episode set had a guard.
 */

const ttlMs = 120_000;
const past = 300_000;
const short = 130_000;
const ok = { ttlMs, failed: false, unloadObserved: false, obtainedResponse: true, invalid: [] };

test('the emitted verdict set is exactly the documented one', () => {
  // ADR 013 lost a table row once to exactly this drift — an outcome the code
  // could produce that no table listed. A recurring defect class graduates from a
  // reviewer's prompt to a guard.
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
  // ADR 013's outcome table lists SWEEP outcomes, not episode verdicts, and the
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
  // ADR 013 claims the exit code and the tracker read ONE list. Only the driver
  // imports CONCLUSIVE — BACKLOG.md restates the strings in prose — so without
  // this the claimed single source does not exist and the two can drift.
  const backlog = readFileSync(new URL('../BACKLOG.md', import.meta.url), 'utf8');
  const doneCondition = backlog.slice(backlog.indexOf('- **OAI-34**'), backlog.indexOf('- **OAI-19**'));
  for (const verdict of CONCLUSIVE) {
    assert.ok(doneCondition.includes(verdict), `the done-condition must name "${verdict}"`);
  }
  for (const verdict of SWEEP_VERDICTS.filter((v) => !CONCLUSIVE.includes(v))) {
    assert.ok(!new RegExp(`\`${verdict}\`(?![^.]*\\bnot\\b)`).test(doneCondition)
      || !doneCondition.includes(`or \`${verdict}\``),
    `the done-condition must not accept "${verdict}" as completion`);
  }
});

