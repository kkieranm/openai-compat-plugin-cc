import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionFrames, respondJson, respondStream, reviewScenario, runCompanion, scriptOf } from './helpers.mjs';

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
