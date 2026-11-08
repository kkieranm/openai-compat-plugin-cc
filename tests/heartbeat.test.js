// The beat a running worker sends while the model is thinking.
//
// It exists so `stalled` can mean anything. Before it, a worker went silent from
// the moment it acquired its turn until the moment it finished — minutes on a
// local model — so "live pid, no recent beat" described every healthy job in the
// system. A derived state that is always true is not a state.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startHeartbeat } from '../plugins/oai/scripts/lib/job-heartbeat.mjs';
import { openStore } from '../plugins/oai/scripts/lib/job-store.mjs';
import { NEEDS_SQLITE, insertSynthetic, pollUntil, queueScenario, readJob, stateDir, waitForState } from './job-helpers.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the heartbeat advances the beat while it runs, and stops when told to', { skip: NEEDS_SQLITE }, async () => {
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

test('a real worker keeps beating across a slow model call', { skip: NEEDS_SQLITE }, async () => {
  // The model call is held until the test has looked for a beat, so it lasts
  // longer than BEAT_MS however slowly the worker starts. The thing under test
  // is the wiring: `startHeartbeat` works in isolation whether or not the worker
  // calls it, and the gap this closes was in the worker, not in the timer.
  const scenario = await queueScenario({ hold: true });
  try {
    const submit = await scenario.submit();
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();

    await waitForState(scenario.state, id, ['running']);
    // The baseline is taken once the request is held, so any later beat landed
    // during the model call itself rather than before it was sent.
    await scenario.waitForHeldChat(id);
    const during = readJob(scenario.state, id);
    let row = during;
    await pollUntil(
      () => {
        row = readJob(scenario.state, id);
        return row.last_beat_at > during.last_beat_at || row.state !== 'running';
      },
      { describe: () => `no beat landed during the model call: still ${row.last_beat_at} from ${during.last_beat_at} (state ${row.state})` },
    );

    // The beat first, because that is the defect: the wait above also ends when the
    // job leaves `running`, and one that finished without beating must report that
    // it never beat, not that it finished.
    assert.ok(
      row.last_beat_at > during.last_beat_at,
      `no beat landed during the model call: still ${row.last_beat_at} from ${during.last_beat_at} (state ${row.state})`,
    );
    assert.equal(row.state, 'running', 'the beat must have been observed while the job was still running');

    scenario.release();
    assert.equal((await waitForState(scenario.state, id, ['completed', 'failed'])).state, 'completed');
  } finally {
    scenario.release();
    await scenario.server.close();
  }
});
