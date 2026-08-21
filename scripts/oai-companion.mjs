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
    process.exit(1);
  }
  process.stderr.write(`Unexpected failure: ${error?.stack ?? error}\n`);
  process.exit(2);
});
