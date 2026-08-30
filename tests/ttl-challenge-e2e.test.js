import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EPISODE_VERDICTS } from '../bench/lib/ttl-verdict.mjs';
import { CHALLENGE_TTL_S, runDriver, runScenario } from './ttl-e2e-harness.mjs';

/**
 * The TTL challenge instrument, driven END TO END through its real entry
 * point. Reading cannot substitute for executing a module whose job is to
 * decide something.
 *
 * The scaffolding is in `ttl-e2e-harness.mjs`, including why the outer spawn
 * must be asynchronous.
 */

/**
 * Every episode verdict the e2e matrix reaches, declared once. Each verdict-bearing
 * test below asserts the REAL run produced its entry (so a scenario that stops
 * producing its verdict fails that test), and the reachability guard at the foot of
 * the file proves this set is exactly `EPISODE_VERDICTS` (so a verdict left with no
 * e2e scenario fails the guard). The declared value is what the tests check against
 * reality, so the two cannot drift the way a hand-maintained second list would —
 * the class of drift OAI-34's matrix already lost a row to.
 *
 * The guard's reach is bounded, and the bound is disclosed rather than closed with
 * cross-test state: it proves no `EPISODE_VERDICTS` member is MISSING a scenario,
 * but not that every entry here is genuinely exercised — a fiction entry added
 * alongside an equally fictional `EPISODE_VERDICTS` member would pass. Each entry's
 * reality rests on its own asserting test above, by convention. Accumulating the
 * verdicts a run actually observed would close that, but couples the guard to every
 * test having run (a filtered `--test-name-pattern` would fail it), which is the
 * worse trade for a fixture whose whole value is running end to end.
 */
const E2E_VERDICTS = {
  survived: 'survived-past-expiry',
  noExposure: 'no-exposure',
  survivedDespiteUnload: 'survived-despite-unload',
  failureWithUnload: 'failure-with-unload-observed',
  failureWithoutUnload: 'failure-without-unload-observed',
  notDispatched: 'not-dispatched',
  instrumentInvalid: 'instrument-invalid',
};

test('the instrument runs end to end and refutes when every episode survives', async () => {
  const { result, manifest } = await runScenario({}, { episodes: 2 });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(manifest, 'a manifest was written to the injected out-dir');
  assert.equal(manifest.outcome.verdict, 'deterministic-form-refuted', JSON.stringify(manifest.outcome));
  assert.equal(manifest.episodes.length, 2);
  for (const episode of manifest.episodes) assert.equal(episode.verdict, E2E_VERDICTS.survived);
  // The condition the refutation rests on travels WITH it rather than living in
  // a doc nobody reads beside the number.
  assert.match(manifest.outcome.says, /provided request serialization and server admission/);
  // The bound tracks the EPISODE COUNT — two here, not the shipped three. It was
  // hardcoded at 63% until a real one-episode run printed that for n=1.
  assert.match(manifest.outcome.says, /0 events in 2 is ~78%/, 'the bound travels with the claim');
});

test('the manifest describes the run that happened, not the shipped protocol', async () => {
  const { manifest } = await runScenario({}, { episodes: 2 });

  // Built from the EFFECTIVE config. A record asserting the 120s protocol while a
  // 0.4s harness ran is worse than no record at all.
  assert.equal(manifest.protocol.challengeTtlSeconds, CHALLENGE_TTL_S);
  assert.equal(manifest.protocol.episodes, 2);
  assert.equal(manifest.protocol.canonical, false, 'a harness run is never the shipped experiment');
  // The parse of the real `lms version` banner, which is ANSI art rather than a
  // version string.
  assert.equal(manifest.environment.lmsCommit, 'stubc0de');
});

test('observation quality is RECORDED and decides nothing', async () => {
  // The model vanishes mid-episode while the request still succeeds: the two
  // instruments disagree, which must be reported rather than banked.
  const { manifest } = await runScenario({ unloadAtMs: 300 });

  assert.equal(manifest.outcome.verdict, 'contradictory-evidence');
  const [episode] = manifest.episodes;
  assert.equal(episode.verdict, E2E_VERDICTS.survivedDespiteUnload);
  // Present in the record...
  assert.equal(typeof episode.unloadAt, 'number');
  assert.ok('bracketMs' in episode && 'lastPresentAt' in episode);
  assert.ok('activityObserved' in episode && 'exposureRatio' in episode);
  // ...and NOT attributed. No field or sentence names a TTL eviction.
  assert.doesNotMatch(JSON.stringify(manifest.outcome), /evict/i);
  assert.doesNotMatch(JSON.stringify(manifest.episodes.map((e) => e.verdict)), /ttl|evict|expiry/i);
});

test('a failure with an unload observed is inconclusive, never a mechanism claim', async () => {
  // The episode this whole experiment is pointed at: the request fails and the
  // model is gone. Four gate rounds established the instrument may NOT read that
  // as the mechanism firing, so this is the pin for that.
  const { manifest } = await runScenario({ unloadAtMs: 300 }, { failFromCall: 2 });

  assert.equal(manifest.outcome.verdict, 'inconclusive-failure');
  assert.equal(manifest.episodes[0].verdict, E2E_VERDICTS.failureWithUnload);
  assert.match(manifest.outcome.says, /NOT attributed/);
  assert.match(manifest.outcome.says, /JIT-TTL may not be named/);
  assert.doesNotMatch(manifest.outcome.says, /reproduced|confirm/i);
});

test('a failure with no unload observed is distinguished from one with', async () => {
  const { manifest } = await runScenario({}, { failFromCall: 2 });

  assert.equal(manifest.episodes[0].verdict, E2E_VERDICTS.failureWithoutUnload);
  assert.equal(manifest.episodes[0].unloadAt, null);
  assert.equal(manifest.outcome.verdict, 'inconclusive-failure');
});

test('a competing model voids the sweep rather than becoming a finding', async () => {
  // Auto-Evict from another model produces the same client-visible shape, so the
  // protocol REQUIRES sole tenancy. A violation is an instrument failure.
  const { result, manifest } = await runScenario({ competingModel: { key: 'other/model', fromMs: 50 }, fromLoad: 2 });

  assert.equal(manifest.episodes[0].verdict, E2E_VERDICTS.instrumentInvalid);
  assert.deepEqual(manifest.episodes[0].validityFailures, ['sole-tenancy']);
  assert.equal(manifest.outcome.verdict, 'instrument-failed');
  assert.match(manifest.outcome.says, /says\s+NOTHING about the server/);
  assert.equal(result.status, 1, 'an instrument failure exits non-zero');
});

test('a TTL the server never applied cannot be classified', async () => {
  // Read back rather than inferred from `lms load` exiting 0 — otherwise an
  // episode that silently ran under the default TTL is scored as though it had
  // not.
  const { manifest } = await runScenario({ appliedTtlMs: 999_000, fromLoad: 2 });

  assert.deepEqual(manifest.episodes[0].validityFailures, ['ttl-confirmed']);
  assert.equal(manifest.outcome.verdict, 'instrument-failed');
});

test('a calibration that never cleared the bar writes its record and exits non-zero', async () => {
  // The withdrawn draft THREW here, discarding the evidence; an earlier one
  // printed "ABORT" and ran the full sweep anyway, exiting 0 with a
  // normal-looking record. The disqualification must be machine-readable.
  const { result, manifest } = await runScenario({}, { extraArgs: ['--calibration-ttl', '60', '--challenge-ttl', '600'] });

  assert.equal(result.status, 1, 'a disqualified sweep must not exit 0');
  assert.ok(manifest, 'the record survives the abort');
  assert.equal(manifest.outcome.verdict, 'instrument-failed');
  assert.match(manifest.outcome.says, /calibration cannot license this sweep/i);
  assert.match(manifest.outcome.says, /prefill did not clear/);
  assert.deepEqual(manifest.episodes, [], 'no challenge episode ran');
  // The ordering that makes this reachable: an empty episode list must not be
  // read before the calibration failure that produced it.
  assert.doesNotMatch(manifest.outcome.says, /No episodes ran/);
});

test('an episode that never got a response says NOTHING about the server', async () => {
  // The state an accidental run of the withdrawn draft was in: no request
  // existed, and it rendered `inconclusive-failure` — a verdict about the
  // mechanism — anyway. The socket is destroyed before any headers, so
  // `serverResponded` stays false and this is not merely "a failure".
  //
  // Calibration must still clear, or the sweep would be disqualified one step
  // earlier and this path would never be reached.
  const { result, manifest } = await runScenario({}, { destroyFromCall: 2 });

  assert.equal(manifest.episodes[0].obtainedResponse, false);
  assert.equal(manifest.episodes[0].verdict, E2E_VERDICTS.notDispatched);
  assert.equal(manifest.outcome.verdict, 'instrument-failed');
  assert.match(manifest.outcome.says, /never obtained a response/);
  assert.doesNotMatch(manifest.outcome.says, /refut|inconclusive/i);
  assert.equal(result.status, 1);
});

test('a calibration run under broken preconditions does not license the sweep', async () => {
  // The gate everything else rests on used to be judged on `obtainedResponse`,
  // `failed` and `prefillMs` alone — so it could clear while another model was
  // resident or the server never applied the TTL it was asked for. `fromLoad`
  // defaults to 1, so the fault is present for the calibration itself.
  const { result, manifest } = await runScenario({ competingModel: { key: 'other/model', fromMs: 50 } });

  assert.equal(manifest.calibration.cleared, false);
  assert.deepEqual(manifest.calibration.validityFailures, ['sole-tenancy']);
  assert.deepEqual(manifest.episodes, [], 'no challenge episode may run on an unlicensed calibration');
  assert.equal(manifest.outcome.verdict, 'instrument-failed');
  // The SENTENCE, not just the verdict. This episode's prefill actually cleared
  // the exposure bar — a wide review reproduced exactly that — so a message
  // blaming the prefill would be false and would send the operator to the wrong
  // knob.
  assert.match(manifest.outcome.says, /sole-tenancy/);
  assert.doesNotMatch(manifest.outcome.says, /prefill clearing the shortened TTL/);
  assert.equal(result.status, 1);
});

test('an episode whose prefill never cleared the bar is no-exposure, not a survival', async () => {
  // The wasted-episode verdict, driven end to end for the first time. It cannot be
  // reached with a single fixed reply delay: calibration must CLEAR the exposure
  // bar to license the sweep, and the challenge episode must NOT clear the SAME bar
  // (both use `challengeTtlMs × EXPOSURE_MARGIN`). So the calibration reply (call 1)
  // stays at the clearing 500ms while the challenge reply (call 2) drops to 100ms,
  // below the 300ms bar.
  const { result, manifest } = await runScenario({}, { replyDelayMs: 100, replyDelayFromCall: 2 });

  assert.equal(manifest.calibration.cleared, true, 'the slow calibration reply still licenses the sweep');
  assert.equal(manifest.episodes[0].verdict, E2E_VERDICTS.noExposure);
  // The SWEEP consequence, not just the episode: an all-no-exposure sweep must read
  // as tested-nothing, which is what this verdict exists to stop being banked as a
  // silent success. It is not a conclusive outcome, so the driver exits non-zero.
  assert.equal(manifest.outcome.verdict, 'no-exposure');
  assert.match(manifest.outcome.says, /too few to refute anything/);
  assert.equal(result.status, 1, 'a sweep that tested nothing must not exit 0');
});

test('a residency poll that returns garbage is recorded as unreadable, not as an unload', async () => {
  // `unreadableFromMs` makes `lms ps` emit non-JSON once the episode is under way.
  // The instrument must count that as "could not read residency" (`unreadableSamples`)
  // and NOT as "the model is gone" — an unreadable poll is not an unload, so the
  // episode still survives past expiry rather than reading as an absence.
  const { manifest } = await runScenario({ unreadableFromMs: 100 });

  const [episode] = manifest.episodes;
  assert.ok(episode.unreadableSamples > 0, 'the garbage polls were counted as unreadable');
  assert.equal(episode.unloadAt, null, 'an unreadable poll is not read as an unload');
  assert.equal(episode.verdict, E2E_VERDICTS.survived);
});

test('the driver reads and forwards the attempt record the rules consume', async () => {
  // G8 (an `answered` attempt with `serverResponded: false`) is structurally
  // impossible for a fake server to produce — `attempt-outcome.mjs`'s closers set
  // the flag directly — so it is pinned by a unit test on the pure rule instead.
  // What CAN be proved here is the plumbing that rule depends on: the attempts
  // array reaching the driver at all.
  const { manifest } = await runScenario({});

  const [episode] = manifest.episodes;
  assert.ok(Array.isArray(episode.attempts) && episode.attempts.length >= 1);
  assert.equal(episode.attempts[0].serverResponded, true);
  assert.equal(episode.obtainedResponse, true);
  assert.equal(typeof episode.prefillMs, 'number', 'prefill came from the attempt, not a top-level field');
});

test('an unknown flag is refused rather than swallowed', async () => {
  const result = await runDriver(['--nonsense', '1'], {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown flag: --nonsense/);
});

test('--episodes must be a positive integer', async () => {
  // What makes an empty episode list unreachable, and with it the `no-episodes`
  // verdict the withdrawn draft could return but no outcome table ever listed.
  for (const bad of ['0', '-1', '2.5']) {
    const result = await runDriver(['--episodes', bad], {});
    assert.equal(result.status, 1, `--episodes ${bad} must be refused`);
    assert.match(result.stderr, /--episodes must be a positive integer/);
  }
});

test('every episode verdict is reachable through the real e2e matrix', () => {
  // OAI-34's rule: every verdict-bearing check gets a scenario crossing the real
  // entry point. This is the mechanical guard the tracker asked be kept, so the
  // next hole fails the suite instead of waiting for a review to find it — a
  // `no-exposure` scenario went missing until one did.
  //
  // Nothing is subtracted from `EPISODE_VERDICTS`. The one STATED exemption (G8) is
  // not a verdict left uncovered: it is the MECHANISM by which `instrument-invalid`
  // can arise — an `answered` attempt with `serverResponded: false`, which a fake
  // server cannot produce (see the attempt-record test above) — so that verdict is
  // still reached e2e by the competing-model scenario, and only the G8 SHAPE of it
  // is pinned by a unit test on the pure rule. The reachable set is therefore all
  // seven, and `E2E_VERDICTS` is proven complete against the source of truth.
  assert.deepEqual(
    [...new Set(Object.values(E2E_VERDICTS))].sort(),
    [...EPISODE_VERDICTS].sort(),
  );
});
