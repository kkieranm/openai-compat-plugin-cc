// Which budget gets to explain a failure when two of them are due at once.
//
// Its own suite because it is a different question from the rest of the
// transport's tests: those ask what the client *does*, these ask what it
// *says* — and OAI-17 made the second one load-bearing, because `bench/run.mjs`
// now keys on the reason string rather than reading prose.
//
// The five cases below are the whole truth table, and they exist because this is
// the kind of branch that passes every end-to-end test while being backwards: a
// review suite only ever sets a cap shorter than the inner budget, so `<=` and
// `>` are indistinguishable from up there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { send } from '../scripts/lib/http.mjs';
import { readText } from '../scripts/lib/body.mjs';

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) };
}

const caught = (promise) => promise.then(() => null, (error) => error);

const silent = () => serve(() => {
  // Accepted, never answered — so whichever timer is armed is the one that fires.
});

test('a cap shorter than the first-byte budget is what the caller hears about', async () => {
  const server = await silent();
  const error = await caught(
    send(server.url, { firstByteMs: 5_000, totalMs: 120, totalBudget: 'deadline' }).then(readText),
  );
  await server.close();

  assert.equal(error?.reason, 'deadline-timeout');
});

test('a cap exactly equal to the first-byte budget still wins — the tie is decided, not raced', async () => {
  // The case that made registration order tempting. Equal delays: with both
  // timers armed the answer would depend on which was registered first, so the
  // inner one is not armed.
  const server = await silent();
  const error = await caught(
    send(server.url, { firstByteMs: 120, totalMs: 120, totalBudget: 'deadline' }).then(readText),
  );
  await server.close();

  assert.equal(error?.reason, 'deadline-timeout');
});

test('a cap LONGER than the first-byte budget does not swallow it', async () => {
  // The mirror, and the one that makes the three above mean something. Without
  // it, `totalMs <= firstByteMs` could be `totalMs >= firstByteMs` — or the
  // first-byte timer could simply never be armed when a cap exists — and every
  // other test here would still pass.
  const server = await silent();
  const error = await caught(
    send(server.url, { firstByteMs: 120, totalMs: 5_000, totalBudget: 'deadline' }).then(readText),
  );
  await server.close();

  assert.equal(error?.reason, 'first-byte-timeout');
});

test('the control plane keeps reporting first-byte when its total is the same number', async () => {
  // `fetchModels` passes `firstByteMs: 10_000, totalMs: 10_000` — equal, exactly
  // the tie above, but the opposite answer is wanted. `total` is a backstop
  // *behind* first-byte there, and `cmd-setup.mjs` reads `serverResponded` to
  // decide whether to tell someone to start a server it never heard from.
  // Reporting `total-timeout` here would set that flag from a budget that fired
  // before any status line arrived, and the advice would invert.
  const server = await silent();
  const error = await caught(send(server.url, { firstByteMs: 120, totalMs: 120 }).then(readText));
  await server.close();

  assert.equal(error?.reason, 'first-byte-timeout');
  assert.notEqual(error?.serverResponded, true, 'nothing was heard, so nothing may claim the server answered');
});

test('a control-plane total that genuinely outran the first-byte budget still says total', async () => {
  // The mirror for the state-based rule, and the one that stops it over-applying.
  // Reporting `first-byte` is right only when the first-byte budget was *also*
  // due; here it had 5s left and the total fired on its own merits at 120ms, so
  // `total-timeout` is the honest answer. Without this, the condition could be
  // dropped entirely — every other control-plane test would still pass, and
  // /v1/models would start blaming a budget that had not expired.
  const server = await silent();
  const error = await caught(send(server.url, { firstByteMs: 5_000, totalMs: 120 }).then(readText));
  await server.close();

  assert.equal(error?.reason, 'total-timeout');
});

test('the accepted budget ceiling is one a timer can actually express', async () => {
  // The ceiling and the conversion live in different modules — the constant in
  // `http-budgets.mjs` beside the timers, the `* 1000` in `delegate.mjs` beside
  // the flags — so nothing but this asserts they agree. If the constant is ever
  // raised without checking the unit, the flags start accepting a value Node
  // clamps to 1ms, which is the immediate-fire bug the ceiling exists to prevent.
  const { MAX_BUDGET_SECONDS } = await import('../scripts/lib/http-budgets.mjs');
  assert.ok(
    MAX_BUDGET_SECONDS * 1000 <= 2 ** 31 - 1,
    `${MAX_BUDGET_SECONDS}s is ${MAX_BUDGET_SECONDS * 1000}ms, above what setTimeout can express`,
  );
});

test('an unrecognised budget name fails as a bug, not as a crash past the UserError gates', async () => {
  // `totalBudget` is a free-form string threaded through three modules into a
  // message-table lookup. Before this guard an unknown value destructured
  // `undefined` and threw a TypeError — which is not a UserError, so it escaped
  // cmd-setup.mjs's and delegate.mjs's `instanceof` gates and turned one
  // mistyped constant into an exit-2 crash of the whole provider report.
  const { budgetError } = await import('../scripts/lib/http-errors.mjs');
  assert.throws(
    () => budgetError('wall-clock', 1000, 0, 'example.test'),
    (error) => error instanceof Error && /unknown budget/.test(error.message),
  );
});

test('headers followed by silence counts as a server that answered', async () => {
  // The first-byte timer used to infer `serverResponded` from its own name,
  // while the total timer read `state.settled` — so for the equal-delay
  // control-plane pair the two orderings agreed on the reason and disagreed on
  // this field, which is the half of the payload cmd-setup.mjs actually reads.
  const server = await serve((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
  });
  const error = await caught(send(server.url, { firstByteMs: 120 }).then(readText));
  await server.close();

  assert.equal(error?.reason, 'first-byte-timeout');
  assert.equal(error?.serverResponded, true, 'headers arrived, so the server is up — do not tell anyone to start it');
});
