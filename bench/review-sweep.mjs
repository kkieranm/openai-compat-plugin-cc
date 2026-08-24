// Walk recent commits newest-first and have a local model review each one,
// unattended, until a wall clock says stop.
//
// It drives the REAL CLI as a child process — `review --commit <sha> --json` —
// exactly as `bench/run.mjs` does, and for the same reason: a harness that
// reimplemented any of the pipeline would be measuring itself. What it adds is
// the honest bookkeeping an unwatched run needs, because the failure that
// matters here is silent. On this hardware the model routinely spends its whole
// shared token budget reasoning and emits nothing, which looks
// identical to a clean review unless something insists on the difference.
//
// Structured after `bench/task-run.mjs`: the executor, the git reader and the
// clock are all parameters, so the whole loop runs in tests with no model, no
// child process and no waiting.
//
// What a reply MEANS lives in `lib/sweep-outcome.mjs`; this file decides what to
// do next.
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/lib/args.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { classify, isOutage } from './lib/sweep-outcome.mjs';
import { resolveDeadline, resolvePin } from './lib/sweep-window.mjs';
import { envelopeFor, openLedger } from './lib/sweep-ledger.mjs';
import { writeSweep } from './lib/sweep-report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPANION = join(ROOT, 'scripts', 'oai-companion.mjs');

// Exported so the tests can drive the REAL argv through the REAL spec. A test
// that rebuilds this object proves only that its own copy is consistent, which
// is how two flags came to be documented and unpassable.
export const SPEC = {
  valueFlags: [
    'until', 'minutes', 'from', 'max-commits', 'scan-limit', 'max-seconds', 'max-attempts',
    'abort-after', 'model', 'provider', 'base-url', 'out-dir', 'repo',
  ],
  booleanFlags: ['diff-only'],
  repeatableFlags: ['include'],
};

const DEFAULTS = {
  include: ['scripts', 'bench', 'tests'],
  maxCommits: 40,
  scanLimit: 200,
  // 900 lost half the corpus to deadline-timeout; raising the cap alone recovers
  // only the commits that merely needed more time, not the ones whose
  // reasoning has no natural end on this server — salvage is what turns THOSE
  // into real findings instead of a wasted 3600s. Read them as complementary.
  maxSeconds: 3600,
  // 2 rather than 1: the starvation path records no attempts, so what
  // that ceiling costs there is unmeasured rather than known-idle.
  maxAttempts: 2,
  abortAfter: 3,
};

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
 * one path where no envelope exists to say it. `cwd` is the repo REVIEWED.
 */
function invoke(args, cwd = ROOT) {
  try {
    const stdout = execFileSync(process.execPath, [COMPANION, ...args], {
      cwd, encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'pipe'],
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
 * The loop. Returns every enumerated commit with what became of it.
 *
 * The deadline is read immediately BEFORE starting each review and never after,
 * the same discipline `awaitTurn` keeps in `job-queue.mjs`: the cap governs
 * whether to begin, so it is read at the last moment before the thing it
 * authorises. A review already in flight is never truncated — overshoot is
 * bounded by the per-commit `--max-seconds`, with one stated exception:
 * a salvage follow-up (`trySalvage`) runs on its own `SALVAGE_MAX_MS` budget
 * outside `--max-seconds` entirely, and since OAI-204 that can be up to two
 * such attempts (trimmed, then untrimmed) on one commit — up to +600s beyond
 * `--max-seconds`, not the +300s a reader of this comment alone would expect.
 *
 * **Aborting never shortens the record.** Every commit that was enumerated
 * appears in `entries` whatever happens, because the coverage section's whole
 * job is saying what was not reviewed — and an outage is exactly when a reader
 * most needs the list. An earlier version `break`ed out of this loop, which
 * dropped the remainder from both artifacts and left the header understating
 * how much had been enumerated.
 *
 * **Every branch settles through ONE function, and that is the point of it.**
 * `settle` both records the entry and hands it to the sink that puts it on disk,
 * so the two cannot come apart and a branch added later cannot quietly keep its
 * commit in memory only. `sink` defaults to discarding, which is what keeps the
 * existing tests — and any caller that only wants the return value — unchanged.
 *
 * **A sink that throws must never end the night, and that is not defensiveness.**
 * The sink writes to a disk that can be full, read-only or gone, and an
 * unguarded throw from commit 20 would propagate out of this loop and abandon
 * the remaining 20 — a *recording* fault destroying *review* coverage, which is
 * the exact failure this whole mechanism exists to remove. So the write is
 * attempted, its fault is reported once per occurrence, and the in-memory path
 * carries on as the floor it was before any of this existed.
 */
export function runSweep(commits, options, { execute = invoke, now = Date.now, sink = () => {}, warn = (m) => process.stderr.write(m) } = {}) {
  const entries = [];
  let consecutiveOutage = 0;
  let stoppedBecause = 'every enumerated commit was settled';
  let aborted = false;
  const settle = (entry) => {
    entries.push(entry);
    try {
      sink(entry);
    } catch (error) {
      warn(`Could not append ${entry.sha?.slice(0, 9)} to the ledger: ${error?.message ?? error}\n`);
    }
    return entry;
  };
  for (const commit of commits) {
    // Eligibility is asked FIRST, and the order is the point: a docs-only commit
    // was never going to be reviewed, so blaming an outage for it overstates
    // what the outage cost. The deadline branch below was already ordered this
    // way; the abort branch was not, which is a slip rather than a policy.
    if (!commit.eligible) {
      settle({ ...commit, outcome: 'skipped-no-code' });
      continue;
    }
    if (aborted) {
      settle({ ...commit, outcome: 'skipped-abort' });
      continue;
    }
    if (now() >= options.deadline) {
      settle({ ...commit, outcome: 'skipped-deadline' });
      stoppedBecause = 'the wall-clock deadline passed';
      continue;
    }
    // Absolute times, where `seconds` is only a duration: no artifact this
    // harness ever wrote could say WHEN a commit was reviewed. They also mark a
    // commit as ATTEMPTED — the skip branches return before this line exactly as
    // they return before the outage counter below, so replaying that counter
    // selects on `startedAt` rather than on a second list of skip outcome names
    // kept in step with this loop by hand.
    const startedMs = now();
    const settled = classify(execute(reviewArgs(commit.sha, options)));
    const endedMs = now();
    const entry = settle({
      ...commit,
      ...settled,
      startedAt: new Date(startedMs).toISOString(),
      endedAt: new Date(endedMs).toISOString(),
      seconds: Math.round((endedMs - startedMs) / 1000),
    });
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

/**
 * `--include <prefix>` normalized to what `touchesIncluded` actually compares
 * against — a bare git-relative segment, no leading `./` and no trailing `/`.
 * Without this, `--include src/` or `--include ./src` parse, pass the
 * non-empty check below, and then match NOTHING — a silent hollow sweep, one
 * flag over.
 *
 * Stripping the one leading `./` is not enough: git
 * never emits a path that is absolute, that is exactly `.` or `..`, that is a
 * traversal (`../x`), or that a POSIX normalize would rewrite (an internal
 * `/./` or `//`) — `--include .` (the most plausible way to type "review
 * everything") and `--include ../x` both parsed, passed a bare non-empty
 * check, and matched nothing. All of those shapes are refused here.
 *
 * Trimmed FIRST, and the trimmed value is what both validation and the
 * returned entry use: a surrounding-whitespace value like
 * `--include 'src '` used to validate against a trimmed copy but return the
 * untrimmed one, matching nothing — the same silent-hollow-sweep failure one
 * character over. `..startsWith('..')` also used to refuse a legitimate name
 * like `..config`, which shares no path-traversal meaning with `../x` — only
 * an exact `..` or a `../` prefix is traversal.
 */
function normalizedInclude(raw) {
  const cleaned = raw.map((entry) => entry.trim().replace(/^\.\//, '').replace(/\/+$/, ''));
  const bad = cleaned.filter((entry) => {
    if (entry === '' || entry === '.' || entry === '..' || entry.startsWith('../') || entry.startsWith('/')) return true;
    return posix.normalize(entry) !== entry;
  });
  if (bad.length) {
    throw new UserError(`--include was given ${bad.length} value(s) that cannot match a real git-relative path (${bad.map((v) => JSON.stringify(v)).join(', ')}) — empty, ".", "..", an absolute path, or a "./"/"//"-containing segment matches nothing, silently reviewing nothing under it.`, { hint: 'Pass a real path prefix relative to the target repo\'s root, e.g. --include src.' });
  }
  return cleaned;
}

// `--repo` resolves to `options.repo`, what `git()`/`invoke()` root at
// (both hardcoded ROOT). `DEFAULTS.include` is THIS repo's layout,
// so a --repo resolving to a FOREIGN path with no --include is refused, not
// defaulted — naming this tool's own root back is a no-op, not a footgun,
// and comparing resolved identity rather than syntactic presence is what
// keeps `--repo <ROOT>` from refusing for no reason. `--repo`
// given as an empty/whitespace value is refused rather than silently read as
// "not given" — a mistyped `--repo=` must not fall back to self-review.
// **DEFERRED, not missed**: `resolve()` compares lexical paths, not git
// identity, so `--repo` naming this tool through a symlink or a subdirectory
// still reads as foreign and asks for `--include` unnecessarily. `--include`
// handles a false "foreign" harmlessly;
// only a false negative (a real foreign repo missing the guard) would be a
// defect, and lexical resolve() never produces one.
//
// **Trimmed once, and the trimmed value is what both the empty check AND
// `resolve()` use (Codex + fork-opener, pass 4)** — the same failure class
// `normalizedInclude` had: validating a trimmed copy but resolving the
// UNTRIMMED original made `--repo ' /tmp/target'` pass the empty guard and
// then resolve to a bogus path with a literal space segment, failing later
// with an opaque git/ENOENT error instead of the clear refusal.
export function optionsFrom(parsed, startMs, root = ROOT) {
  const trimmedRepo = parsed.repo !== undefined ? parsed.repo.trim() : parsed.repo;
  if (trimmedRepo === '') {
    throw new UserError('--repo was given an empty value.', { hint: 'Pass a real path, or omit --repo to sweep this tool\'s own repo.' });
  }
  const repo = trimmedRepo ? resolve(trimmedRepo) : root;
  const foreignRepo = repo !== resolve(root);
  if (foreignRepo && !parsed.include?.length) {
    throw new UserError(`--repo points at a different repository (${repo}), so --include must be given explicitly — this tool's own defaults (${DEFAULTS.include.join(', ')}) describe this repo's layout, not the target's.`, { hint: 'Pass one or more --include <path-prefix> flags naming the target repo\'s own directories worth reviewing.' });
  }
  return {
    deadline: resolveDeadline(parsed, startMs),
    include: parsed.include?.length ? normalizedInclude(parsed.include) : DEFAULTS.include,
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
    repo,
    // ONE definition of "is this a foreign repo", consumed by `main()` below —
    // not recomputed there: two independent comparisons of the same fact only
    // agree by construction, not by a shared source.
    foreignRepo,
  };
}

function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64e6 });
}

function main() {
  const { options: parsed, positionals } = parseArgs(process.argv.slice(2), SPEC);
  // **This command takes no positional argument, so a leftover one is a typo and
  // is refused.** `parseArgs` stops reading flags at the first non-`--` token and
  // pushes the REST into positionals, so `--minutes 10 typo --model wanted` used
  // to run for eight unattended hours on the DEFAULT model and say nothing about
  // it. Discarding `positionals` is what made that silent. The recovery CLI
  // beside this one refuses the same shape for the same reason.
  if (positionals.length > 0) {
    throw new UserError(`Refusing: ${positionals.map((token) => `"${token}"`).join(', ')} is not an option this command takes, and everything after it was ignored rather than parsed.`, { hint: 'Flags only, and every flag must start with --. Check for a typo or a missing --.' });
  }
  const startMs = Date.now();
  const options = optionsFrom(parsed, startMs);
  const gitAtRepo = (args) => git(args, options.repo); // rooted at the repo actually being swept
  // Pin first, then enumerate from the resolved SHA, so the record and the
  // report name the revision that was actually walked.
  options.from = resolvePin(options.from, gitAtRepo);
  const commits = enumerateCommits(options, gitAtRepo);
  if (options.foreignRepo) process.stderr.write(`Reviewing ${options.repo}\n`);
  process.stderr.write(`Sweeping ${commits.filter((c) => c.eligible).length} eligible of ${commits.length} enumerated commits.\n`);
  // Stamped from the START, not from the end as this once was: the ledger must
  // be named before the first review, and the report it may become has to carry
  // the same stamp or recovery cannot name its output after the run it recovers.
  const stamp = new Date(startMs).toISOString().replace(/[:.]/g, '-');
  const ledger = openLedger(options.outDir, stamp);
  const envelope = envelopeFor(options, commits, startMs);
  ledger.header(envelope);
  // Announced before the loop, because for the next several hours this path is
  // the only thing a watcher can read.
  process.stderr.write(`Ledger: ${ledger.path}\n`);
  const { entries, stoppedBecause } = runSweep(commits, options, { sink: ledger.entry, execute: (args) => invoke(args, options.repo) });
  const { reportPath, recordPath } = writeSweep(options.outDir, stamp, {
    ...envelope,
    endedAt: new Date().toISOString(),
    stoppedBecause,
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
    process.exitCode = 1;
  }
}
