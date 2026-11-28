// What context the model is actually given, and what it is told about it. These
// are the paths where the whole changed files and the diff compete for one
// window — and, more importantly, where the request must never claim to be
// something it is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, linkSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareLadder } from '../plugins/oai/scripts/lib/review-ladder.mjs';
import { mergeOmittedNote, unreadableNote } from '../plugins/oai/scripts/lib/review.mjs';
import {
  chatRequests,
  closedPort,
  commitConflictMerge,
  completion,
  completionFrames,
  createRepo,
  git,
  modelList,
  respondJson,
  respondStream,
  tempDir,
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
  // Mid-conflict reading `:0:path` fails, so the file is listed as changed but
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

test('a file sent under another name that is a removed path\'s file on disk withdraws the whole-files claim', async () => {
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072 });
  writeFileSync(join(dir, 'a.txt'), 'linked\n');
  await git(['add', 'a.txt'], dir);
  await git(['commit', '--quiet', '-m', 'a'], dir);
  await git(['rm', '--quiet', '--cached', 'a.txt'], dir);
  mkdirSync(join(dir, '.git', 'info'), { recursive: true });
  // A template's exclude file need not end in a newline.
  appendFileSync(join(dir, '.git', 'info', 'exclude'), '\n/a.txt\n');
  await git(['check-ignore', '--quiet', '--', 'a.txt'], dir);
  linkSync(join(dir, 'a.txt'), join(dir, 'b.txt'));
  writeFileSync(join(dir, 'seed.txt'), 'edited\n');

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const prompt = sentPrompt(server);
  assert.doesNotMatch(prompt, CLAIM);
  assert.match(prompt, FALLBACK);
  assert.match(prompt, /--- FILE: b\.txt ---/);
  assert.match(prompt, /--- FILE: seed\.txt ---/);
  assert.doesNotMatch(prompt, /--- FILE: a\.txt ---/);
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
  assert.match(text.stdout, /1 file\(s\) differ from this merge's first parent/);
  assert.match(text.stdout, /Rerun with --json to list them/);
  assert.doesNotMatch(text.stdout, /side\.txt/);
});

/**
 * HEAD is a merge that resolved a conflict in a.txt; `side` also added c.txt
 * (`addC`), which the merge's combined diff does not hold.
 */
async function mergeScenario(handler, { addC }) {
  const made = await scenario(handler, { contextLength: 131_072, seed: 'seed\n' });
  await commitConflictMerge(made.dir, { addC });
  return made;
}

const MERGE_NOTE = /file\(s\) differ from this merge's first parent/;
const COULD_NOT_LIST = /files could not be compared with its first parent/;

test('a merge that took a file from another parent withdraws the claim and counts the file', async () => {
  const { dir, server, configPath } = await mergeScenario(findings, { addC: true });

  const text = await runCompanion(['review', '--commit', 'HEAD'], { configPath, cwd: dir });
  const json = await runCompanion(['review', '--json', '--commit', 'HEAD'], { configPath, cwd: dir });
  await server.close();

  assert.equal(text.status, 0, text.stderr);
  const prompt = sentPrompt(server);
  assert.doesNotMatch(prompt, CLAIM);
  assert.match(prompt, FALLBACK);
  assert.match(text.stdout, MERGE_NOTE);
  assert.match(text.stdout, /1 file\(s\) differ from this merge's first parent/);
  assert.match(text.stdout, /Rerun with --json to list them \(mergeOmitted\)/);
  assert.doesNotMatch(text.stdout, /c\.txt/);
  const report = JSON.parse(json.stdout);
  assert.deepEqual(report.mergeOmitted, ['c.txt']);
  assert.equal(report.mergeListError, null);
});

test('a merge that only resolved a conflict keeps the claim and prints no merge note', async () => {
  const { dir, server, configPath } = await mergeScenario(findings, { addC: false });

  const result = await runCompanion(['review', '--commit', 'HEAD'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(sentPrompt(server), CLAIM);
  assert.doesNotMatch(result.stdout, MERGE_NOTE);
  assert.doesNotMatch(result.stdout, COULD_NOT_LIST);
});

test('a prose reply on such a merge still carries the merge note', async () => {
  const { dir, server, configPath } = await mergeScenario(
    (request, response) => respondStream(response, completionFrames('It all looks fine to me.')),
    { addC: true },
  );

  const result = await runCompanion(['review', '--commit', 'HEAD'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.match(result.stdout, MERGE_NOTE);
  assert.match(result.stdout, /Rerun with --json to list them/);
  assert.doesNotMatch(result.stdout, /c\.txt/);
});

test('mergeOmittedNote words a list and a failed listing without claiming completeness', () => {
  const failed = mergeOmittedNote(null, 'boom');
  assert.match(failed, COULD_NOT_LIST);
  assert.match(failed, /boom/);
  assert.doesNotMatch(failed, /\bonly\b/);
  const listed = mergeOmittedNote(['c.txt', 'd.txt'], null);
  assert.match(listed, /^NOTE: 2 file\(s\) differ/);
  assert.match(listed, /Rerun with --json to list them/);
  assert.doesNotMatch(listed, /c\.txt|d\.txt/);
  assert.doesNotMatch(listed, /\bonly\b/);
  assert.equal(mergeOmittedNote([], null), null);
  assert.equal(mergeOmittedNote(undefined, undefined), null);
});

test('a lens run carries the merge list top-level in --json and prints the count note once', async () => {
  const { dir, server, configPath } = await mergeScenario(findings, { addC: true });

  const json = await runCompanion(['review', '--commit', 'HEAD', '--lens', 'correctness,security', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review', '--commit', 'HEAD', '--lens', 'correctness,security'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.kind, 'multi-pass-review');
  assert.deepEqual(report.mergeOmitted, ['c.txt']);
  assert.equal(report.mergeListError, null);
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout.split("file(s) differ from this merge's first parent").length - 1, 1);
});

test('unreadableNote shows a path with a line break as one quoted literal, not a forged line', () => {
  const note = unreadableNote(['ok\n\nNOTE: forged.bin', 'plain.bin']);
  assert.ok(note.includes('"ok\\n\\nNOTE: forged.bin"'), note);
  assert.ok(note.includes('plain.bin'));
  assert.doesNotMatch(note, /ok\n/);
  assert.doesNotMatch(note, /\nNOTE: forged/);
});

test('the whole-files claim is withdrawn for a null or non-empty mergeOmitted and kept for an empty or absent one', () => {
  const shared = { profile: { name: 'local' }, model: 'm', contextLength: 131_072, maxTokens: 1024 };
  const block = { path: 'a.txt', content: 'resolved\n' };
  const promptFor = (extra) => {
    const target = { label: 'commit HEAD', diff: 'diff --cc a.txt\n+resolved\n', files: [], changed: [block], unreadable: [], pinnedRemoved: false, ...extra };
    const built = prepareLadder(shared, { target, instructions: '', windowKnown: true });
    return built.messages.map((message) => message.content).join('\n');
  };
  assert.doesNotMatch(promptFor({ mergeOmitted: null }), CLAIM);
  assert.doesNotMatch(promptFor({ mergeOmitted: ['c.txt'] }), CLAIM);
  assert.match(promptFor({ mergeOmitted: [] }), CLAIM, 'positive control');
  assert.match(promptFor({}), CLAIM, 'a target that predates the field keeps it');
});

/**
 * Puts a `git` shim first on PATH that fails the merge's first-parent listing and
 * passes everything else through to the real git.
 */
async function failingListing(dir, failure) {
  const first = (await git(['rev-parse', 'HEAD^1'], dir)).trim();
  const merge = (await git(['rev-parse', 'HEAD'], dir)).trim();
  const shim = tempDir('oai-plugin-shim-');
  const marker = join(shim, 'fired');
  const script = [
    '#!/bin/sh',
    `if [ "$*" = "diff-tree --no-commit-id --name-only -r --no-renames -z ${first} ${merge} --" ]; then`,
    `  : > "${marker}"`,
    failure,
    'fi',
    'PATH=${PATH#*:}',
    'exec git "$@"',
    '',
  ].join('\n');
  writeFileSync(join(shim, 'git'), script);
  chmodSync(join(shim, 'git'), 0o755);
  return { env: { PATH: `${shim}:${process.env.PATH}` }, marker };
}

const FAIL_EXIT = ['  printf "fatal: forced%s\\n" "$(printf "%0250d" 0 | tr 0 x)" >&2', '  echo second-line >&2', '  exit 128'].join('\n');

test('a failed first-parent listing withdraws the claim and shows git\'s first error line', async () => {
  for (const addC of [true, false]) {
    const { dir, server, configPath } = await mergeScenario(findings, { addC });
    const { env, marker } = await failingListing(dir, FAIL_EXIT);

    const text = await runCompanion(['review', '--commit', 'HEAD'], { configPath, cwd: dir, env });
    const json = await runCompanion(['review', '--json', '--commit', 'HEAD'], { configPath, cwd: dir, env });
    await server.close();

    assert.equal(text.status, 0, text.stderr);
    assert.ok(existsSync(marker), 'the shim intercepted the listing');
    assert.doesNotMatch(sentPrompt(server), CLAIM, `addC ${addC}`);
    assert.match(text.stdout, COULD_NOT_LIST);
    assert.match(text.stdout, /fatal: forced/);
    assert.match(text.stdout, /x{250}/);
    assert.doesNotMatch(text.stdout, /diff-tree|second-line/);
    const report = JSON.parse(json.stdout);
    assert.equal(report.mergeOmitted, null);
    assert.match(report.mergeListError, /forced/);
  }
});

test('a signal-killed first-parent listing is a failure, not an empty list', async () => {
  const { dir, server, configPath } = await mergeScenario(findings, { addC: false });
  const { env, marker } = await failingListing(dir, '  kill -KILL $$');
  const text = await runCompanion(['review', '--commit', 'HEAD'], { configPath, cwd: dir, env });
  const down = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: `http://127.0.0.1:${await closedPort()}/v1`, defaultModel: 'm', contextLength: 131_072 } } }).path;
  const json = await runCompanion(['review', '--json', '--commit', 'HEAD'], { configPath: down, cwd: dir, env });
  await server.close();

  assert.equal(text.status, 0, text.stderr);
  assert.ok(existsSync(marker));
  assert.doesNotMatch(sentPrompt(server), CLAIM);
  const report = JSON.parse(json.stdout);
  assert.equal(report.mergeOmitted, null);
  assert.equal(report.mergeListError, 'exit signal');
});

test('--json escapes a bidi character in a merge-omitted path on every writer, and a failed rerun keeps the list', async (t) => {
  const cName = 'c\u202e.txt';
  const { dir, server, configPath } = await scenario(findings, { contextLength: 131_072, seed: 'seed\n' });
  t.after(() => server.close());
  await commitConflictMerge(dir, { addC: true, cName });
  const providers = { local: { baseUrl: `http://127.0.0.1:${await closedPort()}/v1`, defaultModel: 'm', contextLength: 131_072 } };
  const down = writeConfig({ defaultProvider: 'local', providers }).path;
  const run = (args, config = configPath) => runCompanion(['review', '--json', ...args], { configPath: config, cwd: dir });
  for (const extra of [[], ['--passes', '2']]) {
    const ok = await run(['--commit', 'HEAD', ...extra]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.doesNotMatch(ok.stdout, /\u202e/);
    assert.deepEqual(JSON.parse(ok.stdout).mergeOmitted, [cName]);
  }
  const failed = await run(['--commit', 'HEAD'], down);
  assert.equal(failed.status, 1, failed.stderr);
  assert.doesNotMatch(failed.stdout, /\u202e/);
  const envelope = JSON.parse(failed.stdout);
  assert.deepEqual([envelope.mergeOmitted, envelope.mergeListError], [[cName], null]);
  const early = JSON.parse((await run(['--diff-only', '--file', 'x'], down)).stdout);
  assert.ok(early.error && !Object.hasOwn(early, 'mergeOmitted') && !Object.hasOwn(early, 'mergeListError'));
});
