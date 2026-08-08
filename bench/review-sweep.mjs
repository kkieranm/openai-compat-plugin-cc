// Walk recent commits newest-first and have a local model review each one,
// unattended, until a wall clock says stop.
//
// It drives the REAL CLI as a child process — `review --commit <sha> --json` —
// exactly as `bench/run.mjs` does, and for the same reason: a harness that
// reimplemented any of the pipeline would be measuring itself. What it adds is
// the honest bookkeeping an unwatched run needs, because the failure that
// matters here is silent. On this hardware the model routinely spends its whole
// shared token budget reasoning and emits nothing (OAI-115), which looks
// identical to a clean review unless something insists on the difference.
//
// Structured after `bench/task-run.mjs`, NOT `bench/run.mjs`: that one calls
// `main()` at module scope, cannot be imported, and consequently has no test at
// all. Here the executor, the git reader and the clock are all parameters, so
// the whole loop runs in tests with no model, no child process and no waiting.
//
// What a reply MEANS lives in `lib/sweep-outcome.mjs`; this file decides what to
// do next.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/lib/args.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { classify, serverUnwell } from './lib/sweep-outcome.mjs';
import { resolvePin } from './lib/sweep-window.mjs';
import { writeSweep } from './lib/sweep-report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPANION = join(ROOT, 'scripts', 'oai-companion.mjs');

const SPEC = {
  valueFlags: [
    'until', 'minutes', 'from', 'max-commits', 'scan-limit', 'max-seconds', 'max-attempts',
    'abort-after', 'model', 'provider', 'base-url', 'out-dir',
  ],
  booleanFlags: ['diff-only'],
  repeatableFlags: ['include'],
};

const DEFAULTS = {
  include: ['scripts', 'bench', 'tests'],
  maxCommits: 40,
  scanLimit: 200,
  maxSeconds: 900,
  maxAttempts: 3,
  abortAfter: 3,
};

/**
 * When to stop STARTING work.
 *
 * `--until` is the flag this exists for — you say 06:00 at bedtime and mean
 * tomorrow morning — so an hour already past today resolves to the next
 * occurrence rather than to a deadline in the past, which would end the sweep
 * before it began. One of the two is required: a sweep with no stop condition is
 * not the thing that was asked for, so it must not be reachable by omission.
 *
 * The next occurrence is the next local CALENDAR DATE at the requested
 * hour and minute, not "24 hours later". Across a DST boundary those differ by
 * an hour, and it is precisely the overnight run that crosses one — in
 * Europe/London, `--until 06:00` started at 23:00 on the spring transition
 * resolved to 07:00 when this added a fixed 86,400,000 ms.
 */
export function resolveDeadline({ until, minutes }, startMs) {
  if (until && minutes) throw new UserError('Pass --until or --minutes, not both.');
  if (minutes !== undefined) {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) throw new UserError(`--minutes must be a positive number, got "${minutes}".`);
    return startMs + n * 60_000;
  }
  if (!until) throw new UserError('A stop condition is required: pass --until <HH:MM> or --minutes <N>.');
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(until);
  if (!match) throw new UserError(`--until must be HH:MM in 24-hour local time, got "${until}".`);
  const at = new Date(startMs);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (at.getTime() > startMs) return at.getTime();
  at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** Which of a commit's paths decide whether it is worth a review. */
function touchesIncluded(paths, include) {
  return paths.some((path) => include.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
}

function readGit(args, git) {
  return String(git(args) ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Commits newest-first from `from` (default `HEAD`), each tagged with whether it
 * is eligible.
 *
 * **Pass a full SHA, never a movable ref, when arms must be comparable.** The
 * benchmark runs the same ten commits against several models; enumerating from
 * `HEAD` meant a commit landing between arms silently shifted the window, so two
 * arms reviewed different work and the comparison meant nothing.
 *
 * Ineligible commits are RETURNED rather than dropped, so the report can say
 * "this one was passed over, and why". Enumeration stops as soon as enough
 * eligible commits are in hand — `--max-commits` counts those, not the ones
 * walked past, or a run whose recent history is all documentation would review
 * nothing while reporting that it had reached its limit.
 */
export function enumerateCommits({ include, maxCommits, scanLimit, from = 'HEAD' }, git) {
  const shas = readGit(['log', '--no-merges', '--format=%H', '-n', String(scanLimit), from], git);
  const out = [];
  let eligible = 0;
  for (const sha of shas) {
    if (eligible >= maxCommits) break;
    const subject = readGit(['log', '-1', '--format=%s', sha], git)[0] ?? '';
    const paths = readGit(['show', '--name-only', '--format=', sha], git);
    const included = touchesIncluded(paths, include);
    if (included) eligible += 1;
    out.push({ sha, subject, eligible: included });
  }
  return out;
}

function reviewArgs(sha, options) {
  const args = ['review', '--commit', sha, '--json', '--max-seconds', String(options.maxSeconds), '--max-attempts', String(options.maxAttempts)];
  if (options.diffOnly) args.push('--diff-only');
  for (const flag of ['model', 'provider', 'base-url']) {
    if (options[flag]) args.push(`--${flag}`, options[flag]);
  }
  return args;
}

/**
 * The real executor. Never used by tests, which pass their own.
 *
 * Everything the failure carries is kept — `stderr`, `code` and `signal` — and
 * that is not tidiness. Without `code` an `ENOBUFS` (this harness's own 64MB
 * capture ceiling) is indistinguishable from the child dying, and without
 * `stderr` a crashed commit reaches the morning with nothing saying why, on the
 * one path where no envelope exists to say it.
 */
function invoke(args) {
  try {
    const stdout = execFileSync(process.execPath, [COMPANION, ...args], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: error.stdout ?? '',
      stderr: String(error.stderr ?? ''),
      code: error.code,
      signal: error.signal,
    };
  }
}

/**
 * Does this entry say the SERVER is unwell, rather than this commit being hard
 * or this harness being at its own limit?
 *
 * Three admissions, and the boundary is "would the next commit fare any better":
 * a child that died; a failure envelope with **no usable reason**, which is what
 * a wrong `--model` produces and the likeliest unattended misconfiguration
 * there is; and a reason `serverUnwell` recognises.
 *
 * **`output-too-large` is NOT here.** It is this harness's 64MB capture ceiling —
 * a sweep defect, in ADR 021's own words — and counting it would have the sweep
 * blame the server for its own limit, then stop the night saying so.
 */
function isOutage(entry) {
  if (entry.outcome === 'crashed') return true;
  if (entry.outcome === 'failed' && !entry.reason) return true;
  return entry.outcome === 'failed' && serverUnwell(entry.reason);
}

/**
 * The loop. Returns every enumerated commit with what became of it.
 *
 * The deadline is read immediately BEFORE starting each review and never after,
 * the same discipline `awaitTurn` keeps in `job-queue.mjs`: the cap governs
 * whether to begin, so it is read at the last moment before the thing it
 * authorises. A review already in flight is never truncated — overshoot is
 * bounded by the per-commit `--max-seconds` instead.
 *
 * **Aborting never shortens the record.** Every commit that was enumerated
 * appears in `entries` whatever happens, because the coverage section's whole
 * job is saying what was not reviewed — and an outage is exactly when a reader
 * most needs the list. An earlier version `break`ed out of this loop, which
 * dropped the remainder from both artifacts and left the header understating
 * how much had been enumerated.
 */
export function runSweep(commits, options, { execute = invoke, now = Date.now } = {}) {
  const entries = [];
  let consecutiveOutage = 0;
  let stoppedBecause = 'every enumerated commit was settled';
  let aborted = false;
  for (const commit of commits) {
    // Eligibility is asked FIRST, and the order is the point: a docs-only commit
    // was never going to be reviewed, so blaming an outage for it overstates
    // what the outage cost. The deadline branch below was already ordered this
    // way; the abort branch was not, which is a slip rather than a policy.
    if (!commit.eligible) {
      entries.push({ ...commit, outcome: 'skipped-no-code' });
      continue;
    }
    if (aborted) {
      entries.push({ ...commit, outcome: 'skipped-abort' });
      continue;
    }
    if (now() >= options.deadline) {
      entries.push({ ...commit, outcome: 'skipped-deadline' });
      stoppedBecause = 'the wall-clock deadline passed';
      continue;
    }
    const startedAt = now();
    const entry = { ...commit, ...classify(execute(reviewArgs(commit.sha, options))), seconds: Math.round((now() - startedAt) / 1000) };
    entries.push(entry);
    consecutiveOutage = isOutage(entry) ? consecutiveOutage + 1 : 0;
    if (consecutiveOutage >= options.abortAfter) {
      stoppedBecause = `${consecutiveOutage} consecutive server failures — the server looks gone`;
      aborted = true;
    }
  }
  return { entries, stoppedBecause };
}

function positive(value, flag, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new UserError(`${flag} must be a positive integer, got "${value}".`);
  return n;
}

export function optionsFrom(parsed, startMs, root = ROOT) {
  return {
    deadline: resolveDeadline(parsed, startMs),
    include: parsed.include?.length ? parsed.include : DEFAULTS.include,
    maxCommits: positive(parsed['max-commits'], '--max-commits', DEFAULTS.maxCommits),
    scanLimit: positive(parsed['scan-limit'], '--scan-limit', DEFAULTS.scanLimit),
    maxSeconds: positive(parsed['max-seconds'], '--max-seconds', DEFAULTS.maxSeconds),
    maxAttempts: positive(parsed['max-attempts'], '--max-attempts', DEFAULTS.maxAttempts),
    abortAfter: positive(parsed['abort-after'], '--abort-after', DEFAULTS.abortAfter),
    from: parsed.from ?? 'HEAD',
    diffOnly: Boolean(parsed['diff-only']),
    model: parsed.model,
    provider: parsed.provider,
    'base-url': parsed['base-url'],
    outDir: parsed['out-dir'] ?? join(root, 'bench', 'results'),
  };
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 });
}

function main() {
  const { options: parsed } = parseArgs(process.argv.slice(2), SPEC);
  const startMs = Date.now();
  const options = optionsFrom(parsed, startMs);
  // Pin first, then enumerate from the resolved SHA, so the record and the
  // report name the revision that was actually walked.
  options.from = resolvePin(options.from, git);
  const commits = enumerateCommits(options, git);
  process.stderr.write(`Sweeping ${commits.filter((c) => c.eligible).length} eligible of ${commits.length} enumerated commits.\n`);
  const { entries, stoppedBecause } = runSweep(commits, options);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const { reportPath, recordPath } = writeSweep(options.outDir, stamp, {
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date().toISOString(),
    stoppedBecause,
    requestedModel: options.model ?? null,
    maxSeconds: options.maxSeconds,
    include: options.include,
    // Which window was enumerated. A report that cannot say this cannot be
    // compared with another one, which is the whole reason the flag exists.
    from: options.from,
    // Requested versus found. Without both, an arm that reached six of the ten
    // commits it was asked for reads as a completed run.
    requestedCommits: options.maxCommits,
    eligible: commits.filter((commit) => commit.eligible).length,
    // Both, because the shortfall sentence must name WHICH cause applied: the
    // scan limit stopping the walk, or the pinned history simply running out.
    scanLimit: options.scanLimit,
    walked: commits.length,
    // The enumeration's own count, never `entries.length`: they agree today and
    // the report must not depend on them continuing to.
    enumerated: commits.length,
    entries,
  });
  process.stderr.write(`\nReport: ${reportPath}\nRecord: ${recordPath}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof UserError ? error.message : String(error?.stack ?? error)}\n`);
    if (error instanceof UserError && error.hint) process.stderr.write(`${error.hint}\n`);
    process.exit(1);
  }
}
