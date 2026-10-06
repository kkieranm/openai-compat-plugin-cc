// The task benchmark: what a local model's advisor answers actually demonstrate.
//
// Distinct from `bench/run.mjs` by construction, not by preference. That one
// scores findings against anchors; there is no anchor in a prose answer, so this
// one scores declared markers and says plainly what that is worth
// (`MARKER_LIMITS`). It drives the real CLI through `--json` for the same reason
// the review bench does: a harness that reimplemented the request would measure
// a reimplementation and report the number as the command's.
//
// **Guarded main, through the same `isMainModule` guard as every bench driver.**
// Everything here is importable, and `runSweep` takes its executor so a test can
// drive the whole loop without a model.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from '../plugins/oai/scripts/lib/args.mjs';
import { UserError } from '../plugins/oai/scripts/lib/errors.mjs';
import { ARMS, attachmentArgs, loadTaskCases } from './lib/task-corpus.mjs';
import { MARKER_LIMITS, scoreAnswer, tallyArm } from './lib/task-score.mjs';
import { safeCodeSpan, safeInline } from './lib/markdown-safe.mjs';
import { persist } from './lib/record.mjs';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/main-module.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMPANION = join(ROOT, 'plugins/oai/scripts/oai-companion.mjs');

export const TASK_BENCH_SPEC = {
  valueFlags: ['runs', 'provider', 'model', 'max-seconds', 'max-attempts'],
  booleanFlags: [],
  repeatableFlags: ['case', 'arm'],
};

/**
 * One request, as the arguments the real command receives.
 *
 * The prompt goes last and the flags before it, because `/oai:task` stops
 * reading flags at the first word of the request. Both prompts are stored on the
 * record by the caller rather than reconstructed from a label later — a label is
 * not the thing that was sent.
 */
export function requestArgs(caseDef, arm, options) {
  const flags = ['task', '--json', '--template', caseDef.template, ...attachmentArgs(caseDef)];
  if (options.provider) flags.push('--provider', options.provider);
  if (options.model) flags.push('--model', options.model);
  if (options['max-seconds']) flags.push('--max-seconds', String(options['max-seconds']));
  if (options['max-attempts']) flags.push('--max-attempts', String(options['max-attempts']));
  return [...flags, caseDef.prompts[arm]];
}

/** One real invocation. Separated so `runSweep` can be driven without a model. */
export function invoke(caseDef, arm, options) {
  try {
    const stdout = execFileSync(process.execPath, [COMPANION, ...requestArgs(caseDef, arm, options)], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64e6,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout);
  } catch (error) {
    // The command writes its failure envelope to stdout and still exits nonzero,
    // so the record survives the failure it most needs to describe.
    const stdout = String(error.stdout ?? '');
    try {
      return JSON.parse(stdout);
    } catch {
      return { error: true, message: error.message, reason: null, attempts: null, requestedModel: null };
    }
  }
}

/**
 * Every case, every arm, every repetition — with the arm order ALTERNATED across
 * repetitions.
 *
 * The alternation is not tidiness. Both arms send a nearly identical prefix, and
 * a server-side prompt cache moves first-token latency by tens of times, so a
 * fixed order would systematically bill one arm the cold prefill and the other
 * the warm one. A measured run saw 421.7s cold against 11.5s warm on the same
 * prefix here.
 */
export function runSweep(cases, options, { execute = invoke } = {}) {
  // Validated here rather than trusted: `--runs 0` used to persist an all-zero
  // table with zero failures, which reads as a clean sweep produced from no
  // evidence — the `[].every()` shape this repo names elsewhere. An unknown arm
  // sent `undefined` as the prompt and recorded the result as a real failure.
  const runsPerCase = Number(options.runs ?? 1);
  if (!Number.isInteger(runsPerCase) || runsPerCase < 1) {
    throw new Error(`--runs must be a positive whole number, got ${JSON.stringify(options.runs)}`);
  }
  // De-duplicated, because completeness is judged by WHICH arms ran, never how
  // many: `--arm neutral --arm neutral` has length 2, so a length test called a
  // single-arm sweep complete and the INCOMPLETE banner never printed.
  const requested = options.arm?.length ? [...new Set(options.arm)] : [...ARMS];
  for (const arm of requested) {
    if (!ARMS.includes(arm)) throw new Error(`unknown --arm "${arm}"; have: ${ARMS.join(', ')}`);
  }
  const arms = requested;
  const results = [];

  for (const caseDef of cases) {
    const runs = [];
    for (let index = 0; index < runsPerCase; index += 1) {
      const order = index % 2 === 0 ? arms : [...arms].reverse();
      for (const arm of order) {
        process.stderr.write(`${caseDef.id} — ${arm} — run ${index + 1}/${runsPerCase}...\n`);
        const report = execute(caseDef, arm, options);
        const run = { arm, index, prompt: caseDef.prompts[arm], report };
        if (!report.error && typeof report.content === 'string') {
          run.score = scoreAnswer(report.content, caseDef.claims);
        }
        runs.push(run);
      }
    }
    results.push({ caseDef, runs });
  }
  return { results, arms };
}

/**
 * Which model answered, and whether it SAID so.
 *
 * A benchmark credits numbers to a model, so a run answered by a build nobody
 * asked for, or by one that never identified itself, must be visible in the
 * summary and not only in the record. `?` marks an id the server never confirmed
 * — `completion.mjs` echoes the requested one when the reply names none.
 *
 * Each id sits in a code span escaped with `safeCodeSpan`, so `q4_k_m` prints as
 * itself and a `|` cannot end the cell; the `?` stays outside the span.
 */
function modelCell(runs) {
  const seen = new Set();
  for (const run of runs) {
    const report = run.report ?? {};
    if (report.error) continue;
    seen.add(`\`${safeCodeSpan(report.model) || 'unknown'}\`${report.modelReported === false ? '?' : ''}`);
  }
  return seen.size === 0 ? '—' : [...seen].sort().join(', ');
}

/**
 * The report, which must state what it is not.
 *
 * Arms are reported side by side and NEVER averaged: framing was found to be
 * the dominant variable, so a single number across both would describe a
 * measurement nobody made. A sweep that ran one arm says so in its own heading
 * rather than looking complete.
 */
export function renderReport({ results, arms }) {
  const lines = ['# Task benchmark', ''];
  if (!ARMS.every((arm) => arms.includes(arm))) {
    lines.push(`**INCOMPLETE — only the ${arms.join(', ')} arm ran.** Framing is the dominant variable`);
    lines.push('measured here, so a single-arm sweep is not a benchmark of the template.', '');
  }

  lines.push(
    `| case | arm | model | exact | partial | missed | contradicted | failed |`,
    `|---|---|---|---|---|---|---|---|`,
  );
  for (const { caseDef, runs } of results) {
    for (const arm of arms) {
      const armRuns = runs.filter((run) => run.arm === arm);
      const { counts, failed } = tallyArm(armRuns);
      lines.push(
        `| ${safeInline(caseDef.id)} | ${arm} | ${modelCell(armRuns)} | ${counts.exact} | ${counts.partial} | ` +
          `${counts.missed} | ${counts.contradicted} | ${failed} |`,
      );
    }
  }

  lines.push('', '## What these numbers are not', '');
  for (const limit of MARKER_LIMITS) lines.push(`- ${limit}`);
  return lines.join('\n');
}

export async function main(argv) {
  const { options, positionals } = parseArgs(argv, TASK_BENCH_SPEC);
  // This command takes no positional argument. `parseArgs` stops reading flags at
  // the first non-`--` token and returns the rest as positionals, so a typo would
  // otherwise run the whole corpus with every flag after it ignored.
  if (positionals.length > 0) {
    throw new UserError(`Refusing: ${positionals.map((token) => `"${token}"`).join(', ')} is not an option this command takes, and everything after it was ignored rather than parsed.`, { hint: 'Flags only, and every flag must start with --. Check for a typo or a missing --.' });
  }
  const all = loadTaskCases(ROOT);
  // EVERY requested id must exist. Filtering silently dropped a typo whenever it
  // was mixed with a valid id, and the persisted record then looked like it had
  // honoured the request while omitting a case.
  const known = new Set(all.map((c) => c.id));
  for (const id of options.case ?? []) {
    if (!known.has(id)) throw new Error(`no such case "${id}"; have: ${[...known].join(', ')}`);
  }
  const selected = options.case?.length ? all.filter((c) => options.case.includes(c.id)) : all;
  // Kept BESIDE the unknown-id check, not replaced by it: with no ids requested
  // every case is selected, so only this check stops an empty corpus persisting
  // a successful report with no rows — a result from no evidence.
  if (selected.length === 0) throw new Error('no cases to run — the corpus is empty');

  const sweep = runSweep(selected, options);
  const markdown = renderReport(sweep);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  persist(ROOT, stamp, { kind: 'task', options, ...sweep }, markdown);
  process.stdout.write(`${markdown}\n`);
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof UserError) {
      process.stderr.write(`${error.message}\n${error.hint ? `${error.hint}\n` : ''}`);
    } else {
      process.stderr.write(`${error?.stack ?? error}\n`);
    }
    process.exitCode = 1;
  });
}
