// What context the model is actually given, and what it is told about it.
// Split from review.test.js at the size budget. These are the paths where the
// whole changed files and the diff compete for one window — and, more
// importantly, where the request must never claim to be something it is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chatRequests,
  completion,
  createRepo,
  git,
  modelList,
  respondJson,
  reviewScenario as scenario,
  runCompanion,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';

const FINDINGS = JSON.stringify({
  analysis: 'read each changed file in full',
  findings: [],
  summary: 'No defects found.',
});

const findings = (request, response) => respondJson(response, completion(FINDINGS));

/** The user message of the nth chat request — what the model actually saw. */
function sentPrompt(server, index = 0) {
  return chatRequests(server)[index].body.messages[1].content;
}

test('a changed file is sent whole, and the model is told it is whole', async () => {
  // The false positive this removes: with only the hunks, an identifier defined
  // elsewhere in the file reads as undefined, and the system prompt's "never
  // speculate about code you were not shown" makes reporting it the correct move.
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const prompt = sentPrompt(server);
  assert.match(prompt, /--- FILE: seed\.txt ---/, 'the whole file, not just the hunk');
  assert.match(prompt, /complete current content of every changed file/);
  assert.match(prompt, /--- DIFF ---/, 'the diff still says what changed');
});

test('whole files that do not fit fall back to the diff, and the findings say so', async () => {
  // Sized between the two rungs: whole+diff is 17.4k tokens and cannot fit,
  // diff alone is 8.9k and can. Measured against the real estimator.
  const { dir, server, configPath } = await scenario(findings, {
    contextLength: 16_000,
    seed: `seed\n${'x'.repeat(29_000)}\n`,
  });

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const prompt = sentPrompt(server);
  assert.doesNotMatch(prompt, /--- FILE: seed\.txt ---/, 'the whole file could not fit');
  assert.match(prompt, /do not report an identifier as undefined/, 'the model must be warned off the claim');
  assert.match(result.stdout, /only the diff hunks/, 'and so must the reader of the findings');
});

test('--diff-only still carries the caveat, and never claims completeness', async () => {
  // The caveat describes what the model saw, not why, so it holds whether the
  // files did not fit or were not asked for. Wording it by cause is how a
  // warning ends up asserting something its path cannot support — the class
  // .claude/REPO_TRAPS.md keeps recording.
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });

  const result = await runCompanion(['review', '--diff-only'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const prompt = sentPrompt(server);
  assert.doesNotMatch(prompt, /--- FILE: seed\.txt ---/);
  assert.doesNotMatch(prompt, /complete current content/, 'nothing was sent whole');
  assert.match(result.stdout, /only the diff hunks/);
});

test('a file that could not be read is named, and voids the completeness claim', async () => {
  // Mid-conflict `git show :path` fails, so the file is listed as changed but
  // has no body. Without carrying that out, it vanishes from `changed` with no
  // trace and the prompt goes on to vouch for content that never arrived.
  const dir = await createRepo();
  await git(['checkout', '--quiet', '-b', 'other'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'other\n');
  await git(['commit', '--quiet', '-am', 'other'], dir);
  await git(['checkout', '--quiet', 'main'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'main\n');
  await git(['commit', '--quiet', '-am', 'main'], dir);
  await git(['merge', 'other'], dir).catch(() => {});

  const server = await startFakeServer(findings);
  const { path: configPath } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 131_072 } },
  });

  const result = await runCompanion(['review', '--staged'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(sentPrompt(server), /complete current content/, 'a body never arrived');
  assert.match(result.stdout, /could not be read/);
  assert.match(result.stdout, /seed\.txt/);
});

test('an untracked file is never dropped to make room', async () => {
  // It appears in no diff, so dropping it reviews nothing while reporting a
  // clean pass. Only tracked files, whose hunks survive in the diff, are
  // droppable.
  const { dir, server, configPath } = await scenario(findings, {
    contextLength: 16_000,
    seed: `seed\n${'x'.repeat(29_000)}\n`,
  });
  writeFileSync(join(dir, 'brand-new.js'), 'export const added = true;\n');

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const prompt = sentPrompt(server);
  assert.match(prompt, /--- FILE: brand-new\.js ---/, 'the request is the only copy of this code');
  assert.doesNotMatch(prompt, /--- FILE: seed\.txt ---/, 'the droppable one still went');
});

test('--diff-only with --file refuses instead of sending nothing', async () => {
  const { dir, server, configPath } = await scenario(findings);
  writeFileSync(join(dir, 'lonely.js'), 'export const y = 2;\n');

  const result = await runCompanion(['review', '--diff-only', '--file', join(dir, 'lonely.js')], {
    configPath,
    cwd: dir,
  });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--diff-only cannot be combined with --file/);
  assert.equal(chatRequests(server).length, 0, 'an empty review reads exactly like a clean one');
});

test('an unknown window withholds the files, and the report says why', async () => {
  // With no window figure the guard is unarmed, so the request could be
  // silently truncated server-side — sending a whole file and calling it
  // complete would be the actual defect. Withholding the file body costs
  // less than it looks: a cold process building a large prompt against a
  // small window can die outright (empty completion, no retries recover it)
  // rather than merely degrade, so there is no safe way to send it anyway.
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const server = await startFakeServer((request, response) => {
    if (request.url.includes('/models')) return respondJson(response, modelList('test-model'));
    return respondJson(response, completion(FINDINGS));
  });
  const { path: configPath } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model' } },
  });

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const prompt = sentPrompt(server);
  // The witness is what the SERVER received, not what the report said about it.
  assert.doesNotMatch(prompt, /--- FILE: seed\.txt ---/, 'the body is withheld: nothing could size it');
  assert.doesNotMatch(prompt, /complete current content/, 'and the claim is still not made');
  // The cause and the remedy, on the path a human reads.
  assert.match(result.stdout, /could not be determined/, 'the report names the cause');
  assert.match(result.stdout, /contextLength/, 'and the remedy');
});

test('--commit reviews a commit end to end, whole files and all', async () => {
  // No CLI-level coverage of any non-default target existed before this item,
  // and this is the surface it changes.
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const server = await startFakeServer(findings);
  const { path: configPath } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 131_072 } },
  });

  const result = await runCompanion(['review', '--commit', 'HEAD'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Reviewing commit HEAD/);
  assert.match(sentPrompt(server), /--- FILE: seed\.txt ---/);
});
