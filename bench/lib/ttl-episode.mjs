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

/** One review through the real command, timed, with residency sampled throughout. */
export function runEpisode(config, caseDef, label, root) {
  const { dir, args } = materialize(caseDef, root);
  const companion = join(root, 'scripts', 'oai-companion.mjs');
  const startedAt = Date.now();
  const sampler = startSampler(config, startedAt);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [companion, ...reviewFlags(config, args, label)], {
      cwd: dir, env: childEnv(config), stdio: ['ignore', 'pipe', 'pipe'],
    });
    sampler.dispatched();
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      sampler.stop();
      cleanup(dir);
      let report = null;
      try { report = JSON.parse(stdout); } catch { report = null; }
      const attempts = report?.attempts ?? null;
      resolve({
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
      });
    });
  });
}
