// A worker's exit is announced or it is not, and this is where that difference
// becomes a verdict (OAI-66).
//
// Before it, a dead worker with a cancellation pending was published as a tidy
// `cancelled` whatever had actually happened — so a crash was reported as a
// granted request and its diagnosis thrown away. Every test here drives a row
// whose worker has genuinely exited, and reads the verdict back out of the real
// command, because the mechanism is a file's presence and a process's death.
import assert from 'node:assert/strict';
import { closeSync, constants, existsSync, openSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { writeCancelAck } from '../scripts/lib/cancel-ack.mjs';
import { ackPath, ackPayload, deadRunning, logPath, makeFifo, waitForExit } from './cancel-helpers.mjs';
import { NEEDS_SQLITE, queueScenario, readJob, waitForState } from './job-helpers.mjs';

test('a worker that died with a cancellation pending is not published as a clean cancellation', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Two rows identical but for the pending cancellation, so the difference
    // between the two verdicts is attributable to that field alone — and the
    // control is what shows the branch is decided by evidence rather than by the
    // fixture. Neither worker announced anything: both simply stopped.
    const seq = await deadRunning(scenario.state, 'killed');
    await deadRunning(scenario.state, 'justdied', { cancelled: false });
    // FORGERY. The job log is the one channel model output can reach — through
    // `SALVAGED_OUTCOME` — so marker-shaped bytes are planted in it here. This
    // establishes what it can: the reconciler does not read the log. It cannot
    // establish provenance, because the worker persists the model's answer rather
    // than printing it, so no fixture can drive genuine model output onto a log.
    writeFileSync(logPath(scenario.state, seq), ackPayload('killed'));

    await scenario.run(['status', '--all']);

    const killed = readJob(scenario.state, 'killed');
    assert.equal(killed.state, 'failed', 'an unannounced death is a death, whatever was pending');
    assert.equal(killed.failure.reason, 'cancel-unconfirmed');
    assert.match(killed.failure.message, /never confirmed/);

    const died = readJob(scenario.state, 'justdied');
    assert.equal(died.state, 'failed');
    assert.equal(died.failure.reason, 'worker-died', 'the same death without a cancellation still reads as one');
  } finally {
    await scenario.server.close();
  }
});

test("an acknowledgement is accepted only when it carries the row's own id", { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The recreated-database case as it will actually occur: `jobs.db` goes, the
    // sequence counter restarts, and a surviving acknowledgement from a different
    // job sits at the new row's path.
    const stale = await deadRunning(scenario.state, 'staleack');
    writeFileSync(ackPath(scenario.state, stale), ackPayload('someotherjob'));
    // THE ACCEPTED RESIDUAL, written as a test rather than a caveat: a matching id
    // IS accepted, whoever wrote it. The binding makes misattribution need both a
    // reused seq and a repeated 8-hex id — a reduction, not an impossibility, and
    // this is where a reader meets that limit.
    const matched = await deadRunning(scenario.state, 'goodack');
    writeFileSync(ackPath(scenario.state, matched), ackPayload('goodack'));

    await scenario.run(['status', '--all']);

    assert.equal(readJob(scenario.state, 'staleack').failure.reason, 'cancel-unconfirmed');
    const accepted = readJob(scenario.state, 'goodack');
    assert.equal(accepted.state, 'cancelled');
    assert.equal(accepted.failure, null);
  } finally {
    await scenario.server.close();
  }
});

test('an oversized acknowledgement is refused however well its first line reads', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const seq = await deadRunning(scenario.state, 'fatack');
    // The first line MATCHES. Only the size ceiling can reject this, which is what
    // makes it a witness: drop that test and the read's own `Math.min` still caps
    // the buffer at 4096, the first line still matches, and the row reads
    // `cancelled` — a file planted here having made the reader work under the lock.
    writeFileSync(ackPath(scenario.state, seq), `${ackPayload('fatack')}${'x'.repeat(8192)}`);

    await scenario.run(['status', '--all']);

    assert.equal(readJob(scenario.state, 'fatack').failure?.reason, 'cancel-unconfirmed');
  } finally {
    await scenario.server.close();
  }
});

test('a worker with no id to announce writes nothing at all', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const seq = await deadRunning(scenario.state, 'noid');
    const previous = process.env.OAI_PLUGIN_STATE;
    process.env.OAI_PLUGIN_STATE = scenario.state;
    try {
      // The guard the plan asked for by name, so that a future caller driving the
      // default `onCancel` cannot drop an `undefined`-id file into a real state
      // directory — where it would be read as some job's acknowledgement.
      assert.equal(writeCancelAck(seq, undefined), false);
      assert.equal(writeCancelAck(undefined, 'noid'), false, 'and neither half is enough on its own');
    } finally {
      // `env.X = undefined` stores the STRING "undefined", so a variable that was
      // absent to begin with comes back set — and every later in-process test then
      // resolves its state under `./undefined`. Restoring absence means deleting.
      if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
      else process.env.OAI_PLUGIN_STATE = previous;
    }

    assert.equal(existsSync(ackPath(scenario.state, seq)), false);
    assert.equal(existsSync(ackPath(scenario.state, undefined)), false, 'nor under a stringified undefined');
  } finally {
    await scenario.server.close();
  }
});

test('a symlink at the acknowledgement path cannot aim the read at the job log', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const seq = await deadRunning(scenario.state, 'linked');
    // TRUNCATED to a genuine, id-matching payload rather than appended to. The
    // obvious version — an empty log and a symlink — reddens for nobody: those
    // bytes fail the id check whether or not the read follows the link, leaving
    // the witness vacuous. This way a read lacking `O_NOFOLLOW` publishes
    // `cancelled`, which is precisely the defect the flag prevents. The worker is
    // long dead, so truncating its log is wholly the fixture's business.
    writeFileSync(logPath(scenario.state, seq), ackPayload('linked'));
    symlinkSync(logPath(scenario.state, seq), ackPath(scenario.state, seq));

    await scenario.run(['status', '--all']);

    assert.equal(readJob(scenario.state, 'linked').failure?.reason, 'cancel-unconfirmed');
  } finally {
    await scenario.server.close();
  }
});

test('a FIFO at the acknowledgement path cannot wedge the queue', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const seq = await deadRunning(scenario.state, 'fifoack');
    await makeFifo(ackPath(scenario.state, seq));

    // The bound must REJECT BY NAME rather than resolve, and the suite must still
    // TERMINATE afterwards. Without `O_NONBLOCK` the open blocks forever while
    // holding the queue's write lock, `node --test` has no default timeout, and
    // the wedged child holds the pipes the runner waits on — so a bare race names
    // the failure and then hangs the run anyway, emitting nothing. Measured: the
    // whole suite produced zero output until it was killed.
    //
    // Opening the FIFO for writing releases a reader already blocked on it, which
    // is what lets the child finish and be reaped. It runs only after the bound
    // has fired, so it cannot pre-satisfy the open it is meant to catch.
    const run = scenario.run(['status', '--all']);
    // Attached at creation rather than in the catch: set later, the cleanup below
    // would be back to a fixed bound with no way to know the child had gone.
    let settled = false;
    const markSettled = () => { settled = true; };
    run.then(markSettled, markSettled);
    let timer;
    const wedged = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('reconciliation never returned: the acknowledgement read blocked on the FIFO')), 20_000);
    });
    try {
      await Promise.race([run, wedged]);
    } catch (error) {
      // Unwedging the child, under three separate hazards — the requirement is
      // that the SUITE TERMINATES, and only all three together give that.
      //
      // O_NONBLOCK, for the opposite reason to the read side: a write-side open of
      // a FIFO blocks until a READER appears, and if `run` rejected for some other
      // reason (a spawn failure, say) there is none, so a blocking open would hang
      // forever swallowing the very error it is cleaning up after.
      //
      // RETRIED, because one attempt races the child: if the bound fires before the
      // child reaches its own open, the attempt gets ENXIO, returns, and the child
      // then enters the open and hangs the runner — the exact outcome this cleanup
      // exists to prevent, one step later.
      //
      // Then UNLINKED and RACED regardless. Unlinking does not release a descriptor
      // already open, but it stops the next open blocking; and the race is what
      // stops the fixture waiting forever on a child that will never close.
      // The loop runs WHILE THE CHILD IS STILL ALIVE, never for a fixed count. A
      // fixed count loses the same race one step later: the last attempt gets ENXIO,
      // the child then enters its open, and unlinking cannot wake an open already
      // waiting on the inode. Tied to `run` settling instead, the loop cannot expire
      // while a child is still able to block — and where the child never opens at
      // all, `run` settles and there is nothing left to unwedge. The elapsed bound is
      // a backstop against a hang neither condition covers, not the mechanism.
      const until = Date.now() + 30_000;
      while (!settled && Date.now() < until) {
        try {
          closeSync(openSync(ackPath(scenario.state, seq), constants.O_WRONLY | constants.O_NONBLOCK));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      // AFTER the loop, never during it: unlinking mid-loop makes the next
      // writer-open ENOENT instead of unwedging, which disarms the retry.
      try {
        unlinkSync(ackPath(scenario.state, seq));
      } catch {
        // Already gone. The point was that a later open cannot block on it.
      }
      await Promise.race([run.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    assert.equal(readJob(scenario.state, 'fifoack').failure?.reason, 'cancel-unconfirmed');
  } finally {
    await scenario.server.close();
  }
});

test('a worker whose acknowledgement will not write exits anyway', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario({ delayMs: 20_000 });
  try {
    const submit = await scenario.submit();
    const id = submit.stdout.trim();
    const running = await waitForState(scenario.state, id, ['running']);
    // The write opens `O_EXCL`, so an existing file at that path fails it — the
    // cheapest real way to make the acknowledgement unwritable in another process.
    // It carries a different id, so it is also not silently accepted afterwards.
    writeFileSync(ackPath(scenario.state, running.seq), ackPayload('notthisjob'));

    assert.equal((await scenario.run(['cancel', id])).status, 0);
    // The claim, stated narrowly: an unguarded throw would ALSO end this process,
    // so the exit alone does not separate decision P from an uncaught error. What
    // it does redden on is the failure mode that matters — a worker waiting on a
    // write while a paid-for request keeps generating.
    await waitForExit(running.worker_pid);

    // What discriminates the GUARD, and it had to: the verdict alone does not. An
    // unguarded throw kills the worker too — dead pid, no acknowledgement, identical
    // `cancel-unconfirmed` — so measured against the row this witness was green with
    // the catch removed. What only the guarded path produces is a clean exit line on
    // the job log instead of an uncaught EEXIST trace, and the positive match is what
    // gives the absence assertion beside it a path that fires.
    //
    // **It does NOT establish that a write was attempted, and must not be read as
    // if it did.** Delete the `writeCancelAck` call outright and every assertion
    // here still passes: the notice comes from the line above it, there is no
    // EEXIST, the worker exits, the planted wrong-id file stays, and the row still
    // reads `cancel-unconfirmed`. The witness for the CALL is the sibling in
    // `cancel.test.js` — "a running worker exits at its next check-in" — which reads
    // the acknowledgement back and reddens the moment nothing writes one.
    const log = readFileSync(logPath(scenario.state, running.seq), 'utf8');
    assert.match(log, /Cancellation requested: exiting without recording an outcome/);
    assert.doesNotMatch(log, /EEXIST|Error:/, 'the write failure is swallowed, not thrown through the timer');

    await scenario.run(['status', '--all']);
    const row = readJob(scenario.state, id);
    assert.equal(row.state, 'failed', 'an unrecorded cancellation degrades rather than lying');
    assert.equal(row.failure.reason, 'cancel-unconfirmed');
  } finally {
    await scenario.server.close();
  }
});

