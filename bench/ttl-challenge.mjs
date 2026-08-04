#!/usr/bin/env node
/**
 * OAI-34 — does an in-flight prefill count as idle?
 *
 * The hypothesis: LM Studio's JIT TTL does not count a long prefill as activity,
 * so a model is unloaded mid-prefill and the request dies as an empty completion
 * — the shape that dominated the 2026-07-30 failures.
 *
 * This does NOT estimate a failure rate, and it does NOT confirm the mechanism.
 * It tries to FALSIFY it, by shortening the TTL to 120s against `scaffold`'s
 * measured 335s prefill on the dense 27B — the most favourable condition the
 * mechanism could be given. If prefill really is treated as idle, the model MUST
 * unload and the request MUST fail, so a survival past expiry is a counterexample.
 * Why there is no confirming verdict is in `lib/ttl-verdict.mjs`'s header.
 *
 * I/O only. Every rule about what an episode MEANS lives in `lib/ttl-verdict.mjs`,
 * pure and unit-tested, so the reading of the result is fixed before the numbers
 * arrive. ADR 013 carries the rationale, the rejected designs and the limits.
 *
 * Run it: `node bench/ttl-challenge.mjs` with LM Studio serving and NOTHING else
 * connected — another resident model can trigger Auto-Evict and produce the
 * shape this reads, which the sole-tenancy check catches and voids the sweep
 * over. ~45 minutes. Note it calls `lms unload -a` first, which unloads every
 * model, not just this one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases } from './lib/corpus.mjs';
import { isCanonical, resolveConfig } from './lib/ttl-config.mjs';
import { lms, runEpisode } from './lib/ttl-episode.mjs';
import {
  activityObserved, entryFor, firstUnload, lastPresentBefore, otherModelsSeen,
  residencyOf, residentAtStart, unreadableBefore,
} from './lib/ttl-residency.mjs';
import {
  EXPOSURE_MARGIN, calibrationCleared, episodeVerdict, summarize, validityChecks,
} from './lib/ttl-verdict.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
/**
 * Load the model under a named TTL and return what the server says it applied.
 *
 * Read back rather than trusted: a resident entry carries `ttlMs`, so an episode
 * that silently ran under the default TTL is caught rather than scored as though
 * it had not.
 */
function loadWithTtl(config, seconds) {
  lms(config, ['unload', '-a']);
  lms(config, ['load', config.model, '--ttl', String(seconds), '-y']);
  return entryFor(residencyOf(lms(config, ['ps', '--json'])), config.model);
}

/** Everything observed about one episode that is RECORDED but decides nothing. */
function observationQuality(config, episode) {
  const unload = firstUnload(episode.samples, config.model);
  const unloadAt = unload?.atMs ?? null;
  const lastPresent = unloadAt === null
    ? null : lastPresentBefore(episode.samples, config.model, unloadAt);
  return {
    unloadAt,
    lastPresentAt: lastPresent?.atMs ?? null,
    bracketMs: unloadAt !== null && lastPresent ? unloadAt - lastPresent.atMs : null,
    unreadableSamples: unreadableBefore(episode.samples, unloadAt ?? Infinity),
    targetResidentAtStart: residentAtStart(episode.samples, config.model),
    competingModels: otherModelsSeen(episode.samples, config.model),
    // Recorded, never acted on: if `lastUsedTime` did not advance across a prefill
    // that outlasted the TTL, the server did not count that work as activity — the
    // hypothesis in the server's own terms. One field's semantics are undocumented,
    // so a verdict resting on them would outrun what is known.
    activityObserved: activityObserved(episode.samples, config.model, episode.prefillMs),
  };
}

function classify(config, episode, resident) {
  const requestedTtlMs = config.challengeTtlSeconds * 1000;
  const quality = observationQuality(config, episode);
  Object.assign(episode, quality, {
    appliedTtlMs: resident?.ttlMs ?? null,
    contextLength: resident?.contextLength ?? null,
    exposureRatio: episode.prefillMs === null ? null : episode.prefillMs / requestedTtlMs,
    slackMs: episode.prefillMs === null ? null : episode.prefillMs - requestedTtlMs,
  });
  episode.validityFailures = validityChecks({
    appliedTtlMs: episode.appliedTtlMs,
    requestedTtlMs,
    competingModels: quality.competingModels,
    contradiction: episode.contradiction,
  });
  episode.verdict = episodeVerdict({
    ttlMs: requestedTtlMs,
    prefillMs: episode.prefillMs,
    failed: episode.failed,
    // An absence anywhere in the window the child was alive. Deliberately NOT
    // compared against first token or against the failure time: "in-flight" means
    // the child was alive, not that the request was open, so any such ordering
    // would be a claim the sampler cannot support.
    unloadObserved: quality.unloadAt !== null,
    obtainedResponse: episode.obtainedResponse,
    invalid: episode.validityFailures,
  });
  return episode;
}

async function calibrate(config, caseDef) {
  process.stderr.write(`Calibrating: ${config.case} at TTL ${config.calibrationTtlSeconds}s...\n`);
  const resident = loadWithTtl(config, config.calibrationTtlSeconds);
  const calibration = await runEpisode(config, caseDef, 'calibration', ROOT);
  // The SAME preconditions the challenge episodes must meet. Without this the
  // gate that licenses every other episode could clear while its own attempt
  // record contradicted itself, another model was resident, or the server never
  // applied the TTL it was asked for — and G8 exists precisely because such a
  // record "is not what this instrument thinks it is reading".
  calibration.appliedTtlMs = resident?.ttlMs ?? null;
  calibration.competingModels = otherModelsSeen(calibration.samples, config.model);
  calibration.validityFailures = validityChecks({
    appliedTtlMs: calibration.appliedTtlMs,
    requestedTtlMs: config.calibrationTtlSeconds * 1000,
    competingModels: calibration.competingModels,
    contradiction: calibration.contradiction,
  });
  calibration.cleared = calibration.validityFailures.length === 0 && calibrationCleared({
    obtainedResponse: calibration.obtainedResponse,
    failed: calibration.failed,
    prefillMs: calibration.prefillMs,
    challengeTtlMs: config.challengeTtlSeconds * 1000,
  });
  process.stderr.write(calibration.prefillMs === null
    ? '  no first token measured — calibration did not answer\n'
    : `  first token at ${Math.round(calibration.prefillMs / 1000)}s\n`);
  if (calibration.validityFailures.length) {
    process.stderr.write(`  calibration preconditions failed: ${calibration.validityFailures.join(', ')}\n`);
  }
  return calibration;
}

async function runChallenges(config, caseDef) {
  const episodes = [];
  for (let i = 1; i <= config.episodes; i += 1) {
    process.stderr.write(`Challenge ${i}/${config.episodes} at TTL ${config.challengeTtlSeconds}s...\n`);
    // Reloaded before EVERY episode, never once for the batch: an unload between
    // episodes would let the next request JIT-load under the DEFAULT TTL, so a
    // later episode would silently stop testing the shortened one.
    const resident = loadWithTtl(config, config.challengeTtlSeconds);
    const episode = classify(config, await runEpisode(config, caseDef, `challenge-${i}`, ROOT), resident);
    process.stderr.write(`  ${episode.verdict}\n`);
    episodes.push(episode);
  }
  return episodes;
}

function writeManifest(config, body) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = config.outDir ?? join(ROOT, 'bench', 'results');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `ttl-challenge-${stamp}.json`);
  // Built from the EFFECTIVE config, never from module constants: a record that
  // asserts the shipped protocol while something else ran is worse than no record.
  writeFileSync(path, `${JSON.stringify({
    protocol: { ...config, exposureMargin: EXPOSURE_MARGIN, canonical: isCanonical(config) },
    ...body,
  }, null, 2)}\n`);
  return path;
}

function environmentOf(config) {
  const read = (fn) => { try { return fn(); } catch { return null; } };
  return {
    startedAt: new Date().toISOString(),
    model: config.model,
    // `lms version` prints an ANSI banner, not a version. The commit is the only
    // identifying string in it; the withdrawn draft recorded the whole banner,
    // escape codes and ASCII art included.
    lmsCommit: read(() => lms(config, ['version']).match(/CLI commit:\s*(\S+)/)?.[1] ?? null),
    // Named apart from the episode field of nearly the same name: this is a LIST
    // of resident models before anything ran, that one is a BOOLEAN about the
    // target. Same key with two types in one document is a trap for the write-up
    // that reads it.
    residentBefore: read(() => residencyOf(lms(config, ['ps', '--json']))),
  };
}

function report(config, environment, calibration, episodes, outcome) {
  const path = writeManifest(config, { environment, calibration, episodes, outcome });
  process.stdout.write(`\n${outcome.verdict}\n\n${outcome.says}\n\nRecord: ${path}\n`);
  return outcome.verdict === 'instrument-failed' ? 1 : 0;
}

async function main(argv) {
  const config = resolveConfig(argv);
  const caseDef = loadCases(ROOT).find((c) => c.id === config.case);
  if (!caseDef) throw new Error(`no such case: ${config.case}`);
  const environment = environmentOf(config);

  const calibration = await calibrate(config, caseDef);
  if (!calibration.cleared) {
    // A RECORD, not a throw. The withdrawn draft threw, discarding the evidence
    // for a disqualification that only ever reached stderr — and an earlier one
    // printed "ABORT" and then ran the full sweep anyway, exiting 0 with a
    // normal-looking record. Machine-readable, and nonzero.
    return report(config, environment, calibration, [],
      summarize([], { calibrationCleared: false }));
  }

  const episodes = await runChallenges(config, caseDef);
  const slacks = episodes.map((e) => e.slackMs).filter((ms) => typeof ms === 'number');
  return report(config, environment, calibration, episodes, summarize(
    episodes.map((e) => e.verdict),
    { calibrationCleared: true, minSlackMs: slacks.length ? Math.min(...slacks) : null },
  ));
}

// Only when RUN, never when imported. Without this guard `npm test` executes the
// experiment: the decision rule is unit-tested, importing it to do so ran `main`,
// and the suite spent 44 extra seconds driving LM Studio and wrote a junk record
// into bench/results. A module that does work on import cannot be tested without
// doing that work.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exit(1);
    });
}
