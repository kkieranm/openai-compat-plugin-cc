## 2026-08-18 — parked by the backlog sweep's worth bar

Forty-one items, all `not worth doing` — **never `refuted`**. Every one was verified against disk
this session by five independent scouts and every one came back STILL TRUE or an accurate description
of current state; **none was refuted**, which is exactly why the bar applied here is worth rather than
truth. The bar was applied to all 112 live items, not to a chosen subset: the 70 that survive were
held to the same test and these 41 name no instance of harm that has already happened. **Seventeen
say so in their own words** — OAI-29, OAI-39, OAI-48, OAI-53, OAI-73, OAI-80, OAI-87, OAI-92,
OAI-109, OAI-130, OAI-149, OAI-169, OAI-175, OAI-179, OAI-182, OAI-186, OAI-188 — and those quotes
are kept verbatim below rather than paraphrased. Checked against the silence
exception item by item — the exception requires the ITEM to argue that its failure mode destroys its
own evidence, and none of these does; several argue the opposite (OAI-169: "shows as an intermittent
stall... not as silent wrongness"). **Every reopening bar here is an INSTANCE, not an argument**: a
better-sounding case for one of these does not reopen it, because that is what parked it.

### OAI-29 — parked, `not worth doing`

**Why parked:** No dated instance. The item's own text prices it: *"Small, and immaterial at present scales — the cap is seconds, the slip is milliseconds"*. The mechanism is real — `postWithDegrade` computes one `capBudgets` result that `postChat` arms the timer from a few call frames later — but no run has been observed where the recomputed budget would have changed what the transport did.

**Reopening bar (an instance, with a date):** An observed run where the transport armed its timer from a stale remaining budget and the request outlived the `--max-seconds` cap as a result. Record the cap, the measured overshoot, and the date.

*Filing kept verbatim:*

- **OAI-29** — Let the transport ARM from a recomputed remaining budget, without letting it refuse.
  Filed 2026-08-01 from the OAI-22 adversarial review (Codex, medium/0.96), where the finding was
  accepted as a *claim* correction and its recommendation deliberately not taken. The claim: OAI-22
  carries one `capBudgets` result from `postWithDegrade` into `postChat`, so the `totalMs` the
  transport arms is computed a few call frames before the socket is written. There is no `await` in
  that gap, but `ledger.begin` serializes the messages for `promptChars` and `request` serializes the
  body again — milliseconds on a 60k-token prompt — so a request dispatched a hair after expiry is
  granted the duration that remained at the check. Codex recommended carrying the absolute expiry
  into the transport and validating it at arming time; that half was **rejected and stays rejected**,
  because a transport that can *refuse* at arming reopens exactly the phantom-ledger-entry window
  OAI-22 closed. The safe half was never done: recompute the remaining time at arming and use it for
  the timer *only*, never to reject. Strictly tighter than today, no new refusal path, and it makes
  the generosity exactly zero instead of merely small. Small, and immaterial at present scales — the
  cap is seconds, the slip is milliseconds — so it is filed rather than urgent.
  **Independently rediscovered 2026-08-01 during the OAI-25 ladder**, by a `review-lean` verifier that
  had run the mutation itself, which is worth recording because it also states the coverage boundary
  precisely: a `postChat` that re-armed *from the carried `budget.totalMs` duration* rather than
  re-deriving from `expiresAt` would pass both new `cap-ordering.test.js` tests **and** the
  `occurrences(post, 'capBudgets(') === 0` structural guard. That is not a hole in those guards —
  re-arming from the already-checked value does not reopen the OAI-22 window, and none of them ever
  claimed to cover it — but it means **this item's window is guarded by nothing at all**, so if it is
  ever done, it needs its own test rather than an assumption that the OAI-25 pair reaches it.

### OAI-39 — parked, `not worth doing`

**Why parked:** No instance. All five loose reads are reachable only by values today's callers do not produce, and the fifth's own illustration is a constructed record — `{status: null, prefillMs: 7}` — that has never appeared in a ledger. The item itself classes them as *"unreachable by an audit of today's call sites"*, which is a statement about reachability, not about harm observed.

**Reopening bar (an instance, with a date):** A real attempt record or serialized run carrying one of the named values — a `"false"` string in `warmEligible`, an absent `outcome`, an empty-string `run.error`, a non-object thrown into `withLedger`, or a `{status: null, prefillMs: N}` — together with the bad statistic it produced, quoted, with the date.

*Filing kept verbatim:*

- **OAI-39** — **Five** reads that hold only because today's callers behave — four of them one-line
  fixes and the fifth deliberately not one. *(Header corrected 2026-08-05: it said "Four reads" while
  the body has always listed five, the fifth being the one carrying a "do not touch this the same
  way" warning — exactly the sub-item a stale count invites a reader to skip.)* Filed 2026-08-04 from
  OAI-35's passes 2 and 3, where `codex-plain` and `codex-adversarial` raised them and they were
  rejected **only** as out of that commit's scope — every one predates OAI-35 and none was introduced
  by it. They are one item because they are one shape: *unreachable by an audit of today's call
  sites, rather than unreachable by construction* — and OAI-35 twice found that exact reasoning had
  quietly stopped being true, which is the whole reason they are worth the edit.
  1. **`attemptRows` counts `warmEligible` by truthiness** — `bench/lib/attempt-rows.mjs`,
     `all.filter(({ attempt }) => attempt.warmEligible)`. Any truthy value counts, the string
     `"false"` being the memorable one. Every sibling split in that function was tightened to a
     strict check during OAI-35; this one was missed.
  2. **`unresolved` tests `outcome === null` only** — same file. A serialized record that omits
     `outcome` carries `undefined`, so it increments `total` while landing in none of `answered`,
     `failed`, `refused` or `unresolved`. The totals then disagree with themselves, which is
     precisely the bug that bucket exists to make visible.
  3. **`runTotals` tests `run.error` for truthiness** — `bench/lib/reliability-report.mjs`. A failed
     run whose message is the empty string is reported as having completed, in the one line that
     states both denominators.
  4. **`withLedger` assumes the thrown value takes a property** — `scripts/lib/attempt-ledger.mjs`.
     `error.attemptRecords = ledger.entries()` on a thrown string or a frozen object throws a
     `TypeError` from strict-mode ESM, replacing the original failure with a confusing one at the
     exact moment the ledger was trying to preserve evidence about it.
  Each is a one-line fix plus a test that the bad value does not count — matching what
  `responseBucket` now does beside (1).
  **5. `reachedTheModel` reads `error?.status !== undefined` too — and this one is NOT a
  one-line fix. Read this before touching it.** It is the same loose check, in
  `scripts/lib/attempt-outcome.mjs`, sitting directly above the `obtainedResponse` that OAI-35
  tightened — so whoever does 1–4 will see the asymmetry and be tempted. The difference is the
  failure DIRECTION. A `status: null` makes it return `false` early, skipping the completion-shape
  and prefill checks below, so an attempt is left NOT warm-eligible. That under-marks, and ADR 012
  records under-marking as the deliberately chosen lesser evil: over-marking deletes a real cold
  prefill measurement with no trace, while under-marking quotes a possibly-warm figure beside a
  caveat that says so — only the second is visible to a reader. So the current looseness fails
  safe, which is why OAI-35's pass 3 rejected changing it and why it is recorded here rather than
  fixed. It is still wrong in one case worth naming: `{status: null, prefillMs: 7}` had a prefill
  measured, so the prompt WAS reached and a repeat could be served warm, and the early return says
  otherwise. Any fix must preserve the conservative direction — tighten the type check without
  letting a genuinely absent status fall through to a `true` it has not earned — and must come with
  a test asserting the cold-prefill column does not gain entries it never measured.

### OAI-40 — parked, `not worth doing`

**Why parked:** No instance. Both named tests overclaim — `tests/bench-reliability.test.js`'s "exactly one attempt answers, and it is the one the headline timings came from" asserts neither half of its title, and `tests/bench-reason-notes.test.js`'s "shape-rejected is explained as the terminal twin of refused" makes two of three assertions document-wide — but no regression has ever been observed reaching a commit past either of them.

**Reopening bar (an instance, with a date):** A real defect that lands because one of those two tests stayed green — a prefill regression where the headline timing and the answering attempt diverge, or a gutted `shape-rejected` paragraph. Record the commit and the date.

*Filing kept verbatim:*

- **OAI-40** — Two pre-existing tests that do not prove what they are named for. Filed 2026-08-04 from
  OAI-35's passes 2 and 3 (`codex-plain` both times), rejected there as out of scope. This is the
  class OAI-35 added to `.claude/REPO_TRAPS.md` — *a test that manufactures or sidesteps the evidence
  it claims to guard* — found in tests that predate it, so the entry earns its keep immediately.
  1. **`exactly one attempt answers, and it is the one the headline timings came from`**
     (`tests/bench-reliability.test.js`) asserts **neither** claim in its title. `answeringAttempt` is
     a `.find`, so a second answered attempt passes; and it checks the attempt's `prefillMs` against a
     literal rather than against `run.report.prefillMs`, so it never shows the two share a source.
     Both halves matter — the second is what makes the cold-prefill exclusion meaningful.
  2. **`shape-rejected is explained as the terminal twin of refused`**
     (`tests/bench-reason-notes.test.js`) scopes its first assertion with `paragraphAbout` and then
     makes its other two document-wide. The comment directly above explains why that is worthless —
     the document-wide version passed on a count-table row, "proved by gutting the whole paragraph and
     watching it stay green" — and then two of three assertions are document-wide anyway. Route them
     through `paragraphAbout` and re-run the gutting mutation the comment describes.
  Both fixes are small; the value is that each one currently reports coverage it does not have.

### OAI-46 — parked, `not worth doing`

**Why parked:** No instance. This is a process finding from OAI-34's terminal review round: `tests/ttl-vocabulary.test.js:99` pins the `Accepted verdicts:` line in `BACKLOG_DONE.md` and nothing else, and the contradictory acceptance clause that demonstrated the gap was staged by the reviewer, not shipped. The guard's narrow scope is now honestly described, which is the half that was fixed.

**Reopening bar (an instance, with a date):** A contradictory verdict-acceptance clause is committed to a TTL-challenge entry, the suite stays green, and a non-conclusive run is subsequently read as complete. Record the clause, the commit and the date.

*Filing kept verbatim:*

- **OAI-46** — The tracker-consistency guard pins one line, and its prose now says so — decide whether
  that is enough. **Filed from OAI-34's terminal review round, which demonstrated the gap rather than
  argued it.** `tests/ttl-vocabulary.test.js:99` reads the `Accepted verdicts:` line and compares
  it set-wise against `CONCLUSIVE`, which the driver's exit code imports. That pins **that line**.
  *(Corrected 2026-08-13 by the sweep: it reads **`BACKLOG_DONE.md`**, where that line actually lives
  (`:919`), not this file — this entry only describes it. The mechanism and the gap are unchanged.)*
  The reviewer added a contradictory acceptance clause elsewhere in the OAI-34 entry and the suite
  stayed green.
  The claim was corrected rather than the guard — an overclaim about a guard is worse than a narrow
  guard honestly described, and OAI-34 was already four review rounds deep. But the honest description
  is not the same as adequate: a future edit can still mark a non-conclusive run complete under a
  green suite, which is exactly the drift the guard was added to stop.
  Options, cheapest first: **(a)** accept it, since the canonical line is where a reader looks and the
  prose no longer claims more; **(b)** assert the entry contains no *other* verdict-acceptance
  phrasing, which needs a rule for what that looks like and risks false failures on ordinary prose;
  **(c)** move the done-condition out of prose entirely into a small machine-readable block the tracker
  renders from. **(c) is the only one that actually closes it**, and it is a change to how this repo
  writes backlog items, not to one item — which is why this is a decision and not a fix.

### OAI-48 — parked, `not worth doing`

**Why parked:** No instance. This is a construction argument that Codex broke — correctly — but no ledger entry has ever been observed recording a wrong served-model identity. The item states its own boundary: the ordinary cause of substitution is requesting an id the server does not have, and both arms' ids were served, so *"the run states the limit rather than pretending to check it"*.

**Reopening bar (an instance, with a date):** An attempt ledger entry observed recording an answer from a model other than the one requested, with no served id captured — the `stream-unfinished` / `empty-completion` / `blank-completion` path the item describes. Quote the entry, the run and the date.

*Filing kept verbatim:*

- **OAI-48** — The attempt ledger records no *served* model identity, so a substituted attempt that
  was later superseded leaves no trace. **Filed 2026-08-04 from OAI-19's gate grill, where Codex
  broke a construction argument I had written to declare the hole unreachable.** The argument was:
  substitution means the server *answered*, an answered attempt ends the run, therefore no retry can
  wash it away. It is wrong on one path. `applyFrame` sets `answer.model` from each streamed frame
  (`completion.mjs:65`), so a served identity can be observed *before* the reply is usable; a stream
  that ends unterminated then throws `stream-unfinished` (`completion.mjs:98`), which
  `answerWithRetry` retries (`answer-attempts.mjs:111`); the ledger entry keeps timings and outcome
  but no served id (`attempt-ledger.mjs:56`); and only the final report reaches the run-level
  substitution check (`bench/lib/outcome.mjs:84`). `empty-completion` and `blank-completion` have the
  same shape. So a wrong-model partial answer followed by a right-model retry is recorded as clean.
  Fix: carry `requestedModel`, the observed served id, and an explicit **"identity not observed"**
  state on every attempt entry — the third is load-bearing, since a pre-response failure genuinely
  has no id and must not read as agreement. Not gated in OAI-19's run: the ordinary cause of
  substitution is requesting an id the server does not have, and both arms' ids are served here — so
  the run states the limit rather than pretending to check it.

### OAI-53 — parked, `not worth doing`

**Why parked:** Not a defect: a deliberate deferral. The item's own text — *"Deferred deliberately in OAI-3, not forgotten"* — and no user has been observed blocked by the absence of `/oai:review --background`. The blocker it names (a review needs an outcome object before it can be persisted) is design work nobody has needed yet.

**Reopening bar (an instance, with a date):** A `/oai:review` invocation a user actually needed to background — a foreground review long enough that they abandoned it, or that blocked a session they needed. Name the invocation and the date.

*Filing kept verbatim:*

- **OAI-53** — `/oai:review --background`. Deferred deliberately in OAI-3, not forgotten: `kind` and
  `schema_version` are in the schema so this fits without a migration, and the worker already runs the
  foreground executor rather than a copy of it. **The blocker is what gets persisted.** A review's
  canonical result is its findings, and today `/oai:review` renders them on the way out; persisting
  the rendering would leave `/oai:result` unable to reconstruct the one distinction that matters —
  `findings: null` (the reply was unparseable) against `[]` (a clean pass), which is trap instance 14
  in `.claude/REPO_TRAPS.md` and the defect [ADR 003](adr/003-structured-findings.md) exists to
  prevent. So this item is really "give the review path an outcome object the way OAI-3 gave the task
  path one" — `task-execute.mjs`/`task-report.mjs` is the shape to copy — and the backgrounding is the
  easy half that follows.

### OAI-54 — parked, `not worth doing`

**Why parked:** No instance. A known design gap, recorded in ADR 014 at the time rather than discovered later: foreground `/oai:task` and `/oai:review` do not join the queue. No foreground run has been observed colliding with a background job on this server, and the item itself says the fix needs a design decision with the user first.

**Reopening bar (an instance, with a date):** A foreground `/oai:task` or `/oai:review` observed running concurrently with a background job on the same server, with the consequence recorded — a memory-ceiling breach against the noted `estimated_peak 25.10GiB` / `safe_ceiling 25.08GiB`, or a run that failed or degraded because of it — and the date.

*Filing kept verbatim:*

- **OAI-54** — Foreground `/oai:task` and `/oai:review` do not join the queue, so the invariant OAI-3
  ships is honestly "one **background** job at a time". A foreground run started while a background
  job is mid-flight puts two model calls on one server, which is the case the queue exists to prevent
  and the memory ceiling makes expensive (`estimated_peak 25.10GiB` against `safe_ceiling 25.08GiB`).
  Recorded as a known gap in [ADR 014](adr/014-async-jobs.md) rather than discovered later.
  **The design question this needs answering first, and the reason it is not a small change:** a
  foreground command that waits its turn is a foreground command that hangs with no output, which is
  a worse experience than the overlap it prevents. Options are to wait with progress on stderr, to
  refuse with the blocking job named, or to make `--max-wait` mean something in the foreground too.
  Decide that with the user before building it.

### OAI-60 — parked, `not worth doing`

**Why parked:** No instance. `RETAIN` and the two literals agree today: `commands/status.md:56` and `commands/result.md:36` both say 50, which is the constant. The harm is entirely conditional on a change nobody has made.

**Reopening bar (an instance, with a date):** `RETAIN` changes and a command markdown is caught still stating the old number. Record the commit that changed the constant, the stale file, and the date.

*Filing kept verbatim:*

- **OAI-60** — The retention ceiling is a constant in one place and a **literal `50` in prose** in
  `commands/status.md:56` and `commands/result.md:36`. `cmd-result.mjs` interpolates `RETAIN` into its
  hint correctly, so changing the constant leaves the code truthful and the two command markdowns
  quietly wrong — and command markdown is precisely the surface CLAUDE.md notes "nothing else notices
  when it rots", which is why `tests/plugin.test.js` exists. It does not check this.
  Two lines of fix, and the feature skill's rule picks between them: one definition, or one guard.
  A guard is the cheaper of the two here — assert the rendered `RETAIN` appears in both files —
  because the alternative is generating prose from a constant, which is worse than the problem.

### OAI-68 — parked, `not worth doing`

**Why parked:** No instance. A structural argument about the two-version design on its own terms: `applySchema` (`job-store.mjs:120-125`) reads `PRAGMA user_version` once per open and a worker holds that handle for the life of the job. No mid-session schema bump against a live worker has ever been observed — this repo has run one build at a time throughout.

**Reopening bar (an instance, with a date):** A worker observed writing (`beat`, `claimJob` or `finish`) to a database whose `user_version` was raised by another build after that worker's handle opened. Record the two builds, the row and the date.

*Filing kept verbatim:*

- **OAI-68** — **`PRAGMA user_version` is checked only when a connection opens, so an in-flight worker
  bypasses the newer-database refusal.** `applySchema` (`job-store.mjs:120-125`) reads it once inside
  `openStore()`, and a worker holds that handle for the life of the job — minutes to the 3600s default
  cap. A newer build opening the same database in that window raises `user_version`; the old worker's
  later `beat`/`claimJob`/`finish` never recheck and write to a schema it does not understand. This is
  a hole in the two-version design **on its own terms**, since the stated rule is that a newer database
  is refused for all mutations. The fix (recheck under the same write lock) touches every mutation path
  and collides with whatever OAI-63 does to the persisted payload, so sequence it after that decision.

### OAI-73 — parked, `not worth doing`

**Why parked:** The item's own first sentence: *"None is a known defect."* Three uncovered paths — the v99 x NULL-waiter combination, `cmd-task-worker.mjs:92-97`'s lost-`registerWaiter` exit, and `job-liveness.mjs:87`'s `starting` branch — and no observed failure through any of them.

**Reopening bar (an instance, with a date):** One of the three fires in a real run and misbehaves: a late worker double-dispatching, an unknown-`schema_version` queued row with a NULL waiter going uncollected, or a `starting` row rendered wrongly. Record which path, the row and the date.

*Filing kept verbatim:*

- **OAI-73** — **Coverage the ladder found missing, beyond OAI-52's list.** None is a known defect.
  (a) an unknown-`schema_version` **queued** row with a **NULL waiter** — `queue-reconcile.test.js`
  covers the v1 NULL-waiter case and the v99 live/dead-waiter cases, never the v99 × NULL combination;
  (b) the late worker that loses `registerWaiter` and exits without dispatching
  (`cmd-task-worker.mjs:92-97`) — its stderr string appears nowhere in `tests/`, and it is the guard
  that stops a late worker double-dispatching; (c) the `starting` branch of `job-liveness.mjs:87`,
  which no test drives inside a paused publication/spawn window.
  Also recorded, not defects: `tests/job-store.test.js` and `tests/structure-jobs.test.js` (plan:435-436)
  were never created — their function was discharged by `queue-guards.test.js` and, at the time, the
  generic size ratchet (retired 2026-08-17 — see Tier 7); and the plan asked for the wall clock the new
  tests add, which was never reported (only the count).

### OAI-76 — parked, `not worth doing`

**Why parked:** No instance. `agents/oai-delegate.md:5` does grant bare `Bash` where `commands/task.md:5` scopes the same capability to `Bash(node:*)`, but no delegate run has been observed issuing a command outside its own recipe. **This is the paired half of OAI-74, which STAYS LIVE and carries the dated instance** — the two are one decision viewed twice, and parking the containment-surface half does not park the boundary decision.

**Reopening bar (an instance, with a date):** A delegate run observed executing a command that a `Bash(node:*)` scope would have blocked. Quote the command, the run and the date.

*Filing kept verbatim:*

- **OAI-76** — **The delegate's `Bash` grant is unscoped, so the companion is not a chokepoint.**
  Filed 2026-08-05 at OAI-5's verdict point, where the Codex approver refused to treat this as
  shippable-by-statement and was right: `agents/oai-delegate.md:5` grants bare `Bash`, while
  `commands/task.md:5` scopes the identical capability to `Bash(node:*)`. So every boundary OAI-74
  would add inside `prompt.mjs` is bypassable with one `curl`, and the agent's threat model — which
  explicitly treats repository contents as untrusted — depends on the agent not doing that.
  **Why it was not simply fixed:** `Bash(node:*)` is incompatible with the recipe as designed, which
  must be one shell invocation (shell state does not survive between `Bash` calls) and needs `mktemp`,
  `awk`, `sleep` and `trap` inside it. The options are a narrower allowlist covering exactly those
  commands, splitting the recipe and paying a different correctness cost, or moving the lifecycle into
  a companion subcommand so the agent's only verb is `node`. **The third is probably right** and is
  the same shape as OAI-74's "locked-down delegate mode" — decide them together.

### OAI-79 — parked, `not worth doing`

**Why parked:** Deliberately unfixed, and possibly moot. The item ships its own reason: five consecutive fixes in that six-line block each introduced the next pass's defect, so a sixth edit was judged likelier to add one than remove one, and both approvers accepted that. The tier index says outright that **OAI-79 may never be worked at all** — all three edges are deleted by moving the delegate lifecycle out of agent shell (OAI-74 with OAI-76, and OAI-76 is parked in this same sweep). All three fail closed; none has been observed firing.

**Reopening bar (an instance, with a date):** An observed delegate run where one of the three fires: `root=$(canon "$root")` clobbering the path out of its own `refusing: cannot resolve` message, `root=/` refusing every attachment, or `realpathSync("")` returning the cwd once a guard moved. Record the session, the symptom and the date.

*Filing kept verbatim:*

- **OAI-79** — **Three remaining sharp edges in the delegate recipe, all fail-closed, deliberately not
  fixed in OAI-5.** Filed 2026-08-05 from the ladder's terminal pass, where the reason they ship
  stated is itself the finding: five consecutive fixes in that same six-line block each introduced the
  next pass's defect, so a sixth edit was judged likelier to add one than remove one. Both approvers
  accepted that. Do these when the block is next opened for another reason — ideally when the
  lifecycle moves out of agent shell entirely (OAI-74 with OAI-76), which deletes all three.
  **(a) The root canonicalisation clobbers its own diagnostic.** `root=$(canon "$root")` assigns
  before the `||` runs, so on failure `root` is already the empty stdout and the message prints
  `refusing: cannot resolve ` with the path gone; node's stack carries no path either. The refusal is
  then global and permanent for that checkout while the agent text says "do not remove that check to
  make a request work". Two lines: capture `rawroot` first, canonicalise into `root`, name `$rawroot`
  in the message. Reachable only when a directory *above* the repository holds a control character.
  **(b) `root=/` refuses every attachment.** The pattern becomes `//*`, which matches no ordinary
  absolute path in bash or zsh, so a session at `/` outside a git repository can attach nothing. Fails
  closed; handle the filesystem root as its own case.
  **(c) `realpathSync("")` returns the cwd rather than throwing**, which is fail-*open* in direction.
  Masked today at both call sites — `[ -n "$f" ] || continue` for attachments, and root is either the
  git top level or `$PWD` — so it is latent, not live. It stops being masked the moment either guard
  moves, which is exactly the kind of change (a) invites.

### OAI-80 — parked, `not worth doing`

**Why parked:** No instance. Both halves are hypothetical: (a) needs an in-tree filename containing `, ` or ` (0 B` to forge or mask an entry in the `attachments` line, and (b) needs a server emitting misleading text into `assertOk`'s 400-character window. Neither has been observed, and the item itself notes neither is disclosure — both are *"strictly smaller than the model reply `/oai:result` already prints"*.

**Reopening bar (an instance, with a date):** An `attachments` line observed to have forged or masked an entry because of a filename, or a failure note whose embedded server-controlled text a reader acted on as diagnosis. Quote the line or the note, and the date.

*Filing kept verbatim:*

- **OAI-80** — **The delegate's own report can be forged or degraded by content it does not control.**
  Filed 2026-08-05 from the ladder's pass-6 and pass-8 security lenses. Neither is disclosure —
  containment is untouched and both are strictly smaller than the model reply `/oai:result` already
  prints — but both undermine the *reporting* contract the agent is judged on.
  **(a) The `attachments` line is ambiguous by construction.** `job-render.mjs:249` *(line moved;
  verified again 2026-08-17)* joins entries as
  `path (N B)` with `, `, and the agent is told to take its file list from that line precisely because
  it is what the job recorded. An in-tree filename containing `, ` or ` (0 B` can therefore forge an
  extra entry or mask a real one in the list reported upward. The fix belongs with OAI-57's `--json`,
  where the list is an array and the question does not arise.
  **(b) The failure note carries up to 400 characters of server-controlled text.** `assertOk` embeds
  the response body, the recipe now prints the status detail, and the agent is told to quote the note
  when a job failed — so an untrusted server's text reaches the transcript as something the agent is
  instructed to repeat. Bound it, or mark it as quoted foreign text rather than diagnosis.

### OAI-81 — parked, `not worth doing`

**Why parked:** No instance beyond the design's own accepted terms. `persistRequest` freezing `request.messages` is *why* editing a file after submission cannot change what the model was asked — the item says so — and no mis-selected attachment has been observed persisting in `jobs.db` to any concrete cost. The protection it rests on (`0600`/`0700`, unconditionally repaired) shipped with OAI-65 on 2026-08-18.

**Reopening bar (an instance, with a date):** An attachment observed in a retained job row that the submitter did not intend to persist and where the retention mattered — a credential, or a file whose retention broke a commitment. Record the seq, what was retained and the date.

*Filing kept verbatim:*

- **OAI-81** — **A submitted attachment leaves a durable plaintext copy outside the file it came
  from.** Filed 2026-08-05. `persistRequest` freezes `request.messages` — which contains every
  attached file's full text — into the job row, and `job-retention.mjs` keeps the newest 50 finished
  jobs. So one mis-selected attachment persists in `jobs.db` until fifty jobs later, **even on a
  localhost-only deployment where nothing ever left the machine**, in state the user does not think of
  as holding file contents and which is itself a valid future attachment target. This is a
  consequence of OAI-3's snapshot-at-submission design (that snapshot is *why* editing a file after
  submission cannot change what the model was asked), so the fix is not "stop storing it" — it is to
  decide whether the row should hold the text or a digest plus a reference, and what `/oai:result`
  then replays. Interacts with OAI-65's `0600`/WAL work: the protection those items argue about is the
  protection this content is resting on.

### OAI-87 — parked, `not worth doing`

**Why parked:** Deliberately not started, at a cost the user owns. The item's own text: ***"Not started because it spends the user's tokens per case per arm — it is the one item here whose cost is theirs rather than the machine's, so it is launched when they say so."*** Nothing currently misreports: `MARKER_LIMITS`, ADR 017 and the report itself all state that a marker profile is evidence quality and not Stage 2's economic gate.

**Reopening bar (an instance, with a date):** The user asks for the paired arm, OR `bench/task-run.mjs`'s marker numbers are observed being read as the Stage 2 economic gate by someone who then acted on them. Record the citation and the date.

*Filing kept verbatim:*

- **OAI-87** — **Stage 2's gate is unmeasured, and a marker score is not it.** Filed 2026-08-06.
  `plans/local-llms-like-codex.md` Stage 2 asks whether "the artifacts are useful often enough that
  Claude verifying them costs less than Claude doing the work" — an **economic** claim.
  `bench/task-run.mjs` answers a different question: did the local model emit evidence a case declared
  in advance. Both `MARKER_LIMITS` and [ADR 017](adr/017-measuring-a-task-not-a-review.md) say so, and
  the report prints it, so nothing currently misreports — **the gate is simply not measured.**
  **What would measure it**, settled with Codex and recorded in
  [`plans/stage-2-open-questions.md`](plans/stage-2-open-questions.md) E4: a **paired arm**. An
  assisted run where Claude verifies the artifact against the case's fixture, and a control run where
  Claude gets the identical files and question with no artifact and does the work. Both must satisfy
  the case oracle; record Claude's tokens, elapsed time and whether the conclusion was right. Two
  riders that are the whole point: if Claude rejects the artifact and redoes the work, assisted cost is
  **verification plus redo**; and if Claude **accepts a wrong artifact that is a gate FAILURE**, not
  cheap verification.
  **Not started because it spends the user's tokens per case per arm** — it is the one item here whose
  cost is theirs rather than the machine's, so it is launched when they say so.

### OAI-88 — parked, `not worth doing`

**Why parked:** A stated limitation, not a defect. `bench/task-cases/prototype-lookup` is the whole corpus, this file's own standing methodology note already says N=1 per arm is a lottery ticket, and the harness prints the caveat. No number from it has been observed misleading anyone.

**Reopening bar (an instance, with a date):** A second task case is actually added to `bench/task-cases/` (which closes this outright), or an n=1 task-corpus number is observed being cited as a rate and acted on. Record the citation and the date.

*Filing kept verbatim:*

- **OAI-88** — **The task corpus has ONE case, so every number it produces is n=1.** Filed 2026-08-06.
  `bench/task-cases/prototype-lookup` is the whole corpus. This file's own standing methodology note
  says N=1 per arm is a lottery ticket, and that applies to the instrument as much as to the runs.
  **The next case is already specified and cheap**: the zsh word-splitting defect from OAI-83, whose
  executable witness is a loop comparing argv across `sh`, `dash`, `bash` and `zsh` — the exact script
  that found it. A third could be the render-scope artifact defect from the Stage 2 ladder.
  **The bar a case must clear** is in `bench/lib/task-corpus.mjs`: `before/` and `after/` trees, a
  witness that FAILS on the first and PASSES on the second, and no prompt containing a marker it will
  be scored on.

### OAI-91 — parked, `not worth doing`

**Why parked:** No instance. A design gap recorded in `adr/018` at the time and deliberately scoped: `submitTask`'s notice is about STORAGE because a draft claiming transmission was false whenever `readFileBlocks` threw first. No user has been observed surprised that foreground `/oai:task`, `/oai:review` or `/oai:setup` transmitted a query-string credential unwarned.

**Reopening bar (an instance, with a date):** A user runs a foreground provider-touching command with a credential in `--base-url`'s query string and is observed surprised that it was transmitted with no notice. Record the command, the surprise and the date.

*Filing kept verbatim:*

- **OAI-91** — **A query-string credential is transmitted by every provider-touching command, and only
  background `/oai:task` says so.** `normalizeBaseUrl` keeps a base URL's query string verbatim, so
  `--base-url 'https://host/v1?api_key=SECRET'` sends that key on every request. `submitTask` warns,
  because the key also lands in the job row — but the notice is scoped to STORAGE, deliberately (see
  `adr/018`): a draft claimed transmission too and was false whenever `readFileBlocks` threw before a
  byte was sent. Foreground `/oai:task`, `/oai:review` and `/oai:setup`'s probe all transmit it and say
  nothing. Warning in one command and not the others is arbitrary, so the fix belongs where the URL is
  resolved, not where a job is submitted — probably `resolveProfile`, once, for every command.
  Found by the OAI-61 review ladder (pass 5) and scoped out of it rather than half-done.

### OAI-92 — parked, `not worth doing`

**Why parked:** No instance, and it requires a cooperating server. `assertOk` embeds up to 400 characters of a non-2xx body into persisted job state, but no proxy or gateway echoing `?api_key=…` back has been observed against this plugin. The item says as much — *"Requires a cooperating server, which is why it is filed rather than fixed inside OAI-61."*

**Reopening bar (an instance, with a date):** A real server's error body observed carrying a credential — or any foreign text a reader acted on as diagnosis — into the `failure` column and onto `/oai:status` or `/oai:result`. Quote the body and the date.

*Filing kept verbatim:*

- **OAI-92** — **`assertOk` embeds 400 characters of a server's error body into persisted job state.**
  `provider.mjs:96,99-105` *(lines moved; verified again 2026-08-17)* builds a non-2xx message from
  `readText(response, {limit: 400})`; that message
  reaches `errorReport` (`cmd-task-worker.mjs:117`), is written to the `failure` column, and is rendered
  by `/oai:status` (`job-render.mjs:80`) and `cmd-result.mjs`. A proxy or gateway that echoes the
  request URI in its 4xx page — nginx does — therefore writes `?api_key=…` into durable state and onto
  the screen. Requires a cooperating server, which is why it is filed rather than fixed inside OAI-61.
  Found by that feature's `security-review` stage.

### OAI-99 — parked, `not worth doing`

**Why parked:** No instance. Found by OAI-94's probe and confirmed by reading `provider.mjs`'s `assertOk`, which interpolates `response.headers.location` verbatim on any 3xx — but no redirect has been observed against this plugin at all, let alone a query-preserving one.

**Reopening bar (an instance, with a date):** A `Location` header observed carrying a credential onto one of the five surfaces the item names — stderr, the job log, the persisted `error` column, `/oai:status`, `/oai:result`. Quote the message and the date. (The `301`-answering witness the item specifies travels with the fix, not before the instance.)

*Filing kept verbatim:*

- **OAI-99** — **a query-preserving redirect puts the credential on five surfaces.** `provider.mjs`
  `assertOk` interpolates `response.headers.location` verbatim into a `UserError` on any 3xx. A server
  that redirects while preserving the query — the ordinary shape for a gateway moving `/v1` — echoes
  `?api_key=…` straight back, and that message reaches stderr, the job log, the persisted `error`
  column, `/oai:status` and `/oai:result`. Sibling to OAI-92, which is the same module doing the same
  thing with a 4xx body rather than a header. Found by OAI-94's probe and confirmed by reading the
  code; filed rather than folded in because it is a distinct output path with its own redaction
  semantics, and OAI-94's notice is safe and true without it.
  **A required test travels with this item, and it is the reason the item exists rather than a note:**
  OAI-94's backlog entry asked for a witness answering `301` with `location: <the full request URI>`
  and asserting the credential does not appear in the resulting message. That witness had no subject
  in OAI-94 — it exercises `provider.mjs`, which that change deliberately did not touch — so it was
  neither written nor silently dropped. Whoever fixes this writes it.

### OAI-100 — parked, `not worth doing`

**Why parked:** No instance. Found by OAI-94's compensating security lens and verified by reading the three call sites — `describeFailure` interpolates `profile.baseUrl` at `:64` (connection refused), `:69` (DNS failure) and `:74` (generic transport) — but no path-embedded credential has been observed reaching stderr in a real run.

**Reopening bar (an instance, with a date):** A credential observed on stderr from one of those three sites. Quote the message, name which of the three produced it, and the date.

*Filing kept verbatim:*

- **OAI-100** — **a path credential reaches stderr on any failed request.** `provider.mjs`
  `describeFailure` interpolates `profile.baseUrl` into three messages — connection refused (`:64`),
  DNS failure (`:69`) and the generic transport wording (`:74`). `normalizeBaseUrl` keeps a credential
  sitting in the URL **path** inside `baseUrl`, so `--base-url https://host/v1/sk-live-…` discloses it
  the moment the server is unreachable. It fires inside `prepareTask`, which OAI-94's notice now runs
  before — so the caller is warned that the endpoint will be persisted and then has the credential
  disclosed to stderr anyway, by a different code path that says nothing. Found by OAI-94's
  compensating security lens — that feature's `security-review` stage could not launch at all, SEVEN
  deterministic failures across seven passes, and the cause is now confirmed structural rather than
  flaky: the stage is a built-in command whose own frontmatter interpolates `git diff --name-only
  origin/HEAD...` before reading its argument, and this repo has no git remote — so the lens stood in for it — and verified by
  reading the three call sites.

### OAI-101 — parked, `not worth doing`

**Why parked:** No dated instance. `job-render.mjs` renders `provider` as `${transport.name} → ${transport.baseUrl}` and the row holds the effective endpoint by design (`adr/014`), so a path-form credential would display — but none has ever been observed on a `/oai:status` listing.

**Reopening bar (an instance, with a date):** A `/oai:status` listing observed printing a path-embedded credential on its provider line. Quote the line and the date.

*Filing kept verbatim:*

- **OAI-101** — **`/oai:status` prints the persisted endpoint, path credential included.**
  `job-render.mjs:243` *(line moved; verified again 2026-08-17)* renders `provider` as
  `${transport.name} → ${transport.baseUrl}`. The row holds
  the effective endpoint by design (a worker rebuilding from the provider name alone would call
  somewhere submission never validated — `adr/014`), so a credential in the path is displayed by an
  ordinary status check, and the delegate agent captures that output. The query string is not shown
  here, which is why this is separate from OAI-91: the disclosure is specific to the path form. Fix is
  a render-time redaction, not a change to what is stored.

### OAI-103 — parked, `not worth doing`

**Why parked:** No dated instance. `--background --json` returns a job id and routes `templateNotes` to stderr only, so a stdout-parsing consumer never sees them — but no consumer, including this repo's own delegate agent, has been observed reading a crowded reply as a clean one.

**Reopening bar (an instance, with a date):** A consumer — the delegate agent or any harness — observed treating a `--background --json` submission as caveat-free and acting wrongly on it. Record the consumer, the missed note and the date.

*Filing kept verbatim:*

- **OAI-103** — **`--json` omits the caveats the human-readable reply prints.** `/oai:task --json`
  carries `templateNotes` as an array precisely so a harness cannot read a crowded reply as a clean
  one (ADR 016). The `--background` submission path does not: it returns a job id, and the notes a
  foreground run would have printed — including the endpoint-persistence notice ADR 019 added — reach
  stderr only, where a `--json` consumer parsing stdout never sees them. So the machine-readable form
  is quieter than the human one about exactly the things a machine should not silently drop. Found
  during OAI-94's ladder and filed rather than folded in, because the fix is a payload decision that
  collides with OAI-57's, not a change to the notice.

### OAI-105 — parked, `not worth doing`

**Why parked:** No instance. The exclusion at `job-busy.mjs:64-70` rests on an argument rather than a witness, and the item is right that the argument is untested in both halves — but `job-reconcile.mjs`'s five unprotected writes (recounted against disk 2026-08-14, unchanged at this sweep) have never been observed losing a `SQLITE_BUSY` to any visible cost.

**Reopening bar (an instance, with a date):** A row observed sitting uncollected because a reconciliation write lost a `SQLITE_BUSY` and no later read arrived to redo it. Record the row, its state, how long it sat, and the date.

*Filing kept verbatim:*

- **OAI-105** — **the reconciliation writes have no contention answer, only an argument.**
  `job-busy.mjs:64-70` (the exclusion now lives here, not in the deleted `adr/020` — see OAI-110)
  retries seven sites with `withBusyRetry`, skips five more with a bare `isBusy` catch, and
  deliberately leaves `job-reconcile.mjs`'s **five (recounted against disk 2026-08-14, unchanged at
  the current sweep)** writes unprotected, on the reasoning that the sweep re-runs on the next read so a
  `SQLITE_BUSY` costs one deferred reconciliation rather than a lost fact. That reasoning is untested in
  both halves: nothing bounds how long the deferral can last under sustained contention, and nothing
  establishes that a later read always arrives — a database whose only reader has stopped running
  leaves a `worker-died` row uncollected indefinitely (`job-view.mjs:6-9`: *"a job whose worker died
  sits `running` until something looks, and forever if nothing ever does"*). Raised in OAI-62's review
  ladder and filed rather than fixed there, because widening that change to a fifth subsystem is how a
  batch stops converging. The fix is either a witness that drives a busy through a reconciliation sweep
  and proves the next read corrects it, or a `withBusyRetry` at those five writes and the deletion of
  the exclusion from `job-busy.mjs:64-70`. Do not leave the exclusion standing on reasoning alone.

### OAI-109 — parked, `not worth doing`

**Why parked:** The hole is argued unreachable by the item itself, and the argument holds: `outcomeOf` builds only strings, numbers, nulls, `artifactFor`'s `{state, detail}` of string literals, and `result.usage` — parsed from a JSON response and acyclic by construction — so no cycle and no BigInt can reach `JSON.stringify`. *"That hole is unreachable today."* No answer has ever been lost this way.

**Reopening bar (an instance, with a date):** A field is added that can make `outcomeOf`'s value unserialisable, or `salvageOutcome`'s / `publishFailure`'s inner stderr write is observed failing, and an answer is lost as a result. Record the commit or the run, and the date.

*Filing kept verbatim:*

- **OAI-109** — **the rescue's own guard is unwitnessed, and one narrow hole inside it is real.**
  `salvageOutcome` guards its stderr write, and if `JSON.stringify` throws it writes a
  "could not be written" line instead — at which point **the answer is lost**, which is the exact
  outcome the rescue exists to prevent. That hole is unreachable today, and the reason is worth
  keeping: `outcomeOf` builds only strings, numbers, nulls, `artifactFor`'s `{state, detail}` of
  string literals, and `result.usage`, which came from a parsed JSON response and is acyclic by
  construction — so no cycle and no BigInt can reach it. **A future field could open it**, and
  nothing would notice, because neither the serialisation-failure path nor the log-write-failure path
  has a witness. **CORRECTED 2026-08-17 by the sweep**: this item originally claimed
  `publishFailure`'s structurally identical guard (`cmd-task-worker.mjs:139-146`) already had one, in
  `tests/job-busy-diagnosis.test.js` — checked against disk and that is not what those tests witness.
  Both tests there inject a row-write failure and assert on the rejection that escapes
  `runTaskWorker`, which exercises `publishFailure`'s *outer* catch, not its inner `stderr.write`
  guard. That inner guard is exactly as unwitnessed as `salvageOutcome`'s, so the ask below applies to
  both, not just to this one. Two things to do, and they are separable: witness both paths — both
  guards, not one — and serialise before entering the terminal-write path so a serialisation fault is
  discovered while the row write is still available. Raised at high confidence by `codex-adversarial`
  in OAI-62's terminal pass. Related: [OAI-106].

### OAI-123 — parked, `not worth doing`

**Why parked:** No instance. Stated-untested at pass 1 of the review-sweep ladder and never fired since: `resolveDeadline` compares against `Date.now()`, so a wall-clock step could move it, but no sweep has been observed ending at the wrong time. The DST case that WAS observed is already fixed.

**Reopening bar (an instance, with a date):** A sweep observed stopping at the wrong time across an NTP correction or a manual clock change. Record the `--until`/`--minutes` given, the actual stop time, the clock adjustment and the date.

*Filing kept verbatim:*

- **OAI-123** — **The sweep's deadline has no monotonic guard.** Filed 2026-08-08 from the
  review-sweep ladder, stated-untested at pass 1 and never fixed. `resolveDeadline` now advances the
  local calendar date correctly across DST, but the deadline is compared with `Date.now()`, so a
  wall-clock step (NTP correction, manual change) moves it. Deliberately **not** fixed in-ladder:
  replacing the clock is larger than the batch it arose in, and a step is far rarer than the DST
  boundary that was fixed. `job-busy.mjs` uses `performance.now()` for exactly this reason.

### OAI-127 — parked, `not worth doing`

**Why parked:** No instance. `serverUnwell`'s hardcoded `idle-timeout` set and `http-errors.mjs`'s per-budget hints agree today; the harm is entirely conditional on a sixth timeout reason that has never been added. The item's own framing is that the record *promises something the code cannot keep*, not that the code is currently wrong.

**Reopening bar (an instance, with a date):** A new timeout reason ships in `http-errors.mjs` and is silently excluded from `serverUnwell`'s set (or `idle`'s meaning changes underneath it) and a sweep verdict is wrong as a result. Record the reason string, the commit and the date.

*Filing kept verbatim:*

- **OAI-127** — **The decision record states a SEMANTIC rule the code cannot enforce.** Filed
  2026-08-08, `unresolved at cap`. `adr/021` says a future timeout reason must be judged against the
  CLI's own per-budget hint — the discriminator that finally ended five iterations — while
  `serverUnwell` is a hardcoded `idle-timeout` string set that nothing derives from or checks against
  `http-errors.mjs`. A sixth reason whose hint said "raising it will not help" would be silently
  excluded; a semantic change to `idle` would silently persist. **This is OAI-122's class one level
  up**: there the record contradicted the code, here they agree today and the record promises
  something the code cannot keep. Writing the rule down was supposed to be the fix.

### OAI-130 — parked, `not worth doing`

**Why parked:** No dated instance, and the item says why: *"Low impact while every arm passes `--model` explicitly, which the benchmark does."* `reported()` omits `report.requestedModel`, but no artifact has been observed where that absence actually hid what a substitution was substituted for — and the fact remains in the raw JSON.

**Reopening bar (an instance, with a date):** An artifact observed reporting a substituted model where the missing `requestedModel` in `reported()` hid what it was substituted FOR, and a reader acted on it. Quote the artifact and the date.

*Filing kept verbatim:*

- **OAI-130** — **A successful substituted reply drops `requestedModel`.** Filed 2026-08-08,
  `unresolved at cap`. `reported()` carries the served `model` and five caveats but not
  `report.requestedModel`, so when a sweep ran on a provider default the artifact says a different
  model answered without saying which model it was substituted FOR. The fact is in the raw JSON and
  absent from the summary. Low impact while every arm passes `--model` explicitly, which the benchmark
  does.

### OAI-136 — parked, `not worth doing`

**Why parked:** No instance. The item is explicit that it was **verified by reading the function, not inferred** — `model-selection.mjs:224` returns before the embeddings check — and equally explicit that whether an explicit `--model` *should* be refused is **not obvious and needs its own grill**. No chat request has been observed sent to an embedder, and no refusal has been observed suggesting one out of `catalogueIds`.

**Reopening bar (an instance, with a date):** A `--model <an id typed `embeddings`>` request observed reaching a chat completion, or a refusal observed suggesting an embedder the very next call then rejects. Quote the invocation, the message and the date.

*Filing kept verbatim:*

- **OAI-136** — **`--model` bypasses the embedding-model rejection that `defaultModel` enforces, and
  three smaller inconsistencies around the same split.** Filed 2026-08-09 from the OAI-134 ladder's
  `codex-plain` stage. All four are **pre-existing**: OAI-134 changed two hint strings and a README
  paragraph, and touched none of this behaviour. Verified by reading the function, not inferred:
  `model-selection.mjs:224` is `if (explicitModel) return unservedProblem(explicitModel, described) ??
  { modelId: explicitModel };` — it returns **before** the embeddings check, which lives in the
  `defaultModel` branch alone.
  1. **The bypass itself.** `--model <an id typed `embeddings`>` is selected and a chat request is sent
     to it. The `defaultModel` path rejects exactly this case with a specific message; the explicit path
     has no equivalent. Whether it *should* is **not obvious and needs its own grill**: an explicit
     `--model` is the caller's instruction, and `planSelection` deliberately lets a named model outrank
     our inference (`chatCandidates` is a denylist for the same reason — the verification machine's chat
     model reports type `vlm`). The choice is between refusing, warning, and documenting.
  2. **`README.md:78` says "embedding models are never chosen", which (1) makes FALSE.** Pre-existing
     prose. It sits in the paragraph OAI-134 extended but is not a sentence OAI-134 wrote, so it was
     dispositioned out of scope rather than fixed in that batch — fixing it is `widening` under
     `adr/056` and belongs to whichever option (1) settles on, since the honest sentence depends on it.
  3. **`:98-101`** — embedders are filtered out of `described.models` when building the offered list,
     but the offered set also unions `catalogueIds`, which is **not** filtered. So a refusal can suggest
     an embedder that the very next call then rejects — the failure mode that comment exists to prevent,
     surviving through the other half of the union.
  4. **`:159-170`** — the "this provider offers no model that can answer a chat request" conclusion
     reads only `described.models`, while catalogue-only ids count as served in `unservedProblem`. So it
     can assert "every id it lists is an embedding model" while a catalogue chat model is namable.
  **(3) and (4) are the same shape as each other and probably one fix**: two lists are treated as one
  for membership and as one-and-a-half for enumeration. **(1) is the only one with user-visible wrong
  behaviour**; (2) is a claim that is currently false; (3) and (4) are advice that can be wrong.

### OAI-142 — parked, `not worth doing`

**Why parked:** A constructed case, never observed. The rung flip it needs — the whole-file rung rejected on `prepareLadder` call 1 and fitting on call 2 — has not occurred in any benchmark run or overnight sweep on record. The item is correct that the docstring's reasoning is refuted rather than incomplete, and correct that **disclosure is unaffected**, which is what keeps the consequence bounded.

**Reopening bar (an instance, with a date):** An observed run where the two sizing passes chose different rungs and the reply was truncated or token-exhausted at the window boundary as a result. Record the target, both reserves and the date.

*Filing kept verbatim:*

- **OAI-142** — **`unconstrainedLadder` sizes the reply schema from a rung the request may not send.**
  Filed 2026-08-12 by `codex-adversarial` (high, confidence 0.96) during OAI-139's review ladder, and
  **deliberately not fixed there** — it is pre-existing, `git diff` confirms OAI-139 never touched
  `unconstrainedLadder`, and the user classified it a widening.
  `prepareLadder` runs **twice**: call 1 sizes against `REVIEW_SCHEMA`, the longest instruction, and
  the schema is derived from that call's reserve; call 2 uses the shorter derived instruction and is
  the request actually sent. If the whole-file rung is **rejected on call 1 and fits on call 2**, the
  reserve SHRINKS between them, so the schema advertises an `analysis` ceiling the budget cannot pay
  for — token exhaustion or a truncated unparseable reply, precisely at the window boundary.
  **The docstring asserts this cannot happen** (`review-ladder.mjs`): *"the cap derived from it can
  only under-state the room available: wrong in the safe direction by a bounded amount"*. That holds
  only while the rung cannot flip, which is the case this finding constructs — so the ADR-grade
  reasoning is refuted, not merely incomplete.
  Disclosure is **unaffected**: the report reads call 2's `rung`/`skipped`, so the bodies sent and the
  note about them still agree.
  Fix per Codex: make rung selection stable across sizing passes, or iterate until rung and reserve
  converge, deriving the final schema from the reserve of the exact request that will be sent. Needs a
  test pinning a target ON the fit boundary, which is the part with no precedent here.

### OAI-144 — parked, `not worth doing`

**Why parked:** Filed as UNVERIFIABLE rather than as a finding, and still unverified. The `finishReason === 'length'` check was only MOVED (`review-report.mjs` to `review-unparsed.mjs`), never introduced or altered, and no vendor among LM Studio, llama.cpp, vLLM, TGI or oMLX has been confirmed sending a shape it mishandles.

**Reopening bar (an instance, with a date):** A vendor confirmed emitting a truncation signal that `finishReason === 'length'` does not catch, so a run that ran out of room read as a run that finished. Quote the response, name the vendor and version, and the date.

*Filing kept verbatim:*

- **OAI-144** — **`finishReason === 'length'` is treated as a vendor-uniform signal and nothing
  establishes that it is.** Filed 2026-08-12 by `lean-wide`'s vendor-assumption lens during OAI-139's
  ladder, as an UNVERIFIABLE rather than a finding: the check was only MOVED in that change
  (`review-report.mjs` to `review-unparsed.mjs`), never introduced or altered. This repo targets LM
  Studio, llama.cpp, vLLM, TGI and oMLX, and `tests/` holds no per-vendor fixture set enumerating
  `finish_reason` values across them, so whether the field is uniformly named and valued is assumed.
  The consequence if it is not: a truncated reply from one of them is not recognised as truncated, and
  a run that ran out of room reads as a run that finished. Cheap first step is a fixture set, not a
  code change.

### OAI-145 — parked, `not worth doing`

**Why parked:** No instance, and OAI-67 already contained every destructive consequence: `abandonUnstarted`'s `state = 'queued' AND waiter_pid IS NULL` compare-and-set makes both orderings safe, so no row is destroyed and no paid work is lost. What survives is a submission reporting failure while its worker completes — and no such billing has been observed. The user chose deliberately to separate this from OAI-67 rather than fix it there.

**Reopening bar (an instance, with a date):** A post-`'spawn'` throw in `job-spawn.mjs` (`:33-50`, the `closeSync(log)` in `finally`) observed orphaning a running worker while the submitter reported failure, with the user billed for an answer they were told did not start. Record the job, the cost and the date.

*Filing kept verbatim:*

- **OAI-145** — **`spawnWorker` can reject after the child is alive, so "the spawn failed" is a
  claim it cannot support.** Filed 2026-08-12 by `codex-adversarial` (0.94) during OAI-67's ladder;
  OAI-67 CONTAINED the harm rather than fixing this, by the user's decision, so this is the root fix
  and nothing depends on it. `job-spawn.mjs:33-50` awaits the `'spawn'` event and then runs
  `closeSync(log)` in a `finally`; a throw there (EIO, EBADF) rejects the promise while a detached
  worker is already running, and `child.unref()` never executes either. The caller cannot tell that
  rejection apart from "no child was ever created", because the contract does not distinguish them.
  **What OAI-67 did instead:** the submitter terminalizes with `abandonUnstarted`, whose
  `waiter_pid IS NULL` compare-and-set makes both orderings safe — so no row is destroyed and no paid
  work is lost. What survives is milder and real: a submission REPORTS FAILURE while its worker runs
  to completion, and the user is billed for an answer they were told did not start. The fix is to
  preserve the pid once the `'spawn'` event has fired and report a cleanup fault separately, which
  changes the contract of the one function in this repo that launches a process meant to outlive its
  parent — its own header says every line is load-bearing, which is why this is a feature and not a
  patch. Codex recommended doing it inside OAI-67; the user chose to separate it.

### OAI-149 — parked, `not worth doing`

**Why parked:** The item's own closing words: ***"Without it this is a story about a race."*** Its precondition — a recreated `jobs.db` beside a surviving `logs/`, which restarts the `AUTOINCREMENT` seq — has never been observed created, and the docstring and `adr/014` now state that precondition instead of asserting safety, which is the honest half that shipped.

**Reopening bar (an instance, with a date):** The interleaving reproduced with a witness — recreate the store, plant the residue, submit, and see a live job's files unlinked — or an operator hitting it in production. Record the seqs, the files lost and the date.

*Filing kept verbatim:*

- **OAI-149** — **the orphan sweep's safety argument holds only while sequences cannot be reused, and
  deleting `jobs.db` beside a surviving `logs/` reuses them.** Filed 2026-08-13 from OAI-66's review
  (`codex-adversarial`, finding 1). `job-retention.mjs` `orphanSeqs` lists the directory *before* it
  reads the rows, and that order is what makes an unlisted seq safely an orphan — but `seq` is
  `AUTOINCREMENT` **per database**, so a recreated store restarts it. Interleaving: sweep A lists a
  stale `2.cancel-ack`, reads rows holding no seq 2 and marks it orphaned; submission B inserts seq 2
  and opens `2.log`; sweep A resumes and unlinks **B's live files**.
  **The race predates OAI-66** — a surviving `<seq>.log` could always start it — and OAI-66's union
  scan widened which residues can. The docstring and `adr/014` now state the precondition instead of
  asserting safety, which is the honest half; this is the mechanism half.
  **The shape of the fix is binding the orphan key to a STORE INCARNATION** — a value minted when the
  database is created and carried in the filename or a sibling — so a file from a previous incarnation
  can never be attributed to a current seq. That is the schema change OAI-66's grill declined, which is
  why it is separate rather than folded in.
  **The bar for it being real:** a witness that reproduces the interleaving — recreate the store, plant
  the residue, submit, and prove the live job's files survive. Without it this is a story about a race.

### OAI-169 — parked, `not worth doing`

**Why parked:** The item argues its own failure mode is **not** silent, which is what disqualifies it from the silence exception: *"Deleting either shows as an intermittent stall landing on the deliberate `unexpected second request` handler, not as silent wrongness — which is what makes leaving it unpinned defensible rather than merely cheap."* No such stall has been observed, and the item also notes a held-lock fixture would pin the pair in a NEW test while leaving the call site itself deletable.

**Reopening bar (an instance, with a date):** A suite stall traced to `tests/abandon-salvage.test.js`'s `PRAGMA busy_timeout = 250` or its `withBusyRetry(…, { budgetMs: 2_000 })` having been changed or removed. Record the run, the wall clock lost and the date.

*Filing kept verbatim:*

- **OAI-169** — **`tests/abandon-salvage.test.js`'s `busy_timeout` and retry budget are unpinned:
  delete either and the suite stays green.** Filed 2026-08-15 from OAI-166.
  `db.exec('PRAGMA busy_timeout = 250')` and `withBusyRetry(…, { budgetMs: 2_000 })` exist because
  `openStore` hands back a handle carrying a 10s `busy_timeout` and `budgetMs` is a floor rather than
  a ceiling — left at defaults, one attempt can block ~10s and the whole retry ~40s, in the process
  that also HOSTS the fake server, against a worker whose own 30s first-byte clock runs elsewhere.
  Nothing exercises that contention, so nothing notices if either value is removed.
  **State the exposure accurately: not "untested" but "unpinned".** Deleting either shows as an
  intermittent stall landing on the deliberate `unexpected second request` handler, not as silent
  wrongness — which is what makes leaving it unpinned defensible rather than merely cheap. A held-lock
  fixture would pin the pair but would pin it in a NEW test, leaving the call site itself still
  deletable, so it does not answer the question it appears to.

### OAI-174 — parked, `not worth doing`

**Why parked:** Describes a withdrawn plan decision, not a defect that fired. It was planned inside OAI-162 and then WITHDRAWN by the user after approval, on the ground the item itself states: **the gap is discovery from the listing, not documentation and not the exit** — `commands/status.md`, `commands/abandon.md` and the command's own refusal all name `/oai:abandon --force`. No operator has been observed failing to find it.

**Reopening bar (an instance, with a date):** An operator observed hitting a malformed row in `/oai:status` and not finding the remedy — not knowing `/oai:abandon --force` existed, or trying it where it would be refused. Record the session and the date.

*Filing kept verbatim:*

- **OAI-174** — **The rendered status output never names the exit for a malformed row.** Filed
  2026-08-16 from OAI-162's build, where it was planned and then WITHDRAWN by the user after approval
  (recorded in that item's plan). `remedyFor` is gated on `liveness !== 'live'`, so no `/oai:status`
  note names a command for any malformed shape, and `malformedNote` deliberately names none either:
  the operator is told the row will not be collected and left to find `/oai:abandon --force`
  themselves. **The gap is discovery from the listing, not documentation and not the exit** — both
  `commands/status.md` and `commands/abandon.md` name the flag, and the abandon command's own refusal
  names it when run. It was cut because naming a command beside a row is only correct where the
  command would work, and that condition is a second rule the note would have to carry: a row whose
  own `schema_version` is too new, or any row in a database that is, is refused with no flag able to
  lift it. Worth doing only if status-output discoverability counts as product work.

### OAI-175 — parked, `not worth doing`

**Why parked:** A pure documentation gap, filed at the bar's edge and saying so in its own body: *"Borderline against the filing bar and said to be: it is one paragraph of documentation."* `commands/status.md`'s "Reading the states" list omits `starting`, which `livenessOf` answers for the ordinary submit-to-register window. No operator has been observed confused by it.

**Reopening bar (an instance, with a date):** An operator observed misreading a `starting` row — treating it as stuck, or as a state this build should not produce — because `commands/status.md` does not list it. Record the session and the date.

*Filing kept verbatim:*

- **OAI-175** — **`commands/status.md` never names the `starting` display state.** Filed 2026-08-16
  from OAI-162's review; verified pre-existing at HEAD. The "Reading the states" list covers `queued`,
  `running`, `stalled`, `overdue`, `cancelling`, `malformed` and the four terminal states.
  `livenessOf` also answers `starting` — the ordinary window between a row being committed and its
  worker registering, which every normal submission passes through, and which `blockingSeqFor` treats
  as positive evidence that a local job is waiting. Borderline against the filing bar and said to be:
  it is one paragraph of documentation, filed because the omission is in the document whose whole
  purpose is to enumerate the states.

### OAI-178 — parked, `not worth doing`

**Why parked:** No instance. An observation from OAI-165's review-ladder pass 2 (`agent-closer`), explicitly non-blocking and deferred at the time. A bad `--repo` does fail on `--from did not resolve to a commit`, but nobody has been observed sent looking at the wrong thing by it.

**Reopening bar (an instance, with a date):** A real `bench/review-sweep.mjs --repo <bad path>` invocation where the `--from` wording actually misdirected someone. Record the command, what they looked at instead, and the date.

*Filing kept verbatim:*

- **OAI-178** — **A nonexistent or non-git `--repo` path fails on a misleading `--from did not resolve
  to a commit` error, not a clear "bad repo" message.** Filed 2026-08-17 from OAI-165's review-ladder
  pass 2 (`agent-closer`), non-blocking, deferred at the time. `bench/review-sweep.mjs`'s `optionsFrom`
  validates `--repo` is non-empty and resolves it lexically, but never checks the path exists or is a
  git working tree before `main()` calls `resolvePin`/`enumerateCommits` against it — the first git
  command against a bad path fails with a message about the `--from` ref, which does not name the real
  problem. Small: a clearer message at the first `git` call's failure, or a preflight `git rev-parse
  --git-dir` check in `optionsFrom`.

### OAI-179 — parked, `not worth doing`

**Why parked:** The item's own words: ***"No observed or reachable defect today"*** — `main()` is the only real call site and always passes `execute: (args) => invoke(args, options.repo)`, and every test that omits `execute` passes its own stub. It was filed so a future caller does not rediscover it, which is a note rather than work.

**Reopening bar (an instance, with a date):** A `runSweep` caller lands that omits `execute` while passing a foreign `options.repo`, and a sweep is observed reviewing this repo instead of the target. Record the commit, the wasted run and the date.

*Filing kept verbatim:*

- **OAI-179** — **`bench/review-sweep.mjs`'s `runSweep` silently reviews this tool's own repo if called
  with no `execute` and a foreign `options.repo`.** Filed 2026-08-17, an observation from OAI-165's
  verdict-point review (round 4, independent Claude verdict). `runSweep(commits, options, { execute =
  invoke, ... })` defaults `execute` to the module's `invoke`, whose own default `cwd` is `ROOT` — so a
  caller passing `options.repo` but no `execute` would review at this tool's own root regardless.
  **Latent only**: `main()` is the only real call site and always passes `execute: (args) =>
  invoke(args, options.repo)`; every test that omits `execute` passes its own stub instead. No observed
  or reachable defect today — filed so a future caller of `runSweep` doesn't rediscover it.

### OAI-182 — parked, `not worth doing`

**Why parked:** The reviewer's own framing, quoted in the item: *"the operative claim stays true... outside this round's scope."* Two additive documentation completeness gaps found at OAI-172's verdict point and left open deliberately — both non-blocking, neither a correctness defect, and no operator has been observed misled by either.

**Reopening bar (an instance, with a date):** An operator observed misreading a `forced-malformed` outcome — taking `abandon.md`'s two-case `--force` enumeration as exhaustive, or hitting `cmd-abandon.mjs`'s distinct `running`-arm message (*"Nothing could be judged about its process... an overlap cannot be ruled out"*) with nothing in the docs describing it. Record the session and the date.

*Filing kept verbatim:*

- **OAI-182** — **`commands/abandon.md`'s stale-beat caveat bullet is non-exhaustive about which
  `--force` cases skip it, and a separate bullet never mentions the malformed-running case at all.**
  Filed 2026-08-17 from OAI-172's verdict-point review (round 2, independent Claude verdict subagent)
  — both non-blocking, both left open rather than folded into OAI-172's fix.
  (1) The bullet's enumeration of when `--force` is what actually did the work — a fresh beat, or a
  beat whose recency couldn't be checked — omits `forced-malformed` (`abandonDecision`'s `malformed`
  rung), a third case where `--force` also did the work and the caveat is likewise absent. The
  operative claim (the caveat is keyed on `reason === 'stale'`) stays true regardless, but a reader
  may take the two-case enumeration as exhaustive.
  (2) `cmd-abandon.mjs`'s `report()` has a distinct `forced-malformed` message in its `running` arm
  ("Nothing could be judged about its process... an overlap cannot be ruled out") that `abandon.md`
  never describes at all — not wrong, just missing.
  Both are small, additive documentation completeness gaps, not correctness defects — the reviewer's
  own framing: "the operative claim stays true... outside this round's scope."

### OAI-186 — parked, `not worth doing`

**Why parked:** No instance. Found by an independent reviewer during OAI-65's own review-ladder pass 2, on a file outside that fix's four-file scope and untouched by its diff — the reviewer explicitly did not treat it as reopening OAI-65 (*"flag as a possible separate backlog item, not a reason to hold this change"*). `config.mjs:47-48` still does `mkdirSync` then `writeFileSync` with no `lstatSync` guard, but no symlink has ever been observed planted at `configPath()`'s directory.

**Reopening bar (an instance, with a date):** A symlink observed at the plugin's config directory (or at `providers.json` itself) that `mkdirSync`'s EEXIST-recovery stat or `writeFileSync` followed, with the seeded config landing somewhere it should not. Record the path, what was written where, and the date.

*Filing kept verbatim:*

- **OAI-186** — **`config.mjs`'s `loadConfig` creates the plugin's config directory the same
  symlink-following way `job-store.mjs` used to create the state directory.** Found by an independent
  reviewer during OAI-65's review-ladder pass 2, on a file outside that fix's four-file scope and
  untouched by its diff. `config.mjs:47-48`: on `ENOENT`, `mkdirSync(dirname(path), {recursive:
  true})` then `writeFileSync(path, ...)` — no `lstatSync` guard before either call, so a symlink
  planted at `~/.config/oai-plugin` (or wherever `configPath()` resolves) ahead of the plugin's first
  run would be walked into by `mkdirSync`'s own EEXIST-recovery stat, and the seeded default config
  would be written inside whatever directory the symlink points at.
  **Why this is a smaller, different-shaped item than OAI-65's fix, not a fold-in of it:** OAI-65's
  posture doc (`job-store.mjs:207-208`, "`0700` on the directory and `0600` on the file") explicitly
  names the state directory as secret-bearing — prompts and the full text of every attached source
  file. The config directory holds `providers.json`: provider names, base URLs, and (only when
  `apiKey` rather than the preferred `apiKeyEnv` is used) a credential — a real but narrower and
  differently-shaped exposure than OAI-65's threat model was scoped to close. The reviewer that found
  this explicitly did not treat it as reopening OAI-65: "outside this fix's stated threat model... flag
  as a possible separate backlog item, not a reason to hold this change."
  **The shape of the fix**, following OAI-65(b)'s own precedent directly: an `lstatSync`-based guard
  before `mkdirSync`, refusing rather than following a symlink at the config directory — the same
  `refuseSymlink` helper `job-store.mjs` now has, either reused or duplicated. Whether `providers.json`
  itself also needs the same `0600`/`0700` unconditional-repair treatment `job-store.mjs` now gives
  `jobs.db` and its directory is the open design question this item still needs a grill on — the
  config file is not currently chmod'ed at all, on either creation or a later load, which OAI-65 never
  claimed to touch.

### OAI-187 — parked, `not worth doing`

**Why parked:** No instance. Found by two independent reviewers during OAI-65's own review-ladder pass 4 and sharpened at pass 8, then disclosed at that fix's verdict point rather than folded in — widening an already eight-pass ladder onto a file-level guard with its own open design questions. `databasePath()` is still never passed to `refuseSymlink` in either `openOnce()` or `openStoreForReading()`, but no symlink has ever been observed planted at the `jobs.db` path.

**Reopening bar (an instance, with a date):** A symlink observed at the `jobs.db` path that `new Database(path)` or the subsequent `chmodSync(path, 0o600)` followed. Record the state directory's mode at the time, where the link pointed, and the date.

*Filing kept verbatim:*

- **OAI-187** — **`job-store.mjs`'s new symlink guard covers the state directory and `logs/`, never
  `jobs.db` itself.** Found by two independent reviewers during OAI-65's own review-ladder pass 4, and
  sharpened by a closing reviewer at pass 8: `databasePath()` is never passed to `refuseSymlink`
  anywhere, in either `openOnce()` or `openStoreForReading()` — only the containing directories are
  checked. A symlink planted at the exact `jobs.db` path, while the directory was still loose
  (pre-repair, from an older build or any other cause), is followed by `new Database(path)` and later
  `chmodSync(path, 0o600)`. **Not merely a pre-repair window**: the directory's own `chmodSync` repairs
  the directory's mode, not a symlink already sitting inside it, so a symlink planted at `jobs.db`
  survives the directory repair and is followed on every subsequent open too — a standing gap, not a
  bootstrap-only one.
  **Why this stayed out of OAI-65's own fix:** Codex (consulted directly during that review) suggested
  amending [OAI-95], but OAI-95's own text describes a different, withdrawn helper
  (`state-permissions.mjs`'s `restrict()`), never this gap — confirmed by grep across BACKLOG.md before
  filing here instead. Folding it into OAI-65 would have widened an already eight-pass ladder onto a
  file-level guard with its own design questions (does a readonly opener's guard differ from a writing
  one's; does this need the same two-check-per-operation TOCTOU narrowing OAI-65's directory guards
  now have) rather than the directory-symlink shape OAI-65/OAI-150 were scoped to.
  **The shape of the fix**, following OAI-65's own precedent directly: `refuseSymlink(path)` (or a
  variant checking the file rather than a directory — `lstatSync` already inspects the link itself
  regardless of what it resolves to) immediately before `new Database(path)`, in both `openOnce()` and
  `openStoreForReading()`, mirroring the two-check-per-operation pattern OAI-65's fix established for
  `state`/`logs`.

### OAI-188 — parked, `not worth doing`

**Why parked:** No instance. Two robustness gaps found during OAI-65's own review-ladder passes 7-8 and disclosed to (not fixed by) its dual-approval verdict point. `openStoreForReading()`'s `db.exec('PRAGMA busy_timeout = 10000')` has never been observed failing, and no newer-`schema_version` `jobs.db` paired with a loose state directory has ever existed on this machine. The item itself narrows (b): `openStoreForReading()` now carries the same symlink guard `openOnce()` does, *"so this is a MODE-repair gap specifically, not a symlink-following one"*.

**Reopening bar (an instance, with a date):** A leaked read-only handle observed from a failing `busy_timeout` pragma, OR a state directory observed staying loose across repeated `/oai:status` calls because `openJobs()` took the newer-`schema_version` branch. Record the mode, the two schema versions and the date.

*Filing kept verbatim:*

- **OAI-188** — **Two small robustness gaps in `job-store.mjs`'s `openStoreForReading()`/`job-view.mjs`'s
  `openJobs()`, found during OAI-65's own review-ladder pass 7-8 and disclosed to (but not fixed by)
  that fix's dual-approval verdict point.**
  **(a)** `openStoreForReading()`'s `db.exec('PRAGMA busy_timeout = 10000')` has no try/catch-and-close
  on failure, unlike `openOnce()`'s equivalent statements — a rare pragma failure leaks the just-opened
  read-only database handle rather than closing it before rethrowing.
  **(b)** When a database has a newer `schema_version` than this build understands, `openJobs()`
  returns the read-only handle from `openStoreForReading()` directly, without ever calling the hardened
  `openStore()` — so the unconditional directory-mode repair OAI-65 added never runs on that branch. A
  state directory that's loose and paired with a newer-schema `jobs.db` stays loose on every
  `/oai:status` for as long as that condition holds. Narrower than it sounds: `openStoreForReading()`
  now carries the same symlink guard `openOnce()` does (OAI-65's fix), so this is a MODE-repair gap
  specifically, not a symlink-following one.
  **The structural tests' comment-stripping regex** (`/\/\/.*$/gm` in `tests/job-store-modes.test.js`,
  pinning the check-ordering OAI-65 added) only strips `//` line comments, not `/* */` block comments —
  a latent gap with no live trigger in the file today, noted here rather than filed separately since
  it's the same "found during OAI-65's review, disclosed, not fixed" shape.
  **The shape of the fix**: (a) wrap the pragma call the same way `openOnce()` wraps its own; (b) either
  call `openOnce()`'s repair unconditionally before returning on the newer-schema branch, or accept and
  document that a newer-schema database is read-only territory this build cannot safely mutate anyway —
  a design question, not a mechanical fix.

## 2026-08-17 — parked by the backlog sweep's worth bar

One item, `not worth doing` — **never `refuted`**. The framing is correct: the duplication is real
and verified. It named no dated instance of drift, only a scenario ("a fourth failure reason added
without being added here") that has never occurred — the two vocabularies agree exactly at HEAD.
Checked against the silence exception and it does not qualify: when this does drift, the failure is
operator-visible (a wrongful `exit 1` from `/oai:abandon`), not evidence-destroying by nature.
Second-verdict from `codex-rescue` on 2026-08-17 concurred independently. **The reopening bar is an
INSTANCE, not an argument.**

### OAI-173 — parked, `not worth doing`

**Why parked:** No dated instance. `job-abandon.mjs`'s `RECONCILER_FAILURE_REASONS` set and
`job-reconcile.mjs`'s independently-written failure-reason literals currently agree exactly — verified
against disk 2026-08-17. The item's own stated consequence is conditional on a reconciler change that
has never happened.

**Reopening bar (an instance, with a date):** `job-reconcile.mjs` gains a new failure reason that
`job-abandon.mjs`'s `RECONCILER_FAILURE_REASONS` does not carry, and an operator observes `/oai:abandon`
exit 1 against a row whose queue recovery had in fact already freed it. Record the reason string added,
the commit, and the operator-visible symptom.

*Filing kept verbatim:*

- **OAI-173** — **The reconciler's failure vocabulary is retyped as literals with nothing pinning the
  two copies together.** Filed 2026-08-16 from OAI-162's review; verified pre-existing at HEAD.
  `job-abandon.mjs`'s `RECONCILER_FAILURE_REASONS` is `new Set(['worker-died', 'cancel-unconfirmed',
  'worker-never-started'])` — the failure reasons `job-reconcile.mjs` writes on a `failed` row,
  retyped, with no shared constant and no test asserting the two agree. (`reconcile` also returns
  `cancelled`, which is a state rather than a failure reason and is handled by its own arm in
  `recoveryOwned`.) The set decides that a `failed` row was settled by recovery and may be reported
  idempotently rather than refused. A fourth failure reason added to the reconciler without being
  added here would make `/oai:abandon` exit 1 at an operator whose queue recovery had in fact just
  freed — precisely the outcome the idempotent arm exists to prevent — and nothing would go red.

## 2026-08-14 — parked by the backlog sweep's worth bar

Two items, both `not worth doing` — **never `refuted`**. Each framing is correct. The bar was applied
to the ten items filed SINCE the 2026-08-13 pass, not re-applied to the 89 that pass already cleared:
re-litigating a bar one day later is not a sweep, it is churn. Eight of the ten carried a dated
instance; these two did not. **Every reopening bar here is an INSTANCE, not an argument.**

### OAI-153 — parked, `not worth doing`

**Why parked:** No instance. The item states its own harm as hypothetical — a later build deriving a
streak the run itself would never have computed — and says outright it is "not ship-blocking: in every
real use the recovery tool runs against the same build within hours". Verified 2026-08-14: the ledger
header still carries no `schemaVersion` (`bench/lib/sweep-ledger.mjs`), so the mechanism is real and
unfired. The record it cited to make itself filable, `adr/022`, was deleted with the ADR corpus.

**Reopening bar (an instance, with a date):** A recovery run whose derived streak disagrees with the
run's own — `bench/recover-sweep.mjs` producing a health section a reader acts on and that the original
sweep would not have produced. Record the two streaks and the date.

*Filing kept verbatim:*

- **OAI-153** — **The ledger header carries no schema version, so a recovered streak is bound to the
  build that recovers it.** Raised 2026-08-13 by `codex-adversarial` at pass 1 of OAI-132's review
  ladder [high/0.96]; the documentation half shipped, the mechanism did not.
  `isOutage` can change between a run and its recovery, so a later build may derive a streak the run
  itself would never have computed. That is the cost of deriving rather than storing, and **ADR 022 now
  states it**; a `schemaVersion` in the header would let a future build *detect* the mismatch instead of
  silently suffering it. Not ship-blocking: in every real use the recovery tool runs against the same
  build within hours. Deferred rather than dismissed — the stored-counter alternative is worse, since a
  second representation of one fact is free to disagree with the entries beside it.

### OAI-154 — parked, `not worth doing`

**Why parked:** Its shipped half is shipped (the ledger and record are created `0o600`, verified
2026-08-14 at `bench/lib/sweep-ledger.mjs` and `sweep-report.mjs`). Its live half is redaction, which
the item itself assigns elsewhere — "a base URL with an embedded credential is the subject of the
existing OAI-91/92/95" — so what remained here was a filing so the split was on the record, not work.
No instance of a credential reaching a sweep artifact has been observed.

**Reopening bar (an instance, with a date):** A credential actually found in a `bench/results/`
artifact — the ledger, the record or a captured stderr stream — quoted with the run stamp it came from.

*Filing kept verbatim:*

- **OAI-154** — **Captured stdout/stderr can carry a credential, and file mode is the only thing
  limiting who reads it.** Raised 2026-08-13 at pass 1 of OAI-132's ladder and split: **the file-mode
  half shipped** (the ledger is created `0o600`, and at pass 2 the `.json` record too, since only those
  two carry the raw streams — the rendered `.md` emits neither and is deliberately left at the umask).
  **Redaction was deferred and stays deferred.** A base URL with an embedded credential is the subject
  of the existing OAI-91/92/95, and widening a feature to cover it is how a feature stops converging.
  Filed here so the split is on the record and the shipped half is not mistaken for the whole.

## 2026-08-13 — parked by the backlog sweep's worth bar

Six items, all `not worth doing` — **never `refuted`**. Each framing is correct; none named an instance
of harm that had already happened, which is the bar (`adr/069`). Three said so in their own words, and
those quotes are kept below rather than paraphrased. **Every reopening bar here is an INSTANCE, not an
argument**: a better-sounding case for one of these does not reopen it, because that is what parked it.
The bar was applied to all 101 surviving items, not to a chosen subset.


### OAI-7 — parked, `not worth doing`

**Why parked:** No dated instance of harm exists in the body or in any ADR; the sweep searched both.

**Reopening bar (an instance, with a date):** Someone other than the author tries to install this plugin and cannot — a named person, with the date. Until then the `--plugin-dir` path is how it is used and nothing is blocked.

*Filing kept verbatim:*

  - **OAI-7** — Publish: README install instructions, and verify the marketplace path
    (`claude plugin marketplace add`) actually resolves this repo once it has a remote.


### OAI-36 — parked, `not worth doing`

**Why parked:** Verified 2026-08-13 by the sweep: nothing reads `bench/results/*.json` back in, and `renderReport` has exactly one production call site (`bench/run.mjs:265`). The trap is real and unreachable.

**Reopening bar (an instance, with a date):** A replay or re-render path is added — `--render <file>`, or anything that reads `bench/results/*.json` back. The sweep verified on 2026-08-13 that nothing does today, which is exactly why the trap cannot fire yet.

*Filing kept verbatim:*

  - **OAI-36** — If a re-render command is ever added, the reliability prose becomes schema-dependent.
    Filed 2026-08-03 from the OAI-31 review, where it was raised at high confidence (0.99) and
    **dismissed with evidence rather than fixed** — recorded here because the evidence is exactly what
    a future change would invalidate. `reliabilitySection` renders "an attempt record carries `<nine
    fields>`" from `RECORD_FIELDS`, pinned against a live ledger entry. That sentence is true of
    entries the *current* ledger produced, and today it can only ever describe those: `renderReport` is
    called from exactly one place, `bench/run.mjs:251`, on live results, and nothing reads
    `bench/results/*.json` back in. Add a `--render <file>` or any replay path and the report can
    describe a record written before `promptChars` or `waitedMs` existed, while the prose asserts nine
    fields it never had. The fix then is to version the serialized attempt schema at the report
    boundary and condition the enumeration on the schema actually present — not to weaken the sentence,
    which is the one thing that made it checkable. Cheap now, invisible later: whoever adds replay will
    not think to look at a paragraph in the reliability section.


### OAI-43 — parked, `not worth doing`

**Why parked:** Its own body: *"Worth an hour to decide deliberately; worth nothing to change by reflex"* — and it records the duplication tripwire firing usefully twice (OAI-31, then OAI-35).

**Reopening bar (an instance, with a date):** The two-place edit FAILS to fire: a field is added to the ledger and `RECORD_FIELDS` does not go red, or the reader-facing paragraph goes stale while the key-set test stays green. Its own body records the tripwire firing usefully twice, so the evidence currently runs the other way.

*Filing kept verbatim:*

  - **OAI-43** — Decide whether the attempt record deserves one schema both sides read. **Low priority,
    and it may close as "no" — it is filed because it was rejected on judgement rather than on
    evidence.** Raised by `codex-adversarial` in OAI-35's pass 2 and dismissed there as out of scope.
    The observation: adding a field to the ledger means editing two places — `newEntry` in
    `scripts/lib/attempt-ledger.mjs`, and `RECORD_FIELDS` in `bench/lib/reason-notes.mjs` — and
    `RECORD_FIELDS` is attempt-record schema metadata living in a *rendering* helper because one
    paragraph happens to enumerate it. Codex's read: a shared record schema would be the genuine seam,
    and the current arrangement is a size-driven extraction wearing one.
    The counter, which is why it was rejected: that two-place edit **is the designed tripwire**. The
    key-set test goes red the moment the two disagree, which is what forces the reader-facing paragraph
    to be re-read rather than left quietly describing a record it no longer matches — and that tripwire
    has now fired usefully twice (OAI-31, then OAI-35). A shared schema keeps them in sync
    automatically, which sounds better and would have *removed* the prompt to re-read the prose.
    So the real question is not "is this duplication" but **"is the duplication load-bearing"**, and
    OAI-35 gave weak evidence for both sides: the tripwire worked, and separately three documents
    still went stale on a witness count no tripwire watched. Worth an hour to decide deliberately;
    worth nothing to change by reflex. If it is done, the paragraph must keep something that fails when
    the record changes, or the one guard that has demonstrably worked here is traded for tidiness.


### OAI-47 — parked, `not worth doing`

**Why parked:** Its own body: *"So nothing is currently wrong."*

**Reopening bar (an instance, with a date):** A TTL challenge record is read somewhere its `BACKLOG_DONE.md` attestation is not — copied off this machine, or cited when the tree state matters — and its provenance cannot be established.

*Filing kept verbatim:*

  - **OAI-47** — Make the TTL challenge record self-attesting by stamping the git revision into
    `environment`. **Small, and filed as satisfied-but-improvable rather than as a defect.** The
    manifest's `environment` is `{startedAt, model, lmsCommit, residentBefore}` — it names the `lms`
    build but not the revision of *this* repo that produced it, so the artifact cannot say which
    instrument wrote it. OAI-34's done-condition anticipated exactly this and solved it out-of-band:
    the handover records the SHA in `BACKLOG_DONE.md`, and the 2026-08-04 run did so (`0c566b6`). So
    nothing is currently wrong. What is fragile is that the attestation lives in a *different file*
    from the record, and `bench/results/` is gitignored — a record copied off this machine arrives with
    no provenance at all. Add `gitRev` (and whether the tree was dirty, which matters more: a canonical
    run from a modified tree is not the reviewed instrument, and today nothing in the record would say
    so). Cheap, and it is the same class this repo already files — a claim that is true because a human
    remembered to write it down elsewhere.


### OAI-82 — parked, `not worth doing`

**Why parked:** Its own body: *"Not a defect — the invariant holds by instruction and the refusal is the point."*

**Reopening bar (an instance, with a date):** A delegate run is observed making more than two `task` submissions, or accepting more than one job. The invariant holds by instruction today and the item says outright it is not a defect.

*Filing kept verbatim:*

  - **OAI-82** — **"At most two `task` submissions, at most one accepted job" is not auditable.** Filed
    2026-08-05. The invariant is stated in the agent, ADR 015, this tracker and the done entry, and only
    its *accepted* half leaves a trace: an oversize refusal happens before any row exists, so a second
    submission is invisible afterwards and nothing can reconstruct the count from persisted state. Not a
    defect — the invariant holds by instruction and the refusal is the point — but it is a claim the
    repo cannot check, which is the class this repo keeps promoting into structural tests. If it is ever
    worth checking, the cheap form is a pre-publication attempt counter on the row rather than an
    idempotency key; note that Codex proposed the full transactional design and it is far more than this
    earns.


### OAI-152 — parked, `not worth doing`

**Why parked:** Its own body: *"Observed while building OAI-132, 2026-08-13; **not measured**."*

**Reopening bar (an instance, with a date):** An actual run fills a disk, or a ledger is observed above ~50MB. This bar is the item's own words, written when it was filed.

*Filing kept verbatim:*

  - **OAI-152** — **The ledger is written with nothing checking the disk can hold it.** Observed while
    building OAI-132, 2026-08-13; **not measured**. `classify` keeps up to `MAX_RAW` (256KB) of stdout
    *and* stderr per entry, so a pathological night could write ~20MB of JSONL into `bench/results`
    (gitignored). **Accepted deliberately rather than fixed** — bounding it would mean the ledger holding
    less than the record it must reconstruct — and a failed append declares a `gap` line rather than
    vanishing, so the loss is visible. Filed so the trade is recorded rather than rediscovered and
    re-argued. **The bar for it being real:** an actual run that fills a disk, or a ledger observed above
    ~50MB.

# Parked

Items whose *framing* was disproved, not merely deprioritised. Each carries a **reopening bar**: what
would have to be observed for it to become live again. IDs here are still stable and global, and
`BACKLOG.md`'s absorbed-ID table points at this file.

- **OAI-44** — Decide whether a *confirmation-capable* server-state instrument is worth building.
  **Parked 2026-08-05 by the backlog sweep.** It was already marked "Parked, not closed" in its own
  text and sitting in the live ordered list anyway; the sweep moved it to where that word means
  something. Filed 2026-08-04 by OAI-34, which withdrew its own confirming verdict during
  the plan gate — see [ADR 013](adr/013-observing-the-server.md)'s amendment. The reason is structural
  rather than a gap in effort: proving an unload happened after expiry requires observing the model
  still resident **after** expiry, and a mechanism that fires **at** expiry never leaves that
  observation behind. Four designs were tried and each failed on a different axis (clock origin;
  bracket width, where present-at-119s/absent-at-121s straddles a 120s expiry; a calibration-derived
  bound on the spawn-to-receipt offset, invalid because `prefillMs` starts before the HTTP request and
  the driver's `Date.now()` is not the monotonic clock attempts are timed on; and gating on the
  exposure margin, which is post-treatment — the hypothesised eviction truncates the very measurement
  used to decide whether the episode was exposed).
  So this is not "try harder with sampling". The two designs that could actually earn a confirmation:
  **(a) matched controls** — randomised challenge TTLs with long-TTL controls, requiring unload timing
  to *move with* the assigned TTL, which makes TTL the manipulated variable instead of resting on one
  coincidence at 120s; ADR 013 costed the corpus-wide version at 3–4h on the MoE and 9–12h on the
  dense, but a single-case version is much cheaper and was never costed. **(b) server-side telemetry**
  — if LM Studio ever exposes an unload *reason* or a lifecycle event, the whole problem collapses to
  reading it. Check that first; it is a five-minute question and it decides whether (a) is worth
  hours.
  **A second thing any confirming design must fix, recorded here so it is not rediscovered:** the
  sampler's `in-flight` phase means *the child process is alive*, not *the HTTP request is open*. An
  absence seen after the request already failed but before the companion exits falls inside that
  window. That is ADR 013's own "an unload after the request had already failed" disqualifier, and it
  is harmless today only because nothing is attributed. It becomes load-bearing the moment anything is.
  **The precondition on this item is now discharged, and it landed on the side that argues against
  building anything.** It said: do not start before OAI-34 has run, because if three episodes survive
  a 120s TTL against a 335s prefill then the deterministic form is refuted and the appetite for
  confirming a mechanism that just failed to appear should be re-examined rather than assumed. **That
  is exactly what happened on 2026-08-04** — 3/3 survived, 336s of prefill, continuously resident,
  216s of slack at the narrowest. So the honest default for this item is now **"no"**, and it needs a
  positive reason to move rather than merely an unanswered question. What would supply one: a drop
  recurring on the MoE, or on a case this run did not cover, since the refutation is dense-27B/
  `scaffold`/120s only.
  **One finding from that run bears directly on design (b), and shortens it.** The residency
  endpoint reports **`lastUsedTime: null` for the entire time it is serving a request** (`status`
  went `processingPrompt` for 168 consecutive samples per episode, then `generating`). So the field
  ADR 013 nominated as activity evidence is not populated in flight, and `activityObserved` came back
  `null` in all three episodes. Any telemetry-based design must therefore find a *different* signal
  than `lms ps`'s activity fields — checking whether one exists is still the five-minute question to
  ask first, but it should not be asked of that field.

  ### Reopening bar

  **A drop recurring on the MoE, or on a case the 2026-08-04 run did not cover.** The refutation that
  parks this item is dense-27B / `scaffold` / 120s only, at N=3 with a ~63% one-sided upper bound on
  the failure rate — so it does not cover the MoE, where 27/72 of the original drops were also seen.
  Either observation restores a live mechanism to confirm and makes this item worth costing again.
  **The cheap check comes first and is not gated by any of that:** if LM Studio ever exposes an unload
  *reason* or a lifecycle event, design (b) collapses to reading it, and that is a five-minute
  question. Asking it does not require reopening this item; getting a yes does.
