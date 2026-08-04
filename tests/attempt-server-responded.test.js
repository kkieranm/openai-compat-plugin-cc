import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLedger } from '../scripts/lib/attempt-ledger.mjs';
import { EMPTY_COMPLETION, TRANSPORT } from '../scripts/lib/failure-shape.mjs';
import { request } from '../scripts/lib/provider.mjs';
import { closedPort } from './helpers.mjs';

// OAI-35. `serverResponded` answers ONE question — did an HTTP response arrive —
// and the record was blocked on it because nothing else in an attempt entry can
// separate "the server took the request and then died on it" from "nothing was
// ever served". ADR 013's instrument reads that distinction off the record, so
// these pin what the flag means on each closing path rather than merely that the
// key exists.
//
// Scope, corrected in review: this file asks whether the LEDGER carries the flag
// correctly — every test below hands `fail()`/`refuse()` an error and reads the
// entry back. Whether anything SETS it is a different question, and lives in
// `attempt-response-sites.test.js`, which drives the real minting sites through a
// fake server. That split exists because a test here once claimed to guard those
// sites while manufacturing their evidence itself.

/** The rejection, or a failure saying nothing was thrown. */
async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('expected a rejection');
}

/** A cause of the shape every real call site passes. */
const CAUSE = { answerAttempt: 1, degrade: null };
const BODY = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };

/** The single entry left by one `fail(error, timings)` against a fresh ledger. */
function failedEntry(error, timings = {}) {
  const ledger = createLedger();
  ledger.begin({ body: BODY, cause: CAUSE }).fail(error, timings);
  return ledger.entries()[0];
}

test('a refused connection records that nothing responded — from a REAL ECONNREFUSED', async () => {
  // A genuine dial at a closed port, not a synthetic error object. The witnesses
  // in `obtainedResponse` read fields that `provider.mjs` and `http.mjs` set on
  // the way out, so an error minted by the test would be asserting the test's own
  // idea of the failure rather than the transport's.
  const port = await closedPort();
  const error = await caught(request({ name: 'p', baseUrl: `http://127.0.0.1:${port}/v1` }, '/models', {
    firstByteMs: 3_000,
  }));

  // Named, or this passes vacuously. Every unexpected failure of this dial — a
  // DNS answer, a timeout, a bind that never happened — also records `false`, so
  // without pinning the code the assertion below would stay green while testing
  // something else entirely.
  assert.equal(error.code, 'ECONNREFUSED', 'the point is a REFUSED connection, not any failure');

  // `false` is the ABSENCE of an obtained response, and is not a claim about
  // reachability: this dial reached a host whose stack answered with a TCP reset,
  // which is more contact than an `ENOTFOUND` that recorded the same `false`.
  assert.equal(failedEntry(error).serverResponded, false);
});

test('a refusal reclassified by its replacement keeps the `true` its failure recorded', () => {
  // `refuseLast()` forwards NO error — the negotiating layer knows a different
  // shape is going out and has nothing to say about the one that was refused. So
  // deriving the flag in `pendUntilReplaced` from that absent error, instead of
  // setting it unconditionally, would overwrite the correct `true` the preceding
  // `fail()` read off the 400's status with a `false` claiming nothing answered a
  // request the server demonstrably answered. That regression is what this pins.
  const ledger = createLedger();
  ledger.begin({ body: BODY, cause: CAUSE })
    .fail(Object.assign(new Error('response_format unsupported'), { status: 400 }));
  ledger.refuseLast();
  ledger.begin({ body: { ...BODY, messages: [] }, cause: CAUSE }).settle({});

  const [refused] = ledger.entries();
  assert.equal(refused.outcome, 'refused');
  assert.equal(refused.serverResponded, true);
});

test('an entry reclassified to `refused` keeps the flag even with NO status behind it', () => {
  // The sibling above reaches `refused` through `fail({status: 400})`, so the
  // status witness has already written `true` and `markRefused` cannot be seen to
  // preserve anything. Here nothing wrote it but `pendUntilReplaced`'s
  // unconditional line, so this covers the composition the two rely on:
  // `markRefused` sets `outcome` and `reason` ONLY, and a future edit that had it
  // derive the flag from the error it holds — there is none — would mint
  // `{outcome: 'refused', serverResponded: false}`: a record saying nothing
  // answered a request that was answered with a refusal.
  const ledger = createLedger();
  ledger.begin({ body: BODY, cause: CAUSE }).refuse({ reason: null });
  ledger.begin({ body: BODY, cause: CAUSE }).settle({});

  const [reclassified] = ledger.entries();
  assert.equal(reclassified.outcome, 'refused', 'the replacement is what settles the prediction');
  assert.equal(reclassified.serverResponded, true);
});

test('an answered entry says so BY VALUE, not merely by carrying the key', () => {
  // The majority path, and it was untested. Deleting `settle`'s write left all
  // 412 tests green while every answered attempt serialized
  // `{outcome: 'answered', serverResponded: false}` — a self-contradictory record
  // on the commonest outcome of all. The key-set tests could not see it: they
  // assert `Object.keys`, and `newEntry` mints the key as `false` regardless.
  const ledger = createLedger();
  ledger.begin({ body: BODY, cause: CAUSE }).settle({ prefillMs: 5, generationMs: 9 });

  const [entry] = ledger.entries();
  assert.equal(entry.outcome, 'answered');
  assert.equal(entry.serverResponded, true);
});

test('a refusal says so BY VALUE even when no earlier failure recorded it', () => {
  // The sibling hole, and the reason this is a SECOND test rather than an extra
  // assertion on the refusal test above. That one reaches `pendUntilReplaced`
  // through `fail({status: 400})`, which has already written `true` from the
  // status witness — so DELETING the write there leaves the entry correct by
  // accident and the suite green. Measured, not assumed.
  //
  // Reaching it via `refuse(error)` on a fresh entry is what removes the
  // accident: nothing has written the field, so the unconditional `true` is the
  // only thing standing between this and the `false` that `newEntry` minted.
  const ledger = createLedger();
  ledger.begin({ body: BODY, cause: CAUSE }).refuse({ reason: null });

  const [entry] = ledger.entries();
  assert.equal(entry.serverResponded, true, 'a rejected shape is a server answering');
});

test('the ledger copies a flag the transport set, for the families with no other witness', () => {
  // Honest scope, narrowed in review. This drives `fail()` with a hand-built
  // error, so it proves the LEDGER carries the flag across — NOT that any minting
  // site sets it. An earlier version of this test claimed the second thing while
  // doing the first, and a review verifier falsified the claim by deleting the
  // write in `body.mjs`'s `bad-json` branch and watching all 415 tests stay green.
  // The sites are covered in `attempt-response-sites.test.js`; this is the copy.
  //
  // Still worth its own test, because these three reasons are the ones with no
  // second witness: no `.status`, no completion shape, and — where the connection
  // died before any text — no measured prefill either. A `fail()` that stopped
  // reading the flag would lose them silently.
  for (const reason of ['protocol', 'bad-json', TRANSPORT]) {
    const error = Object.assign(new Error(reason), { reason, serverResponded: true });
    assert.equal(
      failedEntry(error).serverResponded, true,
      `a ${reason} failure arrived after headers — the flag is all that says so`,
    );
  }
});

test('a measured prefill is itself a response, whatever the error forgot to say', () => {
  // The witness that does not depend on a minting site REMEMBERING anything, and
  // the reason it was added: `prefillMs` is stamped at the first frame carrying
  // actual text, so model output was served and headers therefore were. It comes
  // from the timings the caller measured, not from a flag someone set.
  //
  // Without it the record could hold `{prefillMs: 7, serverResponded: false}` —
  // model text at seven milliseconds, and nothing answered — which is the exact
  // shape ADR 013's instrument would read as a server that never replied. A
  // backstop, not a live path: every production site that can measure a prefill
  // already sets the flag, so today this fires only where the record would
  // otherwise contradict itself. That is what it is for.
  const entry = failedEntry({ reason: TRANSPORT }, { prefillMs: 7 });

  assert.equal(entry.prefillMs, 7, 'the timing is kept on a failure, which is what makes it readable');
  assert.equal(entry.serverResponded, true);
});

test('a status witness must BE a status code, not merely a property that exists', () => {
  // Two loosenings, each caught a review round apart, each turning "no response"
  // into "a response" for a request that never got one. `!== undefined` admitted
  // `null`; `typeof === 'number'` still admitted `0`, `NaN` and `Infinity`. None
  // is reachable from `http.mjs` or `provider.mjs`, which both assign a real
  // `statusCode` — so this keeps the guard unreachable by CONSTRUCTION rather than
  // by an audit of today's call sites, which is the kind of guarantee that expires
  // quietly the next time a site is added.
  for (const status of [null, undefined, 0, 99, NaN, Infinity, '400']) {
    assert.equal(
      failedEntry(Object.assign(new Error('reset'), { reason: TRANSPORT, status })).serverResponded,
      false,
      `${String(status)} is not an HTTP status code`,
    );
  }
  // And the arm that must still pass, or the loop above is satisfied by a helper
  // that always says no.
  for (const status of [100, 400, 503]) {
    assert.equal(failedEntry(Object.assign(new Error('refused'), { status })).serverResponded, true);
  }
});

test('a prefill witness must be a MEASUREMENT, not merely a non-null', () => {
  // The same loosening on the other witness, and this one had teeth: an
  // `ECONNREFUSED` carrying `{prefillMs: NaN}` correctly recorded `false` before
  // the witness was added and `true` after, because a failed measurement is not
  // null. A `NaN` here is a measurement that did not happen claiming it did.
  for (const prefillMs of [NaN, Infinity, -1, '5', false, {}]) {
    assert.equal(
      failedEntry({ reason: TRANSPORT }, { prefillMs }).serverResponded,
      false,
      `${String(prefillMs)} is not a measured prefill`,
    );
  }
  // Zero is a real measurement — a reply whose first text arrives inside the
  // timer's resolution — and must NOT be swept up with the junk above.
  assert.equal(failedEntry({ reason: TRANSPORT }, { prefillMs: 0 }).serverResponded, true);
});

test('a status refusal records a response WITHOUT marking the prompt cache-warm', () => {
  // The two questions `error.status` now answers, pinned apart. `obtainedResponse`
  // reads it as proof a response WAS obtained; `reachedTheModel` reads the same
  // field as proof the model's prefill was NOT reached, because an HTTP refusal is
  // returned before any generation. They sit adjacent in one file and disagree on
  // purpose, which is precisely the shape a later editor folds into one helper.
  //
  // Collapsing them would mark every degraded run's replacement warm-eligible and
  // so empty the benchmark's cold prefill column on any server that refuses
  // `stream_options` — a deletion of real measurements that leaves no trace, which
  // is why it is asserted rather than left to the comment above `obtainedResponse`.
  const ledger = createLedger();
  ledger.begin({ body: BODY, cause: CAUSE })
    .fail(Object.assign(new Error('bad request'), { status: 400 }));
  ledger.begin({ body: BODY, cause: CAUSE });

  const [refusal, replacement] = ledger.entries();
  assert.equal(refusal.serverResponded, true, 'a status IS a response');
  assert.equal(replacement.warmEligible, false, 'and the prompt it refused was never prefilled');
});

test('each of the four witnesses proves an obtained response on its own', () => {
  // Independent on purpose. Trusting `serverResponded` alone would make the
  // record's correctness depend on every present and future error-minting site
  // remembering one flag — which is not hypothetical: a verifier deleted exactly
  // one such write and nothing went red. A post-response path added later that
  // forgot it would silently record a false negative, a dropped request filed as
  // one nothing ever answered, which is the inversion the flag exists to stop.
  assert.equal(failedEntry(Object.assign(new Error('dropped'), { serverResponded: true })).serverResponded, true);
  assert.equal(failedEntry(Object.assign(new Error('bad request'), { status: 400 })).serverResponded, true);
  assert.equal(failedEntry(Object.assign(new Error('no message'), { reason: EMPTY_COMPLETION })).serverResponded, true);
  assert.equal(failedEntry({ reason: TRANSPORT }, { prefillMs: 1 }).serverResponded, true);

  // And the negative arm, or the four above prove only that the helper returns
  // true: a bare transport failure carries none of the witnesses, and a `false`
  // is the honest reading of it.
  assert.equal(failedEntry(Object.assign(new Error('socket hang up'), { reason: TRANSPORT })).serverResponded, false);
});
