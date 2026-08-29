// Read N sweep ledgers together and print a per-commit reproduction rate across
// runs — the cross-run reader `bench/` otherwise lacks, so every sweep A/B was
// assembled by hand. Stateless: the ledgers on disk ARE the history, consumed
// rather than replaced.
//
// Flags come BEFORE the ledger paths (parseArgs stops at the first positional),
// the same order recover-sweep.mjs and compare.mjs use. Takes two or more ledgers
// — one has nothing to reproduce against.
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/lib/args.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { readRuns } from './lib/sweep-reproduction.mjs';
import { renderReproduction } from './lib/sweep-reproduction-report.mjs';

const SPEC = { valueFlags: [], booleanFlags: [], repeatableFlags: [] };
const USAGE = 'sweep-reproduction.mjs <ledger-a> <ledger-b> [<ledger-c> ...]';

// Two paths that resolve to the same file are ONE ledger; realpathSync collapses
// symlinks and `./` vs absolute spellings. A path that will not resolve (it does
// not exist) is kept verbatim so readRuns surfaces its own read error.
function resolvePath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const contentHash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// A run's identity is its header `startedAt`. It is unique only WITHIN one
// `--out-dir` (the ledger there is created `wx`, so no two files collide on a
// millisecond); across separate `--out-dir`s two genuinely distinct runs CAN share
// it. So a same-`startedAt`/different-content pair below is ambiguous — a diverged
// copy of one run, or two runs that started in the same millisecond — and stage 3
// refuses it loudly rather than guess: a truncated copy would otherwise group with
// its source and read as a fabricated perfect reproduction, the silent fake
// agreement the dedup exists to prevent. A malformed ledger with no `startedAt`
// falls back to its filename stamp, since nothing better identifies it.
const runIdentity = (run) => (typeof run.header.startedAt === 'string' ? run.header.startedAt : run.stamp);

export function reproduce(paths) {
  // Three collapse stages, each safe because it never discards a comparable
  // observation: (1) a resolved-path alias (symlink, `./` vs absolute) is the same
  // file; (2) a byte-identical copy is treated as one run. Byte-identity does NOT by
  // itself prove same-run — the header `startedAt` collides across `--out-dir`s (see
  // stage 3), so two distinct runs could share it — but a run that reviewed anything
  // carries absolute per-entry `startedAt`/`endedAt` timestamps (review-sweep.mjs),
  // which two independent runs never match commit-for-commit, so a reviewed ledger's
  // bytes ARE unique to its run. The only distinct runs that can be byte-identical
  // are two that reviewed nothing (skip entries carry no timestamps, so the header
  // `startedAt` is their only per-run byte) — and a zero-reviewed run is
  // `observedModel: unknown` (ungroupable), contributing no reproduction row whether
  // collapsed here or kept as two identical singletons, so the collapse is harmless
  // in exactly the case where it could merge two distinct runs. An unreadable path is
  // kept so readRuns surfaces its own error.
  const resolvedUnique = [...new Map(paths.map((path) => [resolvePath(path), path])).values()];
  const byHash = new Map();
  for (const path of resolvedUnique) {
    let key;
    try {
      key = contentHash(path);
    } catch {
      key = path;
    }
    if (!byHash.has(key)) byHash.set(key, path);
  }
  const runs = readRuns([...byHash.values()]);
  // (3) Two DISTINCT-content ledgers that share a run identity (`startedAt`) are
  // ambiguous: one is a partial or diverged copy of the other, or they are two runs
  // that genuinely started in the same millisecond in different --out-dirs. The tool
  // cannot tell those apart, and grouping a diverged copy with its source would read
  // as a fabricated perfect reproduction — so refuse loudly rather than risk that
  // silent fake agreement. Names both, safe to quote (they are the user's own CLI
  // arguments).
  const byRun = new Map();
  for (const run of runs) {
    const id = runIdentity(run);
    if (byRun.has(id)) {
      throw new UserError(`Two ledgers claim the same run "${id}" but differ: "${byRun.get(id)}" and "${run.path}". If one is a copy of the other, pass only one; if they are genuinely two runs started in the same millisecond, the tool cannot prove that apart from a diverged copy, so it refuses.`);
    }
    byRun.set(id, run.path);
  }
  if (runs.length < 2) {
    throw new UserError(`Need at least two distinct ledgers to compare — aliases and copies of one run count as one. Usage: ${USAGE}`);
  }
  return renderReproduction(runs, paths.length - runs.length);
}

function main() {
  const { positionals } = parseArgs(process.argv.slice(2), SPEC);
  process.stdout.write(reproduce(positionals));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (error instanceof UserError) {
      process.stderr.write(`${error.message}${error.hint ? `\n${error.hint}` : ''}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
