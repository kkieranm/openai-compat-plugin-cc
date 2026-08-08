# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

> ## Where this stands, 2026-08-05 — rewritten by a backlog sweep
>
> The direction is still **"use local LLMs like I use Codex"** —
> [`plans/local-llms-like-codex.md`](plans/local-llms-like-codex.md), paired with Codex. What changed
> is that its first two stages have **shipped**, and the header this replaces had not caught up: it
> said "OAI-51 **IS** Stage 0 and is the one item here that is live", which stopped being true the day
> it was written.
>
> - **Stage 0 shipped** (OAI-51, 2026-08-04, `db46d1f` `5675da5` `a23fdde`) — verified against disk by
>   this sweep and moved to `BACKLOG_DONE.md`.
> - **Stage 1 shipped** (OAI-3, 2026-08-05) and **Stage 1b** with it (OAI-5) — and their review
>   ladders filed **23 items**, 22 of which are still live: **44% of this file**, from two features.
> - **Stage 2's first piece shipped** (OAI-83, 2026-08-05) — `/oai:task --template advisor`, decision
>   record [ADR 016](adr/016-a-template-is-three-things.md). Its review filed OAI-85 and OAI-86.
> - **Stage 2's remainder shipped** 2026-08-06 — `--json`, a task benchmark, pre-submission time
>   estimates, `diagnose` and `patch` templates, and file slices; decision record
>   [ADR 017](adr/017-measuring-a-task-not-a-review.md). **Two of its deliverables were reported as
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

<!-- tiers -->
### The order, by impact — tiers, and why each leads where it does

Impact is blast radius × whether the thing is wrong *today* ÷ cost to resolve. Ties break on what has
to be decided or measured first. **This list is the priority view; the bodies below sit in ascending
ID order and a re-order rewrites only this index** (`adr/025` — the one-time migration was performed
2026-08-08). The close-out asserts the index covers the live set exactly and that the bodies are in ID
order, so the two cannot drift apart silently. **Note the invariant CHANGED on 2026-08-08**: it used
to be "the index sequence equals the heading sequence", which is why OAI-104 describes a guard that
never ran — re-read that item against this convention before working it.

**Tier 1 — a background job kills, loses or misreports live work.** **OAI-62, OAI-67, OAI-66, OAI-64,
OAI-69**. One subsystem, five independent closes, so they sit adjacent rather than merged. OAI-62
leads: it kills a worker mid-model-call and discards an answer the model already paid for. OAI-67 and
OAI-66 mis-report an ending (a blocked queue reported as nothing; a crash published as a clean
`cancelled`). OAI-64 trails the three that are wrong on their own, and **gates OAI-69** — ADR 014
accepts the recycled-pid wedge *on the stated condition* that `/oai:status` names the blocker, which
OAI-64 shows it does not, so OAI-69 is not an independent gap and must not be scheduled as one.

**Tier 2 — a credential or a file leaves the boundary it was promised.** **OAI-63, OAI-65, OAI-72,
OAI-55, OAI-74, OAI-76, OAI-77, OAI-81**. OAI-63 leads on evidence: the leak is proved on the wire,
not argued. OAI-65 is next because its load-bearing half is a directory mode nothing re-tightens, so
every later WAL file inherits it. Then the three that are one decision apiece (OAI-72's config mode
and query echo; OAI-55's redaction), then the delegate's containment surface — **OAI-74 with OAI-76
are one decision viewed twice** (where the boundary lives, and what verb the agent is allowed) and
should be decided together even though they close separately. OAI-77 and OAI-81 trail: both need
local write access or a mis-selection, and neither has a path-shaped fix.

**Tier 3 — `/oai:review` returns no answer at all, or throws away the one the model gave.**
**OAI-115, OAI-116, OAI-113, OAI-114, OAI-117, OAI-112, OAI-59, OAI-70, OAI-68, OAI-60, OAI-57,
OAI-80, OAI-82, OAI-84**. Re-led on 2026-08-08 by measurement: the tier used to be trap instance 14's
family (`findings: null` against `[]`), and it still contains it, but a *worse* class now sits on top
of it and is wrong on the shipped default path today.

**OAI-115 leads the whole tier and is arguably the sharpest item in this file**: `max_tokens` is a
single pool shared by reasoning and the answer, so on a large target the model spends the entire
budget thinking and emits no findings. Measured across three benchmark arms — four cases, four
budgets spanning 4.5x, reasoning terminating at 86-94% of each — and it is **model-modulated, not
model-fixable**: the MoE starved on 4-5 of 6 cases, the dense model on 1 of 6, and the dense model has
the *smaller* window. Both cheap escapes are already refuted (a bigger budget is simply consumed; no
reasoning control exists on this server), so it needs a reserved floor for the answer.

**OAI-116 is next because it is small and it unblocks a gate**: the token-exhaustion path records no
`attempts[]`, which makes OAI-19's G-E structurally unpassable and destroys the reliability evidence
exactly where failures are most interesting. **OAI-115 and OAI-116 together gate OAI-19 in tier 6** —
no further benchmark arm can pass its own gate until both land, which is why the measurement tier did
not move up despite being unblocked in every other sense.

**OAI-113 and OAI-114 are self-contained and evidence-complete**, both filed from OAI-84's review
ladder and both wrong today: a quadratic scan measured at 39.15s of CPU against 0.13s controls on
model-controlled input, and a regression from base where one primitive sibling discards an entire
findings list. Either can be done in an afternoon without waiting on anything. **OAI-117 is smaller
still** and buys a real answer: `bench` cannot pass `--structured-output`, which is the only reason it
is still unknown whether a schema fixes the OAI-115 starvation.

**OAI-112 is the design job and sorts after the cheap wins deliberately.** It is the candidate-selection
withdrawal from OAI-84's ladder, **adjudicated PARTIAL by the user on 2026-08-07** — the two repairs
OAI-84 shipped stay, and only candidate selection is replaced, through a fresh plan gate and its own
ladder. Its evidence names two structural defects, not one: multiplicity is a signal neither content
nor position represents, and `extractJson` admits a candidate with no extent that survives containment
by accident of the caller's predicate. **Scope it as candidate SELECTION, not "ambiguity"** — scoped
to multiplicity alone, the extent defect survives the replacement.

Then the original family: OAI-59 is the same `null`-versus-`[]` shape on `/oai:result`; OAI-68 sorts
after OAI-63 in tier 2, whose payload decision it collides with; OAI-57's `--json` is the natural home
for OAI-80(a), so those two are batchable. **OAI-84 trails the tier because it is SHIPPED and
BLOCKED** — both repairs landed and were audited, but its ladder ended at its terminal pass without
dual approval, so it is not done and nothing further can be done on it until OAI-112 is planned.

**Tier 4 — what shipping Stage 2 left behind.** **OAI-85, OAI-86, OAI-53, OAI-54, OAI-56, OAI-87,
OAI-88, OAI-89, OAI-90**. The last four are Stage 2's own residue, filed 2026-08-06 after a review
ladder that ran late: OAI-90 is two deliverables that were reported as shipped and were not built,
OAI-89 is the ladder that never reached approval, OAI-87 is the gate nobody has measured, and OAI-88
is the corpus that measures it being a single case. They sort BELOW the two OAI-83 residue items
because none of them is wrong *today* — they are absences, where OAI-85 and OAI-86 are live gaps. OAI-83 shipped on 2026-08-05 and these two are
its residue: the first is a caveat missing from `/oai:result`, confirmed pre-existing rather than
introduced, and the second is the delegate's containment machinery having no test at all — proved by
mutation, and the sharper of the two because its stakes are disclosure. Both lead the tier because
they are *wrong today*, where OAI-53 and OAI-54 are Stage 1's stated gaps needing a design decision
before code, which is why they are not higher despite being small.

**Tier 5 — coverage the ladders found missing, and the ratchet that blocks it.** **OAI-28, OAI-40,
OAI-73, OAI-52, OAI-79, OAI-75, OAI-39, OAI-45**. OAI-28 leads because it now carries the ratchet
decision (see the redirect table): `tests/structure.test.js` is at **exactly 300 of 300** and cannot
accept another guard. **OAI-40 is batchable with it** — its fix lands in `bench-reliability.test.js`,
the other file OAI-28's split touches, and that file has six lines of headroom. **OAI-79 may never be
worked at all** — its own body says the three sharp edges are *deleted* by moving the delegate's
lifecycle out of agent shell, which is OAI-74 with OAI-76 in tier 2, so check whether it is still live
before opening it. OAI-75 is an unidentified intermittent whose next step is capture, not reasoning.

**Tier 6 — the measurement programme: BLOCKED ON THE INSTRUMENT, 2026-08-08.** **OAI-19, OAI-50,
OAI-49, OAI-48, OAI-9, OAI-11, OAI-13**. OAI-19 leads and gates the rest — every item behind it wants
a number to beat. It is hours of the user's own LM Studio rather than an edit, so it is launched when
they say so, never incidentally. OAI-50, OAI-49 and OAI-48 are the three instrument questions its
predeclared gate names as stated limits.
**Do not schedule an arm before OAI-115 and OAI-116 land.** Three arms ran on 2026-08-07/08 and all
three were INVALID; the MoE arm is published as a failure with both its G-G invocations spent. G-E is
unpassable while the dominant failure path records no `attempts[]`, so a fourth arm cannot pass the
gate however it performs. The arms did settle something the tier had been chasing since 2026-07-27:
**the schema causes the transport drops**, confirmed by controlled A/B, which is what OAI-20, OAI-24
and OAI-34 all failed to reach from the client side. OAI-51 traded that failure class for OAI-115's.

**Tier 7 — decisions that may close as "no", and housekeeping.** **OAI-27, OAI-29, OAI-42, OAI-43,
OAI-46, OAI-47, OAI-36, OAI-33, OAI-7**. Four of these ask "is this worth doing" rather than "do
this", and the honest answer for at least OAI-42, OAI-43 and OAI-46 may be no. They are kept because
each was rejected on judgement rather than on evidence, and the judgement is worth recording once.
OAI-33 and OAI-7 are housekeeping that costs one file each.
**Tier 8 — credential disclosure a ladder found and scoped out.** **OAI-91, OAI-92, OAI-93,
OAI-95, OAI-99, OAI-100, OAI-101, OAI-102**. The last four are OAI-94's residue and they double this
tier, which is the finding: that feature made *one* output path safe and its reviews then enumerated
four more, none of which it touched. OAI-102 leads them and is the one to do first — it is a
one-function fix, and unlike every other item here the code already knows the value is a credential at
the moment it prints it. OAI-95 is the withdrawn permission hardening and sits here rather than alongside the now-shipped OAI-94 because,
unlike OAI-94, nothing regressed when it left: the pre-existing bare `chmodSync` is still in place, so
the tree is where it was, not worse. The first three both
concern a query string in `--base-url` reaching somewhere it is not announced. They sit last because
neither is wrong for a caller who does not put a secret in a URL, and because OAI-61 deliberately
declined to half-fix them: OAI-91's warning belongs where the URL is resolved rather than where a job
is submitted, and OAI-92 needs a cooperating server to fire. They are filed rather than folded in
because widening a feature to cover every place a defect *could* also apply is how that feature stops
converging — which the ladder that found them demonstrated at length.

**Tier 9 — residue from the OAI-61 ladder, in code that SHIPPED.** **OAI-96, OAI-97, OAI-98**. These
are last because none is wrong for a working install today, and first among equals is OAI-96, which is
the only one touching code that just landed. They are recorded rather than carried into OAI-94/95
because they belong to the capability gate, not to the withdrawn mechanisms — filing them separately is
what stops the withdrawal from becoming a place unrelated findings go to be forgotten.

**Tier 10 — residue from the OAI-94 ladder, in claims that cannot fail.** **OAI-103, OAI-104**.
Both are the same class rather than the same subsystem: a statement this repo makes about itself that
nothing checks. OAI-104 is the sharper one and is nearly free — this file's own tier/heading invariant
is asserted to be enforced by a script that does not exist, so the guard that was supposed to make
drift impossible has never once run. OAI-103 is the same shape one level out: a machine-readable
payload that omits the caveats its human-readable sibling prints, so a harness reads a crowded reply
as a clean one.

**Tier 11 — residue from the OAI-62 ladder: seven places contention is answered by an argument, a
misdiagnosis, or a silence.** **OAI-106**, **OAI-105**, **OAI-109**, **OAI-110**, **OAI-107**,
**OAI-108**, **OAI-111**.
**OAI-106 leads the tier because it is the reason OAI-62 reached its ten-pass cap without approval.**
Codex refused to approve on exactly this ground: after an exhausted persistence retry the public
lifecycle still reports `worker-died` for work that completed, and no product reader can recover the
salvaged answer — a false terminal state produced by contention, which is one of the outcomes OAI-62
set out to remove. `salvageOutcome` keeps the bytes; it does not correct the verdict. Anything that
closes OAI-62 has to start here.
The rest are last because nothing is broken today: each fires only under contention that has never
been observed outside an injected test. They are here at all because ADR 020 exists to remove a
comment that claimed a property the code did not have, and each is a smaller instance of that shape —
an exclusion resting on an untested argument (OAI-105), a rescue whose own guard has no witness and
one unreachable-today hole (OAI-109), a count restated where nothing holds it to the code (OAI-110),
a stop request with no contention policy at all (OAI-107), and a fact that reaches a human on stderr
but no machine through `--json` (OAI-108). OAI-111 is housekeeping the review fan-outs generate.

<!-- /tiers -->

### Absorbed IDs — where a merged or moved number now resolves

Every ID this file has ever issued still resolves; nothing was deleted. ADRs, plans and
`BACKLOG_DONE.md` cite absorbed numbers, so this table is what keeps those references working.

| Was | Now | Why |
| --- | --- | --- |
| **OAI-30** | **OAI-28** | The same edit twice, one line apart in `http.mjs`, blocked by the same ratchet. |
| **OAI-41** | **OAI-28** | The ratchet decision that blocks OAI-28 and OAI-30; it is now their leading half. |
| **OAI-38** | **OAI-28** | Withdrawn 2026-08-04 as a duplicate on the day it was filed; never independent. |
| **OAI-71** | **OAI-59** | One added `outcome` field, one shape-drift decision, one `/oai:result` render. |

Moved out of the live list rather than absorbed: **OAI-51** and **OAI-78** to `BACKLOG_DONE.md`,
**OAI-44** to `BACKLOG_PARKED.md`. **OAI-72(c)** moved into **OAI-63** as a sub-item; OAI-72 keeps its
ID and its other two claims. **OAI-13** split: its sub-items (3) and (5) became **OAI-84** because
they stopped being vendor-dependent.

**Item count fell far faster than byte count, and the difference is not fixing.** 56 live items became
50, but almost nothing was discarded: four IDs were merged into two, three moved to other trackers,
one split out, and every dated observation, measurement and decision-with-reason came with them. Read
this file as shorter to navigate, not as shorter work.

### Standing methodology note, earned the hard way

Two claims in this file were promoted from a single run per arm, and both were wrong: "context
dilution is measured" (retracted 2026-07-28 — see below) and, one paragraph after diagnosing that
error, "two passes found different defects, so a union would score 2/2" — which compared runs from two
*different modes* and never reached this file only because it was caught first. **N=1 per arm is a
lottery ticket, not a comparison, and a pair of cases that differ in more than the variable under test
measures nothing.** Both are cheap to avoid: `--runs N` exists, and `--diff-only` gives a within-case
arm.

### The parked theme — "make `/oai:review` trustworthy before extending the plugin further"

Parked 2026-08-04 by the direction change, and kept here rather than in `BACKLOG_PARKED.md` because it
is context for Tier 6 rather than an item. Everything in it was sized to answer "is the reviewer
trustworthy" before extending the plugin — and OAI-51 then found the reviewer was crashing the model
backend with its own request, so the thing being measured was broken throughout. Stage 0 changed how
replies are produced, which invalidates any baseline taken before it.

Where the reviewer actually stands, stated plainly because it is easy to overrate: OAI-14 removed the
largest false-positive class (3-of-3 → 0-of-3 on the one commit with a baseline), and the 2026-07-30
OAI-19 attempt added two anchored true positives on a real commit diff (dense 27B on `scaffold`: two
*different* defects, one per attempt — `credential-inherited-across-origin`, then
`url-origin-strips-credentials`; neither found twice — joining the four anchored matches recorded
before it, one of which was the same case in commit mode by the old MoE quant on 2026-07-28). Those
are catches from arms that failed their acceptance gates, so recall remains without a publishable
number and the catches are **existence proofs, not a rate**.

The reviewer is useful once checking its claims costs less than its catches are worth. **OAI-15
(2026-07-28) changed how a censored run is treated, and raised the ceiling — it did not prove the
censorship gone, and the difference matters.** The `analysis` cap is now derived from the reply budget
each run is granted rather than fixed at a number the budget only coincidentally afforded, and a run it
truncates has its findings scored instead of discarded: half the corpus, **17 of 41 recorded runs**, was
being thrown away along with two of the four anchored matches ever produced. Measured 2026-07-30
(OAI-19 attempt, bounded — the arms failed their gates): `config-origin` and `structured` no longer
cut for the dense model (`structured` on the diff-only rung there — see the confound note under
OAI-19), but `scaffold` still cuts 2/3–3/3 and `model-info` 1/3, so **the ceiling still bound for the
dense model on the largest cases**. Then measured again 2026-08-04, MoE arm: **zero cut runs across
the corpus**, the first full arm on record with none. See [ADR 008](adr/008-sizing-the-review-reply.md).

**OAI-12 landed, so tuning is no longer guesswork — and it then refuted its own first headline, which
is the instrument doing its job.** `npm run bench` scores the shipped command against 11 catalogued
defects in six snapshots of this repo's history and writes a per-run record, ending the era where a
conclusion was kept and its evidence thrown away (ADR 004 says "four runs", `890ee2e` says "five",
same experiment, neither now checkable). Baseline: ~~**1 of 6 scoreable defects at N=1, 10.9
minutes**~~ — struck 2026-07-30: computed under the pre-OAI-15 rule that excluded cut runs from the
denominator, so it is not directly comparable with anything measured since. **No comparable
replacement exists yet**; producing one is OAI-19. 11 defects are catalogued, but 5 belong to the two
cases whose runs were cut mid-reasoning and are unscored rather than missed.

- ~~**Context dilution is measured.**~~ **Retracted 2026-07-28, by the instrument itself.** The
  "found at 1,575 tokens, missed at 47,072" pair varied token count, git mode, prompt shape and
  defect count together, at N=1 per arm. A three-arm run settled it: the same case at **half the
  tokens produced zero findings in three runs**, and the corpus's *smallest* input was cut 3 times
  out of 3. There is no dilution effect in this data, and the reordering it was about to justify has
  been dropped. See the correction section in [ADR 006](adr/006-benchmarking-the-reviewer.md).
- **The `analysis` cap was the binding constraint, and it was mis-sized.** **17 of 41 runs ever
  recorded here never finished looking.** The ceiling was set in OAI-10 "above every observed
  successful run" from a sample that had not yet seen a normal run reason long — it sat *inside* the
  model's ordinary reasoning distribution, truncating working reviews rather than runaways. Cutting
  does **not** track input size: the 1,575-token case reasoned for 7,367–9,440 completion tokens
  where the 47,072-token case used 3,552, and the corpus's smallest input cut 6 of 9 while a case
  barely larger cut 0 of 9. **Addressed in OAI-15, 2026-07-28** — and note what that did *not*
  settle. The reasoning distribution had no observable right edge under a cap truncating 41% of runs,
  so the new ceiling is sized from wall clock rather than from the distribution.

What the bench is *not* is a measure of true recall: the denominator counts only defects that could
be pointed at in the snapshot, which is smaller than what history claims and therefore flatters it.
See [ADR 006](adr/006-benchmarking-the-reviewer.md); the harness prints the same caveats every run.

> **Discharged 2026-07-27:** the owed built-in `/code-review high` ran over `structured.mjs`,
> `client.mjs` and `cmd-review.mjs` (`c552bcd..HEAD`), covering OAI-4 and OAI-10 in one pass —
> 25 agents, 1.07M tokens, no deaths. Ten findings: **5 confirmed and fixed**, 5 vendor-dependent
> and parked as **OAI-13**. The new-module trigger earned its keep: the two most severe (a cut
> review rendering as a clean pass; a 12k-token input-budget regression) were both in exactly the
> vendor-assumption code the trigger targets, and neither `advisor` nor the lean workflow caught
> them across four and two passes respectively.

> **Discharged 2026-08-05:** OAI-58, the owed step 6 review ladder on OAI-3, ran and closed by dual
> approval, producing the OAI-61 … OAI-73 block. Its record is in `BACKLOG_DONE.md`.

## Items

- **OAI-7** — Publish: README install instructions, and verify the marketplace path
  (`claude plugin marketplace add`) actually resolves this repo once it has a remote.

- **OAI-9** — Multi-pass review with a deduplicated union, because a single pass is a lottery.
  Measured on one 135-line file with two known defects (`config.mjs` at `8990173`, both fixed later):
  five runs of the same command produced 1 real defect, 3 false positives, 2 empty results and 1
  budget failure — a **20% hit rate per run**, with output varying 1,709→5,450 tokens for identical
  input and quality tracking that spend. Independent passes are the lever: each costs ~40–90s and
  nothing else, and unioning three or four would have caught both real defects instead of gambling on
  one. Same shape as the loop-until-dry pattern. Needs: N passes (default 3?), dedupe on
  file+line+claim, and a count of how many passes reported each finding — agreement across
  independent passes is itself a confidence signal worth showing, since it is the closest thing to a
  free verifier. Decide whether passes run concurrently (one local model, so probably not) and how
  this interacts with OAI-8's progress reporting, which it makes far more necessary.
  **The "~40–90s each" estimate is wrong for passes 2..N, and now measurably so.** Every pass after
  the first sends the same prompt, so it is a prompt-cache hit: measured on a 56,805-token request,
  first token at 421.7s cold against 11.5s warm. The marginal pass is therefore *much* cheaper than
  the first — good for the feature, and an argument for more passes rather than fewer — but it makes
  a per-pass average meaningless, and any timing quoted for "a review" must say whether it is the
  cold one. OAI-18 landed `prefillMs`/`generationMs`, so this is now visible per pass rather than
  hidden inside a total; use them when costing this.

- **OAI-11** — Diverse passes: different models, and different lenses.
  **Check the rate metric before comparing across *servers*.** OAI-17's `gen tok/s` divides
  provider-reported `completion_tokens` by a window running from the first text frame to the end of
  the stream, so a server that delays its `usage`/`[DONE]` frame inflates the divisor by however long
  it delays — unbounded, and undetectable from here. Within one server (lenses, or JIT-swapped models
  on LM Studio) the figure is sound and this does not apply. Across two providers it is only sound if
  both terminate promptly, so a cross-server pass needs that checked first or the comparison measures
  protocol behaviour rather than throughput. Raised by the OAI-17 adversarial review at 0.96
  confidence and left stated rather than fixed, because on the measured case the divisor was 81–265s
  against sub-millisecond terminators. **OAI-9 decorrelates sampling
  noise; this decorrelates blind spots**, which is the more valuable axis — repeated samples of one
  model share its failure modes, so agreement between them says much less than agreement between two
  models trained differently. That makes cross-model agreement a genuinely strong confidence signal
  where cross-sample agreement is only a weak one.
  Three ways to get diversity, cheapest first: different **lenses** on the same model (one pass for
  correctness, one for security, one for edge cases) — free, and available today with one model
  loaded; different **models on different providers**, which is exactly what ADR 001's
  providers-as-data buys us, and the case where passes can genuinely run concurrently; different
  models on **one** provider, which on LM Studio means paying a JIT load between passes and is
  probably the worst of the three.
  Build OAI-9 so a pass carries its own `{provider, model, lens}` rather than inheriting one global
  target — then this is a config change, not a rewrite. Open question worth an experiment before
  committing: whether three lenses on one model beats three plain passes, since that would deliver
  most of the value with no second model to install.

- **OAI-13** — Vendor-dependent findings that need a second server to settle. ~~**Now seven.**~~
  **Five, since the 2026-08-05 sweep split two of them out as OAI-84** — they stopped being
  vendor-dependent when OAI-51 made the prose-parse path the default. Added
  2026-07-28 from the OAI-6 built-in review: `refusedField` accepts 400/422 and pattern-matches the
  quoted error body, so a validation error that *echoes the request JSON* contains `stream` and
  `stream_options` and matches both capability rungs — two spurious retries with stderr claiming a
  cause that was never established, before the real error surfaces. Bounded (each rung fires once)
  and self-correcting, so it is filed rather than patched: tightening the prose match is exactly
  the fragile guessing items (1) and (2) below already describe, and the honest fix is the same
  one — read the server's status or error `type`/`code` field instead of its prose.
  **(7) Added 2026-08-01, moved here from OAI-22 when that item closed.** The capability negotiation
  is scoped to one `chatCompletion` call, so a review's `response_format` fallback mints a fresh
  `createNegotiation` and re-offers a capability the schema request already had refused — an
  asymmetry with the attempt ledger, which *was* deliberately threaded across both calls. Needs a
  server refusing BOTH `stream_options` and `response_format`, which nothing here has. **The OAI-22
  review added a consequence beyond the wasted round trip and the duplicate `refused` entry**: that
  needless refusal can consume what is left of `--max-seconds`, turning an answerable review into a
  client-imposed deadline failure. When it is fixed, only the capability state (`removed`) may be
  shared across the two calls — never the whole `{payload, removed, lastRung}`, whose payload is
  call-specific.
  The original five, from the OAI-4/OAI-10 built-in review, all vendor-
  dependent and none reproducible against LM Studio. They need a second server to settle, so they
  wait for one rather than being fixed blind. (1) `isFormatRejection` reads `error.message`, which
  `client.mjs` truncates to 400 characters — a server whose validation dump names `response_format`
  later never triggers the degrade path, and `/oai:review` dies on a raw 400 instead. (2) The same
  matcher fires on *any* 400 whose body echoes the request, asserting "rejected response_format"
  as a cause it only guessed. ~~(3)~~ **and** ~~(5)~~ **left this item on 2026-08-05 — see the split
  note below.** (4) With the window unknown, `reserveFor` still puts `max_tokens: 16384` on the
  wire, where `/oai:task` sends none — a server that rejects an oversized `max_tokens` fails for a
  reason the plugin chose. Fixing (1) and (2) properly probably means the server's status
  or error `type`/`code` field rather than prose, which is an ADR 002 shape-not-name question and
  the reason this is one item rather than five.

  **Split 2026-08-05 by the backlog sweep, and the reason is that OAI-51 changed what these are.**
  Verified against disk: with no schema sent by default (`review-request.mjs:206`), sub-items (1), (2)
  and (7) are now reachable **only when `--structured-output` is passed** — a genuinely narrower
  trigger than when they were filed, and one more reason they wait for a second server. But (3) and
  (5) went the other way. The default prose-parse path runs the *same* `parseFindings`, so they stopped
  being vendor questions about a degraded path and became defects on the shipped default. They are now
  **OAI-84**, and they sort five tiers higher. Sub-item (4)'s reach is unchanged.
  *(Numbering note, since the count above just changed: the seven were (1)–(5), the unnumbered
  `refusedField` finding added 2026-07-28 in the paragraph at the top of this item, and (7). Five
  remain here.)*

- **OAI-19** — Re-measure the baseline on the full corpus, dense 27B against the MoE, before any
  arm is read as an improvement. **This is a measurement, not a feature. OAI-20/OAI-21 unblocked it
  (2026-07-31); the three items above it are its prerequisites, not competitors, and every item
  below it wants a number to beat.** It is also the one item here that is hours of wall clock on the
  user's own LM Studio rather than an edit, so it is launched when they say so, never incidentally.
  Run it with `--warm-up` and `--max-attempts 3`, and take a `--max-attempts 1` control arm on at
  least one case so the record shows what retry was worth rather than only the retried rate. The recorded baseline — **1 of 6 scoreable defects,
  10.9 minutes, N=1** — was computed under the pre-OAI-15 rule that *excluded* cut runs from the
  denominator, and 17 of 41 runs recorded at the time were cut. OAI-15 now counts them and reports
  the unresolved part as a band, so that figure cannot be differenced against anything measured
  since: an OAI-9 union scoring "2 of 6" against it would be comparing two denominators, which is
  the N=1-per-arm error in the methodology note above wearing a different hat.
  Two things changed at once and must be separated, which is the whole design of the run: the
  **scoring rule** (OAI-15) and the **model** (the local server moved from the MoE
  `qwen3.6-35b-a3b-ud-mlx` to the dense `qwen/qwen3.6-27b`). Measuring only the dense arm would
  leave every prior number unusable and attribute the OAI-15 rule change to the model swap. So:
  both models, full corpus, `--runs 3` — N=1 is a lottery ticket, established twice in this file at
  the cost of two retracted claims — and one arm per model with nothing else varying.
  **The JIT-TTL question moved OUT of this run, 2026-08-03.** OAI-20 deferred it here and OAI-24
  found it could not be answered by a sweep at all: sampling residency around a run cannot tell
  "loaded throughout" from "unloaded then silently reloaded". It became **OAI-34**, an intervention
  run *before* this one, and **that run happened on 2026-08-04 and came back negative**: the
  deterministic form is refuted — 336s of prefill under a 120s TTL, 3/3, continuously resident, all
  four validity checks clean. This run may quote only what
  [ADR 013](adr/013-observing-the-server.md)'s outcome table permits, which after the 2026-08-04
  amendment has no confirming row at all. **So the branch this item used to reason forward from is
  closed, and closed in the direction that removes a conclusion rather than supplying one.** The old
  text said "if the mechanism is confirmed, `--warm-up` and pacing matter more than retry does" —
  nothing here confirms it, and nothing can, so **the write-up must report the cause of the drops as
  unresolved**. Refuting one hypothesis is not explaining the observation. Three limits belong
  beside the refutation whenever it is quoted: dense 27B only where the 27/72 drops were seen on
  **both** models, one case at one TTL, and N=3 with a ~63% one-sided upper bound on the failure
  rate. The attempt record still carries what a pacing effect would show (`promptChars`,
  `waitedMs`, per-attempt timings) and OAI-24's reader still splits failures on whether a prefill
  was measured — those stay useful for describing the drops, not for naming them.
  Two corrections that item produced and this one must not repeat: the **"10-minute idle TTL" has no
  provenance** here (LM Studio documents a resetting timer with a 60-minute JIT default), and every
  measured dense prefill — `scaffold` 335s, `model-info` 286s, `structured` 191s — sits *below* even
  the 600s the hypothesis assumed. **Whether OAI-15's wall-clock ceiling still binds** (answered in bounded form by the 2026-07-30 attempt — see below), and OAI-18's
  `prefillMs`/`generationMs` per case, which OAI-9 needs in order to cost a warm pass honestly.
  The OAI-11 termination caveat does not apply on one LM Studio, but cross-model `gen tok/s` is
  still only approximate — token counting need not be identical across models; wall-clock
  generation time is the directly comparable figure.
  Expect a JIT model load between arms. **With `--warm-up`, which this item mandates, the first case
  no longer carries it** — the warm-up absorbs the weights load, and `--cold` handles the separate
  question of prompt-cache uniformity. (Before OAI-21 that load landed on case 1 as a cold prefill
  that was not the model's; OAI-9's 421.7s-cold against 11.5s-warm on one 56,805-token request says
  how large the distortion would be if the flag were omitted.)
  Done when both arms are recorded with their bands, the pre-OAI-15 figure is struck through in this
  file, and the comparable one replaces it as the number OAI-9 and OAI-11 are scored against.

  ### Acceptance gate, predeclared 2026-08-04 and committed before the first arm

  The 2026-07-30 attempt is publishable *as a failure* only because its gate was written down before
  it ran. This one is written down for the same reason, and it is deliberately not the July gate:
  that one required zero failed runs across 18, which — at the measured ~37.5% per-attempt drop and
  a 3-attempt retry — an arm clears only about a third of the time **even when retry is working
  exactly as designed**. A gate that is likely to fail on a healthy instrument is not strictness, it
  is the July error in a new place. Grilled adversarially with Codex over two rounds; every
  criterion below that survived is one of us failing to break it.

  **The estimand, named before the number exists.** The published figure is recall of the
  **retry-enabled CLI** over the fixed 11-defect corpus, with unresolved opportunities reported as a
  band. It is *not* the model's one-request behaviour: `--max-attempts 3` is part of the instrument,
  and because a drop may correlate with reply length, a successful retry is not guaranteed to be an
  unbiased sample of what a single request would have produced. The ledger *describes* retry; it
  does not prove independence.

  Per arm, each arm judged independently:

  - **G-A — zero substituted runs.** Any substitution voids the arm; a mislabelled number is not an
    uncertain one, and no amount of sampling fixes a wrong label. **Stated limit, not gated:**
    substitution is checked at *run* level only. `applyFrame` records a served model id as frames
    arrive (`completion.mjs:65`), but a stream that dies unterminated throws `stream-unfinished`
    (`completion.mjs:98`), the ledger entry keeps no served identity (`attempt-ledger.mjs:56`), and
    `answerWithRetry` retries it — so a superseded attempt that observed a *different* model leaves
    no record. It is not checkable today. It is also not reachable here for the ordinary cause:
    substitution happens when the requested id is absent, and both ids are served by this machine.
    Instrumenting it is **OAI-48**.
  - **G-B — replication floor: every case, all six, contributes ≥2 scored runs of 3.** No case may be
    dropped from the headline. An earlier draft let cases fall out with the exclusion merely
    *named*; Codex killed it, correctly — `scaffold` and `structured` could both drop while the arm
    "passed", leaving a headline over 5 of 11 defects. Naming an exclusion does not repair the
    estimand, it documents that a different benchmark was measured. `docs-only` is gated too, despite
    holding no defects: it is the only negative control, so without it there is no false-positive
    evidence at all.
  - **G-C — unresolved-from-unscored ≤3 of 33.** Every unscored run (failed, truncated, unreadable)
    contributes its case's scoreable defects as **unresolved** — lower bound 0 found, upper bound all
    found — exactly as a cut run does, rather than shrinking the denominator. The corpus offers 33
    defect-run opportunities (11 × 3). The ceiling is chosen as the largest value that keeps
    missing-run uncertainty well below the cut-derived uncertainty already expected, so a missing run
    is never the dominant term.
  - **G-D — cut runs are not gated.** OAI-15 decided a cut run is scored with its silence reported as
    a band; capping the cut-derived band would re-litigate that by the back door, and is unachievable
    by construction for the dense arm (July: `scaffold` cut 2–3 of 3, `model-info` 1 of 3 → ≥8 of 33
    from cuts alone). The two bands are gated separately. **The *published* interval sums both** —
    only the thresholds stay apart, or the reported bound would undercover.
  - **G-E — ledger completeness.** A missing or self-inconsistent `attempts[]` on any run invalidates
    the invocation.
  - **G-F — sole tenancy and artifact identity.** Nothing else connected; `lms ps` recorded before
    *and* after each arm; harness SHA and tree-clean state, corpus state, LM Studio version and both
    model ids recorded by hand (OAI-47 is not landed). **Stated limit:** pre/post residency does not
    witness a reload *during* an arm.
  - **G-L — instrument uniformity: every scored run must carry `contextChecked: true`.** Found while
    writing this gate, in the July records: **every** off-pattern `analysisCap` there is exactly a
    run whose window probe failed and whose reply budget silently fell back to 44,405 instead of the
    window-derived figure — `config-origin` dense scored 44,405 beside 74,000, `caps` MoE 44,405
    beside 74,000, `scaffold` MoE 44,405 beside 65,499 — and those runs cluster immediately after a
    failed run. The fallback is not uniformly smaller (dense `scaffold` derives 30,683, below it), so
    it is not a conservative default; it is **a different instrument**, and July scored it as if it
    were the same one. Such a run is not scored and counts as unscored under G-C.

  **G-G — the stopping rule is mechanical, because otherwise it is optional stopping.** The *first*
  invocation of an arm satisfying G-A…G-L is the published arm **automatically, whatever recall it
  shows**. A second invocation happens if and only if the first fails the gate; the second is final,
  and if it fails too the arm is published as a failure, as 2026-07-30 was. No passing invocation is
  ever re-run, and no arm is a merge of two. Every invocation is reported — including the
  2026-08-04 smoke run (`--case docs-only --runs 1`, MoE, record `2026-08-04T19-53-16-806Z`) and any
  aborted one.

  **G-M — utility is separate from validity.** A valid arm whose full band (cut + unscored) leaves
  more than **11 of 33** opportunities unresolved is a *valid bounded observation* and a **failed
  baseline objective**: it is reported, it does **not** trigger another invocation, and it licenses
  no downstream A/B. Above a third unresolved, even the majority reading of the corpus is unresolved.
  This threshold sits only just above July's worst dense pattern, which is the honest position —
  this arm may well pass validity and fail utility, and that outcome is itself the finding that the
  OAI-15 ceiling must rise before a scalar baseline exists.

  **The cross-arm comparison is between DEPLOYED SYSTEMS, and the clean decomposition is reported as
  NOT OBTAINED.** This is the second thing Codex found and it is larger than the `structured`
  confound already on file. The reply budget is derived from each model's served window, so the arms
  do not run the same instrument on the same case — measured 2026-07-30, `model-info` capped at
  **47,724 dense against 74,000 MoE**, `scaffold` at **30,683 against 65,499**, while `structured`
  differs in *input* rung as well (dense `hunksOnly: true`, MoE `false`). **No case in this corpus is
  a clean model-only comparison**, so predeclaring a "common support" of 8 defects would have been
  false precision. What is published is "the shipped `/oai:review` with model A versus with model B,
  each as deployed, including its window-derived reply budget". The model-versus-scoring-rule
  decomposition this item originally wanted is **reported as not obtained**; a matched-budget arm is
  **OAI-49**. Per-run `analysisCap`, `hunksOnly` and `estimatedTokens` are transcribed for every case
  in both arms so the mismatch is data rather than prose. If one arm passes and the other fails, the
  passing arm's **absolute** figure stands alone; no comparison is published.

  **The control arm is a weak diagnostic and is labelled one.** `--max-attempts 1`, `scaffold`,
  both models, `--runs 3`, run *after* both main arms. At most 3 failure observations per model,
  temporally confounded by running last, and one case wide. It **cannot** establish retry's value or
  its independence; the primary retry evidence is the main arms' `attempts[]` ledger. It carries no
  gate — it is reported whatever it shows, and nothing from it may be quoted as a rate.

  ### Run log, 2026-08-04 — every invocation, as G-G requires

  Transcribed here as each invocation lands, because `bench/results/` is gitignored and this repo has
  already lost one experiment to keeping only its conclusion. Harness `7735635`, tree clean, LM Studio
  CLI `71bd99c`, sole tenant throughout; `lms ps` recorded before and after each arm in
  `bench/results/2026-08-04-oai19-arm-{moe,dense}-state.log`.

  **Invocation 0 — smoke, `--case docs-only --runs 1`, MoE.** Record `2026-08-04T19-53-16-806Z`.
  Not an arm; run to validate the flag shape before spending hours. Warm-up fired and paid the JIT
  load (12.5s), `docs-only` scored 1/1 with 0 unmatched, both artefacts written.

  **Invocation 1 — arm 1, MoE `qwen/qwen3.6-35b-a3b`, full corpus, N=3.** Record
  `2026-08-04T20-49-22-529Z`, 40 minutes. **INVALID** under the gate: `scaffold` scored **0 of 3**
  (G-B), and unresolved-from-unscored reached **10 of 33** against a ceiling of 3 (G-C). G-A, G-E and
  G-L all passed. It *met* the utility threshold — full band 10 of 33, 30.3 points — which is G-M
  and G-D doing exactly what they were separated for: a **valid** arm with this band would have been
  publishable, and this one is not, for reasons that have nothing to do with the band.

  Three results stand regardless of the arm's invalidity, because they are properties of the physical
  attempt record rather than of the recall table:

  - **The drop rate replicates.** 31 physical attempts, 17 failed. At the run level, 7 of 18 runs
    would have failed without retry — **38.9%**, against July's **27 of 72 = 37.5%** on the same
    denominator. Two independent sessions five days apart agree to about a point.
  - **Retry is worth ~17 points, and nothing at all where it is needed most.** 11 runs answered on
    attempt 1, **3 were rescued by a retry**, 4 were lost despite three attempts: 61.1% → 77.8%
    complete. But `scaffold` went **0 answered, 0 rescued, 3 lost** — 9 attempts, 9 failures. So
    retry rescues where failures are independent and buys nothing where the failure is deterministic
    for that request, which is a sharper answer than any single recovery rate. **This supersedes
    "whether retry recovers the 37.5%" as the question's answer: partially, and not on the case that
    matters most.**
  - **The two failure shapes split cleanly on whether generation had started.** All **13**
    `empty-completion` attempts died before first model text; all **4** `stream-unfinished` attempts
    died after it. The reason code and the prefill-measured split agree 1:1, which is the first
    direct evidence that these are two mechanisms rather than one reported two ways.

  And one about the instrument: **the MoE arm was not censored anywhere.** Zero cut runs across the
  corpus — the first full arm on record with none — with `analysisCap` at 74,000 for five cases.
  `structured` ran at a cap of **14,407** and still was not cut. Every run carried
  `contextChecked: true`, so G-L demoted nothing. Set beside the dense model's July caps (`scaffold`
  30,683, `model-info` 47,724) this is the OAI-49 budget gap measured from the other side.

  **Invocation 2 — arm 1 re-run, MoE, full corpus, N=3. ABORTED after ~5 minutes, deliberately.**
  Not a gate failure and not a result: the run was killed once the server log identified the cause of
  the failures it was about to re-measure. It had already produced one crash during `caps`. Reported
  here because G-G requires every invocation to be reported, aborted ones included.

  ### Run log, 2026-08-07/08 — every invocation, as G-G requires

  Harness `93c2063`, tree clean (`a053318` landed mid-arm and touches HANDOVER.md only — no harness,
  case or corpus file, so the instrument is byte-identical). LM Studio CLI `71bd99c`, sole tenant
  throughout; `lms ps` before and after every arm in
  `bench/results/2026-08-07-oai19-arm-*-state-{BEFORE,AFTER}.log`. Model ids recorded by hand:
  `qwen/qwen3.6-27b`, `qwen/qwen3.6-35b-a3b`.

  **The G-G counter was reset for this run, and the reading was recorded before any number existed.**
  The 2026-08-04 invocations ran against the crashing instrument — before OAI-51 removed the schema by
  default and before OAI-84 repaired the parser. This file already says such records are reliability
  evidence and not recall evidence; what cannot be differenced against a new arm cannot consume a new
  arm's attempts. Stated in advance because deciding it afterwards is the optional stopping G-G exists
  to prevent. **It turned out not to matter**: the MoE arm failed both invocations, so it publishes as
  a failure under either reading.

  **Parser boundary.** These arms measure the reply parser as of OAI-84. OAI-112, OAI-113 and OAI-114
  will change it again; no later arm may be differenced across that boundary without saying so.

  **Invocation A — MoE, full corpus, N=3.** Record `2026-08-07T17-55-12-678Z`, ~55 min. **INVALID**:
  G-B (five of six cases below the floor — `caps` 0/3, `config-origin` 1/3, `model-info` 1/3,
  `scaffold` 0/3, `structured` 0/3), G-C (13 of 18 unscored), G-E (the 10 failed runs carry
  `attempts: null`). G-L passed on all 8 completed runs.

  **Invocation B — MoE, identical configuration.** Record `2026-08-07T19-29-44-696Z`, ~95 min.
  **INVALID**: G-B (`caps` 0/3, `model-info` 1/3, `scaffold` 1/3, `structured` 0/3), G-C (9 of 18
  unscored), G-E (9 null ledgers). **Both invocations spent, so the MoE arm is PUBLISHED AS A
  FAILURE**, as 2026-07-30 was.

  **Invocation C — DENSE, full corpus, N=3.** Record `2026-08-08T00-01-31-181Z`, ~3h20m. **INVALID**:
  G-B (`scaffold` 0/3) and G-E (3 null ledgers) — but every other case scored 3/3, `structured`
  included. No second invocation was run; see the blocking defect below.

  **The failure mechanism is this run's real deliverable, and it is NOT the one the OAI-20/24/34 line
  was chasing.** Across all three arms there were **zero transport failures in 32 physical attempts**,
  against 37.5% (2026-07-30) and 38.9% (2026-08-04). Every lost run died the same way: the model
  reasoned until the token budget was exhausted and never emitted findings. Matching measured peak
  reasoning against the `max_tokens` in the LM Studio server log — four cases, four budgets spanning
  4.5x, reasoning stopping at 86–94% of each:

  | case | peak reasoning | ~tokens | max_tokens | % of budget |
  |---|---|---|---|---|
  | `structured` | 27,305 chars | 6,826 | 7,331 | 93% |
  | `scaffold` | 76,700 chars | 19,175 | 22,358 | 86% |
  | `model-info` | 98,890 chars | 24,722 | 27,371 | 90% |
  | `caps` | 122,885 chars | 30,721 | 32,768 | 94% |

  The model does not reason a fixed amount and overflow — it reasons until the budget is gone, whatever
  the budget is. **`max_tokens` is one pool shared by reasoning and the answer.** Two independent
  terms: prompt size sets the budget, model verbosity sets the demand. `scaffold` has the largest
  prompt so it starves on both models; everything else starves only on the MoE, which reasons about
  twice as much per case. The dense arm has the *smaller* window (61,696 vs 71,936) and still failed
  far less, which is what rules out an instrument-only explanation.

  Note `structured` scored 0/3 on the MoE and 3/3 on dense **for a budget reason, not a quality one**:
  dense sent it down ADR 005's diff-only rung (prompt 28,816, `hunksOnly: true`) while the MoE received
  whole files. The gate predeclared exactly this confound.

  ### Diagnostics, 2026-08-07/08 — not arms, carry no gate, never quotable as recall

  - **T3 — no reasoning control exists. NEGATIVE.** `reasoning_effort`, `chat_template_kwargs.enable_thinking`
    and `reasoning.max_tokens` are all accepted without error and all silently ignored. A single probe
    of each *looked* like `reasoning.max_tokens` worked; the three-run control refuted it (control
    OK/OK/OK, parameter OK/''/OK). The failure class cannot be fixed by asking the server to think less.
  - **T1 — a bigger budget is not the fix. PREDICTION REFUTED.** MoE `structured` with `--diff-only`
    raised the budget 4.5x (7,331 → 32,768) and moved the case only from 0/3 to 1/3. The MoE expands
    to fill whatever it is given, up to the 32,768 cap.
  - **T2 — THE SCHEMA CAUSES THE TRANSPORT DROPS. CONFIRMED, by a controlled A/B.** Same target
    (`--base 4f6975a`, ~112,700 prompt chars), same model, minutes apart: **control (no schema) 3/3
    completed on one attempt each, zero failures; `--structured-output` produced `empty-completion`
    errors on 2 of 3 runs after three attempts each, and the survivor also needed three** — roughly 7
    of 9 attempts failing against 0 of 3. `empty-completion` is precisely the 2026-07-30/08-04
    signature. **This is the direct causal evidence OAI-51 asserted from the server log and that
    OAI-20, OAI-24 and OAI-34 spent weeks failing to reach from the client side**, OAI-34's
    intervention run included. It also explains the zero transport failures in all three arms today.
    A first attempt at T2 was **discarded as inconclusive** and is reported here: its target let the
    control succeed, and a test whose control does not fail cannot show the schema fixing anything.
  - **Not established:** whether the schema fixes token exhaustion. The control never starved on the
    T2 target, and `bench` cannot pass `--structured-output`, so the case that reliably starves could
    not be tested under a schema. Open.

  **The conclusion that matters: OAI-51 traded one failure class for another.** With a schema,
  grammar-driven `empty-completion` transport drops. Without one, reasoning consumes the whole shared
  budget and no findings are emitted. Both are now identified; neither is fixed.

  **THIS ITEM IS BLOCKED ON INSTRUMENT DEFECTS, not on measurement effort.** The token-exhaustion error
  path emits no `attempts[]` at all, so **G-E is structurally unpassable** for any arm containing one
  such failure — and that is now the dominant failure mode. Verified against 2026-08-04, where all 4
  failed runs *did* carry ledgers, so this is specific to the new path rather than general. No further
  arm should be run until **OAI-115** and **OAI-116** land; a dense second invocation was deliberately
  not run for this reason, and because `scaffold` fails deterministically (41,251 / 42,064 / 41,404
  chars, a ±1% spread). The `--max-attempts 1` control arm is deferred with it.


  ~~**The measurement is SUSPENDED, and the reason is OAI-51: the drops are our own bug.**~~
  **Suspension DISCHARGED 2026-08-05 by the backlog sweep — OAI-51 is resolved and in
  `BACKLOG_DONE.md`, verified against disk rather than off its commit messages.** The suspension was
  right and the record of why it existed stands: the whole OAI-19/OAI-20/OAI-24/OAI-34 line of
  investigation inferred server behaviour from the client side while LM Studio was writing a server
  log the entire time, and that log names the cause outright as this plugin's own review schema.
  Resuming before the fix would have produced a baseline contaminated by a defect we could remove.
  **That defect is removed, so this run is launchable.** The gate below stands unchanged and was never
  re-opened by any of this: nothing in it was wrong, it simply gated a run whose premise had moved.
  **Two things the discharge does not license.** First, every arm run before 2026-08-04 was run against
  the crashing instrument, so the 2026-07-30 and 2026-08-04 records are reliability evidence and not
  recall evidence, and nothing from them may be differenced against a new arm. Second, **OAI-84 is a
  live change to the reply parser** — two ways the default path discards an answer — so measuring
  before it lands measures a parser that is about to change. That is the same argument OAI-51 made for
  the suspension, one layer down, and it is the reason OAI-84 sorts ahead of this item.

  **Attempted 2026-07-30 — blocked on OAI-20, and the attempt is the evidence behind it.** Both arms
  ran twice (a predeclared one-retry-per-arm rule, every invocation reported); neither ever passed
  its acceptance gate (every case `scored=3`, no failed/truncated/unreadable/substituted runs), so
  under the plan's own terms **nothing here is published as the measurement** — the failure rates
  moved to OAI-20 are the deliverable this attempt actually produced. What the scored runs showed,
  stated as bounded observations, not the baseline: (a) the dense 27B anchored two `scaffold`
  defects on a real commit diff — *different* ones, one per attempt
  (`credential-inherited-across-origin`, then `url-origin-strips-credentials`), each hit in one
  scored run of three and neither recurring in the other attempt — two independent catches, not
  one catch replicated, and **not the benchmark's first**: four anchored matches predate them,
  including the same defect on the same case in commit mode by the old MoE quant
  (`bench/results/2026-07-28T07-57-15-522Z.json`);
  (b) the OAI-15 ceiling **still binds for the dense model on the largest cases** — `scaffold` cut
  2/3 then 3/3, `model-info` 1/3 in each — while `structured`, historically 4/4 cut, was never cut
  in any dense scored run, **but that last observation is confounded**: the dense model's smaller
  served window (61,696 vs the MoE's 71,936 — the MoE figure read live off `lms ps`, not present
  in any bench record; provenance in ADR 008) sent `structured` down ADR 005's diff-only rung
  (`hunksOnly: true`, ~28.6k prompt tokens) where the MoE received whole files (~59.7k), so "never
  cut" there may only mean "much smaller input", and the two arms did not review the same
  `structured` request; (c) the MoE generates ~4× faster (~50–78 vs 13–17 tok/s, prefill ~5×
  faster, a full arm in ~25 min vs ~3 h) and produced one **range** match on `scaffold`
  (`anchored=0` — a looser standard than the dense arm's anchored catches), finding nothing else;
  (d) the MoE arm ran as `qwen/qwen3.6-35b-a3b` — the `-ud-mlx` quant
  the old baseline used is no longer served, so even a clean future arm is a different quant, which
  the record must footnote. The MoE arm was launched with arm 1 already incomplete (a deliberate
  decision, to test whether the failures were model-specific; they are not). Raw records
  `bench/results/2026-07-30T*.json` with rendered reports beside them as
  `2026-07-30-oai19-arm-{dense,moe}.log` (gitignored; the quotable summary is in ADR 006).

- **OAI-27** — Run `/security-review` over the transport-classification path. Filed 2026-08-01 from
  the OAI-22 ladder, where it was **evaluated and not triggered, and that call is disputed**. The
  skill's trigger list is auth/sessions, personal data, money movement, secrets and credentials, or
  anything irreversible — OAI-22 touches none of them, so it was skipped and the specific concern
  raised (`transportError` now branches on a `cause.code` that arrives from a remote peer, and a TLS
  rejection such as `CERT_HAS_EXPIRED` becomes `non-retryable-transport` with `cause.message`
  interpolated into a `UserError`) was closed by an explicit assertion instead: the code is preserved
  and the message still names the certificate.
  **Re-verified 2026-08-05 by the sweep, and it narrows what remains.** Both halves of the premise
  still hold on disk (`http-errors.mjs:135`, `:124`), and the closing assertion is real and passing —
  `tests/bench-reason-notes.test.js:171-172` asserts the rendered text matches `/certificate has
  expired/` and does **not** match `/CERT_HAS_EXPIRED/`. `describeFailure` (`provider.mjs:70`) returns
  the wrapped error untouched for this code, so `reword` never runs and the message passes through
  intact. So what is open is **not** whether the concern was handled — it was — but whether the skill's
  trigger list should have fired at all. That is a process disagreement, and reading code cannot settle
  it; only running the pass can. The `advisor` argued that is a security lens being
  recorded as "not triggered" when it does trigger. Cheap to settle, so settle it rather than leave
  the disagreement in a commit message: one fan-out over `http-errors.mjs`, `http.mjs`,
  `provider.mjs`. If it finds nothing, the trigger list stands as written and this closes as a
  recorded judgement rather than an open question.

- **OAI-28** — **Make room in the two test files that are full, then give `http.mjs`'s two untested
  transport writes the coverage they have never had.** **Merged 2026-08-05 by the backlog sweep from
  OAI-28, OAI-30 and OAI-41** — one feature run ships all of it, because the ratchet blocks both edits
  and both edits land one line apart in the same file. **The ratchet is the leading half**: it is the
  only part that is wrong *today*, and neither of the others can start until it is done.

  **(A) The ratchet, formerly OAI-41. Filed 2026-08-04; re-measured 2026-08-05 and unchanged.**
  `tests/structure.test.js` is at **exactly 300 lines** against a `DEFAULT_MAX_LINES = 300` ceiling
  compared with `>` (`tests/structure.test.js:12,55`) — **zero headroom** — and
  `tests/bench-reliability.test.js` is at **294**, six lines. (`split('\n').length`, the way the
  ratchet counts; one more than `wc -l`.) OAI-35 put ~140 of those lines there.
  **The ratchet is being eaten, not merely full, and the dates say so:** OAI-30 recorded
  `structure.test.js` at **299 of 300 on 2026-08-01** and warned whoever picked it up to make room
  first; it was at **300 on 2026-08-04** and is at 300 today. One line consumed in three days, and the
  file has been at the ceiling ever since.
  This is the size-growth rule working as designed — the ceiling is meant to force a split rather than
  be raised — but it is now due, and due *before* the next person needs it: `structure.test.js` is the
  file whose whole job is holding structural guards and it cannot accept another one.
  The seams are visible. `bench-reliability.test.js` mixes attempt ACCOUNTING (which bucket, which
  denominator) with report RENDERING (what the markdown says) — the same split
  `bench-reason-notes.test.js` was carved off along in OAI-31, so the precedent and the naming already
  exist. `structure.test.js` mixes the size ratchet with the other structural guards it has
  accumulated.
  **Do NOT solve this with an `ALLOWLIST` entry.** `tests/structure.test.js:70` (`if (ALLOWLIST[rel])
  continue;`) makes an allowlisted file skip the 60-line per-function budget too, so buying headroom
  silently drops a second guard — the trap OAI-35 avoided by splitting `reason-notes.mjs` out instead.
  Raising the ceiling is the one option that needs a stated reason, per the ratchet's own rule.

  **(B) The `!response.complete` branch, the original OAI-28. Filed 2026-08-01.** That branch — a
  socket cut mid-body ending the iteration with **no** `'error'` event — is the most retryable shape
  in the codebase, had **no test at all** before OAI-22, and OAI-22 *modified* it (the bare
  `'transport'` literal became the `TRANSPORT` constant).
  It is still untested behaviourally, and not for want of trying: measured on Node 26.3, both ways of
  cutting a body (a short `content-length`, and chunked with no terminator) raise on the stream
  instead, so the catch one line below handles them and this branch is never entered. The test added
  in OAI-22 asserts the *verdict* both paths must share, which is honest but does not reach here —
  proved by mutation: flipping this branch's constant left the suite green. Options: find a cut that
  Node reports as a clean end (an HTTP/1.0 connection-close body with a truncated payload is the
  likeliest candidate), drive `bodyStream` directly, or conclude the branch is unreachable on current
  Node and say so in a comment rather than leaving a silent hole. The constant swap already removes
  the divergence risk that motivated touching it, so this is coverage, not correctness.
  **Enlarged 2026-08-04 by OAI-35, which added a second untested write to the same branch and
  re-proved the first.** That branch now sets `serverResponded = true` as well as the reason
  (`scripts/lib/http.mjs:106-107`), and deleting *that* line also leaves the whole suite green — so the
  hole is two lines wide, and the half OAI-35 added is the half its own record depends on. OAI-35's
  `tests/attempt-response-sites.test.js:140-145` names this branch as uncovered rather than implying
  coverage, and an earlier draft of that file was wrongly credited with reaching it; a debug stack
  showed the request leaving through the catch below, exactly as this item recorded on 2026-08-01.
  **So whichever option is taken here, take it for both writes** — a fixture that reaches the branch
  should assert the reason *and* the flag, and a comment concluding unreachability must say so about
  both.
  *Re-verified 2026-08-05 by the sweep: the nearest fixture is
  `tests/transport-classification.test.js:128-161`, whose own comment says it asserts "the verdict
  rather than the path" — so it is adjacent evidence, not coverage.*

  **(C) The last "cannot be tested" justification, formerly OAI-30. Filed 2026-08-01** from the OAI-25
  ladder (Codex adversarial, low/0.97, pass 3 — the no-mutation pass, so recorded rather than fixed; a
  fix there would have shipped unreviewed). The guard is OAI-22's, it is correct, and nothing about
  `delivered: true` is in doubt. What overclaims is its doc comment at `tests/structure.test.js:279`
  and `:287`: "nothing behavioural can pin it" and "A test cannot make Node drop the code on demand"
  (both quoted verbatim from disk, 2026-08-05). The evidence behind those sentences is narrower than
  they are — it establishes that on Node 26.3 a real mid-body cut *happened* to carry `ECONNRESET`,
  not that no test can exercise the code-less path. **The fix is known and cheap**: drive `bodyStream`
  directly with a stub async iterable that throws a code-less error, and assert the verdict stays
  retryable — which is (B)'s "drive `bodyStream` directly" option applied one line lower. Distinct
  from (B): that is the `!response.complete` branch, this is the catch below it. Third confirmed
  instance of the class recorded in `.claude/REPO_TRAPS.md`; the other two were OAI-25's subject and
  OAI-25's own first draft.
  **Note the ordering trap this half creates**: the honest replacement comment is *longer* than what it
  replaces, in the file with zero headroom. (A) first, always. OAI-25's comment rewrites there were
  net-neutral by construction for exactly this reason.

  **(D) OAI-38 resolves here. Withdrawn 2026-08-04, the same day it was filed, as a duplicate of (B)**
  — which had covered it since 2026-08-01, and covered it better: (B) records that **both** obvious
  fixtures were measured on Node 26.3 and **both** raise on the stream instead, and names an HTTP/1.0
  connection-close body as the likeliest remaining candidate. OAI-38 rediscovered the first half of
  that and proposed the two fixtures already ruled out. Its ID is kept resolvable because
  `plans/oai-35-server-responded.md:221` cites it in commit `a2395f6`, and a dangling reference is
  worse than a redirect.
  Worth stating why it happened, since the backlog is the thing that was supposed to prevent it: the
  finding arrived from a reviewer, was verified against the code, and was filed without first being
  searched for in `BACKLOG.md`. **Verifying a finding is not the same as checking whether it is
  already tracked.**

  **Batchable, not merged: OAI-40.** Its two fixes land in `bench-reliability.test.js`, the same file
  (A) splits, and that file has the six lines of headroom (A) measured. It closes independently, so it
  keeps its own ID — but do it in the same sitting or (A) will be paid for twice.
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

- **OAI-42** — Consider renaming `serverResponded` to say what it means. **Lowest priority, and it
  may well close as "no".** Filed 2026-08-04 because three independent reviewers across two OAI-35
  passes raised it unprompted: the name invites *the server responded to me* — a claim about a peer —
  where the field means only *an HTTP response was obtained*, and a proxy or gateway can produce one
  with the model server never seeing the request.
  The evidence for: this repo has now spent a great deal of prose defending that distinction — in ADR
  012, ADR 013, `CLAUDE.md`, `REPO_TRAPS.md`, two test files and the ledger's own minting comment —
  and a reader who trusts the name reaches the wrong conclusion without ever hitting one of them. The
  original backlog item for OAI-35 made exactly that error in its own text.
  The evidence against, which is why this is filed rather than done: the name **predates** OAI-35 —
  ~~`http.mjs` and `cmd-setup.mjs` were reading it~~ **corrected 2026-08-05 by the sweep: `http.mjs:107`
  and `http-errors.mjs:142` *mint* the field and `cmd-setup.mjs:32` is the only site that *reads* it** —
  before the ledger ever carried it, so a rename
  touches the transport, not just the record; and the documentation now carries the load correctly,
  so this buys clarity rather than fixing a defect. If it is done, `httpResponseObtained` was the
  suggested name and every recorded benchmark file under `bench/results/` carries the old key, so it
  needs the same read-both-shapes treatment the `not recorded` bucket already gives legacy records.

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

- **OAI-45** — Close the two holes in OAI-34's end-to-end matrix. **Small, and filed because the
  matrix reads complete and is not.** OAI-34's own rule is "every verdict-bearing check gets a
  scenario crossing the real entry point", with one *stated* exemption (G8, structurally impossible to
  produce from a fake server). Measured after it shipped, there are two unstated ones:
  **(1)** `no-exposure` is the only episode verdict of the seven with no e2e scenario — every harness
  scenario uses a 500ms reply against a 300ms bar, so nothing ever produces a request that fails to
  clear the margin. It is the verdict that catches a wasted episode, so a break in it would show up
  as the sweep silently banking runs that tested nothing. A scenario needs only a reply delay below
  the bar.
  **(2)** `tests/ttl-stub-lms.mjs` documents five scenario knobs; **three are used by no test** —
  `unreadableFromMs`, `lastUsedAdvances`, `failLoad`. Unused affordances in a fixture are worse than
  absent ones: they read as coverage. Either exercise them (the first two map to real recorded
  fields — polling continuity and the `lastUsedTime` evidence ADR 013 requires be recorded and never
  branched on) or delete them and the doc lines that advertise them.
  **Sharpened by OAI-34's real run, 2026-08-04: `lastUsedAdvances` models a state that does not
  occur.** LM Studio reports `lastUsedTime: null` for the whole time it is serving a request, so
  `activityObserved` returned `null` in every episode and the "advancing timestamp" the knob
  simulates was never observed against the real server. A fixture knob that produces a shape the
  vendor does not is worse than an unused one — a test built on it would pin the instrument against
  fiction. So for this knob the choice is narrower than for the other two: **delete it, or keep it
  explicitly as a not-observed-in-the-wild case and say so in the doc line.** `unreadableFromMs`
  is untouched by this and remains a genuine shape (the run recorded `unreadableSamples: 0`, so it
  is real but did not occur).
  Note the mechanical check that found both is worth keeping as a guard rather than a one-off: the
  set of episode verdicts reachable through the e2e matrix should be compared against
  `EPISODE_VERDICTS` minus the stated exemption, so the next hole fails the suite instead of waiting
  for a review.

- **OAI-46** — The tracker-consistency guard pins one line, and its prose now says so — decide whether
  that is enough. **Filed from OAI-34's terminal review round, which demonstrated the gap rather than
  argued it.** `tests/ttl-vocabulary.test.js` reads BACKLOG's `Accepted verdicts:` line and compares
  it set-wise against `CONCLUSIVE`, which the driver's exit code imports. That pins **that line**.
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

- **OAI-49** — A matched-budget arm, so a cross-model comparison measures the model rather than the
  model plus its window. **Filed 2026-08-04 from OAI-19's gate grill; it is the reason that run
  publishes a deployed-systems comparison and reports the clean decomposition as NOT OBTAINED.** The
  reply budget is derived from each model's served window, so the two arms do not run the same
  instrument on the same case: measured 2026-07-30, `model-info` capped at 47,724 for the dense model
  against 74,000 for the MoE, and `scaffold` at 30,683 against 65,499 — the dense model reasoning
  under less than half the space on the corpus's largest case. `structured` differs in *input* rung
  on top of that. No case in the corpus is currently a clean model-only comparison, which is a
  stronger statement than the `structured` confound already on file and was not previously noticed.
  Options: pin an explicit `contextLength` for both profiles so the derived reserve matches; or add a
  `--reserve`/`--analysis-cap` override to the review command and run a matched arm beside the
  deployed one. The second is more honest — it leaves the shipped behaviour alone and makes the
  matched arm a separate, labelled instrument — but it is a new flag on a command whose surface this
  repo guards deliberately, so it is a decision rather than a fix.

- **OAI-50** — Decide whether a run whose context probe failed should be scored at all. **Filed
  2026-08-04 from OAI-19's gate work, where the July records answered the question by accident.**
  When `model-info.mjs` cannot detect a served window, the run proceeds with `contextChecked: false`
  and the reply budget falls back to a fixed 44,405. Every off-pattern `analysisCap` in the
  2026-07-30 arms is exactly such a run — `config-origin` dense at 44,405 beside 74,000, `caps` MoE
  at 44,405 beside 74,000, `scaffold` MoE at 44,405 beside 65,499 — and they cluster immediately
  after a failed run, which suggests the probe fails in whatever server state a drop leaves behind.
  Those runs were **scored in July as if they were the same instrument as their siblings**, and the
  fallback is not uniformly conservative: dense `scaffold` derives 30,683, *below* the fallback, so a
  probe failure there *raises* the ceiling. OAI-19's gate (G-L) excludes them from scoring, which
  handles the benchmark. The open question is the product one: should `/oai:review` refuse, warn
  louder, or retry the probe, rather than quietly reviewing under a budget nobody chose? The size
  guard is disarmed on exactly that path, which is when an oversized request goes out unrefused.


- **OAI-52** — **Six items from OAI-3's own verification list did not land** — ~~five~~ **four remain
  here, both corrections dated 2026-08-05: item (1) is done, and item (3) was superseded by OAI-62,
  which found the property is not merely untested but false at two sites.** Item (6) also survives in
  a weaker form than filed — see its entry. Filed the day the feature shipped, from reading the plan's
  verification section back against the tests that exist, so
  that `BACKLOG_DONE.md`'s OAI-3 entry cannot read as complete coverage. None of these is a known
  defect; each is a property the plan said would be proved and that nothing currently proves. Ordered
  by what it would cost to be wrong about.
  **~~(1) `scripts/lib/job-auth.mjs` has no test at all — neither side of it.~~ DONE 2026-08-05** —
  `tests/job-auth.test.js`, 8 tests. Both sides: `authPolicyFor` records an origin and provably not
  the key, and `resolveCredential` is exercised on each of its four refusal legs plus the happy path.
  The wire assertion the plan asked for is there as a real submission and a real detached worker, with
  the queue held open by a synthetic `running` row so `providers.json` can be repointed in the window
  between them — the worker then fails `credential-unavailable` and **contacts the endpoint not at
  all** after the edit, which is asserted against a request-count taken at that moment rather than
  over the whole recording (submission's own probes legitimately carried the old key, in the
  foreground, while it was still authorised). **It ships with a positive control in the same file** —
  the identical fixture with the config left alone completes and carries `Bearer key-a` on the wire —
  because without it a worker that died before ever reaching `resolveCredential` satisfies every
  assertion in the negative test. Mutation-proved: neutering the third origin comparison to `false`
  turns both the unit test and the wire test red and leaves the control green.
  **Why it was the sharpest of the six, kept because it is the reason for the ordering:** `authPolicyFor`
  (submission) and `resolveCredential` (the worker) implement the rule that a key is sent only when
  the current profile's origin, the persisted `authorizedOrigin` and the persisted transport's origin
  **all three** agree — a rule adopted *because* the two-term version was found to be tautological in
  the plan gate. The plan asked for "a profile that moved origin between submission and worker start
  yields `credential-unavailable`, asserted on the wire". `tests/config.test.js:59-68` covers the
  foreground analogue (`resolveProfile` does not carry a key to another origin), which is adjacent
  evidence and not this: it exercises neither module, and the three-term check is exactly the part the
  foreground path does not have.
  **(2) `state='running'` and `worker_pid` are never observable apart.** The plan called for this as
  an *atomicity* assertion, having previously called for a test of the window between them — which
  the one-transaction design makes unreachable, and a test that cannot fail was itself a gate finding.
  The property holds by construction today; nothing notices if a later edit splits the `UPDATE`.
  **(3) A `SQLITE_BUSY` expiry is retried, never terminalized.** `isBusy` exists in `job-store.mjs`
  and three call sites use it, but no test contends the database hard enough to produce one. This is
  the failure that kills live work if it ever regresses — a job failed because two processes wrote at
  the same moment.
  **(4) A real process killed mid-transaction leaves either the pre-transaction or the committed
  state, never a partial one.** This is a claim about SQLite rather than about this code, which is why
  it is fourth; but the design rests on it, and the repo's own habit is that a load-bearing claim gets
  executed rather than cited.
  **(5) The submitter writes the row exactly once on the success path** — counted through an injected
  store, **not** by mtime, an mtime being the last write rather than a count.
  **(6) No session identifier appears in a row.** ~~Structurally true … and guarded by nothing.~~
  **Corrected 2026-08-05 by the OAI-58 ladder: this sub-item was misfiled.** A guard exists —
  `tests/status.test.js:43` asserts `doesNotMatch(JSON.stringify(row), /session/i)` — and it was added
  in `3e7d429`, *inside* the OAI-3 range and **predating this filing** (`370efc1`). What is true is
  weaker than "no test": the check is a string match on a JSON dump, so it would catch a column *named*
  with that word but not a session id stored under an unrelated key, and it carries no positive control
  proving it can fail. So the remaining work is to strengthen an existing guard, not to write a missing
  one. It is the property that distinguishes this design from the reference plugin's, whose `SessionEnd`
  sweep depends on exactly the field this schema omits. Noted in
  [ADR 014](adr/014-async-jobs.md) where the claim is made.
  **(3) is superseded by OAI-62**, which found the property is not merely untested but false at two
  sites, one of which kills a running worker.

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

- **OAI-55** — Redact a credential carried in a `--base-url` query string. `normalizeBaseUrl`
  preserves `url.search` verbatim, so `--base-url 'https://host/v1?api_key=…'` persists a **real
  secret** into `jobs.db` and into the `transport` column every `/oai:status` reads. OAI-3 warns at
  submission and relies on `0600`/`0700`, which was the user's explicit decision ("warn is fine, keep
  going") and is recorded as such in [ADR 014](adr/014-async-jobs.md) — the alternative of refusing
  outright would break a legitimate provider whose auth is query-string-only. The fix is to store the
  query in two forms: what to send, and what to show. **Note the claim it repairs**: without the
  warning, "the credential is never persisted" was simply untrue, and that sentence had been in the
  plan for fourteen rounds before the gate caught it.
  **Widened and part-corrected 2026-08-05 by the OAI-58 ladder, in three ways.**
  **(1) The warning itself prints the secret.** `task-submit.mjs:37-40` interpolates `profile.query`
  verbatim. Executed: `Note: the base URL's query string (?api-key=sk-SUPER-SECRET-1234) is stored…`.
  **The consumer, cited rather than assumed:** `commands/task.md:5` declares `allowed-tools: Bash(node:*)`
  and `:57` invokes the companion with **no stderr redirection**, and the Bash tool returns stderr as
  conversation content — the same channel the plugin deliberately uses for `substitutionNotice` and
  `progress.mjs:76`. So the secret leaves the `0600` database and enters the session transcript, and the
  model provider, on every subsequent turn. **The mitigation this item relies on (`0600`/`0700`) does not
  apply to the channel the warning uses.** (Not determined: whether that tool result is persisted at
  rest under `~/.claude/projects/**`. That bounds the blast radius, not whether it leaks.)
  **(2) It is not a `--base-url`-only problem.** `buildProfile` splits the query off **any** profile's
  `baseUrl` (`config.mjs:125,149-153`), so a `providers.json` profile with a query-string key triggers
  this on every `--background` submission — where the secret was never on the command line and never in
  the conversation, and this warning is what puts it there. For the `--base-url` form the echo adds
  little, since `commands/task.md` already interpolates `$ARGUMENTS` verbatim.
  **(3) This item overstates the display side.** "into the `transport` column every `/oai:status` reads"
  is wrong about the reading: `job-render.mjs:122` prints `transport.baseUrl`, which is query-free. The
  column holds the secret; nothing renders it.

- **OAI-56** — The prefill-overlap bound: a cancelled or dead job can hold the server for the
  remainder of its prefill after the queue has moved on. **Measured, not assumed** — LM Studio says so
  itself on disconnect ("If the model is busy processing the prompt, it will finish first"), and
  prefill is the expensive half here at ~335s dense / ~67s MoE. Same model next: only a slowdown.
  Different model next: its JIT load overlaps that prefill, which is the two-models-resident case the
  memory ceiling forbids. **Deliberately not mitigated in OAI-3**, because the obvious mitigation —
  polling `lms ps` for idleness before dispatch — is a vendor-specific check in a plugin that is
  generic by construction ([ADR 001](adr/001-generic-openai-compatible-plugin.md)), and would put an
  `if LM Studio` where the whole repo has providers-as-data. Any fix must be shaped as configuration
  or as a generic post-cancel settle delay, not as a vendor probe.

- **OAI-57** — No `--json` on `/oai:status` or `/oai:result`. **The `/oai:task` half SHIPPED 2026-08-05**
  as the prerequisite Stage 2's task benchmark turned out to have: a bench that cannot read a
  machine-readable envelope must parse prose, which is the retracted class. What landed mirrors
  `/oai:review` exactly — the reply as an opaque `content` string (nothing parses the answer's shape),
  the `notes` array so the template's caveats cannot go missing on the machine path, `contextChecked`
  beside `estimatedTokens`, and `errorReport` on failure with the exit code and stderr unchanged.
  **What remains is `/oai:status` and `/oai:result`**, and OAI-80(a)'s forgeable `attachments` line is
  still the reason to want the status half. Left out of OAI-3 phase 4
  as unrequested surface, and recorded here so the omission is a decision rather than an oversight.
  **Corrected 2026-08-05, verified against `TASK_SPEC` and by running the command:** this entry used to
  say "`/oai:task` and `/oai:review` both have it", and that is **false** — only `/oai:review` does
  (`REVIEW_SPEC.booleanFlags` includes `json`; `TASK_SPEC.booleanFlags` is `['background']`, and
  `task --json` exits 1 with "Unknown option"). The mistake matters because it makes the item look
  smaller than it is and because **Stage 2's task benchmark needs exactly this** — a bench that cannot
  read a machine-readable task envelope must parse the prose footer, which is the class this repo has
  retracted twice. The row is already a JSON-shaped record, so the cost is still small — but
  the moment it exists it is a **contract**, and the enumerated-field problem OAI-36 describes for the
  bench reliability prose applies to it exactly. Do it when something actually consumes it (the
  `oai-delegate` agent in OAI-5 is the likely first consumer), and version the envelope when you do.

- **OAI-59** — **`/oai:result` renders a payload it does not understand, and prints `undefined` and
  `NaNs` when it does.** Filed 2026-08-05, noticed during phase 6 verification against a hand-seeded
  row and initially written off as a fixture artifact — it is not, and the second look is what this
  entry records. `renderTaskFooter` does `(durationMs / 1000).toFixed(1)`, so an absent `durationMs`
  renders `NaNs`, and an absent `model` renders `model: undefined`.
  **What makes it reachable is new in OAI-3.** Before, the footer only ever rendered an outcome the
  same process had just produced, so every field was there by construction. Now `cmd-result.mjs`
  renders an `outcome` **another build persisted**, and `job-view.mjs:33` deliberately keeps reading a
  database a *newer* plugin wrote — that is the designed behaviour, and [ADR
  014](adr/014-async-jobs.md) is explicit that the lifecycle envelope is stable across versions while
  `outcome` is exactly the part that may change shape. So the one row this build is guaranteed not to
  understand is the row it will happily render.
  The fix is not to default the numbers, which would print a fabricated `0.0s`. It is for the footer
  to omit a part it has no value for — the same absence-is-not-a-value rule the request DTO already
  follows, where `undefined` means absent and `null` is invalid. ~~Low severity (cosmetic, on a path
  that already tells the user the database is newer)~~, filed for the class rather than the symptom.
  **Severity raised 2026-08-05 by the OAI-58 ladder: this is not cosmetic.** On the same path
  (`cmd-result.mjs:29-31`), a newer row whose **content field was renamed** is not rendered oddly — it
  is reported as **"recorded no answer"**, which is a false statement about a job that produced one.
  That is the `findings: null` versus `[]` distinction — trap instance 14 in `.claude/REPO_TRAPS.md`,
  and the defect [ADR 003](adr/003-structured-findings.md) exists to prevent — appearing in a new place.
  So the fix must report an unsupported payload as unsupported, and render only validated fields;
  omitting absent parts is necessary but not sufficient.

  **Absorbed 2026-08-05: OAI-71, which is the same decision wearing a smaller hat.** *The
  unknown-context warning is not persisted, so `/oai:result` omits it for exactly the jobs whose input
  size was never verified.* `cmd-result.mjs:50` always passes `null`. The foreground footer reports
  that the size check was disabled; the background path drops it. Persisting it **adds a field to
  `outcome`** — the same shape-drift surface, decided once: what `outcome` may carry, how a build that
  does not recognise a field behaves, and what the footer renders when a value is absent. Its own
  filing said to decide it with this item rather than alone, so the merge takes that at its word.
  Note the pairing sharpens the fix: the added field is itself the first test of the rule, since a
  build predating it must render the row without claiming the job "recorded no answer".

- **OAI-60** — The retention ceiling is a constant in one place and a **literal `50` in prose** in
  `commands/status.md:56` and `commands/result.md:36`. `cmd-result.mjs` interpolates `RETAIN` into its
  hint correctly, so changing the constant leaves the code truthful and the two command markdowns
  quietly wrong — and command markdown is precisely the surface CLAUDE.md notes "nothing else notices
  when it rots", which is why `tests/plugin.test.js` exists. It does not check this.
  Two lines of fix, and the feature skill's rule picks between them: one definition, or one guard.
  A guard is the cheaper of the two here — assert the rendered `RETAIN` appears in both files —
  because the alternative is generating prose from a constant, which is worse than the problem.

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

- **OAI-63** — **The credential model authorises by ORIGIN while every request is by FULL URL, and the
  leak is proved on the wire.** `job-auth.mjs:28` stores `originOf(baseUrl)`, discarding path and
  query; `:45,:59` compare origins only; `cmd-task-worker.mjs:38-45` then builds the profile from the
  **frozen full endpoint** plus the **freshly resolved key**.
  Executed end to end through the real CLI — two real `--background` submissions, real detached
  workers, `providers.json` re-pointed while job 2 sat `queued`. What the server received:
  ```
  path=/tenant-a/v1/chat/completions  authorization=Bearer KEY-TENANT-A
  path=/tenant-a/v1/chat/completions  authorization=Bearer KEY-TENANT-B   <-- leak
  ```
  Confirmed variants: the query form (`?tenant=a` endpoint, key from the `?tenant=b` profile), and an
  **`apiKeyEnv` swap** — `baseUrl` untouched, env var repointed, and the worker sent an unrelated
  inherited secret. **The three-term check validates *where*, never *which secret*.**
  **Against the ADR, precisely:** `adr/014:147-152` states the rule as three *origins*, so this is not
  a violation of its letter — but `adr/014:143-145` **explicitly notices** that "an origin drops the
  `/v1` path, the query string" as its reason for storing the transport whole. The asymmetry was seen
  and not followed through, and the ADR's own justifying harm happens one path segment down.
  Severity is deployment-shaped: near-inert on `localhost:1234`, real on path-multiplexed gateways
  (LiteLLM, Azure APIM, Cloudflare AI Gateway). Not attacker-triggerable — a foot-gun for the
  legitimate user. Second-order: `task-submit.mjs:2-7` promises submission validates "in front of the
  user"; it validated `/tenant-a` with KEY-A and the worker sent KEY-B, so **that guarantee does not
  cover the credential**.
  **Why this is not a batch fix:** comparing the full normalised endpoint means persisting an
  authorized *endpoint* instead of `authorizedOrigin` — a payload change, so a `schema_version`
  decision plus a migration story for rows already written, which is the repo's own grilling-checklist
  item.

  **The same root cause one layer up — moved here 2026-08-05 from OAI-72(c), because it is not a
  second item.** `config.mjs:187`'s `sameOrigin` withholding is origin-only too, so
  `--provider prod --base-url <same origin, different path>` keeps prod's key — executed:
  `apiKey: "KEY-PROD"`, `credentialWithheld: false`. Both halves are the single decision "does
  authority attach to an origin or to an endpoint", and answering it in one place and not the other
  leaves the leak reachable by the other route. `config.mjs` predates `e74eb2c^`, so this half is
  outside the OAI-3 range and cannot be closed by a fix scoped to it — which is the reason it was
  filed separately and the reason it must not stay that way. **OAI-72 keeps its ID and its other two
  claims**, which are about file modes and stdout and share nothing with this.

- **OAI-64** — **`/oai:status` cannot show the blocker that is starving you, which VOIDS the mitigation
  ADR 014 traded the recycled-pid wedge for.** `job-view.mjs:127` filters visibility on
  `row.workspace === cwd || row.state === 'running'` — a **state** predicate — while blocker-ness is
  decided by `job-queue.mjs:56-62` `queuedRole()`, which returns `blocks` for a queued row that is
  live-but-unknown-version, `starting` or `malformed`, and by `job-queue.mjs:96` for the plain queued
  head. **Every one of those blockers has `state='queued'`**, so none satisfies the exception.
  `job-view.mjs:118-123` asserts the opposite in its own words ("a malformed row holding the head of
  the queue is the one thing a user most needs to see") and ADR 014 (~180) promises "`/oai:status`
  names the blocking pid for the user to deal with by hand".
  Executed: `tryAcquire(A)='blocked'`, yet `statusView` shows only jobA plus
  `(1 more elsewhere — pass --all)`. `viewOf(jobB)` had the note **ready** ("pid N is alive but has not
  beaten since 10m ago") and never reached it, because the row was filtered out one step earlier — the
  information is computed at `job-view.mjs:125` and discarded.
  Needs no second plugin build: one queued waiter whose pid was recycled or suspended suffices.
  The correct predicate is the derived `display`/`liveness` already in hand. **Do this before OAI-69**,
  which it partly mitigates.

- **OAI-65** — **The `0600` protects the file that holds nothing; the WAL sidecar holds the secrets at
  `0644`.** Four related defects in the state directory's posture, all observed with controls.
  **(a)** `job-store.mjs:154-159` chmods only `databasePath()`. SQLite in WAL mode creates
  `jobs.db-wal`/`-shm` itself at default mode. Measured under umask 022 with the real `openStore()` +
  `insertJob()`: `jobs.db` `-rw-------` containing **neither** the secret nor the source, `jobs.db-wal`
  `-rw-r--r--` containing **both**. It survives SIGKILL, and the worker runs up to 3600s.
  `job-store.mjs:136-137` states the contract in its own words — the file that holds the user's source
  is not the file that is protected. **Note for anyone re-checking: SQLite removes the WAL on a clean
  close, so a post-hoc `stat` sees nothing. Measure with a handle open, or after a crash.**
  **(b)** `mkdirSync(..., {mode})` never re-applies a mode to an **existing** directory (observed:
  0755 before, 0755 after). Loosen all three and re-run `openStore()`: `jobs.db` self-heals to `0600`,
  the state dir and `logs/` stay `0755` **forever**, and every subsequent WAL is created loose. So (a)'s
  containment rests on one bit nothing re-tightens. **(b) is the load-bearing half — fix it as primary
  and (a) as belt**, since SQLite recreates the WAL during the process's life and a one-time chmod
  catches only the current one.
  **(c)** `job-spawn.mjs:33` opens `logs/<seq>.log` with no `O_NOFOLLOW`, at a predictable sequential
  path. Observed: the mode argument is ignored when the file exists, and the open **follows a symlink
  and appends to its target**. Positive control in the same run: the identical open with `O_NOFOLLOW`
  refused with `ELOOP`. Gated on (b), this is disclosure **plus an arbitrary-file-append primitive**.
  Note `O_NOFOLLOW` does not cover a pre-existing *regular* file owned by another principal, so pair
  it with (d).
  **(d)** Deleting `jobs.db` makes a **new** job inherit an **old** job's log: `AUTOINCREMENT` restarts
  at 1, `job-spawn.mjs:33` opens `'a'`, and `sweepQuietly` runs *after* `spawnWorker` so the new seq 1
  is already a known row and its log is not an orphan. Observed end to end — `logs/1.log` survives
  carrying era-1 output and is attributed to the new job, and both `/oai:status` and `/oai:result`
  point the user at it.

- **OAI-66** — **Two reconciler diagnoses that contradict the row they are written from.**
  **(a) A crashed worker is published as a clean `cancelled`.** `job-reconcile.mjs:30-33` treats **any**
  `cancel_requested_at` as proof the cancellation completed and returns before the `worker-died` branch
  at `:34-39`, writing `state='cancelled'` with `failure=null` and `outcome=null` — and
  `job-render.mjs` `noteFor` renders **no note** for terminal `cancelled`. **Proved with a positive
  control**: the identical abrupt death (a real child SIGKILLed while `running`) reconciled twice — no
  cancel pending → `worker-died`/`failed`; cancel pending → `cancelled`, `failure=null`. The control
  fires, so the check *can* distinguish; the verdict is decided purely by whether a cancel was in
  flight, never by why the process died. **This is a diagnostic that exists and is thrown away.** It
  pairs with OAI-62(a), which supplies a very reachable crash.
  **Note for whoever fixes it:** the reconciler cannot be fixed alone. The cooperative exit leaves no
  positive signal that the worker exited *because of* the cancel — that absence is why the inference
  exists — so the worker must record something before exiting, spanning `cmd-task-worker.mjs` /
  `job-heartbeat.mjs`. Changing `job-reconcile.mjs:30` alone flips legitimate cancellations to
  `failed`, and `tests/cancel.test.js:44-101` asserts the opposite.
  **(b) `terminalizeUnstarted` blames the submitter for a crash the row proves was the worker's.**
  `job-reconcile.mjs:50-58` writes "The process that submitted it most likely died before the worker
  was spawned. Submit it again." unconditionally — but `job-spawn.mjs:40-43` awaits the OS `'spawn'`
  event before returning and `task-submit.mjs:102` stamps `spawned_at` only after, so a **non-null
  `spawned_at` is proof the submitter survived process creation**. `job-liveness.mjs:85`
  (`spawned_at ?? created_at`) collapses the two windows ADR 014:121-122 explicitly distinguishes.
  Reachable via any throw in the worker's pre-registration window (`cmd-task-worker.mjs:78-92`):
  `DatabaseTooNewError`, a swept row, an unhandled `SQLITE_BUSY`, OOM. "Submit it again" reproduces a
  systemic failure identically. The sibling `terminalizeDead` (`:37`) names the log; this one does not.

- **OAI-67** — **A failed spawn blocks the whole queue; a post-spawn write failure reports failure while
  the worker runs on.** Raised independently by three lenses.
  **(a)** `spawnWorker` rejects on `'error'` (`job-spawn.mjs:40-43`) and `task-submit.mjs:97` does not
  catch it, so the row stays `queued` with `spawned_at` NULL. `queuedRole` then returns `starting` →
  `blocks` (`job-queue.mjs:60`), so **every successor is blocked for the full 120s grace**, not merely
  this job. The plan's own bullet asked that a spawn `'error'` mark the job failed; it is failed only
  by the grace, two minutes later, via a different mechanism.
  **(b)** After `spawnWorker` resolves the child is alive and detached, but `markSpawned`
  (`job-record.mjs:121`, a bare UPDATE) or `sweepQuietly` (`task-submit.mjs:72-78`, which **rethrows
  anything non-busy** by deliberate design) can still throw. The submitter then exits non-zero with
  **no id printed** while the worker proceeds to call the model. The job is discoverable via
  `/oai:status`, so it is not lost — but the user was told it failed, and a reasonable retry duplicates
  the work. Once the child is known to exist the submission is accepted; later housekeeping must not
  convert that into a reported failure.

- **OAI-68** — **`PRAGMA user_version` is checked only when a connection opens, so an in-flight worker
  bypasses the newer-database refusal.** `applySchema` (`job-store.mjs:120-125`) reads it once inside
  `openStore()`, and a worker holds that handle for the life of the job — minutes to the 3600s default
  cap. A newer build opening the same database in that window raises `user_version`; the old worker's
  later `beat`/`claimJob`/`finish` never recheck and write to a schema it does not understand. This is
  a hole in the two-version design **on its own terms**, since the stated rule is that a newer database
  is refused for all mutations. The fix (recheck under the same write lock) touches every mutation path
  and collides with whatever OAI-63 does to the persisted payload, so sequence it after that decision.

- **OAI-69** — **A recycled pid reads `live` forever and wedges the queue, with no recovery path.**
  `isAlive` (`job-liveness.mjs:45-53`) proves a pid is *owned*, not that it is owned by our worker. A
  recycled `worker_pid` reads `live` at `:80`, so every reader and `decide` treat the row as a blocker
  permanently; the stale heartbeat is cosmetic by explicit design ("the pid decides death; the beat
  only corroborates"); and cooperative cancel cannot reach a process that is not ours. **I grepped for
  a recovery path and there is none** — no `--force`, no abandon, in `cmd-cancel.mjs` or
  `commands/cancel.md`. Recovery today is deleting `jobs.db` by hand. Most reachable across a reboot,
  where low pids are certainly reused.
  ADR 014 accepts this wedge **on the stated condition** that `/oai:status` names the blocker — which
  OAI-64 shows it does not. **So this item's urgency depends on OAI-64 landing**, and it is not an
  independent gap.
  Constraint on any fix: `tests/queue-guards.test.js` forbids signalling a process this repo cannot
  verify, so the answer is operator force-terminalization of the **row**, never a kill.

- **OAI-70** — **Three small correctness guards on the worker's row-decoding path.**
  **(a)** `resolveCredential` never checks `auth.profile` exists: `job-auth.mjs:54` passes
  `{provider: auth.profile}` and `config.mjs:197` treats a falsy provider as "use `defaultProvider`".
  Executed — a row whose `auth` lacks `profile` **completed and sent a credential the job never named**.
  Reachable only from a forged or foreign row, but one line (`if (!auth?.profile) throw`) closes it.
  **(b)** It pairs with a real structural gap: `cmd-task-worker.mjs:85` is the **only** consumer of a
  decoded row that never calls `isKnownVersion`, where `job-queue.mjs:57` and `job-reconcile.mjs:72`
  both do — and the forward-compat story explicitly contemplates a newer writer's rows in the table.
  **(c)** A `transport` payload of JSON `null` crashes at `cmd-task-worker.mjs:40` before the auth
  check, giving exit 2 with a TypeError envelope rather than the UserError exit 1. No credential
  escaped (the positive control proves the probe would have seen one). Diagnosability only —
  deliberately not inflated.

- **OAI-72** — **Two credential-exposure defects OUTSIDE the OAI-3 range, filed because they undercut
  it.** Both verified; `config.mjs` and `cmd-setup.mjs` predate `e74eb2c^`.
  **(a)** `config.mjs:41-42` writes `providers.json` with **no mode**. Observed on this machine:
  `-rw-r--r--`, under `~` at `drwxr-x---` and `~/.config` at `drwxr-x--x`, both group `staff`, with a
  second local account in `staff`. `job-auth.mjs` deliberately stores no credential and defers to this
  file, so the file's mode is what that decision rests on. **Two honesty caveats kept from the agent
  that found it:** the read was *not* performed as the other user — this is mode arithmetic over
  separately verified components — and it deliberately did not check whether the file currently holds
  an `apiKey`. Mechanism confirmed; today's exposure unverified.
  **(b)** `cmd-setup.mjs:21` builds its fallback row from the **un-normalised** `rawProfile?.baseUrl`,
  query intact, and `render.mjs:111` / `cmd-setup.mjs:46` print it to **stdout**. Ran with a positive
  control: the failing profile printed `…/v1?api_key=sk-QUERY-SECRET-9999`; the control (env var set,
  so `buildProfile` succeeds) printed `…/v1` clean. Reachable via any `buildProfile` throw.
  **(c) MOVED 2026-08-05 into [OAI-63](#)**, where it is the paragraph beginning "The same root cause
  one layer up" — `config.mjs:187`'s origin-only
  `sameOrigin` withholding. It is OAI-63's root cause one layer up and the two bodies both said to fix
  them together, so it now lives where that decision is made. Nothing was lost: the executed evidence
  (`apiKey: "KEY-PROD"`, `credentialWithheld: false`) went with it. **This item keeps its ID and (a)
  and (b)**, which are a file mode and a stdout echo and share no decision with it.

- **OAI-73** — **Coverage the ladder found missing, beyond OAI-52's list.** None is a known defect.
  (a) an unknown-`schema_version` **queued** row with a **NULL waiter** — `queue-reconcile.test.js`
  covers the v1 NULL-waiter case and the v99 live/dead-waiter cases, never the v99 × NULL combination;
  (b) the late worker that loses `registerWaiter` and exits without dispatching
  (`cmd-task-worker.mjs:92-97`) — its stderr string appears nowhere in `tests/`, and it is the guard
  that stops a late worker double-dispatching; (c) the `starting` branch of `job-liveness.mjs:87`,
  which no test drives inside a paused publication/spawn window.
  Also recorded, not defects: `tests/job-store.test.js` and `tests/structure-jobs.test.js` (plan:435-436)
  were never created — their function is discharged by `queue-guards.test.js` and the generic ratchet;
  and the plan asked for the wall clock the new tests add, which was never reported (only the count).

- **OAI-74** — Enforce the attachment boundary for **every** caller, not just the delegate's recipe.
  **Narrowed 2026-08-05 by OAI-5's second review pass: the delegate path is now enforced.** Its recipe
  runs `readlink -f` per attachment and refuses the submission when a resolved path leaves the git top
  level — falling back to the working directory outside a repository, so it is only as tight as where
  the session was rooted —
  proved with controls in `bash` and `zsh` (an in-tree symlink to `/etc/hosts` and a bare `/etc/hosts`
  both refused, in-tree files accepted). So the symlink variant that would have survived a
  `resolve()`-based fix is closed **for this agent**. What remains, and why the item stays open:
  the check lives in agent-authored shell, so it protects the delegate and not `prompt.mjs`'s other
  callers; and an agent holding unscoped `Bash` can still reach the network without the companion at
  all. Original framing follows.
  Filed 2026-08-05 from the OAI-5 plan gate, where Codex raised it and it was deliberately **not**
  grown into that item. `readFileBlocks` (`prompt.mjs:12`) accepts absolute paths and `..`, and
  `readFileSync` follows symlinks, so a component that selects its own attachments can send a file
  from outside the working tree to the configured endpoint. `agents/oai-delegate.md` states the rule
  — repository contents are untrusted data, and every attachment's *resolved* path stays inside the
  tree unless the user named the file — but prose is not a boundary, and the agent is the first
  consumer in this repo that chooses files without a human reading the list first.
  **Not a known exploit and not attacker-triggerable today**: it is a foot-gun that becomes a
  disclosure path the moment a repository file's content is treated as an instruction. The decision
  needed first is *where* the check belongs — `prompt.mjs` refusing an out-of-tree `--file` would
  also constrain the foreground commands, where the user typed the path themselves and the refusal
  would be wrong. So this is probably an opt-in flag the agent passes, which is a surface decision
  rather than a one-line guard.
  **Rescoped 2026-08-05 by OAI-5's security review, which showed the obvious implementation would not
  work.** Three corrections, the first of which is the reason this item is not what it looked like:
  **(a) It must dereference, not resolve.** The natural fix — `resolve()` plus a prefix test — accepts
  an **in-tree symlink pointing outside the tree**, and that variant is worse than the ones it does
  catch, because it is the only one that leaves *no trace*: verified by execution, a link at
  `./innocuous-note.txt` was read and `prompt.mjs:23` labelled it `innocuous-note.txt`, so the model
  header, `digestsOf` and the rendered attachment list **all** name the harmless in-tree path. Absolute
  and `..` attachments at least appear in those records. So the check needs `realpathSync`, and needs a
  decision about dangling links, where `realpathSync` throws `ENOENT` and today's code maps that to
  "File not found".
  **(b) Containment is necessary and not sufficient.** `.git/config` and `.git/logs/HEAD` (a token in
  an HTTPS remote), an in-tree `.env`, `.claude/settings*.json` are all *inside* the tree. A perfect
  boundary admits every one of them.
  **(c) `prompt.mjs` is not the last word.** The agent holds unscoped `Bash`, so `curl` bypasses the
  companion entirely; `commands/task.md:5` scopes its own grant to `Bash(node:*)` and the agent does
  not. Scoping the agent the same way is incompatible with its one-shell-invocation recipe, which
  needs `mktemp`, `awk`, `sleep` and `trap`. Now filed separately as **OAI-76**. **Codex's adversarial
  stage rated the residual high (0.99) and said do not ship**; it shipped anyway, with the limits
  stated in [ADR 015](adr/015-a-context-broker-not-a-forwarder.md) — recorded here so the dissent is
  not lost.
  **(d) The check and the read are separated by a process boundary, so containment is TOCTOU.** Raised
  low by the security lens in pass 3 and high by `codex-adversarial` in pass 8. The delegate's shell
  canonicalises a *pathname* and compares it; `readFileBlocks` then resolves and opens that name again
  one process later, so an attacker able to swap a symlink or an ancestor directory *between* those
  moments defeats the check. It is open rather than urgent because it needs a **concurrent local
  attacker mutating the filesystem mid-run**, which is outside this feature's threat model of untrusted
  repository *content* — but it is the strongest argument for doing this item properly: the real fix is
  to validate and read through **one held descriptor** and submit the captured bytes, rather than
  re-opening a name that was checked earlier. That is only possible here, in `prompt.mjs`, and it
  cannot be done in agent-authored shell at all.
  **(e) Whatever lands here should also settle what the root IS.** The delegate anchors containment to
  `git rev-parse --show-toplevel`, falling back to the working directory outside a repository, so the
  boundary is only as tight as where the session was rooted — started at `$HOME`, it admits everything
  under `$HOME`. Stated in the agent text and ADR 015 rather than hidden, but a code-side boundary
  should decide this deliberately rather than inherit a shell fallback.

- **OAI-75** — **An unidentified suite intermittent, recorded because it was seen and not explained.**
  Observed once on 2026-08-05 during OAI-5, in the first `npm test` after a live delegation round trip:
  a `strictEqual` failure with `actual: 2, expected: 0`. It did **not** reproduce — three consecutive
  full runs green afterwards, on identical content — and **the failing test's name was not captured**,
  which is the gap that makes this an item rather than a fix. The count shape matches the
  `assert.equal(scenario.chats().length, 0, …)` family in `tests/job-auth.test.js:167` and
  `tests/queue-reconcile.test.js:31,67`, i.e. *two chat requests reached a recorder that should have
  seen none* — which would mean a worker ran where a blocker should have stopped it.
  **Two hypotheses were tested and neither is supported.**
  *(1) Store leakage from this machine's real job rows.* `tests/job-helpers.mjs:27-38,116-124` scopes
  `OAI_PLUGIN_STATE` to a temp dir per scenario and restores it in a `finally`. Not the explanation —
  though note this rules out the *helper*, not interleaving, which is why (2) was run.
  *(2) `process.env` interleaving with the new async test.* `OAI_PLUGIN_STATE` is process-global, and
  OAI-5 added the first `async` test to `tests/plugin.test.js`, which awaits a child four times — so a
  scenario overlapping it could read the wrong store. **Refuted by execution**: 8/8 green running
  exactly `node --test tests/plugin.test.js tests/job-auth.test.js tests/queue-reconcile.test.js`, the
  file combination that would have to interleave.
  **Attribution, stated at the strength the evidence supports:** 1 failure in ~9 full-suite runs with
  the OAI-5 diff, 0 in 5 full-suite runs with `tests/plugin.test.js` reverted, 0 in the 8 targeted
  runs. That is not enough to call it pre-existing and not enough to blame the diff; it is one
  unexplained event with two candidate causes eliminated.
  **Second observation, 2026-08-06, and it is a different shape — a HANG, not a failure.** Two
  independent `npm test` invocations were found still alive after **6h38m and 6h47m**, both wedged on
  the same file: `tests/review-json.test.js`. Both were runs this session started, saw exceed their
  tool timeout, and moved to the background without ever completing. Two separate runs stopping in the
  same place is not scheduling noise.
  **This retracts an explanation given earlier the same day.** A single failing test during the Stage 2
  work was dismissed as "flaky under parallel load" because it passed when re-run alone. That reading is
  unsupported: load does not explain a run that never terminates, and it was a guess offered as an
  answer.
  **The live capture was lost** — the two processes were killed at the user's request before a stack was
  taken, so the next step is to reproduce rather than to read. Concretely: run
  `node --test tests/review-json.test.js` alone in a loop and watch for one that does not return, then
  take a report with `kill -SIGUSR1 <pid>` **before** killing it. The fake server and its
  `runCompanion` children are the obvious suspects — `tests/helpers.mjs` resolves on `'close'`, which
  waits for every descriptor a child holds, and this repo has already shipped one hang from exactly that
  (see the footgun about a detached worker inheriting a descriptor).
  **Whether the two observations are one bug is unknown** and should not be assumed: one is a wrong
  count that vanished, the other is a run that never ends.
  **Still unidentified as of 2026-08-05, and deliberately NOT merged into OAI-62(c).** OAI-5's later
  passes produced a third `database is locked` sighting with a captured test name, which closed the
  naming gap **for that signature only**. This item's signature is different — a `strictEqual` of
  `2` against `0`, which is a chat-request count, not a locked database — and nothing since has
  reproduced it. Merging them on the strength of "both are flaky" would lose exactly the distinction
  that makes this one worth keeping open.
  This is a **different signature from OAI-62(c)** (a locked database), so it is filed separately
  rather than folded in. Both share the property that matters: a failure indistinguishable from a real
  regression. Next step is to capture the name — run the suite in a loop with the failing test's
  output retained, rather than reasoning about which assertion it must have been.

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

- **OAI-77** — **In-tree secrets are attachable, and containment cannot see it.** Filed 2026-08-05 at
  OAI-5's verdict point. The delegate's enforced check refuses paths that resolve *outside* the root;
  `.git/config` and `.git/logs/HEAD` (a token in an HTTPS remote URL), any in-tree `.env`, and
  `.claude/settings*.json` are all *inside* it. `agents/oai-delegate.md` names them as never-attach in
  prose, which is exactly the enforcement gap OAI-74 exists for, one direction over. A deny-list
  belongs wherever OAI-74's containment lands, since both are the same predicate on the same path.
  Note the asymmetry worth keeping: containment is a property of the path, while this is a property of
  the *content*, so a deny-list will always be a heuristic — which is an argument for keeping the
  attachment list small and visible, not against having one.
  **Widened 2026-08-05 by the ladder's pass-8 security lens: an in-tree HARDLINK to an out-of-tree
  file passes containment**, verified — `sub/hl.txt` disclosed a file outside the tree. A hardlink has
  nothing to resolve, so `realpathSync` cannot see through it the way it sees through a symlink, and
  **unlike the symlink case the audit trail is truthful**: that name genuinely is a name for that
  inode, so nothing is mislabelled and no check is forged. It belongs here rather than with the
  containment work because it needs local write access into the tree — the same premise as the rest of
  this item — and because no path-resolution fix can address it. If it is ever worth closing, the
  instrument is `st_nlink > 1` or a device/inode comparison against the root, not a path check.

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

- **OAI-80** — **The delegate's own report can be forged or degraded by content it does not control.**
  Filed 2026-08-05 from the ladder's pass-6 and pass-8 security lenses. Neither is disclosure —
  containment is untouched and both are strictly smaller than the model reply `/oai:result` already
  prints — but both undermine the *reporting* contract the agent is judged on.
  **(a) The `attachments` line is ambiguous by construction.** `job-render.mjs:128` joins entries as
  `path (N B)` with `, `, and the agent is told to take its file list from that line precisely because
  it is what the job recorded. An in-tree filename containing `, ` or ` (0 B` can therefore forge an
  extra entry or mask a real one in the list reported upward. The fix belongs with OAI-57's `--json`,
  where the list is an array and the question does not arise.
  **(b) The failure note carries up to 400 characters of server-controlled text.** `assertOk` embeds
  the response body, the recipe now prints the status detail, and the agent is told to quote the note
  when a job failed — so an untrusted server's text reaches the transcript as something the agent is
  instructed to repeat. Bound it, or mark it as quoted foreign text rather than diagnosis.

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

- **OAI-82** — **"At most two `task` submissions, at most one accepted job" is not auditable.** Filed
  2026-08-05. The invariant is stated in the agent, ADR 015, this tracker and the done entry, and only
  its *accepted* half leaves a trace: an oversize refusal happens before any row exists, so a second
  submission is invisible afterwards and nothing can reconstruct the count from persisted state. Not a
  defect — the invariant holds by instruction and the refusal is the point — but it is a claim the
  repo cannot check, which is the class this repo keeps promoting into structural tests. If it is ever
  worth checking, the cheap form is a pre-publication attempt counter on the row rather than an
  idempotency key; note that Codex proposed the full transactional design and it is far more than this
  earns.

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

- **OAI-85** — **`/oai:result` never shows "context window unknown", so an unarmed size guard is
  invisible on the background path.** Filed 2026-08-05 by OAI-83's wide review, which **confirmed it is
  PRE-EXISTING** — `cmd-result.mjs` hardcodes `contextNote: null` at HEAD, and reverting OAI-83 leaves
  the divergence identical. `task-report.mjs` passes `budget.checked ? null : budget.note`, so the same
  run warns in the foreground and stays silent after `--background`. This is REPO_TRAPS instance 16's
  family — a second rendering dropping a caveat the first carries — and it reaches a real state:
  `checkContextBudget` returns `{checked:false}` without throwing whenever a provider has no
  `contextLength` and probing cannot determine one, which is the **default for LM Studio here**.
  **The reason it was not fixed with OAI-83**: the background path never persists `budget`, so the fix
  is a persistence decision, not a render tweak — either store the note in the request DTO beside
  `template`/`estimatedTokens`, or recompute it in the worker. Decide which before building.

- **OAI-86** — **The delegate recipe's containment machinery has no test anywhere, proved by
  mutation.** Filed 2026-08-05 by OAI-83's wide review. `agents/oai-delegate.md` is the file whose every
  guard exists because something concretely went wrong — `canon`'s `--` stopping a file named
  `--require=/tmp/evil.js` from being EXECUTED, its control-character refusal stopping a truncated path
  passing containment, and the `case "$real" in "$root"/*` boundary. **None is executed by any test**:
  deleting the boundary check leaves the whole suite green, demonstrated with a positive control in the
  same run. `tests/plugin.test.js` pins only the terminal-state prose and the `awk` expression;
  `tests/delegate-template.test.js` stubs `canon` to identity and `root=/tmp` deliberately, and now says
  so plainly rather than claiming coverage elsewhere — the false claim it used to make was itself a
  finding.
  **Shape of the fix**: a suite that runs the recipe's containment block against real symlinks and
  hostile filenames in a scratch tree. Note this is the one part of the recipe where the stakes are
  disclosure rather than correctness, which is why it is filed rather than folded into an
  argument-construction suite.

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

- **OAI-88** — **The task corpus has ONE case, so every number it produces is n=1.** Filed 2026-08-06.
  `bench/task-cases/prototype-lookup` is the whole corpus. This file's own standing methodology note
  says N=1 per arm is a lottery ticket, and that applies to the instrument as much as to the runs.
  **The next case is already specified and cheap**: the zsh word-splitting defect from OAI-83, whose
  executable witness is a loop comparing argv across `sh`, `dash`, `bash` and `zsh` — the exact script
  that found it. A third could be the render-scope artifact defect from the Stage 2 ladder.
  **The bar a case must clear** is in `bench/lib/task-corpus.mjs`: `before/` and `after/` trees, a
  witness that FAILS on the first and PASSES on the second, and no prompt containing a marker it will
  be scored on.

- **OAI-89** — **The Stage 2 ladder never reached dual approval, and four of its entries are filed
  rather than fixed.** Filed 2026-08-06. Two passes ran (`80f6bea`, `4310475`), 39 ledger entries, and
  the ladder ended by **termination, not approval** — so nothing in it is `verified`; every entry is
  `pending verification`. The ledger is `plans/stage-2-ladder-ledger.md` and it is the handoff.
  **Pass 3 is owed for a specific reason, not as ceremony:** pass 2's batch **widened the frozen diff**
  to `cmd-task-worker.mjs` and `cmd-result.mjs`, which neither pass reviewed. Carried forward as
  filed-not-fixed: an empty file reporting one line where `wc -l` reports none; the slice note's
  position, which Codex argues belongs in the **system message** (the same move templates already
  make, and it would decouple the warning from the status excerpt entirely); `tests/file-slices.test.js`
  now pulling `node:sqlite` transitively, which is OAI-61's import chain; and `bench/task-run.mjs`'s
  `main()` having no test.
  **Start it in a FRESH session.** The clause in the repo's own methodology fired: pass 2's findings sat
  mostly inside pass 1's repairs, and two of them were defects the author had already reasoned about
  and shipped anyway.

- **OAI-90** — **Two Stage 2 deliverables were never built, and were reported as shipped.** Filed
  2026-08-06 by the late review ladder, which is the only reason they are visible.
  **(a) Artifact PERSISTENCE.** The plan asks for "patches and findings stored as separate artifacts
  beside the raw output". Only the *check* was built: `saveArtifact` existed but was gated on a field
  nothing ever set, so it was unreachable, and it is now deleted rather than left looking shipped.
  Wiring a `--save-artifact <path>` flag was **deliberately rejected mid-ladder** — a caller-supplied
  write path for model-generated content is a new consideration that would fire `security-review`, and
  growing the reviewed surface inside a pass is its own defect. Decide the shape deliberately: a flag,
  a fixed location beside the job log, or not at all.
  **(b) Context manifests.** Never built, never deferred, never recorded until now. The plan pairs it
  with file slices ("context manifests and file *slices*"); slices shipped, manifests did not, and
  nothing anywhere said so. Decide whether a manifest is a distinct thing from the delegate's existing
  `files` list before building anything.

- **OAI-91** — **A query-string credential is transmitted by every provider-touching command, and only
  background `/oai:task` says so.** `normalizeBaseUrl` keeps a base URL's query string verbatim, so
  `--base-url 'https://host/v1?api_key=SECRET'` sends that key on every request. `submitTask` warns,
  because the key also lands in the job row — but the notice is scoped to STORAGE, deliberately (see
  `adr/018`): a draft claimed transmission too and was false whenever `readFileBlocks` threw before a
  byte was sent. Foreground `/oai:task`, `/oai:review` and `/oai:setup`'s probe all transmit it and say
  nothing. Warning in one command and not the others is arbitrary, so the fix belongs where the URL is
  resolved, not where a job is submitted — probably `resolveProfile`, once, for every command.
  Found by the OAI-61 review ladder (pass 5) and scoped out of it rather than half-done.

- **OAI-92** — **`assertOk` embeds 400 characters of a server's error body into persisted job state.**
  `provider.mjs:100-103` builds a non-2xx message from `readText(response, {limit: 400})`; that message
  reaches `errorReport` (`cmd-task-worker.mjs:117`), is written to the `failure` column, and is rendered
  by `/oai:status` (`job-render.mjs:80`) and `cmd-result.mjs`. A proxy or gateway that echoes the
  request URI in its 4xx page — nginx does — therefore writes `?api_key=…` into durable state and onto
  the screen. Requires a cooperating server, which is why it is filed rather than fixed inside OAI-61.
  Found by that feature's `security-review` stage.

- **OAI-93** — **`providers.json` is created world-readable and holds the long-lived credential.**
  `config.mjs:47-48` writes the config with **no mode argument** — directory `0755`, file `0644` — and
  never chmods it, while that file can hold a literal `apiKey`. The whole job-state tree is hardened to
  `0600`/`0700` (see `adr/018`), so the *ephemeral* copy of a credential is protected and the permanent
  one is not. Pre-existing and outside the OAI-61 diff, which is why it was filed rather than folded
  in; found by that feature's `security-review` stage, which measured the modes rather than reading
  them. Fix is one `mode` argument plus a narrowing pass for configs that already exist, and it should
  reuse whatever verified-chmod helper OAI-95 lands, rather than trusting `chmod` not to throw — an
  earlier version of that helper was disproved on a FAT image, where the call silently no-ops.

- **OAI-95** — **permission hardening for the job state tree, withdrawn from OAI-61 with its findings.**
  `job-store.mjs` chmods `jobs.db` to `0600` best-effort and swallows every failure, so hardening that
  fails does so silently. OAI-61's ladder built a `state-permissions.mjs` (`restrict`, `narrowOrWarn`)
  to fix that and it was withdrawn with the rest of the unplanned scaffolding (`adr/033`); the tree is
  back to the pre-existing bare `chmodSync`, which is where it was rather than worse.
  **Design already established, and each point was proved by execution rather than argued:**
  `restrict()` must **verify the mode took** rather than trust `chmodSync` not to throw — disproved on
  a FAT image, where the call silently no-ops and leaves the file readable; the chmod must run **before**
  `PRAGMA journal_mode = WAL`, because SQLite creates `-wal`/`-shm` with the main file's mode as it
  stands at that moment and nothing chmods them afterwards, so a first-ever submission wrote the query
  string, the prompt and every attached file into a `jobs.db-wal` left at **0644**; and the failure must
  be **reported**, since the rest of the code's reassurances are written as though it succeeded.
  **Carry these open findings, none of which the withdrawn version closed:** `restrict()` returns true
  on a **symlink** (it follows one, making `openStore` a chmod primitive against any victim-owned path)
  and on a **dangling** symlink (ENOENT counted as success), and does not check the owner is the current
  user; on **macOS an ACL is invisible to `st_mode`**, so it can return true at 0600 while
  `group:everyone allow read` persists — the exact inverse of the FAT case, reachable with no attacker
  action via one inheritable ACE on any parent of `~/.local/state`, and this repo runs on darwin; the
  early chmod's return value is **discarded**, so a throw in `applySchema` (a too-new database, which is
  reachable and tested) skips the warning entirely; `jobs.db-journal` is in **no** narrowing list though
  SQLite writes it whenever WAL cannot engage, holding pre-images of committed pages; `openStoreForReading`
  narrows nothing, creating `-wal`/`-shm` at 0644; log files get the mode only on creation and `'a'`
  follows symlinks; and a state directory **owned by someone else** throws `ERR_SQLITE_ERROR`, which is
  not a `UserError`, so the single most likely permission failure a real user hits prints
  `Unexpected failure: <stack>` and exits 2 unclassified. Finally, the warning is **invisible on the
  worker path**: `cmd-task-worker.mjs` opens the store in a process whose stderr IS the job log, so it
  is written where the user has no reason to look, and it names neither the mode it wanted nor the mode
  it found — so a reader cannot tell 0644 from 0666. Any fix must also pin the hardening's own tests:
  in the withdrawn version, deleting the `-wal`/`-shm` entries from the narrowing list reddened
  **nothing**, and nothing asserted the directory mode at all.

- **OAI-96** — **three pieces of residue in the shipped `node:sqlite` guard.** All found by OAI-61's
  final pass, all in code that landed in `2312c47`, none blocking.
  (a) **`throw null` is still reachable.** `job-store.mjs`'s comment claims the invariant holds "by
  construction rather than by a null check a later edit can drop", and the truthy check closed the
  *resolved-but-no-export* route — but a **falsy rejection value** still reaches `throw importFailure`
  and prints `Unexpected failure: null`, the exact string the comment says was eliminated. Proved by
  execution with a loader hook; no shipping Node produces it, which is why it is low. Fix is
  `importFailure = error ?? new Error(…)` **plus softening the comment to what is true** — an
  overstated invariant is the more durable half of this defect.
  (b) **Two assertion triples in `tests/runtime-capability.test.js` are non-separable** — the exit-code
  assertions move as one under any exit-code edit, and the refusal-message assertions under any message
  edit. **They must NOT be deleted.** The `assert.deepEqual(server.requests, [])` check passes
  *vacuously* if the command dies for any reason before the probe, and its neighbours are what establish
  the refusal path was the one taken: they are subsumed-as-CONTROL, not subsumed-as-redundant. This
  repo deleted four assertions on the redundancy reading during that same ladder, so the distinction is
  filed as a documentation fix before someone applies the rule again.
  (c) Six unused imports in `tests/runtime-capability.test.js`, left by the split. No lint catches them.

- **OAI-97** — **an intermittent test failure, observed once and never reproduced.** During OAI-61 a
  full-suite run failed an `assert.equal(status, 0, stderr)` in a job/background test, with stderr
  opening on the ordinary `Checking fake for available models…` preamble. It did **not** reproduce
  across ten subsequent full-suite runs. Recorded rather than closed because a flake that is not
  understood is a test that cannot be trusted to fail for the right reason, and this suite gates every
  commit. The one lead: it is a submission returning non-zero, not an assertion about content, so the
  place to look is worker spawn or queue timing rather than any single test's logic.
  **Second occurrence, 2026-08-06, while closing the session**: a full-suite run read **629/1**, and the
  failure detail did not survive into the summary — three immediate reruns were 630/0. So the rate is
  now two observations against roughly fourteen clean full-suite runs, and it remains unidentified.
  Anyone picking this up should capture `npm test` to a file rather than grepping a live pipe, since
  both observations lost the failing test's name that way.
  **Third occurrence, 2026-08-07, during OAI-94's pass-6 batch**: `actual: 2, expected: 0` mid-batch,
  then three consecutive captured green runs at 637/637. The failing test's name was lost to a live
  pipe for the THIRD time, by the same person who wrote the sentence above telling them not to — which
  is the actual finding here. The rate is now three observations against roughly thirty clean
  full-suite runs. Anyone picking this up should make the capture the default, not the advice:
  a note that has failed to be followed three times is not a note, it is a missing default.

- **OAI-98** — **job state is trusted completely once it is on disk.** Two findings from OAI-61's
  `security-review`, both needing write access to the state directory — a shared `XDG_STATE_HOME`, a
  pre-created `/tmp` path, not the default `~/.local/state`.
  (a) **A tampered row redirects the prompt.** `cmd-task-worker.mjs` `transportProfile` takes `baseUrl`
  and `query` **verbatim** from the row, so replacing `jobs.db` sends the whole prompt and every attached
  file to an attacker's endpoint, and the reply is printed by `/oai:result` — reaching the delegate
  agent's context. *Proved not redirectable: the configured credential.* `job-auth.mjs`'s third
  comparison anchors on the **current config's** origin, so a forged `authorizedOrigin` is refused —
  that check genuinely defeats a fully attacker-written row and is worth keeping. But the common local
  case has no key (`mode:'none'`), and then nothing is checked at all.
  (b) **No `PRAGMA secure_delete`**, so `job-retention.mjs`'s `DELETE` leaves `transport.query` — and
  the prompt — recoverable in freelist pages of a file whose permissions are the only protection.
  Deliberately separate from OAI-95: hardening the *modes* does not help once the bytes are readable by
  a process that legitimately opened the file.

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

- **OAI-101** — **`/oai:status` prints the persisted endpoint, path credential included.**
  `job-render.mjs:122` renders `provider` as `${transport.name} → ${transport.baseUrl}`. The row holds
  the effective endpoint by design (a worker rebuilding from the provider name alone would call
  somewhere submission never validated — `adr/014`), so a credential in the path is displayed by an
  ordinary status check, and the delegate agent captures that output. The query string is not shown
  here, which is why this is separate from OAI-91: the disclosure is specific to the path form. Fix is
  a render-time redaction, not a change to what is stored.

- **OAI-102** — **the refusal for a credential in a URL prints that credential.** `config.mjs:141-145`
  rejects a `--base-url` carrying userinfo and builds the message from `raw` — the complete URL — so
  `http://user:hunter2@host/v1` puts `hunter2` on stderr. **The other two exits from `normalizeBaseUrl`
  echo `raw` too** and a fix that covers only the credentials branch is half-done: `:137` (non-http
  scheme) is reachable with userinfo intact, and `:132` (unparseable) can hold one in a string that
  never became a URL. This is the sharpest member of the tier, because the argument that protects the
  others does not apply: OAI-94 declined to gate its notice on "does this look like a secret" since the
  code cannot know — but here the code *does* know, since the branch printing the credential is the
  branch that exists because it identified one. Found by OAI-94's `codex-adversarial` pass 4 at high
  confidence and confirmed independently; filed rather than fixed there because `config.mjs` is
  pre-existing code that diff does not touch, on exactly the reasoning that filed OAI-100.

- **OAI-103** — **`--json` omits the caveats the human-readable reply prints.** `/oai:task --json`
  carries `templateNotes` as an array precisely so a harness cannot read a crowded reply as a clean
  one (ADR 016). The `--background` submission path does not: it returns a job id, and the notes a
  foreground run would have printed — including the endpoint-persistence notice ADR 019 added — reach
  stderr only, where a `--json` consumer parsing stdout never sees them. So the machine-readable form
  is quieter than the human one about exactly the things a machine should not silently drop. Found
  during OAI-94's ladder and filed rather than folded in, because the fix is a payload decision that
  collides with OAI-57's, not a change to the notice.

- **OAI-104** — **this file's structural invariant is enforced by a script that does not exist.**
  `BACKLOG.md` states that the tier list "is asserted against the heading order below by the
  sweep's close-out script; the two cannot drift apart silently." There is no such script anywhere in
  the repo, and no test in `tests/` checks the invariant either — so the two *can* drift apart
  silently, and the sentence promising otherwise is the reason nobody would look. Verified by search
  during OAI-94's residue step, after a `scout` had to check the invariant by hand (66 IDs, exact
  match) precisely because nothing automated does — and then, minutes later, a scripted edit to this
  very file deleted 28 headings and nothing but a manual count noticed. This is the repo's own
  "a check that reports success may be one that cannot fail" class, applied to its tracker: the fix is
  either a real guard in `tests/` — the natural home, since `tests/structure.test.js` already guards
  file size and `tests/plugin.test.js` guards the command surface — or deleting the claim. Do not
  leave the sentence standing without one of the two.

- **OAI-105** — **the reconciliation writes have no contention answer, only an argument.** ADR 020
  retries six sites with `withBusyRetry`, skips three more with a bare `isBusy` catch, and
  deliberately leaves `job-reconcile.mjs`'s four writes
  unprotected, on the reasoning that the sweep re-runs on the next read so a `SQLITE_BUSY` costs one
  deferred reconciliation rather than a lost fact. That reasoning is untested in both halves: nothing
  bounds how long the deferral can last under sustained contention, and nothing establishes that a
  later read always arrives — a database whose only reader has stopped running leaves a `worker-died`
  row uncollected indefinitely. Raised in OAI-62's review ladder and filed rather than fixed there,
  because widening that change to a fifth subsystem is how a batch stops converging. The fix is either
  a witness that drives a busy through a reconciliation sweep and proves the next read corrects it, or
  a `withBusyRetry` at those four writes and the deletion of the argument from ADR 020's exclusion
  list. Do not leave the exclusion standing on reasoning alone.

- **OAI-106** — **the ROW is still wrong about why a salvaged job ended.** Narrowed by OAI-62, which
  originally filed this as the whole defect — a paid-for answer lost outright — and then had both
  approvers reject that filing: losing the answer *was* contention killing live work, which is
  precisely OAI-62's own ask, so it was fixed in the ladder rather than deferred. `salvageOutcome`
  now writes the outcome to the job log under the fixed prefix `SALVAGED_OUTCOME` before the storage
  error propagates, so the answer survives.
  What remains is the state machine, not the data: the row stays `running` with a pid about to
  vanish, and reconciliation later publishes `worker-died` — a misdiagnosis, because the worker
  answered and SQLite refused the write. `/oai:result` still reports a dead worker for a job whose
  answer is sitting in its own log, and nothing in the row points at it. The fix is an explicit
  non-terminal `persistence-pending` state that `/oai:result` and reconciliation both understand, or
  a recovery pass that reads a salvaged line back into the row — either needs a durable-channel
  design OAI-62's plan did not cover, which is why the log write was the part built. Related:
  [OAI-105].

- **OAI-107** — **cancellation is the one lifecycle fact with no contention answer.** `runCancel`
  calls `reconcileAll` before `requestCancel` and neither is retried, so a `SQLITE_BUSY` anywhere in
  the sweep fails the command before the stop request is attempted at all — and what the user sees is
  a raw `database is locked`, not a `UserError` with a hint, so even "run it again" is advice the
  output does not give. The billable request they wanted stopped carries on. OAI-62 declined to build
  this: a failed cancel is visible and nonzero, it kills nothing, and that item's ask is that
  contention must not kill live work. But review called the enumeration lifecycle-biased with
  justification — terminal facts get retries and a stop request does not. The fix is a cancellation
  contention policy: reconciliation best-effort under busy, `requestCancel` retried on a short bounded
  budget, and exhaustion converted to a `UserError` that states the cancellation was not recorded.
  Needs a witness driving a busy through both halves.

- **OAI-108** — **an unrecorded start reaches a human and no machine.** When the spawn stamp's retry
  exhausts, `submitTask` warns on stderr that the job was spawned and that this session cannot see
  what the worker did next — but `--json` still emits `{id, background: true}`, byte-identical to a
  submission whose start was recorded. A harness therefore cannot distinguish them, and the one
  channel it reads says everything is normal. A `spawnConfirmed` field was built during OAI-62's
  ladder and **reverted**: it changed a published `--json` contract that item's approved plan never
  covered, and `commands/task.md` documents that envelope literally. Whatever lands here must ship
  with the doc, an end-to-end `--background --json` test, and a name describing what is actually
  unknown — the spawn IS confirmed, `spawnWorker` returned a pid; it is the recorded start that is
  missing, and a caller reading "unconfirmed spawn" could resubmit a billable request.

- **OAI-109** — **the rescue's own guard is unwitnessed, and one narrow hole inside it is real.**
  `salvageOutcome` guards its stderr write, and if `JSON.stringify` throws it writes a
  "could not be written" line instead — at which point **the answer is lost**, which is the exact
  outcome the rescue exists to prevent. That hole is unreachable today, and the reason is worth
  keeping: `outcomeOf` builds only strings, numbers, nulls, `artifactFor`'s `{state, detail}` of
  string literals, and `result.usage`, which came from a parsed JSON response and is acyclic by
  construction — so no cycle and no BigInt can reach it. **A future field could open it**, and
  nothing would notice, because neither the serialisation-failure path nor the log-write-failure path
  has a witness — where `publishFailure`'s structurally identical guard has one in
  `tests/job-busy-diagnosis.test.js`. Two things to do, and they are separable: witness both paths,
  and serialise before entering the terminal-write path so a serialisation fault is discovered while
  the row write is still available. Raised at high confidence by `codex-adversarial` in OAI-62's
  terminal pass. Related: [OAI-106].

- **OAI-110** — **the six-sites count is stated in a third document that nothing holds to the code.**
  `tests/busy-site-count.test.js` derives both counts from `scripts/lib` and requires the sentence in
  `adr/020` and `job-busy.mjs` — but CLAUDE.md states the same figure in its own words, outside that
  `documents` array. Proved with a mutation and a positive control: a seventh `withBusyRetry` site was
  added, the guard failed naming only the two documents, those two were corrected, the guard went
  green — and CLAUDE.md still said "six". **Adding CLAUDE.md to the array does not fix it**: the
  required sentence is the literal "six `withBusyRetry` call sites", and CLAUDE.md's "six enumerated
  sites" collapses two different counts into one number, matching neither the required-sentence check
  nor the wrong-number check. So the fix is to reword the CLAUDE.md line to carry both counts with
  their nouns, *then* add it to `documents`. This is the same defect the guard was written three
  review passes deep to eliminate, reproduced one document over. Raised and CONFIRMED by `lean-wide`
  in OAI-62's terminal pass.

- **OAI-111** — **~28 stale git worktrees are accumulating under `.claude/worktrees/`.** Left behind
  by review fan-outs whose agents ran under `isolation: worktree`; each is a full checkout of this
  repo, so the disk cost is real and grows with every wide review. Nothing reads them after the run
  that made them. Needs a sweep that is safe against a worktree still in use — `git worktree list`
  plus a liveness check, not a blind `rm -rf` — and, if the harness offers one, a cleanup hook rather
  than a manual command nobody remembers to run.
- **OAI-112** — **The candidate-selection design is under a PARTIAL PLAN WITHDRAWAL. ADJUDICATED
  PARTIAL BY THE USER, 2026-08-07** — so the two repairs OAI-84 shipped STAY, and only the
  candidate-selection design is replaced. The replacement goes through a fresh step-3 plan gate and
  earns its own ladder; the one-per-feature replacement budget is not consumed until that ladder's
  ledger opens. Filed 2026-08-07 from OAI-84's review ladder, which ran six passes
  and ended WITHOUT dual approval (both approvers returned `CHANGES-REQUIRED`). What is withdrawn is
  only the candidate-selection design that grew across passes 2-5 — **the two repairs OAI-84 was filed
  for both stand and are audited**: the channel fallback under `--structured-output`, and the bare
  top-level array. The defect is structural, not a bug list: `findingsShaped` (content) and
  `extractJson` (position, last-outermost) each decide alone, neither knows what the other guarantees,
  and **two signals the design never represents** are visible to neither — candidate MULTIPLICITY, and
  whether a candidate has a valid extent. Carried evidence, all reproduced first-hand: several
  outermost candidates are resolved silently by position; the "prose-wrapped clean review is
  unreadable" trade rests on a false binary, since a lone scanned empty could be accepted while genuine
  competitors are refused; a wrapper-shaped array element is kept in place of the payload it wraps; and
  `extractJson` admits a candidate with `end: undefined`, which survives the containment filter (every
  comparison against `undefined` is false) and wins the ranking — not live today only because the
  single caller's predicate happens to reject it, which is a coincidence of the caller rather than a
  property of the code. **Scope it as CANDIDATE SELECTION, not "ambiguity"** — scoped to multiplicity
  alone, the extent defect survives the replacement. Replacement code is not eligible until a fresh
  step-3 plan gate closes; the one-per-feature replacement-ladder budget is UNSPENT.

- **OAI-113** — **The OAI-84 batch made prose scanning QUADRATIC on model-controlled input.** Filed
  2026-08-07, live today. `scanFor` skips a start position whose bracket never closes, but re-scans the
  entire remaining suffix before advancing ONE byte, so a reply carrying many unmatched openers costs
  O(n²). Measured **through the real CLI**, not at component level: a 200KB reply of unmatched `[`
  takes **39.15s**, against **0.13s** for a same-size clean reply and **0.14s** for the identical input
  before the batch — ~280×, and nothing upstream bounds it (`--max-seconds` is a transport deadline;
  this CPU is spent after the bytes arrive). Fix shape: enumerate bracket spans in one string-aware
  linear pass with a stack, or cap scan work and fail unreadable past the cap. Wants a performance
  regression test with a large malformed prefix. Independent of OAI-112 and fixable before it.

- **OAI-114** — **One primitive sibling discards a whole findings list — a REGRESSION FROM BASE.**
  Filed 2026-08-07, live today. `objects(list)` requires EVERY element to be an object, so
  `{"findings":[{valid},"junk"]}` returns `null`. At base `4f6975a` the valid finding survived and the
  junk was counted as `dropped: 1`. It contradicts a guarantee ADR 003 states in its own words — that
  a bare array is the same reply as `{findings: […]}` and malformed siblings are counted rather than
  fatal. **The guard that should have caught it is the tenth instance of this repo's signature defect**:
  the test named `one malformed entry does not discard its siblings, in any spelling` uses an OBJECT
  missing fields, which `objects()` accepts, so the primitive case its name promises was never covered.
  Fix: admit a list with at least one normalizable finding and let normalization drop the rest.

- **OAI-115** — **The answer gets no reserved token budget, so the model spends it all reasoning.**
  Filed 2026-08-08 from OAI-19's arms. `max_tokens` is a single pool shared by reasoning and the
  reply, computed as ~(window − prompt) and capped at 32,768. qwen3.6 spends essentially all of it
  thinking and emits no findings; the CLI then reports "ran out of tokens before it finished writing
  its findings", which reads as a sizing problem and is an allocation problem. Evidence: four cases,
  four budgets spanning 4.5×, reasoning terminating at 86–94% of each (table in the OAI-19 run log).
  **Both easy fixes are already refuted**: a larger budget is simply consumed (T1 — 4.5× moved
  `structured` from 0/3 to 1/3), and no reasoning control exists on this server (T3 — three parameters
  accepted and silently ignored). The remaining shape is a floor reserved for the answer that
  reasoning cannot consume, and failing loudly if the model crosses it. **Model-modulated**: the MoE
  starves on 4–5 of 6 cases, dense on 1 of 6, and dense has the *smaller* window — so this is not
  fixable by choosing a bigger model. **Blocks OAI-19.**

- **OAI-116** — **The token-exhaustion failure path emits no `attempts[]`, making G-E unpassable.**
  Filed 2026-08-08. A run lost to token exhaustion is recorded with `attempts: null`, so OAI-19's
  gate criterion G-E — "a missing or self-inconsistent `attempts[]` on any run invalidates the
  invocation" — fails for any arm containing one, whatever its recall. Since token exhaustion is now
  the dominant failure mode, **no arm can pass the gate**. Not a general defect and not longstanding:
  on 2026-08-04 all 4 failed runs carried ledgers, because those failures were transport failures,
  whose path preserves the record. It also destroys the reliability evidence exactly where failures
  are most interesting. **Blocks OAI-19**, and is likely small.

- **OAI-117** — **`bench` cannot pass `--structured-output`, so the schema arm cannot be measured.**
  Filed 2026-08-08. `bench/run.mjs`'s `SPEC` has no such flag, so the only cases that reliably starve
  the model (the corpus's large ones) cannot be run under a schema. This is why OAI-19's T2 could
  establish that the schema *causes* the transport drops but not whether it *fixes* token exhaustion —
  the question had to be left open for want of a flag. Small, and it unblocks a real question.

