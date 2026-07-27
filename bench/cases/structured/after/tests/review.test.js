// /oai:review end to end: the reasoning-channel payload, the degrade-on-
// rejection path, and the refusals that must stay loud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { completion, createRepo, reasoningCompletion, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

const FINDINGS = JSON.stringify({
  findings: [{ file: 'seed.txt', line: 3, severity: 'high', summary: 'the seed is wrong', evidence: 'edited' }],
  summary: 'one real defect',
});

/** A repo with one uncommitted edit, and a config that needs no probing. */
async function scenario(handler, { contextLength = 8192 } = {}) {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const server = await startFakeServer(handler);
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength } },
  });
  return { dir, server, configPath: path };
}

function chatRequests(server) {
  return server.requests.filter((request) => request.url.includes('/chat/completions'));
}

test('findings arriving in the reasoning channel are reported as findings', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondJson(response, reasoningCompletion(FINDINGS)),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 finding\(s\)/);
  assert.match(result.stdout, /high\s+seed\.txt:3/);
  assert.match(result.stdout, /the seed is wrong/);
  assert.match(result.stdout, /unverified claims from a local model/);

  const sent = chatRequests(server)[0].body;
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.match(sent.messages[1].content, /--- DIFF ---/);
});

test('a server that rejects response_format is retried without it', async () => {
  const { dir, server, configPath } = await scenario((request, response) => {
    if (request.body?.response_format) {
      return respondJson(response, { error: "'response_format.type' must be 'json_schema' or 'text'" }, 400);
    }
    return respondJson(response, completion(`Here are the findings:\n\`\`\`json\n${FINDINGS}\n\`\`\``));
  });

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /the seed is wrong/, 'fenced JSON in a plain reply is still findings');
  assert.match(result.stderr, /Retrying without it/, 'a silent retry would hide a schema this plugin got wrong');

  const sent = chatRequests(server);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.response_format, undefined);
  assert.match(sent[1].body.messages[1].content, /JSON Schema/, 'the fallback must ask for the shape in words');
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
    respondJson(response, reasoningCompletion('I had a look and it seems fine to me.')),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.match(result.stdout, /it seems fine to me/);
  assert.match(result.stdout, /has been checked against the code/);
});

test('without a schema, reasoning is never passed off as the review', async () => {
  // The fallback path has no grammar constraint, so this text is scratchpad.
  const { dir, server, configPath } = await scenario((request, response) => {
    if (request.body?.response_format) {
      return respondJson(response, { error: 'response_format unsupported' }, 400);
    }
    return respondJson(response, reasoningCompletion('Let me think about what the diff does...'));
  });

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
    respondJson(response, {
      id: 'chatcmpl-test',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    }),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /empty answer/);
  assert.doesNotMatch(result.stdout, /verbatim/, 'there was nothing to show verbatim');
});

test('a reply cut off mid-JSON blames the token budget, not the model', async () => {
  // We did the truncating, so reporting a "shape" problem sends the user to fix
  // the wrong thing and hides the flag that would work.
  const { dir, server, configPath } = await scenario((request, response) =>
    respondJson(response, {
      id: 'chatcmpl-test',
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '', reasoning_content: '{"findings": [{"file": "a.js", "line": 3, "sev' },
          finish_reason: 'length',
        },
      ],
    }),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ran out of tokens/);
  assert.match(result.stderr, /--max-tokens/);
  assert.doesNotMatch(result.stdout, /verbatim/, 'a fragment we truncated is not a reply worth showing');
});

test('a schema-shaped reply that does not match the schema is not findings', async () => {
  // A server that accepts response_format without enforcing it would otherwise
  // let the first {...} in the scratchpad ship as findings.
  const { dir, server, configPath } = await scenario((request, response) =>
    respondJson(
      response,
      reasoningCompletion('Draft: {"findings": [{"file": "a.js"}]} — no wait, let me reconsider that.'),
    ),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.doesNotMatch(result.stdout, /1 finding\(s\)/, 'a draft that misses required keys is not a finding');
});

test('a diff too large for the window is refused with both numbers', async () => {
  const { dir, server, configPath } = await scenario(
    (request, response) => respondJson(response, reasoningCompletion(FINDINGS)),
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
    respondJson(response, reasoningCompletion(FINDINGS)),
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
    respondJson(response, reasoningCompletion(FINDINGS)),
  );

  const result = await runCompanion(['review', "focus on the guard's edge cases"], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  // The apostrophe must survive: review instructions are prose, not shell syntax.
  assert.match(chatRequests(server)[0].body.messages[1].content, /focus on the guard's edge cases/);
});

test('the review reserves more headroom than a task does', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondJson(response, reasoningCompletion(FINDINGS)),
  );

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  // A review that runs out of tokens mid-JSON returns nothing usable, so the
  // 1024-token task default is not enough.
  assert.equal(chatRequests(server)[0].body.max_tokens, 4096);
});
