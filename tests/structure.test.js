// Structural invariants: size ratchet.
// A recurring defect class graduates from reviewer prompts to a test here;
// size/growth is the first such class. Raising a ceiling in ALLOWLIST is a
// deliberate commit — the entry must say why the item earns its size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const DEFAULT_MAX_LINES = 300; // per source file
const MAX_FUNCTION_LINES = 60;

// path -> { max, reason } — every entry needs a one-line design-call reason.
const ALLOWLIST = {};

const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude']);
// Skipped by path rather than by bare name, which would skip any directory
// called `cases` anywhere in the tree. The benchmark corpus is data, not
// source: historical blobs kept byte-identical *because* they contain known
// defects. A size budget over them would measure 2026's commits, and the
// harness code beside them stays under the ratchet like everything else.
const SKIP_PATHS = new Set(['bench/cases']);
const SOURCE_EXT = /\.(js|mjs|cjs|ts|jsx|tsx|sh)$/;

/**
 * Source with comments blanked out, for guards that forbid a *call*.
 *
 * Known limitation, stated rather than hidden: this is a regex, so a `//` inside
 * a string literal or a regex literal is treated as a comment. That can only
 * make a guard miss an offender in an oddly-written line, never invent one — and
 * the alternative, matching prose, produces false failures that get silenced.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_PATHS.has(relative(ROOT, p))) yield* sourceFiles(p);
    } else if (SOURCE_EXT.test(name)) yield p;
  }
}

test('no source file exceeds its size budget', () => {
  const failures = [];
  for (const file of sourceFiles(ROOT)) {
    const rel = relative(ROOT, file);
    const lines = readFileSync(file, 'utf8').split('\n').length;
    const budget = ALLOWLIST[rel]?.max ?? DEFAULT_MAX_LINES;
    if (lines > budget) failures.push(`${rel}: ${lines} lines > budget ${budget}`);
  }
  assert.deepEqual(failures, []);
});

// Spans are measured from a declaration at column 0 to the first line that is
// exactly "}". Counting braces instead would misfire on braces inside strings,
// template literals and regex literals. Known limitation: only `function`
// declarations are measured, not arrow functions assigned to a const.
test('no top-level function exceeds the function size budget', () => {
  const declaration = /^(?:export\s+)?(?:async\s+)?function\s/;
  const failures = [];

  for (const file of sourceFiles(ROOT)) {
    const rel = relative(ROOT, file);
    if (ALLOWLIST[rel]) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    let start = -1;

    lines.forEach((line, index) => {
      if (start === -1) {
        if (declaration.test(line)) start = index;
        return;
      }
      if (line === '}') {
        const span = index - start + 1;
        if (span > MAX_FUNCTION_LINES) {
          failures.push(`${rel}:${start + 1}: function spans ${span} lines > ${MAX_FUNCTION_LINES}`);
        }
        start = -1;
      }
    });
  }
  assert.deepEqual(failures, []);
});

// Confirmed twice, so promoted from a reviewer's prompt to a guard. Extracting a
// function under the size ratchet means inserting one above an existing
// declaration, and twice now the new function has landed *between* a docblock
// and the function that docblock described — leaving the old comment attached to
// unrelated code and its subject with none. It reads as harmless placement and
// is not: the orphaned block in `review-report.mjs` ended "Exported for the
// tests that pin those fields", which was then false of the private helper it
// had come to sit above.
//
// Two consecutive `/**` blocks with nothing between them is the exact shape, and
// nothing else in this repo produces it.
test('no doc comment is orphaned from the thing it documents', () => {
  const offenders = [];
  for (const dir of ['scripts', 'bench']) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let closedAt = -1;
      // Only once a function has been declared. Before that, a floating block is
      // a module header — this repo writes them in both `/** */` and `//` form —
      // which documents the file and is attached to nothing on purpose. Scoping
      // by position rather than by content is what keeps the guard from calling
      // the convention a defect.
      let seenFunction = false;
      lines.forEach((line, index) => {
        const text = line.trim();
        if (text === '*/') closedAt = index;
        // A second block opening with only blank lines since the last one
        // closed: whatever the first block described, it is not the next
        // declaration any more.
        if (seenFunction && text.startsWith('/**') && closedAt >= 0) {
          if (lines.slice(closedAt + 1, index).every((between) => between.trim() === '')) {
            offenders.push(`${relative(ROOT, file)}:${closedAt + 1}: doc comment is followed by another, not by a declaration`);
          }
        }
        if (/^(export\s+)?(async\s+)?function\s/.test(text)) seenFunction = true;
        if (text !== '*/' && text !== '') closedAt = -1;
      });
    }
  }
  assert.deepEqual(offenders, []);
});

// Confirmed defect class, promoted from a review note to a guard: spawnSync
// blocks this process's event loop, so the in-process fake server can never
// answer and the suite hangs until the client timeout instead of failing.
test('tests never spawn a child synchronously', () => {
  const offenders = [];
  for (const file of sourceFiles(join(ROOT, 'tests'))) {
    // Match a call, not a mention, so this guard does not flag itself.
    if (/\b(spawnSync|execSync|execFileSync)\s*\(/.test(readFileSync(file, 'utf8'))) {
      offenders.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], 'use the async runCompanion helper instead');
});

// Confirmed defect class, promoted from "a reviewer should catch it" to a guard.
// The global fetch is undici, and undici applies its own headersTimeout and
// bodyTimeout — 300s each, configurable by nothing at the call site. A
// configured `timeoutSeconds: 1800` was therefore decoration, and 14 of 18
// benchmark runs died at the 300s wall while the config advertised half an hour.
// The defect is an invisible default, so the call site is what this forbids;
// scripts/lib/http.mjs owns the request on node:http and makes every budget an
// argument. There are no exemptions: http.mjs itself has no reason to call fetch.
test('nothing calls the global fetch — every request goes through http.mjs', () => {
  // Comments are stripped first, because the modules that replaced fetch have to
  // be able to *say* "fetch()" while explaining why they exist — and a guard
  // that forbids naming the thing it forbids would be edited away rather than
  // obeyed. Markdown is outside SOURCE_EXT, so ADR prose is unaffected, and
  // bench/cases is already excluded via SKIP_PATHS: the frozen corpus holds
  // copies of the old client, byte-identical precisely because they contain
  // this defect.
  const offenders = [];
  for (const file of sourceFiles(ROOT)) {
    if (/\bfetch\s*\(/.test(withoutComments(readFileSync(file, 'utf8')))) offenders.push(relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], 'use send() from scripts/lib/http.mjs, which requires an explicit budget');
});

// Confirmed defect class, promoted from "I noticed it" to a guard: `node --test`
// with no path walks the whole repo, so the benchmark corpus — historical source
// kept deliberately as data — was discovered and its 2026-vintage tests were run
// against today's tree, failing on imports that no longer exist. The scope in the
// npm script is what stops that, and it reads as redundant until someone removes it.
test('the test runner is scoped, so corpus snapshots are not discovered as tests', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /tests\//, 'an unscoped `node --test` would run bench/cases snapshots');
});

test('allowlist entries all carry a reason', () => {
  for (const [path, entry] of Object.entries(ALLOWLIST)) {
    assert.ok(entry.reason?.length > 10, `${path} allowlisted without a real reason`);
  }
});

/**
 * Confirmed by the OAI-23 wide review, which proved it by mutation: moving
 * `capBudgets` below `ledger.begin` in `postWithDegrade` left all 370 tests
 * green while reopening the exact defect OAI-23 closed on the capability-rung
 * path — a refusal reclassified as benign negotiation for a replacement that was
 * never dispatched, plus a phantom entry for it.
 *
 * The class, which is what earns a guard rather than a test: **an ordering that
 * carries an invariant, pinned by nothing**. Two statements swap, the suite stays
 * green, and the invariant is gone. It cannot be reached behaviourally here — the
 * window between them is a few call frames, and the transport arms the remaining
 * cap as its own deadline, so a request cannot complete after expiry — which is
 * precisely why it needs a structural guard instead.
 *
 * Comments are stripped first: both tokens now appear in the prose that explains
 * this very ordering, and a guard matching those would pass vacuously. Absence of
 * either token FAILS rather than silently passing, so a rename breaks the test
 * instead of disabling it.
 */
test('the wall-clock cap is checked before a ledger entry is minted, not after', () => {
  const source = withoutComments(readFileSync(join(ROOT, 'scripts/lib/chat.mjs'), 'utf8')).split('\n');
  const start = source.findIndex((line) => /^export async function postWithDegrade\b/.test(line));
  assert.ok(start >= 0, 'postWithDegrade not found — was it renamed? Update this guard, do not delete it.');
  const end = source.indexOf('}', start);
  assert.ok(end > start, 'could not find the end of postWithDegrade');
  const body = source.slice(start, end).join('\n');

  const cap = body.indexOf('capBudgets(');
  const begin = body.indexOf('.begin(');
  assert.ok(cap >= 0, 'postWithDegrade no longer calls capBudgets — was it renamed? Update this guard.');
  assert.ok(begin >= 0, 'postWithDegrade no longer calls ledger.begin — was it renamed? Update this guard.');
  assert.ok(
    cap < begin,
    'capBudgets must run BEFORE ledger.begin: an entry minted first files a request that never went ' +
      'on the wire as a physical attempt, and settles a pending refusal that nothing replaced (OAI-23).',
  );
});
