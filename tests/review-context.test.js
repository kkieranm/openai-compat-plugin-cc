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
  assert.match(prompt, /complete content of every changed file after the change/);
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
  assert.doesNotMatch(prompt, /complete content of every changed file/, 'nothing was sent whole');
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
  assert.doesNotMatch(sentPrompt(server), /complete content of every changed file/, 'a body never arrived');
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
  assert.doesNotMatch(prompt, /complete content of every changed file/, 'and the claim is still not made');
  // The cause and the remedy, on the path a human reads.
  assert.match(result.stdout, /could not be determined/, 'the report names the cause');
  assert.match(result.stdout, /contextLength/, 'and the remedy');
});

test('--commit reviews a commit end to end, whole files and all', async () => {
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

const HUNKS_NOTE = /only the diff hunks/;

test('an index-only removal goes whole and the report does not say it went as hunks', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072, seed: 'seed\n' });
  await git(['rm', '--quiet', '--cached', 'seed.txt'], dir);

  const text = await runCompanion(['review'], { configPath, cwd: dir });
  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(text.status, 0, text.stderr);
  const prompt = sentPrompt(server);
  assert.match(prompt, /--- FILE: seed\.txt ---/, 'the disk\'s copy');
  assert.match(prompt, /deleted file mode/, 'HEAD\'s copy');
  assert.doesNotMatch(text.stdout, HUNKS_NOTE);
  assert.equal(JSON.parse(json.stdout).hunksOnly, false);
});

const CLAIM = /complete content of every changed file/;
const FALLBACK = /Any file given below in a "--- FILE: ---" block is complete/;

test('a file the diff removes but disk still holds withdraws the whole-files claim', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });
  writeFileSync(join(dir, 'gone.txt'), 'gone\n');
  await git(['add', 'gone.txt'], dir);
  await git(['commit', '--quiet', '-m', 'gone'], dir);
  await git(['rm', '--quiet', '--cached', 'gone.txt'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'edited\n');

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const prompt = sentPrompt(server);
  assert.doesNotMatch(prompt, CLAIM);
  assert.match(prompt, FALLBACK);
  assert.match(prompt, /--- FILE: gone\.txt ---/);
  assert.match(prompt, /--- FILE: seed\.txt ---/);
  assert.match(prompt, /deleted file mode/);
});

test('a rename whose old path is back on disk withdraws the claim, and a plain rename keeps it', async () => {
  const body = 'one\ntwo\nthree\nfour\nfive\nsix\n';
  const run = async (recreate) => {
    const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });
    writeFileSync(join(dir, 'old.txt'), body);
    await git(['add', 'old.txt'], dir);
    await git(['commit', '--quiet', '-m', 'old'], dir);
    await git(['mv', 'old.txt', 'new.txt'], dir);
    if (recreate) writeFileSync(join(dir, 'old.txt'), 'back on disk\n');
    await runCompanion(['review'], { configPath, cwd: dir });
    await server.close();
    return sentPrompt(server);
  };

  assert.doesNotMatch(await run(true), CLAIM);
  assert.match(await run(false), CLAIM);
});

test('a deletion from disk too, and an edit beside an unrelated new file, keep the claim', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });
  writeFileSync(join(dir, 'gone.txt'), 'gone\n');
  await git(['add', 'gone.txt'], dir);
  await git(['commit', '--quiet', '-m', 'gone'], dir);
  await git(['rm', '--quiet', 'gone.txt'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'edited\n');
  writeFileSync(join(dir, 'fresh.txt'), 'fresh\n');

  await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.match(sentPrompt(server), CLAIM);
});

test('a diff of deletions alone withholds nothing', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072, seed: 'seed\n' });
  await git(['rm', '--quiet', 'seed.txt'], dir);

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, HUNKS_NOTE);
});

test('--diff-only on an index-only removal beside a modification still carries the note', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });
  writeFileSync(join(dir, 'gone.txt'), 'gone\n');
  await git(['add', 'gone.txt'], dir);
  await git(['commit', '--quiet', '-m', 'gone'], dir);
  await git(['rm', '--quiet', '--cached', 'gone.txt'], dir);

  const result = await runCompanion(['review', '--diff-only'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(sentPrompt(server), /--- FILE: gone\.txt ---/);
  assert.match(result.stdout, HUNKS_NOTE);
});

test('a tracked file whose read failed keeps the note on the hunks rung', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });
  writeFileSync(join(dir, 'seed.txt'), Buffer.from([0x73, 0x00, 0x65]));

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, HUNKS_NOTE);
  assert.match(result.stdout, /seed\.txt/, 'and the unreadable note names it');
  assert.match(result.stdout, /their contents were not sent, beyond any diff hunks/);
  assert.match(result.stdout, /may just mean it was not sent/);
  assert.doesNotMatch(result.stdout, /same caveat/);
});

test('a failed read beside a file that went whole gets its own note, not the hunks one', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });
  writeFileSync(join(dir, 'blob.bin'), 'text\n');
  await git(['add', 'blob.bin'], dir);
  await git(['commit', '--quiet', '-m', 'blob'], dir);
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x73, 0x00, 0x65]));

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(sentPrompt(server), /--- FILE: seed\.txt ---/);
  assert.doesNotMatch(sentPrompt(server), /complete content of every changed file/, 'blob.bin never arrived');
  assert.doesNotMatch(result.stdout, HUNKS_NOTE);
  assert.match(result.stdout, /blob\.bin/);
  assert.match(result.stdout, /may just mean it was not sent/, 'the note stands alone with no hunks note beside it');
  assert.match(result.stdout, /could not be read or are binary/);
});

test('a clean merge keeps the note: its changes reached the model in neither form', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072, seed: 'seed\n' });
  await git(['checkout', '--quiet', '-b', 'side'], dir);
  writeFileSync(join(dir, 'side.txt'), 'side\n');
  await git(['add', 'side.txt'], dir);
  await git(['commit', '--quiet', '-m', 'side'], dir);
  await git(['checkout', '--quiet', 'main'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nmain\n');
  await git(['commit', '--quiet', '-am', 'main'], dir);
  await git(['merge', '--quiet', '--no-edit', '--no-ff', 'side'], dir);

  const text = await runCompanion(['review', '--commit', 'HEAD'], { configPath, cwd: dir });
  const json = await runCompanion(['review', '--json', '--commit', 'HEAD'], { configPath, cwd: dir });
  await server.close();

  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, HUNKS_NOTE);
  assert.equal(JSON.parse(json.stdout).hunksOnly, true);
});
