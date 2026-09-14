// What gets sent for review. The default target has to include work that is not
// committed yet — including files git does not track at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectTarget } from '../scripts/lib/git-diff.mjs';
import { createRepo, git } from './helpers.mjs';

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
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-plain-'));
  writeFileSync(join(dir, 'lonely.js'), 'export const y = 2;\n');

  const target = await collectTarget({ file: [join(dir, 'lonely.js')] }, dir);
  assert.equal(target.diff, '');
  assert.equal(target.files.length, 1);
  assert.match(target.files[0].content, /y = 2/);
});

test('outside a repository, the default target explains itself', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-plain-'));
  await assert.rejects(() => collectTarget({}, dir), /Not a git repository/);
});
