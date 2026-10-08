#!/usr/bin/env node
/**
 * A fake `lms` for the TTL challenge harness.
 *
 * The driver shells out to `lms` for four things — `ps --json`, `load`,
 * `unload -a` and `version` — and every residency fact the instrument reads comes
 * back through the first of them. So this is the seam that lets the whole I/O
 * half execute in a test.
 *
 * A scenario is a JSON file named by `TTL_STUB_SCENARIO`; mutable state lives
 * beside it under `TTL_STUB_STATE`. Residency is computed from the elapsed time
 * since the first `ps` after the last `load`: the driver reads residency back
 * straight after every load to confirm the TTL, then runs, then loads again for
 * the next one. Timing faults from that readback rather than from `load` keeps a
 * slow cold start of this stub from moving a fault in front of the readback.
 *
 * Scenario fields, all optional except `model`:
 *   model            the key `ps` reports resident
 *   appliedTtlMs     what `ps` reports as ttlMs — set it different from the
 *                    requested TTL to exercise the treatment-confirmed check
 *   unloadAtMs       when the model vanishes from `ps`, relative to the readback
 *   unreadableFromMs when `ps` starts emitting garbage instead of JSON, likewise
 *   competingModel   { key, fromMs } — a second resident model appearing,
 *                    fromMs relative to the readback
 *   slowReadbackMs   how long the readback after each load waits before reading
 *                    the clock, standing in for a slow cold start
 *   fromLoad         which load onward `appliedTtlMs` and `competingModel` apply
 *                    (1 = including calibration, 2 = challenge episodes only).
 *                    Calibration runs the same validity checks as a challenge,
 *                    so either of those two present from load 1 disqualifies the
 *                    sweep before any challenge episode exists — which is
 *                    correct, and would otherwise erase the coverage of the
 *                    per-episode path. The timed unload and garbage faults
 *                    ignore `fromLoad`; the readback sees elapsed 0, so one with
 *                    a positive onset cannot disqualify calibration, while an
 *                    onset of 0 hits the readback itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync(process.env.TTL_STUB_SCENARIO, 'utf8'));
const statePath = process.env.TTL_STUB_STATE;
const [command] = process.argv.slice(2);

const readState = () => {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return { loadedAt: null, polls: 0 }; }
};
const writeState = (state) => writeFileSync(statePath, JSON.stringify(state));

/** Do `appliedTtlMs` and `competingModel` apply on this load? `fromLoad` defaults to 1. */
function faultActive(state) {
  return (state.loads ?? 1) >= (scenario.fromLoad ?? 1);
}

function residency(state, elapsed) {
  if (state.loadedAt === null) return [];
  const entries = [];
  if (scenario.unloadAtMs === undefined || scenario.unloadAtMs === null || elapsed < scenario.unloadAtMs) {
    entries.push({
      type: 'llm',
      modelKey: scenario.model,
      identifier: scenario.model,
      ttlMs: (faultActive(state) ? scenario.appliedTtlMs : null) ?? state.requestedTtlMs,
      // A fixed placeholder. The instrument RECORDS lastUsedTime and never branches
      // on it, so nothing here needs it to move. A real LM Studio reports
      // `null` for the whole time it is serving a request — so an ADVANCING
      // timestamp is a shape not observed on the server this stub imitates.
      lastUsedTime: 1_785_775_000_000,
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
  const readback = state.loadedAt !== null && state.armedAt == null;
  if (readback && scenario.slowReadbackMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, scenario.slowReadbackMs);
  }
  const now = Date.now();
  const armedAt = readback ? now : state.armedAt ?? null;
  const elapsed = armedAt === null ? 0 : now - armedAt;
  writeState({ ...state, polls: (state.polls ?? 0) + 1, armedAt });
  // "Could not read residency" and "nothing is loaded" are different facts, and
  // the instrument must not collapse them — so the stub can produce the first.
  if (scenario.unreadableFromMs != null && elapsed >= scenario.unreadableFromMs) {
    process.stdout.write('not json at all\n');
  } else {
    process.stdout.write(`${JSON.stringify(residency(state, elapsed))}\n`);
  }
} else if (command === 'load') {
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
