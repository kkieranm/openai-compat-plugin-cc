#!/usr/bin/env node
// The benchmark: run the shipped /oai:review against known-defective snapshots
// of this repo's own history, and score what comes back.
//
// It drives the real CLI through `--json`, never a copy of the pipeline. That
// is the whole design constraint: a harness that reimplemented the request
// would measure a reimplementation, and report the number as the reviewer's.
// The corpus straddles the context ladder on purpose — `structured` is large
// enough to fall to the diff-only rung — so a copy would also have to hold a
// second version of the fit decision, free to disagree with the first.
//
// Deliberately not part of `npm test`: it needs a real model and is
// non-deterministic. See ADR 006.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/lib/args.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { cleanup, loadCases, materialize } from './lib/corpus.mjs';
import { renderReport } from './lib/report.mjs';
import { recall, scoreRun } from './lib/score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPANION = join(ROOT, 'scripts/oai-companion.mjs');

const SPEC = {
  valueFlags: ['runs', 'provider', 'model'],
  booleanFlags: ['diff-only'],
  repeatableFlags: ['case'],
};

/**
 * One review, through the real command.
 *
 * A non-zero exit is recorded rather than thrown: one case failing must not
 * cancel the rest, and a run that failed is data — "the reviewer refused this
 * input" is a result about the reviewer, and silently missing rows would make
 * a partial bench read as a complete one.
 */
function reviewOnce(caseDef, options) {
  // --diff-only cannot apply to a `file` case: there is no diff, and the CLI
  // refuses the combination. So the flag lands on some cases and not others, and
  // the report has to say which — an A/B switch applied to four cases of six
  // while reading as applied to all six is not a comparison any more. Declared
  // out here because the failure path reports it too.
  const diffOnly = Boolean(options['diff-only']) && caseDef.mode === 'commit';
  // Materialization is inside the try, not above it. Every git call in
  // corpus.mjs throws UserError, and building the repo happens per case, after
  // model time has already been spent on earlier ones — so a throw here used to
  // escape runCase and cases.map() to the top-level handler, discarding every
  // completed case's results and leaking the temp repo, against this function's
  // own promise that one case failing must not cancel the rest.
  let dir;
  try {
    const materialized = materialize(caseDef, ROOT);
    dir = materialized.dir;
    const flags = ['review', ...materialized.args, '--json'];
    if (diffOnly) flags.push('--diff-only');
    // The manifest may pin its own provider/model, so a case can name the model
    // it is a fair test of; the command line overrides it. This is what makes
    // OAI-11's cross-model passes configuration rather than a rewrite.
    const provider = options.provider ?? caseDef.provider;
    const model = options.model ?? caseDef.model;
    if (provider) flags.push('--provider', provider);
    if (model) flags.push('--model', model);

    // stderr is captured rather than inherited: a failed run's reason is the
    // evidence this harness exists to keep, and letting it scroll past into the
    // terminal would leave the record saying only "it failed". The per-run
    // progress line above already supplies the liveness that costs.
    const stdout = execFileSync(process.execPath, [COMPANION, ...flags], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64e6,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { diffOnly, report: JSON.parse(stdout) };
  } catch (error) {
    // The whole of stderr, not one line of it. Taking the last line returned the
    // UserError's *hint* — the companion writes the message and the hint as
    // separate lines — so the record showed "Raise --max-tokens…" as the reason
    // a run failed while "ran out of tokens" was discarded. Presenting the
    // remedy as the diagnosis is this repo's signature class, in the very field
    // whose comment calls itself the evidence the harness exists to keep.
    const said = String(error.stderr ?? '').trim();
    return { diffOnly, error: said || error.message };
  } finally {
    // Only if it got far enough to exist; materialize may be what threw.
    if (dir) cleanup(dir);
  }
}

function runCase(caseDef, options, runsPerCase) {
  const runs = [];
  for (let index = 0; index < runsPerCase; index += 1) {
    process.stderr.write(`${caseDef.id} — run ${index + 1}/${runsPerCase}...\n`);
    const outcome = reviewOnce(caseDef, options);
    // Only a run that produced readable findings can be scored. `parsed: false`
    // is not an empty findings list, and scoring it as one would enter a failed
    // read as a clean review — the distinction --json exists to preserve.
    if (outcome.report?.parsed) {
      const score = scoreRun(outcome.report.findings, caseDef.defects);
      outcome.score = { ...score, recall: recall(score.byDefect) };
    }
    runs.push(outcome);
  }
  return { caseDef, runs };
}

function selectCases(all, wanted) {
  if (!wanted?.length) return all;
  const known = new Set(all.map((caseDef) => caseDef.id));
  const missing = wanted.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new UserError(`Unknown case(s): ${missing.join(', ')}.`, {
      hint: `Available: ${[...known].join(', ')}`,
    });
  }
  return all.filter((caseDef) => wanted.includes(caseDef.id));
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2), SPEC);
  const runsPerCase = options.runs ? Number(options.runs) : 1;
  if (!Number.isInteger(runsPerCase) || runsPerCase < 1) {
    throw new UserError(`--runs must be a positive integer, got "${options.runs}".`);
  }

  const cases = selectCases(loadCases(ROOT), options.case);
  const results = cases.map((caseDef) => runCase(caseDef, options, runsPerCase));

  // The model that actually answered, taken from a run rather than from the
  // request: a server may serve a different build than the id asked for, and
  // the report belongs to the one that ran.
  const answered = results.flatMap(({ runs }) => runs).find((run) => run.report)?.report;
  const markdown = renderReport(results, {
    runsPerCase,
    provider: answered?.provider ?? options.provider ?? 'unknown',
    model: answered?.model ?? options.model ?? 'unknown',
    diffOnly: Boolean(options['diff-only']),
  });

  // Raw records beside the summary: the summary is an argument, and an argument
  // whose evidence was thrown away cannot be rechecked. This repo has already
  // lost one experiment that way — two documents disagree on whether it was
  // four runs or five, because only the conclusion was written down.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = join(ROOT, 'bench/results');
  mkdirSync(resultsDir, { recursive: true });
  const recordPath = join(resultsDir, `${stamp}.json`);
  writeFileSync(recordPath, `${JSON.stringify({ runsPerCase, options, results }, null, 2)}\n`);

  process.stdout.write(`${markdown}\n`);
  process.stderr.write(`\nPer-run records: ${recordPath}\n`);
}

main().catch((error) => {
  if (error instanceof UserError) {
    process.stderr.write(`${error.message}\n${error.hint ? `${error.hint}\n` : ''}`);
    process.exit(1);
  }
  throw error;
});
