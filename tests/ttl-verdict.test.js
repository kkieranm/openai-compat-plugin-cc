import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  EPISODE_VERDICTS, EXPOSURE_MARGIN, calibrationCleared, episodeVerdict, summarize, validityChecks,
} from '../bench/lib/ttl-verdict.mjs';

// OAI-34. The decision rule, tested rather than trusted — it is declared in code
// precisely so the reading of the result cannot be chosen after the numbers
// arrive. The I/O half is exercised in `ttl-challenge-e2e.test.js`, which is the
// half OAI-24 never ran.

const ttlMs = 120_000;
const past = 300_000; // clears 120s x 1.5 comfortably — a real exposure
const short = 130_000; // past expiry but INSIDE the margin — not an exposure
const ok = { ttlMs, failed: false, unloadObserved: false, obtainedResponse: true, invalid: [] };

test('importing the driver does not RUN the experiment', () => {
  // Regression, and it bit during this feature: `main()` was called at module
  // scope, so importing it drove `lms`, spawned a review, added 44s to the suite
  // and wrote a junk record into bench/results. The symptom is slow and quiet
  // rather than red, so the guard is asserted rather than assumed.
  const source = readFileSync(new URL('../bench/ttl-challenge.mjs', import.meta.url), 'utf8');
  assert.match(source, /process\.argv\[1\] === new URL\(import\.meta\.url\)\.pathname/);
  assert.doesNotMatch(source, /^main\(/m, 'main must not be called at module scope');
});

test('a request that outlived expiry by the margin is a counterexample', () => {
  assert.equal(episodeVerdict({ ...ok, prefillMs: past }), 'survived-past-expiry');
});

test('a survival that never cleared expiry by the margin tested NOTHING', () => {
  // The episode the experiment must not be allowed to bank. Reading it as a
  // survival would be the run marking its own homework.
  assert.equal(episodeVerdict({ ...ok, prefillMs: short }), 'no-exposure');
});

test('exposure is judged on the MEASURED prefill, never on the wall clock', () => {
  // The clock argument that survives: the driver's origin is child spawn and the
  // server's is request receipt, and the spawn-to-request overhead cancels only
  // when both sides are measured from the plugin's own timing origin. A duration
  // standing in for a prefill reintroduces it — and a request that timed out at
  // 1,800s would "clear" a 180s bar without the model emitting a token.
  assert.equal(episodeVerdict({ ...ok, prefillMs: null }), 'no-exposure');
  assert.equal(episodeVerdict({ ...ok, prefillMs: undefined }), 'no-exposure');
  assert.equal(EXPOSURE_MARGIN, 1.5);
});

test('a SUCCESS alongside an observed absence is a contradiction, never a survival', () => {
  // The request says the model answered; residency says it went away. Reading
  // that as a clean survival banks the episode while hiding that its two
  // instruments disagree.
  assert.equal(
    episodeVerdict({ ...ok, prefillMs: past, unloadObserved: true }),
    'survived-despite-unload',
  );
  const { verdict, says } = summarize(['survived-past-expiry', 'survived-despite-unload']);
  assert.equal(verdict, 'contradictory-evidence');
  assert.match(says, /refutes nothing/);
});

test('a failure is classified by whether an absence was SEEN, and by nothing else', () => {
  assert.equal(
    episodeVerdict({ ...ok, prefillMs: null, failed: true, unloadObserved: true }),
    'failure-with-unload-observed',
  );
  assert.equal(
    episodeVerdict({ ...ok, prefillMs: null, failed: true, unloadObserved: false }),
    'failure-without-unload-observed',
  );
});

test('NO episode verdict names a TTL, an eviction or an expiry', () => {
  // The instrument refutes; it does not confirm. Four designs for a confirming
  // branch each failed on a different axis before it was withdrawn, because
  // proving an unload was post-expiry needs residency observed AFTER expiry —
  // which a mechanism firing AT expiry can never leave behind. A label that says
  // "post-TTL" would assert exactly what cannot be established.
  for (const verdict of EPISODE_VERDICTS) {
    assert.doesNotMatch(verdict, /evict|expiry-unload|post-ttl/i, `"${verdict}" overclaims`);
  }
  const failing = summarize(['failure-with-unload-observed']);
  assert.match(failing.says, /NOT attributed/);
  assert.doesNotMatch(failing.says, /reproduc|confirm/i);
});

test('a voided calibration says WHICH precondition failed, not that the prefill fell short', () => {
  // The false string a wide review reproduced: a calibration whose prefill DID
  // clear the bar but whose preconditions did not hold printed "Calibration did
  // not establish a prefill clearing the shortened TTL", and pointed the operator
  // at the one knob that was already fine.
  const { verdict, says } = summarize([], {
    calibrationCleared: false, calibrationFailures: ['sole-tenancy'], barCleared: true,
  });
  assert.equal(verdict, 'instrument-failed');
  assert.match(says, /sole-tenancy/);
  assert.doesNotMatch(says, /prefill did not clear/);
  assert.doesNotMatch(says, /lower the TTL or pick a longer case/i);
  // The prefill message still prints when the prefill IS what fell short...
  const barOnly = summarize([], { calibrationCleared: false, calibrationFailures: [], barCleared: false }).says;
  assert.match(barOnly, /prefill did not clear/);
  assert.doesNotMatch(barOnly, /conditions this experiment requires/);
  // ...and BOTH print when both failed. Naming only one would have the operator
  // fix it, spend another 45 minutes, and meet the other.
  const both = summarize([], {
    calibrationCleared: false, calibrationFailures: ['ttl-confirmed'], barCleared: false,
  }).says;
  assert.match(both, /ttl-confirmed/);
  assert.match(both, /prefill did not clear/);
  assert.match(both, /fix the precondition; lower the TTL/);
});

test('an episode that obtained no response yields no verdict about the server', () => {
  // A refused --max-tokens, an unreachable server or a materialization throw all
  // exit non-zero having dispatched nothing. This happened for real: an
  // accidental run of the withdrawn draft reported `inconclusive-failure` — a
  // claim about the mechanism — from a run in which no request existed.
  assert.equal(episodeVerdict({ ...ok, prefillMs: null, failed: true, obtainedResponse: false }), 'not-dispatched');
  const { verdict, says } = summarize(['survived-past-expiry', 'not-dispatched']);
  assert.equal(verdict, 'instrument-failed');
  assert.match(says, /says NOTHING about the server/);
  assert.doesNotMatch(says, /refut/i);
});

test('a broken precondition is NOT reported as a failure to dispatch', () => {
  // Both void the sweep, but printing "not-dispatched" for a competing model
  // would be a false string — the defect class this whole feature is about.
  assert.equal(
    episodeVerdict({ ...ok, prefillMs: past, invalid: ['sole-tenancy'] }),
    'instrument-invalid',
  );
  const { verdict, says } = summarize(['instrument-invalid']);
  assert.equal(verdict, 'instrument-failed');
  assert.match(says, /another model resident/);
});

test('the validity checks name what failed, not merely that something did', () => {
  const clean = { appliedTtlMs: ttlMs, requestedTtlMs: ttlMs, competingModels: [], contradiction: null };
  assert.deepEqual(validityChecks(clean), []);
  // G6 — read back from the server, never inferred from `lms load` exiting 0.
  assert.deepEqual(validityChecks({ ...clean, appliedTtlMs: 3_600_000 }), ['ttl-confirmed']);
  assert.deepEqual(validityChecks({ ...clean, appliedTtlMs: null }), ['ttl-confirmed']);
  // G2 — Auto-Evict from another model produces the same client-visible shape.
  assert.deepEqual(validityChecks({ ...clean, competingModels: ['other'] }), ['sole-tenancy']);
  // G8 — a record this module does not understand.
  assert.deepEqual(validityChecks({ ...clean, contradiction: 'x' }), ['record-self-consistent']);
  assert.deepEqual(
    validityChecks({ appliedTtlMs: null, requestedTtlMs: ttlMs, competingModels: ['o'], contradiction: 'x' }),
    ['ttl-confirmed', 'sole-tenancy', 'record-self-consistent'],
  );
});

test('calibration clears only on a MEASURED prefill from a request that answered', () => {
  const base = { obtainedResponse: true, failed: false, challengeTtlMs: ttlMs };
  assert.equal(calibrationCleared({ ...base, prefillMs: past }), true);
  assert.equal(calibrationCleared({ ...base, prefillMs: short }), false);
  // The withdrawn draft used `firstTokenMs ?? durationMs`, so a calibration that
  // timed out at 1,800s "cleared" a 180s bar without the model ever emitting a
  // token — the gate reading a failure as proof of what it exists to establish.
  assert.equal(calibrationCleared({ ...base, prefillMs: null }), false);
  assert.equal(calibrationCleared({ ...base, failed: true, prefillMs: past }), false);
  assert.equal(calibrationCleared({ ...base, obtainedResponse: false, prefillMs: past }), false);
});

test('a failed calibration outranks the empty episode list it produces', () => {
  // Load-bearing ordering. The abort path writes its manifest with NO episodes,
  // so an empty-list check placed above the calibration branch would swallow the
  // one state that must be reported — and the draft threw the record away
  // entirely, leaving the disqualification on stderr only.
  const { verdict, says } = summarize([], { calibrationCleared: false, barCleared: false });
  assert.equal(verdict, 'instrument-failed');
  assert.match(says, /calibration cannot license this sweep/i);
  assert.doesNotMatch(says, /No episodes ran/);
  assert.doesNotMatch(says, /refut/i);
});

test('an empty sweep never refutes anything, because [].every() is TRUE', () => {
  // The vacuous-truth shape this repo keeps finding. Unreachable in production —
  // `--episodes` is validated positive and the abort path is caught above — but
  // "unreachable" is a claim, and a wrong one costs the strongest sentence the
  // instrument can print.
  const { verdict, says } = summarize([], { calibrationCleared: true });
  assert.equal(verdict, 'instrument-failed');
  assert.doesNotMatch(says, /refut/i);
});

test('three clean survivals refute only the DETERMINISTIC form, and say so', () => {
  const survivals = ['survived-past-expiry', 'survived-past-expiry', 'survived-past-expiry'];
  const { verdict, says } = summarize(survivals, { minSlackMs: 215_000 });
  assert.equal(verdict, 'deterministic-form-refuted');
  assert.match(says, /DETERMINISTIC/);
  // The bound travels with the claim. Without it "3/3 survived" reads as "the
  // failure rate is low", which 0 events in 3 does not support.
  assert.match(says, /0 events in 3 is ~63%/);
  assert.doesNotMatch(says, /caused/);
  // And so does the condition the refutation actually rests on: `c` — request
  // serialization and server admission — was never measured.
  assert.match(says, /cleared expiry by 215s/);
  assert.match(says, /provided request serialization and server admission took less than that/);
});

test('the bound is computed from the episode count, never hardcoded', () => {
  // It printed "0 events in 3 is ~63%" for a ONE-episode sweep until a real run
  // with --episodes 1 showed it. A false statistic, in the sentence whose whole
  // job is to stop "they all survived" reading as "the failure rate is low" —
  // and reachable because --episodes is injectable.
  assert.match(summarize(['survived-past-expiry']).says, /0 events in 1 is ~95%/);
  assert.match(summarize(Array(2).fill('survived-past-expiry')).says, /0 events in 2 is ~78%/);
  assert.match(summarize(Array(3).fill('survived-past-expiry')).says, /0 events in 3 is ~63%/);
});

test('the refutation quotes the NARROWEST episode, not an average', () => {
  // A sweep is only as sound as its weakest episode; a mean would let a marginal
  // one ride on its siblings.
  const { says } = summarize(['survived-past-expiry'], { minSlackMs: 4_000 });
  assert.match(says, /cleared expiry by 4s/);
  // With nothing measured, the sentence simply omits the clause rather than
  // printing a slack it does not have.
  assert.doesNotMatch(summarize(['survived-past-expiry']).says, /cleared expiry by/);
});

test('any failure leaves the sweep inconclusive, never confirming', () => {
  for (const failure of ['failure-with-unload-observed', 'failure-without-unload-observed']) {
    const { verdict, says } = summarize(['survived-past-expiry', failure]);
    assert.equal(verdict, 'inconclusive-failure');
    assert.match(says, /may not be named/);
  }
});

test('a sweep where nothing was exposed refutes nothing, and counts rather than asserts', () => {
  assert.match(summarize(['no-exposure', 'no-exposure']).says, /0 of 2 episode\(s\) stayed in flight/);
  // The false sentence the draft printed: "No episode stayed in flight past
  // expiry" for a sweep in which one had.
  const mixed = summarize(['survived-past-expiry', 'no-exposure', 'no-exposure']);
  assert.equal(mixed.verdict, 'no-exposure');
  assert.match(mixed.says, /1 of 3 episode\(s\) stayed in flight/);
});
