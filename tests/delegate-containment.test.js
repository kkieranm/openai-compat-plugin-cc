// The delegate recipe's containment machinery, run for real — never stubbed.
//
// `tests/delegate-template.test.js` deliberately stubs `canon` and `root` to
// identity, because it tests argument construction, not containment. Nothing
// anywhere else in this repo exercised the boundary check, `canon`'s `--`
// argument-injection defence, or its control-character refusal — confirmed
// with a positive control during this file's own probe: reverting the
// boundary check to always match left the full 1158-test suite green.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tempDir } from './helpers.mjs';

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
  const start = AGENT_SOURCE.indexOf('  canon() { env -i PATH="$PATH" node -e ');
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

// Every scratch path a test creates registers here; one file-level hook removes them all. The
// dir inside `runContainment` is tracked only as a fallback for a failure before the shell starts:
// on every shell run the recipe's own `trap 'rm -rf "$dir"' EXIT INT TERM HUP` removes it, and
// `runContainment` asserts that removal happened — the hook's `force: true` then no-ops on it.
const TRACKED = [];
let trackedCalls = 0;
const track = (path) => {
  trackedCalls++;
  TRACKED.push(path);
  return path;
};
const tracked = (prefix) => track(tempDir(prefix));

after(() => {
  assert.equal(TRACKED.length, trackedCalls, 'a track() registration must reach the cleanup list');
  for (const path of TRACKED) rmSync(path, { recursive: true, force: true });
  // lstatSync, not existsSync: existsSync follows symlinks and would false-pass a dangling
  // tracked link whose unlink failed after its target was removed.
  const leftover = TRACKED.filter((path) => {
    try { lstatSync(path); return true; } catch { return false; }
  });
  assert.deepEqual(leftover, [], 'cleanup must remove every tracked path');
});

async function withScratchRepo(fn) {
  const repo = tracked('oai-containment-repo-');
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
  const dir = tracked('/tmp/oai-delegate.');
  writeFileSync(join(dir, 'files'), manifestLines.map((f) => `${f}\n`).join(''));
  const block = containmentBlock().replace("dir='<the absolute path mktemp returned>'", `dir='${dir}'`);
  const script = `${block}\nfor a in "$@"; do printf '%s\\0' "$a"; done`;
  let result;
  try {
    const { stdout } = await run(SHELL, ['-c', script], { cwd: repo });
    result = { status: 0, argv: stdout.split('\0').slice(0, -1), stdout };
  } catch (error) {
    result = { status: error.code ?? 1, argv: [], stdout: String(error.stdout ?? '') };
  }
  assert.ok(!existsSync(dir), 'the recipe trap must have removed $dir once the shell settled');
  return result;
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
    const outside = tracked('oai-containment-outside-');
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
    const outside = tracked('oai-containment-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'leak');
    const { status, stdout } = await runContainment(repo, [join(outside, 'secret.txt')]);
    assert.equal(status, 1);
    assert.match(stdout, /resolves to/);
    assert.match(stdout, new RegExp(`outside ${real(repo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});

test('the root="$PWD" fallback works outside any git repository', async () => {
  const scratch = tracked('oai-containment-nogit-');
  // No `git init` — `git rev-parse --show-toplevel` must fail here, exercising
  // the fallback rather than the repo-root path every other case above uses.
  await assert.rejects(run('git', ['rev-parse', '--show-toplevel'], { cwd: scratch }));

  writeFileSync(join(scratch, 'plain.txt'), 'hi');
  const accepted = await runContainment(scratch, ['plain.txt']);
  assert.equal(accepted.status, 0, accepted.stdout);
  assert.deepEqual(accepted.argv, ['--file', real(join(scratch, 'plain.txt'))]);

  const outside = tracked('oai-containment-outside-');
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
    const outside = tracked('oai-containment-outside-');
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
  const outside = tracked('oai-containment-control-');
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

test('canon defeats an inherited NODE_OPTIONS preload that would forge its result, in isolation', async () => {
  // Found alongside the identical vulnerability in the model-id validator
  // (this pass's own verdict point, round 3, codex-adversarial): a preload
  // loaded via an inherited NODE_OPTIONS can write to stdout before canon's
  // own script runs, forging the "resolved path" this recipe trusts — the
  // same class of hazard an unrefused `--eval=…` argument already defends
  // against, but `--` cannot help here, since NODE_OPTIONS is not an argv
  // flag. Fixed by clearing NODE_OPTIONS for this invocation; this test
  // proves the fix by confirming a hostile preload's injected text never
  // reaches the resolved path canon() returns.
  await withScratchRepo(async (repo) => {
    writeFileSync(join(repo, 'clean.txt'), 'hi');
    const preloadDir = tracked('oai-containment-preload-');
    const preload = join(preloadDir, 'preload.js');
    writeFileSync(preload, 'process.stdout.write("prefix\\n");\n');
    const script = `${canonBlock()}\ncanon "$1"`;
    const { stdout } = await run(SHELL, ['-c', script, '_', join(repo, 'clean.txt')], {
      env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
    });
    assert.equal(stdout, real(join(repo, 'clean.txt')));
  });
});

test('canon defeats an inherited OPENSSL_CONF that would crash it before it resolves anything, in isolation', async () => {
  // Found at this pass's own verdict point, round 4 (codex-adversarial):
  // NODE_OPTIONS was not the only startup input Node consults before -e
  // runs — OPENSSL_CONF is a second, independent one, and this vulnerability
  // applies to canon() the same way it applies to the model-id validator.
  // Originally fixed by adding OPENSSL_CONF= alongside NODE_OPTIONS=; finding
  // 15 (below) replaced that pairwise clearing with env -i PATH="$PATH",
  // which still defeats this exact reproduction — this test still passes
  // unchanged under the current fix.
  await withScratchRepo(async (repo) => {
    writeFileSync(join(repo, 'clean.txt'), 'hi');
    const confDir = tracked('oai-containment-openssl-conf-');
    const conf = join(confDir, 'malformed.cnf');
    writeFileSync(conf, 'this is not valid openssl config syntax [[[\n');
    const script = `${canonBlock()}\ncanon "$1"`;
    const { stdout } = await run(SHELL, ['-c', script, '_', join(repo, 'clean.txt')], {
      env: { ...process.env, OPENSSL_CONF: conf },
    });
    assert.equal(stdout, real(join(repo, 'clean.txt')));
  });
});

test('canon defeats an inherited Node IPC/cluster channel that would inject bytes into its result, in isolation', async () => {
  // Found at this pass's own verdict point, round 5 (codex-adversarial): a
  // third independent startup input, Node's own IPC/cluster bootstrap
  // (NODE_CHANNEL_FD/NODE_UNIQUE_ID), applies to canon() the same way it
  // applies to the model-id validator. This is the finding that prompted
  // finding 15's redesign: env -i PATH="$PATH" runs this invocation under an
  // empty environment rather than clearing named variables one discovery at
  // a time.
  //
  // `timeout` is deliberate and load-bearing, not defensive padding — see
  // the identical note on this same test's twin in delegate-template.test.js:
  // an UNFIXED invocation under this exact env-var combination does not
  // merely misbehave, it can HANG indefinitely, discovered while
  // mutation-testing this test's own fix.
  await withScratchRepo(async (repo) => {
    writeFileSync(join(repo, 'clean.txt'), 'hi');
    const script = `${canonBlock()}\ncanon "$1"`;
    const { stdout } = await run(SHELL, ['-c', script, '_', join(repo, 'clean.txt')], {
      env: { ...process.env, NODE_CHANNEL_FD: '1', NODE_UNIQUE_ID: 'oai-containment-test' },
      timeout: 10000,
    });
    assert.equal(stdout, real(join(repo, 'clean.txt')));
  });
});

test('canon runs cleanly under an empty environment with every hostile variable set at once, in isolation', async () => {
  // The positive control for finding 15's redesign, mirroring the same test
  // in delegate-template.test.js: every hostile variable findings 13-15
  // individually demonstrated, set simultaneously, proving env -i
  // PATH="$PATH" defeats all of them at once.
  await withScratchRepo(async (repo) => {
    writeFileSync(join(repo, 'clean.txt'), 'hi');
    const preloadDir = tracked('oai-containment-kitchensink-preload-');
    const preload = join(preloadDir, 'preload.js');
    writeFileSync(preload, 'process.stdout.write("prefix\\n");\n');
    const confDir = tracked('oai-containment-kitchensink-conf-');
    const conf = join(confDir, 'malformed.cnf');
    writeFileSync(conf, 'this is not valid openssl config syntax [[[\n');
    const script = `${canonBlock()}\ncanon "$1"`;
    const { stdout } = await run(SHELL, ['-c', script, '_', join(repo, 'clean.txt')], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${preload}`,
        OPENSSL_CONF: conf,
        NODE_CHANNEL_FD: '1',
        NODE_UNIQUE_ID: 'oai-containment-kitchensink',
      },
      timeout: 10000,
    });
    assert.equal(stdout, real(join(repo, 'clean.txt')));
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
  const other = tracked('oai-not-the-right-prefix-');
  const script = `${dirPreambleBlock()}\necho ok`.replace("dir='<the absolute path mktemp returned>'", `dir='${other}'`);
  await assertDirRefused(script, /refusing: unexpected dir/);
});

test('a $dir that is itself a symlink is refused', async () => {
  const real1 = tracked('/tmp/oai-delegate.');
  const link = `${real1}-link`;
  symlinkSync(real1, link);
  track(link);
  const script = `${dirPreambleBlock()}\necho ok`.replace("dir='<the absolute path mktemp returned>'", `dir='${link}'`);
  await assertDirRefused(script, /refusing:.*is a symlink/);
});
