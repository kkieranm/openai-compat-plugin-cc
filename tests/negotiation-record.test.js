import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatRequests, completionFrames, modelList, respondJson, respondStream, reviewScenario, runCompanion, scriptOf } from './helpers.mjs';

// The attempt ledger reclassifies a refused request as benign
// capability negotiation only as a consequence of the replacement request
// actually being dispatched. Split from `retry.test.js` at the file size
// budget, and the seam is real: those tests are about a DROPPED request being
// sent again, these about a REFUSED shape being replaced — different events,
// different outcomes in the record.

/** A schema-shaped review reply, so the `--json` record can be asserted. */
const FINDINGS = JSON.stringify({
  analysis: 'read each changed file in full',
  findings: [{ file: 'seed.txt', line: 2, severity: 'high', summary: 'a defect', evidence: 'edited' }],
  summary: 'One defect found.',
});

/**
 * The positive controls, one per call site.
 *
 * The negative case — a refusal whose replacement is never dispatched — is
 * pinned in `failure-shape.test.js` and, end to end, by the oversize case in
 * `review-budget.test.js`: the deadline instance needs a cap falling due inside
 * a window a few call frames wide, so an e2e for it would be a coin flip. These
 * are the other half, and they are what a fix that simply stopped reclassifying
 * anything would fail — the flip must still happen when the replacement is sent.
 */
test('a response_format refusal whose fallback IS sent is recorded as negotiation', async () => {
  const { dir, server, configPath } = await reviewScenario(
    scriptOf([
      (response) => respondJson(response, { error: { message: 'response_format is not supported' } }, 400),
      // The CONTENT channel, not reasoning: without a schema to prove what it
      // is, `requireAnswer` treats the reasoning channel as scratchpad and
      // refuses it — and the degraded rung is precisely the one with no schema.
      (response) => respondStream(response, completionFrames(FINDINGS)),
    ]),
    { contextLength: 131_072 },
  );
  const result = await runCompanion(['review', '--structured-output', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.attempts.length, 2);
  assert.equal(report.attempts[0].outcome, 'refused', 'a different shape was accepted, so this is not unreliability');
  // NOT `shape-rejected`: that code means the shape was rejected and nothing
  // replaced it, and something did. Pinned so the choice stays a decision — and
  // so a `refused` entry stays byte-identical to earlier records.
  assert.equal(report.attempts[0].reason, null);
  assert.equal(report.attempts[1].outcome, 'answered');
  // The fallback rewrites the prompt with the schema as prose, so it is NOT a
  // cache-compatible repeat of the refused request.
  assert.equal(report.attempts[1].warmEligible, false);
});

test('a stream_options refusal whose degraded request IS sent is recorded as negotiation', async () => {
  const { dir, server, configPath } = await reviewScenario(
    scriptOf([
      (response) => respondJson(response, { error: { message: 'stream_options is not supported' } }, 400),
      (response) => respondStream(response, completionFrames(FINDINGS)),
    ]),
    { contextLength: 131_072 },
  );
  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.attempts.length, 2);
  assert.equal(report.attempts[0].outcome, 'refused');
  assert.equal(report.attempts[1].outcome, 'answered');
  // The rung changes only `stream_options`, leaving the messages byte-identical
  // — but a refusal is returned at request validation, before any generation, so
  // nothing was prefilled and this prefill is genuinely cold.
  assert.equal(report.attempts[1].warmEligible, false);
});

// A `--structured-output` review makes up to three calls that must share one
// capability negotiation: the schema request, its `response_format` fallback,
// and a salvage follow-up. If the fallback mints a fresh negotiation it re-offers
// a capability the schema request already had refused — a wasted round trip, a
// duplicate `refused` entry, and a slice of `--max-seconds` spent on it.
//
// The server refuses `stream_options` on ANY body that carries it and
// `response_format` on the schema request, so the sequence is: schema request
// (refuse stream_options) → degraded schema request (refuse response_format) →
// unconstrained fallback. With the shared `removed` state threaded, the fallback
// starts already-degraded and answers on its first request — three chat requests,
// one of which ever carried `stream_options`. A conditional server, not a fixed
// script, because the request COUNT is the thing under test and it differs the
// moment the fix is reverted.
test('a review fallback inherits the schema request degrade instead of re-offering it', async () => {
  const { dir, server, configPath } = await reviewScenario(
    (request, response) => {
      if (request.url.includes('/chat/completions')) {
        const body = request.body ?? {};
        if (body.stream_options) return respondJson(response, { error: { message: 'stream_options is not supported' } }, 400);
        if (body.response_format) return respondJson(response, { error: { message: 'response_format is not supported' } }, 400);
        return respondStream(response, completionFrames(FINDINGS));
      }
      if (request.url.endsWith('/models')) return respondJson(response, modelList('test-model'));
      return respondJson(response, { error: 'not found' }, 404);
    },
    { contextLength: 131_072 },
  );
  const result = await runCompanion(['review', '--structured-output', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  // The whole point: the fallback did not re-offer `stream_options`, so the run
  // cost three chat requests, not four. Reverting the `removed` threading makes
  // this four (the fallback mints a fresh negotiation and re-climbs the ladder).
  const chats = chatRequests(server);
  assert.equal(chats.length, 3, 'the fallback answered on its first request, not after a repeat degrade');
  // Exactly one request ever carried `stream_options` — the schema request. The
  // degraded schema request and the fallback both omit it. Two here is the
  // reverted-threading defect stated as a body fact rather than a count.
  assert.equal(chats.filter((chat) => chat.body?.stream_options).length, 1);

  assert.equal(report.attempts.length, 3);
  assert.equal(report.attempts[0].outcome, 'refused', 'stream_options refused, degraded request sent');
  assert.equal(report.attempts[1].outcome, 'refused', 'response_format refused, fallback sent');
  assert.equal(report.attempts[2].outcome, 'answered');
});
