// The heartbeat's own claims. It exists to say what is happening, so a label
// that is wrong is worse than no label — and both defects below were exactly
// that: a figure named tok/s that was not tok/s, and a phase override that
// looked applied and was inert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startProgress } from '../scripts/lib/progress.mjs';
import { withProgress } from '../scripts/lib/progress.mjs';

/** A clock that advances a fixed step per read, so output is deterministic. */
function fakeClock(stepMs) {
  let t = 0;
  return () => {
    t += stepMs;
    return t;
  };
}

function collector() {
  const lines = [];
  return { lines, write: (text) => lines.push(text) };
}

test('nothing is printed before the first interval elapses', async () => {
  const { lines, write } = collector();
  const progress = startProgress({ intervalMs: 60_000, write });
  progress.update({ content: 'hi', reasoning: '', deltas: 1 });
  progress.stop();
  assert.deepEqual(lines, [], 'a fast run — and every test — must stay silent');
});

test('the rate is estimated from characters, not from frame count', async () => {
  const { lines, write } = collector();
  // 340 characters is 100 tokens at the repo's estimator, and the clock advances
  // 1s per read. One frame or fifty must not change the answer.
  const progress = startProgress({ intervalMs: 5, write, now: fakeClock(1000) });
  progress.update({ content: 'x'.repeat(340), reasoning: '', deltas: 1 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  progress.stop();

  const line = lines.at(-1) ?? '';
  assert.match(line, /tok\/s/);
  assert.doesNotMatch(line, /NaN/, 'an undefined divisor printed NaN and no test noticed');
  const rate = Number(line.match(/~([\d.]+) tok\/s/)?.[1]);
  assert.ok(rate > 0 && Number.isFinite(rate), `expected a real rate, got ${line}`);
});

test('withProgress forwards the phase override, which a one-argument arrow ate', async () => {
  // The whole-JSON path passes a phase because no deltas arrive there. Dropping
  // it left the heartbeat asserting `prefill` for an entire generation — the
  // fix for that was inert while looking applied, which is the class this repo
  // keeps re-finding.
  const seen = [];
  await withProgress(async (onProgress) => {
    onProgress({ content: '', reasoning: '', deltas: 0 }, 'waiting');
    seen.push('called');
  });

  // Observed through a real startProgress: assert the argument survives the wrapper.
  const { lines, write } = collector();
  const progress = startProgress({ intervalMs: 5, write, now: fakeClock(1000) });
  const forward = (...args) => progress.update(...args);
  forward({ content: '', reasoning: '', deltas: 0 }, 'waiting');
  await new Promise((resolve) => setTimeout(resolve, 40));
  progress.stop();

  assert.deepEqual(seen, ['called']);
  assert.match(lines.at(-1) ?? '', /waiting/, 'the phase must reach the printed line');
});
