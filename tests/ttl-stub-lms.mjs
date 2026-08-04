#!/usr/bin/env node
/**
 * A fake `lms` for the TTL challenge harness.
 *
 * Its own file rather than an addition to `helpers.mjs`, which sits three lines
 * under the 300-line ratchet.
 *
 * The driver shells out to `lms` for four things — `ps --json`, `load`,
 * `unload -a` and `version` — and every residency fact the instrument reads comes
 * back through the first of them. So this is the seam that lets the whole I/O
 * half execute in a test: the withdrawn draft's I/O half never ran, and that is
 * where 10 of its 18 review findings lived.
 *
 * A scenario is a JSON file named by `TTL_STUB_SCENARIO`; mutable state lives
 * beside it under `TTL_STUB_STATE`. Residency is computed from the elapsed time
 * since the last `load`, which is exactly how the driver arranges its episodes:
 * load, then run, then load again for the next one.
 *
 * Scenario fields, all optional except `model`:
 *   model            the key `ps` reports resident
 *   appliedTtlMs     what `ps` reports as ttlMs — set it different from the
 *                    requested TTL to exercise the treatment-confirmed check
 *   unloadAtMs       when the model vanishes from `ps`, relative to load
 *   unreadableFromMs when `ps` starts emitting garbage instead of JSON
 *   competingModel   { key, fromMs, fromLoad } — a second resident model appearing
 *   fromLoad         which load onward a fault applies (1 = including calibration,
 *                    2 = challenge episodes only). Calibration now runs the same
 *                    validity checks as a challenge, so a fault present from load 1
 *                    disqualifies the sweep before any challenge episode exists —
 *                    which is correct, and would otherwise erase the coverage of
 *                    the per-episode path.
 *   lastUsedAdvances whether lastUsedTime moves on each poll
 *   failLoad         `load` exits non-zero
 */
import { readFileSync, writeFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync(process.env.TTL_STUB_SCENARIO, 'utf8'));
const statePath = process.env.TTL_STUB_STATE;
const [command] = process.argv.slice(2);

const readState = () => {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return { loadedAt: null, polls: 0 }; }
};
const writeState = (state) => writeFileSync(statePath, JSON.stringify(state));

/** Is a scenario fault in force for this load? `fromLoad` defaults to the first. */
function faultActive(state) {
  return (state.loads ?? 1) >= (scenario.fromLoad ?? 1);
}

function residency() {
  const state = readState();
  if (state.loadedAt === null) return [];
  const elapsed = Date.now() - state.loadedAt;
  const entries = [];
  if (scenario.unloadAtMs === undefined || scenario.unloadAtMs === null || elapsed < scenario.unloadAtMs) {
    entries.push({
      type: 'llm',
      modelKey: scenario.model,
      identifier: scenario.model,
      ttlMs: (faultActive(state) ? scenario.appliedTtlMs : null) ?? state.requestedTtlMs,
      // Advances only when the scenario says so, so a test can pin that the
      // instrument RECORDS this and never branches on it.
      lastUsedTime: 1_785_775_000_000 + (scenario.lastUsedAdvances ? state.polls * 1000 : 0),
      status: 'idle',
      contextLength: 61_696,
      maxContextLength: 262_144,
    });
  }
  const competing = scenario.competingModel;
  if (competing && elapsed >= competing.fromMs && faultActive(state)) {
    entries.push({ type: 'llm', modelKey: competing.key, identifier: competing.key, ttlMs: 3600_000,
      lastUsedTime: 1_785_775_000_000, status: 'idle', contextLength: 4096, maxContextLength: 4096 });
  }
  return entries;
}

if (command === 'ps') {
  const state = readState();
  writeState({ ...state, polls: (state.polls ?? 0) + 1 });
  const elapsed = state.loadedAt === null ? 0 : Date.now() - state.loadedAt;
  // "Could not read residency" and "nothing is loaded" are different facts, and
  // the instrument must not collapse them — so the stub can produce the first.
  if (scenario.unreadableFromMs != null && elapsed >= scenario.unreadableFromMs) {
    process.stdout.write('not json at all\n');
  } else {
    process.stdout.write(`${JSON.stringify(residency())}\n`);
  }
} else if (command === 'load') {
  if (scenario.failLoad) {
    process.stderr.write('stub: load failed\n');
    process.exit(1);
  }
  const ttlIndex = process.argv.indexOf('--ttl');
  const requestedTtlMs = ttlIndex === -1 ? null : Number(process.argv[ttlIndex + 1]) * 1000;
  const previous = readState();
  writeState({ loadedAt: Date.now(), polls: 0, requestedTtlMs, loads: (previous.loads ?? 0) + 1 });
} else if (command === 'unload') {
  // The load counter survives an unload: the driver unloads before every load, so
  // resetting it here would make `fromLoad` count nothing.
  writeState({ loadedAt: null, polls: 0, loads: readState().loads ?? 0 });
} else if (command === 'version') {
  // The real `lms version` prints an ANSI banner, not a version. Reproduced so
  // the instrument's parse of `CLI commit:` is exercised against the shape it
  // actually meets rather than a tidied one.
  process.stdout.write('[38;5;166m   __   __  ___[0m\n\nlms is LM Studio\'s CLI utility.\nCLI commit: stubc0de\n');
} else {
  process.stderr.write(`stub: unknown command ${command}\n`);
  process.exit(2);
}
