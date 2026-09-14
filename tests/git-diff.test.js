// What gets sent for review. The default target has to include work that is not
// committed yet — including files git does not track at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectTarget } from '../scripts/lib/git-diff.mjs';
import { createRepo, git, tempDir } from './helpers.mjs';

test('the default target is uncommitted work, including untracked files', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  writeFileSync(join(dir, 'brand-new.js'), 'export const added = true;\n');

  const target = await collectTarget({}, dir);

  assert.match(target.diff, /edited/, 'a modified tracked file belongs in the diff');
  assert.deepEqual(
    target.files.map((file) => file.path),
    ['brand-new.js'],
    'a new file is most of what a feature is — reviewing none of it is the failure',
  );
  assert.match(target.files[0].content, /added = true/);
  assert.equal(target.label, 'uncommitted changes');
});

test('staged changes count as uncommitted work', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nstaged\n');
  await git(['add', 'seed.txt'], dir);

  assert.match((await collectTarget({}, dir)).diff, /staged/, 'git diff HEAD must cover the index too');
  assert.match((await collectTarget({ staged: true }, dir)).diff, /staged/);
});

test('--staged ignores what is only in the working tree', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nunstaged\n');

  await assert.rejects(() => collectTarget({ staged: true }, dir), /Nothing to review: staged changes is empty/);
});

test('a clean tree says so and names the overrides', async () => {
  const dir = await createRepo();

  await assert.rejects(
    () => collectTarget({}, dir),
    (error) => {
      assert.match(error.message, /Nothing to review/);
      assert.match(error.hint, /--staged.*--base.*--commit.*--file/);
      return true;
    },
  );
});

test('--commit and --base review history rather than the tree', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'second.txt'), 'second commit\n');
  await git(['add', 'second.txt'], dir);
  await git(['commit', '--quiet', '-m', 'second'], dir);

  const commit = await collectTarget({ commit: 'HEAD' }, dir);
  assert.match(commit.diff, /second commit/);
  assert.equal(commit.label, 'commit HEAD');

  const base = await collectTarget({ base: 'HEAD~1' }, dir);
  assert.match(base.diff, /second commit/);
  assert.equal(base.label, 'branch vs HEAD~1');
});

test('an unknown ref fails loudly rather than reviewing something else', async () => {
  const dir = await createRepo();
  await assert.rejects(() => collectTarget({ commit: 'no-such-ref' }, dir), /git show no-such-ref failed/);
});

test('an untracked binary file is left out', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  writeFileSync(join(dir, 'real.js'), 'export const x = 1;\n');

  const target = await collectTarget({}, dir);
  assert.deepEqual(target.files.map((file) => file.path), ['real.js']);
});

test('an ignored file is not reviewed', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, '.gitignore'), 'ignored.js\n');
  writeFileSync(join(dir, 'ignored.js'), 'export const secret = 1;\n');

  const target = await collectTarget({}, dir);
  assert.deepEqual(target.files.map((file) => file.path), ['.gitignore']);
});

test('--file reviews whole files and needs no repository', async () => {
  const dir = tempDir('oai-plugin-plain-');
  writeFileSync(join(dir, 'lonely.js'), 'export const y = 2;\n');

  const target = await collectTarget({ file: [join(dir, 'lonely.js')] }, dir);
  assert.equal(target.diff, '');
  assert.equal(target.files.length, 1);
  assert.match(target.files[0].content, /y = 2/);
});

test('a modified tracked file is sent whole, alongside the diff', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');

  const target = await collectTarget({}, dir);

  assert.deepEqual(target.changed.map((file) => file.path), ['seed.txt']);
  assert.match(target.changed[0].content, /seed\nedited/, 'the whole file, not just the hunk');
  assert.deepEqual(target.files, [], 'a tracked file is droppable, so it must not be pinned');
});

test('a review run from a subdirectory still reads the changed files', async () => {
  // `git diff --name-status` reports root-relative paths from anywhere, while
  // `git ls-files --others` reports cwd-relative ones. Joining the first onto a
  // subdirectory cwd made every read fail, and a failed read is indistinguishable
  // from a file with nothing to send — whole files would vanish here and the run
  // would look completely normal.
  const dir = await createRepo();
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'deep.txt'), 'original\n');
  await git(['add', 'nested/deep.txt'], dir);
  await git(['commit', '--quiet', '-m', 'nested'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited at the root\n');
  writeFileSync(join(dir, 'untracked.txt'), 'new at the root\n');

  const target = await collectTarget({}, join(dir, 'nested'));

  assert.deepEqual(target.changed.map((file) => file.path), ['seed.txt']);
  assert.match(target.changed[0].content, /edited at the root/, 'the content, not an empty read');
  assert.deepEqual(
    target.files.map((file) => file.path),
    ['untracked.txt'],
    'untracked files are collected from the root too, matching the diff',
  );
});

test('--commit sends the file as it was at that ref, not as it is now', async () => {
  // The defect this guards is reviewing code that was never in the change: the
  // model would be shown the diff for one revision and the body of another.
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\ncommitted\n');
  await git(['commit', '--quiet', '-am', 'second'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nlater edit that is not in the commit\n');

  const target = await collectTarget({ commit: 'HEAD' }, dir);

  assert.deepEqual(target.changed.map((file) => file.path), ['seed.txt']);
  assert.match(target.changed[0].content, /committed/);
  assert.doesNotMatch(target.changed[0].content, /later edit/, 'the working tree is a different revision');
});

test('--staged sends the index blob, not the working tree', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nstaged\n');
  await git(['add', 'seed.txt'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nstaged\nunstaged as well\n');

  const target = await collectTarget({ staged: true }, dir);

  assert.match(target.changed[0].content, /staged/);
  assert.doesNotMatch(target.changed[0].content, /unstaged/, '--staged reviews what would be committed');
});

test('--base sends the file at HEAD, matching the range it diffed', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\non the branch\n');
  await git(['commit', '--quiet', '-am', 'branch work'], dir);

  const target = await collectTarget({ base: 'HEAD~1' }, dir);

  assert.deepEqual(target.changed.map((file) => file.path), ['seed.txt']);
  assert.match(target.changed[0].content, /on the branch/);
});

test('a deleted file has no content to send, and does not fail the review', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'gone.txt'), 'doomed\n');
  await git(['add', 'gone.txt'], dir);
  await git(['commit', '--quiet', '-m', 'add'], dir);
  await git(['rm', '--quiet', 'gone.txt'], dir);
  await git(['commit', '--quiet', '-m', 'remove'], dir);

  const target = await collectTarget({ commit: 'HEAD' }, dir);

  assert.deepEqual(target.changed, [], 'nothing left to read — the diff is all there is');
  assert.match(target.diff, /gone.txt/, 'and the deletion is still reviewed');
});

test("a repository's first commit still sends its files whole", async () => {
  // `git show` prints a root commit's diff, but `git diff-tree` lists nothing
  // for it without --root. The two disagreeing meant whole files vanished for
  // exactly the commit a new repo reviews first, with nothing saying so.
  const dir = await createRepo();

  const target = await collectTarget({ commit: 'HEAD' }, dir);

  assert.deepEqual(target.changed.map((file) => file.path), ['seed.txt']);
});

/** Leaves the repo mid-merge with a conflict in seed.txt. */
async function conflictedMerge(dir) {
  await git(['checkout', '--quiet', '-b', 'other'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'other\n');
  await git(['commit', '--quiet', '-am', 'other'], dir);
  await git(['checkout', '--quiet', 'main'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'main\n');
  await git(['commit', '--quiet', '-am', 'main'], dir);
  await git(['merge', 'other'], dir).catch(() => {}); // Conflicts, by construction.
}

test('a merge commit that resolved a conflict still sends its files whole', async () => {
  // `git show` prints a combined diff for such a merge, but `git diff-tree`
  // lists nothing for it without --cc. The two disagreeing meant the bodies
  // were silently never fetched, for a commit whose content was right there.
  const dir = await createRepo();
  await conflictedMerge(dir);
  writeFileSync(join(dir, 'seed.txt'), 'resolved\n');
  await git(['add', 'seed.txt'], dir);
  await git(['commit', '--quiet', '--no-edit'], dir);

  const target = await collectTarget({ commit: 'HEAD' }, dir);

  assert.ok(target.diff.trim(), 'git show prints a combined diff');
  assert.deepEqual(target.changed.map((file) => file.path), ['seed.txt']);
  assert.match(target.changed[0].content, /resolved/);
});

test('a file whose content cannot be read is recorded, not silently dropped', async () => {
  // Mid-conflict there is no stage-0 blob, so `git show :seed.txt` fails. The
  // path is still listed as changed, so without recording the failure it would
  // vanish from `changed` leaving no trace — and the request would go on to
  // claim it held the complete content of every changed file.
  const dir = await createRepo();
  await conflictedMerge(dir);

  const target = await collectTarget({ staged: true }, dir);

  assert.deepEqual(target.changed, [], 'there is no readable body');
  assert.deepEqual(target.unreadable, ['seed.txt'], 'and the loss is carried out, not swallowed');
});

test('a renamed file is sent under its new path', async () => {
  const dir = await createRepo();
  await git(['mv', 'seed.txt', 'renamed.txt'], dir);
  await git(['commit', '--quiet', '-m', 'rename'], dir);

  const target = await collectTarget({ commit: 'HEAD' }, dir);

  assert.deepEqual(target.changed.map((file) => file.path), ['renamed.txt'], 'the old path has no content');
});

test('a tracked binary file is left out of the whole-file blocks', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x01, 0x02]));
  await git(['add', 'blob.bin'], dir);
  await git(['commit', '--quiet', '-m', 'add blob'], dir);
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');

  const target = await collectTarget({}, dir);

  assert.deepEqual(target.changed.map((file) => file.path), ['seed.txt']);
});

test('--diff-only sends no whole files, which is the point of the flag', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  writeFileSync(join(dir, 'brand-new.js'), 'export const added = true;\n');

  const target = await collectTarget({ 'diff-only': true }, dir);

  assert.deepEqual(target.changed, []);
  assert.deepEqual(
    target.files.map((file) => file.path),
    ['brand-new.js'],
    'an untracked file appears in no diff, so --diff-only must still send it whole',
  );
});

test('an untracked file is never also collected as a changed file', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  writeFileSync(join(dir, 'brand-new.js'), 'export const added = true;\n');

  const target = await collectTarget({}, dir);

  const paths = [...target.files, ...target.changed].map((file) => file.path);
  assert.deepEqual([...new Set(paths)].sort(), paths.sort(), 'a file sent twice wastes the window');
});

test('outside a repository, the default target explains itself', async () => {
  const dir = tempDir('oai-plugin-plain-');
  await assert.rejects(() => collectTarget({}, dir), /Not a git repository/);
});
