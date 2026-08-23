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
import { readFileSync, existsSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
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
async function argv(shell, template, files, model) {
  const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
  writeFileSync(join(dir, 'files'), files.map((f) => `${f}\n`).join(''));
  // Written only when given, matching the recipe's own "omit the file entirely
  // when no model was named" rule — a real file, never a shell-interpolated
  // variable, the same file-based channel `files` already uses.
  if (model !== undefined) writeFileSync(join(dir, 'model'), model);
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

// Looped over every shell present, same as the template tests above and for
// the same reason: zsh does not split an unquoted expansion, so a test that
// only ran under zsh would miss a dropped quote around `$model` entirely —
// caught by mutation-testing this exact fix during implementation, the same
// failure class this file's whole multi-shell methodology exists to catch.

test('a caller-named model is forwarded as --model, ahead of the files', async () => {
  for (const shell of SHELLS) {
    const { status, argv: got } = await argv(shell, '', ['/tmp/a.mjs'], 'qwen3.8-27b');
    assert.equal(status, 0, `${shell} exited nonzero: ${got}`);
    assert.deepEqual(got, ['--model', 'qwen3.8-27b', '--file', '/tmp/a.mjs'], `${shell} built the wrong argv`);
  }
});

test('a caller-named model together with a template puts --template first', async () => {
  for (const shell of SHELLS) {
    const { status, argv: got } = await argv(shell, 'advisor', ['/tmp/a.mjs'], 'qwen3.8-27b');
    assert.equal(status, 0, `${shell} exited nonzero: ${got}`);
    assert.deepEqual(
      got,
      ['--template', 'advisor', '--model', 'qwen3.8-27b', '--file', '/tmp/a.mjs'],
      `${shell} built the wrong argv`,
    );
  }
});

test('no model file written means no --model in argv, and argc is unaffected', async () => {
  for (const shell of SHELLS) {
    const { status, argv: got } = await argv(shell, '', ['/tmp/a.mjs']);
    assert.equal(status, 0, `${shell} exited nonzero: ${got}`);
    assert.deepEqual(got, ['--file', '/tmp/a.mjs'], `${shell} built the wrong argv`);
    assert.ok(!got.includes('--model'), `${shell} emitted --model with no model file`);
  }
});

test('a model-only job with no attachments is still refused', async () => {
  // The same regression class the template-alone test guards against: a
  // second conditional argument source must not itself satisfy the
  // attachment guard.
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, '', [], 'qwen3.8-27b');
    assert.equal(status, 1, `${shell} submitted with a model and no attachments: ${stdout}`);
    assert.match(stdout ?? '', /refusing: no attachments/);
  }
});

test('a model id with shell metacharacters and spaces passes through as ONE argument, unmangled', async () => {
  const marker = `/tmp/oai-delegate-pwned-${process.pid}`;
  const hostile = `evil'; touch ${marker}; echo '`;
  for (const shell of SHELLS) {
    const { status, argv: got } = await argv(shell, '', ['/tmp/a.mjs'], hostile);
    assert.equal(status, 0, `${shell} exited nonzero: ${got}`);
    assert.deepEqual(got, ['--model', hostile, '--file', '/tmp/a.mjs'], `${shell} built the wrong argv`);
    assert.ok(!existsSync(marker), `${shell}: the hostile model id must never reach the shell as syntax`);
  }
});

// The twenty tests below exercise the Node-based model-id validator that
// replaced three successive shell-only fixes across review-ladder passes 1
// and 2: `IFS= read -r` (truncated at the first embedded `\n` before any
// guard ran), then `$(cat …)` plus a `tr -d '\000'` byte-length check
// (fixed that, but a NUL byte still vanished in bash/sh/dash — POSIX shell
// variables are C-string-backed there — and `$(…)` silently stripped a
// trailing `\n` as a side effect), then a shell `case … [[:cntrl:]] …`
// guard on top of that (itself locale- and shell-dependent — a Unicode C1
// control character passed dash under one locale and failed it under
// another, on identical bytes). Each is kept here as its own regression
// case, both because the current implementation now closes all of them at
// once and because a future edit that reintroduces shell-level validation
// should have to break all of these, not just one.

test('a model id carrying a bare CR is refused, not passed through', async () => {
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, '', ['/tmp/a.mjs'], 'qwen\r');
    assert.equal(status, 1, `${shell} admitted a model id with a control character`);
    assert.match(stdout ?? '', /refusing: model id contains a control character/);
  }
});

test('a model id saved with real CRLF bytes is refused, not just its bare-CR variant', async () => {
  // codex-plain (review-ladder pass 2): the test above is named for a
  // "CRLF-saved file" but only ever wrote a bare `\r`, never actual `\r\n`
  // bytes — this is the test that name promised. The trailing `\n` is
  // stripped as the file's own terminator (see the next test), leaving
  // `qwen\r`, which still contains a control character.
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, '', ['/tmp/a.mjs'], 'qwen\r\n');
    assert.equal(status, 1, `${shell} admitted a model id with CRLF bytes`);
    assert.match(stdout ?? '', /refusing: model id contains a control character/);
  }
});

test('a model id with a single trailing newline is tolerated, not refused', async () => {
  // The one deliberate exception to "refuse a newline": a single trailing
  // `\n` is the file's own terminator, not part of the id — the same
  // distinction `files` already draws between a newline that SEPARATES
  // entries and one embedded inside a single entry, and exactly what
  // `IFS= read -r` always did before any of the Node rewrite existed. A
  // caller (or an editor) that saves the `model` file the ordinary way must
  // not have its model silently refused for that alone.
  for (const shell of SHELLS) {
    const { status, argv: got } = await argv(shell, '', ['/tmp/a.mjs'], 'qwen3.8-27b\n');
    assert.equal(status, 0, `${shell} refused a model id with only a trailing newline`);
    assert.deepEqual(got, ['--model', 'qwen3.8-27b', '--file', '/tmp/a.mjs'], `${shell} built the wrong argv`);
  }
});

test('a model id with a SECOND trailing newline is refused, not silently normalized', async () => {
  // Only exactly one trailing `\n` is stripped as a terminator. A second one
  // is content, same as an embedded one, and must still trip the guard —
  // this is the case codex-adversarial named directly: `$(cat …)` used to
  // strip ALL trailing newlines, silently accepting `qwen\n\n` as `qwen`.
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, '', ['/tmp/a.mjs'], 'qwen\n\n');
    assert.equal(status, 1, `${shell} admitted a model id with two trailing newlines`);
    assert.match(stdout ?? '', /refusing: model id contains a control character/);
  }
});

test('a model id with an embedded newline is refused, not silently truncated', async () => {
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, '', ['/tmp/a.mjs'], 'qwen\nrest-of-line');
    assert.equal(status, 1, `${shell} admitted a model id with an embedded newline`);
    assert.match(stdout ?? '', /refusing: model id contains a control character/);
  }
});

test('a model id with an embedded NUL byte is refused, not silently concatenated', async () => {
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, '', ['/tmp/a.mjs'], 'qwen\x00rest-of-line');
    assert.equal(status, 1, `${shell} admitted a model id with an embedded NUL byte`);
    assert.match(stdout ?? '', /refusing: model id contains a control character/);
  }
});

test('a model id with a Unicode C1 control character (U+0085 NEXT LINE) is refused', async () => {
  // codex-adversarial (review-ladder pass 2): a shell `[[:cntrl:]]` case
  // guard is locale-dependent — this exact byte sequence (UTF-8 `c2 85`)
  // was demonstrated to pass dash under one locale and fail it under
  // another. The Node validator's JS regex has no locale to vary with.
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, '', ['/tmp/a.mjs'], 'qwenrest');
    assert.equal(status, 1, `${shell} admitted a model id with a Unicode C1 control character`);
    assert.match(stdout ?? '', /refusing: model id contains a control character/);
  }
});

test('an empty model file is refused with its own message, not treated as no model', async () => {
  // The agent is told never to write an empty `model` file (omit it
  // entirely when no model was named) — so an empty-but-present file is
  // itself a contract violation, not silently equivalent to an absent one.
  for (const shell of SHELLS) {
    const { status, stdout } = await argv(shell, '', ['/tmp/a.mjs'], '');
    assert.equal(status, 1, `${shell} silently accepted an empty model file`);
    assert.match(stdout ?? '', /refusing: model file is empty/);
  }
});

test('a model id with an invalid UTF-8 byte sequence is refused, not silently replaced', async () => {
  // Found in the review-ladder pass that followed the Node-validator rewrite
  // (fork-opener): `fs.readFileSync(path, "utf8")` decodes leniently,
  // substituting an invalid byte sequence with U+FFFD (REPLACEMENT
  // CHARACTER) rather than throwing — and U+FFFD sits outside the
  // control-character ranges the guard checks, so malformed bytes passed
  // through as a garbled-but-accepted id. Fixed with a fatal `TextDecoder`.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), Buffer.from([0x71, 0x77, 0x65, 0x6e, 0xff, 0xfe]));
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script]);
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 1, `${shell} admitted a model id with invalid UTF-8 bytes`);
    assert.match(stdout ?? '', /refusing: model id is not valid UTF-8/);
  }
});

test('a model id file starting with a UTF-8 byte-order mark is refused, not silently stripped', async () => {
  // Found in the review-ladder pass that followed the invalid-UTF-8 fix
  // (codex-adversarial): `TextDecoder`'s default `ignoreBOM: false` strips a
  // leading BOM (`EF BB BF`) during decode, before any check below ever sees
  // it — a BOM-prefixed id decoded to the clean id with the mark invisibly
  // gone, and a BOM-only file decoded to "", mislabeled as empty rather than
  // reported as a BOM. Checked on the raw bytes before decoding.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), Buffer.from([0xef, 0xbb, 0xbf, 0x71, 0x77, 0x65, 0x6e]));
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script]);
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 1, `${shell} admitted a model id starting with a BOM`);
    assert.match(stdout ?? '', /refusing: model file starts with a byte-order mark/);
  }
});

test('a model id with a BOM embedded after the start is refused, not silently passed through', async () => {
  // Found in the review-ladder pass's agent-closer stage: the leading-BOM
  // check above only inspects the raw bytes at offset 0. `TextDecoder`'s
  // BOM-stripping is positional too — a BOM anywhere else in the byte stream
  // decodes to a literal U+FEFF character that survives into the string,
  // sits outside the control-character ranges, and was forwarded verbatim as
  // part of --model. Checked on the decoded string as its own case, distinct
  // from both the leading-BOM and the control-character refusals.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(
      join(dir, 'model'),
      Buffer.from([0x71, 0x77, 0x65, 0x6e, 0xef, 0xbb, 0xbf, 0x72, 0x65, 0x73, 0x74]),
    );
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script]);
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 1, `${shell} admitted a model id with an embedded BOM`);
    assert.match(stdout ?? '', /refusing: model id contains an embedded byte-order-mark character/);
  }
});

test('an unexpected validator failure is reported as such, not mislabeled as a control character', async () => {
  // Found in the same pass (codex-adversarial and codex-plain,
  // independently): the exit-code dispatch used to end in a bare `*)`
  // labeling every unrecognized status "contains a control character" —
  // true for none of node crashing, node being missing, or being killed.
  //
  // Simulated with a DECOY `node` — a script named `node`, exiting 42,
  // placed ahead of the real one in PATH — rather than restricting PATH to
  // a fixed system directory list. The first version of this test did that
  // (`PATH: '/usr/bin:/bin'`), which is not portable: codex-adversarial
  // (review-ladder plan-gate round 11) pointed out that a system where
  // `node` itself lives under `/usr/bin` (common on Debian/Ubuntu package
  // installs) would still find the REAL node there and the test would pass
  // for the wrong reason, or not test what it claims at all. A decoy ahead
  // in PATH is unaffected by where the real binary happens to live.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen3.8-27b');
    const decoyDir = mkdtempSync(join(tmpdir(), 'oai-delegate-decoy-node-'));
    writeFileSync(join(decoyDir, 'node'), '#!/bin/sh\nexit 42\n');
    chmodSync(join(decoyDir, 'node'), 0o755);
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script], { env: { PATH: `${decoyDir}:${process.env.PATH}` } });
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 1, `${shell} did not refuse when node exited unexpectedly`);
    assert.match(stdout ?? '', /refusing: model id validator failed unexpectedly/);
    assert.doesNotMatch(stdout ?? '', /contains a control character/);
  }
});

test('a Node exit matching the code 1 uses (uncaught exception) is reported as unexpected, not mislabeled as a control character', async () => {
  // Found at this pass's own verdict point, round 1 (codex-adversarial): exit
  // code 1 was both this script's OWN signal for "contains a control
  // character" AND Node's documented default exit code for an uncaught
  // exception — a genuine Node startup failure exits 1 before this script's
  // own process.exit calls are ever reached, and the old dispatch could not
  // tell the two apart. Round 1's fix moved the control-character signal onto
  // exit 7 alone, which round 2 found was not far enough, and round 3 (below,
  // "an inherited NODE_OPTIONS cannot force a false refusal...") found the
  // whole 20+ range findings 11/12 moved to is itself forgeable by an
  // inherited NODE_OPTIONS — fixed there by clearing NODE_OPTIONS for this
  // script's own node invocation.
  //
  // That same fix is why this test no longer reproduces the crash with the
  // REAL node binary the way it originally did (a NODE_OPTIONS preload
  // naming a missing module): the recipe now clears NODE_OPTIONS before
  // invoking node, so an inherited preload can no longer reach it at all —
  // exactly the property round 3's fix exists to guarantee. Simulated
  // instead with a DECOY `node` exiting 1 (the same portable mechanism the
  // exit-42 test above uses), which still proves the ORIGINAL claim this
  // test exists for: exit 1 specifically, not just an arbitrary code, is
  // classified as "failed unexpectedly" and never as a control character.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen3.8-27b');
    const decoyDir = mkdtempSync(join(tmpdir(), 'oai-delegate-decoy-node-exit1-'));
    writeFileSync(join(decoyDir, 'node'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(decoyDir, 'node'), 0o755);
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script], { env: { PATH: `${decoyDir}:${process.env.PATH}` } });
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 1, `${shell} did not refuse when node exited 1`);
    assert.match(stdout ?? '', /refusing: model id validator failed unexpectedly/);
    assert.doesNotMatch(stdout ?? '', /contains a control character/);
  }
});

test('a Node exit matching the code 7 uses (a throwing exception handler) is reported as unexpected, not mislabeled as a control character', async () => {
  // Found at this pass's own verdict point, round 2 (codex-adversarial):
  // round 1's fix moved the control-character signal onto exit 7 — but exit 7
  // is ALSO Node's documented code for "an uncaughtException handler that
  // itself throws", so the collision was relocated, not closed. Node reserves
  // the whole low range (roughly 0-14) for its own internal failure meanings,
  // not just exit 1. Fixed by moving every custom code this validator owns to
  // 20+ — and, per round 3 (see the test above), that range is itself only
  // safe from what NODE ITSELF can produce; an inherited NODE_OPTIONS could
  // still forge it, which is why NODE_OPTIONS is now cleared for this
  // script's own node invocation. That same clearing is why this test no
  // longer reproduces the crash via a NODE_OPTIONS preload the way it
  // originally did — simulated instead with a DECOY `node` exiting 7,
  // proving exit 7 specifically still falls to the wildcard.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen3.8-27b');
    const decoyDir = mkdtempSync(join(tmpdir(), 'oai-delegate-decoy-node-exit7-'));
    writeFileSync(join(decoyDir, 'node'), '#!/bin/sh\nexit 7\n');
    chmodSync(join(decoyDir, 'node'), 0o755);
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script], { env: { PATH: `${decoyDir}:${process.env.PATH}` } });
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 1, `${shell} did not refuse when node exited 7`);
    assert.match(stdout ?? '', /refusing: model id validator failed unexpectedly/);
    assert.doesNotMatch(stdout ?? '', /contains a control character/);
  }
});

test('an inherited NODE_OPTIONS cannot force a false refusal by forging an exit code in the validator\'s own range', async () => {
  // Found at this pass's own verdict point, round 3 (codex-adversarial):
  // moving this validator's own codes to 20+ (findings 11/12) only defends
  // against what NODE ITSELF can produce — an ambient NODE_OPTIONS, set by
  // the operator's own shell for reasons unrelated to this recipe, can still
  // forge a result in that same range. Reproduced with the REAL node binary:
  // a preload that sets `process.exitCode = 25` makes `node -e` exit 25 —
  // the validator's OWN "contains a control character" code — even though
  // the model file here contains no control character at all, falsely
  // refusing a clean id. Fixed by clearing NODE_OPTIONS for this one
  // invocation (`NODE_OPTIONS= node -e …`), which this test proves by
  // confirming the clean id is still accepted despite the hostile preload.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen3.8-27b');
    const preloadDir = mkdtempSync(join(tmpdir(), 'oai-delegate-exitcode-preload-'));
    const preload = join(preloadDir, 'preload.js');
    writeFileSync(preload, 'process.exitCode = 25;\n');
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script], {
        env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
      });
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 0, `${shell} refused a clean id under a hostile inherited NODE_OPTIONS: ${stdout}`);
    assert.match(stdout ?? '', /--model\0qwen3\.8-27b\0/, `${shell} did not forward the clean id unmangled`);
  }
});

test('an inherited NODE_OPTIONS cannot inject bytes into the validated id via a preload writing to stdout', async () => {
  // Found in the same round as the exit-code-forgery test above
  // (codex-adversarial): a preload that WRITES to stdout before this
  // script's own code runs is silently prepended to the captured value with
  // exit 0 — nothing inside this validator ever inspects what a preload
  // writes, only what its own logic decides to write, so an inherited
  // NODE_OPTIONS could inject an embedded newline into `--model` this way,
  // bypassing every check in this validator entirely. Reproduced with the
  // REAL node binary: a preload writing "prefix\n" to stdout, combined with
  // a clean model file, produced a captured value of "prefix\nqwen..." with
  // exit 0 before the fix. Fixed the same way as the exit-code-forgery
  // finding: `NODE_OPTIONS= node -e …` clears the inherited preload for
  // this one invocation, so nothing it could have written ever reaches the
  // captured value.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen3.8-27b');
    const preloadDir = mkdtempSync(join(tmpdir(), 'oai-delegate-stdout-preload-'));
    const preload = join(preloadDir, 'preload.js');
    writeFileSync(preload, 'process.stdout.write("prefix\\n");\n');
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script], {
        env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
      });
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 0, `${shell} refused a clean id under a hostile inherited NODE_OPTIONS: ${stdout}`);
    assert.match(stdout ?? '', /--model\0qwen3\.8-27b\0/, `${shell} forwarded an injected/mangled id: ${stdout}`);
    assert.doesNotMatch(stdout ?? '', /prefix/, `${shell} let the preload's injected bytes reach the captured id`);
  }
});

test('an inherited OPENSSL_CONF cannot crash the validator before it ever reads the model file', async () => {
  // Found at this pass's own verdict point, round 4 (codex-adversarial):
  // NODE_OPTIONS was not the only startup input Node consults before -e
  // runs — OPENSSL_CONF is a second, independent one, and an OpenSSL 3.x
  // config can load a PROVIDER (arbitrary native code) during startup,
  // before this script's own logic ever executes. Reproduced with the REAL
  // node binary: an inherited, syntactically-broken OPENSSL_CONF crashed
  // node with exit 101 even with NODE_OPTIONS already cleared by finding
  // 13's fix — proving this is a genuinely separate vector, not covered by
  // that fix. Originally fixed by adding OPENSSL_CONF= alongside
  // NODE_OPTIONS=; finding 15 (below) replaced that pairwise clearing with
  // `env -i PATH="$PATH"`, which still defeats this exact reproduction —
  // this test still passes unchanged under the current fix.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen3.8-27b');
    const confDir = mkdtempSync(join(tmpdir(), 'oai-delegate-openssl-conf-'));
    const conf = join(confDir, 'malformed.cnf');
    writeFileSync(conf, 'this is not valid openssl config syntax [[[\n');
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script], {
        env: { ...process.env, OPENSSL_CONF: conf },
      });
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 0, `${shell} refused a clean id under a hostile inherited OPENSSL_CONF: ${stdout}`);
    assert.match(stdout ?? '', /--model\0qwen3\.8-27b\0/, `${shell} did not forward the clean id: ${stdout}`);
  }
});

test('an inherited Node IPC/cluster channel cannot inject bytes into the validated id', async () => {
  // Found at this pass's own verdict point, round 5 (codex-adversarial):
  // NODE_OPTIONS and OPENSSL_CONF were not the only startup inputs Node
  // consults before -e runs — Node's own child-process IPC/cluster
  // bootstrap does too, triggered by NODE_CHANNEL_FD/NODE_UNIQUE_ID, even
  // with both prior fixes in place. Reproduced with the REAL node binary:
  // NODE_CHANNEL_FD=1 NODE_UNIQUE_ID=x node -e '...' wrote a
  // {"cmd":"NODE_CLUSTER",...} JSON line to stdout, ahead of the script's
  // own output, with exit 0 — the same stdout-injection shape as finding
  // 13, through a third independent variable. This is the finding that
  // prompted finding 15's redesign (below): rather than clearing named
  // variables one discovery at a time, this invocation now runs under an
  // empty environment (env -i PATH="$PATH"), so a fourth or fifth
  // undiscovered variable in this same class is defeated by construction,
  // not by enumeration.
  //
  // `timeout` is deliberate and load-bearing here, not defensive padding: an
  // UNFIXED invocation under this exact env-var combination does not merely
  // misbehave, it can HANG indefinitely — discovered while mutation-testing
  // this test's own fix, confirmed with a minimal repro outside this suite.
  // Node's IPC-channel setup, told fd 1 is its channel, behaves differently
  // once fd 1 is `execFile`'s own capture pipe rather than a real paired
  // socket, and the resulting stall would otherwise hang this whole file's
  // test run rather than failing fast — the same risk this recipe's own
  // production use faces if ever invoked through a pipe-capturing harness
  // (which describes how this agent's own tool calls work) with this
  // variable inherited and unfixed.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen3.8-27b');
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script], {
        env: { ...process.env, NODE_CHANNEL_FD: '1', NODE_UNIQUE_ID: 'oai-delegate-test' },
        timeout: 10000,
      });
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 0, `${shell} refused a clean id under an inherited IPC/cluster channel: ${stdout}`);
    assert.match(stdout ?? '', /--model\0qwen3\.8-27b\0/, `${shell} forwarded an injected/mangled id: ${stdout}`);
    assert.doesNotMatch(stdout ?? '', /NODE_CLUSTER/, `${shell} let cluster-bootstrap output reach the captured id`);
  }
});

test('the model validator runs cleanly under an empty environment with every hostile variable set at once', async () => {
  // The positive control for finding 15's redesign: every hostile variable
  // findings 13-15 individually demonstrated (a stdout-writing NODE_OPTIONS
  // preload, a broken OPENSSL_CONF, and the IPC/cluster pair) set
  // SIMULTANEOUSLY, proving env -i PATH="$PATH" defeats all of them at once
  // rather than one at a time — the actual property this redesign claims,
  // not just each individual reproduction in isolation.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen3.8-27b');
    const preloadDir = mkdtempSync(join(tmpdir(), 'oai-delegate-kitchensink-preload-'));
    const preload = join(preloadDir, 'preload.js');
    writeFileSync(preload, 'process.stdout.write("prefix\\n");\n');
    const confDir = mkdtempSync(join(tmpdir(), 'oai-delegate-kitchensink-conf-'));
    const conf = join(confDir, 'malformed.cnf');
    writeFileSync(conf, 'this is not valid openssl config syntax [[[\n');
    const script = `dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          OPENSSL_CONF: conf,
          NODE_CHANNEL_FD: '1',
          NODE_UNIQUE_ID: 'oai-delegate-kitchensink',
        },
        timeout: 10000,
      });
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 0, `${shell} refused a clean id under every hostile variable at once: ${stdout}`);
    assert.match(stdout ?? '', /--model\0qwen3\.8-27b\0/, `${shell} forwarded an injected/mangled id: ${stdout}`);
    assert.doesNotMatch(stdout ?? '', /prefix|NODE_CLUSTER/, `${shell} let injected bytes reach the captured id`);
  }
});

test('a refused model id still prints its message under set -e, not a silent exit', async () => {
  // Found in the same pass (codex-adversarial), verified directly: a bare
  // `model=$(node -e ...)` assignment whose command fails causes `set -e` to
  // exit the whole script AT THAT LINE, before the `case "$?"` dispatch and
  // its message are ever reached — a caller running this recipe under `-e`
  // would see the job silently refused with no explanation at all. Fixed by
  // making the assignment the CONDITION of an `if`, which is the standard
  // `-e` exemption for a command whose status is being tested. This test
  // prepends `set -e` to the same script every other test in this file runs
  // without it, specifically to prove the message still reaches stdout.
  for (const shell of SHELLS) {
    const dir = mkdtempSync(join(tmpdir(), 'oai-delegate-test-'));
    writeFileSync(join(dir, 'files'), '/tmp/a.mjs\n');
    writeFileSync(join(dir, 'model'), 'qwen\r');
    const script = `set -e
dir='${dir}'
template=''
root=/tmp
canon() { printf '%s' "$1"; }
${recipeBlock()}
for a in "$@"; do printf '%s\\0' "$a"; done`;
    let status, stdout;
    try {
      const result = await run(shell, ['-c', script]);
      status = 0;
      stdout = result.stdout;
    } catch (error) {
      status = error.code ?? 1;
      stdout = String(error.stdout ?? '');
    }
    assert.equal(status, 1, `${shell} exited without going through the refusal message`);
    assert.match(stdout ?? '', /refusing: model id contains a control character/, `${shell} under set -e printed no message`);
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
