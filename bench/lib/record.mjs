import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the run *was*, and where its two artefacts go.
 *
 * Lifted out of `run.mjs` at the file size budget. The seam: this module decides
 * what the run should be called and writes it down, while `run.mjs` decides the
 * order things happen in.
 */

/**
 * Who the report says it ran against.
 *
 * The model that actually answered, taken from a run rather than from the
 * request: a server may serve a different build than the id asked for, and the
 * report belongs to the one that ran.
 *
 * `!run.error` as well, so a substituted run cannot name the whole sweep. The
 * title has to describe what the table describes, and the table excludes those
 * runs — taking the first report regardless would headline the report with a
 * model whose every run was dropped from it. The substitutions get their own
 * section, which is where a sweep spanning several requested-to-served pairs is
 * stated in full rather than collapsed to one id.
 *
 * But `!run.error` alone loses the sweep's identity entirely when EVERY run was
 * substituted — and that is the modal case, not a corner: substitution is a
 * property of one requested id against one server, so a server that renames the
 * model for the first run renames it for all of them. `options.model` is
 * undefined on a normal invocation (the config supplies it), so the title became
 * `# Benchmark — unknown / unknown` above a table of nothing but failures: the
 * report losing the identity of the server it ran against at exactly the moment
 * a reader needs it. Confirmed by the built-in review.
 *
 * So: `provider` from any report at all, since a substitution says nothing about
 * which server answered. `model` from a COUNTED run, and where none exists, the
 * requested id marked as unconfirmed rather than stated as fact.
 */
export function reportIdentity(results, options) {
  const everyRun = results.flatMap(({ runs }) => runs);
  const answered = everyRun.find((run) => run.report && !run.error)?.report;
  const anyReport = everyRun.find((run) => run.report)?.report;
  const requested = anyReport?.requestedModel ?? options.model;
  return {
    provider: answered?.provider ?? anyReport?.provider ?? options.provider ?? 'unknown',
    model: answered?.model ?? (requested ? `${requested} (requested; no run was answered by it)` : 'unknown'),
  };
}

/**
 * Both artefacts, under one stamp.
 *
 * Raw records beside the summary: the summary is an argument, and an argument
 * whose evidence was thrown away cannot be rechecked. This repo has already lost
 * one experiment that way — two documents disagree on whether it was four runs
 * or five, because only the conclusion was written down.
 *
 * And the *rendered* report beside the raw one, because the JSON does not carry
 * the caveats — those are prose, generated at render time, and they are the half
 * that says what the numbers may not be used for. A reused log path would
 * silently overwrite an earlier run's report, so each run's artefacts are kept
 * under their own stamp rather than a shared or reused path.
 *
 * One stamp for the pair, computed by the caller before rendering rather than
 * after, so the two files cannot end up named for different instants.
 */
export function persist(root, stamp, record, markdown) {
  const resultsDir = join(root, 'bench/results');
  mkdirSync(resultsDir, { recursive: true });
  const recordPath = join(resultsDir, `${stamp}.json`);
  const reportPath = join(resultsDir, `${stamp}.md`);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(reportPath, `${markdown}\n`);
  return { recordPath, reportPath };
}
