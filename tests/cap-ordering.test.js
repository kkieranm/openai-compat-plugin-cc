import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLedger } from '../scripts/lib/attempt-ledger.mjs';
import { SHAPE_REJECTED } from '../scripts/lib/attempt-outcome.mjs';
import { createNegotiation, postWithDegrade } from '../scripts/lib/chat.mjs';
import { completion, respondJson, startFakeServer } from './helpers.mjs';

// OAI-25: the wall-clock cap's ORDERING against the attempt ledger, driven through
// the real `postWithDegrade` loop under a clock the test controls.
//
// Separate from `failure-shape.test.js`, which scopes itself to the rules in
// isolation — the predicates underneath the end-to-end suites. These are the
// opposite: a real request loop, a real transport, a real ledger, and the one
// thing a live run cannot supply on demand, an expiry falling due at a chosen
// instant. That fixture is why they sit in their own file.
//
// What they exist to answer is a claim this repo made and got wrong. Two guards
// in `structure.test.js` justified themselves with "cannot be reached
// behaviourally"; the already-expired case was reachable all along, and so are
// both cases below.

const CAP_MS = 30_000;

/**
 * Run `body` with `performance.now()` under the test's control, and put the real
 * clock back afterwards however it ends.
 *
 * `capBudgets` reads the bare global, so this needs no seam in production code —
 * which is the point. OAI-25 raised injecting a `now` parameter and it was
 * rejected: a production signature widened for a test is a cost paid forever,
 * and `globalThis.performance` costs one `finally`.
 *
 * The stub delegates to the real clock plus an offset rather than returning a
 * fixed number. Everything downstream of the cap — `prefillMs`, `generationMs`,
 * the transport's own timers — keeps measuring real durations, so an advance
 * here cannot make some unrelated figure absurd and trip an assertion that has
 * nothing to do with this test.
 */
async function withClock(body) {
  const real = globalThis.performance;
  let offset = 0;
  globalThis.performance = { now: () => real.now() + offset };
  try {
    return await body((ms) => {
      offset += ms;
    });
  } finally {
    globalThis.performance = real;
  }
}

/**
 * A ledger whose `begin` and whose returned handle's `refuse` each run a hook
 * after delegating to the real method.
 *
 * The hooks are what make an advance semantic instead of positional. Counting
 * `performance.now()` calls would work today and break the moment `postChat` or
 * `stream-collect.mjs` adds a timing read — coupling these tests to
 * instrumentation they are not about. Each test names the boundary it is about
 * and moves the clock exactly there: "the entry now exists" for one, "the
 * refusal has been recorded" for the other.
 */
function ledgerHooked(ledger, { onBegin = () => {}, onRefuse = () => {} } = {}) {
  return {
    ...ledger,
    begin(options) {
      const handle = ledger.begin(options);
      onBegin();
      return {
        ...handle,
        refuse(error) {
          handle.refuse(error);
          onRefuse();
        },
      };
    },
  };
}

test('a cap falling due after the ledger entry still dispatches the request it checked', async () => {
  // OAI-22's invariant, from the outside. `postWithDegrade` evaluates the cap
  // once and carries the result into `postChat`; if `postChat` re-evaluated it —
  // which it did before OAI-22 — an expiry landing in this window would throw
  // *after* the entry was minted, leaving a record of a physical attempt that
  // never reached a socket and inflating the failure rate OAI-19 reads with the
  // plugin's own deadline.
  //
  // So the clock is moved past expiry at the one instant that distinguishes the
  // two designs: after `ledger.begin`, before the request is written.
  const server = await startFakeServer((request, response) => respondJson(response, completion('hello')));
  const ledger = createLedger();
  let hookRan = false;

  try {
    const result = await withClock(async (advance) => {
      const hooked = ledgerHooked(ledger, {
        onBegin() {
          hookRan = true;
          advance(CAP_MS * 2);
        },
      });
      const budgets = {
        expiresAt: performance.now() + CAP_MS,
        maxMs: CAP_MS,
        ledger: hooked,
        firstTokenMs: 5_000,
        idleMs: 1_000,
      };
      return postWithDegrade(
        { name: 'p', baseUrl: server.baseUrl },
        budgets,
        createNegotiation({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }] }),
      );
    });

    // Vacuity guards, both directions. Without the first this test would pass on
    // a hook that never ran; without the second it would pass on a request the
    // server never saw, which is precisely the failure it claims to exclude.
    assert.equal(hookRan, true, 'the clock never advanced — this test would prove nothing');
    assert.equal(server.requests.length, 1, 'the request must have gone on the wire despite the expiry');
    assert.equal(result.answer.content, 'hello');
    assert.equal(ledger.entries().length, 1, 'one dispatch, one entry — and no phantom beside it');

    // Open, deliberately: `postWithDegrade` hands the handle back unclosed
    // because three of the four delivery failures are only detected a layer up
    // by `finishAnswer`. Asserting `answered` without settling it first would be
    // asserting against `null` and passing for the wrong reason.
    assert.equal(ledger.entries()[0].outcome, null, 'the handle comes back open, for finishAnswer to close');
    result.handle.settle({ prefillMs: 5, generationMs: 5 });
    assert.equal(ledger.entries()[0].outcome, 'answered');
  } finally {
    await server.close();
  }
});

test('a cap falling due after a refusal leaves it a FAILURE, with no entry for the replacement', async () => {
  // OAI-23's invariant on the rung path, and the route to it that nothing drove.
  // `review-budget.test.js` reaches the same `shape-rejected` outcome by having
  // the replacement refused for being oversized; the comment in `chat.mjs` names
  // a second route — the wall-clock cap falling due between the refusal and the
  // replacement — and prose is not a test.
  //
  // `refuse()` closes the entry as the failure it currently is and only PREDICTS
  // the reclassification; `begin` settles it. So a cap that fires first must
  // leave `failed`/`shape-rejected` standing, and must not mint a second entry
  // for a request that was never sent.
  //
  // The clock moves inside the handle's `refuse` — after `pendUntilReplaced` has
  // run and before the loop reaches the replacement's `capBudgets`. That is the
  // boundary this test is named for, and an earlier draft got it wrong in a way
  // worth recording: advancing in the fake server's handler **passed
  // identically**, because it fired while the FIRST request's response was still
  // being written. The assertions held under either placement, so this hook is
  // what makes the fixture match its own description — no coverage claim rides
  // on it. What proves the assertions bite is the mutation: moving `capBudgets`
  // below `ledger.begin` in `postWithDegrade` turns this test red.
  const server = await startFakeServer((request, response) =>
    respondJson(response, { error: 'stream_options is not supported' }, 400));
  const ledger = createLedger();
  let refusalRecorded = false;

  try {
    await withClock(async (advance) => {
      const hooked = ledgerHooked(ledger, {
        onRefuse() {
          refusalRecorded = true;
          advance(CAP_MS * 2);
        },
      });
      const budgets = {
        expiresAt: performance.now() + CAP_MS,
        maxMs: CAP_MS,
        ledger: hooked,
        firstTokenMs: 5_000,
        idleMs: 1_000,
      };

      await assert.rejects(
        postWithDegrade(
          { name: 'p', baseUrl: server.baseUrl },
          budgets,
          createNegotiation({
            model: 'test-model',
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
            stream_options: { include_usage: true },
          }),
        ),
        (error) => error.reason === 'deadline-timeout',
      );
    });

    assert.equal(refusalRecorded, true, 'refuse() never ran, so the cap did not fall due where claimed');
    assert.equal(server.requests.length, 1, 'the replacement was refused by the cap, so it never went out');
    assert.equal(ledger.entries().length, 1, 'no entry may exist for a request that was never sent');
    // Never `refused`. That outcome means a different shape WAS accepted
    // afterwards, and reporting this run as `0 failed, 1 refused` would hide a
    // terminal failure inside routine capability negotiation.
    assert.equal(ledger.entries()[0].outcome, 'failed');
    assert.equal(ledger.entries()[0].reason, SHAPE_REJECTED);
  } finally {
    await server.close();
  }
});
