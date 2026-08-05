// `/oai:task`: a command line in, one model's answer out.
//
// What the request *is* — the profile, the prompt's source, the attachments and
// the budgets the answer runs under — lives in `task-execute.mjs`; how the
// finished run is shown lives in `task-report.mjs`.
import { parseCommandLine } from './args.mjs';
import { substitutionNotice } from './model-identity.mjs';
import { errorReport } from './review-report.mjs';
import { executeTask } from './task-execute.mjs';
import { report } from './task-report.mjs';
import { submitTask } from './task-submit.mjs';

// Exported so `tests/plugin.test.js` can prove every flag this command accepts
// is documented in `commands/task.md`. The markdown is the only description a
// user ever sees, and nothing but a test notices when a flag outlives its docs.
export const TASK_SPEC = {
  valueFlags: [
    'provider', 'base-url', 'model', 'prompt-file', 'system', 'template', 'timeout', 'max-seconds', 'max-tokens',
    'temperature', 'max-attempts', 'max-wait',
  ],
  booleanFlags: ['background', 'json'],
  repeatableFlags: ['file'],
};

/**
 * The command, and the envelope its failures take when a machine is reading.
 *
 * The `--json` wrapper is deliberately additive, exactly as `runReview`'s is:
 * the record is written and the error is **rethrown**, so stderr and the exit
 * code are byte-for-byte what they were before the flag existed. Without it
 * `--json` would be machine-readable on success and prose on failure, which is
 * the half-contract a harness cannot consume — and a bench run that dies is
 * precisely when the record matters most.
 */
export async function runTask(argv) {
  const { options, prompt: inlinePrompt, terminated } = parseCommandLine(argv, TASK_SPEC);
  try {
    await taskFlow(options, inlinePrompt, terminated);
  } catch (error) {
    if (options.json) process.stdout.write(`${JSON.stringify(errorReport(error))}\n`);
    throw error;
  }
}

async function taskFlow(options, inlinePrompt, terminated) {
  const args = { spec: TASK_SPEC, options, inlinePrompt, terminated };

  if (options.background) {
    const { id } = await submitTask(args);
    // stdout, because this id is the whole output of the command and a caller
    // may well be capturing it. Under `--json` it is an object rather than a
    // bare line: a caller that asked for JSON and got one raw token would have
    // to special-case this path, and the id is the whole result either way.
    process.stdout.write(options.json ? `${JSON.stringify({ id, background: true })}\n` : `${id}\n`);
    return;
  }

  const outcome = await executeTask(args);

  // Before the answer, not after: the operator should learn which model is
  // speaking before reading what it said. On stderr and before `report`, which
  // is where an empty answer is refused — the same order `/oai:review` keeps,
  // and the one that stops a substitution warning vanishing from a run that
  // both got the wrong model and got nothing out of it.
  // On stderr and before `report`, because `--json` routes around every human
  // rendering: a harness gets the pair inside the envelope, an operator gets it
  // here.
  const notice = substitutionNotice(outcome.result);
  if (notice) process.stderr.write(notice);

  report(outcome, { json: Boolean(options.json) });
}
