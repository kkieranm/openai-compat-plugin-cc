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
const SOURCE_EXT = /\.(js|mjs|cjs|ts|jsx|tsx|sh)$/;

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (SOURCE_EXT.test(name)) yield p;
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

test('allowlist entries all carry a reason', () => {
  for (const [path, entry] of Object.entries(ALLOWLIST)) {
    assert.ok(entry.reason?.length > 10, `${path} allowlisted without a real reason`);
  }
});
