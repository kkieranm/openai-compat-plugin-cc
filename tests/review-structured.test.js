// `/oai:review --structured-output`: the escape hatch, and only the escape hatch.
//
// Split from review.test.js at the size budget, and the seam matches the
// architecture rather than the line count. That file is now the ordinary path — a
// review sends no `response_format` at all — and this one is the opt-in grammar:
// the schema on the wire, the reply channel it forces, the conformance check it
// makes possible, the caps it enforces, and the fallback when a server refuses it.
//
// **A test living here is a test about a code path that is off by default because
// it crashes the backend.** The grammar LM Studio's LLGuidance builds from a
// `response_format` schema exhausts its lexer's 250,000-state budget at roughly
// 14,000 generated tokens, raising a fatal exception in the MLX generation thread
// and taking the model process with it — about 38% of long requests, before
// anyone read the server log. See OAI-51. Nothing in this file describes what an
// ordinary run does, and a test that starts to belongs next door.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatRequests,
  completionFrames,
  reasoningFrames,
  respondJson,
  respondStream,
  reviewScenario as scenario,
  runCompanion,
} from './helpers.mjs';
import { MAX_FINDINGS } from '../scripts/lib/review-schema.mjs';

const FINDINGS = JSON.stringify({
  analysis: 'walked each changed hunk',
  findings: [{ file: 'seed.txt', line: 3, severity: 'high', summary: 'the seed is wrong', evidence: 'edited' }],
  summary: 'one real defect',
});

test('findings arriving in the reasoning channel are reported as findings', async () => {
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, reasoningFrames(FINDINGS)),
  );

  const result = await runCompanion(['review', '--structured-output'], { configPath, cwd: dir });
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
    return respondStream(response, completionFrames(`Here are the findings:\n\`\`\`json\n${FINDINGS}\n\`\`\``));
  });

  const result = await runCompanion(['review', '--structured-output'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /the seed is wrong/, 'fenced JSON in a plain reply is still findings');
  assert.match(result.stderr, /Retrying without it/, 'a silent retry would hide a schema this plugin got wrong');

  const sent = chatRequests(server);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.response_format, undefined);
  assert.match(sent[1].body.messages[1].content, /JSON Schema/, 'the fallback must ask for the shape in words');
});

test('a schema-shaped reply that does not match the schema is not findings', async () => {
  // A server that accepts response_format without enforcing it would otherwise
  // let the first {...} in the scratchpad ship as findings.
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(
      response,
      reasoningFrames('Draft: {"findings": [{"file": "a.js"}]} — no wait, let me reconsider that.'),
    ),
  );

  const result = await runCompanion(['review', '--structured-output'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.doesNotMatch(result.stdout, /1 finding\(s\)/, 'a draft that misses required keys is not a finding');
});

test('a findings list at the schema cap says so, rather than binning the rest quietly', async () => {
  // The schema caps the list, so a reply arriving full may have been cut. That
  // has to be visible: an unreported cut is a real defect silently discarded.
  const capped = JSON.stringify({
    analysis: 'lots to say',
    findings: Array.from({ length: MAX_FINDINGS }, (unused, index) => ({
      file: 'seed.txt',
      line: index + 1,
      severity: 'low',
      summary: `defect ${index}`,
      evidence: 'edited',
    })),
    summary: 'a great many',
  });
  const { dir, server, configPath } = await scenario((request, response) =>
    respondStream(response, reasoningFrames(capped)),
  );

  const result = await runCompanion(['review', '--structured-output'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`hit its limit of ${MAX_FINDINGS}`));
  assert.match(result.stdout, /there may be more/);
});
