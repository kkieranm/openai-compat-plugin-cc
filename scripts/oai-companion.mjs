#!/usr/bin/env node
import { runResult } from './lib/cmd-result.mjs';
import { runReview } from './lib/cmd-review.mjs';
import { runSetup } from './lib/cmd-setup.mjs';
import { runStatus } from './lib/cmd-status.mjs';
import { runTaskWorker } from './lib/cmd-task-worker.mjs';
import { runTask } from './lib/cmd-task.mjs';
import { UserError } from './lib/errors.mjs';

const COMMANDS = { setup: runSetup, task: runTask, review: runReview, status: runStatus, result: runResult };

// Dispatched, but never advertised: `task-worker` is how `--background` re-execs
// itself as a detached process, not something a user types. Keeping it out of
// COMMANDS is what stops it appearing in the "Expected one of" line — a command
// nobody should run has no business being suggested to someone who mistyped.
const INTERNAL_COMMANDS = { 'task-worker': runTaskWorker };

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command] ?? INTERNAL_COMMANDS[command];
  if (!handler) {
    throw new UserError(`Unknown command "${command ?? ''}". Expected one of: ${Object.keys(COMMANDS).join(', ')}.`);
  }
  await handler(rest);
}

main().catch((error) => {
  if (error instanceof UserError) {
    process.stderr.write(`${error.message}\n`);
    if (error.hint) process.stderr.write(`${error.hint}\n`);
    process.exit(1);
  }
  process.stderr.write(`Unexpected failure: ${error?.stack ?? error}\n`);
  process.exit(2);
});
