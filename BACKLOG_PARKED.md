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
