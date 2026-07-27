#!/usr/bin/env node
import { runReview } from './lib/cmd-review.mjs';
import { runSetup } from './lib/cmd-setup.mjs';
import { runTask } from './lib/cmd-task.mjs';
import { UserError } from './lib/errors.mjs';

const COMMANDS = { setup: runSetup, task: runTask, review: runReview };

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];
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
