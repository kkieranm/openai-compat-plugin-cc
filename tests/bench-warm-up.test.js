import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { persist } from '../bench/lib/record.mjs';
import { resolvePairs, warmUpFlags } from '../bench/lib/warm-up.mjs';

// OAI-21. Two things the 2026-07-30 arms had to do by hand: pay the JIT model
// load before the first measured case, and keep the rendered report beside the
// raw record. Both are the harness's job now, and these pin the parts that are
// decidable without a server.

const CASES = [
  { id: 'a', provider: null, model: null },
  { id: 'b', provider: null, model: null },
  { id: 'c', provider: 'other', model: 'pinned-model' },
];

test('one warm-up per distinct pair, not one per case', () => {
  const pairs = resolvePairs(CASES, {});
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0], { provider: null, model: null });
  assert.deepEqual(pairs[1], { provider: 'other', model: 'pinned-model' });
});

test('a command-line model collapses a mixed corpus to one pair, as it does for the runs themselves', () => {
  // `reviewFlags` resolves provider/model the same way, so warm-up must agree
  // with it: warming a model no case will actually request is a wasted load and
  // leaves the case that *does* run carrying the one that matters.
  const pairs = resolvePairs(CASES, { model: 'cli-model', provider: 'cli-provider' });
  assert.deepEqual(pairs, [{ provider: 'cli-provider', model: 'cli-model' }]);
});

test('pairs come in order of first use, so the load is paid before the case that would carry it', () => {
  const pairs = resolvePairs([CASES[2], CASES[0]], {});
  assert.deepEqual(pairs.map((pair) => pair.model), ['pinned-model', null]);
});

test('a pair naming nothing is still a pair — "whatever the config supplies" is a real model to load', () => {
  assert.deepEqual(resolvePairs([{ id: 'a', provider: null, model: null }], {}), [{ provider: null, model: null }]);
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
    const warmed = [{ provider: null, model: 'm', answered: false, durationMs: 1200 }];
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
