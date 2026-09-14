// The run's own log, written while the run is happening.
//
// The sweep used to hold every settled commit in memory and write once, at the
// end. A full run can take 8+ hours and produce its first byte of output in
// the final second of it — so a crash, a panic or a kill at hour eight
// lost all forty commits, not degraded but gone. This module is the other half
// of that trade: each commit reaches disk as it settles, so what survives an
// interrupted night is what the night had actually finished. **Not every settled
// commit: every settled commit whose write SUCCEEDS.** The guard on `entry()`
// below means a write can fail without ending the run, and overstating that here
// is the falsehood every reader downstream would inherit.
//
// **JSONL rather than a database, and the reason is not simplicity.** A
// per-commit `INSERT` would buy transactional atomicity across rows, which one
// line per commit does not need, and it would buy no better flush guarantee
// against the failures this exists for. What it would cost is real: `node:sqlite`
// is gated as a CAPABILITY rather than a version precisely so a runtime
// lacking that builtin loses background jobs alone — depending on it here would
// make an unattended run's crash protection conditional on the one thing the job
// store was careful to keep optional.
//
// **Nothing here buffers, and that is the whole mechanism.** The sweep calls
// `execFileSync` per commit, so there is no event loop to flush on, and a
// `SIGKILL` gives no chance to drain. Each line is one `appendFileSync`: a fresh
// descriptor, `O_APPEND`, returning only once the write has been made.
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { UserError } from '../../scripts/lib/errors.mjs';

/**
 * Beside the artifacts it will become, sharing their stamp.
 *
 * The shared stamp is what lets `recover-sweep.mjs` name its output from the
 * ledger's own filename, so a recovered report is recognisably the same run as
 * the one that died rather than a new artifact with an unrelated timestamp.
 */
export function ledgerPathFor(outDir, stamp) {
  return join(outDir, `review-sweep-${stamp}.ledger.jsonl`);
}

// The inverse of the name `ledgerPathFor` mints — the ONE place the ledger-filename
// grammar is parsed, so a reader cannot drift from the writer. Returns the stamp, or
// null for a name this pattern does not produce; each caller chooses its own policy
// for the null (recover-sweep throws, the reproduction reader falls back to the
// basename), which is why this returns rather than throws.
export function ledgerStampFrom(path) {
  const match = /^review-sweep-(.+)\.ledger\.jsonl$/.exec(basename(path));
  return match ? match[1] : null;
}

/**
 * Create the ledger EXCLUSIVELY, and treat a collision as fatal.
 *
 * `appendFileSync` alone would open an existing ledger and interleave two runs
 * into one file, where the report and record beside it would visibly clobber. A
 * silent merge is the worse failure: the merged file still parses, and recovery
 * would render two runs as one.
 *
 * **Fatal rather than disambiguated.** The stamp is a full ISO timestamp to the
 * MILLISECOND, so a collision between two independently launched sweeps is
 * vanishingly unlikely — but it is *unlikely, not impossible*, and an earlier
 * version of this comment said a collision "means the stamp is being reused",
 * which two processes observing the same millisecond falsify. What the refusal
 * actually buys is that the cost of the improbable case is a run that dies
 * loudly at minute zero and can simply be relaunched, where the alternative is
 * two runs merged into one file that still parses. Inventing a second stamp was
 * the other option and would leave the run's ledger and its report named
 * differently, breaking the one thing a shared stamp exists for.
 *
 * Mode `0o600` because the ledger carries captured stdout and stderr verbatim.
 */
function createExclusively(path) {
  try {
    closeSync(openSync(path, 'wx', 0o600));
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    throw new UserError(`A ledger already exists at ${path}, so this run would append into another run's record.`, { hint: 'Either a stamp is being reused, or two runs started in the same millisecond. Move or delete the existing ledger, or run with a different --out-dir.' });
  }
}

/**
 * A sink the sweep can hand each settled commit to.
 *
 * **No `fsync`, deliberately.** A synchronous write has already reached the
 * kernel, so the bytes outlive the process and outlive the machine sleeping —
 * which are the failures this module actually guards against. `fsync` would
 * additionally survive a power cut, at the cost of a disk flush per commit.
 *
 * **Three residual exposures, and naming only the first understates it.** A torn
 * final line, which `readLedger` discards rather than failing over. An entry lost
 * to a caught write fault, which the `gap` line below exists to declare. And, on
 * a power cut specifically, any writes still dirty in the page cache — not merely
 * the last — which is the exposure `fsync` would have bought off.
 *
 * Lines are TAGGED and their payload NESTED. Spreading an entry into the line
 * object would put the harness's own `kind` in the same namespace as fields
 * coming from another process's JSON envelope, and a reply that happened to
 * carry `kind` would then decide how its own line is read.
 */
export function openLedger(outDir, stamp) {
  mkdirSync(outDir, { recursive: true });
  const path = ledgerPathFor(outDir, stamp);
  createExclusively(path);
  // **Every record is written LEADING-newline-first, so each append is
  // self-delimiting.** Terminating instead is the obvious shape and it is
  // wrong here: a write that fails part-way leaves a fragment with no
  // terminator, and the NEXT successful append fuses onto it, so a line whose
  // own write succeeded is lost to a fault that happened before it. Opening
  // with the delimiter establishes the boundary before any payload, which no
  // later failure can retract. `readLedger` ignores the blank first line.
  const write = (line) => appendFileSync(path, `\n${JSON.stringify(line)}`);
  return {
    path,
    header: (envelope) => write({ kind: 'header', envelope }),
    // **A hole is DECLARED rather than left to be inferred.** If the full line
    // cannot be written, a far smaller one naming the commit is attempted — an
    // `ENOSPC` provoked by a 256KB entry may well not recur for 80 bytes. That
    // matters because without it a missing entry is ambiguous in a way nothing
    // downstream can resolve: recovery cannot tell a commit the run never
    // reached from one it settled and failed to record.
    //
    // **It carries the SHA and nothing else about the entry.** Recording the
    // outcome would make the line larger, working against the only reason it
    // might survive — and it would put a fact on disk that the rest of the
    // system then has to describe, when what this line means is precisely
    // "the record for this commit was lost".
    //
    // It is written through the same leading-newline `write` as everything
    // else, which is what keeps it independently parseable after a part-written
    // entry — see that function.
    //
    // **The original error is RETHROWN either way.** Writing the gap records
    // the hole; it does not make the append have succeeded, and swallowing it
    // here would silence `runSweep`'s one-warning-per-failure and make "the
    // sink write succeeded" mean "a gap was written instead".
    entry: (entry) => {
      try {
        write({ kind: 'entry', entry });
      } catch (error) {
        try {
          write({ kind: 'gap', sha: entry.sha, why: String(error?.message ?? error) });
        } catch { /* the storage is refusing everything; the throw below is all that is left */ }
        throw error;
      }
    },
  };
}

/**
 * Everything about a run that is known before any of it has happened.
 *
 * **It lives beside `readLedger` because the header IS the recovery contract**:
 * what a crashed run can still be described by is exactly what this function put
 * on the first line, so the writer of that shape and its reader sit in one file
 * rather than drifting apart in two.
 *
 * The same object is reused verbatim for the final record, so a completed run
 * and a recovered one cannot disagree about what the run was. The only fields
 * NOT here are the three a crash destroys — `stoppedBecause`, `endedAt`, the
 * entries — which is why `recover-sweep.mjs` supplies those explicitly rather
 * than inferring them.
 */
export function envelopeFor(options, commits, startMs) {
  return {
    startedAt: new Date(startMs).toISOString(),
    requestedModel: options.model ?? null,
    // The operator's own annotation of what the record cannot probe — the
    // server-side reasoning/thinking/temperature defaults no API exposes.
    note: boundNote(options.note),
    maxSeconds: options.maxSeconds,
    // The threshold the health section states. Without it a reader is told a
    // streak reached two and has no idea whether that was nearly an abort.
    abortAfter: options.abortAfter,
    // The review-request knobs that change what the model was actually asked,
    // recorded so one sweep can be told apart from another: `diffOnly` is whether
    // whole files rode alongside the diff, `maxAttempts` the retry ceiling, and
    // `provider` the server profile (a label, never the URL — a `base-url` can
    // carry a credential and is deliberately kept out of the header). A ledger
    // written before these existed simply omits them. **`provider` is null when a
    // `--base-url` override is in force**: the override wins over the profile's
    // endpoint, so the label no longer identifies the server, and recording it
    // would let two runs on different overridden endpoints read as the same one —
    // null instead reads as a disclosed "unverifiable endpoint" caveat downstream.
    diffOnly: options.diffOnly,
    maxAttempts: options.maxAttempts,
    provider: options['base-url'] ? null : (options.provider ?? null),
    // The repo actually swept — `null` when the caller didn't record one (e.g.
    // `recover-sweep.mjs`'s own synthesized envelope), never assumed to be this
    // tool's own — without it, a foreign --repo run's ledger, record and
    // report carry commit SHAs and subjects with no repo attribution.
    repo: options.repo ?? null,
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
    // The MANIFEST, not merely the count, and that is what makes a recovered
    // report honest: from counts alone the header would say "enumerated 40,
    // reviewed 2" while the coverage section, reading the entries it was handed,
    // concluded "every enumerated commit was reviewed". Recovery needs the
    // IDENTITY of the 38 to dispose of them.
    commits,
  };
}

/**
 * A cap on the operator note, so a pasted essay cannot bloat the record; the cut
 * is marked rather than silent, the same posture `sweep-outcome.mjs`'s `MAX_RAW`
 * keeps for a captured reply.
 */
export const MAX_NOTE = 2000;

/**
 * The operator's free-text annotation for a run — the one place a fact the record
 * cannot probe (a server set to `xhigh` in the UI) can be recorded by hand.
 * Bounded, and deliberately never echoed into a `UserError` message or the CLI
 * envelope: it stays on the bench record alone, off `jobs.db`.
 */
export function boundNote(note) {
  if (note === undefined || note === null) return null;
  const text = String(note);
  if (text.length <= MAX_NOTE) return text;
  // Keep the whole result — marker included — within MAX_NOTE, and never leave a
  // lone high surrogate at the cut: slice by UTF-16 units, then back off one unit
  // if the last is the leading half of a pair (the shape `trimReasoning` uses).
  const marker = '… [note truncated]';
  let head = text.slice(0, MAX_NOTE - marker.length);
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head + marker;
}

/**
 * An envelope only if it can actually serve as one.
 *
 * **The MANIFEST is what is checked, not merely the type**, and the difference
 * is the difference between a loud failure and a silent wrong answer. An array
 * envelope crashes the renderer on `include.join` — bad, but it fails. A plain
 * object with no `commits` does something worse: `mergeManifest` maps over an
 * empty list, and recovery renders a confident report saying *enumerated 0,
 * reviewed 0, none reported by a completed review* over a ledger holding
 * settled entries — findings included. Measured, not reasoned: the real CLI was
 * run against exactly that ledger and printed "Recovered 2 of 0".
 *
 * Anything else is `null`, which leaves `main`'s existing refusal to fire.
 */
function envelopeOrNull(envelope) {
  const usable = typeof envelope === 'object' && envelope !== null && Array.isArray(envelope.commits);
  return usable ? envelope : null;
}

/**
 * Read a ledger back, tolerating the one way it can legitimately be malformed.
 *
 * A line that will not parse is DISCARDED AND COUNTED, never thrown on: this is
 * read by the tool whose entire job is salvaging an interrupted run, and one
 * that refuses to open a damaged file has abandoned its post at exactly the
 * moment it was needed.
 *
 * **A malformed line can appear ANYWHERE, not only at the end.** A caught write
 * fault leaves a fragment mid-file by design, so the count is reported rather
 * than summarised as a boolean — the number of holes is a fact a reader needs,
 * and their position is not something this module can characterise.
 *
 * A missing header is reported as `null` rather than defaulted. The envelope is
 * the run's identity — which revision, how many commits, which model — and
 * inventing one would produce a confident report about a run nothing knows the
 * shape of.
 */

export function readLedger(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '');
  let header = null;
  const entries = [];
  const gaps = [];
  let discarded = 0;
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      discarded += 1;
      continue;
    }
    if (parsed?.kind === 'header' && header === null) {
      header = envelopeOrNull(parsed.envelope);
      // A header-shaped line carrying an unusable envelope is DISCARDED, not
      // silently accepted as the run's identity — otherwise `main`'s "no header"
      // refusal never fires and the damage surfaces much further downstream.
      if (header === null) discarded += 1;
    } else if (parsed?.kind === 'entry' && parsed.entry) entries.push(parsed.entry);
    else if (parsed?.kind === 'gap' && parsed.sha) gaps.push(parsed);
    else discarded += 1;
  }
  return { header, entries, gaps, discarded };
}
