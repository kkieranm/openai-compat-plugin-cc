import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONCLUSIVE, EPISODE_VERDICTS, SWEEP_VERDICTS, episodeVerdict, summarize,
} from '../bench/lib/ttl-verdict.mjs';

/**
 * The instrument's VOCABULARY contract, split from the decision rule at
 * the size ratchet.
 *
 * Two separate sets of names (per-episode verdicts, per-sweep outcomes) and one
 * subset of the second (the outcomes that mean the run produced a result).
 */

const ttlMs = 120_000;
const past = 300_000;
const short = 130_000;
const ok = { ttlMs, failed: false, unloadObserved: false, obtainedResponse: true, invalid: [] };

test('the emitted verdict set is exactly `EPISODE_VERDICTS`', () => {
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


test('the emitted SWEEP outcome set is exactly `SWEEP_VERDICTS`', () => {
  // `SWEEP_VERDICTS` is a separate vocabulary from the episode verdicts, so it
  // needs its own guard beside the episode one.
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
  // text, so "any verdict other than instrument-failed" is not completion.
  assert.deepEqual([...CONCLUSIVE], ['deterministic-form-refuted', 'inconclusive-failure']);
  for (const verdict of SWEEP_VERDICTS.filter((v) => !CONCLUSIVE.includes(v))) {
    const says = verdict === 'instrument-failed'
      ? summarize(['not-dispatched']).says
      : summarize(verdict === 'no-exposure' ? ['no-exposure'] : ['survived-despite-unload']).says;
    assert.match(says, /re-run|says NOTHING/i, `"${verdict}" must tell the operator to re-run`);
  }
});
