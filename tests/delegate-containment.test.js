// The delegate recipe's containment machinery, run for real — never stubbed.
//
// `tests/delegate-template.test.js` deliberately stubs `canon` and `root` to
// identity, because it tests argument construction, not containment. Nothing
// anywhere else in this repo exercised the boundary check, `canon`'s `--`
// argument-injection defence, or its control-character refusal — confirmed
// with a positive control during this file's own probe: reverting the
// boundary check to always match left the full 1158-test suite green.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// zsh only — the shell these recipes actually run under. Containment is
// Node/git logic, not a shell-parsing quirk (unlike delegate-template's
// multi-shell matrix, which exists for a real shell-specific bug), so one
// real interpreter is sufficient and a full matrix would be padding.
const SHELL = ['/bin/zsh', '/usr/bin/zsh', '/opt/homebrew/bin/zsh'].find((p) => existsSync(p));

test('zsh is present, because it is the shell this suite exists to cover', async () => {
  assert.ok(SHELL, 'zsh not found — install it; these recipes run under the user shell, which is zsh here');
});

const AGENT_SOURCE = readFileSync(new URL('../agents/oai-delegate.md', import.meta.url), 'utf8');

/**
 * The dir/root preamble through the attachment guard, unstubbed: `canon` and
 * `root=$(git rev-parse --show-toplevel...)` are the real recipe, not a
 * stand-in — the whole point of this file.
 */
function containmentBlock() {
  const start = AGENT_SOURCE.indexOf("dir='<the absolute path mktemp returned>'");
  const end = AGENT_SOURCE.indexOf('  id=$(node ', start);
  assert.ok(start !== -1 && end > start, 'the recipe must open with the dir/root preamble and submit after it');
  return AGENT_SOURCE.slice(start, end);
}

/** Just `canon()` itself, self-contained — no boundary check present to mask a result either way. */
function canonBlock() {
  const start = AGENT_SOURCE.indexOf('  canon() { node -e ');
  const end = AGENT_SOURCE.indexOf('\n\n', start);
  assert.ok(start !== -1 && end > start, 'the recipe must define canon() as a single self-contained function');
  return AGENT_SOURCE.slice(start, end);
}

/** The `$dir` validation lines alone — no `canon`/`root`, so no git repo is needed to drive it. */
function dirPreambleBlock() {
  const start = AGENT_SOURCE.indexOf("dir='<the absolute path mktemp returned>'");
  const end = AGENT_SOURCE.indexOf('trap ', start) + "trap 'rm -rf \"$dir\"' EXIT INT TERM HUP".length;
  assert.ok(start !== -1 && end > start, 'the recipe must validate $dir before using it');
  return AGENT_SOURCE.slice(start, end);
}

async function withScratchRepo(fn) {
  const repo = mkdtempSync(join(tmpdir(), 'oai-containment-repo-'));
  await run('git', ['init', '-q'], { cwd: repo });
  return fn(repo);
}

/**
 * Run the real containment block for real: a real `mktemp`'d dir (so the
 * recipe's own `/tmp/oai-delegate.*` prefix check passes), a real `$dir/files`
 * manifest, `cwd: repo` so `git rev-parse --show-toplevel` resolves for real.
 *
 * Mirrors `delegate-template.test.js`'s `argv()`: NUL-delimited capture on
 * success, raw stdout/exit code on refusal — never filtered, so an empty
 * argument (the exact failure class this pattern exists to catch) is visible.
 */
async function runContainment(repo, manifestLines) {
  const dir = mkdtempSync('/tmp/oai-delegate.');
  writeFileSync(join(dir, 'files'), manifestLines.map((f) => `${f}\n`).join(''));
  const block = containmentBlock().replace("dir='<the absolute path mktemp returned>'", `dir='${dir}'`);
  const script = `${block}\nfor a in "$@"; do printf '%s\\0' "$a"; done`;
  try {
    const { stdout } = await run(SHELL, ['-c', script], { cwd: repo });
    return { status: 0, argv: stdout.split('\0').slice(0, -1), stdout };
  } catch (error) {
    return { status: error.code ?? 1, argv: [], stdout: String(error.stdout ?? '') };
  }
}

/** Same real path a shell `cd`/`git`/`canon` would see — normalizes `/tmp` vs `/private/tmp` on macOS. */
const real = (p) => realpathSync(p);

test('a plain in-tree file is accepted', async () => {
  await withScratchRepo(async (repo) => {
    writeFileSync(join(repo, 'plain.txt'), 'hi');
    const { status, argv } = await runContainment(repo, ['plain.txt']);
    assert.equal(status, 0);
    assert.deepEqual(argv, ['--file', real(join(repo, 'plain.txt'))]);
  });
});

test('an in-tree symlink to another in-tree file is accepted', async () => {
  await withScratchRepo(async (repo) => {
    writeFileSync(join(repo, 'target.txt'), 'hi');
    symlinkSync(join(repo, 'target.txt'), join(repo, 'link.txt'));
    const { status, argv } = await runContainment(repo, ['link.txt']);
    assert.equal(status, 0);
    assert.deepEqual(argv, ['--file', real(join(repo, 'target.txt'))]);
  });
});

test('an in-tree symlink pointing outside the tree is refused', async () => {
  await withScratchRepo(async (repo) => {
    const outside = mkdtempSync(join(tmpdir(), 'oai-containment-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'leak');
    symlinkSync(join(outside, 'secret.txt'), join(repo, 'evil-link.txt'));
    const { status, stdout } = await runContainment(repo, ['evil-link.txt']);
    assert.equal(status, 1);
    assert.match(stdout, /refusing: evil-link\.txt resolves to/);
    assert.match(stdout, new RegExp(`outside ${real(repo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});

test('an absolute path outside the tree, not a symlink, is refused the same way', async () => {
  await withScratchRepo(async (repo) => {
    const outside = mkdtempSync(join(tmpdir(), 'oai-containment-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'leak');
    const { status, stdout } = await runContainment(repo, [join(outside, 'secret.txt')]);
    assert.equal(status, 1);
    assert.match(stdout, /resolves to/);
    assert.match(stdout, new RegExp(`outside ${real(repo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});

test('the root="$PWD" fallback works outside any git repository', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'oai-containment-nogit-'));
  // No `git init` — `git rev-parse --show-toplevel` must fail here, exercising
  // the fallback rather than the repo-root path every other case above uses.
  await assert.rejects(run('git', ['rev-parse', '--show-toplevel'], { cwd: scratch }));

  writeFileSync(join(scratch, 'plain.txt'), 'hi');
  const accepted = await runContainment(scratch, ['plain.txt']);
  assert.equal(accepted.status, 0, accepted.stdout);
  assert.deepEqual(accepted.argv, ['--file', real(join(scratch, 'plain.txt'))]);

  const outside = mkdtempSync(join(tmpdir(), 'oai-containment-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'leak');
  symlinkSync(join(outside, 'secret.txt'), join(scratch, 'evil-link.txt'));
  const refused = await runContainment(scratch, ['evil-link.txt']);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /outside/);
});

test('a raw manifest entry starting with -- is accepted when genuinely in-tree', async () => {
  // `--require=./evil.js`, not `--require/evil.js`: the latter is invalid
  // `--require` syntax (Node reports a generic "bad option" and never
  // attempts to load anything — confirmed directly while building this
  // fixture); this shape genuinely fires Node's own --require flag parsing,
  // which is the property under test.
  await withScratchRepo(async (repo) => {
    mkdirSync(join(repo, '--require=.'));
    writeFileSync(join(repo, '--require=.', 'evil.js'), 'payload');
    const { status, argv } = await runContainment(repo, ['--require=./evil.js']);
    assert.equal(status, 0);
    assert.deepEqual(argv, ['--file', real(join(repo, '--require=.', 'evil.js'))]);
  });
});

test('the same -- manifest entry is refused when reached via an outside-tree symlink', async () => {
  await withScratchRepo(async (repo) => {
    const outside = mkdtempSync(join(tmpdir(), 'oai-containment-outside-'));
    mkdirSync(join(outside, '--require=.'));
    writeFileSync(join(outside, '--require=.', 'evil.js'), 'payload');
    symlinkSync(join(outside, '--require=.'), join(repo, '--require=.'));
    const { status, stdout } = await runContainment(repo, ['--require=./evil.js']);
    assert.equal(status, 1);
    assert.match(stdout, /refusing: --require=\.\/evil\.js resolves to/);
    assert.match(stdout, new RegExp(`outside ${real(repo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});

test('canon resolves a clean in-tree path with no control character', async () => {
  await withScratchRepo(async (repo) => {
    writeFileSync(join(repo, 'clean.txt'), 'hi');
    const script = `${canonBlock()}\ncanon "$1"`;
    const { stdout } = await run(SHELL, ['-c', script, '_', join(repo, 'clean.txt')]);
    assert.equal(stdout, real(join(repo, 'clean.txt')));
  });
});

test('canon refuses a resolved path carrying a control character, in isolation', async () => {
  // A real filesystem entry literally named with an embedded newline — no
  // boundary check anywhere in this harness to mask the result either way,
  // unlike the round-1 design this replaced.
  const outside = mkdtempSync(join(tmpdir(), 'oai-containment-control-'));
  const named = join(outside, 'weird\nname.txt');
  writeFileSync(named, 'x');
  const script = `${canonBlock()}\ncanon "$1"`;
  await assert.rejects(run(SHELL, ['-c', script, '_', named]));
});

test('canon resolves a --require= manifest entry correctly, in isolation', async () => {
  // Found missing in review-ladder pass 1 (Codex, verdict point round 1,
  // CHANGES-REQUIRED): the plan calls for an ISOLATED canon() proof of the
  // -- separator, the same isolation principle already applied to the
  // control-character check above — distinct from the two integration
  // cases below, which exercise canon() only as part of the whole recipe.
  await withScratchRepo(async (repo) => {
    mkdirSync(join(repo, '--require=.'));
    writeFileSync(join(repo, '--require=.', 'evil.js'), 'payload');
    const script = `${canonBlock()}\ncanon "$1"`;
    const { stdout } = await run(SHELL, ['-c', script, '_', '--require=./evil.js'], { cwd: repo });
    assert.equal(stdout, real(join(repo, '--require=.', 'evil.js')));
  });
});

/**
 * Runs a `dirPreambleBlock()`-shaped script and asserts it actually STOPS —
 * not merely that it printed a diagnostic. A guard that warns but forgets
 * `exit 1` would still match a bare message-only assertion while proceeding
 * to `echo ok` right after it (Codex, review-ladder pass 1): asserting the
 * absence of `ok` is what proves execution halted, not just that it spoke.
 */
async function assertDirRefused(script, messagePattern) {
  const { status, stdout } = await run(SHELL, ['-c', script])
    .then(({ stdout }) => ({ status: 0, stdout }))
    .catch((error) => ({ status: error.code ?? 1, stdout: String(error.stdout ?? '') }));
  assert.equal(status, 1);
  assert.match(stdout, messagePattern);
  assert.doesNotMatch(stdout, /^ok$/m, 'execution must not continue past the refusal');
}

test('a $dir not matching the /tmp/oai-delegate.* prefix is refused', async () => {
  const other = mkdtempSync(join(tmpdir(), 'oai-not-the-right-prefix-'));
  const script = `${dirPreambleBlock()}\necho ok`.replace("dir='<the absolute path mktemp returned>'", `dir='${other}'`);
  await assertDirRefused(script, /refusing: unexpected dir/);
});

test('a $dir that is itself a symlink is refused', async () => {
  const real1 = mkdtempSync('/tmp/oai-delegate.');
  const link = `${real1}-link`;
  symlinkSync(real1, link);
  const script = `${dirPreambleBlock()}\necho ok`.replace("dir='<the absolute path mktemp returned>'", `dir='${link}'`);
  await assertDirRefused(script, /refusing:.*is a symlink/);
});
