import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deltaFrame, reviewScenario, runCompanion, scriptOf } from './helpers.mjs';

// The sites that MINT `serverResponded` on an error, driven
// through the real CLI and a real fake server.
//
// Split from `attempt-server-responded.test.js`, and the seam is the whole point
// rather than a size split. That file asks whether the LEDGER carries the flag —
// `fail()` is handed an error and the entry is read back. This one asks whether
// anything SETS it, which is a different question and was the one nobody was
// asking: its sibling drove `fail()` with `Object.assign(new Error(r), {reason: r,
// serverResponded: true})`, manufacturing the very evidence it claimed to check,
// while its comment said dropping the write at `sse.mjs`, `body.mjs` or
// `http.mjs` would "go red".
//
// It would not have. A review verifier deleted `failure.serverResponded = true`
// from `body.mjs`'s `bad-json` branch and ran the whole suite: 415 tests, all
// green. So the claim was false, and the class is the one this repo keeps
// finding — a comment asserting a guarantee the code does not provide.
//
// These are the families with no second witness, and every fixture below is
// built to keep it that way. `obtainedResponse` reads a `status`, a completion
// shape, the flag, or a measured `prefillMs`; a `protocol`, `bad-json` or
// delivered-body `transport` failure carries no status and is no completion
// shape, so the flag is the only thing standing between "the server answered and
// then the reply was unusable" and "nothing ever answered" — PROVIDED no model
// text arrived, since text would supply the fourth witness and reconstruct the
// answer without the flag. None of these three sends any, deliberately: the first
// version of this file did, and that case passed with its flag write deleted.
//
// So the rule for anything added here: a fixture must reach its branch with the
// flag as the ONLY evidence, and the mutation must be run rather than reasoned
// about. Three of these have been; the two sites at the end of the file have not,
// and say so.

/**
 * Headers, a ROLE-ONLY delta, then the socket destroyed — bytes delivered, no
 * model text ever sent.
 *
 * `http-errors.mjs`'s `transportError(..., {delivered: true})` — the body-stream
 * catch in `http.mjs`, which only ever runs past headers. The shape a model
 * evicted during prefill produces: no answer, no status, no completion document,
 * and `reason: 'transport'` — identical in every other field to a request that
 * never reached a server.
 *
 * The role-only frame is the whole test, and it took two wrong versions to land
 * on. A frame carrying `content` made this case pass with the flag write deleted:
 * text gives `stream-collect.mjs` a real `prefillMs`, and `obtainedResponse`'s
 * fourth witness then reconstructs `true` from the timing alone — the fix for a
 * vacuous guard had quietly made this guard vacuous. But sending NOTHING misses
 * the branch entirely: with no body bytes the failure never reaches the
 * body-stream catch, so `delivered` is false and no flag is set at all.
 *
 * A role-only delta is exactly the gap between the two. It is bytes off the
 * socket — so the catch runs with `delivered: true` — while carrying no text, so
 * no prefill is stamped. `reachedTheModel`'s own comment names this distinction:
 * `received` counts keepalives and role-only frames, "none of which prove the
 * prompt was prefilled". Here that difference is the test.
 */
const cutAfterRoleOnly = (response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
  response.write(`data: ${JSON.stringify(deltaFrame({ role: 'assistant' }))}\n\n`);
  setTimeout(() => response.socket?.destroy(), 30);
  return undefined;
};

/**
 * A complete non-stream reply that is not JSON — `body.mjs`'s `bad-json` branch.
 *
 * Reached because `chat.mjs` chooses by response SHAPE, not by config: a reply
 * whose content type is not `text/event-stream` is read as one whole document.
 * The body is the classic cause — a proxy login page served where a completion
 * was expected, which is a server answering very definitely.
 */
const notJson = (response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('<html><body>Sign in to continue</body></html>');
  return undefined;
};

/** Headers, then an SSE event that is not JSON — `sse.mjs`'s `protocol` branch. */
const badSseFrame = (response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
  response.end('data: {"choices":[{"delta"\n\n');
  return undefined;
};

/** The single attempt left by one review run against `script`. */
async function attemptFrom(script) {
  const { dir, server, configPath } = await reviewScenario(scriptOf([script]), { contextLength: 131_072 });
  // `finally`, because a throw between here and the close — a companion that
  // never returns, an unparseable envelope — would otherwise leave a listening
  // handle behind and hang the runner long after the assertion that failed.
  let result;
  try {
    result = await runCompanion(['review', '--json', '--max-attempts=1'], { configPath, cwd: dir });
  } finally {
    await server.close();
  }

  assert.equal(result.status, 1, `expected a failed run, got: ${result.stdout.slice(0, 300)}`);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.error, true);
  assert.equal(envelope.attempts.length, 1, 'one attempt, so the assertions below name a single request');
  return envelope.attempts[0];
}

// The reason is asserted alongside the flag on every one of these, and it is not
// decoration: a scenario that stopped reaching its branch — a changed content
// type, a parser that now tolerates the frame — would still produce a failed
// attempt with `serverResponded: true` from some OTHER site, and the test would
// stay green while guarding nothing. Pinning the reason is what keeps each case
// tied to the minting site it was built for.
// Each entry names the site it ACTUALLY reaches, which took a debug stack to
// establish: the first was labelled `http.mjs` and does not go near it. A
// destroyed socket makes the iterator throw, so control leaves through the catch
// and `transportError` mints the error — `http.mjs`'s own comment says as much,
// three lines above the branch this case was wrongly credited with covering.
const SITES = [
  ['http-errors.mjs — transportError on a delivered body', cutAfterRoleOnly, 'transport'],
  ['body.mjs — a whole reply that is not JSON', notJson, 'bad-json'],
  ['sse.mjs — an event that is not JSON', badSseFrame, 'protocol'],
];

for (const [name, script, reason] of SITES) {
  test(`${name} records that the server DID respond`, async () => {
    const attempt = await attemptFrom(script);

    assert.equal(attempt.outcome, 'failed');
    assert.equal(attempt.reason, reason, 'the scenario still reaches the branch it was built for');
    assert.equal(attempt.serverResponded, true);
  });
}

// NOT covered here. Named rather than left to be inferred, because the whole
// reason this file exists is a comment that implied a site was guarded when it
// was not — and the first version of this file then did it again.
//
//   - `http.mjs`'s `!response.complete` branch. It fires when iteration ends with
//     no 'error' event at all, and no fixture here reaches it: a destroyed socket
//     throws from the iterator instead, which `http.mjs`'s own comment states.
//     Deleting its flag write leaves the whole suite green — measured, not
//     assumed. Reaching it needs a reply that ENDS cleanly while short of what it
//     declared, which is a fixture nobody has written. Backlogged, not covered.
//   - `body.mjs`'s oversized-document branch, which mints `protocol` when a reply
//     passes `MAX_COMPLETION_CHARS` without closing its JSON. Reaching it end to
//     end costs 8,000,000 characters over a socket.
//
// Both set the flag by inspection only. That is weaker evidence than every other
// line in this file, and saying so is the point: "guarded by test" is a claim,
// and this repo has now been wrong about it three times in one feature.
