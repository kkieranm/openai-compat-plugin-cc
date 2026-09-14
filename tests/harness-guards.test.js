// Structural guards on the TEST HARNESS itself.
//
// Separate from `structure.test.js` because that file sits at its own size
// budget, and because these guard a different thing: not the shape of the source
// but the ability of the suite to run at all on the runtimes this package
// declares. A defect here does not make a test fail — it makes a test file
// vanish, which is the failure mode the repo's zsh rule already exists for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TESTS = join(ROOT, 'tests');

function filesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.(mjs|js)$/.test(entry) ? [full] : [];
  });
}

// A STATIC import of a capability-gated builtin. `import x from 'node:sqlite'`
// and the bare `import 'node:sqlite'` both link before the module body runs;
// `await import('node:sqlite')` and `require('node:sqlite')` do not, and are the
// two forms this repo uses deliberately.
const STATIC_IMPORT = /^\s*import\s+(?:[^;'"]*\s+from\s+)?['"]node:sqlite['"]/m;

// `job-helpers.mjs` once carried a static `node:sqlite` import that killed
// ELEVEN test files at link time on every runtime this package supports.
// `node:sqlite` is unavailable on Node 18.18–22.12, on builds compiled
// without SQLite, and under `--no-experimental-sqlite`; this package
// declares `engines: >=18.18`.
//
// Why this cannot be left to the suite: a static import fails during LINKING, so
// no `skip` can report it, no assertion runs, and the file's entire contents
// disappear behind one `ERR_UNKNOWN_BUILTIN_MODULE` naming no test. A suite that
// silently shrinks its own matrix has stopped being able to fail.
//
// The guard is falsifiable: reinstate `import { DatabaseSync } from 'node:sqlite'`
// at the top of `tests/job-helpers.mjs` and this test names that file. Verified by
// doing exactly that, not by assuming it.
test('no test file statically imports node:sqlite, which links before any skip can run', () => {
  const offenders = filesUnder(TESTS)
    .filter((file) => STATIC_IMPORT.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file));

  assert.deepEqual(
    offenders,
    [],
    `these files link against node:sqlite and will crash whole-file on Node 18.18-22.12, on a build ` +
      `without SQLite, and under --no-experimental-sqlite: ${offenders.join(', ')}. Resolve it lazily ` +
      `instead — a caught dynamic import for detection, or createRequire() at the point of use — and ` +
      `skip the affected tests with a NAMED reason, as tests/job-helpers.mjs does.`,
  );
});

// Guards the guard. `filesUnder` walking nothing would make the assertion above
// pass against an empty list forever, which is the exact shape this repo has
// confirmed four separate assertions to have had.
test('the harness guard actually reads the test directory', () => {
  const files = filesUnder(TESTS);
  assert.ok(files.length > 20, `expected to scan the test suite, found ${files.length} files`);
  assert.ok(
    files.some((file) => file.endsWith('job-helpers.mjs')),
    'job-helpers.mjs must be in scope — it is the file whose static import prompted this guard',
  );
});
