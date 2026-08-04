import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activityObserved, entryFor, firstUnload, inPhase, lastPresentBefore, otherModelsSeen,
  residencyOf, residentAtStart, unreadableBefore,
} from '../bench/lib/ttl-residency.mjs';
import {
  clientBudgetReason, obtainedAnyResponse, prefillFromAttempts, recordContradiction,
} from '../bench/lib/ttl-attempts.mjs';
import { DEFAULTS, isCanonical, resolveConfig } from '../bench/lib/ttl-config.mjs';

// OAI-34. The two evidence readers and the config seam. Neither reader decides
// anything — the rule lives in ttl-verdict.mjs — so what is guarded here is every
// way a reading could quietly become an answer it does not support.

const MODEL = 'qwen/qwen3.6-27b';

// A REAL `lms ps --json` entry, trimmed. Copied from a live reply rather than
// invented: the first draft guessed the key names and its comment asserted the
// TTL was not reported at all. It is, as `ttlMs`.
const RESIDENT = {
  type: 'llm',
  modelKey: MODEL,
  identifier: MODEL,
  ttlMs: 120_000,
  lastUsedTime: 1_785_775_033_281,
  status: 'idle',
  contextLength: 61_696,
  maxContextLength: 262_144,
};
const sample = (atMs, lastUsedTime, phase = 'in-flight') => ({ atMs, phase, loaded: [{ ...RESIDENT, lastUsedTime }] });
const absent = (atMs, phase = 'in-flight') => ({ atMs, phase, loaded: [] });
const unreadable = (atMs, phase = 'in-flight') => ({ atMs, phase, loaded: null });

test('residency keeps the fields the protocol depends on, and drops the rest', () => {
  const [entry] = residencyOf(JSON.stringify([RESIDENT]));
  assert.equal(entry.modelKey, MODEL);
  assert.equal(entry.ttlMs, 120_000, 'the applied treatment, read back rather than assumed');
  assert.equal(entry.contextLength, 61_696, 'identity across arms — TTL must not be confounded with config');
  assert.equal(entry.lastUsedTime, 1_785_775_033_281);
});

test('an unreadable reply is null, never an empty list', () => {
  assert.deepEqual(residencyOf('[]'), []);
  // "Could not read residency" and "nothing is loaded" are different facts.
  // Collapsing them lets a broken sampler read as an observed absence.
  assert.equal(residencyOf('not json'), null);
  assert.equal(residencyOf('{"models":[]}'), null);
  assert.deepEqual(residencyOf('[{"status":"idle"}]'), [], 'no modelKey is not residency');
});

test('an unreadable sample is not counted as an absence', () => {
  assert.equal(firstUnload([sample(0, 1), unreadable(5_000), sample(10_000, 1)], MODEL), null);
  assert.equal(entryFor([], MODEL), null);
  assert.equal(entryFor(null, MODEL), null);
});

test('the first sample missing the model is the absence, with its timestamp', () => {
  assert.equal(firstUnload([sample(0, 1), absent(125_000), absent(130_000)], MODEL).atMs, 125_000);
});

test('a post-exit sample is NOT evidence about the run', () => {
  // The sampler takes one final reading after the child closes. An absence first
  // seen there happened after the run was already over.
  assert.equal(firstUnload([sample(0, 1), sample(60_000, 1), absent(300_000, 'post-exit')], MODEL), null);
});

test('a pre-dispatch sample is not evidence either', () => {
  // Taken before the child was spawned, so it describes the load, not the run.
  const samples = [absent(0, 'pre-dispatch'), sample(5_000, 1)];
  assert.equal(firstUnload(samples, MODEL), null);
  assert.equal(inPhase(samples, 'in-flight').length, 1);
});

test('the absence is bracketed, so the record shows how precisely it was located', () => {
  // The bracket is RECORDED and decides nothing. It exists because the true
  // disappearance lies in (lastPresent, firstAbsent], and a reader is entitled to
  // see that width rather than treat one sample as a timestamp.
  const samples = [sample(0, 1), sample(118_000, 1), absent(120_000)];
  assert.equal(lastPresentBefore(samples, MODEL, 120_000).atMs, 118_000);
  assert.equal(lastPresentBefore(samples, MODEL, 0), null);
});

test('a competing model is seen, and the target is not counted as one', () => {
  const withOther = { atMs: 5, phase: 'in-flight', loaded: [RESIDENT, { ...RESIDENT, modelKey: 'other/m' }] };
  assert.deepEqual(otherModelsSeen([sample(0, 1), withOther], MODEL), ['other/m']);
  assert.deepEqual(otherModelsSeen([sample(0, 1)], MODEL), []);
  // A pre-dispatch reading describes the load, not the run.
  assert.deepEqual(otherModelsSeen([{ ...withOther, phase: 'pre-dispatch' }], MODEL), []);
});

test('gaps in observation are counted, and residency at start is a fact or a null', () => {
  assert.equal(unreadableBefore([sample(0, 1), unreadable(10), unreadable(20)], 100), 2);
  assert.equal(unreadableBefore([sample(0, 1), unreadable(10)], 5), 0, 'only before the mark');
  assert.equal(residentAtStart([sample(0, 1)], MODEL), true);
  assert.equal(residentAtStart([absent(0)], MODEL), false);
  // Unreadable is neither, and must not become `false` — that would be a finding.
  assert.equal(residentAtStart([unreadable(0)], MODEL), null);
  assert.equal(residentAtStart([], MODEL), null);
});

test('activity is measured over the PREFILL window, not the whole episode', () => {
  // The window bug: comparing first-to-last across the episode spans generation,
  // which is the one activity nobody disputes counts as work — so the field would
  // read `true` every time and be reported as an answer about prefill.
  const samples = [sample(0, 1_000), sample(60_000, 1_000), sample(200_000, 9_000)];
  assert.equal(activityObserved(samples, MODEL, 100_000), false);
  assert.equal(activityObserved(samples, MODEL, null), true, 'what the first draft did');
});

test('too few readable samples answers null, never false', () => {
  // False would mean "observed no activity", which is a finding. One sample, or
  // none readable, has observed nothing at all — and this field is quoted in the
  // write-up, so the difference is the difference between evidence and a guess.
  assert.equal(activityObserved([sample(0, 1_000)], MODEL, 300_000), null);
  assert.equal(activityObserved([unreadable(0), unreadable(5)], MODEL, 300_000), null);
  assert.equal(activityObserved([], MODEL, 300_000), null);
});

// ---- the attempt record ----

const answered = { outcome: 'answered', serverResponded: true, prefillMs: 335_000 };

test('only serverResponded witnesses a response — a minted entry does not', () => {
  // `ledger.begin` mints an entry before the socket is opened, so a run against a
  // server that is down produces attempts. That is the exact state an accidental
  // run of the withdrawn draft was in, and it rendered a verdict from it.
  assert.equal(obtainedAnyResponse([{ outcome: 'failed', serverResponded: false, reason: 'transport' }]), false);
  assert.equal(obtainedAnyResponse([]), false);
  assert.equal(obtainedAnyResponse(null), false);
  assert.equal(obtainedAnyResponse([answered]), true);
  // The draft's disjunction had already drifted from the production rule: a
  // measured prefill alone was enough for it. It must not be.
  assert.equal(obtainedAnyResponse([{ outcome: 'failed', serverResponded: false, prefillMs: 12 }]), false);
});

test('a self-contradictory record voids the sweep, and is not folded into the response check', () => {
  // Capability degradation can produce several physical attempts, so an earlier
  // `serverResponded: true` satisfies `some(...)` while a later contradictory
  // entry still stands — which is exactly the multi-attempt case where it is most
  // likely and least visible.
  const attempts = [answered, { outcome: 'answered', serverResponded: false }];
  assert.equal(obtainedAnyResponse(attempts), true, 'the earlier entry still witnesses a response');
  assert.match(recordContradiction(attempts), /answered.*serverResponded false/);
  assert.match(recordContradiction([{ outcome: 'refused', serverResponded: false }]), /refused/);
  assert.equal(recordContradiction([answered]), null);
  assert.equal(recordContradiction([{ outcome: 'failed', serverResponded: false }]), null);
});

test('prefill comes from the answering attempt, not a top-level field', () => {
  // `review-report.mjs` spreads `runTimings` onto the SUCCESS envelope only, so
  // the withdrawn draft's `report.prefillMs` was null on every failed episode —
  // precisely the episodes this experiment is about.
  assert.equal(prefillFromAttempts([{ outcome: 'failed', prefillMs: 5 }, answered]), 335_000);
  // Else the last, so it does not break quietly if `--max-attempts 1` ever moves.
  assert.equal(prefillFromAttempts([{ outcome: 'failed', prefillMs: 5 }, { outcome: 'failed', prefillMs: 9 }]), 9);
  assert.equal(prefillFromAttempts([{ outcome: 'failed', prefillMs: null }]), null);
  assert.equal(prefillFromAttempts([]), null);
});

test('a client budget expiry is identifiable, so a reader can see who failed', () => {
  // `http-errors.mjs` names every budget `${budget}-timeout`.
  assert.equal(clientBudgetReason([{ reason: 'deadline-timeout' }]), 'deadline-timeout');
  assert.equal(clientBudgetReason([{ reason: 'transport' }]), null);
  assert.equal(clientBudgetReason(null), null);
});

// ---- the config seam ----

test('the shipped protocol is the default, and it is the canonical one', () => {
  assert.equal(isCanonical(resolveConfig([])), true);
  assert.equal(DEFAULTS.challengeTtlSeconds, 120);
  assert.equal(DEFAULTS.case, 'scaffold');
  // Imported, never a literal: a review REFUSES a budget below its floor rather
  // than sending it, and the only run the first draft ever produced died in ~1s
  // per episode against exactly that.
  assert.ok(DEFAULTS.maxTokens >= 4096);
});

test('any experimental override makes the run non-canonical; the out-dir does not', () => {
  // The done-condition reads this. "A file matching the glob exists" was already
  // satisfied by a junk record from a draft that never dispatched a request.
  assert.equal(isCanonical(resolveConfig(['--challenge-ttl', '5'])), false);
  assert.equal(isCanonical(resolveConfig(['--case', 'docs-only'])), false);
  assert.equal(isCanonical(resolveConfig(['--provider-config', '/tmp/x.json'])), false);
  // Writing the record elsewhere does not change what was measured.
  assert.equal(isCanonical(resolveConfig(['--out-dir', '/tmp/out'])), true);
});

test('a malformed protocol is refused rather than silently defaulted', () => {
  assert.throws(() => resolveConfig(['--nonsense', '1']), /unknown flag/);
  assert.throws(() => resolveConfig(['--episodes']), /needs a value/);
  // What makes an empty episode list unreachable, and with it the `no-episodes`
  // verdict the withdrawn draft could return but no outcome table ever listed.
  for (const bad of ['0', '-1', '2.5']) {
    assert.throws(() => resolveConfig(['--episodes', bad]), /positive integer/);
  }
  assert.throws(() => resolveConfig(['--challenge-ttl', '0']), /must be > 0/);
});
