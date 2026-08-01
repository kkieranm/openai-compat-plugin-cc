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
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/lib/args.mjs';
import { MAX_ATTEMPTS_CEILING, parseNumber } from '../scripts/lib/delegate.mjs';
import { MAX_BUDGET_SECONDS } from '../scripts/lib/http-budgets.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { cleanup, loadCases, materialize } from './lib/corpus.mjs';
import { attemptsFrom, outcomeFor, reasonFrom, requestedModelFrom } from './lib/outcome.mjs';
import { persist, reportIdentity } from './lib/record.mjs';
import { renderReport } from './lib/report.mjs';
import { recall, scoreRun } from './lib/score.mjs';
import { runWithWarmUp, warmUpPair } from './lib/warm-up.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPANION = join(ROOT, 'scripts/oai-companion.mjs');

const SPEC = {
  valueFlags: ['runs', 'provider', 'model', 'timeout', 'max-seconds', 'max-attempts'],
  booleanFlags: ['diff-only', 'cold', 'warm-up'],
  repeatableFlags: ['case'],
};

/**
 * One value per bench invocation, so `--cold` runs cannot collide with each
 * other *or* with a run from an hour ago.
 *
 * A UUID rather than a timestamp, which was the first draft and is wrong twice:
 * two invocations launched inside one clock tick would share it, and a wall
 * clock can step backwards onto a value already used. What has to be true is
 * that the server has never seen this prefix, and only uniqueness delivers that.
 */
const INVOCATION = randomUUID();

/**
 * The command line for one run of one case.
 *
 * Lifted out of `reviewOnce` at the function size budget, and the seam is a
 * clean one: this decides *what to ask for*, while the caller decides what to do
 * with the answer — including how to record a failure, which is the half that
 * kept growing.
 */
function reviewFlags(materializedArgs, caseDef, options, { diffOnly, runIndex }) {
  const flags = ['review', ...materializedArgs, '--json'];
  if (diffOnly) flags.push('--diff-only');
  // Unique per run *and* per invocation. Without the run index every run of a
  // case would share a prefix and only the first would be cold — the exact
  // thing --cold exists to prevent, reintroduced by the fix.
  if (options.cold) flags.push('--cache-buster', `${INVOCATION}-${caseDef.id}-${runIndex}`);
  // The manifest may pin its own provider/model, so a case can name the model
  // it is a fair test of; the command line overrides it. This is what makes
  // OAI-11's cross-model passes configuration rather than a rewrite.
  const provider = options.provider ?? caseDef.provider;
  const model = options.model ?? caseDef.model;
  if (provider) flags.push('--provider', provider);
  if (model) flags.push('--model', model);
  // No manifest fallback for the budgets, unlike provider/model: a case pins
  // the model it is a fair test of, but how long the harness is willing to
  // wait is a property of this invocation, not of the case. Command line only.
  if (options.timeout) flags.push('--timeout', options.timeout);
  if (options['max-seconds']) flags.push('--max-seconds', options['max-seconds']);
  // The control arm: `--max-attempts 1` reproduces the pre-retry behaviour, so
  // one corpus run can measure the failure rate with retry and another without.
  if (options['max-attempts']) flags.push('--max-attempts', options['max-attempts']);
  return flags;
}

/**
 * One review, through the real command.
 *
 * A non-zero exit is recorded rather than thrown: one case failing must not
 * cancel the rest, and a run that failed is data — "the reviewer refused this
 * input" is a result about the reviewer, and silently missing rows would make
 * a partial bench read as a complete one.
 */
function reviewOnce(caseDef, options, runIndex) {
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
    const flags = reviewFlags(materialized.args, caseDef, options, { diffOnly, runIndex });

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
    return outcomeFor(stdout, diffOnly);
  } catch (error) {
    return failedRun(error, caseDef, options, diffOnly);
  } finally {
    // Only if it got far enough to exist; materialize may be what threw.
    if (dir) cleanup(dir);
  }
}

/**
 * A run that produced nothing, as the record keeps it. Lifted out of
 * `reviewOnce` at the function size budget.
 *
 * The whole of stderr, not one line of it. Taking the last line returned the
 * UserError's *hint* — the companion writes the message and the hint as separate
 * lines — so the record showed "Raise --max-tokens…" as the reason a run failed
 * while "ran out of tokens" was discarded. Presenting the remedy as the
 * diagnosis is this repo's signature class, in the very field whose comment
 * calls itself the evidence the harness exists to keep.
 *
 * `reason` is the category beside the prose, read from the command's own
 * `--json` envelope rather than matched out of stderr — a defect class this repo
 * has on file twice over (OAI-13 items 1 and 2).
 */
function failedRun(error, caseDef, options, diffOnly) {
  const said = String(error.stderr ?? '').trim();
  return {
    diffOnly,
    error: said || error.message,
    reason: reasonFrom(error.stdout),
    // Carried here because the failure envelope cannot: a run whose every
    // attempt died produced no report, so the reliability table would bucket its
    // attempts under "unknown" — collapsing a two-model sweep whose runs all
    // failed into one indistinguishable row, which is the sweep this record
    // exists to describe.
    // The command's own resolved id first: it knows what providers.json supplied,
    // which the flags usually do not name at all.
    requestedModel: requestedModelFrom(error.stdout) ?? options.model ?? caseDef.model ?? null,
    // Kept even here — see attemptsFrom. Scoring reads logical runs; reliability
    // reads every physical request, including all of the ones that failed.
    attempts: attemptsFrom(error.stdout),
  };
}

function runCase(caseDef, options, runsPerCase) {
  const runs = [];
  for (let index = 0; index < runsPerCase; index += 1) {
    process.stderr.write(`${caseDef.id} — run ${index + 1}/${runsPerCase}...\n`);
    const outcome = reviewOnce(caseDef, options, index);
    // Only a run that produced readable findings can be scored. `parsed: false`
    // is not an empty findings list, and scoring it as one would enter a failed
    // read as a clean review — the distinction --json exists to preserve.
    //
    // `!outcome.error` as well, now that a run can carry both a report and a
    // failure: a substituted run parsed perfectly and is still not a
    // measurement of the requested model. `case-rows.mjs` enforces the same
    // exclusion on its own side rather than trusting this line, because an
    // invariant that lives in one file and is relied on by another is how the
    // partition quietly stopped being exhaustive last time.
    if (outcome.report?.parsed && !outcome.error) {
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

/**
 * Every flag checked before any case runs, so a mistyped budget costs a
 * refusal in milliseconds rather than surfacing after the first model round
 * trip. Lifted out of `main` at the function size budget.
 */
function validateOptions(options) {
  const runsPerCase = options.runs ? Number(options.runs) : 1;
  if (!Number.isInteger(runsPerCase) || runsPerCase < 1) {
    throw new UserError(`--runs must be a positive integer, got "${options.runs}".`);
  }
  // Validated with the review command's *own* validator, and with exactly its
  // options — bench only forwards these flags, so any stricter rule here would
  // give one flag two domains: `--timeout 1.5` rejected by the harness while
  // `/oai:review --timeout 1.5` accepts it. Hence `{ min: 1 }` and no
  // `integer: true`; fractional seconds are a legitimate duration. `--runs`
  // above stays integer-only for the opposite reason — it is a count, not a
  // duration. Called for the throw alone, before any case runs, so a mistyped
  // budget costs nothing rather than surfacing after the first model round trip.
  // `max` included, not just `min` — the comment above says "exactly its
  // options" and it has to be true. Omitting the ceiling let
  // `--max-seconds 99999999` clear this guard and be refused by every child
  // instead: a 6-case N=3 sweep would materialize 18 repos, spawn 18 processes
  // and record 18 failed runs with `reason: null`, then render a full table of
  // all-zero recall — in place of one refusal in milliseconds, which is the
  // entire point of validating here.
  const budget = { min: 1, max: MAX_BUDGET_SECONDS };
  if (options.timeout !== undefined) parseNumber(options.timeout, 'timeout', budget);
  if (options['max-seconds'] !== undefined) parseNumber(options['max-seconds'], 'max-seconds', budget);
  // Same domain as the command it forwards to, for the reason stated above: an
  // out-of-range value here otherwise materializes every repo, spawns every
  // child, records each validation refusal as a failed run, and renders a table
  // of all-zero recall — in place of one refusal in milliseconds.
  if (options['max-attempts'] !== undefined) {
    parseNumber(options['max-attempts'], 'max-attempts', { integer: true, min: 1, max: MAX_ATTEMPTS_CEILING });
  }
  return runsPerCase;
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2), SPEC);
  const runsPerCase = validateOptions(options);

  const cases = selectCases(loadCases(ROOT), options.case);
  // Warmed before the first case that needs each target, and again whenever the
  // target changes — so the JIT model load is charged to nothing, and a later
  // pair cannot evict an earlier one behind a case's back. See warm-up.mjs.
  const { results, warmed } = runWithWarmUp(cases, options, {
    warm: (pair, caseDef) => warmUpPair(pair, options, { companion: COMPANION, cwd: ROOT, beforeCase: caseDef.id }),
    run: (caseDef) => runCase(caseDef, options, runsPerCase),
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const markdown = renderReport(results, {
    runsPerCase,
    ...reportIdentity(results, options),
    diffOnly: Boolean(options['diff-only']),
    cold: Boolean(options.cold),
    timeoutSeconds: options.timeout,
    maxSeconds: options['max-seconds'],
  });
  const { recordPath, reportPath } = persist(ROOT, stamp, { runsPerCase, options, warmed, results }, markdown);

  process.stdout.write(`${markdown}\n`);
  process.stderr.write(`\nPer-run records: ${recordPath}\nRendered report: ${reportPath}\n`);
}

main().catch((error) => {
  if (error instanceof UserError) {
    process.stderr.write(`${error.message}\n${error.hint ? `${error.hint}\n` : ''}`);
    process.exit(1);
  }
  throw error;
});
