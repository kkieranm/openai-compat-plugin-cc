ARCHIVE — not the current spec; the plan beside it is
# OAI-132 + OAI-140 (recording half): the sweep writes as it goes, and says when the server was unwell

provenance: harness slug sorted-leaping-dijkstra

## Context

`bench/review-sweep.mjs` is an unattended overnight harness. Its last full run took **8h22m and wrote
its first and only byte of output at the very end** — `writeSweep` runs once, after the loop, and
`runSweep` holds every settled commit in a local array until then. A crash, a panic or a kill at hour
eight loses all 40 commits: not degraded, gone. Two sessions have had to reason about liveness from
`ps` alone, and one misread a stalled log tail as a dead job. The per-commit cap was raised 900s →
1800s, which doubles that unwatched window. That is OAI-132.

Riding with it is OAI-140's recording half. The consecutive-outage counter that drives `--abort-after`
is zeroed by any non-outage review, so an outage interleaved with slow commits never trips the abort —
and **nothing records the counter's history**, so last night's "20 deadline-timeouts, zero aborts"
cannot distinguish *no outage occurred* from *outages occurred and kept resetting the streak*.

The intended outcome: a run that dies at hour eight leaves a readable report of what it had settled,
and a run that finishes says what the server did to it.

**Out of scope, deliberately.** Nothing on the request path — no salvage-on-loss (OAI-138), no reserve
change, no cap change. OAI-141 measured run-to-run spread (17 vs 22 finding-bearing commits on
identical inputs) *above* the config differences being compared, so touching the request path would
change what tonight's numbers mean and break comparability with the four prior sweeps over this
corpus. This change touches only the recording path. OAI-123 (the deadline's non-monotonic clock) is
untouched.

## Grill decisions (settled with the user, not open)

1. **Recovery is a separate CLI**, not auto-recovery on next start and not "read the JSONL by hand".
2. **The ledger is a log**: written every run, no flag, and it persists after a successful run. No
   delete-on-success, no superseded-marking ceremony.
3. **No SQLite today.** A cross-run history DB is a real want (OAI-141 is its justification) but it is
   a different question, and ADR 018 gates `node:sqlite` as a capability — a hard dependency would
   make tonight's crash protection conditional on exactly the capability the job store was careful to
   keep optional. Filed as residue.
4. **The streak is derived, not stored.** Storing a counter creates a second representation of a fact
   the entries already hold. What the record genuinely cannot reconstruct is *when* anything happened —
   entries carry only `seconds`, a rounded duration. So record the timeline; derive the streak.
5. **The report prints a health line computed from the timeline.** Deriving is only worth something if
   something derives.

## Design

### The ledger — `bench/lib/sweep-ledger.mjs` (new)

Append-only JSONL beside the final artifacts, at `<outDir>/review-sweep-<stamp>.ledger.jsonl`.

- `openLedger(outDir, stamp)` → `{ path, header(envelope), entry(e) }`. Each call is one
  `appendFileSync` of `JSON.stringify(...)` + `\n` — a fresh fd, `O_APPEND`, synchronous, before the
  next review starts. `execFileSync` per commit means there is no event loop to flush on and SIGKILL
  gives no drain chance, so buffering is the one thing that must not happen here. At ~40 lines a run
  the cost is nothing.
- Lines are tagged: `{kind: 'header', ...}` then `{kind: 'entry', ...}`.
- **The header carries the enumerated commit MANIFEST** — `commits: [{sha, subject, eligible}]`, which
  the loop already holds before it starts — not merely the counts. Counts alone cannot reconstruct a
  correct report; see *Recovery* below.
- **No `fsync`, deliberately.** A synchronous write has already reached the kernel, so it survives
  process death and macOS sleep — the failures OAI-132 names. It does not survive a power cut, and the
  residual exposure is a torn final line, which the reader below discards.
- `readLedger(path)` → `{ header, entries, truncatedTail }`. Parses line by line; a final line that
  does not parse is **discarded and reported**, never thrown on.

### `runSweep` — one settlement point, one sink

Today four branches each `entries.push(...)` and one of them also updates the counter. Route all of
them through a single local `settle(entry)` that pushes **and** hands the entry to the sink, so a
future fifth branch cannot forget. The sink is injected alongside `execute` and `now` — the file's
existing seam — and defaults to a no-op, so every current test keeps working unchanged.

Reviewed entries additionally carry `startedAt` / `endedAt` as ISO strings from the injected `now`.
`seconds` stays as it is.

**`startedAt` is the discriminator for "this commit was attempted".** Skipped commits never reach the
executor, so they never get one — which Codex confirmed at probe time is exactly the set that never
touches the outage counter (they `continue` before it). Deriving the streak from the presence of
`startedAt` cannot drift from the loop, because the loop is what sets it. No outcome-name list.

### `main` — header first, stamp from the start

The stamp currently comes from `new Date()` *after* the loop. Move it to `startMs`, so the ledger and
the report it eventually becomes share one stamp and the recovery CLI can name its output from the
ledger's filename. **This is an intentional behaviour change**: artifact filenames become start-time
rather than end-time.

Write the header line before the first review. Every envelope field `writeSweep` needs is already
computable there — `startedAt`, `requestedModel`, `maxSeconds`, `include`, `from`, `requestedCommits`,
`eligible`, `scanLimit`, `walked`, `enumerated` — plus `abortAfter`, added to the envelope so the
health line can state the threshold. Codex confirmed at probe time that the only things not available
before the loop are `stoppedBecause`, `endedAt`, the stamp, and `entries` themselves.

Print the ledger path to stderr at the start, so a watcher has something to `tail` from minute one.

### Recovery — `bench/recover-sweep.mjs` (new)

```
$ node bench/recover-sweep.mjs <ledger.jsonl> [--out-dir DIR]
Recovered 27 of 40 enumerated commits.
Report: .../review-sweep-<stamp>-recovered.md
```

Reads the ledger, reconstructs `{...header, entries}` and hands it to the **existing `writeSweep`** —
never a second renderer, so a recovered report is the same artifact as a completed one.

**Every enumerated commit must still be disposed of exactly once, which is why the manifest is in the
header.** Without it the recovered report contradicts itself: `header()` renders `enumerated` from the
envelope (40) while `coverageSection()` filters the entries it was given (2) and concludes *"Every
enumerated commit was reviewed"*. So recovery merges the manifest against the ledger's entries by SHA,
in enumeration order, and **synthesizes `{...commit, outcome: 'unobserved'}` for every commit with no
entry**. `unobserved` is not in `REVIEWED`, so the existing coverage section then disposes of them
correctly with no renderer change — the only edit is one line in `sweep-report.mjs`'s `WHY` map:
*"the run ended before this commit was settled — the ledger has no entry for it"*.

The two fields a crash destroys are supplied explicitly rather than guessed:

- `stoppedBecause`: *"THE RUN DID NOT FINISH — recovered from the incremental ledger. N enumerated
  commits were never settled and are listed as `unobserved`. Last activity observed at <time>."* Plus
  the torn-tail note when a final line was discarded.
- `endedAt`: **`null`, not the last entry's timestamp.** A crashed run has no end, and putting the last
  observation in a field labelled *ended* asserts something false. `header()` gains a
  `record.endedAt ?? 'not observed'`; the last observed time is stated in `stoppedBecause` above, where
  it can be labelled for what it is. **The zero-entry case is the one this must not fall over on** — a
  kill during the very first review leaves a header and nothing else, and it must render a report
  saying exactly that rather than `ended undefined`.

### The health line — `bench/lib/sweep-health.mjs` (new)

`isOutage` moves from `review-sweep.mjs` into `bench/lib/sweep-outcome.mjs`, whose stated job is
already "what a reply MEANS". That gives the loop and the report **one definition** of an outage
rather than two, which is the only way the report's derivation can be trusted to match the abort
decision the run actually took.

`serverHealth(entries, abortAfter)` replays the counter over entries carrying `startedAt`, in order,
and returns the lines: reviewed count, outages, the abort threshold, how many times a non-outage reset
a live streak, the longest streak reached, and the wall-clock span the outages fell in. Empty when no
commit was attempted.

**It lives in its own module rather than in `sweep-report.mjs`**, which has only ~22 lines of budget
left — adding a derivation there would spend the file's whole remaining headroom on logic that is not
rendering. `sweep-report.mjs` gains only the call and the one `WHY` line above.

### Size

`bench/review-sweep.mjs` is at **exactly 300 of 300** with an empty `ALLOWLIST`, so growth is
impossible without a deliberate extraction — and an allowlist entry is the wrong lever, because
`tests/structure.test.js:70` skips the 60-line **function** ratchet for any allowlisted file, trading a
line budget for the loss of an unrelated guard. Two cohesive stages move out instead:

- `isOutage` → `sweep-outcome.mjs` (70 lines headroom) — needed there anyway, per above.
- `resolveDeadline` → `bench/lib/sweep-window.mjs` (51 lines), which already owns `resolvePin`, i.e.
  which window the sweep looks at.

Both are re-pointed at their import sites, including in `tests/review-sweep.test.js`. New files start
well under budget.

## Files

| file | change |
|---|---|
| `bench/lib/sweep-ledger.mjs` | **new** — `openLedger`, `readLedger` |
| `bench/recover-sweep.mjs` | **new** — the recovery CLI |
| `bench/review-sweep.mjs` | `settle` + sink seam, timestamps, header write, stamp from `startMs`, two extractions out |
| `bench/lib/sweep-outcome.mjs` | receives `isOutage` |
| `bench/lib/sweep-window.mjs` | receives `resolveDeadline` |
| `bench/lib/sweep-health.mjs` | **new** — `serverHealth`, the derived streak replay |
| `bench/lib/sweep-report.mjs` | call the health section; `unobserved` in `WHY`; `endedAt ?? 'not observed'`; `abortAfter` in the envelope |
| `tests/sweep-ledger.test.js` | **new** — ledger + recovery, including the crash test |
| `tests/review-sweep.test.js` | re-pointed imports; sink assertions |

## Phases

1. `sweep-ledger.mjs` + its unit tests (write, read, torn tail).
2. The two extractions, re-pointed imports, suite green — a pure move, no behaviour change.
3. `settle` + sink + timestamps in `runSweep`; `main` writes the header; stamp from `startMs`.
4. `recover-sweep.mjs` — manifest merge, `unobserved` synthesis, the two renderer lines.
5. `sweep-health.mjs` + `abortAfter` in the envelope + the call from `sweep-report.mjs`.
6. The crash test, its positive control, and the zero-entry case.

## Verification

Repo `verify` skill, plus `npm test` (`zsh` required on PATH — the suite fails loudly without it).

**The check that actually matters is a real crash, not an injected-sink call count.** Asserting a sink
was "called 3 times" is this repo's signature failure — a check that cannot fail on the thing at stake.
Instead `tests/sweep-ledger.test.js` spawns a child (async — never `spawnSync`, per the repo footgun)
that drives `runSweep` with a fake executor and a **real** ledger against a temp dir, and `SIGKILL`s
itself partway through the third commit. The parent then:

1. reads the ledger and asserts the header plus the two settled entries are on disk;
2. runs `recover-sweep.mjs` over it and asserts the report names those two commits, states the run did
   not finish, and lists the rest as `unobserved` — with the header's own counts agreeing with the
   coverage section rather than contradicting it.

**Positive control, in the same run:** an otherwise identical child, killed identically, whose ledger
is created and whose header is written but whose **per-entry writes are suppressed** — recovery over
that ledger recovers zero commits. That isolates the thing under test (the write at each settlement
point) rather than the module's existence; a control that simply omitted the ledger would prove only
that a file absent is a file absent.

A **zero-entry** case is covered too: a child killed during the first review, recovered, must produce a
report saying so rather than throwing or printing `ended undefined`.

**Mutation check** on the key invariant — *every settled entry reaches disk before the next review
starts*. Mutate `settle` to buffer and write at the end, prove the mutation landed with
`~/Code/dotfiles/tests/mutation-landed.py`, run the suite, name the failing test, restore, re-run
green, and prove the restore by `diff` against the backup.

## Docs

ADR (next free number in `adr/`) on the incremental record: why append-only JSONL over SQLite, why no
`fsync`, why the streak is derived rather than stored, and why recovery goes through `writeSweep`
rather than a second renderer. One present-tense line in `CLAUDE.md` naming `openLedger` and linking it.

## Risks

- **Stamp semantics change** from end-time to start-time. Stated above; nothing reads these filenames
  programmatically (the probe found no reader of a written record anywhere in the repo).
- **Ledger size.** `classify` keeps up to `MAX_RAW` (256KB) of stdout *and* stderr per entry, so a
  pathological night could write ~20MB of JSONL. `bench/results` is gitignored. Accepted, not fixed —
  bounding it would mean the ledger holding less than the record it must reconstruct.
- **A torn final line loses one entry.** The alternative is `fsync` per commit; judged not worth it
  for the failures OAI-132 actually names.
