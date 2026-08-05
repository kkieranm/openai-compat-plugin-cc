// The beat a running worker sends while the model is thinking.
//
// It exists so `stalled` can mean anything. Before it, a worker went silent from
// the moment it acquired its turn until the moment it finished — minutes on a
// local model — so "live pid, no recent beat" described every healthy job in the
// system. A derived state that is always true is not a state.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startHeartbeat } from '../scripts/lib/job-heartbeat.mjs';
import { openStore } from '../scripts/lib/job-store.mjs';
import { insertSynthetic, queueScenario, readJob, stateDir, waitForState } from './job-helpers.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the heartbeat advances the beat while it runs, and stops when told to', async () => {
  const state = stateDir();
  const seq = insertSynthetic(state, { id: 'beating', state: 'running', workerPid: process.pid, beatAgoMs: 60_000 });
  const before = readJob(state, 'beating').last_beat_at;

  // Opened directly rather than through `withStore`, whose `finally` closes the
  // handle the moment its callback returns — which for an async callback is
  // before the timer has fired even once.
  process.env.OAI_PLUGIN_STATE = state;
  const db = openStore();
  const stop = startHeartbeat(db, seq, { intervalMs: 20 });
  await sleep(150);
  stop();

  const beaten = readJob(state, 'beating').last_beat_at;
  assert.ok(beaten > before, `beat did not advance: ${before} -> ${beaten}`);

  // A timer that outlived the run would go on writing to a row someone else has
  // since finished, and against a handle its owner has closed.
  await sleep(150);
  assert.equal(readJob(state, 'beating').last_beat_at, beaten, 'the beat must stop when the run does');
  db.close();
  delete process.env.OAI_PLUGIN_STATE;
});

test('a real worker keeps beating across a slow model call', async () => {
  // Deliberately longer than BEAT_MS, because the thing under test is the
  // wiring: `startHeartbeat` works in isolation whether or not the worker calls
  // it, and the gap this closes was in the worker, not in the timer.
  const scenario = await queueScenario({ delayMs: 7000 });
  try {
    const submit = await scenario.submit();
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();

    const running = await waitForState(scenario.state, id, ['running']);
    // `claimJob` writes started_at and the first beat in the same statement, so
    // any later value is a beat that landed during the model call itself.
    const deadline = Date.now() + 12_000;
    let row = running;
    while (Date.now() < deadline && row.last_beat_at <= running.started_at) {
      await sleep(200);
      row = readJob(scenario.state, id);
      if (row.state !== 'running') break;
    }

    // The beat first, because that is the defect: with the heartbeat unwired the
    // loop above simply runs until the job completes, and asserting on the state
    // first would report "it finished" rather than "it never beat".
    assert.ok(
      row.last_beat_at > running.started_at,
      `no beat landed during the run: still ${row.last_beat_at} from started_at ${running.started_at} (state ${row.state})`,
    );
    assert.equal(row.state, 'running', 'the beat must have been observed while the job was still running');

    await waitForState(scenario.state, id, ['completed', 'failed']);
  } finally {
    await scenario.server.close();
  }
});
