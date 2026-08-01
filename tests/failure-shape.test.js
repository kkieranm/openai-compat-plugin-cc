import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLedger } from '../scripts/lib/attempt-ledger.mjs';
import { SHAPE_REJECTED } from '../scripts/lib/attempt-outcome.mjs';
import { createNegotiation, postWithDegrade } from '../scripts/lib/chat.mjs';
import { emptyAnswer, finishAnswer } from '../scripts/lib/completion.mjs';
import { isRetryable } from '../scripts/lib/failure-shape.mjs';

// OAI-20, the rules in isolation. `retry.test.js` drives these through the real
// CLI; these pin the two decisions that a request-count assertion cannot see —
// which replies count as a dropped request, and when a later attempt may be
// called warm-eligible. Split from that file at the size budget, and the seam is
// real: those are end-to-end, these are the predicates underneath.

test('a capability degrade does not make the answering attempt warm-eligible', () => {
  // The messages are byte-identical across a degrade rung — only `stream` and
  // `stream_options` change — so a naive prompt-history check marks the request
  // that actually answers as warm-eligible. On a server that refuses
  // `stream_options` that is EVERY run, and the benchmark's cold prefill column
  // empties itself with no caveat saying why. The prefill was genuinely cold:
  // a refusal is returned at request validation, before any generation.
  //
  // Computed from a real dispatch sequence rather than a hand-set fixture,
  // because a fixture cannot catch a rule about when the key is recorded.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };

  const refused = ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } });
  refused.fail(Object.assign(new Error('stream_options'), { status: 400, reason: null }));

  const degraded = ledger.begin({ body, cause: { answerAttempt: 1, degrade: 'stream_options' } });
  degraded.settle({ prefillMs: 400, generationMs: 100 });

  const [first, second] = ledger.entries();
  assert.equal(first.warmEligible, false);
  assert.equal(second.warmEligible, false, 'a refused request warms nothing, so this prefill is cold');
});

test('a request that reached the model DOES make an identical retry warm-eligible', () => {
  // The other direction, and the case the field exists for: the server took the
  // prompt, got part way, and dropped it. The retry re-sends it byte-for-byte.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };

  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .fail(Object.assign(new Error('dropped'), { reason: 'stream-unfinished' }), { prefillMs: 400 });
  ledger.begin({ body, cause: { answerAttempt: 2, degrade: null } }).settle({ prefillMs: 12 });

  assert.equal(ledger.entries()[1].warmEligible, true);
});

test('a whitespace-only reply is a real reply, not a dropped request', () => {
  // The `.length` / `.trim()` distinction in shape 4, which a mutation check
  // found nothing guarding. A model that answers with whitespace HAS answered —
  // whether that is useful is the caller's decision — and trimming here would
  // classify it as a delivery failure, spend two more requests failing to get it
  // back, and report the server as sick. "The server delivered nothing" must
  // mean nothing is what it delivered.
  const answer = { ...emptyAnswer(), sawContent: true, content: '   \n  ', finishReason: 'stop' };
  const result = finishAnswer(answer, { profile: { name: 'p' }, requestedModel: 'm', sawDone: true, streamed: true });
  assert.equal(result.content, '   \n  ');
});

test('a reply with nothing at all in either channel IS a dropped request', () => {
  const answer = { ...emptyAnswer(), sawContent: true, content: '', finishReason: 'stop' };
  assert.throws(
    () => finishAnswer(answer, { profile: { name: 'p' }, requestedModel: 'm', sawDone: true, streamed: true }),
    (error) => error.reason === 'blank-completion',
  );
});

test('a capability refusal closes as `refused` once the replacement is dispatched', () => {
  // A server that rejects `stream_options` rejects it every time, and the very
  // next request succeeds. Counting that as unreliability would report a server
  // answering 100% of shaped requests as failing half of them — the inversion
  // this record exists to prevent, running the other way.
  //
  // The `begin` below is the dispatch, and it is what settles the refusal — not
  // the `refuse` call. See the abandoned-refusal tests further down.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .refuse(Object.assign(new Error('stream_options'), { status: 400 }));
  ledger.begin({ body: { ...body, stream: false }, cause: { answerAttempt: 1, degrade: 'stream_options' } });

  assert.equal(ledger.entries()[0].outcome, 'refused');
});

test('a capability refusal whose replacement is never dispatched stays a FAILURE', () => {
  // OAI-23. `postWithDegrade` re-checks the wall-clock cap at the top of every
  // iteration, BEFORE `ledger.begin` — so a cap falling due between the refusal
  // and the next dispatch ends the run with nothing replaced. Recorded as
  // negotiation, that terminal failure reads as `0 failed, 1 refused` and
  // understates the reliability figure the benchmark exists to produce.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .refuse(Object.assign(new Error('stream_options'), { status: 400 }));

  assert.equal(ledger.entries()[0].outcome, 'failed');
  // And it is named, not left null: a 400 carries `.status` and never `.reason`,
  // so without this the bench tallies it as `unclassified` beside genuinely
  // unrecognised failures.
  assert.equal(ledger.entries()[0].reason, SHAPE_REJECTED);
});

test('the pending reclassification lands on ITS entry, not on whichever is last', () => {
  // It holds the entry object rather than an index, so a ledger that recorded
  // something else in between could not misfile the flip.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .refuse(Object.assign(new Error('stream_options'), { status: 400 }));
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: 'stream_options' } }).settle({ prefillMs: 5 });

  assert.equal(ledger.entries()[0].outcome, 'refused');
  assert.equal(ledger.entries()[1].outcome, 'answered');
  // One refusal, settled once — the replacement did not inherit it.
  assert.equal(ledger.entries().filter((entry) => entry.outcome === 'refused').length, 1);
});

test('a connection that died before the model spoke does not make the retry warm-eligible', () => {
  // No measured prefill means no model text ever arrived, so the prompt was
  // never processed and the retry's prefill is genuinely cold. Marking it warm
  // would DELETE a real measurement from the benchmark's cold samples with no
  // trace — the failure direction that matters.
  //
  // Deliberately NOT a byte count: `received` counts SSE keepalive comments and
  // role-only frames, which prove the socket was alive and nothing about whether
  // the prompt was prefilled.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .fail(Object.assign(new Error('closed'), { reason: 'transport' }), { prefillMs: null });
  ledger.begin({ body, cause: { answerAttempt: 2, degrade: null } }).settle({ prefillMs: 400 });

  assert.equal(ledger.entries()[1].warmEligible, false);
});

test('a connection that died mid-reply DOES make the retry warm-eligible', () => {
  // The observed incident: a stream dropped ~50,000 characters into reasoning.
  // The model had plainly read the prompt, so an identical retry can be served
  // warm and its prefill is not a cold sample.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .fail(Object.assign(new Error('closed'), { reason: 'transport' }), { prefillMs: 3200, generationMs: 900 });
  ledger.begin({ body, cause: { answerAttempt: 2, degrade: null } }).settle({ prefillMs: 12 });

  assert.equal(ledger.entries()[1].warmEligible, true);
});

test('a 400 is a FAILURE until the layer that negotiates says otherwise', () => {
  // Deliberately not inferred from the status. A context-limit rejection and an
  // invalid request are also 400s and no fallback follows them; calling those
  // "refused" would hide a terminal failure from the reliability count while
  // claiming a different shape had been accepted.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .fail(Object.assign(new Error('context length exceeded'), { status: 400 }));
  assert.equal(ledger.entries()[0].outcome, 'failed');
});

test('the layer that actually sends a different shape marks it as negotiation', () => {
  // `review-request.mjs` calls this after `isFormatRejection` matches, on the
  // branch that does send a degraded request — so the record reflects what
  // happened rather than what a status code hinted at. "Actually sends" is the
  // second `begin`, which is what settles it.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .fail(Object.assign(new Error('response_format unsupported'), { status: 400 }));
  ledger.refuseLast();
  ledger.begin({ body: { ...body, messages: [] }, cause: { answerAttempt: 1, degrade: null } });
  assert.equal(ledger.entries()[0].outcome, 'refused');
});

test('a response_format refusal whose fallback is never dispatched stays a FAILURE', () => {
  // The other half of OAI-23, on the other call site. `degraded()` announces the
  // refusal and then calls `chatCompletion`, whose first act is the same
  // wall-clock cap check that precedes `ledger.begin` — so the fallback can be
  // refused before it is ever sent.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .fail(Object.assign(new Error('response_format unsupported'), { status: 400 }));
  ledger.refuseLast();

  assert.equal(ledger.entries()[0].outcome, 'failed');
  assert.equal(ledger.entries()[0].reason, SHAPE_REJECTED);
});

test('a reclassified entry is still plain data in the record', () => {
  // The hook must not leak into the benchmark's JSON.
  const ledger = createLedger();
  ledger.begin({ body: { model: 'm', messages: [] }, cause: {} }).settle({});
  assert.ok(!Object.keys(ledger.entries()[0]).includes('markRefused'));
  assert.ok(!JSON.stringify(ledger.entries()[0]).includes('markRefused'));
});

test('the request size is recorded, because the characterization asks for it', () => {
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } }).settle({});
  assert.ok(ledger.entries()[0].promptChars > 0);
});

test('a 400 that nobody reclassifies stays a failure', () => {
  // The PRIMITIVE only. This deliberately does not claim to guard the ordering
  // inside `degraded()` — a unit test over the ledger passes whichever order
  // that function uses, which a reviewer proved by reverting the fix and
  // watching this stay green. The ordering guard is the end-to-end test in
  // `tests/review-budget.test.js`, which drives the real call sequence and
  // asserts the recorded outcome.
  const ledger = createLedger();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hello' }] };
  ledger.begin({ body, cause: { answerAttempt: 1, degrade: null } })
    .fail(Object.assign(new Error('response_format unsupported'), { status: 400 }));

  assert.equal(ledger.entries()[0].outcome, 'failed');
});

test('a cap that has ALREADY expired mints no ledger entry at all', () => {
  // OAI-22's behavioural half, and the direction that matters: the record must
  // never contain a physical attempt that never went on the wire. A deadline the
  // caller imposed is not evidence about the server, and an entry for it inflates
  // the failure rate OAI-19 reads with the plugin's own limit.
  //
  // No clock seam needed for this one — an expiry in the past is the expired
  // state. The narrower mid-window case, where the cap falls due *between* the
  // check and the dispatch, is what BACKLOG.md OAI-25 is about; after OAI-22
  // there is no such window left to drive, which is why a structural guard
  // stands for it instead.
  const ledger = createLedger();
  const profile = { name: 'p', baseUrl: 'http://127.0.0.1:1/v1' };
  const budgets = { expiresAt: performance.now() - 1_000, maxMs: 30_000, ledger, firstTokenMs: 5_000, idleMs: 1_000 };

  return postWithDegrade(profile, budgets, createNegotiation({ model: 'm', messages: [] })).then(
    () => assert.fail('an expired cap must refuse, not dispatch'),
    (error) => {
      assert.equal(error.reason, 'deadline-timeout');
      assert.equal(isRetryable(error), false, 'a cap we imposed is not a server failure to retry into');
      assert.deepEqual(ledger.entries(), [], 'no request was sent, so no attempt may be recorded');
    },
  );
});
