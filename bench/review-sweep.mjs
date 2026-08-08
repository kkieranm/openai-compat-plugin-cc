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
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/lib/args.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { NON_RETRYABLE_TRANSPORT, TRANSPORT } from '../scripts/lib/failure-shape.mjs';
import { attemptsFrom, outcomeFor, reasonFrom, requestedModelFrom } from './lib/outcome.mjs';
import { writeSweep } from './lib/sweep-report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPANION = join(ROOT, 'scripts', 'oai-companion.mjs');

const SPEC = {
  valueFlags: ['until', 'minutes', 'max-commits', 'scan-limit', 'max-seconds', 'max-attempts', 'model', 'provider', 'base-url', 'out-dir'],
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

/** Reason codes that mean the server, not the model, is the problem. */
const TRANSPORT_REASONS = new Set([TRANSPORT, NON_RETRYABLE_TRANSPORT]);

/**
 * When to stop STARTING work.
 *
 * `--until` is the flag this exists for — you say 06:00 at bedtime and mean
 * tomorrow morning — so an hour already past today resolves to the next
 * occurrence rather than to a deadline in the past, which would end the sweep
 * before it began. One of the two is required: a sweep with no stop condition is
 * not the thing that was asked for, so it must not be reachable by omission.
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
  const resolved = at.getTime();
  return resolved > startMs ? resolved : resolved + 86_400_000;
}

/** Which of a commit's paths decide whether it is worth a review. */
function touchesIncluded(paths, include) {
  return paths.some((path) => include.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
}

function readGit(args, git) {
  return String(git(args) ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Commits newest-first, each tagged with whether it is eligible.
 *
 * Ineligible commits are RETURNED rather than dropped, so the report can say
 * "this one was passed over, and why". Enumeration stops as soon as enough
 * eligible commits are in hand — `--max-commits` counts those, not the ones
 * walked past, or a run whose recent history is all documentation would review
 * nothing while reporting that it had reached its limit.
 */
export function enumerateCommits({ include, maxCommits, scanLimit }, git) {
  const shas = readGit(['log', '--no-merges', '--format=%H', '-n', String(scanLimit)], git);
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

/**
 * What one finished child means.
 *
 * The ORDER is load-bearing, not stylistic. `outcomeFor` does a bare
 * `JSON.parse` and throws on anything malformed, so unreadable output is
 * classified and returned before it can reach it; `reasonFrom` is the helper
 * that gates on `error === true`. Both take RAW STDOUT and parse it themselves —
 * handing either a parsed object returns null and silently loses every reason.
 */
export function classify({ status, stdout }) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ''));
  } catch {
    return { outcome: status === 0 ? 'unreadable' : 'crashed' };
  }
  if (!parsed || typeof parsed !== 'object') return { outcome: status === 0 ? 'unreadable' : 'crashed' };
  if (parsed.error === true) {
    const reason = reasonFrom(stdout);
    return {
      outcome: reason === 'token-exhaustion' ? 'starved' : 'failed',
      reason,
      model: requestedModelFrom(stdout),
      attempts: attemptsFrom(stdout),
    };
  }
  const settled = outcomeFor(stdout, false);
  if (settled.reason === 'model-substituted') {
    return { outcome: 'substituted', reason: settled.reason, model: settled.report?.model };
  }
  const findings = settled.report?.findings;
  // `null` is "could not be read" and `[]` is "read, nothing found" — a
  // distinction ADR 003 exists to protect. Collapsing them is what turns an
  // unreadable night into a clean one.
  if (!Array.isArray(findings)) return { outcome: 'unreadable', model: settled.report?.model };
  return { outcome: findings.length > 0 ? 'findings' : 'clean', findings, model: settled.report?.model };
}

function reviewArgs(sha, options) {
  const args = ['review', '--commit', sha, '--json', '--max-seconds', String(options.maxSeconds), '--max-attempts', String(options.maxAttempts)];
  if (options.diffOnly) args.push('--diff-only');
  for (const flag of ['model', 'provider', 'base-url']) {
    if (options[flag]) args.push(`--${flag}`, options[flag]);
  }
  return args;
}

/** The real executor. Never used by tests, which pass their own. */
function invoke(args) {
  try {
    const stdout = execFileSync(process.execPath, [COMPANION, ...args], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '' };
  }
}

function isTransport(entry) {
  return entry.outcome === 'crashed' || (entry.outcome === 'failed' && TRANSPORT_REASONS.has(entry.reason));
}

/**
 * The loop. Returns every enumerated commit with what became of it.
 *
 * The deadline is read immediately BEFORE starting each review and never after,
 * the same discipline `awaitTurn` keeps in `job-queue.mjs`: the cap governs
 * whether to begin, so it is read at the last moment before the thing it
 * authorises. A review already in flight is never truncated — overshoot is
 * bounded by the per-commit `--max-seconds` instead.
 */
export function runSweep(commits, options, { execute = invoke, now = Date.now } = {}) {
  const entries = [];
  let consecutiveTransport = 0;
  let stoppedBecause = 'every enumerated commit was settled';
  for (const commit of commits) {
    if (!commit.eligible) {
      entries.push({ ...commit, outcome: 'skipped-no-code' });
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
    consecutiveTransport = isTransport(entry) ? consecutiveTransport + 1 : 0;
    if (consecutiveTransport >= options.abortAfter) {
      stoppedBecause = `${consecutiveTransport} consecutive transport failures — the server looks gone`;
      break;
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

function optionsFrom(parsed, startMs) {
  return {
    deadline: resolveDeadline(parsed, startMs),
    include: parsed.include?.length ? parsed.include : DEFAULTS.include,
    maxCommits: positive(parsed['max-commits'], '--max-commits', DEFAULTS.maxCommits),
    scanLimit: positive(parsed['scan-limit'], '--scan-limit', DEFAULTS.scanLimit),
    maxSeconds: positive(parsed['max-seconds'], '--max-seconds', DEFAULTS.maxSeconds),
    maxAttempts: positive(parsed['max-attempts'], '--max-attempts', DEFAULTS.maxAttempts),
    abortAfter: DEFAULTS.abortAfter,
    diffOnly: Boolean(parsed['diff-only']),
    model: parsed.model,
    provider: parsed.provider,
    'base-url': parsed['base-url'],
    outDir: parsed['out-dir'] ?? join(ROOT, 'bench', 'results'),
  };
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 });
}

function main() {
  const { options: parsed } = parseArgs(process.argv.slice(2), SPEC);
  const startMs = Date.now();
  const options = optionsFrom(parsed, startMs);
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
