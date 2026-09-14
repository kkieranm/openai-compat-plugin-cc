// /oai:review end to end on the ORDINARY path: what an unconstrained reply is
// read as, and the refusals that must stay loud.
//
// A review sends no `response_format`, so the reply arrives in the
// content channel and is parsed leniently. The opt-in grammar and everything it
// makes possible live in review-structured.test.js; a test needing
// `--structured-output` belongs there, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chatRequests,
  completion,
  completionFrames,
  deltaFrame,
  reasoningFrames,
  respondJson,
  respondStream,
  reviewScenario as scenario,
  runCompanion,
} from './helpers.mjs';
import { REVIEW_MAX_TOKENS } from '../scripts/lib/review-request.mjs';

const FINDINGS = JSON.stringify({
  analysis: 'walked each changed hunk',
  findings: [{ file: 'seed.txt', line: 3, severity: 'high', summary: 'the seed is wrong', evidence: 'edited' }],
  summary: 'one real defect',
});

// The degrade path, kept covered on purpose: a server that ignores `stream: true`
// answers with a whole JSON completion, and the findings must survive it.
test('a review from a server that ignores stream: true is read as a whole completion', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondJson(response, completion(FINDINGS)),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /the seed is wrong/);
  assert.equal(chatRequests(server)[0].body.stream, true, 'the request asked for a stream regardless');
});

// This is a guard rather than a preference: a
// `response_format` schema makes LM Studio's LLGuidance build a grammar whose
// lexer exhausts a 250,000-state budget at ~14k generated tokens, raising a fatal
// exception in the MLX generation thread and SEGFAULTING the model process — a
// ~38% loss of long requests. So an edit that puts the grammar back on the
// default path does not change how the reply is formatted; it reintroduces a
// crash. The shape still has to be asked for, in prose, or nothing parses.
test('by default no grammar is sent, because a schema crashes the backend', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, completionFrames(FINDINGS)),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const sent = chatRequests(server)[0].body;
  assert.equal(sent.response_format, undefined, 'a grammar here segfaults the MLX backend');
  assert.match(sent.messages[1].content, /JSON Schema/, 'so the shape is named in words instead');
});

test('a 400 that is not about the format is not retried', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondJson(response, { error: 'model "test-model" is not loaded' }, 400),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not loaded/);
  assert.equal(chatRequests(server).length, 1, 'retrying would hide the real error behind a second failure');
});

test('a reply that is not findings is shown verbatim, not interpreted', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, completionFrames('I had a look and it seems fine to me.')),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.match(result.stdout, /it seems fine to me/);
  assert.match(result.stdout, /has been checked against the code/);
});

test('without a schema, reasoning is never passed off as the review', async () => {
  // The default path has no grammar constraint, so this text is scratchpad.
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, reasoningFrames('Let me think about what the diff does...')),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /Let me think/, 'working-out must never be presented as a review');
  assert.match(result.stderr, /only internal reasoning/);
});

test('a reply with nothing in either channel is a failure, not an empty verbatim block', async () => {
  // finish_reason "stop", so the token budget is not the explanation — this
  // must still refuse rather than print an empty "verbatim" block.
  const { dir, server, configPath } = await scenario((request, response) =>
    // The content channel was seen and carried nothing, which is not the same
    // as never having been sent — completionFrames always carries text.
    respondStream(response, [
      deltaFrame({ role: 'assistant', content: '' }),
      { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  // Refused by `finishAnswer` as `blank-completion`, not by the caller
  // downstream. The refusal is the same refusal; what changed is that it now
  // carries a machine-readable shape, so the retry layer and the benchmark can
  // tell this apart from a model that answered badly.
  assert.match(result.stderr, /entirely empty completion/);
  assert.doesNotMatch(result.stdout, /verbatim/, 'there was nothing to show verbatim');
});

test('a reply cut off mid-JSON blames the token budget, not the model', async () => {
  // We did the truncating, so reporting a "shape" problem sends the user to fix
  // the wrong thing and hides the flag that would work.
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, reasoningFrames('{"findings": [{"file": "a.js", "line": 3, "sev', { finishReason: 'length' })),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ran out of tokens/);
  assert.match(result.stderr, /--max-tokens/);
  assert.doesNotMatch(result.stdout, /verbatim/, 'a fragment we truncated is not a reply worth showing');
});

test('a diff too large for the window is refused with both numbers', async () => {
  const { dir, server, configPath } = await scenario(
    (request, response) => respondStream(response, reasoningFrames(FINDINGS)),
    { contextLength: 5000 },
  );
  writeFileSync(join(dir, 'huge.js'), `// ${'x'.repeat(200_000)}\n`);

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /5.0k window/);
  assert.match(result.stderr, /tokens but/);
  assert.equal(chatRequests(server).length, 0, 'oversized input must never reach the server');
});

test('a clean tree refuses rather than reviewing something else', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, reasoningFrames(FINDINGS)),
  );
  writeFileSync(join(dir, 'seed.txt'), 'seed\n'); // back to the committed content

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Nothing to review/);
  assert.match(result.stderr, /--staged/);
});

test('trailing text is forwarded to the reviewer verbatim', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, completionFrames(FINDINGS)),
  );

  const result = await runCompanion(['review', "focus on the guard's edge cases"], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  // The apostrophe must survive: review instructions are prose, not shell syntax.
  assert.match(chatRequests(server)[0].body.messages[1].content, /focus on the guard's edge cases/);
});

test('the reserve never takes more than half a small window', async () => {
  // A flat 16k reserve would refuse every review on a small-window model,
  // blaming an input that would comfortably have fit.
  const { dir, server, configPath } = await scenario(
    (request, response) => respondStream(response, completionFrames(FINDINGS)),
    { contextLength: 8192 },
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chatRequests(server)[0].body.max_tokens, 4096);
});

test('a large window gets the full reasoning budget', async () => {
  const { dir, server, configPath } = await scenario(
    (request, response) => respondStream(response, completionFrames(FINDINGS)),
    { contextLength: 131_072 },
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chatRequests(server)[0].body.max_tokens, REVIEW_MAX_TOKENS);
});

test('the review reserves more headroom than a task does', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, completionFrames(FINDINGS)),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  // A review that runs out of tokens mid-JSON returns nothing usable, so the
  // 1024-token task default is not enough.
  assert.equal(chatRequests(server)[0].body.max_tokens, 4096);
});
