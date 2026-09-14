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

test('no function exceeds the function size budget', () => {
  const failures = [];
  const fnStart = /^\s*(?:export\s+)?(?:async\s+)?function\b|=>\s*{\s*$/;
  for (const file of sourceFiles(ROOT)) {
    const rel = relative(ROOT, file);
    if (ALLOWLIST[rel]) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    let start = -1, depth = 0;
    lines.forEach((line, i) => {
      if (start === -1 && fnStart.test(line)) { start = i; depth = 0; }
      if (start !== -1) {
        depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
        if (depth <= 0 && i > start) {
          if (i - start + 1 > MAX_FUNCTION_LINES) {
            failures.push(`${rel}:${start + 1}: function spans ${i - start + 1} lines > ${MAX_FUNCTION_LINES}`);
          }
          start = -1;
        }
      }
    });
  }
  assert.deepEqual(failures, []);
});

test('allowlist entries all carry a reason', () => {
  for (const [path, entry] of Object.entries(ALLOWLIST)) {
    assert.ok(entry.reason?.length > 10, `${path} allowlisted without a real reason`);
  }
});
