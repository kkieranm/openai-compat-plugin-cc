import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { persist } from '../bench/lib/record.mjs';
import { pairFor, pairKey, runWithWarmUp, warmUpFlags } from '../bench/lib/warm-up.mjs';

// The harness pays the JIT model load before the first measured case, and
// keeps the rendered report beside the raw record, so a bench arm doesn't
// have to do either by hand. These pin the parts that are decidable without
// a server.

const CASES = [
  { id: 'a', provider: null, model: null },
  { id: 'b', provider: null, model: null },
  { id: 'c', provider: 'other', model: 'pinned-model' },
];

/**
 * Drives the real pair-change loop with fakes, recording the interleaving.
 *
 * The loop lives behind an injection seam precisely so this is possible:
 * `bench/run.mjs` calls `main()` at import, so asserting only on `pairFor` and
 * `pairKey` would stay green with the comparison in the loop deleted — a
 * mutation check that proves nothing.
 */
function drive(cases, options, { warmUp = true } = {}) {
  const order = [];
  const { results, warmed } = runWithWarmUp(
    cases,
    { ...options, 'warm-up': warmUp },
    {
      warm: (pair, caseDef) => {
        order.push(`warm:${caseDef.id}`);
        return { ...pair, beforeCase: caseDef.id };
      },
      run: (caseDef) => {
        order.push(`run:${caseDef.id}`);
        return caseDef.id;
      },
    },
  );
  return { results, warmed, order };
}

test('the command line outranks a case pin, exactly as reviewFlags resolves it', () => {
  // The rule the loop compares on. Warming a model no case will actually
  // request is a wasted load, and leaves the case that does run carrying the
  // one that matters.
  assert.deepEqual(pairFor(CASES[2], {}), { provider: 'other', model: 'pinned-model' });
  assert.deepEqual(pairFor(CASES[2], { model: 'cli' }), { provider: 'other', model: 'cli' });
  // Nulls are part of the identity, not absent from it: "whatever the config
  // supplies" must not collide with a pinned provider that has no model.
  assert.notEqual(pairKey({ provider: null, model: 'm' }), pairKey({ provider: 'm', model: null }));
  // And no separator can be smuggled across the field boundary. A joined string
  // made these two the same key, which would silently suppress the warm-up
  // between two genuinely different targets — the one thing this key decides.
  assert.notEqual(pairKey({ provider: 'a', model: 'b | c' }), pairKey({ provider: 'a | b', model: 'c' }));
});

test('one warm-up per distinct pair when the pairs do not alternate', () => {
  const { warmed } = drive(CASES, {});

  // `a` and `b` resolve alike, so `b` reuses `a`'s warm-up; `c` pins its own.
  assert.deepEqual(warmed.map((entry) => entry.beforeCase), ['a', 'c']);
  assert.deepEqual(warmed[0], { provider: null, model: null, beforeCase: 'a' });
  assert.deepEqual(warmed[1], { provider: 'other', model: 'pinned-model', beforeCase: 'c' });
});

test('an ALTERNATING corpus warms on every switch — the defect OAI-22 closed', () => {
  // The whole point of interleaving. Warming each pair once at first use leaves
  // cases 3 and 4 paying a JIT load on a server that keeps one model resident,
  // because the second warm-up evicted the first — which is the cost `--warm-up`
  // exists to remove, moved rather than removed.
  const alternating = [CASES[0], CASES[2], CASES[0], CASES[2]];
  const { warmed, order } = drive(alternating, {});

  assert.equal(warmed.length, 4, 'every switch of resident model needs its own load paid');
  assert.deepEqual(warmed.map((entry) => entry.model), [null, 'pinned-model', null, 'pinned-model']);
  // And each warm-up precedes the case it is for, rather than being batched.
  assert.deepEqual(order, [
    'warm:a', 'run:a', 'warm:c', 'run:c', 'warm:a', 'run:a', 'warm:c', 'run:c',
  ]);
});

test('case ORDER is untouched — the reason grouping by pair was rejected', () => {
  // Cases are scored independently but do not run independently: residency,
  // prompt cache, thermal state and correlated failure conditions are shared
  // mutable state, so reordering an arm weakens the cross-arm comparison.
  const alternating = [CASES[0], CASES[2], CASES[0], CASES[2]];
  const { results, order } = drive(alternating, {});

  assert.deepEqual(results, ['a', 'c', 'a', 'c']);
  assert.deepEqual(order.filter((step) => step.startsWith('run:')), ['run:a', 'run:c', 'run:a', 'run:c']);
});

test('a command-line pair collapses a mixed corpus to ONE warm-up — every OAI-19 arm', () => {
  // `reviewFlags` resolves provider/model the same way, so warm-up must agree
  // with it: warming a model no case will actually request is a wasted load and
  // leaves the case that *does* run carrying the one that matters.
  //
  // Both flags, not just `--model`: a model override alone does not override a
  // case-level `provider`, so a mixed-provider corpus would not collapse and
  // this test would be asserting the wrong thing.
  const { warmed } = drive(CASES, { model: 'cli-model', provider: 'cli-provider' });

  assert.equal(warmed.length, 1, 'one resolved pair is one load, however many cases there are');
  assert.deepEqual(warmed[0], { provider: 'cli-provider', model: 'cli-model', beforeCase: 'a' });
});

test('without the flag nothing is warmed, and the record says null rather than empty', () => {
  // `[]` would read as "warm-up ran and warmed nothing", which is a different
  // fact from "warm-up was not requested".
  const { warmed, order } = drive(CASES, {}, { warmUp: false });

  assert.equal(warmed, null);
  assert.deepEqual(order, ['run:a', 'run:b', 'run:c']);
});

test('a pair naming nothing is still a pair — "whatever the config supplies" is a real model to load', () => {
  const { warmed } = drive([{ id: 'a', provider: null, model: null }], {});
  assert.deepEqual(warmed, [{ provider: null, model: null, beforeCase: 'a' }]);
});

test('the rendered report is written beside the record, under the same stamp', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-persist-'));
  try {
    const { recordPath, reportPath } = persist(root, '2026-01-01T00-00-00-000Z', { runsPerCase: 1 }, '# Benchmark\n');
    // The stamp is shared, not minted twice: two files named for different
    // instants would be the same defect as no file at all, one debugging
    // session later.
    assert.equal(recordPath, join(root, 'bench/results/2026-01-01T00-00-00-000Z.json'));
    assert.equal(reportPath, join(root, 'bench/results/2026-01-01T00-00-00-000Z.md'));
    assert.equal(readFileSync(reportPath, 'utf8'), '# Benchmark\n\n');
    assert.deepEqual(JSON.parse(readFileSync(recordPath, 'utf8')), { runsPerCase: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the record states that warm-up ran, rather than only that the flag was passed', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-persist-'));
  try {
    // `answered`, never `ok`: a reasoning model spends its budget thinking and
    // exits non-zero on a request that loaded the weights perfectly well, so a
    // success flag here would read false on every model this repo runs.
    // `durationMs` is what separates "loaded" from "never reached the server".
    const warmed = [{ provider: null, model: 'm', beforeCase: 'config-origin', answered: false, durationMs: 1200 }];
    const { recordPath } = persist(root, 'stamp', { options: { 'warm-up': true }, warmed }, '');
    // "The flag was passed" and "the request happened" are different facts, and
    // only the second one is why the first case's prefill can be trusted.
    assert.deepEqual(JSON.parse(readFileSync(recordPath, 'utf8')).warmed, warmed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the prompt goes last, after every flag', () => {
  // `/oai:task` refuses a flag-looking word inside the request text, so a
  // prompt-first argv is rejected before anything is sent — and warm-up records
  // its outcome rather than throwing, so the arm would carry on with a `warmed`
  // entry that warmed nothing. That is exactly what the first version did, and
  // only running it revealed it.
  const flags = warmUpFlags({ provider: 'p', model: 'm' }, { timeout: '30' });
  assert.equal(flags[0], 'task');
  const prompt = flags.at(-1);
  assert.ok(!prompt.startsWith('--'), 'the last argument is the request, not a flag');
  for (const flag of ['--max-tokens', '--provider', '--model', '--timeout']) {
    assert.ok(flags.indexOf(flag) < flags.length - 1, `${flag} must precede the prompt`);
  }
});

test('warm-up carries the invocation budgets, so it cannot outlive the cap set for real work', () => {
  const flags = warmUpFlags({ provider: null, model: null }, { timeout: '30', 'max-seconds': '600' });
  assert.ok(flags.includes('--timeout') && flags.includes('30'));
  assert.ok(flags.includes('--max-seconds') && flags.includes('600'));
});
