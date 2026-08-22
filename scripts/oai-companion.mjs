#!/usr/bin/env node
import { runAbandon } from './lib/cmd-abandon.mjs';
import { runCancel } from './lib/cmd-cancel.mjs';
import { runResult } from './lib/cmd-result.mjs';
import { runReview } from './lib/cmd-review.mjs';
import { runSetup } from './lib/cmd-setup.mjs';
import { runStatus } from './lib/cmd-status.mjs';
import { runTaskWorker } from './lib/cmd-task-worker.mjs';
import { runTask } from './lib/cmd-task.mjs';
import { UserError } from './lib/errors.mjs';
import { transportDetail } from './lib/provider.mjs';

const COMMANDS = {
  setup: runSetup, task: runTask, review: runReview, status: runStatus, result: runResult, cancel: runCancel,
  abandon: runAbandon,
};

// Dispatched, but never advertised: `task-worker` is how `--background` re-execs
// itself as a detached process, not something a user types. Keeping it out of
// COMMANDS is what stops it appearing in the "Expected one of" line — a command
// nobody should run has no business being suggested to someone who mistyped.
const INTERNAL_COMMANDS = { 'task-worker': runTaskWorker };

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  // `Object.hasOwn`, not `??` on a bracket lookup: an inherited name like
  // `toString` is a real property of every plain object, so a bare
  // `COMMANDS[command]` would dispatch `Object.prototype.toString` as a
  // handler instead of refusing the command below.
  const handler = Object.hasOwn(COMMANDS, command)
    ? COMMANDS[command]
    : Object.hasOwn(INTERNAL_COMMANDS, command)
      ? INTERNAL_COMMANDS[command]
      : undefined;
  if (!handler) {
    throw new UserError(`Unknown command "${command ?? ''}". Expected one of: ${Object.keys(COMMANDS).join(', ')}.`);
  }
  await handler(rest);
}

main().catch((error) => {
  // `process.exitCode`, never `process.exit()`, here — deliberately matching
  // the success path, which has no explicit exit call at all (see
  // `job-heartbeat.mjs`'s own rationale for that asymmetry: every watchdog
  // timer in this codebase is `.unref()`'d, and the handful that deliberately
  // are not (`answer-attempts.mjs`'s retry delay, `job-queue.mjs`'s poll sleep)
  // are awaited work rather than a budget, so none can still be pending when an
  // error reaches this catch — so nothing keeps a healthy process alive past
  // its own writes).
  // `process.exit()` tears the process down as soon as it is called, without
  // waiting for a queued write to drain — and `--json`'s failure envelope,
  // written just above this handler in `cmd-review.mjs` via the ASYNC
  // `process.stdout.write`, can still be sitting in that queue when this runs,
  // especially once a large `partial.reasoning` pushes it past a pipe's OS
  // buffer (64KB on darwin), cutting it mid-string well short of this
  // harness's own 256000 capture ceiling. Setting the code and returning lets
  // Node drain stdout and stderr before it exits on its own.
  if (error instanceof UserError) {
    // `error.endpoint` / `error.responseBody` / `error.bodyExcerpt`
    // are appended here only — never inside `.message` or `.hint` themselves,
    // which `errorReport()` persists into `jobs.db` and which an uncaught
    // worker error also writes to its own job log (`job-spawn.mjs`'s
    // `stdio: ['ignore', log, log]`). Gated on an ALLOWLIST of genuinely
    // interactive commands, re-read from `process.argv` rather than threaded
    // out of `main()`, so `task-worker` — dispatched via `INTERNAL_COMMANDS`,
    // never `COMMANDS` — fails closed by default rather than needing to
    // remember to exclude itself. Same `Object.hasOwn` reasoning as dispatch
    // above: `in` would treat an inherited name as a real command.
    const interactive = Object.hasOwn(COMMANDS, process.argv[2]);
    const detail = interactive ? transportDetail(error) : '';
    process.stderr.write(`${error.message}${detail ? ` (${detail})` : ''}\n`);
    if (error.hint) process.stderr.write(`${error.hint}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`Unexpected failure: ${error?.stack ?? error}\n`);
  process.exitCode = 2;
});
