import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { cleanup, materialize } from './corpus.mjs';
import {
  clientBudgetReason, obtainedAnyResponse, prefillFromAttempts, recordContradiction,
} from './ttl-attempts.mjs';
import { residencyOf } from './ttl-residency.mjs';

/**
 * Running ONE episode: spawn the real review command, sample residency while it
 * lives, and return what was observed.
 *
 * Split from the driver at the size ratchet, and the seam is real — this module
 * knows how to execute and observe one request; `ttl-challenge.mjs` knows the
 * protocol those requests are arranged into. Neither decides what an episode
 * means; that is `ttl-verdict.mjs`.
 */

export const lms = (config, args) => execFileSync(config.lms, args, { encoding: 'utf8', maxBuffer: 8e6 });

/**
 * Residency, sampled while the child is alive.
 *
 * `execFileSync` inside the interval deliberately: the request under test is a
 * SEPARATE process, so blocking this event loop cannot starve it. The repo
 * footgun it resembles — never spawnSync while an in-process fake server must
 * answer — applies to whoever launches THIS process, not to this line.
 */
export function startSampler(config, startedAt) {
  const samples = [];
  // Stamped at collection, never inferred later from timestamps. Readers want
  // different windows of the same series, and both window bugs in the withdrawn
  // draft came from filtering a flat array by hand.
  let phase = 'pre-dispatch';
  const take = () => {
    let loaded = null;
    try {
      loaded = residencyOf(lms(config, ['ps', '--json']));
    } catch {
      loaded = null;
    }
    samples.push({ atMs: Date.now() - startedAt, phase, loaded });
  };
  take();
  const timer = setInterval(take, config.sampleEveryMs);
  return {
    samples,
    dispatched: () => { phase = 'in-flight'; },
    // The final reading is kept — worth having in the manifest — but marked for
    // what it is. An absence first seen AFTER the child closed says nothing about
    // the run.
    stop: () => { clearInterval(timer); phase = 'post-exit'; take(); },
  };
}

function reviewFlags(config, args, label) {
  return [
    'review', ...args, '--json',
    '--provider', config.provider,
    '--model', config.model,
    '--cache-buster', `oai34-${label}-${randomUUID()}`,
    '--max-tokens', String(config.maxTokens),
    '--timeout', String(config.timeoutSeconds),
    // Never retried. A retry would re-send after the first failure, resetting the
    // idle clock and reviewing the same target a second time — so the episode
    // would no longer be the single exposure it is counted as.
    '--max-attempts', '1',
  ];
}

/**
 * The child's environment.
 *
 * A canonical run STRIPS an ambient `OAI_PLUGIN_CONFIG` rather than trusting it
 * to be unset: the spawn inherits the environment, so without this a default-argv
 * run could point the companion at an arbitrary provider and still stamp the
 * record `canonical: true`.
 */
function childEnv(config) {
  const env = { ...process.env };
  if (config.providerConfig) env.OAI_PLUGIN_CONFIG = config.providerConfig;
  else delete env.OAI_PLUGIN_CONFIG;
  return env;
}

/**
 * One review through the real command, timed, with residency sampled throughout.
 *
 * `spawnImpl` defaults to the real `spawn` and exists only so a test can wrap it
 * with a forced bad `cwd` to exercise the `'error'` path below against real Node
 * ENOENT semantics — `materialize` always returns a real, freshly-created
 * directory, so there is no other way to make this function's spawn actually fail.
 */
export function runEpisode(config, caseDef, label, root, spawnImpl = spawn) {
  const { dir, args } = materialize(caseDef, root);
  const companion = join(root, 'scripts', 'oai-companion.mjs');
  const startedAt = Date.now();
  const sampler = startSampler(config, startedAt);
  return new Promise((resolve) => {
    // Guards against a double resolve: on some Node versions a spawn failure
    // fires 'error' AND THEN 'close' (with code -2) for the same failure, rather
    // than 'error' alone — observed directly, not merely documented. `finish`
    // takes a BUILDER, not a value, so whichever event wins still measures
    // `durationMs` at the same point production always has: after `sampler.stop()`
    // and `cleanup(dir)`, not before.
    let settled = false;
    const finish = (build) => {
      if (settled) return;
      settled = true;
      sampler.stop();
      cleanup(dir);
      resolve(build());
    };
    // The shared shape for "the child never dispatched anything" — reused by
    // BOTH failure routes below (the async 'error' event, and a synchronous
    // throw from `spawnImpl` itself) rather than duplicated, so the two stay
    // provably identical. Every downstream reader (`obtainedAnyResponse`,
    // `episodeVerdict`, etc.) already handles `attempts: null` — no new verdict
    // branch needed.
    const notDispatched = (message) => ({
      label,
      exitCode: null,
      failed: true,
      obtainedResponse: obtainedAnyResponse(null),
      contradiction: recordContradiction(null),
      durationMs: Date.now() - startedAt,
      prefillMs: prefillFromAttempts(null),
      clientBudgetReason: clientBudgetReason(null),
      attempts: null,
      samples: sampler.samples,
      stderr: message,
    });
    let child;
    try {
      child = spawnImpl(process.execPath, [companion, ...reviewFlags(config, args, label)], {
        cwd: dir, env: childEnv(config), stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // `spawn()` itself throws synchronously only under narrow conditions (e.g.
      // Node's permission model) — real production calls essentially never hit
      // this — but an uncaught synchronous throw here would otherwise leave
      // `sampler`'s interval running forever and `dir` uncleaned, since nothing
      // downstream of this line would ever run. Routed through the same `finish`
      // path as every other failure rather than left to reject the promise.
      finish(() => notDispatched(`spawn error: ${error.message}`));
      return;
    }
    // Registered immediately, before the stdout/stderr listeners below, so
    // nothing sits between `spawnImpl` returning and 'error' having a listener —
    // Node only emits child process events on a later tick, so this ordering
    // isn't load-bearing today, but costs nothing and removes the question.
    //
    // Without this, a spawn-level failure (bad executable, EACCES, ENOENT) is an
    // unhandled 'error' event, which is an uncaught exception under Node's default
    // EventEmitter behavior and crashes the whole ~45-minute unattended sweep.
    child.on('error', (error) => {
      finish(() => notDispatched(`spawn error: ${error.message}`));
    });
    // Not called unconditionally right after `spawnImpl` returns: `spawn()`'s
    // return is synchronous, but whether the child actually started is not
    // known until Node's own 'spawn' event fires (or 'error' fires instead) —
    // both asynchronous. Marking the sampler 'in-flight' before that would let
    // a sample land in that narrow window tagged as if a child existed when a
    // failure ('error') was still equally possible, contradicting the phase
    // contract `ttl-residency.mjs` reads.
    child.once('spawn', () => { sampler.dispatched(); });
    let stdout = '';
    let stderr = '';
    // `?.`: `child.stdout`/`child.stderr` are non-null whenever `stdio` requests
    // a pipe for that fd, as it always does here — confirmed directly, including
    // for a spawn that goes on to fail — but Node's own docs allow a null stream
    // when the process could not be spawned at all, so this stays defensive
    // rather than asserting a guarantee this file cannot independently prove for
    // every possible spawn failure shape.
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      let report = null;
      try { report = JSON.parse(stdout); } catch { report = null; }
      const attempts = report?.attempts ?? null;
      finish(() => ({
        label,
        exitCode: code,
        failed: code !== 0,
        obtainedResponse: obtainedAnyResponse(attempts),
        contradiction: recordContradiction(attempts),
        durationMs: Date.now() - startedAt,
        // From the ATTEMPT, not from a top-level field the FAILURE envelope does
        // not carry. The withdrawn draft read `report.prefillMs`, so this was null
        // on every failed episode — the ones this experiment is about.
        prefillMs: prefillFromAttempts(attempts),
        clientBudgetReason: clientBudgetReason(attempts),
        attempts,
        samples: sampler.samples,
        stderr: stderr.slice(-4_000),
      }));
    });
  });
}
