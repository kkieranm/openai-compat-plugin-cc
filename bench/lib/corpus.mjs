// The benchmark corpus on disk, and the throwaway repository each case is
// reviewed in. A case is a historical commit re-staged as `before/` and
// `after/` trees, so the review command sees an ordinary repository and needs
// no bench-specific mode.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UserError } from '../../scripts/lib/errors.mjs';

const NUL = String.fromCharCode(0);

/**
 * Synchronous git, which is safe here and would not be under `tests/`. The
 * deadlock that guard exists for needs two things at once — a blocked event
 * loop and something in this process waiting to answer a socket — and the
 * harness has neither: it builds and scores one case at a time, and every
 * server it talks to is a separate process.
 */
function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = String(error.stderr || error.message).trim();
    throw new UserError(`git ${args.join(' ')} failed: ${detail}`, { hint: 'Is git installed and on PATH?' });
  }
}

function casesDir(root) {
  return join(root, 'bench', 'cases');
}

/**
 * A field the harness will read. Validated rather than assumed: a case that
 * quietly failed to load would leave the run reporting a total and a recall
 * ratio that both look entirely normal for the cases that did load.
 */
function requireField(manifest, field, id) {
  const value = manifest[field];
  if (value === undefined || value === null || value === '') {
    throw new UserError(`Case "${id}" has no "${field}" in its case.json.`, {
      hint: 'Every case needs id, label, mode, defects and dropped; a "file" case also needs files.',
    });
  }
  return value;
}

function validateDefects(manifest, id) {
  const defects = manifest.defects;
  if (!Array.isArray(defects)) throw new UserError(`Case "${id}" has no "defects" array in its case.json.`);
  // A case with no defects is either the point or a mistake, and the two look
  // identical on disk. `control: true` is the case saying which — a clean
  // target is what measures precision, so the corpus needs one, but a case
  // whose defects nobody filled in would otherwise score a silent 100%.
  if (defects.length === 0 && manifest.control !== true) {
    throw new UserError(`Case "${id}" lists no defects, so a run of it could not score anything.`, {
      hint: 'If that is deliberate — a clean target measuring false positives — set "control": true.',
    });
  }
  for (const defect of defects) {
    for (const field of ['id', 'file']) {
      if (typeof defect[field] !== 'string' || !defect[field]) {
        throw new UserError(`Case "${id}" has a defect with no "${field}".`);
      }
    }
    // Both ends, because scoring compares a finding's line against each of
    // them. A half-written range would match nothing and read as the model
    // missing a defect that was never scoreable.
    if (!Array.isArray(defect.lines) || defect.lines.length !== 2 || !defect.lines.every(Number.isInteger)) {
      throw new UserError(`Defect "${defect.id}" in case "${id}" needs "lines": [start, end].`);
    }
  }
}

function validateCase(manifest, dirName) {
  const id = manifest?.id;
  if (typeof id !== 'string' || !id) throw new UserError(`bench/cases/${dirName}/case.json has no "id".`);
  // materialize() finds a case's trees by joining the corpus root with the id,
  // so a manifest that disagrees with its own directory would build some other
  // case — or nothing — and score the result against these defects.
  if (id !== dirName) {
    throw new UserError(`Case "${id}" lives in bench/cases/${dirName}; the id and the directory name must match.`);
  }
  requireField(manifest, 'label', id);
  // Validated because the report dereferences it unconditionally, and a manifest
  // without it crashed the render with a raw TypeError *after* every model call
  // had been paid for and *before* the raw records were written — losing the
  // report and its evidence together. Every field the harness reads is checked
  // here or this loader's promise is only true of the fields somebody remembered.
  if (!Array.isArray(manifest.dropped)) {
    throw new UserError(`Case "${id}" has no "dropped" array in its case.json.`, {
      hint: 'Use [] when every claim in the history could be located; each entry needs a claim and a reason.',
    });
  }
  const mode = requireField(manifest, 'mode', id);
  if (mode !== 'commit' && mode !== 'file') {
    throw new UserError(`Case "${id}" has mode ${JSON.stringify(mode)} — expected "commit" or "file".`);
  }
  if (mode === 'file') {
    const files = requireField(manifest, 'files', id);
    if (!Array.isArray(files) || files.length === 0) {
      throw new UserError(`Case "${id}" is mode "file" but names no files to review.`);
    }
  }
  validateDefects(manifest, id);
  return manifest;
}

function readManifest(dir, name) {
  const path = join(dir, name, 'case.json');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new UserError(`bench/cases/${name} has no case.json.`, {
      hint: 'Add the manifest or remove the directory — a case that does not load makes the run look complete.',
    });
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    // Only the parse is wrapped. Catching the validation too would report a bug
    // in this file as a syntax error, sending the user to fix a manifest that
    // parses perfectly well.
    throw new UserError(`${path} is not valid JSON: ${error.message}`);
  }
  return validateCase(manifest, name);
}

/** Every case in the corpus, in id order. Nothing is skipped; a bad case throws. */
export function loadCases(root) {
  const dir = casesDir(root);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Not an empty corpus: an absent one. Returning [] here would print a
    // finished run over zero cases, which is the one result nobody would query.
    throw new UserError(`No benchmark corpus at ${dir}.`, { hint: 'Add cases under bench/cases/<id>/.' });
  }

  const cases = entries.filter((entry) => entry.isDirectory()).map((entry) => readManifest(dir, entry.name));
  if (cases.length === 0) throw new UserError(`No cases under ${dir}.`, { hint: 'Each case is a directory holding case.json.' });
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

function initRepo() {
  // realpath, because macOS /var is a symlink and git reports resolved paths —
  // a caller comparing our dir against git's output would otherwise disagree.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'oai-bench-')));
  git(['init', '--quiet', '--initial-branch=main'], dir);
  // The ambient config may set neither, and git refuses to commit without them.
  git(['config', 'user.email', 'bench@example.com'], dir);
  git(['config', 'user.name', 'Bench'], dir);
  return dir;
}

function commitAll(dir, message, { allowEmpty = false } = {}) {
  git(['add', '-A'], dir);
  git(['commit', '--quiet', ...(allowEmpty ? ['--allow-empty'] : []), '-m', message], dir);
}

/**
 * Every tracked file, gone, before `after/` is written. A file the historical
 * commit *deleted* has to be absent from the case commit, or the diff under
 * review shows the file surviving a change that removed it.
 */
function clearTracked(dir) {
  for (const path of git(['ls-files', '-z'], dir).split(NUL).filter(Boolean)) {
    rmSync(join(dir, path), { force: true });
  }
}

/** `before/` is optional — a case that only adds files has no parent state. */
function copyTree(from, into) {
  if (existsSync(from)) cpSync(from, into, { recursive: true });
}

function reviewArgs(caseDef, dir) {
  if (caseDef.mode === 'file') return caseDef.files.flatMap((file) => ['--file', join(dir, file)]);
  return ['--commit', 'HEAD'];
}

/**
 * One case as a disposable repository, and the argv tail that reviews it.
 *
 * The base commit is made even when `before/` is empty, via --allow-empty. That
 * is deliberate: it leaves the case commit an ordinary commit with a parent
 * rather than a root commit. Root commits are not broken — git-diff.mjs passes
 * --root for exactly them, and tests/git-diff.test.js covers it — but the bench
 * measures review quality, so every case should present the reviewer with the
 * same ordinary shape rather than varying git's listing path between cases.
 */
export function materialize(caseDef, root) {
  const source = join(casesDir(root), caseDef.id);
  const dir = initRepo();

  copyTree(join(source, 'before'), dir);
  commitAll(dir, 'base', { allowEmpty: true });

  clearTracked(dir);
  copyTree(join(source, 'after'), dir);
  // No --allow-empty here: an after/ identical to before/ is a broken case, and
  // git refusing to commit it says so louder than an empty diff to review.
  commitAll(dir, 'case');

  return { dir, args: reviewArgs(caseDef, dir) };
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}
