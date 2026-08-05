// Two properties of the background machinery that no behavioural test notices
// when they erode, because both fail in the direction of *working better* until
// the day they take something down.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../scripts/', import.meta.url));

function sourceFiles(dir = ROOT) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.mjs') ? [path] : [];
  });
}

test('nothing in this repo ever signals a process', () => {
  // Cancel is cooperative *because* a pid can be recycled: by the time a row is
  // read, that number may belong to something else entirely. Signal 0 asks; any
  // other signal acts on a process this plugin cannot prove is its own. The
  // erosion this guards against is a later "make cancel stop faster" edit.
  let calls = 0;
  const offenders = [];
  for (const path of sourceFiles()) {
    for (const call of readFileSync(path, 'utf8').matchAll(/process\.kill\([^)]*\)/g)) {
      calls += 1;
      if (!/^process\.kill\([A-Za-z0-9_.]+,\s*0\)$/.test(call[0])) offenders.push(`${path}: ${call[0]}`);
    }
  }

  // Without this the guard passes by finding nothing, which is what a guard
  // looks like right up until someone deletes the thing it was watching.
  assert.ok(calls >= 1, 'the liveness probe has moved: this guard is examining nothing');
  assert.deepEqual(offenders, [], 'a signal other than 0 could land on a recycled pid');
});

test('the detached worker never inherits a descriptor from its parent', () => {
  // `tests/helpers.mjs` resolves a companion run on 'close', which waits for
  // every descriptor the child holds — so a grandchild holding an inherited
  // pipe turns `--background` into a foreground run and hangs the suite until
  // the client timeout. The log file is the whole point.
  const source = readFileSync(join(ROOT, 'lib/job-spawn.mjs'), 'utf8');
  const stdio = source.match(/stdio:\s*\[[^\]]*\]/);

  assert.ok(stdio, 'job-spawn.mjs no longer sets stdio explicitly');
  assert.doesNotMatch(stdio[0], /inherit|pipe/, `the worker must write to its log file, got ${stdio[0]}`);
  assert.match(source, /detached:\s*true/, 'a worker that is not detached dies with the session that submitted it');
});
