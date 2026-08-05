// `/oai:task`: a command line in, one model's answer out.
//
// What the request *is* — the profile, the prompt's source, the attachments and
// the budgets the answer runs under — lives in `task-execute.mjs`; how the
// finished run is shown lives in `task-report.mjs`.
import { parseCommandLine } from './args.mjs';
import { substitutionNotice } from './model-identity.mjs';
import { executeTask } from './task-execute.mjs';
import { report } from './task-report.mjs';
import { submitTask } from './task-submit.mjs';

// Exported so `tests/plugin.test.js` can prove every flag this command accepts
// is documented in `commands/task.md`. The markdown is the only description a
// user ever sees, and nothing but a test notices when a flag outlives its docs.
export const TASK_SPEC = {
  valueFlags: [
    'provider', 'base-url', 'model', 'prompt-file', 'system', 'timeout', 'max-seconds', 'max-tokens', 'temperature',
    'max-attempts', 'max-wait',
  ],
  booleanFlags: ['background'],
  repeatableFlags: ['file'],
};

export async function runTask(argv) {
  const { options, prompt: inlinePrompt, terminated } = parseCommandLine(argv, TASK_SPEC);
  const args = { spec: TASK_SPEC, options, inlinePrompt, terminated };

  if (options.background) {
    const { id } = await submitTask(args);
    // stdout, because this id is the whole output of the command and a caller
    // may well be capturing it.
    process.stdout.write(`${id}\n`);
    return;
  }

  const outcome = await executeTask(args);

  // Before the answer, not after: the operator should learn which model is
  // speaking before reading what it said. On stderr and before `report`, which
  // is where an empty answer is refused — the same order `/oai:review` keeps,
  // and the one that stops a substitution warning vanishing from a run that
  // both got the wrong model and got nothing out of it.
  const notice = substitutionNotice(outcome.result);
  if (notice) process.stderr.write(notice);

  report(outcome);
}
