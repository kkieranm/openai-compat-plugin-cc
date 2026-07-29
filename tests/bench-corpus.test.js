// Loading benchmark cases, and the throwaway repository each one becomes.
// The fixtures here are written by hand rather than taken from bench/cases/,
// so these tests pin the loader's contract and not the corpus's current shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { CASE_COMMIT_DATE, cleanup, loadCases, materialize } from '../bench/lib/corpus.mjs';
import { git } from './helpers.mjs';

const MANIFEST = {
  id: 'sample',
  label: 'a hand-written case',
  mode: 'commit',
  origin: { commit: 'abc1234', note: 'fixture' },
  files: [],
  provider: null,
  model: null,
  defects: [
    {
      id: 'the-defect',
      file: 'scripts/lib/sample.mjs',
      lines: [1, 3],
      anchor: 'export const broken = true;',
      description: 'it is broken',
      fixedIn: 'def5678',
      confidence: 'high',
    },
  ],
  dropped: [],
};

// before/ and after/ differ three ways at once — one file edited, one deleted,
// one added — because each is a different way for materialize() to be wrong.
const TREE = {
  'before/scripts/lib/sample.mjs': 'export const broken = true;\n',
  'before/scripts/lib/gone.mjs': 'export const removedByTheCommit = 1;\n',
  'after/scripts/lib/sample.mjs': 'export const broken = false;\n',
  'after/scripts/lib/added.mjs': 'export const addedByTheCommit = 1;\n',
};

/** A corpus root holding exactly one case. */
function writeCorpus(manifest, tree = {}, dirName = manifest.id) {
  const root = mkdtempSync(join(tmpdir(), 'oai-bench-corpus-'));
  const dir = join(root, 'bench', 'cases', dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'case.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [path, content] of Object.entries(tree)) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

/** Non-empty lines of a git listing, which starts with a blank line under --pretty=format:. */
function listed(output) {
  return output.split('\n').filter(Boolean).sort();
}

test('a materialized case is an ordinary commit with a parent, not a root commit', async (t) => {
  const root = writeCorpus(MANIFEST, TREE);
  const [caseDef] = loadCases(root);
  const { dir, args } = materialize(caseDef, root);
  t.after(() => cleanup(dir));

  // The base commit exists even though it is only reached via --allow-empty in
  // the empty-before case; here it holds before/, and HEAD^ resolving is the
  // property the bench wants either way.
  await assert.doesNotReject(git(['rev-parse', 'HEAD^'], dir), 'the case commit must have a parent');
  assert.deepEqual(args, ['--commit', 'HEAD']);
});

test('two materializations of one case send the model identical bytes', async (t) => {
  // The corpus is meant to be a fixed target, and it was not. `--commit HEAD`
  // puts `git show HEAD` in the prompt, whose first three lines are the sha, the
  // author and the date — and a repo built fresh per run got a new date, hence a
  // new sha, whenever two runs fell in different clock seconds. In a real bench
  // that is always; in a test it is almost never, which is why this went
  // unnoticed and why the assertion below cannot be *only* that the two agree.
  const root = writeCorpus(MANIFEST, TREE);
  const [caseDef] = loadCases(root);
  const first = materialize(caseDef, root);
  const second = materialize(caseDef, root);
  t.after(() => {
    cleanup(first.dir);
    cleanup(second.dir);
  });

  const shown = await Promise.all([git(['show', 'HEAD'], first.dir), git(['show', 'HEAD'], second.dir)]);
  assert.equal(shown[0], shown[1], 'the same case must produce the same prompt');
  // The load-bearing half. Two materializations inside one second agree even
  // with no pinning at all, so agreement alone would pass against the defect.
  // Only the pinned date proves the environment is actually in force — and it
  // also makes the sha stable across days, not just across a fast test.
  const stamp = new Date(CASE_COMMIT_DATE).getTime();
  const committed = Number(await git(['log', '-1', '--format=%ct', 'HEAD'], first.dir)) * 1000;
  assert.equal(committed, stamp, 'the case commit must carry the pinned date, not the wall clock');
});

test('the case commit changes exactly the files the case describes', async (t) => {
  const root = writeCorpus(MANIFEST, TREE);
  const { dir } = materialize(loadCases(root)[0], root);
  t.after(() => cleanup(dir));

  const names = listed(await git(['show', '--name-only', '--pretty=format:', 'HEAD'], dir));
  assert.deepEqual(names, ['scripts/lib/added.mjs', 'scripts/lib/gone.mjs', 'scripts/lib/sample.mjs']);

  // A file the historical commit removed has to show as a deletion. Writing
  // after/ over before/ without clearing tracked files would leave it present,
  // and the review would see a change that never happened.
  const status = listed(await git(['show', '--name-status', '--pretty=format:', 'HEAD'], dir));
  assert.deepEqual(status, ['A\tscripts/lib/added.mjs', 'D\tscripts/lib/gone.mjs', 'M\tscripts/lib/sample.mjs']);
});

test('an empty before/ still produces a base commit', async (t) => {
  const root = writeCorpus(MANIFEST, { 'after/scripts/lib/sample.mjs': 'export const broken = true;\n' });
  const { dir } = materialize(loadCases(root)[0], root);
  t.after(() => cleanup(dir));

  await assert.doesNotReject(git(['rev-parse', 'HEAD^'], dir), 'a case with no parent state is still not a root commit');
});

test('a "file" case reviews absolute paths inside the throwaway repo', async (t) => {
  const manifest = { ...MANIFEST, mode: 'file', files: ['scripts/lib/sample.mjs'] };
  const root = writeCorpus(manifest, TREE);
  const { dir, args } = materialize(loadCases(root)[0], root);
  t.after(() => cleanup(dir));

  // The path must point at the materialized repo, not at the corpus's after/
  // tree — reviewing the corpus copy would review a file with no repository.
  assert.equal(args[0], '--file');
  assert.ok(isAbsolute(args[1]) && args[1].startsWith(dir), `${args[1]} is not inside ${dir}`);
  assert.equal(args.length, 2);
});

test('cases come back sorted by id', () => {
  const root = writeCorpus(MANIFEST, TREE);
  const second = { ...MANIFEST, id: 'aardvark' };
  const dir = join(root, 'bench', 'cases', 'aardvark');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'case.json'), JSON.stringify(second));

  assert.deepEqual(
    loadCases(root).map((entry) => entry.id),
    ['aardvark', 'sample'],
  );
});

test('a manifest missing a field it will be read for fails loudly, naming the case', () => {
  const { label, ...noLabel } = MANIFEST;
  const root = writeCorpus(noLabel, TREE, 'sample');

  assert.throws(() => loadCases(root), (error) => {
    assert.equal(error.name, 'UserError', 'a fixable manifest is a user error, not a crash');
    assert.match(error.message, /sample/, 'the message has to say which case');
    assert.match(error.message, /label/);
    return true;
  });
});

test('a case whose id disagrees with its directory fails rather than building the wrong repo', () => {
  const root = writeCorpus(MANIFEST, TREE, 'renamed');

  assert.throws(() => loadCases(root), /Case "sample" lives in bench\/cases\/renamed/);
});

test('an absent corpus is a loud failure, not zero cases', () => {
  const root = mkdtempSync(join(tmpdir(), 'oai-bench-empty-'));

  assert.throws(() => loadCases(root), (error) => {
    assert.equal(error.name, 'UserError');
    assert.match(error.message, /No benchmark corpus/);
    return true;
  });
});

// `dropped` is read unconditionally by the report, so the loader has to require
// it. Without this, a case missing the field loaded fine, every model call was
// paid for, and the render then died on a raw TypeError — before the per-run
// records were written, so the run lost its evidence along with its report.
test('a manifest without "dropped" is refused by the loader, not by the renderer', () => {
  const { dropped: unused, ...without } = MANIFEST;
  assert.throws(() => loadCases(writeCorpus(without, TREE)), (error) => {
    assert.equal(error.name, 'UserError', 'a manifest problem must not surface as a TypeError');
    assert.match(error.message, /"dropped"/);
    return true;
  });
});

// A clean target is not a broken case: precision needs one as much as recall
// needs dirty ones, and the corpus ships a documentation-only commit for it.
// But an empty defects list is also exactly what a half-written case looks
// like, so the manifest has to say which of the two it is.
test('a case with no defects loads only when it declares itself a control', () => {
  const control = { ...MANIFEST, id: 'clean', defects: [], control: true };
  assert.deepEqual(loadCases(writeCorpus(control, TREE)).map((entry) => entry.id), ['clean']);

  const { control: unused, ...unmarked } = control;
  assert.throws(() => loadCases(writeCorpus(unmarked, TREE)), (error) => {
    assert.equal(error.name, 'UserError');
    assert.match(error.message, /lists no defects/);
    assert.match(error.hint, /"control": true/, 'the refusal must name the way to say it was deliberate');
    return true;
  });
});

// The corpus that actually ships, not a fixture. Every manifest here was
// hand-authored against a historical blob, and a mistyped path or a range
// nobody filled in would surface as the reviewer missing a defect rather than
// as the corpus being wrong — which is the harder failure to notice.
test('the corpus in this repo loads and every anchor is real', () => {
  const cases = loadCases(new URL('..', import.meta.url).pathname);
  assert.ok(cases.length > 0);

  for (const caseDef of cases) {
    for (const defect of caseDef.defects) {
      assert.ok(defect.description, `${caseDef.id}/${defect.id}: needs a description`);
      assert.ok(defect.fixedIn, `${caseDef.id}/${defect.id}: needs the commit that fixed it`);
      // Null is legitimate — an absence-shaped defect has no line to quote —
      // but an empty string would make every finding in the file match, since
      // every string contains ''.
      assert.ok(defect.anchor === null || defect.anchor.length > 0, `${caseDef.id}/${defect.id}: empty anchor`);
    }
    // Each entry states why history's claim was not turned into a label.
    for (const dropped of caseDef.dropped) {
      assert.ok(dropped.claim && dropped.reason, `${caseDef.id}: a dropped defect needs both a claim and a reason`);
    }
  }
});
