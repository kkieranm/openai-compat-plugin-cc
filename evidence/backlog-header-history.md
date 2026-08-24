# Backlog header — prior narratives

Moved out of `BACKLOG.md`'s header by the backlog sweep, 2026-08-17 (the two sweep-rewrite blocks
below) and by the owner's own request, 2026-08-24 (the "parked theme" block, added below that).
**No wording is rewritten or summarised**: these are prior header sections, exactly as they stood in
the live header, word for word. The one change is mechanical: relative links inside them
(`evidence/138.md`, `plans/` links, `adr/` links) pointed at paths relative to the repo root,
which is where `BACKLOG.md` sits; moved into `evidence/`, that same text would resolve one directory
level wrong, so those link targets were adjusted to still resolve correctly from here — nothing else
was touched. What the notes explain (the plan direction, why the ordering isn't stage order, which
stages shipped and what residue they left, and why the reviewer-trustworthiness gate was parked) is
still true as history, but each earned its removal on its own terms — see each block's own framing.
The live header now carries only what still orients a reader today; this file is where the fuller
account lives.

> ## The parked theme, retired 2026-08-24 — "make `/oai:review` trustworthy before extending the
> plugin further"
>
> Removed from `BACKLOG.md`'s header at the owner's request, once OAI-19 (the baseline this section
> was written around) concluded — both arms exhausted their gate invocations as failures, so the
> section's own premise (this is the context for why the measurement programme was parked, and what
> the reviewer's trustworthiness stood at when it was) had nothing further to orient a reader toward.
> The theme itself — a sequencing rule that gated all further plugin extension on proving the
> reviewer trustworthy first — was superseded 2026-08-04 by the broader direction change toward
> "use local LLMs like I use Codex"; this is that superseded rule's own justification, kept verbatim
> rather than deleted.
>
> ### The parked theme — "make `/oai:review` trustworthy before extending the plugin further"
>
> Parked 2026-08-04 by the direction change, and kept here rather than in `BACKLOG_PARKED.md` because it
> is context for the measurement-programme items (OAI-50, OAI-49, OAI-9, OAI-11, OAI-13) rather
> than an item itself. OAI-19, the baseline this section's own prose still refers to below, concluded
> 2026-08-24 with both arms published as failures — see `BACKLOG_DONE.md` — so a reference to it here as
> still-pending work is history, not a live pointer. Everything in it was sized to answer "is the reviewer
> trustworthy" before extending the plugin — and OAI-51 then found the reviewer was crashing the model
> backend with its own request, so the thing being measured was broken throughout. Stage 0 changed how
> replies are produced, which invalidates any baseline taken before it.
>
> Where the reviewer actually stands, stated plainly because it is easy to overrate: OAI-14 removed the
> largest false-positive class (3-of-3 → 0-of-3 on the one commit with a baseline), and the 2026-07-30
> OAI-19 attempt added two anchored true positives on a real commit diff (dense 27B on `scaffold`: two
> *different* defects, one per attempt — `credential-inherited-across-origin`, then
> `url-origin-strips-credentials`; neither found twice — joining the four anchored matches recorded
> before it, one of which was the same case in commit mode by the old MoE quant on 2026-07-28). Those
> are catches from arms that failed their acceptance gates, so recall remains without a publishable
> number and the catches are **existence proofs, not a rate**.
>
> The reviewer is useful once checking its claims costs less than its catches are worth. **OAI-15
> (2026-07-28) changed how a censored run is treated, and raised the ceiling — it did not prove the
> censorship gone, and the difference matters.** The `analysis` cap is now derived from the reply budget
> each run is granted rather than fixed at a number the budget only coincidentally afforded, and a run it
> truncates has its findings scored instead of discarded: half the corpus, **17 of 41 recorded runs**, was
> being thrown away along with two of the four anchored matches ever produced. Measured 2026-07-30
> (OAI-19 attempt, bounded — the arms failed their gates): `config-origin` and `structured` no longer
> cut for the dense model (`structured` on the diff-only rung there — see the confound note under
> OAI-19), but `scaffold` still cuts 2/3–3/3 and `model-info` 1/3, so **the ceiling still bound for the
> dense model on the largest cases**. Then measured again 2026-08-04, MoE arm: **zero cut runs across
> the corpus**, the first full arm on record with none. See [ADR 008](../adr/008-sizing-the-review-reply.md).
>
> **OAI-12 landed, so tuning is no longer guesswork — and it then refuted its own first headline, which
> is the instrument doing its job.** `npm run bench` scores the shipped command against 11 catalogued
> defects in six snapshots of this repo's history and writes a per-run record, ending the era where a
> conclusion was kept and its evidence thrown away (ADR 004 says "four runs", `890ee2e` says "five",
> same experiment, neither now checkable). Baseline: ~~**1 of 6 scoreable defects at N=1, 10.9
> minutes**~~ — struck 2026-07-30: computed under the pre-OAI-15 rule that excluded cut runs from the
> denominator, so it is not directly comparable with anything measured since. **No comparable
> replacement was ever obtained**: OAI-19 was the attempt, and it concluded 2026-08-24 with both arms
> exhausting their invocations under gate as failures — see `BACKLOG_DONE.md`. 11 defects are catalogued,
> but 5 belong to the two cases whose runs were cut mid-reasoning and are unscored rather than missed.
>
> - ~~**Context dilution is measured.**~~ **Retracted 2026-07-28, by the instrument itself.** The
>   "found at 1,575 tokens, missed at 47,072" pair varied token count, git mode, prompt shape and
>   defect count together, at N=1 per arm. A three-arm run settled it: the same case at **half the
>   tokens produced zero findings in three runs**, and the corpus's *smallest* input was cut 3 times
>   out of 3. There is no dilution effect in this data, and the reordering it was about to justify has
>   been dropped. See the correction section in [ADR 006](../adr/006-benchmarking-the-reviewer.md).
> - **The `analysis` cap was the binding constraint, and it was mis-sized.** **17 of 41 runs ever
>   recorded here never finished looking.** The ceiling was set in OAI-10 "above every observed
>   successful run" from a sample that had not yet seen a normal run reason long — it sat *inside* the
>   model's ordinary reasoning distribution, truncating working reviews rather than runaways. Cutting
>   does **not** track input size: the 1,575-token case reasoned for 7,367–9,440 completion tokens
>   where the 47,072-token case used 3,552, and the corpus's smallest input cut 6 of 9 while a case
>   barely larger cut 0 of 9. **Addressed in OAI-15, 2026-07-28** — and note what that did *not*
>   settle. The reasoning distribution had no observable right edge under a cap truncating 41% of runs,
>   so the new ceiling is sized from wall clock rather than from the distribution.
>
> What the bench is *not* is a measure of true recall: the denominator counts only defects that could
> be pointed at in the snapshot, which is smaller than what history claims and therefore flatters it.
> See [ADR 006](../adr/006-benchmarking-the-reviewer.md); the harness prints the same caveats every run.
>
> > **Discharged 2026-07-27:** the owed built-in `/code-review high` ran over `structured.mjs`,
> > `client.mjs` and `cmd-review.mjs` (`c552bcd..HEAD`), covering OAI-4 and OAI-10 in one pass —
> > 25 agents, 1.07M tokens, no deaths. Ten findings: **5 confirmed and fixed**, 5 vendor-dependent
> > and parked as **OAI-13**. The new-module trigger earned its keep: the two most severe (a cut
> > review rendering as a clean pass; a 12k-token input-budget regression) were both in exactly the
> > vendor-assumption code the trigger targets, and neither `advisor` nor the lean workflow caught
> > them across four and two passes respectively.
> >
> > **Discharged 2026-08-05:** OAI-58, the owed step 6 review ladder on OAI-3, ran and closed by dual
> > approval, producing the OAI-61 … OAI-73 block. Its record is in `BACKLOG_DONE.md`.
>
> Note on the `adr/` links above (`ADR 006`, `ADR 008`): the whole `adr/` directory was deleted in
> `d1ad2aa` (2026-08-13, see OAI-159, still live in `BACKLOG.md`). Left them unrepointed for the same
> reason as the note below: a citation into a mutable file is never rebased by hand.

> ## Sweep, 2026-08-14 — what verification changed, which was almost nothing
>
> **84 items were verified against disk by six parallel readers, split by evidence domain. Not one was
> closeable.** One sub-claim had been fixed (OAI-55(1) — the endpoint notice no longer interpolates the
> query), one internal correction was itself refuted (OAI-42's "only one reader" is false; there are
> at least two and a dozen mint sites), and four counts had drifted. Everything else is still true
> today. **That is the finding**: the 2026-08-13 sweep already did the closing work, so this one had
> nothing to close and should not pretend otherwise by churning the order.
>
> **What it did do.** Filed two defects it found while checking: **OAI-158** (the tracker guard cannot
> see six of the seven parked items — mutation-proved) and **OAI-159** (78 citations across 37 items
> point at a deleted `adr/` corpus). Parked **OAI-153** and **OAI-154** under the worth bar, applied
> only to the ten items filed since the last pass. Moved 17,405 bytes of OAI-138's measurement tables
> to [`evidence/138.md`](138.md) as a byte-asserted pure partition — it was two thirds of the
> largest item in the file, all of it evidence for a decision that has already landed.
>
> ## Where this stands, 2026-08-05 — rewritten by a backlog sweep
>
> The direction is still **"use local LLMs like I use Codex"** —
> [`plans/local-llms-like-codex.md`](../plans/local-llms-like-codex.md), paired with Codex. What changed
> is that its first two stages have **shipped**, and the header this replaces had not caught up: it
> said "OAI-51 **IS** Stage 0 and is the one item here that is live", which stopped being true the day
> it was written.
>
> - **Stage 0 shipped** (OAI-51, 2026-08-04, `db46d1f` `5675da5` `a23fdde`) — verified against disk by
>   this sweep and moved to `BACKLOG_DONE.md`.
> - **Stage 1 shipped** (OAI-3, 2026-08-05) and **Stage 1b** with it (OAI-5) — and their review
>   ladders filed **23 items**, 22 of which are still live: **44% of this file**, from two features.
> - **Stage 2's first piece shipped** (OAI-83, 2026-08-05) — `/oai:task --template advisor`, decision
>   record [ADR 016](../adr/016-a-template-is-three-things.md). Its review filed OAI-85 and OAI-86.
> - **Stage 2's remainder shipped** 2026-08-06 — `--json`, a task benchmark, pre-submission time
>   estimates, `diagnose` and `patch` templates, and file slices; decision record
>   [ADR 017](../adr/017-measuring-a-task-not-a-review.md). **Two of its deliverables were reported as
>   shipped and were not built** (OAI-90), its review ladder never reached approval (OAI-89), and the
>   gate it exists to answer is still unmeasured (OAI-87) against a corpus of one case (OAI-88). Those
>   four are the residue, and they were only visible because the ladder ran late.
>
> **So the ordering below is not the plan's stage order, and that is deliberate.** The stages still
> say what to *build* next; they say nothing about the defects the last two stages shipped with. A
> credential proved on the wire to reach the wrong tenant, and a plugin that fails to load on the Node
> versions its own `package.json` declares, outrank the next feature. Stage 1's **residue** leads;
> Stage 2 follows it; the measurement programme trails both.
>
> **The measurement programme is no longer suspended.** OAI-19 said "no further arm runs until OAI-51
> is resolved" — OAI-51 is resolved, so that clause is discharged. **One thing replaced it, and it is
> much smaller: OAI-84 changes the reply parser**, so the arm should run once that lands rather than
> immediately. It is not near the top because the plan stopped making it the ordering, not because
> anything blocks it — and it costs hours of the user's own LM Studio, so it is launched when they say
> so, never incidentally.

Note on the `adr/` links above (`ADR 016`, `ADR 017`): the whole `adr/` directory was deleted in
`d1ad2aa` (see OAI-159, still live in `BACKLOG.md` — 78 citations across 37 items point at the same
deletion, and this file is one more instance now added to that count). The `plans/` link is
unaffected — `plans/local-llms-like-codex.md` still exists. Left the `adr/` links
unrepointed here deliberately, per this repo's sweep discipline: a citation into a mutable file is
never rebased by hand, only replaced by the decision OAI-159 is asking for.
