// The delegate's own shell, extracted and RUN — never a paraphrase of it.
//
// Split from `tests/task-template.test.js` at the size ratchet, and the seam is
// real: that file tests what a template *is*, and this one tests the one place
// that decides a template is *used*. `agents/oai-delegate.md` is the agent built
// to be the advisor's caller, so a broker that silently stopped passing the flag
// would leave the template reachable only by typing it out by hand — the feature
// would be present and unreachable.
//
// **This suite runs the block under EVERY shell on the machine, and that is the
// whole point of it.** The first version ran only `sh`, passed, and shipped a
// recipe that was broken: `${template:+--template "$template"}` relied on field
// splitting, and zsh — the shell Claude Code actually runs these recipes in —
// does not split unquoted expansions, so it produced the single argument
// `--template advisor` and every submission was refused. A test that exercises
// one shell cannot see that, which made it a check that could not fail for the
// reason it claimed to guard.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TEMPLATES } from '../scripts/lib/task-template.mjs';

// Async, like every other child in this suite. A synchronous spawn blocks the
// event loop, and `tests/structure.test.js` refuses one outright rather than
// asking each author to decide whether their particular case is the safe one.
const run = promisify(execFile);

// zsh is REQUIRED, not discovered. It is the shell that exposed the defect — and
// the shell these recipes actually run in — so a machine without it must fail
// loudly rather than quietly testing three shells that all agreed with the buggy
// code. Silently shrinking the matrix is how this check stops being able to fail.
const REQUIRED_SHELL = ['/bin/zsh', '/usr/bin/zsh', '/opt/homebrew/bin/zsh'].find((p) => existsSync(p));
const OPTIONAL_SHELLS = ['/bin/sh', '/bin/dash', '/bin/bash'].filter((p) => existsSync(p));
const SHELLS = [REQUIRED_SHELL, ...OPTIONAL_SHELLS].filter(Boolean);

test('zsh is present, because it is the shell this suite exists to cover', async () => {
  assert.ok(REQUIRED_SHELL, 'zsh not found — install it; these recipes run under the user shell, which is zsh here');
});

/**
 * The recipe's real block: the template `case`, the file-argument loop, and the
 * attachment guard, lifted verbatim from the agent between the `set --` that
 * opens it and the submission line.
 *
 * Extracted as ONE block rather than as separate fragments, so what runs here
 * keeps the production ordering and the guard's reachability — a reassembled
 * pair of snippets proves the snippets work, not that the recipe does.
 */
function recipeBlock() {
  const source = readFileSync(new URL('../agents/oai-delegate.md', import.meta.url), 'utf8');
  const start = source.indexOf('  set --\n  case "$template" in');
  const end = source.indexOf('  id=$(node ', start);
  assert.ok(start !== -1, 'the recipe must open its argument list with `set --` then the template case');
  assert.ok(end > start, 'the recipe must submit after building its argument list');
  return source.slice(start, end);
}

/**
 * Run the real block under one shell and return its argv, losslessly.
 *
 * The attachment list goes in a real `$dir/files`, exactly as the recipe reads
 * it, rather than being piped: the loop's redirection is part of the block under
 * test, and rewriting it would be the reassembly this suite exists to avoid.
 *
 * argv is NUL-delimited and never filtered: an empty argument is precisely the
 * failure being guarded against — `--template` would swallow one as its value —
 * so a test that drops empties cannot see the bug it exists to catch.
 */
async function argv(shell, template, files) {
  const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
  writeFileSync(join(dir, 'files'), files.map((f) => `${f}\n`).join(''));
  // `canon` and `root` are the recipe's own containment machinery, stubbed to
  // identity so this suite tests ARGUMENT CONSTRUCTION only.
  //
  // Nothing anywhere in `tests/` exercises the recipe's containment — not the
  // boundary check, not `canon`'s `--` argument-injection defence, not its
  // control-character refusal. That gap is real; it is not closed here,
  // because widening this suite to cover it would make it a second, worse copy
  // of a containment test rather than the argument-construction test it is.
  const script = `dir='${dir}'
template='${template}'
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
  try {
    const { stdout } = await run(shell, ['-c', script]);
    return { status: 0, argv: stdout.split('\0').slice(0, -1) };
  } catch (error) {
    return { status: error.code ?? 1, stdout: String(error.stdout ?? ''), argv: [] };
  }
}

test('every shell builds --template advisor as TWO arguments, ahead of the files', async () => {
  assert.ok(REQUIRED_SHELL, 'zsh must be among the shells under test');
  assert.ok(SHELLS.length >= 2, `expected several shells to test, found ${SHELLS.join(', ')}`);
  for (const shell of SHELLS) {
    const { status, argv: got } = await argv(shell, 'advisor', ['/tmp/a.mjs', '/tmp/b.mjs']);
    assert.equal(status, 0, `${shell} exited nonzero`);
    assert.deepEqual(
      got,
      ['--template', 'advisor', '--file', '/tmp/a.mjs', '--file', '/tmp/b.mjs'],
      `${shell} built the wrong argv — this is the assertion zsh failed`,
    );
    assert.equal(got.length, 6, `${shell}: argc must be exactly 6`);
  }
});

test('every shell passes NOTHING when no template is named, and no empty argument', async () => {
  for (const shell of SHELLS) {
    const { status, argv: got } = await argv(shell, '', ['/tmp/a.mjs']);
    assert.equal(status, 0, `${shell} exited nonzero`);
    assert.deepEqual(got, ['--file', '/tmp/a.mjs'], `${shell} built the wrong argv`);
    // Asserted explicitly, not implied by deepEqual: an empty argument here is
    // the failure `--template` would silently consume as its value.
    assert.ok(!got.includes(''), `${shell} emitted an empty argument`);
  }
});

test('a template name outside the closed set is refused, in every shell', async () => {
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, 'advisorr', ['/tmp/a.mjs']);
    assert.equal(status, 1, `${shell} admitted an unknown template`);
    assert.match(stdout ?? '', /refusing: unknown template advisorr/);
  }
});

test('a template does NOT satisfy the attachment guard on its own', async () => {
  // The regression a naive fix introduces: once the template occupies two
  // positional slots, comparing `$#` against a bare 0 lets a job with no
  // attachments through — a containment guard disarmed as a side effect of a
  // correctness fix elsewhere.
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, 'advisor', []);
    assert.equal(status, 1, `${shell} submitted with a template and no attachments`);
    assert.match(stdout ?? '', /refusing: no attachments/);
  }
});

test('the recipe ships with NO template selected by default', async () => {
  // Outside `recipeBlock()`, which starts below it, and every harness above
  // supplies its own value — so nothing here would notice if the shipped default
  // silently became `advisor` and every delegated analysis started being framed
  // as a second opinion.
  const source = readFileSync(new URL('../agents/oai-delegate.md', import.meta.url), 'utf8');
  assert.match(source, /^ {2}template=''$/m, "the recipe's default must be the empty template");
  assert.doesNotMatch(source, /^ {2}template='advisor'$/m);
});

test('the delegate and the registry admit exactly the same template names', async () => {
  // BOTH directions, and by exact word rather than substring. One direction
  // alone lets the recipe admit a name the companion would refuse — which the
  // recipe's whole purpose is to catch before a job exists.
  const block = recipeBlock();
  const arms = [...block.matchAll(/^\s{4}([a-z0-9-]+)\)\s*set --/gm)].map((m) => m[1]);
  assert.deepEqual(arms.sort(), Object.keys(TEMPLATES).sort(), 'the recipe and TEMPLATES must name the same set');
});
