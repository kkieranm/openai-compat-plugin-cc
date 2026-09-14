// Turn an interrupted run's ledger into the report that run never got to write.
//
// The ledger exists because a sweep that dies at hour eight used to lose all
// forty commits. But a file of JSON lines nobody can read as a report
// only moves the problem: the disposition table is what makes a night legible,
// and rebuilding it by eye at 07:00 is not recovery. So this is the reader, and
// it is a SEPARATE COMMAND rather than something the next sweep does on startup
// — recovery logic on the hot path of the thing being protected is the wrong
// trade, and it would mean a second sweep must run before the first one's result
// can be read at all.
//
// **It renders nothing itself.** The record it reconstructs goes to the same
// `writeSweep` a completed run uses, so a recovered report is the same artifact
// with the same guarantees, not a thinner sibling that has to be trusted
// separately.
//
// **Run against a LIVE sweep it reports a partial night.** A running sweep has
// written no report yet, so the sibling-report refusal in `main` cannot catch
// this one. The figures are a snapshot of a moving ledger and the commits listed
// `unobserved` may be reviewed minutes later. Recover a run you know has ended;
// the report the sweep writes for itself is the one to read otherwise.
//
// An earlier version of this note called that "a legibility trap rather than a
// falsehood". **That was itself false**, and one sentence proved it: the
// zero-entry case rendered *"No commit reached the ledger before the run
// ended"*, asserting an ending nothing here can observe, into a permanent
// artifact. The wording below now asserts only what was READ — which is the
// property that makes the rest of this paragraph true rather than the claim
// that it was true already.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/lib/args.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { readLedger } from './lib/sweep-ledger.mjs';
import { writeSweep } from './lib/sweep-report.mjs';

const SPEC = { valueFlags: ['out-dir'], booleanFlags: ['force'] };
// Options FIRST — see the refusal in `main`, which exists because the other
// order parses silently and does the wrong thing.
const USAGE = 'recover-sweep.mjs [--out-dir DIR] [--force] <review-sweep-<stamp>.ledger.jsonl>';

// The two synthesized outcomes, which is what "no entry reached the ledger"
// looks like after `mergeManifest` has disposed of the manifest.
const MISSING = new Set(['unobserved', 'unrecorded']);
const isMissing = (entry) => MISSING.has(entry.outcome);

/**
 * The run's stamp, read back out of the filename the sweep chose.
 *
 * The recovered artifacts are named for the run they describe rather than for
 * the moment recovery happened, so they sort beside that run's ledger instead of
 * appearing to be a separate night's work.
 */
export function stampFrom(path) {
  const match = /^review-sweep-(.+)\.ledger\.jsonl$/.exec(basename(path));
  if (!match) throw new UserError(`Not a sweep ledger filename: "${basename(path)}".`);
  return match[1];
}

/**
 * Every enumerated commit, disposed of exactly once — which is the guarantee
 * that makes this a report rather than a fragment.
 *
 * The ledger holds entries only for commits the run reached. Handing those alone
 * to the renderer produces a document that contradicts itself: the header counts
 * 40 enumerated from the envelope while the coverage section, which reads the
 * entries it was given, concludes that every enumerated commit was reviewed. So
 * the manifest the header carries is walked IN ENUMERATION ORDER and anything
 * with no entry is synthesized.
 *
 * **Two different absences, and conflating them states a falsehood.** A commit
 * with no line at all is `unobserved` — the run may never have reached it, or
 * may have settled it and lost the write, and **the ledger cannot tell which**.
 * A commit with a `gap` line is `unrecorded`: the run demonstrably settled it
 * and the write failed, so its record is known to be lost rather than unknown
 * to have existed. An earlier version reported both as "never settled", which is
 * false for either — the reviewer's own guard against a failing disk is what
 * makes it false, so the guard and this wording arrived together.
 *
 * Neither is in `REVIEWED`, so the existing coverage section disposes of both
 * correctly with no change to the renderer beyond naming the outcomes.
 */
export function mergeManifest(commits, entries, gaps = []) {
  const bySha = new Map(entries.map((entry) => [entry.sha, entry]));
  const gapBySha = new Map(gaps.map((gap) => [gap.sha, gap]));
  return (commits ?? []).map((commit) => {
    if (bySha.has(commit.sha)) return bySha.get(commit.sha);
    const gap = gapBySha.get(commit.sha);
    return gap ? { ...commit, outcome: 'unrecorded', reason: gap.why ?? null } : { ...commit, outcome: 'unobserved' };
  });
}

/**
 * What a crash destroys, supplied explicitly rather than guessed.
 *
 * `endedAt` stays NULL. A run that was killed has no end, and putting the last
 * observation into a field labelled *ended* asserts something false — so the
 * last thing actually seen is stated here, in a sentence that can label it for
 * what it is. The zero-entry case is the one this must survive: a kill during
 * the very first review leaves a header and nothing else, and that has to
 * produce a report saying so rather than a crash of its own.
 */
export function recoveredRecord({ header, entries, gaps = [], discarded }) {
  const merged = mergeManifest(header.commits, entries, gaps);
  const unobserved = merged.filter((entry) => entry.outcome === 'unobserved').length;
  const unrecorded = merged.filter((entry) => entry.outcome === 'unrecorded').length;
  // The last time anything was OBSERVED, which only an attempted commit has —
  // a skipped one is settled without the clock ever being read. Taking the last
  // entry's `endedAt` unconditionally reported "no commit was settled" over a
  // ledger holding four settled skips, because `undefined` is falsy. Found by
  // running the tool against a real torn ledger rather than by reading it.
  const last = [...entries].reverse().find((entry) => entry.endedAt)?.endedAt ?? null;
  // Counted over BOTH, or a ledger of nothing but gaps says no commit was
  // settled directly after saying which commits were settled and lost.
  const recorded = entries.length + gaps.length;
  // **Every one of these asserts only what was READ, never that the run ended.**
  // The last said "No commit reached the ledger before the run ended", which is
  // a statement this tool cannot support: run against a sweep that is still
  // going and has written its header but no entry yet, the run has not ended,
  // and that false sentence lands in a permanent artifact where the stderr
  // notice does not reach.
  const observed = last
    ? `Last activity observed at ${last}.`
    : recorded > 0
      ? `${recorded} commit(s) reached the ledger but none carries a review time, so no activity time was observed.`
      : 'No commit had reached the ledger when it was read.';
  const torn = discarded > 0 ? ` ${discarded} ledger line(s) could not be parsed and were discarded — a final line torn by the interruption is the usual cause, but an interior one means arbitrary lost entries.` : '';
  // Stated only when there ARE any. "0 commits have no ledger entry, each of
  // which was either never reached or..." is noise on a ledger that turned out
  // to cover its whole manifest.
  const missing = unobserved > 0
    ? ` ${unobserved} enumerated commit(s) have no ledger entry: each was either never reached or was settled and lost its write, and the ledger cannot tell which, so they are listed as \`unobserved\` rather than as never settled.`
    : ' Every enumerated commit reached the ledger.';
  const lost = unrecorded > 0 ? ` ${unrecorded} commit(s) WERE settled and their record could not be written — listed as \`unrecorded\`; what they found is lost, rather than never having existed.` : '';
  return {
    ...header,
    endedAt: null,
    // **DERIVED from manifest coverage, never asserted.** A hole makes two
    // recorded outages look consecutive when a healthy commit sat between them,
    // and hides one when the missing entry was the outage — so the health replay
    // must know. But a run killed after its last entry was written and before
    // the artifacts were is fully represented, and telling that reader "commits
    // are missing" would be its own false statement.
    //
    // **It is the HEALTH timeline, not coverage**, and the two have different
    // completeness. A missing entry can only distort the streak if the loop could
    // have ATTEMPTED that commit, and an ineligible one never can — it reaches
    // `skipped-no-code`, which returns before the clock is read and before the
    // counter. So a crash before a trailing docs-only commit leaves the health
    // timeline whole, and warning over it would be a caveat with nothing behind
    // it. Coverage is untouched: those commits still render as `unobserved` and
    // are still disposed of exactly once.
    timelineComplete: merged.every((entry) => !isMissing(entry) || entry.eligible === false),
    stoppedBecause: `THE RUN DID NOT FINISH — this report was recovered from the incremental ledger.${missing}${lost} ${observed}${torn}`,
    entries: merged,
  };
}

/**
 * Did the run this ledger belongs to write a COMPLETE report of its own?
 *
 * Unreadable, unparseable or lacking the identity witness all mean "no", which
 * lets recovery proceed. That direction is deliberate: a false "no" costs a
 * redundant recovered report beside a real one, while a false "yes" refuses to
 * recover a night that was genuinely lost.
 */
function finishedRun(recordPath) {
  try {
    return typeof JSON.parse(readFileSync(recordPath, 'utf8'))?.endedAt === 'string';
  } catch {
    return false;
  }
}

/**
 * The one ledger path, or a refusal naming what was wrong.
 *
 * **`parseArgs` stops reading flags at the first positional** — a non-`--` token
 * pushes the whole rest of argv into positionals and breaks — so the options-last
 * form this tool's own usage text once documented parsed the flag as a filename
 * and silently wrote beside the ledger instead. A flag that is accepted and does
 * nothing is worse than one that is refused.
 *
 * **Every surplus positional is refused, not merely the flag-shaped ones.** The
 * first version of this guard looked only for a leading `--`, so
 * `recover-sweep.mjs ledger-A ledger-B` recovered A and discarded B in silence —
 * the same defect one door along from the one it was written to close. This
 * command takes exactly one ledger.
 */
function ledgerPathFrom(positionals) {
  const [path, ...surplus] = positionals;
  if (!path) throw new UserError(`Pass the ledger to recover: ${USAGE}`);
  if (surplus.length === 0) return path;
  const named = surplus.map((token) => `"${token}"`).join(', ');
  const why = surplus.some((token) => token.startsWith('--'))
    ? `options must come BEFORE the ledger path, so ${named} was read as a filename rather than a flag`
    : `this command recovers exactly one ledger, and ${named} would have been ignored`;
  throw new UserError(`Refusing: ${why}.`, { hint: USAGE });
}

function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const path = ledgerPathFrom(positionals);
  const ledger = readLedger(path);
  // **A run that finished is proved by a record that PARSES, never by one that
  // exists.** `writeSweep` writes the `.md` and then the record, and an earlier
  // version of this check read the record's mere existence as proof both writes
  // completed. That was false, and false in the direction that matters: the
  // record is written with a single `writeFileSync`, which truncates the file
  // and then fills it, so a process killed mid-write leaves a `.json` that
  // exists and is a fragment. Recovery would then refuse — "that run finished" —
  // at precisely the moment recovery was needed.
  //
  // **The two conditions do different jobs, and neither is redundant.** Parse
  // success is the DURABILITY witness: the record is one stringified object, so
  // its closing brace is in the last bytes written and no prefix of it can
  // parse. A non-null `endedAt` is the IDENTITY witness, and it defends a
  // different case — a `.json` at that path that parses but is not this run's
  // completed record, which `recoveredRecord` guarantees by leaving `endedAt`
  // null on everything it writes.
  //
  // Refused rather than warned: the two artifacts sort together and a reader
  // reaching for the newest would take the false one.
  const original = join(dirname(path), `review-sweep-${stampFrom(path)}.json`);
  if (!options.force && finishedRun(original)) {
    throw new UserError(`That run finished — its report is already written at ${original}.`, { hint: 'Pass --force to recover from the ledger anyway (it will be written alongside, suffixed `-recovered`).' });
  }
  // Refused rather than defaulted. The envelope is the run's identity — which
  // revision, how many commits, which model — and inventing one would produce a
  // confident report about a run whose shape nothing knows.
  if (!ledger.header) throw new UserError(`That ledger has no header line, so nothing knows what run it describes: "${path}".`);
  const record = recoveredRecord(ledger);
  const outDir = options['out-dir'] ?? dirname(path);
  const { reportPath, recordPath } = writeSweep(outDir, `${stampFrom(path)}-recovered`, record);
  const settled = ledger.entries.length;
  process.stderr.write(`Recovered ${settled} of ${record.entries.length} enumerated commits.\n`);
  // Stated every time rather than detected: whether the sweep is still running
  // is not a question a ledger can answer, and a report that reads as a finished
  // night is exactly what a mid-flight recovery produces.
  process.stderr.write('This reads the ledger as it stands — if that sweep is still running, the report describes a partial night, not a finished one.\n');
  process.stderr.write(`Report: ${reportPath}\nRecord: ${recordPath}\n`);
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
