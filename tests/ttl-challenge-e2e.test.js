import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHALLENGE_TTL_S, runDriver, runScenario } from './ttl-e2e-harness.mjs';

/**
 * OAI-34 — the TTL challenge instrument, driven END TO END through its real
 * entry point.
 *
 * This file is the reason OAI-34 is not OAI-24. That item built the same
 * instrument, reviewed it twice, found 18 defects and withdrew it — and its own
 * retro named the cause: "the half nominated as 'exercised by running it' was
 * never run, and most of both passes' findings were in it". Reading cannot
 * substitute for executing a module whose job is to decide something.
 *
 * The scaffolding is in `ttl-e2e-harness.mjs`, including why the outer spawn
 * must be asynchronous.
 */

test('the instrument runs end to end and refutes when every episode survives', async () => {
  const { result, manifest } = await runScenario({}, { episodes: 2 });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(manifest, 'a manifest was written to the injected out-dir');
  assert.equal(manifest.outcome.verdict, 'deterministic-form-refuted', JSON.stringify(manifest.outcome));
  assert.equal(manifest.episodes.length, 2);
  for (const episode of manifest.episodes) assert.equal(episode.verdict, 'survived-past-expiry');
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
  assert.equal(episode.verdict, 'survived-despite-unload');
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
  assert.equal(manifest.episodes[0].verdict, 'failure-with-unload-observed');
  assert.match(manifest.outcome.says, /NOT attributed/);
  assert.match(manifest.outcome.says, /JIT-TTL may not be named/);
  assert.doesNotMatch(manifest.outcome.says, /reproduced|confirm/i);
});

test('a failure with no unload observed is distinguished from one with', async () => {
  const { manifest } = await runScenario({}, { failFromCall: 2 });

  assert.equal(manifest.episodes[0].verdict, 'failure-without-unload-observed');
  assert.equal(manifest.episodes[0].unloadAt, null);
  assert.equal(manifest.outcome.verdict, 'inconclusive-failure');
});

test('a competing model voids the sweep rather than becoming a finding', async () => {
  // Auto-Evict from another model produces the same client-visible shape, so the
  // protocol REQUIRES sole tenancy. A violation is an instrument failure.
  const { result, manifest } = await runScenario({ competingModel: { key: 'other/model', fromMs: 50 }, fromLoad: 2 });

  assert.equal(manifest.episodes[0].verdict, 'instrument-invalid');
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
  assert.match(manifest.outcome.says, /Calibration did not establish/);
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
  assert.equal(manifest.episodes[0].verdict, 'not-dispatched');
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
