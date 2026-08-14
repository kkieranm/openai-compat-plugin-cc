## 2026-08-14 — OAI-64 closed (`dd35df8`)

- **OAI-64** — **`/oai:status` now names the row that is actually starving you.** Closed 2026-08-14 by
  `dd35df8`, after five review passes and eleven plan-gate rounds. Plan:
  [`plans/oai-64-the-blocker-is-relational.md`](plans/oai-64-the-blocker-is-relational.md),
  dual-approved pre-build and again mid-build, both archives beside it.

  **What shipped.** `job-queue.mjs` exports `scanQueued`, the single definition of the queue's head, and
  `decide` dispatches on it. `job-view.mjs` `blockingSeqFor` walks `decide`'s two rungs read-only — a
  non-dead running row, else that head — and names one FOREIGN row when this workspace holds a queued
  job that is live or still inside its startup grace. `job-render.mjs` flags it with a NECESSARY
  condition: *must clear before this workspace's queued job can proceed*, which never promises yours
  runs next.

  **Three findings worth keeping, each proved rather than argued.**
  1. *This item's own diagnosis was incomplete.* It said blocker-ness is decided by `queuedRole`, which
     returns `blocks` for the pathological shapes. But an ordinary live known-version queued row returns
     `head` and still blocks everyone behind it via `decide`'s `seq` comparison — and the reproduction
     recorded in the item **is** that ordinary case. A fix built on the enumeration would have passed a
     test drawn from the item's own transcript while hiding the commonest blocker there is.
  2. *The first implementation committed this item's own defect.* It consulted the queued rung alone, so
     with a live running row it marked a queued job that clearing would not help, while the row actually
     holding the queue sat unmarked below it. Found at review pass 2, reproduced by execution, then fixed.
  3. *The witness rule was narrowed during review.* A local queued row with no waiting process — dead,
     never-started, malformed — no longer counts as evidence anyone is starved, because for such a row
     the flag's sentence is false rather than vacuously true. The superseded justification ("`decide`
     blocks it too, so excluding it would disagree with the queue") was unfalsifiable: those rows never
     call `decide` at all.

  **Evidence.** 891 tests pass, against 871 at the baseline. Nine mutation controls fired across the
  run, each caught by the test written for it — head-sort inversion, witness-comparison inversion,
  running-rung removal, `isKnownVersion` refusal deleted, local-head guard deleted, eligible-witness
  gate deleted, `scanQueued`'s `onSkip` deleted, `ORDER BY seq` deleted, `decide`'s state guard deleted.
  The `ORDER BY` one was undetectable until `PRAGMA reverse_unordered_selects` was used, since rowid
  order already matches `seq` order. Also driven through the real plugin against a seeded queue.

  **Dismissed, by the owner's decision:** the flag is not linearizable with the queue, because the
  display reads outside a transaction. `BEGIN IMMEDIATE` is impossible on the read-only connection,
  would not cover the OS pid probes the display also depends on, and would make every `/oai:status`
  contend for the queue's write lock against workers polling every 300ms. Internal consistency already
  holds — the whole report derives from one atomic `SELECT` — and no wrong-kill path exists, since
  `requestCancel` is state-guarded and a stale flag matches zero rows.

  **Residue:** OAI-160 here; process items 161 and 162 in `~/Code/backlog`. OAI-69's gating condition
  is discharged — re-read it.

## 2026-08-13 — closed by the backlog sweep, each verified against disk (OAI-33, OAI-84)

- **OAI-33** — **`plans/README.md` was missing.** Closed 2026-08-13 by the backlog sweep, which
  **verified the file exists on disk** rather than taking it off a commit message. The `/feature` skill
  points at it for naming, collisions and provenance; it is there. No code change was needed and none
  was made — this entry records that the gap closed at some point between the filing and the sweep.

  *Original filing, kept because it is the record of what was wanted:*

  - **OAI-33** — Write `plans/README.md`, which the `/feature` skill already points at and this repo
    does not have. Filed 2026-08-02, noticed while filing OAI-26's plan. The skill says naming,
    collisions, the `draft`/`final` distinction and provenance "live in `plans/README.md`" — so the
    one place those rules are supposed to be written down is missing here, and six plans have been
    written without them. In practice a convention has emerged and should just be recorded rather than
    invented: `oai-NN-slug.md`, one per item, occasionally spanning two IDs where the work was
    (`oai-20-21-survive-the-server.md`). Worth stating explicitly: a plan is **not** rewritten when
    review refutes it — OAI-26's carries a dated correction block at the top and leaves the refuted
    text in place, because the plan is the record of what was believed at the time, and that is the
    convention the next one should follow. Housekeeping, so it sits down here; it costs one short file.

- **OAI-84** — **Two ways `/oai:review` threw away an answer the model gave it, on the default path.**
  **Both repairs SHIPPED and VERIFIED on disk 2026-08-13** by the backlog sweep, independently of the
  entry's own claim to have shipped:
  **(a)** `scripts/lib/structured.mjs:202` now builds `const channels = structured ? [content, reasoning] : [content];`
  and tries each channel in turn, replacing the pre-parse ternary that buried a valid payload in
  `reasoning` when one stray character sat in `content`.
  **(b)** `scripts/lib/structured.mjs:242` wraps a bare top-level array —
  `Array.isArray(parsed) ? { findings: parsed } : parsed` — so a reply of `[{...}, {...}]` is no
  longer discarded. Both sites carry comments recording the old behaviour as a fixed defect.
  **The item did NOT close as a whole, and this is the honest split.** Its ladder ended at its terminal
  pass without dual approval, and the candidate-selection design it grew is under a partial plan
  withdrawal that the user adjudicated PARTIAL on 2026-08-07. That remainder **could not close
  independently** of the replacement, so it merged into **OAI-112**, which now carries it; OAI-84's ID
  redirects there. Its two live sibling defects stay separately filed as **OAI-113** (quadratic scan)
  and **OAI-114** (a primitive sibling discarding a whole findings list), both re-verified STILL TRUE
  by this sweep.

  *Original filing, kept in full because its evidence is the record:*

  - **OAI-84** — **Two ways `/oai:review` throws away an answer the model gave it, on the default path,
    and reports the throw-away as "no findings in the requested shape".**
    **STATUS 2026-08-07 — BUILT AND SHIPPED, ladder ended WITHOUT approval, item stays LIVE and is
    BLOCKED on the user.** Both repairs landed and were independently audited (commits through
    `674cf49`, suite 692/0 verified in a committed copy, verify skill all three steps including a
    CLI-level before/after control). The six-pass review ladder then ended at its terminal pass with
    **both approvers returning `CHANGES-REQUIRED`**, and raised a partial plan withdrawal against the
    candidate-selection design — filed as **OAI-112**, which the user must adjudicate part-versus-whole
    before any replacement is planned. Two live defects the ladder found are filed separately and are
    fixable without waiting for that decision: **OAI-113** (quadratic scan, measured 39s end-to-end) and
    **OAI-114** (a primitive sibling discarding a whole findings list, a regression from base). Do NOT
    mark this done: what it was filed for works, but the design it grew is withdrawn.
    The register row is `84-two-ways-a-reply-is-thrown-away` (exit_mode `withdrawn`, 16 filed at exit). **Split out of OAI-13 on
    2026-08-05 by the backlog sweep**, which verified against disk that these two stopped being what
    they were filed as. They were filed 2026-07-27 from the OAI-4/OAI-10 built-in review as
    vendor-dependent behaviour of a *degraded* path — untestable here, waiting for a second server. OAI-51
    then made the unconstrained prose-parse path the **default** (2026-08-04), and the default runs the
    same `parseFindings`. So neither needs a second server any more, and both are reachable on every
    ordinary review this plugin now performs.

    **(a) The channel is picked before the parse, and there is no fallback.**
    `scripts/lib/structured.mjs:265` — `const text = structured && !content.trim() ? reasoning : content;`
    — chooses one of `content` / `reasoning_content`, and `extractJson` then tries only that text. One
    stray non-whitespace character in `content` discards a valid payload sitting in `reasoning`. Verified
    2026-08-05 as applying **regardless** of `structuredOutput`, so the schema flip did not narrow it.

    **(b) A bare top-level findings *array* is discarded**, though the adjacent comment promises repair.
    `scripts/lib/structured.mjs:269` —
    `if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.findings)) return null;` — so a
    reply of `[{...}, {...}]` fails the object test and returns null. Under a grammar this was a
    degraded-path curiosity; under prose instructions, "emit the findings" answered with a plain array is
    an *ordinary* thing for a model to do, which makes this the most likely candidate for a review that
    found something reporting nothing — a candidate, not a measurement; see the next-but-one paragraph.

    **Why this outranks the vendor items it was filed with.** Both render as trap instance 14 — the
    `findings: null` versus `[]` distinction that [ADR 003](adr/003-structured-findings.md) exists to
    protect. The distinction itself is intact and test-pinned (`tests/review-json.test.js:83`), which is
    precisely what makes this worth fixing: the plumbing correctly reports "unparseable", and the parser
    is calling things unparseable that are not. The user sees an honest message about a dishonest verdict.

    **Not yet measured, and say so rather than guess.** How often either fires on the current default is
    unknown — no run has been instrumented for it. The 2026-08-04 whole-tree run that returned **0
    findings** with `parsed: true` is *not* evidence for this item (it emitted content and genuinely found
    nothing), and must not be recruited as such. The cheap instrument is to log the raw reply whenever
    `parseFindings` returns null and read a handful; the cheap fix for (b) is to accept an array and wrap
    it, which the comment already says was intended.

    **Sequencing.** Before **OAI-19**, or the baseline measures a parser that is about to change — this
    is the same argument OAI-51 made for suspending that run, one layer down. Cheap enough that it should
    not delay anything: (b) is a few lines, (a) is a try-the-other-channel fallback.

## 2026-08-13 — the sweep writes as it goes, and says what the server did to it (OAI-132, OAI-140 recording half)

- **OAI-132** — **An overnight sweep emitted NO signal until it ended, so a crash lost the whole
  night.** Shipped 2026-08-13, commit `223136e`. 870 tests green, measured in a fresh clone of the
  committed tree rather than the working tree.
  Each settled commit now reaches disk immediately, in an append-only JSONL ledger beside the artifacts
  it will become (`bench/lib/sweep-ledger.mjs`), and `bench/recover-sweep.mjs` turns an interrupted
  ledger into the report the run never wrote — through the same `writeSweep` a completed run uses. The
  header carries the enumerated **manifest**, not counts, which is what stops a recovered report saying
  *"enumerated 40 · reviewed 2"* above *"every enumerated commit was reviewed"*. See
  [ADR 022](adr/022-a-record-written-while-the-run-is-happening.md).
  **Two decisions worth not relearning.** Records are written LEADING-newline-first, because a
  terminated record that fails part-way leaves a fragment the next *successful* append fuses onto,
  losing a line whose own write succeeded. And because `settle` guards the sink so a recording fault
  cannot cost review coverage, a missing entry became ambiguous — hence `unobserved` (never reached, or
  settled and lost, and the ledger cannot tell which) versus `unrecorded` (a `gap` line proves it
  settled and the write failed). Reporting either as "never settled" would have been false precisely
  because the harness defended against a failing disk.
  **Verified by a real crash**, not an injected sink counting calls: a child drives the real `runSweep`
  against a real ledger and SIGKILLs itself mid-loop, with a positive control that writes the header
  and suppresses only the per-entry writes. Also run live end to end against LM Studio.
  **The review ladder ended `terminated`, not dual-approved** — Codex approved; the Claude verdict-only
  subagent returned CHANGES-REQUIRED on ADR 022 naming the wrong file for the crash test. Both that and
  a second nit were corrected before the commit, at the user's direction, without a further verdict
  round. Recorded because the register says `terminated` and the reason belongs beside it.

  *Original filing, kept because it is what priced the work:*

  - **OAI-132** — **A two-hour sweep arm emits NO signal until it ends.** Filed 2026-08-09 from running
    the matrix. `writeSweep` runs once, after the loop, so an arm in progress is observable only as a
    live pid and a SHA in `ps`; a healthy run and a doomed one look identical from outside for hours.
    The fail-fast covers an outage, not "is this producing anything useful". Observed directly: arm 1 ran
    2h13m with no readable output, and the four aborted gemma arms were only diagnosable afterwards.
    **For a harness whose whole purpose is running unattended, that is the wrong end of the trade.**
    Fix shape: append each entry to the record as it settles, or emit one progress line per commit.
    **PRICED 2026-08-10 by a full overnight run**, which is why this is no longer a nuisance item.
    `sweep-2026-08-09-overnight` ran **8h22m** (2026-08-09 20:39 → 2026-08-10 05:01 BST) and wrote its
    first and only byte of result at the very end. Confirmed by reading the code, not inferred from the
    silence: `review-sweep.mjs` has **exactly three** `stderr.write` sites — the opening enumeration
    line, the closing report paths, and the error handler. **Nothing per commit.** So for 8h22m the
    only observable was a live pid and `lms ps` reporting `GENERATING`, and **had the machine slept or
    the process died at hour eight, all 40 eligible commits would have been lost with no partial
    record** — not degraded, gone. Two sessions have now had to reason about liveness from `ps` alone,
    and one of them (2026-08-09) misread a stalled log tail as a dead job. The append-as-settled fix
    shape is the one to take: a progress line helps a watcher, but only an incremental record survives
    the crash that makes the silence expensive.

## 2026-08-13 — the worker confirms its own cancellation, and a crash stops reading as one (OAI-66)

- **OAI-66** — **Two reconciler diagnoses that contradicted the row they were written from.** Shipped
  2026-08-13, commit `e966c95`, direct to `main`. 820 tests green, measured from a clean extract of the
  commit rather than the working tree.
  **(a)** `terminalizeDead` treated any pending `cancel_requested_at` as proof the cancellation
  completed, so a worker that CRASHED with a cancel in flight was published as a clean `cancelled` with
  `failure=null` and no rendered note. Now the exiting worker announces itself in `<seq>.cancel-ack`
  beside its job log, bearing the row's id, and the reader splits on the row's own state: a `queued`
  row reads `cancelled` needing no evidence (acquisition is what makes a row `running`, so it provably
  sent nothing), a `running` row only on a present, id-matching acknowledgement, and otherwise `failed`
  / `cancel-unconfirmed`.
  **(b)** `terminalizeUnstarted` blamed the submitter for a crash it could not establish. The draft's
  fix — condition the hint on `spawned_at` — was **refuted during the probe**: OAI-67 had made a NULL
  `spawned_at` possible while a real worker exists, so it would have replaced one false claim with
  another. The hint now scopes its ignorance to itself and points at the log.
  **A file, not a row, and beside the log rather than in it.** A terminal row would clear the `running`
  blocker and let the queue dispatch before the process reached `process.exit()`; and the log carries
  model output via `SALVAGED_OUTCOME`, so a verdict that SUPPRESSES a crash diagnosis must not rest on
  bytes the model could author. The read runs inside the queue's `BEGIN IMMEDIATE`, so it opens
  `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`, bounds the size, and never throws.
  **Carried in the same change:** retention sweeps the acknowledgement with the log, keys its orphan
  scan on the union of both names and admits only sequences it can address again; `/oai:status` stops
  promising a cancelling job "reads cancelled once its worker has exited"; and three hints stop
  asserting what they cannot establish.
  **Live evidence**, LM Studio `qwen/qwen3.6-27b`, both directions: a cooperative cancel reads
  `cancelled` with the acknowledgement on disk; a SIGKILL with a cancel pending reads `failed` naming
  the ambiguity. Before this, that second run was a clean `cancelled` with no note.
  **Review:** three ladder passes, three batches, one verification-only pass, three verdict rounds.
  Nine mutations, eight discriminating; M7 was RETIRED rather than passed after measurement showed the
  term it tested could never decide anything. **Committed on the user's approval, not on dual approval**
  (`adr/088`): round 2 split — Codex approved while an independent Claude subagent caught an
  "exactly equivalent" claim that was false and self-contradicting across two adjacent ADR lines — and
  round 3 rejected on the status-line promise, whose fix no approver has seen. Every pass carried a
  coverage gap: `security-review` cannot run in this repo.
  **Residue filed rather than built:** OAI-149 (bind the orphan-sweep key to a store incarnation) and
  OAI-150 (repair or refuse an inherited state-directory permission chain), both cleared by both
  approvers as bounded deferrals, with the shipped artifacts stating their residuals.
  Full ledger: `plans/oai-66-the-worker-confirms-its-own-cancellation.ledger.md`.

## 2026-08-12 — a failed launch stops holding the queue, and housekeeping stops sinking live submissions (OAI-67)

- **OAI-67** — **A failed spawn blocked the whole queue; post-spawn write failures reported failure
  while the worker ran on.** Shipped 2026-08-12, commit `9883f7f`, on branch
  `oai-67-spawn-failure-must-not-hold-the-queue`. Three fixes, all one defect class — the submitter
  asserting more about a worker than it can observe:
  **(a)** an unconfirmed launch now terminalizes its own row via `abandonUnstarted`'s
  `state = 'queued' AND waiter_pid IS NULL` compare-and-set, so the 120s startup grace no longer
  blocks every successor. The CAS rather than `finish` is the whole design: a rejection does NOT prove
  no child exists, since `spawnWorker` closes its log descriptor AFTER the `'spawn'` event fires.
  **(b)** the retention sweep moved before `insertJob`, so a non-busy sweep failure can no longer sink
  a submission whose worker may already be spending.
  **(c)** the row stamp now reports ANY storage fault and still returns the id — with the report
  itself guarded, since a throwing stderr would lose the id it was announcing.
  Five review passes, 26 accepted findings, four batches, dual approval on digest `ad3dc1daf058`.
  810 tests green; nine mutations re-run after every batch; live round trip against LM Studio.
  **What was deliberately NOT done here, and why it is not residue but scope:** the root cause in
  `job-spawn.mjs` is **OAI-145** (the user chose containment over enlarging this change), the
  liveness overclaims in pre-existing text are **OAI-146**, and a structural-guard blind spot found
  during the review is **OAI-147**. **OAI-108 was amended rather than fixed** — this change ENLARGED
  it: a `--json` caller now sees ordinary success after a corrupt-database submission that previously
  rejected. That trade was put to the user with both my recommendation and Codex's, and chosen
  knowingly.

## 2026-08-09 — the load hints stop predicting an outcome the plugin cannot control (OAI-134)

- **OAI-62** — **The `SQLITE_BUSY` property does not hold at two sites, and one of them kills live work.**
  OAI-52 item (3) recorded "a `SQLITE_BUSY` expiry is retried, never terminalized" as an untested
  property. It is not merely untested; it is **false in two places**, and this item supersedes that
  sub-item.
  **(a) The heartbeat kills the worker outright.** `job-heartbeat.mjs:57-60` calls `beat` and
  `cancelRequested` inside a `setInterval` callback with **no try/catch**, and `job-record.mjs:176` and
  `:207-209` are bare `db.prepare(...).run(...)` with no busy retry. **Proved by execution**:
  `startHeartbeat` with a handle whose `prepare()` throws "database is locked" (errcode 5) kills the
  process — exit 1, the probe's "SURVIVED" line never printed. So a contended database kills a running
  worker **mid-model-call**. ADR 014 (~296) itself notes a suspended process holds the writer lock
  until other writes fail past the timeout, so the contention it needs is a case the design already
  anticipated.
  **(b) `finish` discards a completed answer.** `cmd-task-worker.mjs:74` calls `finish` with no busy
  retry, unlike queue acquisition which has one (`job-queue.mjs:111`). If the lock is held past the
  10s timeout **after the model has already answered**, the outer catch files a storage error as a task
  failure and the expensive answer is gone.
  The catch added for (a) must be **narrowed to busy** — a blanket swallow would hide real corruption,
  and the stale-beat → `stalled` → non-terminal path already handles a missed beat correctly.
  **(c) `openStore` itself can throw `database is locked`, at the line whose comment says it cannot.**
  Observed **once, live**, during the OAI-58 commit gate: `tests/queue.test.js:23` ("two jobs submitted
  at once run one after the other, never together") failed with
  `Error: database is locked at openStore (job-store.mjs:151)` — which is
  `db.exec('PRAGMA journal_mode = WAL')`, the statement immediately after `busy_timeout` is set. The
  comment at `:145-149` argues that setting `busy_timeout` **first** is what stops exactly this ("with
  no timeout in force yet a second process opening the store at the same moment fails outright…
  Every statement after this line waits instead"). It does not, at least not always: converting to WAL
  needs an exclusive lock, and the busy handler is not honoured for every such case.
  **Rate and trigger, stated honestly rather than inflated.** It did not reproduce: 8/8 green running
  `tests/queue.test.js` alone and 3/3 green on the full suite afterwards. The one occurrence was
  almost certainly two full `npm test` runs overlapping on this machine, which widens the window — a
  real contention scenario (two plugin commands at once produce the same thing), but not one the suite
  normally creates. **So this is a genuine intermittent whose rate is unmeasured**, and the value here
  is the located line plus a comment that overstates its guarantee, not a frequency.
  **Second occurrence, 2026-08-05, and it confirms the hypothesised trigger.** Seen during OAI-5's
  mutation testing, at the same line: `Unexpected failure: Error: database is locked at openStore
  (job-store.mjs:151)`, this time surfacing through `submitTask` (`task-submit.mjs:93`) rather than
  the queue test. It happened while two `npm test` invocations genuinely were overlapping — which is
  exactly the condition the paragraph above guessed at, so **the trigger is now observed rather than
  inferred**. Still unmeasured as a rate, and still indistinguishable from a real regression when it
  fires.
  **Third occurrence, 2026-08-05, during OAI-5's pass 8 audit — and it lands back on the ORIGINAL
  site.** `tests/queue.test.js:23`, the same test as the first sighting, again `database is locked`,
  again under concurrent runs, and green on the two runs either side of it. Three sightings, two
  distinct call sites (`openStore` via the queue test, and via `submitTask`), one trigger. That is
  enough to stop calling it unexplained: **the mechanism is contention on `PRAGMA journal_mode = WAL`
  during open, exactly where the comment at `job-store.mjs:145-149` claims the preceding
  `busy_timeout` makes waiting universal.** What remains unmeasured is the rate.
  It also means the suite carries a rare flake whose failure message is indistinguishable from a real
  regression — worth a targeted retry at this call site so a contended open waits rather than killing
  a submission.
  **STATUS, 2026-08-07 — built, committed, and NOT closed: the ladder ran its full ten passes and
  ended `cap-without-approval`.** (a), (b) and (c) are all fixed and shipped —
  `scripts/lib/job-busy.mjs` with `withBusyRetry` at six enumerated sites, the heartbeat and the
  queue's wait loop guarded, the `completed` write moved outside the catch that publishes `failed`,
  and `salvageOutcome` writing the answer to the job log when that write's retry exhausts. Suite
  660/0, verify skill green against a live server, and the design is [ADR 020].
  **What stops this closing is OAI-106.** At the terminal verdict point the Claude approver approved
  and **Codex refused**, on this ground: after an exhausted persistence retry the public lifecycle
  still reports `worker-died` for work that completed, and no product reader can recover the salvaged
  answer — a false terminal state produced by contention, which is one of the outcomes this item
  exists to remove. `salvageOutcome` keeps the bytes; it does not correct the verdict.
  **The decision is the user's**: build OAI-106 (a `persistence-pending` state, or a recovery pass
  that reads a salvaged line back into the row) and reopen this, or accept the artifact as shipped and
  close this item over Codex's objection. Also left `unresolved at cap`: [OAI-109] and [OAI-110].
  **CLOSED 2026-08-12 — over the reviewer's objection, deliberately and with both verdicts recorded.**
  The three shipped defects are the ones that destroyed work and they are fixed. What blocked closure
  was the residual: on retry exhaustion the row is never corrected, so reconciliation later publishes
  `failed`/`worker-died` for a job that answered (`job-reconcile.mjs:34-39`), and no command renders
  the salvaged line.
  **Verified before deciding, not taken on the backlog's word**: the answer is NOT unreachable — both
  `/oai:status` and `/oai:result` print the job log path literally and the failure hint already says
  the output is in the log; what is missing is that nothing names the `SALVAGED_OUTCOME` marker or
  renders it. The trigger is `SQLITE_BUSY` past a 10s timeout **after** the model answered, and that
  path's rate is **unmeasured and never observed in the wild** (the three recorded sightings are
  `openStore` contention at a different site, under two overlapping test runs).
  **Both verdicts, unresolved rather than merged.** Codex, asked as an owner-level scheduling
  question, reversed its own ladder refusal: *"A loses because it expands a rare, unmeasured residual
  into a state-machine change that risks creating broader lifecycle defects"* — RECOMMEND B (close).
  Claude agreed on B and added the narrowing that made it defensible: the defect Codex named is a
  **false sentence**, not a missing state, so OAI-106 was re-scoped to separate its cheap half (stop
  asserting "exited without recording an outcome" when a salvage line exists — no new state) from its
  expensive half (a `persistence-pending` state). The user decided.
  **Left open and tracked, not silently dropped**: OAI-106 (both halves, plus the missing test that
  would let the false terminal state fail), [OAI-109] and [OAI-110], all `unresolved at cap` from that
  ladder.

- **OAI-139** — **When nothing is resident the window is unknown, so the size guard is DISABLED and
  the drop-to-hunks fallback can never fire — a cold start sends untrimmed input.** Filed 2026-08-10,
  found while probing OAI-138 and **distinct from it**: this is a window-detection defect, not a
  wall-clock one, and raising `--max-seconds` cannot touch it.
  **Reproduced by accident, then confirmed in code.** Commit `77c1eab97` was re-run alone on a fresh
  process with `lms ps` empty. It failed in **14 seconds** with `empty-completion` on all three
  attempts, at **`promptChars: 492053`** — roughly **145k tokens against a 61,696 window**. The same
  commit in the overnight sweep, reviewed mid-run with the model already resident, built a prompt of
  **150,056 chars** — **3.3x smaller** — and failed as `deadline-timeout` instead. Same commit, same
  code, same machine; the only difference is whether a model was loaded when the process started.
  **The mechanism, read off the code rather than inferred.** `context-guard.mjs:46-51`:
  `if (!contextLength) return { checked: false, note: 'Context window unknown for …' }`. The guard
  **returns without checking**, so the oversize refusal below it never throws. That refusal is the one
  carrying `reason: 'oversize'` — its own comment calls it *"the one refusal that sending less input
  can fix, so the one a caller may retry smaller"* — and it is what makes a caller drop `changed`
  files and fall back to the hunks. **No refusal, no retry, no dropping.** `contextLength` comes from
  `loaded_context_length` (CLAUDE.md: never `max_context_length`), which is **null for a model that is
  not resident**, so the whole chain is disarmed exactly when a run starts cold.
  **Why it matters beyond one commit.** Every sweep starts with nothing loaded, so its **first**
  review runs unguarded, and any single-commit invocation does too. `adr/005`'s guarantee — *"the reply
  falls back to the diff alone when the window is too small"* — is **unavailable in precisely the
  situation it was written for**. The failure is then attributed to the server (`empty-completion` is
  a documented LM Studio drop shape), which is how it stayed invisible: a client-side sizing bug
  wearing a known server-side symptom.
  **A hypothesis this DISPROVED, recorded so it is not re-run.** The obvious next thought was that
  last night's 20 timeouts were also over-window. **They were not**: measured across all eligible
  entries, the failures' inputs run 7,253-48,583 tokens with **zero above 61,696**. They are 2-3x
  larger than the completions (median 33,071 vs 9,213-15,669) and that is why they are slow, but they
  fit. **OAI-138 remains a time problem; this is a separate size problem.**
  **DECIDED 2026-08-10 (user, Claude and Codex agreeing): do NOT set a per-provider `contextLength`
  as an interim mitigation.** It was proposed and rejected on Codex's reasoning: `delegate.mjs:149`
  lets a configured value override per-model detection **unconditionally**, this profile serves six
  models whose windows were never measured, and `adr/002` records the author removing exactly such an
  override from their own config. Decisively, it would **mask this defect while making the guard look
  armed** — removing the runtime symptom OAI-139 needs to stay observable and preventing an ordinary
  run from ever testing the fallback. **The accepted risk of leaving it unset** is that a cold-start
  first review stays fail-open; that risk is visible and attributable, which the alternative is not.
  **CODEX REVIEW 2026-08-10 — two of the three claims above were overstated. Corrected here.**
  - **Claim A (the guard returns early) — TRUE**, `context-guard.mjs:46`.
  - **Claim B — FALSE AS WRITTEN, narrower version true.** I cited the wrong files: the caller is
    `review-ladder.mjs:47`, not `review.mjs` or `git-diff.mjs`, and the drop happens there via
    `if (error.reason !== 'oversize') throw error;` then a rebuild with whole files off. Other paths
    DO reach the hunks rung independently — explicit `--diff-only` (`git-diff.mjs:219`), and changes
    with no readable body (deletions, binaries, vanished files) — but **none of them drops a populated
    `changed` collection.** So "the fallback is reached only via that refusal" is false; **"an
    oversized whole-file review with an unknown window never drops those files" is true**, and that is
    the defect.
  - **Claim C — FALSE AS UNCONDITIONAL, true for unconfigured LM Studio.** `delegate.mjs:149` resolves
    `contextLength: profile.contextLength ?? windowFor(described, model)`, so **a configured
    `contextLength` still arms the guard** — which is why the note tells the user to set one, and it
    is a real mitigation available today. Detection is also stricter than I said: `model-info.mjs:87`
    requires `state === 'loaded'` **and** a positive integer, not merely a non-null field. And it does
    not generalise: llama.cpp `/props`, TGI `/info` and oMLX report a served window **without**
    residency, so this is an LM-Studio-shaped hole, not a universal one.
  **FIX RECOMMENDED BY CODEX: option 3, as a cap on optional whole-file ENRICHMENT — not option 1.**
  I had favoured assuming a small window; Codex argued the better seam is `target.changed`, which is
  already explicitly droppable, where `target.files` may be the only copy of untracked or `--file`
  content. In `prepareLadder`, build and measure the whole-file candidate and choose the hunks rung
  when it exceeds a named enrichment ceiling **even when `contextLength` is unknown**, keeping the
  existing guard for authoritative refusal when a real window IS available. **This invents no window
  number**, which is the objection to option 1.
  Its stated constraints: never silently truncate an individual file; never apply the cap to
  `target.files`; never turn an oversized irreducible diff into a fabricated context-window refusal;
  set `hunksOnly: true` exactly as the existing fallback does; and **give the ceiling its own name and
  rationale** — `REVIEW_UNKNOWN_WINDOW_TOKENS` is a *reply* budget and must not be reused as an input
  threshold.
  Its risks, as stated rather than as reassurance: on a large but undetectable window it may discard
  whole-file context that would have fit, reducing precision and possibly reviving the false positives
  `adr/005` exists to address; the threshold is a heuristic, not proof of fit; a huge diff or a pinned
  `--file` can still overload an unknown window because those inputs cannot honestly be dropped; and a
  threshold chosen against this 61,696-token machine may age badly across providers.
  Note the interaction with OAI-134: that item established the plugin has **no channel to influence a
  load**, so it cannot ensure residency — it can only notice.
  **PRE-REGISTERED EXPERIMENT, launched 2026-08-10 21:35, thresholds fixed BEFORE the result exists.**
  A `--diff-only` sweep over the same pinned SHA, window, model and 1800s cap as that night's
  whole-file run — `bench/results/oai139-diff-only-2026-08-10/`. Diff-only **is** the rung this item's
  enrichment ceiling would force, so this prices the fix's stated risk (under-enrichment reviving the
  false positives `adr/005` exists to address) before a line of it is written.
  Read against the whole-file baseline of **17 finding-bearing commits of 40 eligible**:
  - **CHANGES THE DESIGN** if diff-only loses **5 or more** of those 17 (~30%) with no credible
    replacement findings. A low blanket ceiling would then be wrong, and the fix needs a higher or
    selective threshold, or a different cold-start sizing mechanism entirely.
  - **CHANGES NOTHING** if **15 or more** of the 17 still produce credible findings with no material
    rise in false positives.
  - **Between those: INCONCLUSIVE, and explicitly not evidence for changing the design.**
  - **A better completion rate on its own changes nothing** — the ceiling is *expected* to improve
    fit, so that result is not informative about the risk being measured.
  **It is a CONSERVATIVE test and its asymmetry is stated:** `--diff-only` strips enrichment from
  every commit, where the ceiling would strip it only above the threshold. So a good result strongly
  de-risks the fix, while a bad one identifies the risk but likely overstates its incidence.
  **RESULT 2026-08-11: INCONCLUSIVE by the letter, and the letter is what counts.** Diff-only kept
  **12** of the 17, **lost 5** (all five going to `clean`, not to fewer findings), and made **7** new
  commits finding-bearing; totals 19 finding-bearing and 35 findings against 17 and 23. Neither branch
  fires: the design-change branch needed 5+ lost **with no credible replacements** and replacements
  exist; the changes-nothing branch needed 15+ kept and only 12 were. Recorded as inconclusive rather
  than argued either way.
  **The result NOT in the thresholds is the one that matters: all five losses became `clean`.** A
  false-clean is this repo's worst outcome shape, and it is exactly the under-enrichment risk. Also as
  pre-registered, diff-only's better completion (39 of 40 vs 36) is **uninformative** here.
  **REPLICATION LAUNCHED 2026-08-11 08:26, design challenged and changed by Codex.** My proposal was
  two more whole-file runs to bound variance; Codex rejected it — that leaves the **diff-only** arm,
  the one whose effect must actually be identified, as a single draw. Running instead **one more of
  each arm**, both at 1800s on the same pinned SHA, **diff-only FIRST** so that any drift with time or
  machine state no longer lines up with the arm as it did before. `lms unload --all` between arms for
  the same cold-start state. Records in `bench/results/oai139-replication-2026-08-11/`.
  **The decision statistic, fixed in advance: EXCESS NON-REPRODUCTION `E`.** Over the original 17
  whole-file finding-bearing commits, let `L` be how many have their credible original finding absent
  in a run; `E = mean(L_diffonly_1, L_diffonly_2) - L_wholefile_2`. **`E >= 5`: reject a blanket low
  enrichment ceiling. `E <= 2`: the loss is ordinary run variation, proceed with the ceiling design.
  Between: inconclusive.** Match **substantive findings**, not merely whether a commit produced any.
  **Total findings and finding-bearing counts are explicitly NOT the decision statistic** — extra
  findings may be false positives and cannot automatically offset lost established ones.
  **REPLICATION RESULT 2026-08-12 — the diff-only concern is REFUTED, and `E` clears the bar.** Of
  whole-file #1's 17 finding-bearing commits, the re-runs were finding-bearing again: **whole-file #2
  kept 12 (absent 5)**, **diff-only #1 kept 12 (absent 5)**, **diff-only #2 kept 14 (absent 3)**.
  **`E = mean(5, 3) - 5 = -1`**, comfortably inside the pre-registered `E <= 2` branch: *the loss is
  ordinary run variation, proceed with the ceiling design.* **The same configuration re-run against
  itself lost exactly as many as diff-only did**, so the five losses that looked like an
  under-enrichment signal were noise from a single draw.
  **The variance is larger than the effect anyone was arguing about**: whole-file's own finding-bearing
  count moved **17 -> 22** between identical runs.
  **A caveat that is NOT a hedge: this is the finding-bearing PROXY, not substantive matching.** The
  full per-commit comparison is committed alongside the records at
  `bench/results/oai139-replication-2026-08-11/substantive-comparison.md` (gitignored directory - the
  numbers here are the durable copy).
  **What the substantive read shows, and it changes the meaning of "absent":** across the 10 commits
  where any run went quiet, "absent" almost never means *the defect was not found*. It usually means
  **a different defect was reported**. `d2396ce08` had its relative-path guard defect found by three of
  four runs; `caa9d85ba`'s `reduce`/NaN defect was found by the baseline and by diff-only #1 in nearly
  identical words. **Only ONE of the 17 - `10b29cbda` - went clean in all three re-runs**, making its
  baseline finding the single best candidate for a baseline false positive.
  **One commit is the exception worth keeping in view**: `f5079538d`'s `coverageSection` exactly-once
  pair was found by **both whole-file runs, in near-identical words, and by neither diff-only run**.
  That is the only per-commit pattern in the set that looks like a genuine enrichment effect rather
  than churn, and it is one commit - not evidence, but the thing to watch if the ceiling ships.
  **Codex's stated failure mode for this design: nonstationary pseudo-replication.** Two sequential
  samples per arm can look stable while power state, thermal load, residency or rare decoding paths
  shift together, and `E` also rests on a human judging whether findings substantively match. A
  decisive-looking answer may reflect one machine-day and one adjudicator.
  **DONE 2026-08-12.** `prepareLadder`'s first rung now requires `windowKnown`, and it returns the rung
  it took plus `skipped: 'unsized-window'` so the report OBSERVES the branch rather than recomputing
  its premise — a design reversal made mid-build after `codex-adversarial` showed the recomputation
  could contradict the request. Verified cold on the reproduction commit: `77c1eab97` now sends 40,139
  prompt tokens and COMPLETES with 3 findings in 1,432s, where on 2026-08-10 it died in 14s at ~145k
  tokens. Deterministic control alongside it: 146,265 prompt chars unsized vs 482,836 with a window
  declared. Mutation-proved after every batch — removing the guard reddens the request-log witness and
  both disclosure tests together. `adr/005` amended; three of its own claims were adjudicated FALSE
  during review and corrected in place with the originals quoted. Ladder: 3 passes, 13 accepted
  findings, terminated early at the user's decision once the implementation was judged stable and the
  remaining findings were all in the prose describing it. Residual, disclosed rather than fixed:
  pinned/untracked bodies are still sent unmeasured under an unsized window, because `adr/005` refuses
  to drop the only copy of that code — see the ADR. Widening filed as OAI-142.

- **OAI-134** — **SHIPPED as `d2dd70e`, with its filed mechanism refuted and its proposed fix refuted
  too.** What shipped is two hint strings and a README paragraph. What it cost was a full `/feature`
  run plus a light review pass, and the value was almost entirely in the refutations, not the diff.
  **Refuted #1 — the mechanism.** The item said the plugin sizes a JIT load by `max_context_length`.
  It does not, because **it has no load channel at all**: `client.mjs:40` is the only completion body
  and carries no `ttl`/`context_length`/load parameter, `/chat/completions` is the only POST, the model
  endpoints are GET probes, and no `lms` subprocess exists. Confirmed independently by a Codex consult
  reading the same files. The symptom was real and reproduced; the cause is the **server's own** JIT
  configuration, which this plugin neither sets nor sees.
  **Refuted #2 — the fix.** The plan's next candidate was a pre-emptive "model is not loaded" warning,
  and a blanket refusal behind it. Both died on a live check against a **second** server: oMLX 0.5.7
  JIT-loads successfully (`loaded_count` 0 → 1 inside a 7s prefill), so *not loaded* is its **normal
  successful path** and the warning would have fired on runs that work. LM Studio 0.4.20 attempts the
  load and may refuse for memory (a 7.15 GB model sized at 44.87 GB) — and, observed the same day,
  succeeds on a model that fits. Two servers at two versions support no claim about servers in general.
  **Also rejected: shelling out to `lms load` or a vendor REST load call** — `adr/001`'s "providers are
  config data, never code paths".
  **What actually shipped.** Both hints used to end *"to have it loaded on demand"*. Neither predicts
  an outcome now. The none-loaded hint (`:199`) names only the decider; the no-candidates hint (`:171`)
  says nothing about outcomes at all, because that branch fires when the server offers **no** chat model
  and "an id it has not loaded" would presuppose it knows the id. README.md is the single home for the
  dated per-server pair, and says explicitly that two observations are not an account of every server.
  **Three drafts of one string were caught, each a weaker version of the same defect** — "to have it
  loaded on demand" (promises the load) → "the server will try" (promises the attempt; caught at the
  plan gate) → "the server's to do or refuse" (names a two-outcome set; caught by `codex-plain` in the
  review pass). The third excluded the **third** thing a server does: answer from whatever else it has
  loaded — the substitution `unservedProblem` catches before the fact and `model-identity.mjs` after.
  The working test, recorded because it is reusable: **does the sentence permit silent substitution?**
  **Verified by running the changed path, not by the suite.** No test pins either string
  (`grep -rn "loaded on demand" tests/` returns nothing), so a green suite here **could not have
  failed** — this repo's dominant defect class, arriving inside its own fix. With LM Studio serving 5
  unloaded chat models, the none-loaded hint printed the old wording before the edit and the new
  wording after.
  **Process, recorded honestly:** the review ladder ran **one light pass** and ended
  `exit_mode: terminated` without a verdict point — the window closed. Pass 1 raised 5 findings, all
  accepted and all fixed in the one authorised batch; one of them (the docstring claiming the hints
  "name who decides, never what will happen") was an `adr/083` adjudicated falsehood, which is why
  pass 1 could not be terminal. Four **pre-existing** defects the pass surfaced went to **OAI-136**
  rather than into the batch. The process cost far exceeded the change; that observation goes to
  `ROUTING_LOG`.

## 2026-08-09 — the schema arm becomes measurable, and `bench/run.mjs` stops running on import (OAI-117)

- **OAI-117** — **`bench` could not pass `--structured-output`, so the schema arm could not be measured.**
  `bench/run.mjs`'s `SPEC` now carries the flag, `reviewFlags` forwards it, and the artifact records
  it in **two** places — the report header, where two files are compared, and a caveat naming the
  trade. Suite 771/0 → **777/0**.

  **The caveat states a trade, not a flag**, because the reading to prevent is "same measurement,
  tidier reply": a schema was measured to *cause* the transport drops (OAI-19 T2, controlled A/B) and
  the unconstrained default was measured to spend its whole shared budget reasoning (OAI-115). An arm
  run under a schema compares one failure class against the other. **This does not answer OAI-115** —
  it makes the question askable, and taking the measurement belongs to OAI-19's arm work.

  **A second, larger defect was found while building the seam, and it is the reason this entry is not
  a one-liner.** `reviewFlags` was unreachable, so exporting it was the obvious move — and the first
  import from `tests/` **ran a full six-case benchmark and wrote a report and a record into
  `bench/results/`**, because `main()` was called unconditionally at module scope rather than under a
  `process.argv[1]` guard. Every `npm test` would have done it. Fixed with the guard
  `bench/review-sweep.mjs:291` already had; proved both ways — import writes nothing (61 artifacts
  before, 61 after), and `node bench/run.mjs --runs 0` still reaches `main()`'s validation.
  **I asserted that guard existed before checking**, and the check is what disproved it; the comment
  claiming it has been replaced by one recording what actually happened. OAI-125's body is updated,
  and this does **not** close it.

  **Every assertion shipped with its negative twin, and the twins were mutation-checked.** Forcing the
  header marker unconditionally makes the `doesNotMatch` halves fail — without that, a marker that is
  always present would distinguish nothing, and a schema arm could be differenced against an
  unconstrained one as though the only change were parsing. `tests/bench-review-flags.test.js` covers
  the command line (including that `--structured-output` is **absent** by default, per ADR 003), and
  `tests/bench-report.test.js` covers the artifact.

  Two structural guards fired during the work and were satisfied rather than silenced: `flagNotes`
  crossed the 60-line function budget (split into `schemaNote`), and the first split left a doc
  comment documenting nothing — briefly "fixed" by downgrading it to a plain comment, which was
  dodging the guard, then fixed properly by reordering.

## 2026-08-09 — the tracker's own invariant gets a guard (OAI-104)

- **OAI-104** — **this file's structural invariant was enforced by a script that did not exist.**
  Closed by `tests/backlog-structure.test.js`, which asserts on every `npm test` that the tier index
  covers the live set exactly, that no id is indexed under two tiers, that the bodies are in ascending
  ID order (`adr/025`), that nothing is live and closed out at once, and that every absorbed-ID
  redirect lands on something live. Suite 766/0 → **771/0**.

  **The claim was false and the drift was already there.** On its first run the guard failed three
  ways: tier 12 still indexed **six ids closed the previous day** (OAI-118, 119, 120, 121, 122, 124),
  **OAI-131 and OAI-106 were each indexed under two tiers**, and **OAI-123's body sat out of order
  behind OAI-134**. All three are fixed in the same commit, so the guard passes on a tracker it
  actually corrected rather than on one written to suit it.

  **Proved by mutation, in the shape this repo requires** — control fires, fix catches, and each
  assertion is independently falsifiable. Re-indexing a closed id trips only *covers the live set*;
  indexing one id under two tiers trips only *listed twice*; swapping two bodies trips only *ascending
  order*. `BACKLOG.md` was restored byte-identically (md5 `f3d7cf4d…`) after each mutation.

  **One false positive was caught and removed before shipping**: matching any bolded id in
  `BACKLOG_DONE.md` reported five live items (OAI-11, 45, 74, 84, 95) as closed, because a done
  entry's prose legitimately names live work. The extractor is pinned to the same `- **OAI-n**`
  heading shape `bodyIds` uses.

  The prose promising the absent script is replaced in both `BACKLOG.md` and `CLAUDE.md` by a sentence
  naming the guard — OAI-104's own instruction was to do one or the other and not leave the sentence
  standing.

## 2026-08-08 — the review-sweep follow-on (OAI-118, 119, 120, 121, 122, 124)

Shipped in `10b29cb`. All six filed defects are fixed and were audited 18/18 by the ladder's
acceptance stage; suite 766/0.

**The ladder ended `cap-without-approval` at the computed cap of 3**, which is NOT a statement about
these six: their fixes landed and were verified. It is a statement about the SIX NEW findings that
pass raised — filed as OAI-125 to OAI-131 (tier 12b) — led by the resolved-SHA guarantee reaching the
artifact via one untested path.

Highlights worth not re-deriving:
- `classify` now builds every report-derived entry through one mapping, with a differing verdict as an
  override; that closed 120 as a consequence of fixing 121's rule.
- `serverUnwell` took **five** iterations. The rule that held is the CLI's own per-budget hint:
  `deadline` and `first-token` say raise the timeout, `idle` says raising it will not help. The fourth
  iteration — removing every timeout — was a regression caught one pass later.
- Two `.claude/REPO_TRAPS.md` classes were graduated from this feature: *a stub gentler than the
  dependency it stands for*, and *a test that asserts presence where the code guarantees presence*.

- **OAI-118** — **The sweep report's "exactly one disposition section" invariant is both VIOLATED and
  UNGUARDED.** Filed 2026-08-08 from the review-sweep ladder, `unresolved at cap`. A `truncated` entry
  carrying findings renders in **both** the Findings section and Coverage, against `adr/021`'s claim
  that each enumerated commit appears exactly once. And the only test that claims to guard it —
  `tests/sweep-report.test.js` `every commit appears exactly once` — asserts only
  `assert.match(out, /sha/)`, which one occurrence and ten both satisfy: it has failure power on
  absence and **none on duplication**. A positive control run against the checked-out bytes rendered a
  SHA twice with the assertion still green, and the fixture cannot exercise duplication at all (every
  entry in it is either REVIEWED-only or non-REVIEWED-only). **Both halves must land together**: the
  module header states the invariant confidently, so a future reader will believe it. Either dedupe the
  rendering or state the two-role policy in `adr/021` — and make the test count occurrences.
- **OAI-119** — **`deadline-timeout` is a caller-selected cap, and treating it as server death aborts
  healthy sweeps.** Filed 2026-08-08 from the review-sweep ladder, `unresolved at cap`. **CODE
  DEFECT.** `serverUnwell` admits `deadline-timeout`, but that reason is `--max-seconds` firing — the
  harness's own cap — not evidence the server is unwell. Three slow large commits in a row therefore
  trip `--abort-after` and mark every remaining commit `skipped-abort`. This is the **third** narrowing
  of the same predicate (any `*-timeout` → `{deadline, idle}` → `{idle}`), each of which removed a real
  false positive. Leaves `idle-timeout` alone in that group, which is correct: a stream that stalls
  mid-generation is the server stopping. **Workaround until fixed: `--abort-after 99`.**
- **OAI-120** — **A substituted model's findings are silently dropped from both artifacts.** Filed
  2026-08-08 from the review-sweep ladder, `unresolved at cap`. **CODE DEFECT, reproduced.**
  `classify`'s `substituted` branch returns without copying `settled.report.findings` or the caveat
  fields, so when a server answers with a model other than the one requested, the real defects it found
  never reach the report — the commit shows only in Coverage with "a different model answered".
  **This is trap instance 11 verbatim** — fixing the branch in front of you leaves the adjacent one
  wrong — committed in the very pass that fixed the identical omission for `truncated` and wrote the
  rationale for not doing it. **Adjudicated a RECURRENCE of OAI-121's identity**, which is why that
  item is also open. **This one blocks the model benchmark specifically**: substitution is the failure
  `adr/011` exists for, and an affected arm would report as having found nothing.
- **OAI-121** — **`classify` must carry EVERY belief-changing envelope field on EVERY path.** Filed
  2026-08-08 from the review-sweep ladder, `unresolved at cap` **by recurrence**. The identity is
  *"`classify` does not carry onto the entry an envelope field that changes what a reader should
  believe"*. It was fixed twice — `analysisCut`/`atCap`/`hunksOnly`, then `dropped` — and recurred as
  OAI-120 on a branch the fix never reached. **The fix is the RULE, not another branch**: a single
  place that maps a parsed report to an entry, used by every path, so a fourth path cannot be added
  without it. A structural test belongs here: this class has now been confirmed three times, which is
  past this repo's graduate-to-a-guard bar.
- **OAI-122** — **`adr/021` contradicts the shipped code on two superseded claims.** Filed 2026-08-08
  from the review-sweep ladder, `unresolved at cap`. It still documents an any-`*-timeout` outage set
  (narrowed twice since) and a two-section disposition claim (there are three sections). Both would
  license reintroducing rejected behaviour during maintenance. Non-executable text only.
- **OAI-124** — **`bench/review-sweep.mjs` cannot pin its enumeration, so benchmark arms are not
  comparable.** Filed 2026-08-08. **This is a `widening` awaiting the user, not a defect**: nobody
  raised it in review and it is not in the approved plan. Enumeration starts at `HEAD`, so any commit
  landing between arms shifts the window and two arms review different commits. The model benchmark
  the user asked for — 5 models x 2 executions x the same 10 commits — needs `--from <ref>`, or some
  other way of pinning, before its arms mean anything.

# Done

- **OAI-94** — a credential notice that cannot print the credential. Done 2026-08-07, decision record
  [ADR 019](adr/019-a-notice-that-cannot-print-the-secret.md). `warnAboutQueryCredentials` is replaced
  by `noteEndpointPersistence()`, which **takes no argument, gates on nothing past
  `requireDatabaseSync()`, and runs before anything else writes to stderr**. Seven review-ladder
  passes, dual-approved at pass 7.
  **The position is the part that was nearly lost.** The call originally kept its old spot below
  `prepareTask`, and pass 5's review dismissed the resulting delivery risk on a measurement that varied
  stderr volume *after* the notice and never before it — the wrong axis. Both approvers then rejected
  the feature at the verdict point on the same defect, reproduced against the real CLI: a 1 MB provider
  name (config puts no ceiling on one) pushes the notice past the pipe buffer, `process.exit(2)`
  discards what has not drained, and the notice is **lost on a run that has already written a row
  holding the credential** — 131245 bytes of stderr, notice absent. The appealing remedy,
  `fs.writeSync(2, …)`, was measured and **does not work**: `process.stderr.write` queues in userland
  and flushes asynchronously. Moving the call above `prepareTask` does, at an accepted cost in
  precision — it now also fires on submissions that persist nothing, where the sentence stays true
  because its conditional is "if this submission creates a job record".
  **What it left behind:** four further credential disclosures its own reviews found and filed rather
  than fixed — OAI-99, OAI-100, OAI-101, OAI-102 — so six now stand enumerated and unfixed. One output
  path was made safe. OAI-100 is the sharpest: the notice now *precedes* the transport errors that
  disclose a path credential, so a caller is warned and then leaked to by a different code path that
  says nothing.
  **`security-review` never ran, in any of the seven passes**, and this was a credentials feature. Not
  a flaky launch: the stage is a built-in command whose frontmatter interpolates
  `git diff --name-only origin/HEAD...` before reading its argument, and this repo has no remote. A
  security lens folded into `codex-adversarial` stood in for it and is what found OAI-100. Filed
  against the toolchain, not this repo.

- **OAI-61** — capability-gate `node:sqlite` so the plugin loads on the runtimes `package.json`
  declares. Done 2026-08-06. **Shipped NARROWED**: a partial plan withdrawal under `adr/033` returned it
  to its approved scope after six review-ladder passes established that the build had grown three
  mechanisms no plan approved — a credential-notice subsystem, a permission-hardening module, and an
  `onProfile` hook — and that the large majority of ~5.5M subagent tokens had gone on reviewing that
  scaffolding rather than the gate, which was stable and repeatedly confirmed from pass 2. The withdrawn
  work is **OAI-94** and **OAI-95**, each carrying its open findings. Codex ruled the decomposition; the
  user adjudicated partial over whole.
  **What the ladder found that the gate itself needed:** a static `node:sqlite` import in
  `tests/job-helpers.mjs` killed ELEVEN test files at LINK time on the exact runtimes this feature
  restores — no skip can rescue a link failure — now fixed lazily and guarded structurally by
  `tests/harness-guards.test.js`, the class having been confirmed three times. And `npm test` passed
  only while the working tree was DIRTY: one test asked the ambient directory for uncommitted changes,
  which the commit gate's own commit removes, so the suite read 632/0 dirty and **630/2** clean. Every
  green reported during this feature before that fix was conditioned on it. The gate is now measured in
  a committed copy.
  **Proven vs cited:** the guard is proved structurally and by mutation (four capability tests fail by
  name), and the `--no-experimental-sqlite` arm is a real runtime without the module, executed here. The
  version thresholds (22.13 / 23.4 / 18.19 / 20.6) are **cited, not executed** — this machine has only
  v26.3.1 and the user directed that no older Node be installed.

Newest first.

- **OAI-83** — Task templates, starting with the one that makes a local **advisor** something you
  invoke rather than a prompt you rewrite. **Completed 2026-08-05**, Stage 2's first piece of
  `plans/local-llms-like-codex.md`. Plan: `plans/oai-83-advisor-template.md`; decision record:
  [ADR 016](adr/016-a-template-is-three-things.md).
  `/oai:task --template advisor` ships: `scripts/lib/task-template.mjs` owns the skeleton, the reply
  shape and the discipline, and `agents/oai-delegate.md` passes the flag when the delegated work is a
  second opinion. **The forks it was filed with were all settled** — (a) a template lives in a code
  module selected by a flag, not in agent prose or a `templates/` directory; (b) a template never
  chooses files, so the conflict with the broker is designed out rather than arbitrated; (c) a lens is
  a **parameter** of a template, decided now and built when OAI-11 needs it, so no `--lens` shipped.
  **One premise it was filed with was wrong**: OAI-84 was not a sequencing dependency. `parseFindings`
  has exactly one production caller and the task path parses nothing, so the template's output shape
  never touched the parser OAI-84 changes.
  **The ceiling is a heuristic and is labelled as one** — 8000 tokens, anchored between the measured
  1,680-token run that produced a checkable finding and the 49,378-token run that returned nothing. A
  large request is answered with a caveat, never refused or trimmed.
  **What the two review passes actually caught was the plumbing, never the design**, which had
  survived four Codex plan-gate rounds. The sharpest: the delegate recipe's unquoted
  `${template:+--template "$template"}` produced a **single** argument under **zsh** — the shell these
  recipes run in — so every delegate advisor submission was refused, while the guarding test ran `sh`
  and stayed green. The suite now runs the recipe's real block under every shell with zsh **required**
  and declared. Two more of the same family: a bare `TEMPLATES[name]` accepted `--template toString`
  and ran with the default prompt, and a test comment claimed containment coverage that a mutation
  disproved. Verified live on both paths against a real model; ladder ended on dual approval.

- **OAI-5** — A delegation subagent, so neither the reading nor the reply lands in the calling
  session. **Completed 2026-08-05**, Stage 1b of `plans/local-llms-like-codex.md`. Plan:
  `plans/oai-5-delegation-broker.md`; decision record:
  [ADR 015](adr/015-a-context-broker-not-a-forwarder.md).
  `agents/oai-delegate.md` ships as a **context broker, not a forwarder** — it picks the files, makes
  the submission, waits, and returns an account plus the job id rather than the model's reply. No
  `.mjs` changed; the feature is one markdown file plus four guards in `tests/plugin.test.js`.
  **The invariant was corrected on the way in.** Both this file's old entry and the parent plan said
  "exactly one companion call", which is not implementable — an oversize refusal *is* a call, and
  re-selecting is the broker's mandate. It ships as **at most two `task` submissions, at most one
  accepted job**, in that wording in the agent, the ADR and the parent plan's dated correction block.
  **Verified live, end to end, against LM Studio** rather than a stub. A nested session invoked
  `oai:oai-delegate`, which selected **one file (`scripts/lib/errors.mjs`, 711 B)**, submitted job
  `e3835ded`, polled it to `completed`, and returned a summary, the file list, the id, an explicit
  "unverified — leads, not conclusions" caveat and a pointer to `/oai:result` — without pasting the
  reply. The model's answer was then checked against the file and was accurate. This is also the first
  evidence in this repo that **`${CLAUDE_PLUGIN_ROOT}` expands inside an *agent's* Bash call**, which
  the whole design rests on and which nothing here had ever proved.
  **Three mutations, each with a restore proved against a backup — and one of them refuted a claim in
  this feature's own plan.** The plan said reordering the rendered line would turn the *consumer*
  assertion red. It does not: the exact-line assertion fires first and aborts the test, so no renderer
  mutation can separate the two. The consumer assertion was therefore proved by mutating the agent's
  own `awk` expression instead (`$3` → `$2`), which leaves the renderer untouched — one test red, on
  the right assertion. The other two: collapsing the two-space separator turns the **exact-line**
  assertion red, and dropping a `TERMINAL_STATES` member turns the **vocabulary** guard red. Recorded
  because a mutation that cannot fail is this repo's most-repeated defect class, and the plan proposed
  one.
  **The step 6 ladder ran EIGHT passes and closed by dual approval** (Codex `APPROVE` + a verdict-only
  Claude approver `APPROVE`, combined with `check-plan-gate.sh --dual-approved`, exit 0). Stages per
  pass: `acceptance-audit`, `advisor-opener`, `codex-adversarial`, `codex-plain`, `security-review`
  and `advisor-closer`. `security-review`'s packaged skill **cannot launch in this remoteless repo**
  (`git diff origin/HEAD...`; that is OAI-7) and was substituted by scoped agents each pass, recorded
  as a substitute and never as the skill passing — the OAI-58 precedent. `lean-wide` was evaluated
  every pass and never triggered: no module is introduced or altered. The `advisor` failed four times
  (overload, a reply describing a different session, a reply impersonating the orchestrator, a
  timeout) and completed five; it is never recorded as passing on a pass where it did not complete.
  Two verdict points rejected before the third approved — the first on ADR staleness, the second on
  pass completeness, and both objections were fixed rather than argued.

  **The finding worth remembering, because I got it wrong first.** Pass 7 found that
  `real=$(canon "$f")` is command substitution, which strips trailing newlines — so a symlink to a
  file whose *name* ends in a newline yields a path **nobody canonicalised**, and a sibling planted at
  that shortened name and pointing outside the tree is read and recorded under the innocent in-tree
  name. I first **filed** it as a reporting-integrity nit on grounds I reasoned to ("containment is not
  escaped, both files are inside the root"); the security lens **refuted those grounds by execution**
  in the next pass, attaching `/etc/passwd` while the audit trail said `sub/target`. It was then fixed
  at the canonicaliser — which refuses any resolved path containing a control character — reproduced
  pre-fix, blocked post-fix, with an ordinary in-tree file still accepted, and re-confirmed
  independently in pass 8 with its own positive control. **The fix forbids a legal filename rather
  than handling it**: a repository holding a file whose name ends in a newline now has that file
  refused. Deliberate, and stated rather than silent. The defect **forged the very audit trail** the
  design tells its reader to trust, which is why it earned a `.claude/REPO_TRAPS.md` class of its own
  alongside the option-injection one.

  **Five consecutive fixes each introduced the next pass's defect**, all inside the same six-line
  shell block: pass 3's armed an RCE (`node -e … "$1"` executing a `--require=` filename), pass 4's
  broke the failure report, pass 6's created an unsatisfiable instruction, pass 7's was the filing
  above, pass 8's produced a clobbered error message. That record is why the last three findings ship
  **stated rather than fixed** — a sixth edit was likelier to add a defect than remove one — and it is
  the argument both approvers accepted. They point at one decision rather than more edits: move the
  lifecycle out of agent-authored shell, which is OAI-74 with OAI-76.

  **The plan gate ran six rounds** (Codex `APPROVE` at the last, on the exact text handed over), and
  four of them found real defects: a shell-injectable prompt recipe, a status field read at the wrong
  index, an autonomous selector with no repository boundary (filed as **OAI-74**), and — the one that
  would have broken the feature outright — a poll loop that assumed shell state survives between Bash
  tool calls, so the captured job id would have been empty and `status ""` would have silently
  returned the job *list*. Codex also corrected a claim of mine: `README.md`'s "non-streaming" is still
  true for user-visible output even though the transport consumes SSE, because the reply is buffered
  until complete.

- **OAI-78** — A newline-terminated canonical path substituting a sibling file. **Resolved inside
  OAI-5, 2026-08-05, before that feature shipped**; commit `306ff75`. Moved here by the 2026-08-05
  sweep, which found it sitting in the live ordered list describing itself as resolved.
  It was filed mid-ladder as a low-severity reporting nit, on the stated grounds that containment was
  not escaped.
  **Those grounds were refuted by execution in the next pass**: the truncated path was one nobody had
  canonicalised, a planted sibling escaped the tree, and `/etc/passwd` was read while the audit trail
  named an in-tree file. It was fixed in the same feature (the canonicaliser now refuses a resolved
  path containing a control character), reproduced pre-fix and blocked post-fix. Kept here rather than
  deleted because this file's IDs are stable and global, and because the filing-then-refutation is the
  most instructive thing the ladder produced. Full account in the OAI-5 entry above.

- **OAI-58** — **The owed step 6 review ladder on OAI-3. Run and closed 2026-08-05**, by
  dual approval at the verdict point (Codex `APPROVE`; a verdict-only Claude approver `APPROVE`;
  combined with `check-plan-gate.sh --dual-approved`, exit 0). It was filed the same day OAI-3
  shipped, because an owed review that lives only in a session transcript is one that never
  happens. Original scope and reasoning below, followed by what the ladder found.
  The precedent for filing it as an item at all is the discharged `/code-review high` block recorded
  in `BACKLOG.md`.
  **Scope:** `e74eb2c^..HEAD` — eight commits, 19 new modules, 44 new tests.
  **It triggers `lean-wide` on the repo's own terms, and not marginally:** the CLAUDE.md rule is that
  wide mode fires when a change introduces or alters a module carrying vendor or protocol assumptions,
  and this one introduces process-lifecycle *and* persistence assumptions — a detached worker, pid
  liveness, a database with two version axes, and a credential decision replayed in a second process
  minutes later.
  **The cost is the reason this is an item rather than a step someone squeezes in:** a full ladder
  here measured ~1.7M subagent tokens, which is one feature per session. The lever is `review-lean`
  in wide mode **once over the whole feature** rather than per phase — per-phase passes were
  deliberately not run for this reason, and each phase got a single `advisor` request instead as the
  tripwire (**every one of which failed to launch, overloaded** — so the mid-build tripwire produced
  nothing across all eight phases, and this pass is carrying more than it usually would).
  **OAI-52 item (1) is closed (2026-08-05)** — it was done first, deliberately, because an untested
  auth module is a finding the fan-out would certainly raise and paying five verifiers to repeat what
  is written down here is waste. `tests/job-auth.test.js` is therefore **inside this scope**, which
  stays `e74eb2c^..HEAD` and so extends to it automatically.
  **Check `unadjudicated` before reading any verdict:** wide mode returns `findings: []` when its
  verifiers die on the cap, and that shape reads exactly like a clean pass.

  ### The ladder RAN, 2026-08-05 — one pass, seven stages, 29 ledger entries

  Frozen at `59662b3`, tree clean, baseline `npm test` 533 pass / 0 fail. Stages, in table order:
  `acceptance-audit` (scout, ~30 plan obligations enumerated); `advisor-opener` (**failed overloaded
  on first launch, completed on retry** — a died stage, not a coverage gap); `codex-adversarial`
  (`needs-attention`, 4 high); `codex-plain` (6 findings); `security-review`
  (**the packaged skill could not launch** — its preamble runs `git diff origin/HEAD...` and this repo
  has no remote, which is OAI-7; the lens was applied by two scoped substitute agents and is recorded
  as a substitute, never as the skill passing — logged to `ROUTING_LOG.md` because it blocks the
  security stage of every ladder in any remoteless repo); `lean-wide`; `advisor-closer`.

  **`lean-wide` completed CLEAN, and this was checked rather than assumed**: `unadjudicated: 0` across
  all three causes (`agentFailure`, `missingVerdict`, `setupFailure`), `findersReturned` 5/5, 12
  agents, 0 errors, 0 empty results, 9 candidates, 5 refuted, 1 duplicate collapsed. 961k subagent
  tokens. The `findings: []`-from-dead-verifiers shape did **not** occur.

  **The pass refuted one of its own findings, by execution.** A `null !== null` hole in
  `job-auth.mjs`'s origin comparison was raised by the orchestrator, and a security agent killed it by
  running it with a positive control in the same run: leg 2 is an interlock a null-ish value cannot
  satisfy, because `normalizeBaseUrl` guarantees an http(s) URL whose `.origin` is never null. The
  control sent a credential; every null variant reached the server zero times.

  **Two lenses contradicted each other on WAL file modes and both were right** — SQLite removes the
  WAL on a *clean* close, so the agent that measured after close saw nothing and the agent that
  measured in-flight and after SIGKILL saw a world-readable file holding the prompt. Recorded because
  a reader finding only the reassuring measurement would conclude OAI-65 was refuted.

  Findings are filed as **OAI-61 … OAI-73 in `BACKLOG.md`**, with amendments to OAI-52, OAI-55 and OAI-59.
  Executable probes — red-before fixtures whose controls are already proved to fire — are preserved at
  `~/.claude/projects/-Users-kieran-Code-openai-compat-plugin-cc/oai-58-probes/`, because they are most
  of the mutation proof the fixes owe and rewriting them is the expensive path.

  **No code fix was applied, and none is claimed.** This was the ladder's terminal pass, which by
  its own rule has no fix batch; every finding was dispositioned by FILING it, which the verdict
  bar explicitly permits ("every still-open entry is one the approver would ship — dismissed,
  filed, or out of scope"). The work itself is OAI-61 … OAI-73, ordered by impact.


- **OAI-3** — Background jobs: `--background`, plus `/oai:status`, `/oai:result`, `/oai:cancel`.
  **Completed 2026-08-05** as Stage 1 of `plans/local-llms-like-codex.md`. Plan:
  `plans/oai-3-async-jobs.md`; decision record: [ADR 014](adr/014-async-jobs.md).
  **The stage gate, in the plan's own words — "a job launched in one Claude session is retrievable
  from another, and editing source after submission does not change what the model saw" — is met, and
  both halves cross a real process boundary rather than being asserted.** Half 1 is
  `tests/status.test.js` "a job submitted by one process is retrievable by another, from a different
  directory": two separate `runCompanion` invocations, the second from a different cwd. Half 2 is
  `tests/background.test.js` "what the model sees is frozen at submission, not read when the worker
  runs", which uses a **barrier that already existed in the code** rather than a scheduling race —
  attachments are read before `resolveTarget` probes `/v1/models`, so the fake `/models` handler
  mutates the file before replying and the eventual chat completion is asserted to carry the original
  bytes. Mutation-checked: making the worker re-read attachments from disk turns that test red.
  **The item as filed said to port the reference plugin's job model and "replace its RPC interrupt
  with an `AbortController`". Both were rejected on evidence, and the reversals are the substance of
  the work.** The reference plugin (`codex` 1.0.6) kills its background jobs on `SessionEnd`, so
  porting it would have failed the gate outright. And no `AbortController` exists here: the worker's
  heartbeat calls `process.exit()`, because setting `process.exitCode` leaves the open socket and the
  heartbeat timer holding the loop and the request simply continues.
  **Two prohibitions in the parent plan were reversed at the user's direction, and each turned out to
  be the simplifying choice** (both now amended in `plans/local-llms-like-codex.md` rather than left
  contradicting the code): jobs **queue** rather than being refused, which removes the need for mutual
  exclusion at submission entirely; and **SQLite** (`node:sqlite`, zero dependencies) is the store,
  after fourteen review rounds spent building atomic publication, a never-reused queue position and
  terminal immutability out of `wx` files — where every round's fix produced the next round's defect.
  The whole concurrency design is now one `BEGIN IMMEDIATE` transaction.
  Nineteen plan-gate rounds, ~74 findings, all accepted, closing on Codex `APPROVE`. What the gate
  bought, beyond the protocol: a cancel that would have sent `SIGTERM` to a pid the plan itself
  admitted might be recycled; a credential check comparing two values both derived from submission,
  and so tautological; a `--base-url` query string silently persisting an API key while the plan
  claimed credentials were never stored; **two tests that could not fail**; and `--max-wait` capping
  nothing because two rules contradicted each other.
  **Shipped state:** 8 phases; **525 tests green**, 44 of them added by this feature. 19 new modules
  under `scripts/` (2,150 insertions), 10 new files under `tests/` (1,410), and 3 new command
  markdowns. One real end-to-end run against LM Studio, plus a seeded-history run through the real
  CLI for retention.
  **What did NOT land, stated rather than implied by silence: six items from the plan's own
  verification list — see OAI-52**, which is filed above precisely so this entry cannot read as
  complete coverage.

- **OAI-51** — **The review schema crashed the model backend, and the crash was ours.**
  **Completed 2026-08-04** as **Stage 0** of `plans/local-llms-like-codex.md`; commits `db46d1f`
  (stop sending a grammar), `5675da5` (answer first) and `a23fdde` (the whole-tree confirmation).
  **Verified against disk by the 2026-08-05 backlog sweep** rather than taken from the commit
  messages, because the live backlog header was still calling this the one open item:
  `cmd-review.mjs:113` gates the schema behind `--structured-output`, and `commands/review.md:27`
  documents that default as deliberate.
  **Both halves of the Stage 0 gate hold, and the second is test-pinned.** The first — repeated long
  generation does not crash the backend — is the measurement below. The second — a parse failure must
  never render as "no findings" — is `review-report.mjs:140` (`findings: parsed?.findings ?? null`,
  never `[]`), asserted at `tests/review-json.test.js:83` ("null, not [] — an empty list is a clean
  review"), with the rendered path printing the reply verbatim at `review-report.mjs:69`.
  **One deviation from the plan's wording, recorded rather than glossed.** The plan asked for
  `parsed: complete | partial | failed`. What shipped is a boolean plus a `dropped` count
  (`structured.mjs:278-281`, `review-report.mjs:139`): per-record loose parsing **is** built — one
  malformed finding no longer destroys the array — but the tri-state enum does not exist. Functionally
  the gate is met; the plan's literal shape is not, and a reader comparing the two should know which.
  **Residue that did NOT come with it:** `parseFindings` still picks one channel and never falls back,
  and a bare top-level findings *array* is still discarded. Both were OAI-13 sub-items filed as
  vendor-dependent; the default path now runs the same parser, so they stopped being vendor questions
  and are **OAI-84**, live.

  The filing account, kept whole because every paragraph in it is a dated measurement:

  **Filed 2026-08-04.** **The review schema crashes the model backend. This is the cause of the "server
  drops", and it is ours, not LM Studio's.** Filed 2026-08-04, from the LM Studio server log — which
  has existed at `~/.lmstudio/server-logs/` throughout, was never read, and names the failure
  outright. **This supersedes the framing of OAI-20, OAI-24 and OAI-34**, all three of which
  characterised these failures from the client side as properties of an unreliable server.
  The mechanism, quoted from the log rather than inferred:
  `ValueError: LLGuidance matcher error: lexer error: too many states: 250000 >= 250000`, with
  `Stop: LexerTooComplex`, raised inside the grammar LLGuidance builds from the `response_format`
  JSON schema this repo sends (ADR 003). It propagates as a *fatal exception in the backend
  generation thread*, and the model process then dies with `Fatal Python error: Segmentation fault`
  → `The model has crashed`. LM Studio reloads it about 12 seconds later, **which is exactly why
  retry sometimes works** — the retry meets a freshly loaded model.
  It fires at **~14k constrained tokens**: five instances on 2026-08-04 at 13,956–14,744 tokens and
  43,389–50,497 bytes, tightly clustered and independent of whether `maxLength` was 65,499 or 74,000.
  So the trigger is **how long the model generates inside the grammar**, not the cap itself. This
  repo already wrote the number down and could not explain it — CLAUDE.md's footgun says "a stream
  drop **~50k chars** into reasoning".
  **The 2026-07-30 session that produced the 27/72 figure has the same signature**: 53
  `LexerTooComplex` events and 8 crashes, against zero on 07-28 (81 completions) and zero on 07-29
  (28 completions). And `empty-completion` and `stream-unfinished` are not two failure modes but
  **one event observed on either side of first token**, which is why OAI-20's split on "was a prefill
  measured" partitioned them 13/4 exactly.
  **Why local coding never sees it, which is the observation that prompted the search:** `/oai:task`
  sends no `response_format`, so no grammar is built and no lexer state accumulates. Only
  `/oai:review`'s structured output does. The failure is not a property of these models or of this
  server; it is a property of asking for long-form generation inside a constrained grammar.
  Options, and this is a design decision rather than a fix: **(a)** take `analysis` out of the schema
  entirely and let the model reason unconstrained, parsing only `findings` — the reasoning is already
  arriving in `reasoning_content` under a grammar that stops the model closing its think block, which
  is the same problem seen from the other end; **(b)** cap `analysis` far below the ~14k-token
  threshold, which reintroduces the censorship OAI-15 was raised to remove and makes ADR 008's
  sizing argument moot; **(c)** drop the schema for large targets and use ADR 003's prompt-and-parse
  fallback, which touches no grammar at all. **(a) and (c) are the ones that address the mechanism**;
  (b) trades one known defect for another.
  **Stage 0 landed 2026-08-04, and running it produced two results — one banking the gate, one new.**

  **Gate 1 PASSED, measured not argued.** An unconstrained review generated **59,918 characters of
  reasoning over 340s** — past the 43,389-50,497 byte band in which every grammar-constrained run
  segfaulted — and the backend did not crash. The server log is the proof: it stood at 43
  `LexerTooComplex` events and 5 crashes before that run and at **exactly 43 and 5 after it**. The
  claim "unconstrained is safe" was untested when Stage 0 was planned, and this is the test.

  **New result: removing the grammar removed a second thing nobody had accounted for.** That run
  produced NO findings — it spent its whole token budget reasoning and died at `finish_reason:
  length`. The schema's `maxLength` on `analysis` was doing **double duty**: bounding the reply, and
  forcing the model to stop reasoning and move on to `findings`. The system prompt still says *'Use
  the "analysis" field first ... Only then fill in findings'*, and the schema ordered
  `analysis -> findings -> summary`, so with nothing enforcing the bound the model reasons until the
  budget dies and never reaches the answer. Under a grammar that ordering was safe by construction;
  unconstrained it is a guarantee of silence on any target big enough to think about.
  The fix is to invert it — findings first, analysis after — so a budget-exhausted reply still
  carries what it found. Cheap, and only discoverable by running the thing.

  **The ordering fix landed and was measured, 2026-08-04.** Same file, same model, same flags:
  before it, `scripts/lib/throughput.mjs` drew 38,956 characters of `analysis` and was still climbing
  when killed at 160s; after, the run finished in 135s with `finish_reason: stop` and a finding.
  Reasoning volume barely moved (33,217 chars, 10,221 reasoning tokens) — the model still thinks just
  as hard, it now **stops and answers**. The instruction is conditional, not global: `analysis` stays
  first under a grammar, where the measured evidence for that ordering was gathered and still holds,
  and `findingsFirst()` reorders the schema the prose instruction is rendered from so the two cannot
  drift. **Attribution caveat, stated rather than glossed:** the small-file baseline was *killed*, not
  run to failure, so it alone does not establish the fix — the case that definitively failed was the
  whole-tree target (`finish_reason: length`, no findings, 59,918 chars), and that is the comparison
  worth quoting.

  **That comparison has now been run, and it confirms the fix.** Whole working tree, same model,
  49,378 prompt tokens: it completed with `finish_reason: stop` where the pre-fix run died at
  `length`, having reached its answering phase after 54,127 characters of reasoning. `degraded: false`
  and `retried: false` held on a 49k-token request too.
  **It returned 0 findings, and that is a recall observation rather than a Stage 0 failure** —
  `parsed: true` with content emitted is a genuine "found nothing", not a guillotine. Set beside the
  1,680-token single-file run, which produced a specific checkable finding, it is also the first
  direct measurement of the workload envelope the plan asserts: a ~49k-token target is on the reject
  list, and this is why.

  **A defect the flip introduced, caught in review and worth recording as a class.** `runTimings`
  derived both `retried` and `degraded` from `!structured`, which meant "we fell back" only while a
  schema was *always* requested. With the default flipped, every ordinary run would have reported
  `retried: true` for a single-request run and `degraded: true` for a schema nobody asked for — into
  the very record OAI-19 reads reliability from. `degraded` now needs both facts (asked for, not
  obtained) and `retried` needs neither, deriving from the request count alone. This is CLAUDE.md's
  "when a field's *meaning* changes, grep the aggregates and derived variables" rule, and the field
  that broke is the one whose own docstring warns about this exact inversion.

  **First real finding off the new path was a false positive, and that is the system working.** It
  claimed an explicit `null` `completion_tokens` bypasses validation at `throughput.mjs:37`.
  `Number.isFinite(null)` is `false`, so it does not; the model confused it with the global
  `isFinite`, which coerces. Refuting it cost under a minute against the code, which is the whole
  premise of `commands/review.md` — leads, not conclusions.

  **Note against OAI-15 and ADR 008:** raising the reply ceiling *permits* longer constrained
  generation, so it moves runs toward this threshold rather than away from it. Whether OAI-15 caused
  the crashes is NOT established here — the derived cap landed 2026-07-28 (`b66a3d5`) and 07-28/07-29
  are clean, so a corpus-size or backend difference is unexcluded — and it must not be asserted
  without checking. What is established is the mechanism, its threshold, and its presence in the
  sessions whose numbers this backlog quotes.

- **OAI-34** — Build the TTL challenge instrument, then run it. **Completed 2026-08-04, and the
  answer is negative: the DETERMINISTIC form of the JIT-TTL hypothesis is REFUTED.** A cold request
  stayed in prefill for 336s under a TTL deliberately shortened to 120s, three times out of three,
  with the model continuously resident throughout.
  **Provenance, because the done-condition asks for it rather than a timestamp:** instrument at
  `0c566b6` (the last commit touching any `ttl-*` module), run from `518db21` with a clean tree,
  record at `bench/results/ttl-challenge-2026-08-04T18-35-03-245Z.json` —
  `protocol.canonical: true`, `startedAt 2026-08-04T18:04:02Z`, 67 minutes after the instrument
  commit.
  Accepted verdicts: `deterministic-form-refuted`, `inconclusive-failure`. Obtained:
  `deterministic-form-refuted`, exit 0.
  **The numbers are quoted here, not just the path, because `bench/results/` is gitignored.** The
  record exists on one machine. `BACKLOG.md`'s own opening paragraph names what that costs — "ADR
  004 says four runs, `890ee2e` says five, same experiment, neither now checkable" — so the evidence
  is transcribed into the tracker where it survives the file:
  - **Prefill, the controlled quantity: 336.7s / 336.3s / 336.5s** across the three episodes —
    identical to within 0.4s — against a calibration prefill of 338.0s at the long 4h TTL.
    (`durationMs` was 389s / 580s / 407s; that spread is generation length and says nothing about
    the mechanism. Quote prefill.)
  - **The episodes were genuinely independent trials, and the record proves it rather than assuming
    it.** All four runs sent an identical prompt (`promptChars: 172431`) and their prefills sit
    within **1.64s** of each other, `warmEligible: false` throughout. [ADR
    009](adr/009-measuring-prefill-and-generation.md) is the reason this matters: a server-side
    prompt cache moves prefill by *tens of times* — 421.7s cold against 11.5s warm on a comparable
    request — so a cache hit would have read ~10s, not 336s. The `unload` → `load` cycle between
    episodes therefore defeated the cache. **This is load-bearing for the headline**: the ~63% bound
    assumes three independent trials, and cache-correlated episodes would have inflated N and
    understated the bound. It strengthens the refutation rather than qualifying it.
  - **`exposureRatio` 2.80× in every episode**, `slackMs` 216.7s / 216.3s / 216.5s. The refutation
    rests on `c < prefillMs - ttlMs`, so the narrowest slack — 216s — is the condition, and it is
    the figure the verdict sentence quotes.
  - **`appliedTtlMs: 120000` read back from the server in every in-flight sample**, not inferred
    from `lms load` exiting 0. The shortened treatment was in force for the whole run.
  - **Continuous residency**: 194 / 289 / 203 in-flight samples, `unreadableSamples: 0`, maximum
    sample gap 2.15s against a 2s interval, `targetResidentAtStart: true`, and the model absent from
    **none** of them. `unloadAt: null` in all three — no absence was ever observed, so nothing had
    to be recorded-and-not-attributed.
  - **All four validity checks passed in every episode**: `validityFailures: []`,
    `competingModels: []` (G2), `obtainedResponse: true` (G5), applied TTL matching requested (G6),
    `contradiction: null` (G8).
  - Verdict sentence, verbatim: *"3 cold request(s) remained in prefill well past a deliberately
    shortened TTL without unloading or failing, refuting the DETERMINISTIC form of the mechanism. It
    does not show the failure rate is low: the one-sided 95% upper bound on 0 events in 3 is ~63%.
    The narrowest episode cleared expiry by 216s, and this holds provided request serialization and
    server admission took less than that."*
  **What this does NOT establish, stated at the same volume as what it does.** It is the dense
  `qwen/qwen3.6-27b` only, one case (`scaffold`), one TTL (120s), N=3 — and the outcome sentence's
  own ~63% bound is the instrument saying so. The 27/72 drop rate was observed on **both** models,
  so the MoE half is untouched by this. And **the cause of those drops remains unresolved**: this
  refutes one hypothesis about them, it does not explain them. Under no outcome may a write-up name
  JIT-TTL as the mechanism — the instrument refutes and cannot confirm, which is the design change
  the plan gate forced.
  **One observation about the evidence base, recorded and attributed to nothing.**
  `activityObserved` is `null` in all three episodes — not because the sampler failed, but because
  **LM Studio reports `lastUsedTime: null` for the whole time it is serving a request** (`status`
  was `processingPrompt` for 168 consecutive samples per episode, then `generating`). ADR 013
  nominated `lastUsedTime` as the activity evidence to record-but-never-branch-on; the run shows the
  field is simply not populated while a request is in flight. That is a fact about what the server
  exposes. It is **not** evidence about what its timer does, and it must not be read as any.
  It also sharpens **OAI-45**(2): the stub's `lastUsedAdvances` knob models a state the real server
  never produces during flight, which is a stronger reason to reconsider it than "unused affordance".
  **Discharged here rather than carried:** OAI-34's warning that the terminal review batch was
  itself unreviewed. That batch's only code was `bench/lib/ttl-calibration.mjs`; it was reviewed on
  2026-08-04 before this run was written up, and the entailment rule reads correctly — `no-response`
  returns alone, `request-failed` and `no-prefill-measured` remain independent, and `prefill-short`
  sits in the `else` so an unmeasured prefill is never also called short. **One reviewer, not a
  ladder pass.** Note also that `calibrationSays` never executed in this run because the calibration
  cleared; it is exercised by the e2e harness's short-calibration scenario, not by anything in
  anger.
  **Known gap, carried forward unchanged:** the withdrawn draft's ten pass-2 findings are still only
  eight recovered. The two that were never written down anywhere have **not** been recovered — the
  e2e harness was the recovery mechanism and it surfaced defects in its own scenarios instead. Say
  that rather than letting a green run stand in for it.
  **The tracker guard moved with this entry.** `tests/ttl-vocabulary.test.js` parses the
  `Accepted verdicts:` line and compares it set-wise against the `CONCLUSIVE` list the driver's exit
  code imports; it was anchored to `- **OAI-34**` in `BACKLOG.md` and now reads this file. It fails
  closed on a missing anchor, so relocating the entry turned it red rather than passing vacuously —
  which is how it was noticed. **OAI-46 is still open and its subject is this guard**: it pins this
  one line and nothing else in the entry.

- **OAI-32** — Stop `review-lean`'s verifiers mutating the LIVE working tree. **Completed
  2026-08-04.** The fix is in `~/Code/dotfiles` as its backlog item 55, commits `d07ea90` and
  `cf23052`, with the decision recorded in dotfiles `adr/012-isolating-review-verifiers.md` — this
  repo is where it bit and where it was tracked, not where it lives.
  **The item's own premise was refuted before it was built, and that shaped the answer.** It said
  `isolation: "worktree"` was "the only remaining real control". Measured on Claude Code 2.1.221: a
  worktree is a **clean checkout of the default branch**, carrying none of the uncommitted change
  under review — so the flag *alone* would have made every verifier adjudicate the wrong code while
  sounding exactly as confident, trading a visible corruption for a silent wrong verdict. Verifiers
  are now isolated **and seeded**, and the seed is proven before any verdict counts; a batch that
  cannot prove its copy returns no verdicts at all and never falls back to the shared tree.
  Two traps came out of it, both now in dotfiles `.claude/REPO_TRAPS.md` and both guarded:
  `--exclude='/.git/'` **deletes** a worktree's `.git` (it is a FILE; a trailing slash matches
  directories only), after which git resolves upward and later writes land in the main repo while the
  copy still looks isolated; and a content digest built with `[ -f ]` **follows symlinks**, so this
  repo's one relative symlink hashed at the source and dangled in the copy — which is what failed the
  first live mechanism run, after review had passed the code.
  The reporting half also landed: a run whose verifiers all died returned `findings: []` beside
  `unadjudicated: N` and read as clean. An incomplete run now **omits `findings` entirely** and leads
  with `error`, gated on every candidate adjudicated, every finder returned, **and** setup having
  succeeded — the last clause because with zero candidates the other two hold vacuously.
  **Standing practice this retires:** the manual `rsync -a` snapshot before every wide run was the
  only thing making the corruption visible. Keep taking one until a `--wide` run has actually
  exercised the new path — see the caveat below.
  **Not proven end to end.** The seed protocol was validated by running the real emitted script in a
  real isolated worktree (exit 0; modified, untracked, staged-add and staged-rename artifacts all
  present; suite 425/425; edits contained), but **no full `--wide` run has used it**, because the seed
  resolves the *session's* repo and this feature was built from a session rooted here rather than in
  dotfiles. Filed there as items 81 (the same one-character `.git` defect in `/feature`'s own restore)
  and 82 (a scope-time snapshot, stronger but needing a lifecycle), plus 83-86 from the review that
  closed it — of which **83 is the one to read**: it is the ledger of what this feature was *not*
  checked by, and it is what the caveat above resolves to. *(Those two were filed as 56/57 and
  renumbered the same day: dotfiles never reuses an ID, and 56/57 were already absorbed.)*

- **OAI-35** — Carry `serverResponded` onto the attempt entry. Completed 2026-08-03, **with OAI-37
  absorbed into it** (see below). The field means *an HTTP response was obtained* — headers arrived —
  and rides on every entry: `settle` and `pendUntilReplaced` write `true` from the outcome itself,
  since an answered request and a refused shape both required a response, while only `fail` weighs
  evidence, from several independent witnesses (the transport's flag, an HTTP status code, a
  completion shape, or a measured prefill). Named rather than counted, because the count drifted the
  moment a fourth was added — see below. Several because one is a single point of forgetting:
  `provider.mjs` pairs the flag with
  `.status` today, but a post-response path added later that omits it would silently record a server
  that answered as one that never did. Proved live as well as on the fake server — a real LM Studio
  run wrote `{outcome: 'answered', serverResponded: true, prefillMs: 4094}`.
  **Three of the item's own claims were wrong, and the third is the one worth remembering.**
  (1) It cited ADR 012 for the phrase "does not establish whether a peer was reached"; that phrase is
  in ADR 013, quoting it. (2) It predicted the enumeration tripwire would fire "the moment `fail()`
  copies a tenth field" — `tests/bench-reason-notes.test.js` was already passing `serverResponded`
  into `fail()`, so the tripwire was pre-armed and fired on the `RECORD_FIELDS` edit instead.
  (3) **It framed the field as settling whether a *peer was reached*, and it does not.** `ENOTFOUND`
  contacted nothing, `ECONNREFUSED` reached a host that answered with a reset, and a TLS rejection
  reached a peer outright — all three obtained no response and all three record `false`. So the
  reachability limitation is *not* removed, ADR 012's rejection of the name `unreachable` stands, and
  the `non-retryable-transport` paragraph keeps its hedge instead of losing it. Caught at the plan
  gate's **blind** re-ask after two thread-carrying rounds had passed it, and recorded as instance 8
  in `.claude/REPO_TRAPS.md` — the first instance of that class found in a tracker item rather than in
  code, which is the more dangerous site because nothing executes it.
  Also landed: the reliability report splits failures on the new field with **three** buckets, the
  third for records written before it existed, because folding those into `false` would turn missing
  instrumentation into an observation that nothing answered. `reasonNotes`, `RECORD_FIELDS` and
  `recordList` moved to `bench/lib/reason-notes.mjs` — the split the old file's own comment
  prescribed for whoever added the tenth field, rather than raising the 300-line ratchet.
  **The review's second pass found eleven defects, and five of them were the first pass's own fixes
  being unproved or overclaimed rather than anything new in the feature.** The instructive one: a test
  written to guard the three sites that mint the flag built its own error with
  `serverResponded: true` already on it, so it proved only that `fail()` copies a flag — while its
  comment said dropping the write at `sse.mjs`, `body.mjs` or `http.mjs` would go red. A verifier
  deleted the write in `body.mjs` and ran the suite: all green. The sites are now driven end to end
  through a fake server in `tests/attempt-response-sites.test.js`, and both deletions redden exactly
  their own case. That is also why `obtainedResponse` has a fourth witness: a measured `prefillMs`
  proves headers arrived without depending on any site *remembering* to set a flag, which is the
  failure that turned out to be real rather than theoretical.
  **A third pass then found that fix had broken the test it shipped beside, and the ladder stopped
  there because it had started finding its own tail.** The new end-to-end case delivered model text
  before cutting the socket, so the fourth witness measured a prefill and reconstructed `true` — the
  case passed with the flag write deleted, which is the same vacuous-guard class arriving by the
  opposite route. A debug stack showed it never reached the site it was named for either: a destroyed
  socket throws from the iterator, so `http.mjs`'s `!response.complete` branch cannot see it. The
  fixture now sends a **role-only delta** — bytes without text, so the catch runs with `delivered`
  while no prefill is stamped — and each of the three covered sites reddens on deletion of its own
  write, all three verified by mutation. The two sites nothing reaches are named as uncovered rather
  than implied to be guarded. Pass 3 also caught the witness count going stale in three documents at
  once, one of which contradicted itself thirty lines later; the count is gone and the witnesses are
  enumerated, because a number kept away from the list it describes had by then drifted three times.
  Both tightened guards (`Number.isInteger(status) && >= 100`, `Number.isFinite(prefillMs) && >= 0`)
  are mutation-proved, and `prefillMs: 0` is asserted to survive them — a first text inside the
  timer's resolution is a measurement, not junk.
  **Three** invariants with no independent derivation behind them were mutation-proved, and the count
  is three because the review found the first pass had claimed two: reverting `pendUntilReplaced` to a
  derived value reddens the refusal test, loosening the three-bucket `=== false` to `!== true` reddens
  the legacy-record test, and — the one that was missing — deleting the `RESPONSE_BUCKETS` seed left
  the **whole suite green**, so the fix that made a zero row print had nothing behind it at all. Its
  guard is now a test where exactly one bucket is populated, since the existing ones filled all three
  organically and could not see the seed disappear.

- **OAI-37** — `ECONNREFUSED` cited as an example of never reaching a peer. Completed 2026-08-03,
  **absorbed into OAI-35**, which had to rewrite the very paragraph the clause sits in. Leaving it
  open would have left a tracked item pointing at prose that no longer existed. The sentence now puts
  `ECONNREFUSED` with the codes that *did* reach something — its reset is the host itself answering —
  and `ENOTFOUND` alone on the side that contacted nothing. The item's instruction not to reword the
  surrounding inherited prose was kept for **two of the three** clauses it named: the hedge and the
  warm-eligibility caveat are byte-unchanged, and `tests/bench-reason-notes.test.js` pins each. The
  **asymmetry clause was not** — it gained `**on that axis**` and two sentences pointing at the new
  response table, which is unavoidable once a table answers the narrower question the clause says
  cannot be answered. An earlier version of this entry claimed all three were untouched: a property of
  two members asserted of the set, written into the very entry documenting that trap class. Caught in
  review by diffing the rendered paragraph against `git show HEAD`.

- **OAI-31** — Five findings OAI-26's pass 3 raised and its own rules would not let it fix, plus a
  sixth noticed while filing. Completed 2026-08-03. **All six were verified before any code was
  written** — three by Codex reading the cited code, three by mutation against the live tree — and
  the mutations are the interesting half, because each proved a guard hollow rather than merely
  suspicious: replacing **both** fixtures of the two-fixture pair with identical junk left the suite
  green; gutting the `shape-rejected` paragraph left its assertion green, matching the count-table
  row; and `key === code` → `key.includes(code)` left **all 404 tests green** while making a
  `non-retryable-transport`-only sweep print "a further attempt could plausibly survive" about a
  code that by definition was never retried.
  **The two false rendered sentences are fixed, and the second one twice.** "The reason code is all
  an attempt record carries" was false — the entry also holds `index`, `cause`, `promptChars`,
  `warmEligible`, `waitedMs`, `outcome` and both timings. Its first replacement, "the attempt record
  has no peer-reachability field", *read* as the narrow specific form and was not: it quantifies
  over the meaning of every field that might ever be added, so it can go false via a field named
  anything at all. A **blind** re-ask of the plan gate caught that; the thread-carrying round before
  it did not. **The rule that came out of it — do not assert what a record LACKS, enumerate what it
  HOLDS** — is now the governing comment in `reasonNotes`, recorded as instance 7 in
  `.claude/REPO_TRAPS.md`, and pinned: the paragraph names its nine fields and the test pins the
  whole key set, coupling it to every ledger addition **on purpose**. Proved by simulating OAI-35's
  `serverResponded` copy inside `fail()` and watching it go red.
  Separately, "a replacement request … **was dispatched**" and its closing "a replacement was
  **sent**" both claimed a wire write that is not established — `refused` is written at
  `ledger.begin`, several frames before a socket, with body serialization and URL validation still
  able to throw. Both now claim an *initiated* replacement, and the ordering sentence was folded
  rather than deleted because it carries a distinct invariant.
  **`tests/bench-reliability.test.js` was split rather than the ratchet raised.** The repairs took
  it from 270 to 320 against a 300 ceiling; it is now the attempt-**accounting** suite plus a new
  `tests/bench-reason-notes.test.js` carrying the reason-code **prose**, both comfortably under that
  ceiling — line counts deliberately not quoted here, because the first draft of this entry quoted
  one that was stale within the hour. With the one shared fixture
  moved into `tests/bench-report-fixtures.mjs` — which exists because another suite was split the
  same way for the same reason. **Plan-gate history worth keeping:** round 1 approved and its
  prediction that the edits would fit under the ratchet was wrong; round 2 caught a stale
  cross-reference the split created; the blind round 3 caught the prose/test mismatch above. Plan in
  `plans/oai-31-guards-that-bite.md`.

- **OAI-24** — Record what the SERVER was doing. Completed 2026-08-03 **as a decision, not an
  instrument** — the driver it produced was withdrawn from its own commit and is now OAI-34's to
  finish. **The item asked which of three options to take and the answer was none of them** — and
  then none of the design that replaced them either, which is the part worth keeping.
  **What shipped:** the decision and its rationale (ADR 013), ADR 012's false "not observable from
  the client" corrected, the unprovenanced "~10 minute TTL" corrected wherever it appeared, a reader
  for evidence already recorded (`byFirstText`), and a new `.claude/REPO_TRAPS.md` class. **What did
  not:** `bench/ttl-challenge.mjs` and `bench/lib/ttl-verdict.mjs`, stashed rather than committed
  (`git stash pop`, or `873dc05`) with ten open findings and a production-code prerequisite, OAI-35.
  **All three filed options were refuted, not merely declined.** Sampling residency around a run
  (options b and d) suffers temporal aliasing: a bracket spanning several attempts and many minutes
  cannot tell "loaded throughout" from "unloaded then silently JIT-reloaded". A per-attempt plugin
  probe (option c) has the resolution but may reset the very timer it measures, costs 2s on a path
  where `--max-seconds` already binds, and leaks a vendor dialect out of `model-info.mjs`. Their
  replacement — a matched TTL crossover over the corpus — died too: TTL is assigned per *block*, so
  the independent n is blocks not requests, and at 3 per arm the best two-sided p is 0.25. Reaching
  9–12 pairs costs 3–4h on the MoE, which is the **wrong model** (prefill ~5× faster, never
  approaches the TTL), and 9–12h on the dense.
  **The premise turned out weaker than the file claimed, which is what made the cheap design
  possible.** Measured dense prefills — `scaffold` 335s, `model-info` 286s, `structured` 191s — all
  sit *below* the ~600s the hypothesis assumed, and the "~10 minute idle TTL" had **no provenance
  anywhere in the repo** (LM Studio documents a resetting timer, 60-minute JIT default). So:
  falsify rather than estimate: shorten the TTL to 120s against a 335s prefill — the most favourable
  condition the mechanism could get — where three survivals refute its deterministic form in ~45
  minutes. Specified in ADR 013; **building and running it is OAI-34**.
  **Reading a real `lms ps --json` corrected the design twice.** It reports `ttlMs`, so the applied
  treatment is confirmed from the server rather than assumed from an exit code — a draft comment had
  asserted the opposite. And it reports `lastUsedTime`, the idle timer's own anchor, which is a far
  more direct instrument than waiting for an unload: whether it advances during a long prefill is the
  hypothesis in the server's own terms. Recorded, deliberately not acted on.
  **The driver's worst defect was demonstrated by accident.** `main()` sat at module scope, so
  importing it for its unit tests *ran the experiment* — against a server that was down, adding 44s
  to the suite and writing a junk record. An earlier draft then rendered `inconclusive-failure`, a
  verdict about the mechanism, from a run in which no request ever reached the wire. In the draft this
  became an `instrument-failed` outcome that refuses to describe the server at all, plus a test
  pinning the entry-point guard — the symptom is slow and quiet rather than red.
  **Review pass 1 found eight more of the same shape, and that is the finding.** Three lenses —
  `advisor`, both Codex stages, and a wide `review-lean` — converged on one class: **a guard that
  narrates instead of refusing.** `calibrate` printed `ABORT` and continued; a *failed* calibration's
  1,800s timeout read as a 1,800s prefill; the verdict used the TTL that was *requested* rather than
  the one `lms ps` confirmed; a survival stood even when residency showed an unload; the post-exit
  sample counted as evidence of a mid-request unload; `activityObserved` measured across generation
  while claiming to measure prefill; and `summarize`'s fallback said "No episode stayed in flight
  past expiry" for sweeps in which one did. Every one would have let the experiment answer
  confidently from a run that tested nothing — the exact failure OAI-24 exists to prevent, inside
  OAI-24's own instrument. All fixed **in the stashed draft**, each with a test that fails without
  the fix; none of it is committed.
  **Scope, stated precisely because the batch is about overclaiming.** The wide verifiers corrected
  one of these downward: a short calibration could *not* fabricate `deterministic-form-refuted`,
  because `episodeVerdict` applies the same margin per episode, so an under-exposed sweep lands on
  the honest `no-exposure` branch. The confirmed harm was the false `ABORT` string, a zero exit code,
  no machine-readable disqualification in the record, and ~45 minutes spent on a run the gate had
  already rejected.
  **Then pass 2 found ten more — one of them introduced by pass 1's own batch — and the driver was
  withdrawn.** Two let it issue `mechanism-reproduced` from evidence that did not support it (an
  unload during *generation*; an unload past `ttlMs` in an episode that was never an exposure), and
  one disabled two of pass 1's fixes on the failure path, because `runEpisode` read a top-level
  `prefillMs` the failure envelope does not carry. The decisive one was not in the driver at all:
  **the attempt record drops `serverResponded`**, so a mid-prefill eviction before first token is
  indistinguishable from a connection that reached no peer — the instrument is blind to its own
  target event, and fixing that is production code OAI-24's plan forbade — filed as **OAI-35**, which
  **OAI-34** is blocked on. Every finding is written down there; the criterion for withdrawal was
  fixed *before* the last pass ran, so it was not chosen against the defect that turned up.
  **The lesson worth keeping**: eight defects in pass 1, ten in pass 2, in logic that had never
  executed against a real server. Review found every one of them and review was not converging —
  which is an argument for running the thing against a stub early, not for reviewing harder.
  **Also shipped: the reader for evidence already recorded.** `attempt-outcome.mjs` had been keeping
  timings on *failed* attempts so the record could say "whether failures cluster before or after the
  first token" — its own words — and nothing read them. `bench/lib/attempt-rows.mjs` now splits
  failures on whether a prefill was measured, with the claim bounded to what that proves: the attempt
  crossed the first-text boundary, not why a later stream died, and absence is not evidence of a
  cause. Near-empty until OAI-19 runs; the whole corpus holds one failed attempt.
  **No production plugin code changed.** Corrected `adr/012:230`'s false "not observable from the
  client". Partially discharged OAI-31 item (1). See
  [ADR 013](adr/013-observing-the-server.md).

- **OAI-26** — Explain `shape-rejected` and `non-retryable-transport` in the reliability report,
  where they appeared bare. Completed 2026-08-02. Prose only, as filed: no schema change and no
  change to counting — `byReason` already tallies every failed attempt's reason, so both codes were
  in the table and only the explanation was missing. What shipped is three gated paragraphs in
  `bench/lib/reliability-report.mjs`, each on its OWN code, plus the tightened `refused` paragraph
  the item asked for.
  **~~"Point the reader at `.code`"~~ — struck, refuted three times over.** The item instructed the
  paragraph to send the reader to `.code`; the plan gate refuted it (the attempt record has no such
  field), the replacement "the code is not carried in this report" was refuted by the pass-1 wide
  review (`report.mjs` prints a dead run's whole stderr, and a Node syscall message embeds the code),
  and the third try, "the listing usually names the underlying code", was refuted decisively in
  pass 2 — a TLS rejection's message is the words "certificate has expired" and contains no
  `CERT_HAS_EXPIRED`, so it was false for exactly the examples the paragraph itself cites. The
  shipped paragraph therefore says nothing about where a cause can be found.
  **~~"It must not be called a reachability finding"~~ — also struck, and this one came from the
  item itself.** `ENOTFOUND` and `ECONNREFUSED` are deliberate exclusions from
  `TRANSIENT_CONNECT_CODES`, so they carry `non-retryable-transport` and reached no peer at all. The
  instruction was true of the three examples it named and false of the class. The shipped text says
  the code records a retry decision and does not establish whether a peer was reached, naming both
  directions.
  **The review cost more than the change and earned it.** Three passes; the two defects nothing else
  caught both came from wide mode, which is why the trigger was pulled on a prose-only change. The
  recurring defect — prose asserting a property of a whole class from examples covering one
  sub-population — is now a `.claude/REPO_TRAPS.md` class with **six** confirmed instances, three of
  which landed *after* the entry documenting it was written. Pass 3's five open findings are carried
  by **OAI-31**, which is the honest cost of the no-mutation rule rather than a clean finish.

- **OAI-25** — Make the `postWithDegrade` cap-ordering invariants reachable behaviourally, instead of
  only structurally. Completed 2026-08-01. **The item's own premise was half-refuted by the probe,
  which is the part worth keeping.** OAI-25 asked whether anything was left to buy and suggested not:
  "the already-expired case is behaviourally tested, and what remains is guarded structurally
  instead". The second clause was false. `tests/structure.test.js`'s two guards each justified
  themselves with a claim that the ordering *could not* be reached behaviourally — and moving
  `capBudgets` below `ledger.begin` turns `tests/failure-shape.test.js:224` red, which was already
  true before this change. The guards were asserting something the suite disproved.
  **The seam was also unnecessary.** OAI-25 proposed injecting a `now` parameter into the budget
  calculation and flagged that changing production code for testability deserved its own grill. It
  does not need one: `capBudgets` reads the bare global `performance.now()`, so replacing
  `globalThis.performance` in a test reaches it and **zero production bytes changed**.
  **What landed.** `tests/cap-ordering.test.js` drives the real `postWithDegrade` loop under a
  controlled clock, advancing it at named semantic boundaries rather than by counting clock reads:
  after `ledger.begin` for OAI-22's carried-budget rule (red if `postChat` recomputes the cap), and
  inside the handle's `refuse` for the OAI-23 window this repo's prose named but nothing drove — a
  capability refusal whose replacement the cap refuses, which must stay `failed`/`shape-rejected`
  with no phantom second entry. Both proved by mutation. Both guards kept, with their rationale
  rewritten to say what they actually do: localize the contract, not substitute for cover.
  **The class it produced, and its third instance.** A guard justified by "this cannot be tested"
  carries an untested claim, and it is self-protecting — a reviewer who reads it stops looking for
  the test. The feature reproduced the class *in its own fix* (a comment claiming "No mutation
  distinguishes the two placements", from one experiment) and review caught it; a third instance
  survives at `tests/structure.test.js:279,287` and is filed as **OAI-30**. Recorded in
  `.claude/REPO_TRAPS.md`. See [ADR 012](adr/012-surviving-the-server.md).

- **OAI-22** — Retry only what a retry can fix; check the cap once; warm the model that is about to
  run. Completed 2026-08-01. Three bounded fixes, and **the review refuted the premise of the first
  one**, which is the part worth keeping.
  **The transport split.** `transport` was one bucket and `isRetryable` said yes to all of it, so a
  TLS certificate rejection cost three requests and two 2-second sleeps to establish what the first
  proved. It is now `transport` (retryable: the post-headers cut, plus pre-response codes on a
  transient whitelist) and `non-retryable-transport` (everything else pre-response, including
  unknown and absent codes — the same whitelist direction `RETRYABLE` already took). Decided at the
  **call site** via a `delivered` flag, not by reading `error.code`: measured on Node 26.3 a
  mid-body cut arrives as a code-less-in-principle `Error: aborted`, so code-only classification
  would file the most retryable shape here as terminal on a version that omits it. The name
  `unreachable` was rejected — the pre-response path carries TLS, protocol and parser errors, all of
  which *reached* a peer. **The axis is retryability, never blame.**
  **What the review found, and what it cost the premise.** The backlog claimed an unresolvable
  hostname was retried three times. It was not: `provider.mjs` `describeFailure` rewrote
  `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN` into *fresh* errors carrying no `reason`, `code` or
  `cause`, so they arrived unclassified and unretried — verified end to end. The real defects were
  worse for OAI-19 than the claimed one: those attempts tallied as `unclassified` in the very
  `Failures by reason` table it reads, and `EAI_AGAIN`, which genuinely should retry, never did.
  Fixed by `reword()`, which carries the classification through the better message. Every earlier
  test passed because they called `transportError` directly, one layer below where the verdict was
  being discarded. **Methodology: a probe claim about what a value *reaches* must name the
  consumer, not the producer.**
  **One cap evaluation per dispatch**, carried into `postChat` instead of recomputed there — closing
  the last gap OAI-23 left, where a cap falling due between the two checks left a `refused` entry
  beside a phantom `failed` one. **Warm-ups interleave** on each change of resolved pair; grouping
  the corpus by pair was rejected because it reorders cases, and residency, prompt cache and thermal
  state are shared mutable state. That third fix is **latent for OAI-19**, which runs one arm per
  invocation with `--model` and so resolves to a single pair — the backlog paragraph claiming
  otherwise was wrong and is corrected. Also here: `chat.mjs` crossed its size budget a third time,
  so stream reading moved to `scripts/lib/stream-collect.mjs`. See
  [ADR 012](adr/012-surviving-the-server.md) and [ADR 006](adr/006-benchmarking-the-reviewer.md).

- **OAI-23** — Tie a `refused` reclassification to the replacement request actually being dispatched.
  Completed 2026-08-01. `refused` is the ledger's third outcome, meaning the server rejected the
  request's SHAPE and the plugin then sent a different one that worked — benign negotiation,
  excluded from the failure count. Both call sites *stated* it before the replacement went out, and
  the replacement could then never go out at all, so a run that died could read `0 failed,
  1 refused`: a terminal failure dressed as negotiation, understating exactly the reliability figure
  OAI-19 reads.
  The fix makes it structural rather than ordered. `refuse()` and `refuseLast()` now close the entry
  as the failure it is and *register* a pending reclassification; `attempt-ledger.mjs`'s `begin` is
  the only place `refused` is ever written, and it writes it as the first act after the replacement
  entry exists — no replacement, no reclassification. An abandoned refusal keeps a named terminal
  reason, **`shape-rejected`**, because a 400 carries `.status` and never `.reason` and the bench
  would otherwise tally it as `unclassified` beside genuinely unrecognised failures. A *flipped*
  entry keeps `reason: null`, deliberately, so it stays byte-identical to the records OAI-19 is
  differenced against. `attempt-ledger.mjs` crossed the file budget and split, with
  `attempt-outcome.mjs` taking what one request's ending means. See
  [ADR 012](adr/012-surviving-the-server.md).
  **The end-to-end deadline test the original entry asked for was not written, and that is a
  finding rather than an omission.** The transport arms the remaining wall-clock cap as its own
  deadline, so a request cannot *complete* after expiry — which leaves the window between a refusal
  and the next `capBudgets` only a few call frames wide. An e2e trying to land an expiry inside it
  would be a coin flip, and a flaky test is worse than none. What shipped instead: unit coverage on
  both call-site APIs with no following `begin()`, positive controls driving each call site's real
  sequence end to end, the existing oversize e2e extended to assert the reason, and — after the wide
  review proved by mutation that nothing pinned it — a **structural guard** that `capBudgets`
  precedes `ledger.begin` in `postWithDegrade`. Moving that call had left all 370 tests green while
  reopening the defect; the guard is now the only thing that catches it, and the class went into
  `.claude/REPO_TRAPS.md` as *an ordering that carries an invariant, pinned by nothing*.
  Two residues are recorded, not hidden. Ledger-entry creation is still not proof of *dispatch*,
  because `postChat` checks `capBudgets` a second time before `request()` sends — imprecise rather
  than false, since the run still reads as dead, and closed by **OAI-22**'s compute-the-budget-once
  fix, which is the only fix for it. And whether the structural guard should be a behavioural test
  behind an injected clock is **OAI-25**, raised in the terminal review pass.
  Review: three ladder passes, no stage skipped. Pass 1 accepted two findings, pass 2 three, pass 3
  terminal with two recorded. The wide stage died once at its scope agent and was resumed rather
  than read as clean.

- **OAI-20** — Survive the server: classify LM Studio's delivery failures and retry the attempt.
  Completed 2026-07-31. Four shapes now carry structured reason codes assigned where they are
  detected — `empty-completion`, `stream-unfinished`, `transport`, and a **fourth the item did not
  know about**: `applyText` sets `sawContent` for any string including `''`, so a reply of
  `content: ""` passed every guard and reached the caller looking successful, was reported as "the
  model did not return findings in the requested shape", and was filed by the bench as *unreadable*.
  A dead request recorded as a bad answer, which is the censored-denominator trap one layer below
  where this file already caught it. `answerWithRetry` retries only whitelisted shapes, spanning
  `postWithDegrade` **and** `finishAnswer` because the transport raises one shape and `finishAnswer`
  raises three. `--max-attempts` counts **answer attempts** (default 3) rather than physical
  requests — capping requests at 1 would have disabled capability degradation instead of retry — so
  `--max-attempts 1` reproduces the old behaviour exactly and is the control arm.
  `scripts/lib/attempt-ledger.mjs` records one entry per physical request, and the bench renders
  `## Physical-attempt reliability` beside the recall table with **both denominators stated
  together**. Three things review found rather than the plan specifying: an entry must settle only
  *after* `finishAnswer` judges it (`postChat` returns successfully for three of the four shapes, so
  closing at the transport would file dead requests as answered); a third outcome `refused` is
  needed or a server that refuses `stream_options` headlines a **50% failure rate while answering
  100% of shaped requests** — and it must be recorded by the layer that sends the replacement, never
  inferred from a status, because a context-limit rejection is also a 400; and `warmEligible` needs
  evidence of *model execution*, not prompt identity, or every degraded run's prefill is silently
  deleted from the benchmark's cold samples. **Not proven sufficient**: these are the shapes
  observed, and whether retry recovers the 37.5% is a measurement OAI-19 reads off the new record.
  Server state is not recorded — it is not observable from the client. See
  [ADR 012](adr/012-surviving-the-server.md).
- **OAI-21** — The bench keeps its own evidence and pays the model load itself. Completed
  2026-07-31, alongside OAI-20 as the item directed. The rendered report is written to `<stamp>.md`
  beside `<stamp>.json` under one stamp computed before rendering; `--warm-up` sends one unscored
  request per **distinct resolved provider/model pair**, carrying the invocation's budgets, and the
  record states that it ran. *(Those mechanics were superseded 2026-08-01 by **OAI-22**: warm-ups
  now fire on each **change** of resolved pair rather than once per distinct pair up front, because
  warming them all in advance let the last evict the first on a single-resident provider.)* Two things only running it revealed: the first version built the argv
  prompt-before-flags, which `/oai:task` refuses — and because warm-up records rather than throws,
  an arm would have carried on having warmed nothing (84ms against the expected ~11s was the only
  tell); and the outcome field is `answered`, not `ok`, because a reasoning model spends its budget
  thinking and exits non-zero on a request that loaded the weights perfectly well. See
  [ADR 012](adr/012-surviving-the-server.md).
- **OAI-16** — Say when the served model is not the requested one, and select the loaded one.
  Completed 2026-07-29. The probe made the first half considerably worse than the item described.
  **The item said a stale pin got substituted; the truth is that *any* wrong id does.** Reproduced
  live in a single call: `POST /v1/chat/completions` naming `totally-not-a-real-model` returned
  **HTTP 200 and a normal completion from `qwen/qwen3.6-27b`**, the model that happened to be loaded.
  Not a stale-config problem — a server that answers as something else whenever it is asked for
  anything it does not have. `jsonReport` already recorded the served id correctly and *nothing
  compared it to the id requested*, so the fact was recorded and never used: a benchmark arm could
  spend its whole wall clock on a model it did not claim to test and leave a clean-looking record.
  Now one predicate — `substitution()` in `scripts/lib/model-identity.mjs` — is the only comparison,
  used by the footer, the stderr warning and the bench alike. It is **exact, never `matchKey`**,
  because the second probe finding is that `@4bit` is a real identity: requesting
  `qwen/qwen3.6-27b@4bit` made LM Studio try to load a *different* model and fail on resources, so
  normalising the suffix would hide precisely the quantization swap that contaminates an A/B arm most
  quietly. It returns null when either id is missing — absent is "nothing was determined", never
  evidence of a swap.
  **Caught twice, and the second catch is the one the item asked for.** Before the run,
  `planSelection` refuses an id a recognised catalogue does not list, on both the `--model` and
  `defaultModel` paths, so a wrong id costs milliseconds rather than a full run. After it, the footer
  renders `model: <served> (requested <requested>)` — inside the `model:` field rather than on a line
  of its own, because that is the field a reader consults to learn which model produced the output —
  plus a stderr warning. A substitution **warns and never fails**: the work is already paid for, and
  ADR 008 records what discarding runs cost when it was tried.
  **The second half: refusing while holding the answer.** `planSelection` refused with "offers N
  models" while `readLmStudio` was already reading each model's `state` and using it only to gate a
  context window. It now selects the one the server reports `loaded` — a fact being read, not a
  guess, since ADR 002 already treats `loaded` as authoritative (it is why `loaded_context_length` is
  trusted and `max_context_length` is not), and the OAI-2b defect it warned against was taking the
  *first* entry, which is arbitrary. Two conditions gate it, both from the plan challenge: every
  candidate must carry a **recognised value** (`state: entry.state` creates the key even when
  undefined, so presence proves nothing, and partial coverage would draw a conclusion over a subset),
  and every record must have been **joined on an exact id** (the `matchKey` join is conservative for
  the embeddings denylist but would become a routing decision here). "None loaded" and "several
  loaded" each get their own message; nothing measured says a server holds only one model resident,
  so the code does not depend on it.
  **The reviews changed the shape of this twice, and both are worth recording.** The first version
  left the up-front refusal *opportunistic* — `resolveTarget` probed only for what the config left
  unanswered, so a profile setting both `defaultModel` and `contextLength` never fetched a catalogue
  and never got the check. That shipped documented and tested as a deliberate compromise, and the
  built-in review showed the framing was hiding a defect: `/oai:setup` probes **unconditionally**, so
  it *did* refuse, printing `No provider can take a task right now` about a task that ran fine.
  That is this repo's signature class with its sign flipped, and it defeats the cure ADR 002
  prescribes for it — **one authority is not enough when its two callers feed it different
  evidence.** `resolveTarget` now always fetches the list, superseding an ADR 002 consequence; the
  cost is a `/v1/models` GET on a path that was about to post a whole prompt anyway, and the
  recommended config (no `contextLength`) was already paying it.
  Second: membership is tested against the **union** of `/v1/models` and the dialect's own catalogue.
  Keying it on `/v1/models` alone refused a model the dialect reported `loaded` — the one the server
  had resident — whenever that list was narrower. The adversarial review raised this at 0.98
  confidence, **it was dismissed**, and the lean review then reproduced it end to end. The refusal is
  also gated on the dialect having published a per-model catalogue rather than merely being
  recognised: llama.cpp and TGI are recognised, publish no list, and ignore the requested name, so
  the stricter gate would have broken a working setup.
  Benchmark side: a substituted run is recorded **failed** with reason `model-substituted`, rendered
  as `(N substituted)` inside the failed cell and in its own report section — not under "Runs that
  did not complete", because it did complete. Deliberately a different call from a truncated run,
  which ADR 008 scores: a cut run is this model measured incompletely, while this is a *different*
  model measured correctly, so the number is not uncertain but mislabelled. Two latent defects fell
  out of that: the timing, throughput and prompt-size samples gated on a report alone and would have
  contributed wrong-model figures to a row that disowned the run, and the `scored` bucket was the one
  of four with no `!run.error` guard — held together only by `run.mjs` declining to attach a score,
  the exact cross-file fragility `unreadableRuns` documents about itself.
  Leaves for **OAI-11**: which model answered is now per-run evidence rather than a config
  assumption, which is what cross-model passes need.
  See [ADR 011](adr/011-which-model-actually-answered.md).

- **OAI-17** — Bound a run in wall clock, and report what it generated per second. Completed
  2026-07-29. Three gaps, and the probe reshaped two of them.
  **Nothing bounded a run that was working, and the item did not know that.** It asked for a bench
  `--timeout`, but `--timeout` names the wait for the *first* token only: once text arrives that
  budget is retired and the idle budget takes over, resetting on every text-bearing frame. Confirmed
  against the code by an independent read — *"there is no absolute total deadline for the streamed
  response"*. With ADR 009's own figures (generation spanning 165–747s on one case), a six-case
  corpus at N=3 had no worst case at all, which is the thing that actually blocks OAI-11. So the
  feature added `--max-seconds` as well as forwarding `--timeout`: a wall-clock cap on the model
  call, opt-in with no default, arming the transport's `deadline` budget from **one expiry minted per
  command and shared by every retry**. That last part was a plan-challenge correction, and the reason
  matters: the first draft armed a fresh cap per attempt, so three attempts under `--max-seconds 600`
  could have run 1,800s with each honouring its cap — and its defence, that refused capabilities cost
  nothing, is a claim ADR 009 had *already recorded as unverified*.
  **A timeout was indistinguishable from a model failure in the record.** The reason was structured
  internally all along (`error.reason`) and thrown away at the exit, which left `bench/run.mjs` a
  prose blob to pattern-match — the class this repo files as OAI-13 items 1 and 2. Now `--json` is
  machine-readable on **both** paths: a failed run prints `{error, reason, message, hint}` to stdout
  and still exits 1 with the same prose on stderr, and the bench records `reason` beside the stderr
  it already kept. The envelope covers everything after argument parsing, guards and internal crashes
  included; the single stated exception is a malformed command line, because parsing is what
  establishes `--json` was passed at all.
  **Nothing reported a rate.** `tokensPerSecond` divides the reply's `completion_tokens` by
  `generationMs` — never `durationMs`, which would fold a 421s prefill into the divisor and read ~7×
  low — and appears in the `/oai:review` footer and a `gen tok/s` benchmark column, per run and
  ranged, never `sum(tokens)/sum(ms)`. The figure is named for what it is: **provider-reported
  completion tokens per measured generation second**. An earlier draft called it "thinking included",
  which the plan challenge refused as a vendor convention this repo cannot confirm.
  **The item's motivating number was stale and is not repeated.** It said runs "died on the 300s
  client timeout"; that is the pre-ADR-007 undici cap, and the default first-token budget has been
  600s since. The gap was real, the figure was not current.
  Three defects were caught in this feature's own code before it shipped, all by the delta
  re-challenge: `serverResponded` captured at arm time (always false) rather than read in the timer
  callback; a live cap reporting its *remaining* time as the configured number; and a tie-break that
  relied on `setTimeout`'s FIFO ordering, which Node documents as approximate. The last is now
  suppression rather than a race, with all four cases of the truth table pinned — including a cap
  *longer* than the first-byte budget, the only one that proves the rule is a rule.
  **Live, and quoted here because `bench/results/` is gitignored.** `config-origin --runs 2` on the
  dense 27B rendered `prompt tokens 1575 | prefill s 1–3 | generate s 81–265 | gen tok/s 14.5–16.6`.
  That row is the argument for the column: generation spread **3.3×** on an identical prompt while
  the rate spread **1.15×**, so the model was not varying in speed, it was varying in how much it
  chose to say — and `81–265` alone reads as the opposite. The same case under `--max-seconds 20`
  produced `failed: 1 (1 timed out)` with `reason: "deadline-timeout"` in the record, cut after
  82,775 characters, and the hint that rendered was the mid-generation one rather than the
  nothing-arrived one — the conditional a Codex finding added.
  **Six defects in this feature's own code were caught before it shipped, none of them by the tests**
  — a per-attempt cap, a flag captured at arm time instead of read at fire time (twice, the second
  by copying the first fix's shape without its wrapper), a cap reporting its remaining time as the
  configured one, a FIFO-dependent tie-break, a cap above ~24.8 days that would have fired
  immediately, and a hint claiming the model was generating on the strength of raw SSE bytes. That
  last one is the instructive one: the branch existed only because an earlier reviewer objected to a
  hint claiming more than was known, so a fix for one false assertion introduced another from a
  worse signal. Three of four review finders converged on it independently.
  296 tests green (275 at the start). See [ADR 010](adr/010-bounding-and-rating-a-run.md).

- **OAI-18** — Measure prefill and generation separately, and pin the corpus commit. Completed
  2026-07-29. The bench reported one wall-clock number per run and ranged it across `--runs 3`; that
  number is two quantities added together, and a server-side prompt cache moves one by ~37× and
  leaves the other alone. Measured on one 56,805-token prompt, three consecutive requests: first
  token at **421,660 ms cold and 11,457 / 10,257 ms warm**, generating ~3 s in all three. So a
  `seconds` cell reading `13–425` was one cold run and two cache hits, printed as a spread in the
  reviewer. `chat.mjs` now stamps the first frame carrying text and the end of the stream, and
  `prefillMs`/`generationMs` reach `--json`, the text footer and two benchmark columns that replace
  `seconds`. Live, after the change: `model-info` at 41,010 prompt tokens over two runs reported
  **prefill 7–289s and generation 398–726s** — a 39× spread the report computed itself, beside a 1.8×
  spread that has nothing to do with the cache. Welded together, that row read `687–1015` and looked
  like ordinary variance.
  **The claim that generation is comparable is false and was written twice before it was caught.**
  The adversarial review refuted the first version; the first live run to print the second version
  disproved it in its own row (`config-origin`: prefill 1–10s, generation 165–747s). The cache not
  touching generation and generation being comparable are different claims — the tidy contrast keeps
  inviting the second. The note now states only the ratio it counted, and the tokens-per-second
  quotient that would make generation comparable is OAI-17's.
  `--cold` verified live on `config-origin --runs 3`: prefill `10–10s` against `1–10s` without it —
  three independent cold samples instead of one cold and two hits — and the report swaps the cache
  caveat for a statement that the flag was on.
  **The `prompt tokens` column was the same defect, one column to the left.** It summed
  `usage.prompt_tokens` across runs, which is invisible at N=1 (every figure in ADR 006 came from an
  N=1 sweep) and wrong by a factor of `runs` after that: it printed 82,020 for a case ADR 006 records
  at 41,016. Caught by checking why two live runs disagreed on a figure that is a property of the
  input, *after* every review stage had passed over the diff. Now per-run, ranged when the runs
  genuinely differ, with the ADR's own pasted table corrected.
  **The item proposed two options and the probe killed one of them.** "Accept warm runs and report
  cold and warm separately" has nothing to label from: LM Studio publishes no `cached_tokens` and an
  empty `stats`, and position is not evidence — a *first* call in a fresh process came back warm at
  956 ms because an earlier process had prefilled the same prefix. So the cache is measured, not
  classified, and `--cold` (via a new `/oai:review --cache-buster`) buys independent runs when they
  are wanted. Busting always was rejected on cost and fidelity: three cold runs of that case cost
  ~21 min of prefill against ~7.5, and real `/oai:review` usage is warm.
  **Generation is measured, not derived, and that came from the plan challenge.** The draft computed
  it as `durationMs - prefillMs`, which is not generation — `durationMs` starts before prompt
  building and any rejected `response_format` attempt, so a schema rejection alone would have shown
  as seconds of "generation" for a reply that generated instantly.
  **A Codex probe check also refuted the claim that the bench sends the same bytes twice**, which
  nothing had noticed: `materialize()` builds a fresh repo per run and `--commit HEAD` sends
  `git show HEAD`, so the commit sha and date differed whenever two runs fell in different clock
  seconds. Inside one second they agree — which is what a test reproduces — and minutes apart they do
  not, which is what a real run reproduces. Now pinned. Note the consequence: this removes an
  accidental cache bust that applied to `--diff-only` alone, so **that arm's timings from before this
  change are not comparable with figures after it.**
  See [ADR 009](adr/009-measuring-prefill-and-generation.md).

- **OAI-15** — Size the reply from the budget the run actually has, and stop discarding the runs the
  cap censors. Completed 2026-07-28. The `analysis` ceiling was a flat 28,000 characters while the
  budget paying for it shrank per run, so the two agreed only by coincidence — and on the largest
  input they did not: `scaffold` sent `max_tokens: 11,043` against a schema envelope of ~15,695
  tokens. `scripts/lib/review-schema.mjs` now derives the cap from the reserve granted
  (`reviewSchemaFor`), clamped between a floor and a **wall-clock** ceiling of 74,000 characters
  (~28 min of generation on a dense 27B; verified that LM Studio compiles a grammar that large before
  relying on it). `REVIEW_MAX_TOKENS` rose 16,384 → 32,768 where the window is known, reversing
  ADR 004's refusal on the evidence that made it — **the cost it feared no longer existed**, because
  the `minReserve` shrink recorded in that same ADR means a review is refused only when under 4,096
  tokens remain, whatever the constant says. BACKLOG's "the tension is real and is the whole
  decision" was describing pre-`minReserve` behaviour.
  **The reserve was never the constraint — the accounting was.** On five of six cases the reserve was
  ~55,700 characters while `analysis` got 28,000, because ~24,500 was held back for a 20-finding
  reply. Six is the most any reply has ever carried, so the budget now reserves for eight; the schema
  still permits twenty and the rare overrun fails loudly. **That eight is a policy bet, not a
  measurement** — every observation behind it was taken under the old cap, and more room may itself
  produce more findings.
  **The half that changed most is what a censored run is worth, and it came from the plan challenge
  rather than the code.** Both obvious readings are wrong: discarding cut runs threw away 17 of 41
  recorded runs carrying two of the four anchored matches ever produced, while folding them in counts
  every finding the run never reached as a confirmed miss. A truncated run's positives are
  trustworthy and its absences are unknown, so `defects found` now reports **only what was observed**
  and a new `unresolved` column says how much of the denominator is uninterpretable, with the upper
  bound stated in prose. A low–high band was built first and removed by the adversarial review: an
  unobserved figure printed under a heading that says "found" made a wholly censored run
  indistinguishable from a perfect one. Rows with nothing cut are unchanged, so past figures stay
  comparable.
  **Measured after the change** (3 runs, `config-origin`, dense 27B, derived cap 74,000): analysis
  lengths **7,075 / 19,942 / 21,240, cut 0 of 3** where that case cut 6 of 9 before — and the right
  edge of the distribution is observable for the first time, since every value at the old 28,000 was
  previously indistinguishable from one that would have run to 90,000. The longest run stopped
  *below* the old ceiling, which contradicts ADR 004's "the model fills whatever it is given" for
  this model and case. Read no further than that: one case, one model, N=3; `structured` (4 of 4 cut)
  and `scaffold` (4 of 11) have not been re-run; **all three runs found nothing**, so this buys
  measurement, not review quality; and it costs wall clock (129–363s against 49–156s).
  Nothing claims the reply fits its budget: `RESERVED_CHARS` is documented as an estimate
  (`maxLength` caps decoded strings, not serialized JSON; `line` has unbounded width;
  `CHARS_PER_TOKEN` was calibrated on input code), and the tests assert the formula rather than a
  guarantee. See [ADR 008](adr/008-sizing-the-review-reply.md).

- **OAI-6 + OAI-17a + OAI-8** — Streaming, and owning the timeouts it exposes. Completed 2026-07-28.
  `timeoutSeconds` never worked above five minutes: Node's `fetch` is undici, undici applies its own
  300s `headersTimeout`, and an `AbortSignal` beside it can only *lower* the bound — so the real
  limit was always `min(timeoutMs, 300_000)` and **14 of 18 benchmark runs died** with 1800 in the
  config. `scripts/lib/http.mjs` now owns the request on `node:http`, streaming chat completions as
  SSE. **The obvious fix was not enough, and finding that out is the result worth keeping**: streaming
  moves the wall from `headersTimeout` to `bodyTimeout` rather than removing it, because prefill emits
  no body — a cache-busted 52k-token prompt took **393.7s to its first token** (9.3s warm). OAI-17a's
  own text claimed streaming would settle it; that claim was written before it was measured.
  **The budgets bound tokens, not bytes**, which is the correction the plan challenge forced: an SSE
  keepalive comment, a role-only delta and a half-delivered frame are all socket activity proving
  nothing about generation, so a byte-driven budget would have let `:\n\n` every 30s run forever while
  reporting itself armed — the defect class the feature exists to remove, reintroduced by its own fix.
  The transport bounds `firstByteMs` plus an optional absolute `totalMs`; the first-token and idle
  budgets live in `client.mjs` and reset only on a parsed delta carrying a string. `totalMs` is what
  keeps `/oai:setup` safe, since its probes are bounded totals today and it awaits every provider.
  Chosen over a working `Symbol.for('undici.globalDispatcher.1')` wrapper **on failure mode, not size**:
  the symbol is not public API and a future Node moving it would disarm the override silently.
  **OAI-8 closes because the heartbeat is timer-driven**, not delta-driven — a delta-driven tick is
  silent through exactly the prefill it was asked to cover, and closing the item on that would have
  been the reported-state-vs-actual class one level up.
  **Accepted on the benchmark, not on a demo.** `scaffold` — 47,069 prompt tokens, one of the 14 that
  died — now completes in **959 seconds** with `failed: 0`, and a live `/oai:task` over a 42,043-token
  cold prompt ran **444s** (≈295s of it silent prefill) where the old code died at 300s. What that does
  **not** buy is a score: the same run came back `cut: 1`, so 0 of 3 listed defects were scoreable. The
  dense-27B arm is unblocked and still unanswerable until OAI-15 sizes the `analysis` ceiling.
  Guarded by a new structural test — **nothing calls the global `fetch`** — with no exemptions, because
  the defect was an invisible default rather than a typo. Four defects were caught before commit that
  the suite would not have found: a `'data'` listener racing the consumer, a first-byte timer re-armed
  at headers (silently doubling the advertised budget), `idleSeconds` validated but dropped by
  `buildProfile` so it did nothing, and — found by the design review — **every existing test replying
  `application/json`, so all 198 would have taken the degrade path and reported a green suite with no
  streaming coverage at all.** Design in [ADR 007](adr/007-owning-the-transport.md).

- **OAI-12** — A labelled corpus and a benchmark harness. Completed 2026-07-28. `npm run bench` runs
  the shipped `/oai:review` against six committed snapshots of this repo's own history and scores the
  findings; `--runs N`, `--case <id>`, `--diff-only`. **It drives the real CLI through a new
  `/oai:review --json`, never a copy of the pipeline** — a bench that scored a reimplementation and
  reported it as the reviewer's score would be this repo's signature defect at the meta level, and
  `structured` (64,357 tokens against a 54,016 threshold) makes it concrete by falling to ADR 005's
  second rung where the others do not. **Baseline: 1 of 6 scoreable defects at N=1, 10.9 minutes** —
  11 catalogued, 5 unscored because their runs were cut. Two findings outweigh that number.
  Its first reading claimed context dilution was measured; **a three-arm run the next day retracted
  that** — the pair behind it varied mode and prompt shape alongside token count, and at N=3 the same
  case at half the tokens found nothing at all. The instrument refuting its own first headline inside
  a day is the item working as intended. What survived and grew: **the `analysis` cap bound on 2 of 6
  runs here and on 6 of 15 runs recorded overall**, both reporting nothing, wasting a third of the run
  and 45% of the corpus's defects with it — and it binds on the *smallest* input, not the largest.
  **The corpus is smaller than history claims, on purpose.** A defect is listed only if it can be
  pointed at in the snapshot; 8 further claims are recorded as dropped with reasons. Applying that
  rule caught **two of my own attributions being wrong** — a defect assigned to `65373a0`, which does
  not touch `config.mjs` at all, and one assigned to `8990173`, where the code did not yet exist —
  both of which would have scored the reviewer for missing code it was never shown.
  **The scorer was validated against hand verdicts before any number shipped** (3 adjudications, 3
  agreements), and immediately justified its design: the model placed the run's only true positive at
  line 83 when the defect is at line 90, so the cheaper file-plus-line-proximity scorer would have
  reported 0/11. **Two guards were earned from defects the corpus itself caused**: `node --test` with
  no path discovered the corpus's historical tests and ran them against today's tree, and a new
  flag-documentation check found `/oai:task` had been accepting `--system` undocumented.
  **The lean review then found six more defects, three of them the signature class** — including one
  in `review-report.mjs`, the module written specifically to stop a caveat being true on one path and
  absent on the next (instance 16). One of the six is why the baseline reads 1 of 6 and not 1 of 11:
  cut runs were entering the recall denominator as zeroes while this ADR claimed they were counted
  separately. Design in `adr/006-benchmarking-the-reviewer.md`.

- **OAI-14** — Review whole changed files, not bare diff hunks. Completed 2026-07-27. Each changed
  file is now sent whole alongside the diff, taken from the revision the diff describes (`git show
  <ref>:<path>` for `--commit`, the index blob for `--staged`), with `--diff-only` restoring the old
  behaviour. **The target class is gone: the "`positiveInteger` is not defined" false positive ran
  3-of-3 before and 0-of-3 after.** Honest scoring is 1 false positive → 0 with true positives
  unchanged at 0 — `1ea398f` is the commit that *fixed* the OAI-2 findings, so it is near-clean and
  the baseline's only output was the false positive. **This bought precision and says nothing about
  recall.** The diff-only arm stopped producing it too, via the new hunks-only prompt sentence, so
  the six runs do not isolate which mechanism does the work.
  **Shipped as a two-rung ladder, not the per-file shed the plan had.** The reserve arithmetic
  collapses to `fit ⟺ estimate ≤ contextLength − minReserve`, so the real threshold is 54,016 and
  the largest measured commit is 41,790 — shedding never triggers on observed data, and ordered
  largest-first it would have dropped `model-info.mjs`, the very file whose missing definition caused
  the false positive. Untracked and `--file` blocks are pinned and never dropped, so an empty review
  is impossible by construction. Cost: 2.5× the input, 4–10× the wall clock, and the `analysis` cap
  now binds in 2 runs of 3 — which makes OAI-8 more necessary, not less. A root-commit bug
  (`git diff-tree` lists nothing without `--root` where `git show` prints a diff) was caught by a
  test and is now a repo trap. **Four claims-vs-reality defects were caught before commit, none by
  the test suite**: the root commit, a subdirectory cwd reading nothing and reporting a normal run,
  a blanket "you have only hunks" asserted while whole files sat in the same request, and — found by
  the lean review, after I had already "fixed" the git-edges class and written the merge case off as
  safe from one trivial example — merges silently losing their bodies, plus an unreadable file
  vanishing with the prompt still vouching for it. Design in `adr/005-whole-files-for-review.md`.

- **OAI-10** — Bound the review reply so a runaway cannot eat a whole pass. Completed 2026-07-27.
  Every string and array in `REVIEW_SCHEMA` now carries a grammar-enforced ceiling, sized above every
  observed successful run; hitting the findings cap is reported rather than silently binning a
  defect. **Shipped as half the item it was written as.** "Raise the ceiling" was dropped on
  evidence: the failing run generated all 16,384 tokens it was allowed against 5,450 / 2,521 / 2,301
  for the runs that finished, so more room only buys a longer runaway. The prompt-side cap was
  dropped too — probing showed the reduction it appeared to give came from *steering the model to
  reason less*, which is an unmeasured recall trade and now an OAI-12 experiment. Probing also found
  that `maxItems` on a reasoning field with no floor collapses it to `[]` in six tokens, now a repo
  trap. **Both first-guess cap values were wrong and live verification caught them** — `evidence` cut
  a real finding, `analysis` cut mid-sentence and the run then reported none. Honest scope: a
  runaway now fails cheaply and parseably in ~70s rather than dead-ending on a truncation error, but
  the cut is not a rescue and this does not move the hit rate. Design in
  `adr/004-bounding-the-review-reply.md`.

- **OAI-4** — `/oai:review`: a local second opinion on the diff. Completed 2026-07-27, pulled ahead
  of OAI-3 so it could be used while building the rest. Strict `json_schema` findings read from
  whichever channel carries them, degrading to prompt-and-parse when a server refuses the schema;
  the target is collected in Node and includes untracked files. Fixed a shipped defect on the way:
  an empty answer was reported as success. Live-verified against LM Studio — five findings on a real
  commit in 32s, a 74.5k-token input refused before sending, and a false positive correctly refuted
  rather than fixed. Design in `adr/003-structured-findings.md`.

- **OAI-2 + OAI-2b** — Context-window auto-detection and embedder exclusion. Completed 2026-07-27.
  Probes by response shape across LM Studio, vLLM, llama.cpp, TGI and (unverified) oMLX, trusting only
  served windows over model ceilings; automatic model selection drops embedders and refuses to guess
  between several candidates. Live-verified against LM Studio with all hand-set config removed:
  detected 58.1k with attribution, picked the chat model over the embedder, and still refused a
  65.4k-token input. Design in `adr/002-context-window-detection.md`.

- **OAI-1** — Plugin skeleton + `/oai:setup` + synchronous `/oai:task`. Completed 2026-07-27.
  Live-verified against LM Studio serving `qwen3.6-35b-a3b-ud-mlx` (58k loaded window): `/oai:setup`
  listed the provider and model, `/oai:task` returned real model output through a `--plugin-dir`
  load, the context guard refused a 65.4k-token input before sending, and a 22.5k-token whole-repo
  summarization ran in 62s. Reviewed by advisor, the lean workflow, and a high-effort `/code-review`
  (15 findings total, all fixed). Design in `adr/001-generic-openai-compatible-plugin.md`.
