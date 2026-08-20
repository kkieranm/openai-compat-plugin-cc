# Backlog header — prior narratives

Moved out of `BACKLOG.md`'s header by the backlog sweep, 2026-08-17. **No wording is rewritten or
summarised**: these are two prior sweeps' own rewrite notes, exactly as they stood in the live
header, word for word. The one change is mechanical: the three relative links inside them
(`evidence/138.md`, one `plans/` link, two `adr/` links) pointed at paths relative to the repo root,
which is where `BACKLOG.md` sits; moved into `evidence/`, that same text would resolve one directory
level wrong, so those link targets were adjusted to still resolve correctly from here — nothing else
was touched. What the notes explain (the plan direction, why the ordering isn't stage order, which
stages shipped and what residue they left) is still true, but by 2026-08-17 both blocks were paying
their cost — 3,300+ bytes of header, read on every open of the file — for context the tier list then
in `BACKLOG.md` already carried in its own per-tier rationale (at the time, "Tier 6, what shipping
Stage 2 left behind" explained the OAI-85/86/87/88/89/90 residue inline; that tier list was itself
retired 2026-08-20, owner-directed, and no longer carries this). The live header now carries one
compact paragraph pointing to the plan; this file is where the fuller account lives.

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
