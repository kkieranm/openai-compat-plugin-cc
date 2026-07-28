// How /oai:review spends the context window, and what it says when it cannot.
// Split from review.test.js at the size budget; these are the paths where the
// reply budget and the input compete for one window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chatRequests,
  completionFrames,
  reasoningCompletion,
  respondJson,
  respondStream,
  reviewScenario as scenario,
  runCompanion,
  sentAnalysisCap,
} from './helpers.mjs';
import { REVIEW_MAX_TOKENS, REVIEW_MIN_TOKENS } from '../scripts/lib/cmd-review.mjs';
import { analysisCapFor, MIN_REVIEW_RESERVE_TOKENS } from '../scripts/lib/review-schema.mjs';

const FINDINGS = JSON.stringify({
  analysis: 'walked each changed hunk',
  findings: [{ file: 'seed.txt', line: 3, severity: 'high', summary: 'the seed is wrong', evidence: 'edited' }],
  summary: 'one real defect',
});

test('a big diff shrinks the reply budget instead of being refused', async () => {
  // A fixed 16k reserve withheld ~12k tokens of window from the input on every
  // review, refusing diffs that fit comfortably with a shorter answer — for the
  // sake of a reply that arrives at that size roughly one run in five.
  const { dir, server, configPath } = await scenario(
    (request, response) => respondJson(response, reasoningCompletion(FINDINGS)),
    { contextLength: 30_000, seed: `seed\n${'const x = 1;\n'.repeat(5_000)}` },
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const sent = chatRequests(server)[0].body.max_tokens;
  assert.ok(sent < REVIEW_MAX_TOKENS, `expected a shrunk reserve, got ${sent}`);
  assert.ok(sent >= REVIEW_MIN_TOKENS, `never below the floor, got ${sent}`);
});

test('an input too large even for the floor is still refused, naming the floor', async () => {
  // Shrinking must not become silent truncation: past the floor the reply is
  // too small to be worth having, and the refusal has to describe that limit
  // rather than a reserve the code would never have used.
  const { dir, server, configPath } = await scenario(
    (request, response) => respondJson(response, reasoningCompletion(FINDINGS)),
    { contextLength: 20_000 },
  );
  writeFileSync(join(dir, 'huge.js'), `// ${'x'.repeat(200_000)}\n`);

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /reserving 4.1k for the reply/);
  assert.equal(chatRequests(server).length, 0, 'oversized input must never reach the server');
});

test('an oversized review is told how to narrow a diff, not how to send fewer files', async () => {
  const { dir, server, configPath } = await scenario(
    (request, response) => respondJson(response, reasoningCompletion(FINDINGS)),
    { contextLength: 20_000 },
  );
  writeFileSync(join(dir, 'huge.js'), `// ${'x'.repeat(200_000)}\n`);

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.match(result.stderr, /--commit/);
  assert.match(result.stderr, /--base/);
  assert.doesNotMatch(result.stderr, /Send fewer or smaller files/, 'that is advice for /oai:task');
});

test('a guard refusal on the retry never claims the retry happened', async () => {
  // The announcement used to come first, so a refusal on the longer degraded
  // prompt arrived right after "Retrying without it" — blaming the diff for a
  // request that was never sent.
  // Sized so the first prompt fits with the floor reserve and the second — the
  // same prompt plus the ~200-token schema instruction — does not. That gap is
  // the only place this ordering is observable.
  // Both attempts land on the diff-only rung here: the whole file is 17.4k
  // tokens and never fits, which is what makes the 8,858 / 9,059 pair the ones
  // that matter. Viable window is 12,954..13,154; measured, not guessed.
  const { dir, server, configPath } = await scenario(
    (request, response) => respondJson(response, { error: 'response_format is not supported' }, 400),
    { contextLength: 13_050, seed: `seed\n${'x'.repeat(29_000)}\n` },
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /Retrying without it/, 'no retry was possible');
  assert.equal(chatRequests(server).length, 1, 'the second request must never be sent');
});

test('a reply budget too small for the schema is refused, not quietly over-committed', async () => {
  // --max-tokens is honoured verbatim and nothing downstream raises it, so this
  // is the one path that can ask for a reply too small to hold the schema about
  // to be sent: the caps would clamp to their floor and the request would go out
  // advertising room the budget cannot pay for.
  const { dir, server, configPath } = await scenario(
    (request, response) => respondJson(response, reasoningCompletion(FINDINGS)),
    { contextLength: 131_072 },
  );

  const result = await runCompanion(['review', '--max-tokens', '1000'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(String(MIN_REVIEW_RESERVE_TOKENS)), 'the refusal names the number');
  assert.equal(chatRequests(server).length, 0, 'nothing may reach the server on a budget that cannot work');
});

test('a small window still gets a review, though the explicit-budget floor would refuse it', async () => {
  // The asymmetry in reserveFor, pinned so it stays a decision rather than
  // reading as a guard someone forgot to apply to the second branch. An explicit
  // --max-tokens below the schema's minimum is a mistake and is refused; a model
  // whose window is merely small is not, and refusing every review on it would
  // deny work that usually succeeds. A reply that does overrun there fails
  // loudly, which is the trade ADR 004 took.
  const { dir, server, configPath } = await scenario(
    (request, response) => respondJson(response, reasoningCompletion(FINDINGS)),
    { contextLength: 6_000 },
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const sent = chatRequests(server)[0].body.max_tokens;
  assert.equal(sent, 3_000, 'the half-window rule still applies');
  assert.ok(sent < MIN_REVIEW_RESERVE_TOKENS, 'and it is deliberately below the explicit-budget floor');
});

test('the degraded rung never advertises a cap its reply budget cannot pay for', async () => {
  // With no grammar the caps are prose in the prompt, and that prompt's own
  // length feeds the token estimate that sets the reserve that sizes the caps —
  // circular. Broken by measuring once with the widest schema, whose instruction
  // is the longest possible, so the reserve it leaves is a lower bound and the
  // advertised cap can only under-state the room available. Wrong in the safe
  // direction rather than merely usually right.
  const { dir, server, configPath } = await scenario((request, response) => {
    if (request.body?.response_format) {
      return respondJson(response, { error: "'response_format.type' must be 'json_schema' or 'text'" }, 400);
    }
    // Plain content, not the reasoning channel: without a grammar that channel
    // is the model's scratchpad and `requireAnswer` refuses it, by design.
    return respondStream(response, completionFrames(FINDINGS));
  }, { contextLength: 30_000 });

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const degraded = chatRequests(server)[1];
  const advertised = Number(degraded.body.messages[1].content.match(/"maxLength":(\d+)/)[1]);
  const affordable = analysisCapFor(degraded.body.max_tokens);
  assert.ok(
    advertised <= affordable,
    `advertised ${advertised} against a budget worth ${affordable}`,
  );
});

test('a cut analysis warns loudly rather than reading as a clean review', async () => {
  // Complete JSON, finish_reason stop, no findings — identical on screen to a
  // review that looked properly and found nothing.
  const cut = (record) => JSON.stringify({
    analysis: 'x'.repeat(sentAnalysisCap(record)),
    findings: [],
    summary: 'No defects found.',
  });
  const { dir, server, configPath } = await scenario(
    (record, response) => respondJson(response, reasoningCompletion(cut(record))),
    { contextLength: 131_072 },
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /still reasoning when it hit its length limit/);
  assert.match(result.stdout, /incomplete/);
});
