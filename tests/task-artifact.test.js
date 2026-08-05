// Extracting a patch and checking whether it applies.
//
// The one template whose answer a machine can judge, so these tests are about
// the judgement being honest rather than generous: three states instead of a
// boolean, and an "applies" that refuses to imply "correct".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactNote, checkDiff, extractDiff } from '../scripts/lib/task-artifact.mjs';

// Async, because tests/structure.test.js refuses a synchronous spawn outright
// rather than asking each author whether their case is the safe one.
const run = promisify(execFile);

/** A throwaway repo with one committed file, so `git apply --check` has a tree. */
async function repoWith(content) {
  const dir = mkdtempSync(join(tmpdir(), 'oai-artifact-'));
  const git = (...args) => run('git', args, { cwd: dir });
  await git('init', '-q');
  await git('config', 'user.email', 't@example.com');
  await git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'a.txt'), content);
  await git('add', '.');
  await git('commit', '-qm', 'base');
  return dir;
}

const GOOD = `--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n`;

test('a bare diff is extracted as-is', async () => {
  assert.equal(extractDiff(GOOD), GOOD);
});

test('a fenced diff is extracted, because a small model fences despite being told not to', async () => {
  const fenced = '```diff\n' + GOOD + '```';
  assert.equal(extractDiff(fenced), GOOD);
});

test('a diff preceded by chatter is still found', async () => {
  assert.equal(extractDiff(`Sure! Here is the patch:\n\n${GOOD}`), GOOD);
});

test('prose with no hunk header is NOT a diff, whatever it looks like', async () => {
  assert.equal(extractDiff('--- this is a sentence with three dashes'), null);
  assert.equal(extractDiff('I would change two to TWO in a.txt.'), null);
});

test('an explicit IMPOSSIBLE is not mined for a diff', async () => {
  // The template tells the model to refuse rather than guess. Treating that as
  // "no diff found" would be right; treating it as a broken patch would not.
  assert.equal(extractDiff('IMPOSSIBLE — a.txt was not provided.'), null);
});

test('a diff that applies is reported as applying', async () => {
  const dir = await repoWith('one\ntwo\nthree\n');
  const verdict = checkDiff(extractDiff(GOOD), { cwd: dir });
  assert.equal(verdict.state, 'applies');
});

test('a diff that does not apply is REJECTED, with the reason', async () => {
  const dir = await repoWith('completely different content\n');
  const verdict = checkDiff(extractDiff(GOOD), { cwd: dir });
  assert.equal(verdict.state, 'rejected');
  assert.match(verdict.detail, /\S/, 'a rejection must say why');
});

test('no diff at all is ABSENT, never rejected', async () => {
  // Collapsing these would let a template that produced prose read as one that
  // produced a broken patch — two different failures with two different fixes.
  const dir = await repoWith('one\n');
  assert.equal(checkDiff(null, { cwd: dir }).state, 'absent');
});

test('the note never lets "applies" imply "correct"', async () => {
  // Instance 14's shape: a check that converts a loud unknown into a
  // confident-looking result. Applying is the strongest claim available and it
  // is a weak one.
  const applies = artifactNote({ state: 'applies', detail: null });
  assert.match(applies, /applies cleanly/);
  assert.match(applies, /not evidence it is right/);

  const rejected = artifactNote({ state: 'rejected', detail: 'patch does not apply' });
  assert.match(rejected, /does NOT apply/);
  assert.match(rejected, /nothing was changed/);

  const absent = artifactNote({ state: 'absent', detail: 'the reply contained no unified diff' });
  assert.match(absent, /Nothing was checked/);
});

test('checking never touches the working tree', async () => {
  const dir = await repoWith('one\ntwo\nthree\n');
  checkDiff(extractDiff(GOOD), { cwd: dir });
  const { stdout } = await run('git', ['status', '--porcelain'], { cwd: dir });
  assert.equal(stdout.trim(), '', '--check must not modify anything');
});
