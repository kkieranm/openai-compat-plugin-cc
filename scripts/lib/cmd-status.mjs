// `/oai:status`: what the background jobs are doing.
//
// Reading is also when a dead worker is noticed — there is no daemon here — so
// this command writes as well as reads. `job-view.mjs` owns that reconciliation
// and the derived states; `job-render.mjs` owns the text. This file is the
// command: parse, decide list-or-detail, print.
import { parseCommandLine } from './args.mjs';
import { UserError } from './errors.mjs';
import { jobById } from './job-record.mjs';
import { renderDetail, renderList } from './job-render.mjs';
import { openJobs, reconcileAll, statusView, viewOf } from './job-view.mjs';

// Exported so `tests/plugin.test.js` can prove every flag is documented in
// `commands/status.md`.
export const STATUS_SPEC = {
  booleanFlags: ['all'],
};

/**
 * Said on stderr, and said rather than swallowed: a reader looking at a database
 * this build does not understand is looking at rows nothing will collect. Its
 * dead workers stay `running` and its queue stays wedged until the newer plugin
 * runs again, and a status listing that did not mention that would be lying by
 * omission.
 */
function tooNewNotice(version) {
  process.stderr.write(
    `This job database was written by a newer version of the plugin (schema ${version}).\n`
      + 'Showing it read-only: nothing here will be reconciled, collected or written by this build.\n\n',
  );
}

function showOne(db, id, nowMs) {
  const row = jobById(db, id);
  if (!row) {
    throw new UserError(`No job with id "${id}".`, { hint: 'Run /oai:status with no arguments to list what there is.' });
  }
  process.stdout.write(`${renderDetail(viewOf(row, nowMs), { nowMs })}\n`);
}

export async function runStatus(argv) {
  const { options, prompt } = parseCommandLine(argv, STATUS_SPEC);
  const id = prompt.trim();

  const opened = openJobs();
  if (!opened) {
    process.stdout.write('No background jobs: none has ever been submitted on this machine.\n');
    return;
  }

  const { db, readOnly, version } = opened;
  if (readOnly) tooNewNotice(version);
  // Before anything is read, so what gets printed is the collected state rather
  // than the state as it stood a moment before this command noticed.
  else reconcileAll(db);

  const nowMs = Date.now();
  // An id resolves from anywhere. Scoping it to the current directory would mean
  // an id handed between sessions stopped working the moment someone cd'd.
  if (id) {
    showOne(db, id, nowMs);
    return;
  }

  const all = options.all === true;
  const cwd = process.cwd();
  // `readOnly` reaches the renderer because one of the lines it may print names
  // a command that writes, and this build refuses every write against a database
  // a newer plugin wrote.
  process.stdout.write(`${renderList(statusView(db, { cwd, all, nowMs }), { cwd, all, readOnly, nowMs })}\n`);
}
