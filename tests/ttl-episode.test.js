import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCases } from '../bench/lib/corpus.mjs';
import { runEpisode } from '../bench/lib/ttl-episode.mjs';

// I/O-level coverage for the one path ttl-verdict.test.js's pure-decision-rule
// tests cannot reach: what runEpisode itself does when the child never starts.

const ROOT = new URL('..', import.meta.url).pathname;

const CONFIG = {
  provider: 'local',
  model: 'test-model',
  maxTokens: 100,
  timeoutSeconds: 30,
  providerConfig: null,
  sampleEveryMs: 60_000,
  // Any command that exits fast without valid JSON is fine: startSampler's
  // take() wraps every call in try/catch and records `loaded: null` on failure,
  // which this test does not assert on.
  lms: 'true',
};

// A finite timeout on every test here, not the suite's default (unbounded): the
// whole point of this file is proving a regression can no longer HANG the
// process, and node:test's own default per-test timeout is Infinity — without
// this, a reintroduced hang would be indistinguishable from a slow suite rather
// than a clear, fast test failure.
const TIMEOUT_MS = 5_000;

test('a spawn that never starts resolves as never-dispatched, not an uncaught crash', { timeout: TIMEOUT_MS }, async () => {
  // materialize() always returns a real, freshly-created directory — the only
  // way to make the spawn itself fail is to override its cwd through the
  // injected spawnImpl, exercising the real Node ENOENT-on-bad-cwd path rather
  // than a hand-built fake child process.
  // Randomized, not a fixed literal: a fixed path could exist on some host and
  // silently turn this into a test of a real child instead of a spawn failure.
  const missingCwd = join(tmpdir(), `oai200-missing-${randomUUID()}`);
  const spawnImpl = (command, args, options) => spawn(command, args, {
    ...options,
    cwd: missingCwd,
  });
  const [caseDef] = loadCases(ROOT);
  const episode = await runEpisode(CONFIG, caseDef, 'test', ROOT, spawnImpl);

  assert.equal(episode.failed, true);
  assert.equal(episode.obtainedResponse, false);
  assert.equal(episode.exitCode, null);
  assert.equal(episode.attempts, null);
  assert.match(episode.stderr, /ENOENT/);
});

test('a spawnImpl that throws synchronously still cleans up and resolves', { timeout: TIMEOUT_MS }, async () => {
  // Distinct from the ENOENT test above: this exercises spawnImpl() itself
  // throwing (Node's real spawn() can do this under narrow conditions, e.g.
  // its permission model), not an async 'error' event — a separate code path
  // (the try/catch around the spawnImpl call) with its own cleanup obligation.
  let capturedDir;
  const spawnImpl = (command, args, options) => {
    capturedDir = options.cwd;
    throw new Error('synthetic synchronous spawn failure');
  };
  const [caseDef] = loadCases(ROOT);
  const episode = await runEpisode(CONFIG, caseDef, 'test', ROOT, spawnImpl);

  assert.equal(episode.failed, true);
  assert.equal(episode.obtainedResponse, false);
  assert.equal(episode.exitCode, null);
  assert.equal(episode.attempts, null);
  assert.match(episode.stderr, /synthetic synchronous spawn failure/);
  // The materialized directory this run's spawnImpl was actually called with —
  // proof `finish`'s `cleanup(dir)` ran on the sync-throw path, not just the
  // async 'error' path already covered above.
  assert.ok(capturedDir, 'spawnImpl should have been called with a cwd');
  assert.equal(existsSync(capturedDir), false);
});

test('a close firing after error is a no-op, not a second finalize', { timeout: TIMEOUT_MS }, async () => {
  // Node's own documented sequence for this failure — 'error' then 'close' with
  // code -2 — is exactly the double-event case `settled` exists to guard. This
  // proves the guard itself: without it, the 'close' handler's own
  // `sampler.stop()` would push a second 'post-exit' sample onto the SAME array
  // `episode.samples` already points at, mutating an already-resolved value out
  // from under whoever holds it.
  const missingCwd = join(tmpdir(), `oai200-missing-${randomUUID()}`);
  // A promise for the underlying child's OWN 'close' event, registered
  // synchronously inside spawnImpl — before either 'error' or 'close' can fire
  // on it, and therefore before runEpisode's own listeners for the same event.
  // Node dispatches every listener for one `emit()` synchronously, in
  // registration order, before any of their continuations (this promise's
  // `await` included) run as a microtask — so by the time `await closed` below
  // continues, runEpisode's own 'close' handler has already run to completion,
  // whether or not `settled` suppressed it. Checking `child.exitCode` instead
  // (an earlier draft of this test did) is NOT equivalent: that field can be
  // set before the queued 'close' listeners — including runEpisode's — have
  // actually executed, which let a real mutation through undetected.
  let closed;
  const spawnImpl = (command, args, options) => {
    const child = spawn(command, args, { ...options, cwd: missingCwd });
    closed = new Promise((resolve) => { child.once('close', resolve); });
    return child;
  };
  const [caseDef] = loadCases(ROOT);
  const episode = await runEpisode(CONFIG, caseDef, 'test', ROOT, spawnImpl);
  await closed;

  const postExit = episode.samples.filter((sample) => sample.phase === 'post-exit');
  assert.equal(postExit.length, 1);
});
