// `isMainModule` decides whether a bench driver runs: true for the script Node
// was asked to run however its path was spelled, false for a module that was
// only imported. Each case spawns a real `node`, since `process.argv[1]` and
// `import.meta.url` are only meaningful in a fresh process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { tempDir } from './helpers.mjs';

const run = promisify(execFile);
const HELPER = new URL('../bench/lib/main-module.mjs', import.meta.url).href;
const REPO = fileURLToPath(new URL('..', import.meta.url));

/**
 * A directory holding an entry file that prints `isMainModule` for itself and
 * for a module it imports, plus a link to the directory and a link to the file.
 * The helper is imported by absolute URL so a preserved link resolves it too.
 */
function fixture() {
  // Resolved, so the real-path case crosses no link (macOS temp dirs sit under
  // the /var -> /private/var link).
  const root = realpathSync(tempDir('oai-main-module-'));
  const real = join(root, 'real');
  mkdirSync(real);
  writeFileSync(join(real, 'dep.mjs'), `import { isMainModule } from ${JSON.stringify(HELPER)};\nexport const dep = isMainModule(import.meta.url);\n`);
  writeFileSync(
    join(real, 'entry.mjs'),
    `import { isMainModule } from ${JSON.stringify(HELPER)};\nimport { dep } from ${JSON.stringify(pathToFileURL(join(real, 'dep.mjs')).href)};\nprocess.stdout.write(JSON.stringify({ entry: isMainModule(import.meta.url), dep }));\n`,
  );
  symlinkSync(real, join(root, 'linked-dir'));
  symlinkSync(join(real, 'entry.mjs'), join(root, 'linked-entry.mjs'));
  return root;
}

const FIXTURE = fixture();

/** `node -e` asking the helper about itself, with any extra argv after the code. */
const probe = (...argv) =>
  run(process.execPath, [
    '--input-type=module',
    '-e',
    `import { isMainModule } from ${JSON.stringify(HELPER)}; process.stdout.write(String(isMainModule(${JSON.stringify(HELPER)})));`,
    ...argv,
  ]);

async function verdicts(args) {
  const { stdout } = await run(process.execPath, args);
  return JSON.parse(stdout);
}

test('the entry script is main and an imported module is not, by its real path', async () => {
  assert.deepEqual(await verdicts([join(FIXTURE, 'real', 'entry.mjs')]), { entry: true, dep: false });
});

test('a symlinked directory in the path still names the entry script', async () => {
  assert.deepEqual(await verdicts([join(FIXTURE, 'linked-dir', 'entry.mjs')]), { entry: true, dep: false });
});

test('a symlink to the file itself still names the entry script', async () => {
  assert.deepEqual(await verdicts([join(FIXTURE, 'linked-entry.mjs')]), { entry: true, dep: false });
});

test('--preserve-symlinks-main keeps the link in import.meta.url, and still matches', async () => {
  assert.deepEqual(await verdicts(['--preserve-symlinks-main', join(FIXTURE, 'linked-entry.mjs')]), { entry: true, dep: false });
});

test('under -e there is no entry script, even when argv[1] names this very module', async () => {
  assert.equal((await probe()).stdout, 'false');
  assert.equal((await probe(fileURLToPath(HELPER))).stdout, 'false');
});

test('-p and -pe count as eval too', async () => {
  // The verdict goes to stderr: `-p` prints its own result to stdout, before or
  // after the import settles depending on the Node version.
  const code = `import(${JSON.stringify(HELPER)}).then(({ isMainModule }) => process.stderr.write('RESULT:' + isMainModule(${JSON.stringify(HELPER)})))`;
  for (const flag of ['-p', '-pe']) {
    const { stderr } = await run(process.execPath, [flag, code, fileURLToPath(HELPER)]);
    assert.equal(stderr, 'RESULT:false', flag);
  }
});

test('an entry script that no longer resolves is not main, and does not throw', async () => {
  // The entry deletes itself before asking, so `realpathSync(argv[1])` fails.
  const dir = realpathSync(tempDir('oai-main-module-gone-'));
  const entry = join(dir, 'gone.mjs');
  writeFileSync(
    entry,
    `import { unlinkSync } from 'node:fs';\nimport { fileURLToPath } from 'node:url';\nimport { isMainModule } from ${JSON.stringify(HELPER)};\nunlinkSync(fileURLToPath(import.meta.url));\nprocess.stdout.write(String(isMainModule(import.meta.url)));\n`,
  );
  assert.equal((await run(process.execPath, [entry])).stdout, 'false');
});

test('a driver imported under -e with its own path as argv[1] stays inert', async () => {
  // The driver's usage error would mean its main ran; the sentinel proves the
  // import itself completed.
  const driver = join(REPO, 'bench', 'compare.mjs');
  const { stdout, stderr } = await run(process.execPath, [
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(pathToFileURL(driver).href)}); process.stdout.write('imported');`,
    driver,
    '--bogus-flag',
  ]);
  assert.equal(stdout, 'imported');
  assert.doesNotMatch(stderr, /Unknown option/);
});

test('a bench driver invoked through a symlinked checkout runs and reports its usage error', async () => {
  // At the real driver: a guard that compared the raw argv path would skip `main`
  // here and exit 0 having printed nothing.
  const root = tempDir('oai-main-module-repo-');
  symlinkSync(REPO, join(root, 'checkout'));
  await assert.rejects(
    run(process.execPath, [join(root, 'checkout', 'bench', 'compare.mjs'), '--bogus-flag']),
    (error) => error.code === 1 && /Unknown option "--bogus-flag"/.test(error.stderr),
  );
});
