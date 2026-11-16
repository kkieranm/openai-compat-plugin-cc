// What gets sent for review. The default target has to include work that is not
// committed yet — including files git does not track at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseCommandLine } from '../plugins/oai/scripts/lib/args.mjs';
import { REVIEW_SPEC } from '../plugins/oai/scripts/lib/cmd-review.mjs';
import { UserError } from '../plugins/oai/scripts/lib/errors.mjs';
import { collectTarget } from '../plugins/oai/scripts/lib/git-diff.mjs';
import {
  chatRequests,
  completion,
  createRepo,
  git,
  modelList,
  respondJson,
  runCompanion,
  startFakeServer,
  tempDir,
  writeConfig,
} from './helpers.mjs';

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
      assert.match(error.message, /^Nothing to review: uncommitted changes is empty\.$/);
      assert.match(error.hint, /--staged.*--base.*--commit.*--file/);
      return true;
    },
  );
});

test('a tree whose only change is an untracked file with no sendable body names it rather than claiming emptiness', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  const locked = join(dir, 'locked.txt');
  writeFileSync(locked, 'secret\n');
  chmodSync(locked, 0o000);
  let denied = false;
  try {
    readFileSync(locked);
  } catch {
    denied = true;
  }
  // Root reads a mode-000 file, which would make it an ordinary readable change.
  if (!denied) unlinkSync(locked);

  await assert.rejects(
    () => collectTarget({}, dir),
    (error) => {
      assert.match(error.message, /^Nothing to review: uncommitted changes holds only \d untracked file\(s\) that could not be read or are binary: /);
      assert.match(error.message, /logo\.png/);
      if (denied) assert.match(error.message, /locked\.txt/);
      assert.doesNotMatch(error.message, /is empty/);
      assert.match(error.hint, /--staged.*--base.*--commit.*--file/);
      return true;
    },
  );

  writeFileSync(join(dir, 'readable.txt'), 'here\n');
  const target = await collectTarget({}, dir);
  assert.deepEqual(target.files.map((file) => file.path), ['readable.txt']);
  assert.ok(target.unreadable.includes('logo.png'), 'a binary beside a readable file is still noted');
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
  await assert.rejects(() => collectTarget({ commit: 'no-such-ref' }, dir), /--commit takes one commit: no-such-ref could not be resolved to one/);
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

const ROOT_SUFFIX_CASES = [
  { label: 'a space', suffix: ' ', sibling: true },
  { label: 'a tab', suffix: '\t', sibling: true },
  { label: 'a newline', suffix: '\n', sibling: true },
  { label: 'a carriage return', suffix: '\r', sibling: true },
  { label: 'a space', suffix: ' ' },
  { label: 'a space', suffix: ' ', enclosing: true },
];

for (const { label, suffix, sibling, enclosing } of ROOT_SUFFIX_CASES) {
  const besides = sibling
    ? ', not the sibling named without it'
    : enclosing
      ? ', not the repository that encloses the directory named without it'
      : '';
  test(`a review run in a repository whose directory name ends in ${label} reads that repository${besides}`, async () => {
    let parent;
    if (enclosing) {
      parent = await createRepo();
      mkdirSync(join(parent, 'repo'));
      writeFileSync(join(parent, 'repo', 'outer.txt'), 'outer\n');
      await git(['add', 'repo/outer.txt'], parent);
      await git(['commit', '--quiet', '-m', 'outer'], parent);
      writeFileSync(join(parent, 'repo', 'outer.txt'), 'outer\nenclosing change\n');
      writeFileSync(join(parent, 'repo', 'enclosing-new.txt'), 'enclosing untracked\n');
    } else {
      parent = tempDir('oai-plugin-ws-');
    }
    const own = join(parent, `repo${suffix}`);
    renameSync(await createRepo(), own);
    writeFileSync(join(own, 'seed.txt'), 'seed\nown change\n');
    writeFileSync(join(own, 'own-new.txt'), 'own untracked\n');
    if (sibling) {
      const other = join(parent, 'repo');
      renameSync(await createRepo(), other);
      writeFileSync(join(other, 'seed.txt'), 'seed\nsibling change\n');
      writeFileSync(join(other, 'sibling-new.txt'), 'sibling untracked\n');
    }

    const target = await collectTarget({}, own);

    assert.doesNotMatch(target.diff, /sibling|enclosing/);
    assert.deepEqual(target.files.map((file) => [file.path, file.content]), [['own-new.txt', 'own untracked\n']]);
    assert.deepEqual(target.changed.map((file) => [file.path, file.content]), [['seed.txt', 'seed\nown change\n']]);
    assert.deepEqual(target.unreadable, []);
    assert.match(target.diff, /^\+own change$/m);
  });
}

const INDEX_TRUSTED_CASES = [
  { label: 'skip-worktree', flags: [['--skip-worktree']], tag: 'S' },
  { label: 'assume-unchanged', flags: [['--assume-unchanged']], tag: 'h' },
  { label: 'skip-worktree and assume-unchanged', flags: [['--skip-worktree'], ['--assume-unchanged']], tag: 's' },
  { label: 'skip-worktree', note: ' under a name with a space and a tab', flags: [['--skip-worktree']], tag: 'S', path: 'with space\tand tab.txt' },
  { label: 'skip-worktree', note: ' absent from disk', flags: [['--skip-worktree']], tag: 'S', absent: true },
  { label: 'skip-worktree', note: ' whose name begins with a stage number', flags: [['--skip-worktree']], tag: 'S', path: '0:x.txt', sibling: 'x.txt' },
];

for (const { label, note = '', flags, tag, path = 'kept.txt', absent, sibling } of INDEX_TRUSTED_CASES) {
  test(`a review sends the index copy of a changed ${label} file${note}, which is what its diff shows`, async (t) => {
    const dir = await createRepo();
    if (sibling) {
      writeFileSync(join(dir, sibling), 'x body\n');
      await git(['add', '--', sibling], dir);
      try {
        writeFileSync(join(dir, path), 'a\n');
      } catch {
        t.skip('this filesystem refuses a colon in a file name');
        return;
      }
    }
    writeFileSync(join(dir, path), 'a\n');
    await git(['add', '--', path], dir);
    await git(['commit', '--quiet', '-m', 'add'], dir);
    writeFileSync(join(dir, path), 'a\nindex\n');
    await git(['add', '--', path], dir);
    for (const flag of flags) await git(['update-index', ...flag, '--', path], dir);
    if (absent) unlinkSync(join(dir, path));
    else writeFileSync(join(dir, path), 'a\nindex\ndisk\n');
    assert.equal((await git(['ls-files', '-v', '-z', '--', path], dir)).split('\0')[0], `${tag} ${path}`);

    const target = await collectTarget({}, dir);

    assert.doesNotMatch(target.diff, /disk/);
    assert.deepEqual(target.changed.map((file) => [file.path, file.content]), [[path, 'a\nindex\n']]);
    assert.deepEqual(target.unreadable, []);
    assert.match(target.diff, /^\+index$/m);
  });
}

test('a review lists a changed skip-worktree gitlink unreadable, since the index holds no blob for it', async () => {
  const dir = await createRepo();
  await git(['config', 'diff.ignoreSubmodules', 'none'], dir);
  const seed = (await git(['rev-parse', 'HEAD'], dir)).trim();
  await git(['update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},sub`], dir);
  await git(['commit', '--quiet', '-m', 'gitlink'], dir);
  await git(['update-index', '--cacheinfo', `160000,${seed},sub`], dir);
  await git(['update-index', '--skip-worktree', '--', 'sub'], dir);
  writeFileSync(join(dir, 'sub'), 'a file on disk, not the gitlink\n');
  assert.equal((await git(['ls-files', '-v', '-z', '--', 'sub'], dir)).split('\0')[0], 'S sub');
  assert.ok((await git(['diff', 'HEAD', '--name-status', '-z'], dir)).includes('M\0sub\0'));

  const target = await collectTarget({}, dir);

  assert.deepEqual(target.changed, []);
  assert.deepEqual(target.unreadable, ['sub']);
});

test('a review reads a changed file with no index flag from disk, and leaves out an unchanged flagged file', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'plain.txt'), 'a\n');
  writeFileSync(join(dir, 'quiet.txt'), 'a\n');
  await git(['add', 'plain.txt', 'quiet.txt'], dir);
  await git(['commit', '--quiet', '-m', 'add'], dir);
  writeFileSync(join(dir, 'plain.txt'), 'a\nindex\n');
  await git(['add', 'plain.txt'], dir);
  writeFileSync(join(dir, 'plain.txt'), 'a\nindex\ndisk\n');
  await git(['update-index', '--skip-worktree', 'quiet.txt'], dir);
  writeFileSync(join(dir, 'quiet.txt'), 'a\nhidden\n');

  const target = await collectTarget({}, dir);

  assert.deepEqual(target.changed.map((file) => [file.path, file.content]), [['plain.txt', 'a\nindex\ndisk\n']]);
  assert.doesNotMatch(target.diff, /quiet|hidden/);
});

test('a default review mid-merge reads a conflicted file from disk', async () => {
  const dir = await createRepo();
  await conflictedMerge(dir);
  assert.ok((await git(['ls-files', '-v', '-z', '--', 'seed.txt'], dir)).startsWith('M seed.txt\0'));

  const target = await collectTarget({}, dir);

  assert.deepEqual(
    target.changed.map((file) => [file.path, file.content]),
    [['seed.txt', readFileSync(join(dir, 'seed.txt'), 'utf8')]],
  );
  assert.deepEqual(target.unreadable, []);
});

test('a pinned file the diff removes is reported, with or without --diff-only', async () => {
  const dir = await createRepo();
  const body = 'one\ntwo\nthree\nfour\nfive\nsix\n';
  writeFileSync(join(dir, 'gone.txt'), body);
  await git(['add', 'gone.txt'], dir);
  await git(['commit', '--quiet', '-m', 'gone'], dir);

  await git(['rm', '--quiet', '--cached', 'gone.txt'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'edited\n');
  assert.equal((await collectTarget({}, dir)).pinnedRemoved, true);
  assert.equal((await collectTarget({ 'diff-only': true }, dir)).pinnedRemoved, true);
});

test('nothing is reported when no pinned file is a path the diff removes', async () => {
  const body = 'one\ntwo\nthree\nfour\nfive\nsix\n';
  const committed = async () => {
    const dir = await createRepo();
    writeFileSync(join(dir, 'file.txt'), body);
    await git(['add', 'file.txt'], dir);
    await git(['commit', '--quiet', '-m', 'file'], dir);
    return dir;
  };

  const untracked = await committed();
  writeFileSync(join(untracked, 'seed.txt'), 'edited\n');
  writeFileSync(join(untracked, 'fresh.txt'), 'fresh\n');
  assert.equal((await collectTarget({}, untracked)).pinnedRemoved, false);

  const renamed = await committed();
  await git(['mv', 'file.txt', 'moved.txt'], renamed);
  assert.equal((await collectTarget({}, renamed)).pinnedRemoved, false);

  const deleted = await committed();
  await git(['rm', '--quiet', 'file.txt'], deleted);
  writeFileSync(join(deleted, 'fresh.txt'), 'fresh\n');
  assert.equal((await collectTarget({}, deleted)).pinnedRemoved, false);
});

test('an untracked file whose name git would quote is sent under its own name', async () => {
  const dir = await createRepo();
  await git(['config', 'core.quotePath', 'true'], dir);
  const names = ['tab\there.txt', 'new\nline.txt', 'quote"d.txt', 'café.txt'];
  for (const name of names) writeFileSync(join(dir, name), `body of ${name}\n`);

  for (const options of [{}, { 'diff-only': true }]) {
    const target = await collectTarget(options, dir);
    assert.deepEqual(target.unreadable, []);
    assert.deepEqual(
      target.files.map((file) => [file.path, file.content]).sort(),
      names.map((name) => [name, `body of ${name}\n`]).sort(),
    );
  }
});

test('a pinned file the diff removes under an NFD name is reported though git lists it as NFC', async (t) => {
  const nfd = 'café.txt';
  const dir = await createRepo();
  const raw = ['-c', 'core.precomposeunicode=false'];
  writeFileSync(join(dir, nfd), 'one\ntwo\n');
  await git([...raw, 'add', nfd], dir);
  await git([...raw, 'commit', '--quiet', '-m', 'nfd'], dir);
  await git([...raw, 'rm', '--quiet', '--cached', nfd], dir);
  await git(['config', 'core.precomposeunicode', 'true'], dir);

  const removed = await git(['diff', 'HEAD', '--name-status', '-z'], dir);
  const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z'], dir);
  if (!(removed.includes(`D\0${nfd}\0`) && untracked === `${nfd.normalize('NFC')}\0`)) {
    t.skip('the listings do not name the NFD deletion and its NFC untracked copy, so there is no mismatch to test');
    return;
  }

  assert.equal((await collectTarget({}, dir)).pinnedRemoved, true);
  assert.equal((await collectTarget({ 'diff-only': true }, dir)).pinnedRemoved, true);
});

test('a file tracked under an NFD name is read from each revision though git precomposes argv', async (t) => {
  const nfd = 'cafe\u0301.txt';
  const nfc = 'na\u00efve.txt';
  const dir = await createRepo();
  const raw = ['-c', 'core.precomposeunicode=false'];
  const write = (body) => {
    writeFileSync(join(dir, nfd), `nfd ${body}\n`);
    writeFileSync(join(dir, nfc), `nfc ${body}\n`);
    writeFileSync(join(dir, 'seed.txt'), `seed ${body}\n`);
  };
  write('one');
  await git([...raw, 'add', '.'], dir);
  await git([...raw, 'commit', '--quiet', '-m', 'names'], dir);
  write('two');
  await git([...raw, 'commit', '--quiet', '-am', 'edit'], dir);
  write('three');
  await git([...raw, 'add', '.'], dir);
  await git(['config', 'core.precomposeunicode', 'true'], dir);

  if (!(await git([...raw, 'ls-files', '-z'], dir)).split('\0').includes(nfd)) {
    t.skip('the index does not hold the NFD spelling, so there is no stored name to look up');
    return;
  }

  for (const [options, body] of [[{ commit: 'HEAD~1' }, 'one'], [{ base: 'HEAD~1' }, 'two'], [{ staged: true }, 'three']]) {
    const target = await collectTarget(options, dir);
    const mode = Object.keys(options)[0];
    assert.deepEqual(target.unreadable, [], mode);
    assert.deepEqual(
      Object.fromEntries(target.changed.map((block) => [block.path, block.content])),
      { [nfd]: `nfd ${body}\n`, [nfc]: `nfc ${body}\n`, 'seed.txt': `seed ${body}\n` },
      mode,
    );
  }
});

test('NFC and NFD twins of one name in one tree are each read as their own blob', async () => {
  const nfd = 'cafe\u0301.txt';
  const nfc = 'caf\u00e9.txt';
  const dir = await createRepo();
  const raw = ['-c', 'core.precomposeunicode=false'];
  // Index-only: APFS cannot hold both spellings on disk, so every commit here is
  // made from the index alone (`-a` would stage both twins as deletions).
  const stage = async (body) => {
    for (const [name, prefix] of [[nfc, 'nfc'], [nfd, 'nfd']]) {
      const source = join(dir, '.git', 'twin-body');
      writeFileSync(source, `${prefix} ${body}\n`);
      const blob = (await git(['hash-object', '-w', source], dir)).trim();
      await git([...raw, 'update-index', '--add', '--cacheinfo', `100644,${blob},${name}`], dir);
    }
  };
  await stage('one');
  await git(['commit', '--quiet', '-m', 'one'], dir);
  await stage('two');
  await git(['commit', '--quiet', '-m', 'two'], dir);
  await stage('three');
  await git(['config', 'core.precomposeunicode', 'true'], dir);

  for (const [options, body] of [[{ commit: 'HEAD~1' }, 'one'], [{ base: 'HEAD~1' }, 'two'], [{ staged: true }, 'three']]) {
    const target = await collectTarget(options, dir);
    const mode = Object.keys(options)[0];
    assert.deepEqual(target.unreadable, [], mode);
    const bodies = Object.fromEntries(target.changed.map((block) => [block.path, block.content]));
    assert.equal(bodies[nfd], `nfd ${body}\n`, `${mode}: the NFD path carries its own blob, not its twin's`);
    assert.equal(bodies[nfc], `nfc ${body}\n`, mode);
  }
});

test('--commit refuses whatever is not one commit, and says what --base covers', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  await git(['commit', '--quiet', '-am', 'second'], dir);

  for (const ref of ['HEAD~1..HEAD', 'HEAD~1...HEAD', 'HEAD^!', '^HEAD', 'HEAD^{tree}', 'HEAD:seed.txt', '']) {
    await assert.rejects(() => collectTarget({ commit: ref }, dir), (error) => {
      assert.match(error.message, /^--commit takes one commit: /, ref);
      assert.match(error.hint, /--base <ref> reviews from where that ref meets HEAD up to HEAD/, ref);
      return true;
    });
  }
});

test('an option-shaped --base or --commit value is refused, naming the flag', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  await git(['commit', '--quiet', '-am', 'second'], dir);
  // A real ref git would resolve under --end-of-options: refused all the same.
  await git(['update-ref', 'refs/heads/-dash', 'HEAD~1'], dir);

  for (const flag of ['base', 'commit']) {
    for (const value of ['--octopus', '--independent', '--fork-point', '--all', '-dash', '-']) {
      await assert.rejects(() => collectTarget({ [flag]: value }, dir), (error) => {
        assert.ok(error instanceof UserError, `${flag} ${value}`);
        assert.equal(error.message, `--${flag} refuses a value beginning with '-': ${value}.`);
        assert.equal(
          error.hint,
          "A ref whose name begins with '-' can be named by its full refname (such as refs/heads/<name>) or its commit id.",
        );
        return true;
      });
    }
  }
});

test('a ref whose name begins with - is reviewable by its full refname', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nsecond\n');
  await git(['commit', '--quiet', '-am', 'second'], dir);
  await git(['update-ref', 'refs/heads/-dash', 'HEAD'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nsecond\nthird\n');
  await git(['commit', '--quiet', '-am', 'third'], dir);

  const commit = await collectTarget({ commit: 'refs/heads/-dash' }, dir);
  assert.equal(commit.label, 'commit refs/heads/-dash');
  assert.match(commit.diff, /^\+second$/m);
  assert.doesNotMatch(commit.diff, /third/);
  assert.deepEqual(
    commit.changed.map((block) => [block.path, block.content]),
    [['seed.txt', 'seed\nsecond\n']],
  );

  const base = await collectTarget({ base: 'refs/heads/-dash' }, dir);
  assert.equal(base.label, 'branch vs refs/heads/-dash');
  assert.match(base.diff, /^\+third$/m);
  assert.doesNotMatch(base.diff, /^\+second$/m);
  assert.deepEqual(
    base.changed.map((block) => [block.path, block.content]),
    [['seed.txt', 'seed\nsecond\nthird\n']],
  );
});

test('an empty --base value is refused rather than reviewing another mode', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nstaged\n');
  await git(['add', 'seed.txt'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nstaged\nunstaged\n');

  const inline = parseCommandLine(['--base='], REVIEW_SPEC);
  assert.deepEqual(inline.options, { base: '' });
  assert.equal(inline.prompt, '');
  const quoted = parseCommandLine(['--base "" text'], REVIEW_SPEC);
  assert.deepEqual(quoted.options, { base: '' });
  assert.equal(quoted.prompt, 'text');

  for (const options of [{ base: '' }, { base: '', staged: true }]) {
    await assert.rejects(() => collectTarget(options, dir), (error) => {
      assert.ok(error instanceof UserError, JSON.stringify(options));
      assert.equal(error.message, '--base requires a non-empty ref.');
      assert.equal(error.hint, 'Use --base <ref> to review from where that ref meets HEAD up to HEAD, or omit --base.');
      return true;
    });
  }
});

test('--commit and --file take precedence over an empty or option-shaped --base', async () => {
  const dir = await createRepo();

  assert.equal((await collectTarget({ base: '', commit: 'HEAD' }, dir)).label, 'commit HEAD');
  assert.equal((await collectTarget({ base: '--staged', commit: 'HEAD' }, dir)).label, 'commit HEAD');
  assert.equal((await collectTarget({ base: '', file: [join(dir, 'seed.txt')] }, dir)).label, '1 file(s)');
});

test('--commit refuses an object it cannot read in the same words, with a fetch hint', async () => {
  const dir = await createRepo();
  await git(['tag', '-a', 'v1', '-m', 'a tag'], dir);
  const head = (await git(['rev-parse', 'HEAD'], dir)).trim();
  const object = join(dir, '.git', 'objects', head.slice(0, 2), head.slice(2));
  chmodSync(object, 0o644);
  writeFileSync(object, 'corrupt');

  for (const ref of ['a'.repeat(40), 'HEAD', 'HEAD^0', 'v1']) {
    await assert.rejects(() => collectTarget({ commit: ref }, dir), (error) => {
      assert.match(error.message, /could not be resolved to one/, ref);
      assert.match(error.hint, /objects may be missing here: fetch them/, ref);
      return true;
    });
  }
});

test('--commit does not take a damaged object at a path holding the word ambiguous for a short id', async () => {
  // Git prints the object path absolute only from a linked worktree, and only on a
  // ref that needs the object to resolve, hence `HEAD^0`.
  const dir = tempDir('oai-plugin-ambiguous-');
  await git(['clone', '--quiet', await createRepo(), dir], tempDir());
  const linked = join(tempDir(), 'worktree');
  await git(['worktree', 'add', '--quiet', '--detach', linked], dir);
  const head = (await git(['rev-parse', 'HEAD'], dir)).trim();
  const object = join(dir, '.git', 'objects', head.slice(0, 2), head.slice(2));
  chmodSync(object, 0o644);
  writeFileSync(object, '');

  await assert.rejects(() => collectTarget({ commit: 'HEAD^0' }, linked), /could not be resolved to one/);
});

test('--commit relays git\'s reason for an ambiguous short id', async () => {
  const dir = await createRepo();
  const head = (await git(['rev-parse', 'HEAD'], dir)).trim();
  const prefix = head.slice(0, 4);
  const blobId = (text) => createHash('sha1').update(`blob ${text.length}\0${text}`).digest('hex');
  let n = 0;
  while (!blobId(String(n)).startsWith(prefix)) n += 1;
  writeFileSync(join(dir, 'twin.txt'), String(n));
  await git(['hash-object', '-w', 'twin.txt'], dir);

  await assert.rejects(() => collectTarget({ commit: prefix }, dir), (error) => {
    assert.match(error.message, new RegExp(`^--commit ${prefix}: short object ID ${prefix} is ambiguous`));
    assert.match(error.hint, /longer id/);
    return true;
  });
});

test('--commit takes anything that names one commit, and the three reads use its id', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  await git(['commit', '--quiet', '-am', 'second'], dir);
  await git(['tag', '-a', 'v1', '-m', 'a tag message'], dir);

  const tag = await collectTarget({ commit: 'v1' }, dir);
  assert.equal(tag.label, 'commit v1');
  assert.deepEqual(tag.changed.map((file) => file.path), ['seed.txt']);
  assert.match(tag.changed[0].content, /edited/);
  assert.doesNotMatch(tag.diff, /a tag message/, 'the commit, not the tag object');
  const named = await collectTarget({ commit: ':/second' }, dir);
  assert.deepEqual(named.changed.map((file) => file.path), ['seed.txt']);
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

test('--staged reads a path that begins with a stage number as its own index entry', async (t) => {
  const dir = await createRepo();
  const names = ['foo.txt', '0:foo.txt', '1:foo.txt'];
  try {
    for (const name of names) writeFileSync(join(dir, name), `staged ${name}\n`);
  } catch {
    t.skip('this filesystem refuses a colon in a file name');
    return;
  }
  await git(['add', '--', ...names], dir);
  for (const name of names) writeFileSync(join(dir, name), `on disk ${name}\n`);

  const target = await collectTarget({ staged: true }, dir);

  const bodies = Object.fromEntries(target.changed.map((file) => [file.path, file.content]));
  assert.deepEqual(bodies, Object.fromEntries(names.map((name) => [name, `staged ${name}\n`])));
  assert.deepEqual(target.unreadable, []);
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

/** Leaves the repo mid-merge with a conflict in `name`. */
async function conflictedMerge(dir, name = 'seed.txt') {
  await git(['checkout', '--quiet', '-b', 'other'], dir);
  writeFileSync(join(dir, name), 'other\n');
  await git(['--literal-pathspecs', 'add', '--', name], dir);
  await git(['commit', '--quiet', '-m', 'other'], dir);
  await git(['checkout', '--quiet', 'main'], dir);
  writeFileSync(join(dir, name), 'main\n');
  await git(['--literal-pathspecs', 'add', '--', name], dir);
  await git(['commit', '--quiet', '-m', 'main'], dir);
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
  // Mid-conflict there is no stage-0 blob, so reading `:0:seed.txt` fails. The
  // path is still listed as changed, so without recording the failure it would
  // vanish from `changed` leaving no trace — and the request would go on to
  // claim it held the complete content of every changed file.
  const dir = await createRepo();
  await conflictedMerge(dir);

  const target = await collectTarget({ staged: true }, dir);

  assert.deepEqual(target.changed, [], 'there is no readable body');
  assert.deepEqual(target.unreadable, ['seed.txt'], 'and the loss is carried out, not swallowed');
});

test('a --staged path with no stage 0 stays unreadable beside a file named after its index spec', async (t) => {
  // Mid-conflict `:0:seed.txt` names no object. Taken as a pathspec instead, it
  // shows nothing, and seed.txt would go out as an empty complete body.
  const dir = await createRepo();
  await conflictedMerge(dir);
  try {
    writeFileSync(join(dir, ':0:seed.txt'), 'the colliding file\n');
  } catch {
    t.skip('this filesystem refuses a colon in a file name');
    return;
  }

  const target = await collectTarget({ staged: true }, dir);

  assert.deepEqual(target.changed, []);
  assert.deepEqual(target.unreadable, ['seed.txt']);
});

test('a --staged path with no stage 0 stays unreadable when its name holds a glob character', async () => {
  // `git show` would take `:0:[a].txt` as a pathspec once it names no object,
  // even with no file on disk to match, and show nothing.
  const dir = await createRepo();
  await conflictedMerge(dir, '[a].txt');

  const target = await collectTarget({ staged: true }, dir);

  assert.deepEqual(target.changed, []);
  assert.deepEqual(target.unreadable, ['[a].txt']);
});

const BLOB_READERS = [
  { mode: 'staged', options: { staged: true }, committed: false, spec: async () => ':0:seed.txt' },
  { mode: 'base', options: { base: 'HEAD~1' }, committed: true, spec: async () => 'HEAD:seed.txt' },
  {
    mode: 'commit',
    options: { commit: 'HEAD' },
    committed: true,
    spec: async (dir) => `${(await git(['rev-parse', 'HEAD'], dir)).trim()}:seed.txt`,
  },
];

for (const { mode, options, committed, spec } of BLOB_READERS) {
  test(`--${mode} reads a blob whose spec also names a file in the root`, async (t) => {
    const dir = await createRepo();
    writeFileSync(join(dir, 'seed.txt'), 'seed\nchanged\n');
    await git(['add', 'seed.txt'], dir);
    if (committed) await git(['commit', '--quiet', '-m', 'change'], dir);
    writeFileSync(join(dir, 'seed.txt'), 'on disk\n');
    const colliding = join(dir, await spec(dir));
    try {
      writeFileSync(colliding, 'the colliding file\n');
    } catch {
      t.skip('this filesystem refuses a colon in a file name');
      return;
    }

    const target = await collectTarget(options, dir);

    assert.deepEqual(target.changed, [{ path: 'seed.txt', content: 'seed\nchanged\n' }]);
    assert.deepEqual(target.unreadable, []);
  });

  test(`--${mode} reads a path holding .. as its blob, not as a revision range`, async () => {
    // `seed.txt..other` splits into `<rev>:seed.txt` and `other` for a range parser,
    // whose log would carry the other branch's content.
    const dir = await createRepo();
    await git(['checkout', '--quiet', '-b', 'other'], dir);
    writeFileSync(join(dir, 'only-on-other.txt'), 'only on other\n');
    await git(['add', 'only-on-other.txt'], dir);
    await git(['commit', '--quiet', '-m', 'other'], dir);
    await git(['checkout', '--quiet', 'main'], dir);
    writeFileSync(join(dir, 'seed.txt..other'), 'the dotted file\n');
    await git(['add', 'seed.txt..other'], dir);
    if (committed) await git(['commit', '--quiet', '-m', 'dotted'], dir);

    const target = await collectTarget(options, dir);

    assert.deepEqual(target.changed, [{ path: 'seed.txt..other', content: 'the dotted file\n' }]);
    assert.deepEqual(target.unreadable, []);
  });
}

/** A root file git ignores, so it is never review content itself. */
async function plantIgnored(dir, name) {
  mkdirSync(join(dir, '.git', 'info'), { recursive: true });
  // A template's exclude file need not end in a newline.
  appendFileSync(join(dir, '.git', 'info', 'exclude'), `\n/${name}\n`);
  writeFileSync(join(dir, name), 'named like the revision\n');
  await git(['check-ignore', '--quiet', '--', name], dir);
}

// Each mode's revision word, as the name of a file in the root.
const REVISION_NAMED_FILES = [
  { mode: 'default', options: {}, committed: false, name: async () => 'HEAD' },
  {
    mode: '--base',
    options: { base: 'HEAD~1' },
    committed: true,
    name: async (dir) => `${(await git(['merge-base', 'HEAD~1', 'HEAD'], dir)).trim()}..HEAD`,
  },
  {
    mode: '--commit',
    options: { commit: 'HEAD' },
    committed: true,
    name: async (dir) => (await git(['rev-parse', 'HEAD'], dir)).trim(),
  },
];

for (const { mode, options, committed, name } of REVISION_NAMED_FILES) {
  test(`the ${mode} review reads its revision as a revision beside a root file of that name`, async () => {
    const dir = await createRepo();
    writeFileSync(join(dir, 'seed.txt'), 'seed\nchanged\n');
    if (committed) await git(['commit', '--quiet', '-am', 'change'], dir);
    await plantIgnored(dir, await name(dir));

    const target = await collectTarget(options, dir);

    assert.match(target.diff, /^\+changed$/m);
    assert.deepEqual(target.changed, [{ path: 'seed.txt', content: 'seed\nchanged\n' }]);
    if (!committed) assert.deepEqual(target.files, [], 'the planted file is not review content');
    assert.deepEqual(target.unreadable, []);
  });
}

const UNBORN_HEAD_FILES = [
  { shape: '', plant: async () => {} },
  { shape: ', beside a root file named HEAD that is ignored', plant: async (dir) => plantIgnored(dir, 'HEAD') },
  {
    shape: ', beside a root file named HEAD that is staged',
    plant: async (dir) => {
      writeFileSync(join(dir, 'HEAD'), 'named like the revision\n');
      await git(['add', 'HEAD'], dir);
    },
  },
  {
    shape: ', beside a root file named HEAD that is untracked',
    plant: async (dir) => writeFileSync(join(dir, 'HEAD'), 'named like the revision\n'),
  },
];

for (const { shape, plant } of UNBORN_HEAD_FILES) {
  test(`the default review on a branch with no commits fails on HEAD${shape}`, async () => {
    const dir = tempDir('oai-plugin-repo-');
    await git(['init', '--quiet', '--initial-branch=main'], dir);
    writeFileSync(join(dir, 'a.txt'), 'staged\n');
    await git(['add', 'a.txt'], dir);
    await plant(dir);

    await assert.rejects(collectTarget({}, dir), (error) => {
      assert.match(error.message, /failed: [\s\S]*HEAD/, "git's own refusal names HEAD");
      assert.doesNotMatch(error.message, /Nothing to review/, 'a staged change is not an empty review');
      return true;
    });
  });
}

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

test('an index-only removal stays in the diff and goes whole once, with nothing withheld', async () => {
  const dir = await createRepo();
  await git(['rm', '--quiet', '--cached', 'seed.txt'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited after the removal\n');

  for (const options of [{}, { 'diff-only': true }]) {
    const target = await collectTarget(options, dir);
    assert.match(target.diff, /deleted file mode/, 'the hunk is HEAD\'s copy');
    assert.deepEqual(target.files.map((file) => file.path), ['seed.txt']);
    assert.match(target.files[0].content, /edited after the removal/, 'the block is the disk\'s copy');
    assert.equal(target.deletionsOnly, true);
  }
});

test('--staged on an index-only removal sends only the hunk, with nothing withheld', async () => {
  const dir = await createRepo();
  await git(['rm', '--quiet', '--cached', 'seed.txt'], dir);

  const target = await collectTarget({ staged: true }, dir);
  assert.match(target.diff, /deleted file mode/);
  assert.deepEqual(target.files, []);
  assert.equal(target.deletionsOnly, true);
});

test('a plain deletion is deletions only, on every target that lists one', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'other.txt'), 'other\n');
  await git(['add', 'other.txt'], dir);
  await git(['commit', '--quiet', '-m', 'other'], dir);
  await git(['rm', '--quiet', 'seed.txt'], dir);

  assert.equal((await collectTarget({}, dir)).deletionsOnly, true);
  assert.equal((await collectTarget({ staged: true }, dir)).deletionsOnly, true);

  await git(['commit', '--quiet', '-m', 'gone'], dir);
  assert.equal((await collectTarget({ commit: 'HEAD' }, dir)).deletionsOnly, true);
});

test('a deletion beside any other change is not deletions only', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'other.txt'), 'other\n');
  await git(['add', 'other.txt'], dir);
  await git(['commit', '--quiet', '-m', 'other'], dir);
  await git(['rm', '--quiet', '--cached', 'seed.txt'], dir);
  writeFileSync(join(dir, 'other.txt'), 'other\nedited\n');

  for (const options of [{}, { 'diff-only': true }]) {
    assert.equal((await collectTarget(options, dir)).deletionsOnly, false);
  }
});

/** A repository whose HEAD merges a side branch; `alsoDelete` removes a file in the merge. */
async function mergedRepo({ alsoDelete }) {
  const dir = await createRepo();
  writeFileSync(join(dir, 'other.txt'), 'other\n');
  await git(['add', 'other.txt'], dir);
  await git(['commit', '--quiet', '-m', 'other'], dir);
  await git(['checkout', '--quiet', '-b', 'side'], dir);
  writeFileSync(join(dir, 'side.txt'), 'side\n');
  await git(['add', 'side.txt'], dir);
  await git(['commit', '--quiet', '-m', 'side'], dir);
  await git(['checkout', '--quiet', 'main'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\nmain\n');
  await git(['commit', '--quiet', '-am', 'main'], dir);
  await git(['merge', '--quiet', '--no-ff', '--no-commit', 'side'], dir);
  if (alsoDelete) await git(['rm', '--quiet', 'other.txt'], dir);
  await git(['commit', '--quiet', '-m', 'merge'], dir);
  return dir;
}

test('a merge is never deletions only, because its list leaves out what it brought in', async () => {
  for (const alsoDelete of [false, true]) {
    const target = await collectTarget({ commit: 'HEAD' }, await mergedRepo({ alsoDelete }));
    assert.equal(target.deletionsOnly, false, `alsoDelete ${alsoDelete}`);
  }
});

test('an empty listing proves nothing, so an empty commit is not deletions only', async () => {
  const dir = await createRepo();
  await git(['commit', '--quiet', '--allow-empty', '-m', 'empty'], dir);
  assert.equal((await collectTarget({ commit: 'HEAD' }, dir)).deletionsOnly, false);
});

// A sentinel only the target of a link holds: if it appears anywhere in what
// collectTarget returns or a review sends, a link was followed.
const LINK_TARGET_SENTINEL = 'TARGET-BYTES-THAT-MUST-NOT-BE-SENT';

function assertNoTargetBytes(value, message) {
  assert.ok(!JSON.stringify(value).includes(LINK_TARGET_SENTINEL), message);
}

function outsideFile() {
  const outside = tempDir('oai-plugin-outside-');
  const secret = join(outside, 'secret.txt');
  writeFileSync(secret, `${LINK_TARGET_SENTINEL}\n`);
  return { outside, secret };
}

test('an untracked symlink is sent as its link text, dangling or pointing outside the repository', async () => {
  const dir = await createRepo();
  const { secret } = outsideFile();
  symlinkSync(secret, join(dir, 'outside-link'));
  symlinkSync('nowhere.txt', join(dir, 'dangling'));

  const target = await collectTarget({}, dir);

  assert.deepEqual(
    [...target.files].sort((a, b) => a.path.localeCompare(b.path)),
    [{ path: 'dangling', content: 'nowhere.txt' }, { path: 'outside-link', content: secret }],
    'a link\'s body is the text git stores for a link',
  );
  assert.deepEqual(target.unreadable, []);
  assertNoTargetBytes(target, 'the target\'s bytes are never read');
});

test('a tracked symlink retargeted in the work tree is sent as its new link text, as the diff shows it', async () => {
  const dir = await createRepo();
  symlinkSync('seed.txt', join(dir, 'tracked-link'));
  await git(['add', 'tracked-link'], dir);
  await git(['commit', '--quiet', '-m', 'link'], dir);
  const { secret } = outsideFile();
  unlinkSync(join(dir, 'tracked-link'));
  symlinkSync(secret, join(dir, 'tracked-link'));

  const target = await collectTarget({}, dir);

  assert.deepEqual(target.changed, [{ path: 'tracked-link', content: secret }]);
  assert.ok(target.diff.includes(`+${secret}`), 'the diff carries the same link text');
  assertNoTargetBytes(target, 'the target\'s bytes are never read');
});

test('a tracked file replaced in the work tree by a symlink is sent as the link text', async () => {
  const dir = await createRepo();
  const { secret } = outsideFile();
  unlinkSync(join(dir, 'seed.txt'));
  symlinkSync(secret, join(dir, 'seed.txt'));

  const target = await collectTarget({}, dir);

  assert.deepEqual(target.changed, [{ path: 'seed.txt', content: secret }]);
  assertNoTargetBytes(target, 'the target\'s bytes are never read');
});

test('an untracked symlink to a directory is sent as its link text', async () => {
  const dir = await createRepo();
  const { outside } = outsideFile();
  symlinkSync(outside, join(dir, 'dir-link'));

  const target = await collectTarget({}, dir);

  assert.deepEqual(target.files, [{ path: 'dir-link', content: outside }]);
  assert.deepEqual(target.unreadable, []);
  assertNoTargetBytes(target, 'nothing inside the directory is read');
});

test('a review request carries an untracked symlink as its link text on every rung, never its target', async () => {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const { secret } = outsideFile();
  symlinkSync(secret, join(dir, 'outside-link'));
  const REGULAR_LINE = 'export const regularMarker = "sent-as-a-body";';
  writeFileSync(join(dir, 'regular.js'), `${REGULAR_LINE}\n`);
  const findings = JSON.stringify({ analysis: 'a', findings: [], summary: 'No defects found.' });
  const server = await startFakeServer((request, response) => {
    if (request.url.includes('/models')) return respondJson(response, modelList('test-model'));
    return respondJson(response, completion(findings));
  });
  const prompts = [];
  try {
    const local = { baseUrl: server.baseUrl, defaultModel: 'test-model' };
    const sized = writeConfig({ defaultProvider: 'local', providers: { local: { ...local, contextLength: 131_072 } } }).path;
    const unsized = writeConfig({ defaultProvider: 'local', providers: { local } }).path;
    const rungs = [['whole files', sized, []], ['unsized window', unsized, []], ['--diff-only', sized, ['--diff-only']]];
    for (const [label, configPath, flags] of rungs) {
      const before = chatRequests(server).length;
      const result = await runCompanion(['review', ...flags], { configPath, cwd: dir });
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      const sent = chatRequests(server).slice(before);
      assert.equal(sent.length, 1, `${label}: one review request`);
      prompts.push([label, sent[0].body.messages[1].content]);
    }
  } finally {
    await server.close();
  }
  for (const [label, prompt] of prompts) {
    assert.equal(prompt.includes('--- FILE: seed.txt ---'), label === 'whole files', `${label}: the rung it names`);
    assert.ok(prompt.includes(REGULAR_LINE), `${label}: an untracked file's body reaches the request`);
    assert.ok(prompt.includes(`--- FILE: outside-link ---\n${secret}\n`), `${label}: the link goes as its link text`);
    assert.ok(!prompt.includes(LINK_TARGET_SENTINEL), `${label}: the target's bytes are never sent`);
  }
});

// collectTarget in a child that renames `replacement` over `victim.txt` at one
// stage: 'lstat', after the real lstat of the path returns, so the path changes
// between the check and the open; or 'fstat', after the real fstat of the
// descriptor opened for it returns, so the path changes between the check of
// that descriptor and the read. A child, so a read that blocks on a FIFO is
// killed by collectWithSwap's SIGKILL deadline rather than hanging the suite
// (a blocked synchronous open cannot be interrupted in-process).
const SWAP_CHILD = `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
const [root, replacement, gitDiff, stage] = process.argv.slice(1);
const realLstat = fs.lstatSync;
const realOpen = fs.openSync;
const realFstat = fs.fstatSync;
let planted = null;
const plant = (path) => {
  fs.renameSync(replacement, path);
  const now = realLstat(path);
  planted = now.isSymbolicLink() ? 'symlink' : now.isFIFO() ? 'fifo' : 'other';
};
if (stage === 'fstat') {
  let victim = null;
  fs.openSync = (path, ...rest) => {
    const fd = realOpen(path, ...rest);
    if (basename(String(path)) === 'victim.txt') victim = { fd, path };
    return fd;
  };
  fs.fstatSync = (fd, ...rest) => {
    const stats = realFstat(fd, ...rest);
    if (replacement && planted === null && victim?.fd === fd) plant(victim.path);
    return stats;
  };
} else {
  fs.lstatSync = (path, ...rest) => {
    const stats = realLstat(path, ...rest);
    if (replacement && planted === null && basename(String(path)) === 'victim.txt') plant(path);
    return stats;
  };
}
syncBuiltinESMExports();
const { collectTarget } = await import(gitDiff);
const { files, changed, unreadable } = await collectTarget({}, root);
process.stdout.write(JSON.stringify({ planted, files, changed, unreadable }));
`;

async function collectWithSwap(root, replacement, stage = 'lstat') {
  const gitDiff = new URL('../plugins/oai/scripts/lib/git-diff.mjs', import.meta.url).href;
  const run = promisify(execFile)(
    process.execPath,
    ['--input-type=module', '-e', SWAP_CHILD, root, replacement, gitDiff, stage],
    { timeout: 20_000, killSignal: 'SIGKILL' },
  );
  const { stdout } = await run.catch((error) => {
    if (error.signal === 'SIGKILL') assert.fail('the child was killed at the deadline: reading the swapped path blocked');
    throw error;
  });
  return JSON.parse(stdout);
}

// An untracked victim beside an independent change, so refusing the victim
// cannot turn the review into "Nothing to review".
async function swapRepo() {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  writeFileSync(join(dir, 'victim.txt'), 'victim body\n');
  return dir;
}

test('with nothing swapped, the swap harness reads the victim\'s own body', async () => {
  const result = await collectWithSwap(await swapRepo(), '');
  assert.equal(result.planted, null, 'the hook stayed idle');
  assert.deepEqual(result.files, [{ path: 'victim.txt', content: 'victim body\n' }]);
  assert.deepEqual(result.unreadable, []);
});

test('a path swapped for a symlink after its lstat is refused, not followed', async () => {
  const dir = await swapRepo();
  const { secret } = outsideFile();
  const staged = join(tempDir('oai-plugin-stage-'), 'link');
  symlinkSync(secret, staged);

  const result = await collectWithSwap(dir, staged);

  assert.equal(result.planted, 'symlink', 'the hook swapped a symlink in between lstat and open');
  assert.deepEqual(result.unreadable, ['victim.txt']);
  assertNoTargetBytes(result, 'the swapped-in link is not followed');
});

test('a path swapped for a symlink after its fstat is still read through the checked descriptor', async () => {
  const dir = await swapRepo();
  const { secret } = outsideFile();
  const staged = join(tempDir('oai-plugin-stage-'), 'link');
  symlinkSync(secret, staged);

  const result = await collectWithSwap(dir, staged, 'fstat');

  assert.equal(result.planted, 'symlink', 'the hook swapped a symlink in between fstat and the read');
  assert.deepEqual(result.files, [{ path: 'victim.txt', content: 'victim body\n' }], 'the body is the checked file\'s bytes');
  assert.deepEqual(result.unreadable, []);
  assertNoTargetBytes(result, 'the path is not reopened after the check');
});

test('a path swapped for a FIFO after its lstat is refused without blocking', async (t) => {
  const dir = await swapRepo();
  const fifo = join(tempDir('oai-plugin-stage-'), 'fifo');
  const made = await new Promise((resolve) => {
    const child = spawn('mkfifo', [fifo], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (status) => resolve(status === 0));
  });
  if (!made) return t.skip('mkfifo is unavailable');

  const result = await collectWithSwap(dir, fifo);

  assert.equal(result.planted, 'fifo', 'the hook swapped a FIFO in between lstat and open');
  assert.deepEqual(result.unreadable, ['victim.txt'], 'a FIFO is not a body, even an empty one');
  assert.deepEqual(result.files, []);
});
