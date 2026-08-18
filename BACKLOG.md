# Backlog

IDs are stable and global (`OAI-n`, never reused). **The tier index below is the priority view — top of
the index is next.** Item bodies below it sit in ascending ID order, not priority order; a re-order
rewrites only the index (`adr/025`, 2026-08-08).

The direction is **"use local LLMs like I use Codex"** —
[`plans/local-llms-like-codex.md`](plans/local-llms-like-codex.md), paired with Codex. The ordering
below is not the plan's stage order and that is deliberate: the stages say what to *build* next, the
tiers say what is *wrong today*, and a defect outranks the next feature. Two prior sweeps' full
rewrite notes (2026-08-05, 2026-08-14 — what shipped, what each sweep verified and filed) are moved
verbatim to [`evidence/backlog-header-history.md`](evidence/backlog-header-history.md) rather than
carried in this header, since the tier list below now states the same residue inline per tier.

<!-- tiers -->
### The order, by impact — tiers, and why each leads where it does

Impact is blast radius × whether the thing is wrong *today* ÷ cost to resolve. Ties break on what has
to be decided or measured first. **This list is the priority view; the bodies below sit in ascending
ID order and a re-order rewrites only this index** (`adr/025` — the one-time migration was performed
2026-08-08). **`tests/backlog-structure.test.js` asserts this on every `npm test`** — the index covers
the live set exactly, no id is indexed twice, the bodies are in ID order, and nothing is live and
closed out at once. Until 2026-08-09 that guarantee was prose naming a close-out script that did not
exist (OAI-104), and the guard's first run found six closed ids still indexed, two ids indexed under
two tiers each, and one body out of order. **Note the invariant CHANGED on 2026-08-08**: it used
to be "the index sequence equals the heading sequence", which is why OAI-104 describes a guard that
never ran — re-read that item against this convention before working it.

**Tier 1 — a background job kills, loses or misreports live work. EMPTY as of 2026-08-16, and kept
as a closure record rather than deleted.** All three members closed in two days:
**OAI-161 (`6d06f6c`, 2026-08-15)** — retention could destroy a paid-for answer, and now exempts an
operator-abandoned row that reached `running`. **OAI-166 (`7f65ac6`, 2026-08-15)** — the fixtures its
scope cut left are built and the two silent SQL traps are pinned. **OAI-162 (`d1f3e2c`, 2026-08-16)** —
an unreadable pid no longer reads as a dead process, and such a row fails closed as `malformed` in
both states.
**Nothing was promoted in to keep the tier populated, and that was a deliberate call.** OAI-162's
review found one wrong branch in the display layer and it was folded into OAI-160 as an amendment;
OAI-160 stayed in tier 18 where its other eleven entries belong, because the row that branch mislabels
is `dead` or `never-started` — not live work, which is what this tier is for. A tier heading with no
entry list is structurally fine (verified against `tests/backlog-structure.test.js` by emptying this
one: the only failure it produced was the now-unindexed item, not the empty tier), so nothing here
forces an occupant. **The top of the priority view is therefore tier 2.**

**Tier 2 — the suite says something false about itself. EMPTY as of 2026-08-17, and kept as a
closure record rather than deleted.** **OAI-167 closed 2026-08-16 (`6b3fead`)** — see
`BACKLOG_DONE.md`; its review filed **OAI-176**, a toolchain defect in the review-ladder's
`fork-opener` stage itself. **OAI-168 closed 2026-08-17, outside this repo (`72c91bf` in
`~/Code/dotfiles`)** — the general rule that feature paid for twice (a positive control is a check
that cannot fail until something witnesses it firing) is generic test methodology, so it lives
beside `review-ladder`'s same-batch conditional rule rather than here; see `BACKLOG_DONE.md`.
**OAI-170 closed 2026-08-17 (`feeab6d`)** — see `BACKLOG_DONE.md`; its own review filed **OAI-177**,
the same unmeasured-witness gap in this file's other two exemptions. **OAI-172 closed 2026-08-17
(`81a019e`)** — see `BACKLOG_DONE.md`; its verdict-point review found a further false claim in its
own round-1 rewrite, filed as residue below.

**Tier 3 — known-unpinned, stated rather than hidden.** **OAI-171**.
**OAI-169 was PARKED 2026-08-18** by the sweep's worth bar, `not worth doing` — it is two constants whose
removal shows as an intermittent stall rather than silent wrongness, which the item itself gives as the
reason leaving them unpinned is defensible, and no such stall has been observed. See `BACKLOG_PARKED.md`.
OAI-171 is a toolchain observation with no proposed fix: a
skill loaded into a session is a snapshot, nothing says when it goes stale, and OAI-166's ladder spent
two discovery passes because of it. **OAI-177 closed 2026-08-17 (`8baf283`)** — see `BACKLOG_DONE.md`;
the existence-half gap it closed for the other two exemptions took three verdict-point rounds, each
of the first two catching a different inaccuracy in a comparative claim between exemptions, resolved
by deleting the claim rather than rewriting it a third time.
**OAI-173 was PARKED 2026-08-17** by the sweep's worth bar, `not worth doing` — its two vocabularies
currently agree exactly, and it named no dated instance of drift, only a future-risk scenario. See
`BACKLOG_PARKED.md`.
**OAI-62 and OAI-67 closed 2026-08-12, OAI-66 on 2026-08-13** — see BACKLOG_DONE; OAI-62's residual was
re-scoped into OAI-106, OAI-67 shipped with its root cause deliberately separated as OAI-145, and
OAI-66 shipped its claim halves while filing OAI-149 and OAI-150 for the mechanisms.
**OAI-64 closed 2026-08-14 (`dd35df8`) and OAI-69 closed 2026-08-15 (`6d41bd0`)** — see
BACKLOG_DONE. The re-read that OAI-64 discharged is what OAI-69 turned out to need: naming the blocker
mitigated the wedge without removing it, because `isAlive` proves only that a pid NUMBER exists. What
shipped is `/oai:abandon`, an operator exit for the row. What it left behind is this tier's two items.

**Tier 4 — a credential or a file leaves the boundary it was promised.** **OAI-183, OAI-185, OAI-72,
OAI-55, OAI-74, OAI-77**. **OAI-63 closed 2026-08-18
(`1657ba5`)** — see BACKLOG_DONE; it led this tier on evidence, the leak proved on the wire, not
argued. **OAI-65 and OAI-150 closed together 2026-08-18 (`687ed70`)** — see BACKLOG_DONE. **OAI-183 is
OAI-63's own confirmed apiKeyEnv variant, split out because it needs a different mechanism (a
credential-identity pin, not an endpoint compare) rather than a bigger diff on the same fix. OAI-185
is a sibling split from OAI-63's own review — a path-embedded secret in the AUTHORIZED endpoint's own
baseUrl, reachable through pre-existing connection-error wording, not the authorization gate.**
**Four of this tier's members were PARKED 2026-08-18** by the sweep's worth bar, all `not worth doing`
and none refuted — OAI-186, OAI-187 and OAI-188 are the three siblings found *inside OAI-65's own
review* (a symlink-followable config directory in `config.mjs`; `jobs.db` itself never passed to
`refuseSymlink`; a leaked handle on a rare pragma failure plus a schema-mismatch branch that skips mode
repair), each disclosed and deliberately left out of that fix, and none ever exploited; OAI-81 is a
consequence of OAI-3's snapshot-at-submission design accepted at the time, with no retained job body
observed costing anything. See `BACKLOG_PARKED.md`.
OAI-72 is next: the
three that are one decision apiece (OAI-72's config mode
and query echo; OAI-55's redaction), then the delegate's containment surface — **OAI-74 now stands
alone**, since OAI-76 (the unscoped `Bash` grant, its paired half) was parked in the same sweep for
naming no instance while OAI-74 carries the dated one. The boundary decision OAI-74 makes is still the
decision OAI-76 was the second view of, so read the parked entry before designing it. OAI-77 trails: it
needs local write access, and it has no path-shaped fix.

**Tier 5 — `/oai:review` returns no answer at all, or throws away the one the model gave.**
**OAI-115, OAI-116, OAI-156, OAI-113, OAI-114, OAI-112, OAI-59, OAI-70, OAI-57**.
**OAI-68, OAI-60 and OAI-80 were PARKED 2026-08-18** by the sweep's worth bar, `not worth doing` —
a `user_version` recheck for a mid-session schema bump nobody has performed, a retention count whose
two copies agree at HEAD, and a report-forging shape needing a filename or a server nobody has
produced. See `BACKLOG_PARKED.md`. Re-led on 2026-08-08 by measurement: the tier used to be trap instance 14's
family (`findings: null` against `[]`), and it still contains it, but a *worse* class now sits on top
of it and is wrong on the shipped default path today.
**OAI-156 joined 2026-08-14 and sorts third, directly behind the two starvation items**, because it
is the same tier's other half observed for the first time: OAI-115 and OAI-116 are answers never
written, where OAI-156 is an answer written, complete, `finishReason: "stop"` — and dropped at the
parser. It sits behind them on frequency (three starvations to its one in the same run) and ahead of
the rest because 1,245 seconds bought a finding the baseline agreed with, and the harness binned it.

**OAI-115 leads the whole tier and is arguably the sharpest item in this file**: `max_tokens` is a
single pool shared by reasoning and the answer, so on a large target the model spends the entire
budget thinking and emits no findings. Measured across three benchmark arms — four cases, four
budgets spanning 4.5x, reasoning terminating at 86-94% of each — and it is **model-modulated, not
model-fixable**: the MoE starved on 4-5 of 6 cases, the dense model on 1 of 6, and the dense model has
the *smaller* window. Both cheap escapes are already refuted (a bigger budget is simply consumed; no
reasoning control exists on this server), so it needs a reserved floor for the answer.

**OAI-116 is next because it is small and it unblocks a gate**: the token-exhaustion path records no
`attempts[]`, which makes OAI-19's G-E structurally unpassable and destroys the reliability evidence
exactly where failures are most interesting. **OAI-115 and OAI-116 together gate OAI-19 in tier 8** —
no further benchmark arm can pass its own gate until both land, which is why the measurement tier did
not move up despite being unblocked in every other sense.

**OAI-113 and OAI-114 are self-contained and evidence-complete**, both filed from OAI-84's review
ladder and both wrong today: a quadratic scan measured at 39.15s of CPU against 0.13s controls on
model-controlled input, and a regression from base where one primitive sibling discards an entire
findings list. Either can be done in an afternoon without waiting on anything.
**OAI-117 closed 2026-08-09** — `bench` can now pass `--structured-output`, so whether a schema fixes
the OAI-115 starvation is a measurement someone can take rather than a question blocked on a flag.
Taking it is part of OAI-19's arm work in tier 8, not a separate item.

**OAI-112 is the design job and sorts after the cheap wins deliberately.** It is the candidate-selection
withdrawal from OAI-84's ladder, **adjudicated PARTIAL by the user on 2026-08-07** — the two repairs
OAI-84 shipped stay, and only candidate selection is replaced, through a fresh plan gate and its own
ladder. Its evidence names two structural defects, not one: multiplicity is a signal neither content
nor position represents, and `extractJson` admits a candidate with no extent that survives containment
by accident of the caller's predicate. **Scope it as candidate SELECTION, not "ambiguity"** — scoped
to multiplicity alone, the extent defect survives the replacement.

Then the original family: OAI-59 is the same `null`-versus-`[]` shape on `/oai:result`, and OAI-57's
`--json` trails it — the payload decision it makes was the natural home for parked OAI-80(a), which is
worth reading beside it even though nothing now waits on it. **OAI-84 closed and merged 2026-08-13** — the sweep
verified BOTH its repairs live on disk (`structured.mjs:202` tries the channels in order;
`structured.mjs:242` wraps a bare array), so what it was filed for demonstrably works. Its only
remaining content was the withdrawn candidate-selection design, which is OAI-112's subject and cannot
close independently of it, so it merged there; see the redirect table.

**Tier 6 — what shipping Stage 2 left behind.** **OAI-85, OAI-86, OAI-56, OAI-89, OAI-90**.
OAI-89 and OAI-90 are what is left of Stage 2's own residue, filed 2026-08-06 after a review
ladder that ran late: OAI-90 is two deliverables that were reported as shipped and were not built, and
OAI-89 is the ladder that never reached approval. They sort BELOW the two OAI-83 residue items
because neither is wrong *today* — they are absences, where OAI-85 and OAI-86 are live gaps. OAI-83 shipped on 2026-08-05 and these two are
its residue: the first is a caveat missing from `/oai:result`, confirmed pre-existing rather than
introduced, and the second is the delegate's containment machinery having no test at all — proved by
mutation, and the sharper of the two because its stakes are disclosure. Both lead the tier because
they are *wrong today*, and OAI-56 trails them.
**Four of this tier's members were PARKED 2026-08-18** by the sweep's worth bar, `not worth doing` —
OAI-87 (the Stage 2 economic gate's paired arm, deliberately not started because it spends the user's
own tokens, and nothing currently misreports) and OAI-88 (the task corpus being n=1, a stated
limitation the harness prints) are absences by design rather than defects; OAI-53 and OAI-54 are
Stage 1's stated gaps, deferred deliberately in OAI-3 and recorded in `adr/014`, with no user observed
blocked by the missing `/oai:review --background` and no foreground/queue collision ever observed. See
`BACKLOG_PARKED.md`.

**Tier 7 — coverage the ladders found missing.** **OAI-28, OAI-52, OAI-75, OAI-45**. **The size ratchet that used to block OAI-28 was
RETIRED 2026-08-17 at the user's direction** ("we're no longer using ratchets") — `tests/structure.test.js`'s
per-file and per-function line-count guards and `ALLOWLIST` are deleted outright, not raised, so
OAI-28's part (A) (the ratchet itself) is now moot and parts (B) (`http.mjs`'s two untested transport
writes) and (C) (`tests/structure.test.js`'s overclaiming doc comment) are both unblocked with no split
required first.
**Four of this tier's members were PARKED 2026-08-18** by the sweep's worth bar, all `not worth doing`:
OAI-40 (two tests that overclaim, with no regression ever observed slipping past them — it had already
lost its only reason to run beside OAI-28 when the ratchet was retired), OAI-73 (*"None is a known
defect"* in its own first sentence), OAI-39 (five loose reads whose fifth illustrates itself with a
constructed `{status: null, prefillMs: 7}`), and OAI-79 (three fail-closed edges in the delegate recipe
that this index already said *"may never be worked at all"*, since they are deleted outright if the
lifecycle moves out of agent shell). See `BACKLOG_PARKED.md`.
OAI-75 is an unidentified intermittent whose next step is capture, not reasoning.

**Tier 8 — the measurement programme: BLOCKED ON THE INSTRUMENT, 2026-08-08.** **OAI-19, OAI-50,
OAI-49, OAI-9, OAI-11, OAI-13**. OAI-19 leads and gates the rest — every item behind it wants
a number to beat. It is hours of the user's own LM Studio rather than an edit, so it is launched when
they say so, never incidentally. OAI-50 and OAI-49 are the two remaining instrument questions its
predeclared gate names as stated limits. **The third, OAI-48, was PARKED 2026-08-18** by the sweep's
worth bar, `not worth doing` — the hole in its construction argument is real, but no ledger entry has
ever been observed recording a wrong served-model identity, and OAI-19's gate already states the limit
rather than pretending to check it. See `BACKLOG_PARKED.md`.
**Do not schedule an arm before OAI-115 and OAI-116 land.** Three arms ran on 2026-08-07/08 and all
three were INVALID; the MoE arm is published as a failure with both its G-G invocations spent. G-E is
unpassable while the dominant failure path records no `attempts[]`, so a fourth arm cannot pass the
gate however it performs. The arms did settle something the tier had been chasing since 2026-07-27:
**the schema causes the transport drops**, confirmed by controlled A/B, which is what OAI-20, OAI-24
and OAI-34 all failed to reach from the client side. OAI-51 traded that failure class for OAI-115's.

**Tier 9 — decisions that may close as "no", and housekeeping.** **OAI-159, OAI-27, OAI-42, OAI-176, OAI-181, OAI-184**.
**OAI-181 is a direct user request, not a "may close as no" item** — it sits here only because it
needs a probe (does relaxing `agents/oai-delegate.md`'s no-`--model` rule undo the reason it exists)
before it can be planned; see its own body.
**OAI-176 is OAI-167's residue** — **two** observed instances of a `fork-opener` subagent echoing the
orchestrator's own transcript framing instead of reviewing (2026-08-16 from OAI-167's ladder, then
2026-08-17 from OAI-170's), with no measured mechanism. The candidate mitigation — a prompt line
disclaiming ambient waiting/status framing — was tried proactively at the second instance and the fork
echoed anyway, so it is **measured-insufficient-alone**, not an untested candidate; what worked both
times was the retry, not the content of either ignore-instruction. Housekeeping, sorted last: it still
names no harm beyond the two retried passes it cost, and a standing instruction is not yet earned
because the only mitigation proposed has now been refuted rather than confirmed. *(This paragraph was
corrected 2026-08-18 by the sweep, closing OAI-180, which existed because it said "one observed
instance… needs a second instance before it is worth more than a note" while OAI-176's own body already
recorded the second.)*
**Eight of this tier's members were PARKED 2026-08-18** by the sweep's worth bar, all `not worth doing`
and none refuted. OAI-178, OAI-179 and OAI-180's siblings from OAI-165's residue: a misleading error
message on a bad `--repo` path nobody has been misled by, and a `runSweep` default-argument gap whose
own body says *"No observed or reachable defect today"*. OAI-174 and OAI-175, OAI-162's residue: the
first was WITHDRAWN from OAI-162's plan by the user because the exit is already in both command
documents and the command's own refusal, the second is one paragraph of documentation filed at the
bar's edge and saying so. OAI-182, OAI-172's residue: two additive documentation gaps its own reviewer
called *"outside this round's scope"*. And OAI-46 and OAI-29: a guard whose narrow scope is now
honestly described with no drift since, and a budget slip its own body calls *"immaterial at present
scales"*. See `BACKLOG_PARKED.md`. **OAI-180 was FIXED AND CLOSED by the same sweep** (2026-08-18) —
the tier-9/OAI-176 contradiction it named is the paragraph above; see `BACKLOG_DONE.md`.
**OAI-159 leads the tier from 2026-08-14**: 78 citations across 37 live items point at the `adr/`
corpus deleted in `d1ad2aa`, and the deletion commit records that `BACKLOG*.md` was *"deliberately not
touched"* — so the convention chosen for code comments was never adjudicated for the one file where a
citation is doing evidentiary work. It leads because every other item in this tier is one decision
about one thing, while this one decides how 37 items are read. **OAI-42** asks "is this worth
doing" rather than "do this", and was rejected on judgement rather than on evidence, which is why
the judgement is worth recording once; OAI-27 is ordinary open work. **Four of this tier's members were PARKED 2026-08-13** by the sweep's worth bar —
OAI-43, OAI-47, OAI-36 and OAI-7 named no instance of harm that had already happened, and three said so
in their own words. **OAI-33 closed the same day**: `plans/README.md` exists, verified against disk
rather than off the entry. What remains is genuinely open — OAI-42 carries a dated instance (OAI-35's
own filing made the error the name invites).

**Tier 10 — credential disclosure a ladder found and scoped out.** **OAI-102, OAI-93, OAI-95**.
**OAI-102 leads and is the one to do first** — it is a one-function fix, and unlike everything else
that was ever in this tier the code already knows the value is a credential at the moment it prints it:
`config.mjs:141-145` builds its refusal from `raw` precisely because it identified a credential in
there. OAI-93 follows: `providers.json` is created `0644` and never chmod'ed while holding a literal
`apiKey`, and it should reuse whatever verified-chmod helper OAI-95 lands. OAI-95 is the withdrawn
permission hardening and sits here rather than alongside the now-shipped OAI-94 because, unlike OAI-94,
nothing regressed when it left: the pre-existing bare `chmodSync` is still in place, so the tree is
where it was, not worse.
**Five of this tier's members were PARKED 2026-08-18** by the sweep's worth bar, all `not worth doing`
and none refuted — **and that is the finding this tier now carries.** OAI-94's residue was four items
enumerating output paths that feature did not touch (OAI-99's redirect `Location`, OAI-100's three
`describeFailure` sites, OAI-101's `/oai:status` provider line, and OAI-103 in tier 12); every one was
found by reading rather than by a leak, and only OAI-102 survives, because it alone is a path where the
code has already decided the value is secret. OAI-91 and OAI-92 go with them: both concern a query
string in `--base-url` reaching somewhere it is not announced, neither is wrong for a caller who does
not put a secret in a URL, and OAI-92 needs a cooperating server to fire at all. See
`BACKLOG_PARKED.md`.

**Tier 11 — residue from the OAI-61 ladder, in code that SHIPPED.** **OAI-96, OAI-97, OAI-98**. These
are last because none is wrong for a working install today, and first among equals is OAI-96, which is
the only one touching code that just landed. They are recorded rather than carried into OAI-94/95
because they belong to the capability gate, not to the withdrawn mechanisms — filing them separately is
what stops the withdrawal from becoming a place unrelated findings go to be forgotten.

**Tier 12 — residue from the OAI-94 ladder, in claims that cannot fail.** **OAI-158**.
**OAI-158 leads the tier from 2026-08-14 and is the sharpest instance of its class yet**, because it
is the class inside the guard written to end the class: `tests/backlog-structure.test.js` cannot see
six of the seven parked items, so a resurrected parked id keeps the suite green — mutation-proved
both directions. It is also one line to fix.
The class is a statement this repo makes about itself that nothing checks. **OAI-104 closed
2026-08-09** — it was the sharper of the two, and closing it removed the instance in this very file:
`tests/backlog-structure.test.js` now enforces the tier/heading invariant that was previously
promised by a script which did not exist. **OAI-103 was PARKED 2026-08-18** by the sweep's worth bar,
`not worth doing` — it is the same shape one level out (a machine-readable payload that omits the
caveats its human-readable sibling prints), but no consumer has ever been observed reading a crowded
`--background --json` reply as a clean one. See `BACKLOG_PARKED.md`.

**Tier 13 — residue from OAI-132 / OAI-140's recording half, 2026-08-13.** **OAI-151**.
**OAI-151 leads and its justification is OAI-141**, which put run-to-run spread above the differences
being compared: a per-commit reproduction rate ACROSS runs is exactly the number this tracker cannot
compute today, and the one that decides whether any sweep A/B means anything. The feedstock now exists
— every run leaves a ledger with per-commit timings and the full manifest — so this is an index over
artifacts rather than new instrumentation. It was deliberately NOT built into OAI-132: the ledger is
the within-run crash record, a history is the cross-run index, and ADR 018 gates `node:sqlite` as a
capability, so a hard dependency would have made crash protection conditional on the one thing the job
store was careful to keep optional. Neither argument applies to a cross-run index, which is not on the
crash path.
**OAI-153 and OAI-154 were PARKED 2026-08-14** by the sweep's worth bar, `not worth doing`: both were
*stated limitations rather than defects*, neither named an instance of harm that had already happened,
and the ADR that "said each one out loud" no longer exists (OAI-159). See `BACKLOG_PARKED.md`. **OAI-152 was PARKED the day it was filed**: it
states outright that it is "not measured" and already carried its own reopening bar, which is a
park-ready shape rather than an item.

**Tier 14 — what the completed overnight sweeps found, 2026-08-10/15.** **OAI-163**, **OAI-155**, **OAI-157**, **OAI-141**, **OAI-138**, **OAI-143**,
**OAI-140**, **OAI-164**, **OAI-137**.
**OAI-142 and OAI-144 were PARKED 2026-08-18** by the sweep's worth bar, `not worth doing` — a rung
flip between `prepareLadder`'s two sizing passes that no run has ever produced (and whose disclosure
half is unaffected either way), and a `finishReason === 'length'` vendor assumption filed as
UNVERIFIABLE and still unverified against any vendor. See `BACKLOG_PARKED.md`.
**OAI-163 leads the tier from 2026-08-15 because it is the only item here that can END a night, and
it does so while reporting the opposite of what happened**: a healthy model that reasons without
answering is admitted as a server outage, so three in a row abort a healthy sweep and blame the
server. It sorts ahead of OAI-155's coverage fact because coverage lost to an oversized target is
visible in the report, where this is a wrong verdict about the server that the report then repeats.
**Read it immediately beside OAI-140** — same counter, opposite error, and neither fix is safe if it
assumes the other's direction. That pairing is the reason it sits here rather than in tier 5 with the
other no-answer items.
**OAI-164 sorts near the bottom because it is a measurement to take, not a defect that is wrong
today**, and because OAI-141 already says what it would cost to take it properly: one more sweep may
still not resolve an 11-vs-6 non-answer delta against this harness's known spread. It is above
OAI-137 only because the model in question is already installed and the question is live whenever
someone picks a model.
**OAI-157 sorts directly behind OAI-155 because it is the same night's lesson at a tenth of the
cost**: OAI-155 makes an oversized target reviewable, where OAI-157 merely says so before the night
is spent, and it can land without any decision about what a finding is scoped to.
**OAI-155 leads the tier from 2026-08-14 and is the first thing here that is a COVERAGE fact rather
than a harness defect**: the 2026-08-13 sweep reviewed 31 old commits successfully and none of the
five it was launched for, two of them refused outright as oversize with nothing left for the ladder
to shed. Every other item in this tier improves what a sweep reports; this one is about work the
sweep cannot reach at all, which outranks them.
**OAI-139 (done 2026-08-12) was found by probing OAI-138, not by the sweep**: when nothing is
resident the window is unknown, the size guard returns unchecked, and `adr/005`'s drop-to-hunks
fallback therefore cannot fire — so a cold start ships untrimmed input and the failure arrives wearing
a known LM Studio symptom. It leads because it is a live correctness defect on every cold invocation,
where OAI-138 is a tuning question, and because nothing in OAI-138's fix can reach it.
**OAI-138 leads because it is the difference between a sweep and half a sweep**: 20 of 40 eligible
commits died on `--max-seconds 900`, a cap inherited from the harness's first commit whose documented
job is bounding *overshoot past the stop time*, never *fitting a review*. It also inverts OAI-115's
standing expectation — starvation happened once, wall-clock exhaustion twenty times — so the next
sweep should set the cap from the recorded `generationMs` distribution rather than by doubling it.
Read it against OAI-132, which the same run priced: a higher cap lengthens an already unobservable
window. **That half is now closed** — since 2026-08-13 the sweep writes an incremental ledger as each
commit settles, so a longer cap no longer widens a window in which a crash loses everything.
OAI-141 is second because it changes how everything else in this tier should be READ: four sweeps over
one corpus put the run-to-run spread (17 vs 22 finding-bearing, 5 of 17 not reproducing) above the
difference between the configurations being compared, so a single-run A/B here cannot resolve a small
effect. It did not invalidate the cap result, which clears that spread comfortably; it did refute the
diff-only concern, and it is why OAI-139's ceiling is safe to build.
OAI-140 sits between them because it is live at today's cap and **OAI-138's cap rise makes it worse**:
a slow commit zeroes the consecutive-outage counter, so a genuine outage interleaved with slow commits
never trips `--abort-after`, and last night's data cannot rule that out because nothing records the
counter's history. **The recording half shipped 2026-08-13** — every attempted commit now carries
`startedAt`/`endedAt` and the report renders a derived server-health section naming the longest streak
and how often a non-outage reset one. **What remains live is the ACTING half**: whether to count
outages in a sliding window, decay the counter, or leave the rule alone now that the record can finally
show whether it ever mattered. That last option is newly credible, because the question can now be
answered from data rather than argued.
OAI-137 is small, real and reproduced — `readOmlx` silently ignores `data` when `models` is an empty
array, contradicting the comment that says it does not. It is in this tier because the sweep found it
in the commit that introduced it, which is the first time this harness has caught a defect in code
written the same day.

**Tier 15 — what the model benchmark actually found, 2026-08-09.** **OAI-135**, **OAI-133**,
**OAI-131**.
**OAI-134 shipped 2026-08-09 and its framing did not survive contact**: the filed mechanism — the
plugin sizing a JIT load by `max_context_length` — was **refuted** (the plugin has no load channel at
all), and the live check that settled it also refuted the proposed blanket refusal, because oMLX 0.5.7
JIT-loads successfully where LM Studio 0.4.20 may refuse for memory. What shipped was the honest
remainder: two hints that predict no outcome. See BACKLOG_DONE.md.
**OAI-136 was PARKED 2026-08-18** by the sweep's worth bar, `not worth doing` — it had led this tier
since 2026-08-09 as the one real defect the OAI-134 ladder found in passing (`--model` bypassing the
embedding-model rejection at `model-selection.mjs:224`), but it was verified by reading the function
rather than by any observed run, no chat request has been observed reaching an embedder, and its own
part (1) says whether an explicit `--model` *should* be refused **needs its own grill**. See
`BACKLOG_PARKED.md`.
**With it gone this tier has no defect at its head, and nothing was promoted in to replace it.**
**OAI-135 now leads by position**, and the tier is what it always mostly was: a record of what the
benchmark measured. Its three members are a record (OAI-133), an answered question (OAI-131) and
OAI-135 — read the one-line usable result at the foot of this tier before any of them.
OAI-131 is **answered, not open**: `idle-timeout` was never observed across 22 failures, so the five
iterations spent admitting it bought no measured coverage. OAI-133 records that the gemma arms measured
nothing and carries the sized contexts for a future attempt, including that **`gemma-4-31b` will not
fit this machine at a fair context**. OAI-132 — the harness emitting no signal for hours at a time — **shipped 2026-08-13**; see BACKLOG_DONE.md.
**The usable result of the whole exercise is one line: use `qwen/qwen3.6-27b`** — 7 of 10 commits
reviewed in both runs, against 3-5 for the MoE, which starved exactly as OAI-115 predicted.

**Tier 16 — residue from the follow-on ladder, which also ended `cap-without-approval`.**
**OAI-125, OAI-128, OAI-126, OAI-129**. (OAI-131 was filed by this ladder but is
indexed under tier 15, where the benchmark answered it — one id, one tier entry.)
**OAI-125 leads and is the sharpest item filed today**: the resolved-SHA guarantee — the one fact the
whole pinning feature exists to provide — reaches the artifact by a single untested path, proved by a
mutation that left the suite green. Its root cause is an unexported `main()`, i.e. the shape of
`bench/run.mjs` that this harness's own header says it was written to avoid, so **the fix is a seam
rather than another test**. Until it lands, benchmark arms must pass a full SHA.
**OAI-128 is next because it is a NEW TRAP CLASS** — asserting presence where the code guarantees
presence — and the fifth "test that cannot fail" found in one feature; filing it as its own entry is
what stops the stub-fidelity entry added the same day from appearing to cover it.
OAI-126 and OAI-129 trail as one-line fixes with named remedies.
**OAI-127 and OAI-130 were PARKED 2026-08-18** by the sweep's worth bar, `not worth doing` — the
decision record promising a semantic rule the code cannot keep (OAI-122's class one level up, but its
two vocabularies agree at HEAD and no sixth timeout reason has ever been added), and a dropped
`requestedModel` its own body calls *"Low impact while every arm passes `--model` explicitly, which the
benchmark does"*. See `BACKLOG_PARKED.md`.
**OAI-131 is different in kind and should not be sorted with the defects**: two vendor assumptions with
no artifact in the repo to check them against, one of which the `serverUnwell` rule depends on — and
the overnight sweep is itself the instrument that can settle it.

**Tier 17 — what is LEFT of the overnight review-sweep ladder's residue. EMPTY as of 2026-08-18, and
kept as a closure record rather than deleted.**
Filed with seven items; **six closed on 2026-08-08** by the follow-on (OAI-118, OAI-119, OAI-120,
OAI-121, OAI-122, OAI-124 — see `BACKLOG_DONE.md`), including the two that blocked the model
benchmark. This index went on naming all seven for a day, which is the drift
`tests/backlog-structure.test.js` now exists to make impossible (OAI-104).
**The seventh, OAI-123, was PARKED 2026-08-18** by the sweep's worth bar, `not worth doing` — the
sweep's deadline is compared with `Date.now()`, so a wall-clock step could move it, but it was
stated-untested at pass 1 and has never fired; the DST boundary that WAS observed is already fixed.
See `BACKLOG_PARKED.md`. **Nothing was promoted in to keep the tier populated**, following the same
call tiers 1 and 2 record: an empty tier heading is structurally fine (`tests/backlog-structure.test.js`
parses a tier with no entry list without complaint, which tiers 1 and 2 have demonstrated since
2026-08-16), and this ladder's residue is genuinely spent.

**Tier 18 — residue from the OAI-62 ladder: seven places contention is answered by an argument, a
misdiagnosis, or a silence.** **OAI-106**, **OAI-110**, **OAI-107**,
**OAI-108**, **OAI-111**, **OAI-146**, **OAI-147**, **OAI-148**,
**OAI-160**. (**OAI-150 closed together with OAI-65 2026-08-18 (`687ed70`)** — see BACKLOG_DONE; it
joined this tier from OAI-66's review alongside OAI-149, but its precondition turned out reachable
through OAI-65's own directory-mode gap, not merely unobserved.)
**Four of this tier's members were PARKED 2026-08-18** by the sweep's worth bar, all `not worth doing`
and none refuted — and they are the four whose "never observed outside an injected test" framing was
load-bearing rather than incidental: OAI-105 (the reconciler's five unprotected writes, an exclusion
resting on an argument nothing has ever tested *against a stuck row*), OAI-109 (a rescue guard with no
witness whose one real hole the item itself proves unreachable today), OAI-145 (a claim
`spawnWorker` cannot support, whose every destructive consequence OAI-67 already contained), and
OAI-149 (whose own last line reads *"Without it this is a story about a race"*). See
`BACKLOG_PARKED.md`. OAI-160 is coverage debt in the same subsystem, filed by OAI-64's confirmation pass and
owned by nothing else — **but it was AMENDED on 2026-08-16 and one of its twelve entries is no longer
merely untested.** `displayOf`'s `dead`/`never-started` arms are reachable for an ordinary row this
build understands, not only for one a newer plugin wrote, and the note they render names the row's own
schema while attributing it to a newer plugin. It leads the tier's tail for that reason. It stays here
rather than moving up because the row it mislabels is dead or never-started: the label is wrong, and
no live work is at risk from it.
**OAI-106 leads the tier because it was the reason OAI-62 reached its ten-pass cap without approval.**
Codex refused to approve on exactly this ground: after an exhausted persistence retry the public
lifecycle still reports `worker-died` for work that completed, and no product reader can recover the
salvaged answer — a false terminal state produced by contention, which is one of the outcomes OAI-62
set out to remove. `salvageOutcome` keeps the bytes; it does not correct the verdict.
**That sentence no longer gates anything: OAI-62 was CLOSED over the objection on 2026-08-12**, and
the same day Codex reversed its own refusal when asked as a scheduling question rather than at a
verdict point. What survives is the defect itself, and OAI-106 was re-scoped so its cheap half — the
message stops asserting something false, with no new lifecycle state — is separable from the
`persistence-pending` state that may never be worth building.
The rest are last because nothing is broken today — **with the one exception noted above**, OAI-160's
mislabelled render, which is wrong right now and is why that item leads this tail: each fires only
under contention that has never been observed outside an injected test. They are here at all because ADR 020 exists to remove a
comment that claimed a property the code did not have, and each is a smaller instance of that shape —
a count restated where nothing holds it to the code (OAI-110),
a stop request with no contention policy at all (OAI-107), and a fact that reaches a human on stderr
but no machine through `--json` (OAI-108). OAI-111 is housekeeping the review fan-outs generate.
(OAI-150 was the parked OAI-149's own
sibling — a permission chain letting an attacker traverse the state directory and write `logs/` while
`jobs.db` stayed out of reach — and closed 2026-08-18 together with OAI-65, whose fix repairs that
exact permission chain unconditionally on every open. That is the one member of this shape whose
precondition turned out reachable, which is why it closed and OAI-149 parked.)

<!-- /tiers -->

### Absorbed IDs — where a merged or moved number now resolves

Every ID this file has ever issued still resolves; nothing was deleted. **Two did not until 2026-08-13** — OAI-6 and OAI-8 were cited by live bodies while resolving to no heading in any tracker, which is the broken-reference trigger a sweep exists for; both had shipped and neither was ever filed. ADRs, plans and
`BACKLOG_DONE.md` cite absorbed numbers, so this table is what keeps those references working.

| Was | Now | Why |
| --- | --- | --- |
| **OAI-30** | **OAI-28** | Now OAI-28's part (C) — its own justification is still live and unresolved, not closed; it used to be blocked from starting by the ratchet (headroom), which was closed as moot 2026-08-17, see part (A). |
| **OAI-41** | **OAI-28** | The ratchet decision that used to block OAI-28 and OAI-30 — closed as moot 2026-08-17, see OAI-28's part (A). |
| **OAI-38** | **OAI-28** | Withdrawn 2026-08-04 as a duplicate on the day it was filed; never independent. |
| **OAI-71** | **OAI-59** | One added `outcome` field, one shape-drift decision, one `/oai:result` render. |
| **OAI-6** | *shipped* | Streaming output for `/oai:task`. **Recovered 2026-08-13 by the sweep**, which found it cited by OAI-13 and resolving NOWHERE — it predates the done-file convention. Shipped: `scripts/lib/stream-collect.mjs`, and `http.mjs:157` requests `text/event-stream`. |
| **OAI-8** | *shipped* | Liveness while a run is in progress. Same recovery, cited by OAI-9. Shipped: `scripts/lib/progress.mjs`, which renders a prefill-aware elapsed line. |

Moved out of the live list rather than absorbed: **OAI-51**, **OAI-78** and **OAI-33** to `BACKLOG_DONE.md`,
**OAI-84** to `BACKLOG_DONE.md` as a SPLIT — its two repairs shipped and were verified on disk by the
2026-08-13 sweep, while its only live remainder, the withdrawn candidate-selection design, was carried
into **OAI-112**, which cannot close without it. One id, one home: read OAI-84 in the done file.
**OAI-44** to `BACKLOG_PARKED.md`. **OAI-72(c)** moved into **OAI-63** as a sub-item; OAI-72 keeps its
ID and its other two claims. **OAI-13** split: its sub-items (3) and (5) became **OAI-84** because
they stopped being vendor-dependent.

**At the sweep that built this table, item count fell far faster than byte count, and the difference
was not fixing.** 56 live items became 50, but almost nothing was discarded: four IDs were merged into
two, three moved to other trackers, one split out, and every dated observation, measurement and
decision-with-reason came with them. *(Stated as history, not a standing count — the live set has
grown far past 50 since. The lesson stands: read a shrinking item count as shorter to navigate, never
assume it means shorter work, and check the byte figures the sweep reports each time instead.)*

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
  ~~`client.mjs`~~ **`provider.mjs` (file attribution corrected 2026-08-14 against disk; `client.mjs`
  has no truncation logic at all)** truncates to 400 characters — a server whose validation dump names `response_format`
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
    Instrumenting it is **OAI-48** — *parked 2026-08-18, `not worth doing`; this limit therefore stays
    stated rather than instrumented.*
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


  **Run logs, diagnostics and the 2026-07-30 attempt moved to [`evidence/019.md`](evidence/019.md)**
  by the 2026-08-13 sweep — verbatim, nothing rewritten. That file carries: the 2026-08-04 run log
  (invocations 0-2, the drop-rate replication, the retry analysis, the two failure shapes); the
  2026-08-07/08 run log (invocations A-C and the token-exhaustion table); the diagnostics T1/T2/T3;
  and the 2026-07-30 attempt. **G-G's every-invocation rule is satisfied there, not here.**
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

- **OAI-27** — Put a security lens on the transport-classification path. **The instrument this item
  named is gone: `security-review` was retired 2026-08-13 (dotfiles `adr/100`), which folds its
  surface into `codex-adversarial`'s focus string — so this asks for that focus, not the deleted
  stage.** Filed 2026-08-01 from
  the OAI-22 ladder, where it was **evaluated and not triggered, and that call is disputed**. That
  skill's trigger list was auth/sessions, personal data, money movement, secrets and credentials, or
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

- **OAI-28** — **Give `http.mjs`'s two untested transport writes the coverage they have never had.**
  **Merged 2026-08-05 by the backlog sweep from OAI-28, OAI-30 and OAI-41** — one feature run ships all
  of it. **The ratchet was the leading half**: it was the only part of the three at its own limit (the
  guard compares with `>`, and `tests/structure.test.js` sat at exactly 300 of 300 — binding, not yet
  violated, and with zero headroom for any further edit) rather than merely *incomplete* (coverage or a
  comment not yet written), and it blocked the other two from starting by leaving no room to edit in —
  now closed as moot, see (A) below, so (B) and (C) are both unblocked.

  **(A) The ratchet, formerly OAI-41 — CLOSED as moot, 2026-08-17.** Filed 2026-08-04 as a headroom
  problem (`tests/structure.test.js` at exactly 300 of 300, `bench-reliability.test.js` at 294 of 300),
  it was never solved by a split: the user retired the ratchet mechanism outright the same day this
  note was written, so `tests/structure.test.js` no longer has a per-file or per-function line budget,
  and `ALLOWLIST` is gone. Nothing here needs headroom any more. Left in place rather than deleted, per
  this repo's convention that a plan/backlog entry records what was believed at the time.

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
  `delivered: true` is in doubt. What overclaims is its doc comment at `tests/structure.test.js:222`
  and `:230` (moved from `:279`/`:287` when the ratchet retirement deleted 57 lines above them,
  2026-08-17): "nothing behavioural can pin it" and "A test cannot make Node drop the code on demand"
  (both quoted verbatim from disk, 2026-08-05). The evidence behind those sentences is narrower than
  they are — it establishes that on Node 26.3 a real mid-body cut *happened* to carry `ECONNRESET`,
  not that no test can exercise the code-less path. **The fix is known and cheap**: drive `bodyStream`
  directly with a stub async iterable that throws a code-less error, and assert the verdict stays
  retryable — which is (B)'s "drive `bodyStream` directly" option applied one line lower. Distinct
  from (B): that is the `!response.complete` branch, this is the catch below it. Third confirmed
  instance of the class recorded in `.claude/REPO_TRAPS.md`; the other two were OAI-25's subject and
  OAI-25's own first draft.
  **Historical note, now moot:** at filing, the honest replacement comment was *longer* than what it
  replaces, in a file that then had zero headroom under the ratchet — so (A) had to be done first, and
  OAI-25's comment rewrites there were net-neutral by construction for exactly that reason. The ratchet
  is retired (see (A)); there is no headroom constraint left to sequence around.

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
  ~~`http.mjs` and `cmd-setup.mjs` were reading it~~ ~~corrected 2026-08-05 by the sweep: `http.mjs:107`
  and `http-errors.mjs:142` *mint* the field and `cmd-setup.mjs:32` is the only site that *reads* it~~
  **— that correction was itself WRONG and is corrected again 2026-08-14, verified against disk. The
  field is minted at roughly a dozen sites (`http-errors.mjs`, `provider.mjs`, `sse.mjs`, `body.mjs`,
  `chat.mjs`, `answer-attempts.mjs`, `attempt-outcome.mjs`, `attempt-ledger.mjs`) and it is READ to
  drive a decision in at least two: `attempt-outcome.mjs` `obtainedResponse` opens with
  `if (error?.serverResponded === true) return true;`, and `provider.mjs` propagates it. So
  `cmd-setup.mjs` is not the only reader, and the rename is LARGER than this item has ever said —
  which cuts against doing it, not for it.** The name predates the ledger,
  so a rename
  touches the transport, not just the record; and the documentation now carries the load correctly,
  so this buys clarity rather than fixing a defect. If it is done, `httpResponseObtained` was the
  suggested name and every recorded benchmark file under `bench/results/` carries the old key, so it
  needs the same read-both-shapes treatment the `not recorded` bucket already gives legacy records.

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
  **(1) ~~The warning itself prints the secret.~~ FIXED — verified against disk 2026-08-14 by the
  backlog sweep.** `task-submit.mjs` `noteEndpointPersistence()` now takes **no argument** and
  interpolates nothing: it describes the storage rather than the credential, because the code cannot
  know which part of a URL is a secret. The sub-claim below is kept as the record of what was wrong.
  ~~`task-submit.mjs:37-40` interpolates `profile.query`
  verbatim. Executed: `Note: the base URL's query string (?api-key=sk-SUPER-SECRET-1234) is stored…`.~~
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
  is wrong about the reading: `job-render.mjs:243` *(line moved since filing; verified again
  2026-08-17)* prints `transport.baseUrl`, which is query-free. The column holds the secret; nothing
  renders it.

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
  still the reason to want the status half — *OAI-80 was parked 2026-08-18, `not worth doing`, so this
  is a reason and no longer a dependency.* Left out of OAI-3 phase 4
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

- **OAI-70** — **Three small correctness guards on the worker's row-decoding path.**
  **(a)** `resolveCredential` never checks `auth.profile` exists: `job-auth.mjs:54` passes
  `{provider: auth.profile}` and `config.mjs:245` *(line moved; verified again 2026-08-17)* treats a
  falsy provider as "use `defaultProvider`".
  Executed — a row whose `auth` lacks `profile` **completed and sent a credential the job never named**.
  Reachable only from a forged or foreign row, but one line (`if (!auth?.profile) throw`) closes it.
  **(b)** It pairs with a real structural gap: `cmd-task-worker.mjs` consumes a decoded row and never
  calls `isKnownVersion`, where `job-queue.mjs:57` and `job-reconcile.mjs:72` both do. *(Corrected
  2026-08-13 by the sweep, and it makes this WIDER, not narrower: "the only consumer" is **false** —
  `cmd-status.mjs` and `cmd-result.mjs` skip the check too, so three consumers do.)* — and the forward-compat story explicitly contemplates a newer writer's rows in the table.
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
  **IN PROGRESS as of 2026-08-18, uncommitted:** a fix for (a) and (b) sits in the working tree —
  `scripts/lib/config.mjs`, `scripts/lib/cmd-setup.mjs`, `tests/config-mode.test.js`,
  `tests/cmd-setup-redaction.test.js`, with a plan at `plans/oai-72-config-mode-and-setup-echo.md`.
  Left LIVE rather than closed because it is not committed; close it against the commit, not this note.

- **OAI-74** — Enforce the attachment boundary for **every** caller, not just the delegate's recipe.
  **Narrowed 2026-08-05 by OAI-5's second review pass: the delegate path is now enforced.** Its recipe
  canonicalises per attachment — ~~`readlink -f`~~ **a `canon()` wrapping `realpathSync`, corrected
  2026-08-14 against disk; the recipe already made the (a) fix this item argues for below** — and
  refuses the submission when a resolved path leaves the git top
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
  needs `mktemp`, `awk`, `sleep` and `trap`. Now filed separately as **OAI-76** — *parked 2026-08-18, `not worth doing`, for naming no instance;
  it remains the second view of the boundary decision this item makes, so read it before designing one.* **Codex's adversarial
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

- **OAI-93** — **`providers.json` is created world-readable and holds the long-lived credential.**
  `config.mjs:47-48` writes the config with **no mode argument** — directory `0755`, file `0644` — and
  never chmods it, while that file can hold a literal `apiKey`. The whole job-state tree is hardened to
  `0600`/`0700` (see `adr/018`), so the *ephemeral* copy of a credential is protected and the permanent
  one is not. Pre-existing and outside the OAI-61 diff, which is why it was filed rather than folded
  in; found by that feature's `security-review` stage, which measured the modes rather than reading
  them. Fix is one `mode` argument plus a narrowing pass for configs that already exist, and it should
  reuse whatever verified-chmod helper OAI-95 lands, rather than trusting `chmod` not to throw — an
  earlier version of that helper was disproved on a FAT image, where the call silently no-ops.
  **IN PROGRESS as of 2026-08-18, uncommitted:** the same working-tree change filed against OAI-72(a)
  touches this file mode — `scripts/lib/config.mjs`, `scripts/lib/cmd-setup.mjs`,
  `tests/config-mode.test.js`, `tests/cmd-setup-redaction.test.js`, plan at
  `plans/oai-72-config-mode-and-setup-echo.md`. Left LIVE rather than closed because it is not
  committed; close it against the commit, not this note.

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
  **IN PROGRESS as of 2026-08-18, uncommitted:** the same working-tree change filed against OAI-72
  touches `config.mjs`'s refusal wording — `scripts/lib/config.mjs`, `scripts/lib/cmd-setup.mjs`,
  `tests/config-mode.test.js`, `tests/cmd-setup-redaction.test.js`, plan at
  `plans/oai-72-config-mode-and-setup-echo.md`. Left LIVE rather than closed because it is not
  committed; close it against the commit, not this note.

- **OAI-106** — **the row is still wrong about why a salvaged job ended, and the CHEAP HALF is separable
  from the expensive one.** Narrowed by OAI-62, which originally filed this as the whole defect — a
  paid-for answer lost outright — and then had both approvers reject that filing: losing the answer
  *was* contention killing live work, which is precisely OAI-62's own ask, so it was fixed in the
  ladder rather than deferred. `salvageOutcome` now writes the outcome to the job log under the fixed
  prefix `SALVAGED_OUTCOME` before the storage error propagates, so the answer survives
  (`cmd-task-worker.mjs:183`, line moved; verified again 2026-08-17).
  **RE-SCOPED 2026-08-12, when OAI-62 was closed over the objection this item carries.** It was framed
  as "a `persistence-pending` state **or** a recovery pass" — both structural, and that framing is what
  kept it expensive enough to defer indefinitely. The thing that actually made the approver refuse is
  narrower than either, and it is a **sentence**:
  **(a) THE CHEAP HALF — stop asserting something false.** `job-reconcile.mjs:79-83` publishes
  *"The worker for job X exited without recording an outcome."* That is **false** whenever a salvage
  line exists: the worker recorded its outcome and SQLite refused the write. `terminalizeDead` can
  check the log for the marker and say so — *the worker recorded its outcome to the log but could not
  persist it, see `<path>`* — in the failure message and hint. **This touches no lifecycle state**,
  adds nothing to `TERMINAL_STATES` (`job-record.mjs:17`, four values, no SQL `CHECK`), and removes the
  actual falsehood. Do this one.
  **(b) THE EXPENSIVE HALF — a state that can express it.** An explicit non-terminal
  `persistence-pending` that `/oai:result` and reconciliation both understand, or a recovery pass that
  reads the salvaged line back into the row. This is a state-machine change in the subsystem whose
  entire tier is about lifecycle misreporting, so a new state is itself a plausible source of the class
  it is meant to fix. **It may never be worth building**, and (a) does not depend on it.
  **A witness is missing for BOTH halves and is worth having regardless.**
  `tests/job-busy-placement.test.js` asserts the salvage line is written and that the row is still
  `running` immediately after — it **never drives reconciliation**, so nothing observes the row
  becoming `failed`/`worker-died`. The false terminal state has no test that can fail on it, which is
  this repo's most-repeated shape. Related: [OAI-105] *(parked 2026-08-18, `not worth doing`)*.

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
  **Enlarged by OAI-67 on 2026-08-12, and this is now the item's worst case rather than its original
  one.** OAI-67 changed the same stamp so that ANY storage fault — not only an exhausted lock
  contention — reports on stderr and still returns the id, because rethrowing lost the handle to a
  worker that may already have been spending. The `--json` channel did not change, so a submission
  made against a CORRUPT database or a FULL DISK now emits the same success envelope as a healthy one,
  where before that caller received a rejection and knew the submission was unhealthy. The trade was
  made deliberately (a lost id is unrecoverable and costs money; a silent success is recoverable by
  polling `/oai:status`), Codex and the author both recommended keeping it, and the user chose it — but
  it means **this item now covers a path that previously did signal**, not merely one that was always
  quiet. The contract fix is still the same fix, and it is still gated on the same doc-plus-test work.

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
  **RE-MEASURED 2026-08-14 by the sweep, and both numbers moved — read this before working it.** The
  counts are now **seven `withBusyRetry` sites and five `isBusy` sites**, and CLAUDE.md says "seven
  enumerated sites", which is **currently accurate**. Two things changed underneath the item: the
  guard's `documents` array is now `['scripts/lib/job-busy.mjs']` **alone**, because `adr/020` was
  deleted with the ADR corpus (`d1ad2aa`) — the deletion commit calls that *"A REAL WEAKENING"* in its
  own words, since one witness means a file and its own doc comment can now move together. So the
  defect is no longer "CLAUDE.md disagrees" but "**one witness, and CLAUDE.md still outside it**", and
  the fix is unchanged in shape while being more valuable than when filed.
  **FOLDED IN 2026-08-17 by the sweep, same shape one level out**: four more comments cite the deleted
  `adr/020` as settled policy nothing now holds to the code — `task-submit.mjs:182`,
  `cmd-task-worker.mjs:173`, `job-launch-outcome.mjs:86,105`. This item's whole subject is "a claim
  nothing holds to the code," so these are in scope for the same fix rather than a separate filing.

- **OAI-111** — **Stale git worktrees accumulate under `.claude/worktrees/`.** *(Count corrected
  2026-08-13 by the backlog sweep: **3 directories, 29M**, not the ~28 first filed — the retired
  review fan-outs stopped creating them, so the rate has fallen and the residue has not been cleared.)* Left behind
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


  **ABSORBED OAI-84 on 2026-08-13 by the backlog sweep**, whose two repairs are SHIPPED and were
  verified on disk (`structured.mjs:202`, `:242`). Only the withdrawal was still live, and it cannot
  close without this item's replacement — the merge criterion, not tidying. **Its record, evidence and
  register row are in `BACKLOG_DONE.md`; they are not restated here.** Note **OAI-114** sits inside
  this item's replacement scope, since `objects()` rejects at candidate SELECTION.
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
  **The floor now has a measured size, 2026-08-15 (qwen3.8 sweep, OAI-164).** Across the **17
  successful** reviews of that run, read from the `usage` each reply actually returned rather than
  reconstructed: `reasoning_tokens` were **87.0–98.3%** of every completion (median 95.9%), while the
  answer itself cost **205–1,116 tokens, median ~420**. The largest answer in a successful run was
  1,116 tokens. So **the reserve this item asks for is on the order of 1–2k tokens, not a fraction of
  the budget** — and every one of the run's six starvations died with a budget larger than that still
  nominally available to it. The allocation framing is confirmed by the same data: budgets ranged
  25,260–30,848 on the successes and the model simply expanded its reasoning to fill whatever it was
  given, which is T1's "a larger budget is simply consumed" observed a third time.
  **Sizing caveat carried deliberately:** the 17 are the runs that SUCCEEDED, so this measures what a
  completed answer costs, not what a starved commit's answer would have cost. It is a lower bound on
  the floor, and a starved commit reviewing more files could need more.

- **OAI-116** — **The token-exhaustion failure path emits no `attempts[]`, making G-E unpassable.**
  Filed 2026-08-08. A run lost to token exhaustion is recorded with `attempts: null`, so OAI-19's
  gate criterion G-E — "a missing or self-inconsistent `attempts[]` on any run invalidates the
  invocation" — fails for any arm containing one, whatever its recall. Since token exhaustion is now
  the dominant failure mode, **no arm can pass the gate**. Not a general defect and not longstanding:
  on 2026-08-04 all 4 failed runs carried ledgers, because those failures were transport failures,
  whose path preserves the record. It also destroys the reliability evidence exactly where failures
  are most interesting. **Blocks OAI-19**, and is likely small.
  **RECONFIRMED 2026-08-14 outside the benchmark, on the shipped default path.** The overnight sweep
  starved on four of 40 commits — `223136e` (928s), `e966c95` (947s), `bc469ce` (691s), `77c1eab9`
  (1,586s) — and all four recorded `attempts: null`, against a populated `attempts[]` on every commit
  that answered in the same run. So this is not an artifact of how `bench` invokes the CLI: **4,152
  seconds of real work left no attempt record at all**. Evidence in
  `bench/results/sweep-2026-08-13-overnight/review-sweep-2026-08-13T21-57-52-135Z.ledger.jsonl`.

- **OAI-125** — **The resolved-SHA guarantee reaches the artifact by ONE UNTESTED PATH.** Filed
  2026-08-08 from the follow-on ladder, `unresolved at cap`. **MUTATION-PROVED**: deleting just the
  `options.from =` assignment in `bench/review-sweep.mjs` leaves the suite at 766/0, after which the
  record and report print the caller's typed ref instead of the resolved commit. Two benchmark arms
  invoked identically with `--from main` days apart would then review different histories while the
  artifact claimed the same window — **the exact defect OAI-124 exists to prevent, reintroducible with
  nothing going red.** Root cause: `main()` is unexported and runs only under the
  `process.argv[1] === fileURLToPath(import.meta.url)` guard, so no test can invoke the composition.
  **This is the shape of `bench/run.mjs`** — the file this harness's own header says it was
  deliberately structured NOT to imitate, because an unguarded main is why `run.mjs` has no test at
  all. `task-run.mjs`'s injectable seams were copied for the loop and not for the composition.
  **The fix is a seam, not another test**: export the composition, or `runMain(deps)`.
  **Update 2026-08-09 — `bench/run.mjs` was worse than this item said, and is now partly fixed.**
  Its `main()` was not merely unexported: it was called **unconditionally at module scope**, so the
  first `tests/` import of that module ran a whole six-case benchmark and wrote a report and a record
  into `bench/results/`, indistinguishable from a real arm. Found by OAI-117's seam and fixed there —
  `run.mjs` now has the `process.argv[1]` guard `review-sweep.mjs:291` always had, plus one exported
  function under test. **This does NOT close OAI-125**, whose defect is `review-sweep.mjs`'s
  `options.from =` assignment reaching the artifact untested; it removes the excuse that `run.mjs` is
  the shape to copy.
  **Until it lands, every benchmark arm must pass a full SHA and the pre-flight assertion is
  load-bearing rather than belt-and-braces.**

- **OAI-126** — **A bare catch deletes the cause it was meant to report.** Filed 2026-08-08,
  `unresolved at cap`. `resolvePin` in `bench/lib/sweep-window.mjs` wraps its only git call in
  `catch { throw new UserError('--from did not resolve to a commit') }`, discarding the caught error —
  so a git **spawn** failure is reported as the revision being bad. **Reproduced against the real
  artifact at its real path**: with a PATH containing only node, `--from HEAD` printed
  `--from did not resolve to a commit: "HEAD"`, and a positive control showed
  `git rev-parse 'HEAD^{commit}'` resolves fine in the same tree. The harness's printer shows only
  `error.message` for a `UserError`, so the `spawn git ENOENT` text that named the real cause is
  deleted. One-line fix: carry the cause as the `hint`.

- **OAI-128** — **A test that asserts presence where the code guarantees presence.** Filed
  2026-08-08, `unresolved at cap`. **A NEW TRAP CLASS, distinct from the stub-fidelity entry added the
  same day.** The OAI-121 caveat tests assert `key in entry` for all five carried fields, but
  `reported()` sets every one with `?? null` — so reading the WRONG source field (`hunksOnlyTypo`)
  leaves the key present with `null` and the assertion still passes. The test verifies the SHAPE of
  the mapping, not that it read the right field. **Fifth instance of "a test that cannot fail" in one
  feature**, and the second distinct shape; belongs in `.claude/REPO_TRAPS.md` as its own entry, since
  the stub-fidelity entry would otherwise read as covering it.
  *(Half done, verified 2026-08-14: the `REPO_TRAPS.md` entry now exists — "A test that asserts
  presence where the code guarantees presence". **The test itself is unchanged**, so what is live here
  is the fix, not the filing.)*

- **OAI-129** — **The shortfall cause is still guessable at one boundary.** Filed 2026-08-08,
  `unresolved at cap`. `walked >= scanLimit` is *also* true when exactly `scanLimit` commits are
  reachable, so a repo with exactly 200 reachable commits and a 200 limit is told "the scan stopped at
  its `--scan-limit`" when raising it would find nothing. Reproduced with a stub git. **The fix was
  named by the reviewer**: request `scanLimit + 1` and record whether an extra existed — that
  separates the two causes instead of inferring one. The docstring's claim "WHICH cause, not a guess"
  is false in exactly this case.

- **OAI-131** — **ANSWERED 2026-08-09 by the model matrix: `idle-timeout` was never observed.**
  Filed 2026-08-08 as two unverifiable vendor assumptions; **(a) is now measured**, (b) is not.
  **The measurement**: 5 models x 2 executions x the same 10 pinned commits (`--from f092405`), 1200s
  per commit, whole files. Records at `bench/results/model-matrix-2026-08-08/` — **gitignored, so quote
  these figures rather than assuming the files survive.**
  **Reason codes across 22 recorded failures**: `token-exhaustion` x14, `deadline-timeout` x5,
  `empty-completion` x2, **`idle-timeout` x0**.
  **What it means for `serverUnwell`.** The rule stands — the CLI's own per-budget hint is still the
  right discriminator, and `empty-completion`, which did fire, is correctly admitted. But **the five
  iterations spent getting `idle-timeout` into the set bought no observed coverage**, while the shape
  that dominates real failures (`token-exhaustion`) is deliberately excluded as the model's budget.
  The reasoning was sound and the yield was nil — worth knowing before the next argument of that kind.
  **(b) remains unmeasured**: no reply carried both `analysisCut` and a substituted model, so that
  pairing is still only a synthetic fixture's claim.

- **OAI-133** — **The gemma arms measured NOTHING about the gemma models. CORRECTED 2026-08-09.**
  The first filing guessed the cause was "something else resident"; that was **wrong and is recorded
  here rather than quietly replaced.** Measured with `lms ps` reporting **no models loaded at all**,
  `gemma-4-12b-qat` still failed: `HTTP 400 … requires approximately 44.87 GB`. The real cause is
  **OAI-134** — the plugin JIT-loads at `max_context_length` (262144 for every model on this server).
  **Sized contexts, measured by actually loading each one** (36 GB machine):
  | model | weights | verdict |
  |---|---|---|
  | `gemma-4-12b-qat` | 7.15 GB | **loads at 61,696** — the same context the qwen arms used |
  | `gemma-4-26b-a4b-qat` | 15.64 GB | loads, but **LM Studio ignores `-c`** and pins 116,736 |
  | `gemma-4-31b-qat` | 18.85 GB | **refused at 61,696** (needs 34.45 GB of 36); loads at 32,768 |
  KV cost derived from the error and confirmed by loading: ~0.144 MB/token for the 12b.
  **`gemma-4-31b` cannot be benchmarked on this machine at a context comparable to the qwens** — that
  is a fact about the machine, and it is the finding. `gemma-4-26b-a4b` gets nearly double the qwens'
  context, so its earlier `unreadable` replies (8 of 10, then 4 of 10 — it emitted `findings` and
  `analysis` as prose rather than the requested shape) are **not** explicable as a context handicap.
  **The re-run was STOPPED BY THE USER after ~1 minute: SSD usage spiked.** Cause was almost certainly
  swap thrash, not writes — the whole first matrix wrote 364 KB. Loading and unloading 7-19 GB models
  back to back on a 36 GB machine pages heavily. **Do not re-run three models in one sitting**; one
  model per session, with `sysctl vm.swapusage` watched, and never size a context that leaves only
  ~1.5 GB of headroom.

- **OAI-135** — **The benchmark's caveat layer reports success where it cannot fail: four defects, none
  of them reachable by a diff-scoped review.** Filed 2026-08-09 from the OAI-104/OAI-117 review
  ladder's **confirmation pass** (`adr/032`), which exists precisely to look at code the ladder has not
  touched. Passes 1 and 2 read only the diff and found five and three defects, **all in the ladder's own
  fixes**; the confirmation pass read the surrounding module and found these, all **pre-existing**.
  Each is reproduced, three of them by executing the real unmodified code.
  1. **The prompt-cache caveat cannot print on the default invocation.** `caveats.mjs:87` `cacheNote`
     gates two paragraphs on a ratio needing **two prefill samples in one case**, but the default is
     `runsPerCase = 1` (`run.mjs:219`). Executed with a positive control: 1 sample → **0 of 2**
     paragraphs; 2 samples → **2 of 2**; at `--runs 3` with 1 surviving sample → **0 of 2**, so the
     gate is **sample count, not run count** — a run the server degraded (this repo measured LM Studio
     dropping ~1/3 of long requests) loses the warning exactly when it needs it. The second paragraph
     ("Generation is what the cache does not touch") **needs no ratio at all** and is bundled behind the
     same gate. `case-rows.mjs:74` justifies its `--cold`-only exclusion on the premise that "the caveats
     say so" — false on the default path, so a **behaviour is reasoned from a claim that does not hold**.
  2. **A truncated-but-parsed run is discarded, and the caveat asserts it could not exist.**
     `run-buckets.mjs:35` `truncatedRuns` filters on `finishReason === 'length'` with **no parse check**;
     `case-rows.mjs:197` then drops those runs from `scored`, and `caveats.mjs:38` explains the exclusion
     with *"the JSON never parsed, so there is nothing in them to score"* — which nothing enforces.
     **Reachable because ADR 003 removed the default schema on 2026-08-04**: without a grammar the model
     completes its JSON and keeps talking, so hitting the ceiling *after* a complete reply is the
     ordinary case now. The `cut` vs `truncated` split was sound while a schema guaranteed the JSON came
     last; **removing the schema invalidated the premise and this bucket was never revisited.**
  3. **The dropped-defects caveat mixes two units and inverts its own sentence.** `caveats.mjs:261` sums
     `listed` (distinct defects, **per case**) beside `scoreable` (`case-rows.mjs:236`:
     `listed * scored.length`, **defect-slots per case × scored runs**) and prints them as a subset:
     *"N scoreable of M listed defect(s)"*. Executed output at 3 scored runs: **"6 scoreable of 2 listed
     defect(s)"**. It has never failed a test because **every caveats test passes `runsPerCase: 1`**,
     where the two units coincide by coincidence. Reachable on any full-corpus run — `dropped` is
     non-empty for `config-origin`, `scaffold` and `model-info` — and **the sibling caveat two
     paragraphs above tells the reader to raise `--runs`**, so the report instructs you to do the thing
     that breaks it. *(Narrowed by its verifier: the trailing "smaller than the truth twice over" clause
     SURVIVES — in slot units the honest denominator is `(listed+dropped)*scored = 10 > 6`. The defect is
     purely the unit mismatch, plus understating the dropped gap by a factor of `scored.length`.)*
  4. **DONE 2026-08-09 (see below). The schema arm is captioned by what was ASKED FOR, not what happened.** `caveats.mjs:165` asserts
     *"the reply shape was enforced by a `response_format` schema"* gated on the **flag**.
     `review-request.mjs:224-232` **falls back to unconstrained** when a server rejects `response_format`
     and says so on stderr; `cmd-review.mjs:156-167` emits both facts and its own comment names the
     distinction — *"What was ASKED for, beside `structured` which is what was obtained."* **`bench`
     never reads `structured`** (`grep -rn structured bench/` returns only `structuredOutput`). Against
     oMLX, vLLM without the feature, or an older LM Studio, **both arms of the comparison are the same
     arm, labelled as different ones** — while the report instructs the reader to read one against the
     other. **Not pre-existing in the way the other three are**: the note and the flag forwarding are
     OAI-117's own. **Deferred out of the ladder deliberately, not missed** — the fix needs a new row
     field, a reduce across runs and a threaded argument (`caseRows` projects a fixed field set;
     `caveats` takes `structuredOutput` from the CLI options, never from `rows`), and it **cannot be a
     boolean**: with N runs a case can degrade on some and not others, so the caption must read
     *"requested; obtained on 2 of 3"* or it replaces one blind caption with another. Landing that in the
     ladder's **final** batch would have shipped it unreviewed, since `adr/089`'s verification pass opens
     no finding lenses.
  **ITEM 4 SHIPPED 2026-08-09**, once its cost turned out to be a tenth of the estimate: the CLI
  already emits `degraded` ("asked for, and not obtained") in the `--json` envelope, so no new fact had
  to be computed — `case-rows.mjs` counts it per run beside a `reported` denominator and
  `bench/lib/schema-degrade.mjs` prints it. **Per run, never a boolean**: a case can degrade on some
  runs and not others, and a wholly degraded arm now says **"THIS ARM DID NOT MEASURE A SCHEMA"** while
  a mixed one says it only partly did. Four mutations prove it, including the one that reinstates the
  original bug. **Items 1-3 and everything below remain open.**
  **Also here, same file, lower value:** `run.mjs:81-84` — an empty `--model=` suppresses the manifest
  fallback via `??` and is then discarded, so the harness **silently benchmarks the configured default
  and overrides a case-level model pin**, measuring a different target than the operator named; and
  `run.mjs:219` — an empty `--runs=` is truthiness-tested before conversion, so it reads as absent and
  runs 1 instead of rejecting the value. Plus one weak test: the `--cold` case never asserts `second`
  *has* a `--cache-buster`, so a `second` that dropped the flag entirely still satisfies `notEqual`.
  **The unifying class is this repo's own** — a check or claim that reports success while structurally
  unable to fail — and (1), (3) and (4) each additionally **cannot fail under the only configuration
  the tests exercise**. Fix (3) and (1) with tests at `runsPerCase > 1`, which no test currently uses.
- **OAI-137** — **`readOmlx` does not accept `data` when `models` is present but empty, though the
  comment four lines above says it does.** Filed 2026-08-10 from the overnight sweep, which reviewed
  the very commit (`1139d97`) that introduced the line. **Reproduced directly against the real
  predicate**, not argued:
  ```
  {models: [], data: [2 entries]}  ->  []          # data never reached
  {data: [1 entry]}                ->  [1 entry]   # data reached only when models is absent
  ```
  `model-info.mjs:130` is `[payload?.models, payload?.data, payload].find(Array.isArray) ?? []`, and
  `Array.isArray([])` is **true**, so an empty `models` array wins the `find` and short-circuits the
  fallback. The docstring at `:126` states *"`data` is still accepted — dropping it would swap a
  verified shape for an unverified assumption pointing the other way."* For the `{models: [], data:
  […]}` envelope that sentence is **false**.
  **Narrow envelope, and that is the argument for fixing it rather than against.** No observed server
  returns that shape today; the whole point of keeping `data` was to cover a server nobody has run
  this against. A fallback that silently does not fall back is worth less than no fallback, because
  the comment tells the next reader it is covered. **This repo's signature class** — a claim the code
  does not support — arriving inside the fix whose entire subject was vendor-shape assumptions.
  **Fix shape**: prefer the first **non-empty** array, or take the first array and fall through when
  it is empty. Either way the test must use `{models: [], data: […]}`, which no current test does —
  which is why the unit suite was green through the whole review.
- **OAI-138** — **Half the eligible corpus was lost to a per-commit cap that was never calibrated for
  it: 20 of 40 commits died on `deadline-timeout`. THE CAP HALF HAS SHIPPED; SALVAGE HAS NOT.**
  *(Status corrected 2026-08-13 by the backlog sweep, verified against disk: `review-sweep.mjs:48` now
  reads `maxSeconds: 1800` carrying the ADR 021 comment, so the decision recorded below at "CAP VALUE:
  1,800s, PROVISIONALLY" is **landed**, not pending. The sweep also confirmed **salvage-on-loss does
  not exist** — nothing under `bench/` implements it, and a length-limited completion is still actively
  EXCLUDED from scoring at `run-buckets.mjs:35-37` and `case-rows.mjs:187,197`. So what remains live
  here is salvage alone, and its design grill.)* Filed 2026-08-10 from
  `sweep-2026-08-09-overnight`, the first sweep run to completion against a decided model
  (`qwen/qwen3.6-27b`, chosen by the OAI-121 benchmark). Full disposition, and every commit is
  accounted for exactly once, per `adr/021`:
  **The disposition table, the timing distribution, the cap probes, the analysis-cap measurements and
  the corrections this item made to itself moved to [`evidence/138.md`](evidence/138.md)** by the
  2026-08-14 sweep — verbatim, nothing rewritten or summarised. That file carries the evidence for the
  cap value (1,800s, landed), the right-censoring argument, the four-commit probe, the retracted
  throughput claim and its power-state cause, and `r(prompt,completion) = 0.072` against
  `r(completion,seconds) = 0.940`. **The salvage design is what is live here; the cap is history.**
  **`--max-seconds 900` was inherited, not chosen.** It is the `DEFAULTS` value from the sweep's first
  commit (`e467be0`) and carries no comment justifying the number. Its *documented* purpose is not
  "a review fits in 15 minutes" — `adr/021` says **the deadline governs starting, not finishing**, and
  the per-commit cap exists to bound **overshoot past the stop time**. It has never been calibrated as
  a sufficient review budget, and last night is the first run to ask.
  **THE ACTUAL DEFECT: nothing bounds the reviewer's reasoning on the path it actually runs.**
  **So `--max-seconds` is not competing with a designed bound — it is the ONLY bound**, together with
  the reply reserve that `token-exhaustion` reports (which fired once in 40). `adr/003`'s
  default-off decision on 2026-08-04 was taken to stop a segfault and, as a side effect nobody
  costed, **left the wall clock as the sole governor of how long a review may think** — a role it was
  never sized for, its documented job being to bound *overshoot past the stop time* (`adr/021`).
  **The `review-schema.mjs:70-77` comment is not wrong, it is unreachable**: *"~6-9 minutes on the
  MoE and ~28 minutes on a dense 27B"* still describes the schema path faithfully. It is simply dead
  on the default path, and a reader costing the reviewer from it would conclude the reasoning is
  bounded when it is not.
  **Fix shape LEANING (user, 2026-08-10): express the relation in code, rather than tuning a
  constant** — chosen before the correction above, and it survives it, because the defect it targets
  is the *absence of any relation between the bounds*, which is now more clearly the problem, not
  less. What it can no longer mean is "derive the cap from `ANALYSIS_CEILING`", since that ceiling
  does not govern the tokens being spent. The candidates it can mean:
  a **reasoning-token budget** the default path actually enforces (there is none today);
  a **derived** `--max-seconds` from a target token count and a measured rate;
  or a **startup check** refusing a cap that cannot reach the work it authorises.
  Not decided — this is the leaning carried into the grill.
  **THE OBJECTIVE, restated by the user and it supersedes the quantile framing above: find the WORST
  CASE, then verify a cap above it lets the sweep complete.** Not "fit a distribution" — the censored
  sample cannot support that and does not need to. The experiment that answers it is **one overnight
  run on mains at a deliberately generous `--max-seconds` (~3600) over the same window**, which yields
  both halves at once: the slowest commit's real duration, and whether the corpus finishes when the cap
  is not the binding constraint. **A cap is then set above the observed worst case**, with the margin
  stated. If a commit still hits 3600 the tail is longer than assumed and the salvage candidate below
  becomes the answer rather than a bigger number.
  **DECIDED 2026-08-10 (user, with Claude and Codex agreeing): SALVAGE-ON-LOSS, *AND* RAISE THE CAP.
  They are complementary, not alternatives.** An earlier draft of this line said "not raising the
  cap", and **that was too absolute — corrected on the user's challenge.** The measurement says
  raising the cap does not **reliably** recover a lost review; it does not say it recovers none.
  `e1cc17dc9` completed at **1,518s**, which no 900s cap could ever have reached. So:
  - **A higher cap recovers the runs that merely need more time.** Cheap, one constant, available
    immediately.
  - **Salvage recovers the runs that die anyway** — on either bound, since raising the cap exposes
    `token-exhaustion` as the next ceiling. It is the part that does not rot when the model changes.
  Ruled out and kept as rejected alternatives with their evidence: raising the *reserve* alone (moves
  the run back into the wall cap) and treating a tuned constant as the whole fix. **Not yet built**:
  this session's feature budget was spent on OAI-134.
  What remains open is the **design of salvage** — two loss shapes, the labelling rule, and where the
  partial is captured — which needs its own grill.
  **FOURTH FIX CANDIDATE, and it may supersede the cap question: cap the time but KEEP THE WORK.**
  Raised by the user 2026-08-10. Today a `deadline-timeout` discards everything the run produced —
  ~14k tokens paid for, **zero bytes kept**. The plumbing is already almost there, and this is read
  off the code, not assumed: `stream-collect.mjs` accumulates into `answer` (`.content` and
  `.reasoning`), and its `onExpire` already reads `answer.content.length + answer.reasoning.length` to
  build the error message. **It knows how much text it holds and throws the text away while keeping
  the count.** Carrying `answer` out on the failure is the same move the file already makes for
  `timings`, whose comment defends exactly this reasoning ("a stream that died 50,000 characters into
  reasoning observed a real prefill and a real partial generation; throwing them away leaves the
  attempt record unable to say...").
  **The catch that ranks the options: findings come LAST.** 97-98% of tokens are `reasoning_content`,
  and the findings JSON is emitted in `content` only after reasoning completes. So a mid-reasoning
  timeout holds a large `reasoning` and an **empty `content`** — raw salvage yields the model's
  thinking and none of its conclusions, landing in the existing `unreadable` bucket rather than
  `findings`. Hence, in increasing cost:
  1. **Keep the partial in the record.** Attach `answer` to the failure and store it on the entry.
     Near-zero cost, strictly better than discarding, and a human can read what the reviewer was
     noticing. **Produces no findings.**
  2. **A salvage second pass** — the interesting one. On expiry send a short follow-up: *"here is your
     analysis so far, emit findings from it now."* The economics work **because prefill is cheap here
     and generation is not**: 3.9k-37.8k prompt tokens cost 24-261s, while generation costs 79-770s.
     Feeding ~12k tokens of reasoning back and asking for findings only (~500-1,500 tokens) should
     cost ~2-4 minutes, converting a wholly wasted 900s into real findings. **Precedent in this repo**:
     `adr/020`'s `salvageOutcome`, "so the answer outlives the row that would not take it".
  3. **Restructure so findings stream first — NO.** `adr/003` measured it: findings-first produced 112
     output tokens and one vague non-defect, because a grammar constrains generation from the first
     token. That ordering is why the reviewer finds real bugs. Recorded so it is not re-proposed.
  **Two constraints on (2), neither optional.** It is **not** findings-first — the reasoning already
  happened and the model is being asked to conclude — but that reasoning was cut *mid-thought*, so its
  conclusions may be partial and the entry **must be labelled**. `sweep-outcome.mjs` `classify`
  already carries the envelope fields that change what a reader should believe (`analysisCut`,
  `atCap`, `hunksOnly`, `dropped`, `reason`) and a `salvaged` flag belongs beside them, or `adr/021`'s
  guarantee breaks and a truncated review reads as a complete one.
  **Why this may supersede the tuning question entirely:** with salvage, `--max-seconds` stops meaning
  *"throw this away"* and starts meaning *"stop thinking and conclude"*. That is a defensible bound at
  almost any value, and — unlike a number calibrated to one model on one machine — **it does not rot
  when the model changes**, which is the failure mode every other candidate here shares.
- **OAI-140** — **A slow commit RESETS the consecutive-outage counter, so a real outage interleaved
  with slow commits never trips `--abort-after`.** Filed 2026-08-10, surfaced by Codex while pricing
  OAI-138's cap rise and **separated from it deliberately**: it is a defect in its own right, it is
  live at today's 900s cap, and folding it into a cap change would hide it.
  `review-sweep.mjs:216` is `consecutiveOutage = isOutage(entry) ? consecutiveOutage + 1 : 0;` — the
  counter is a run of **strictly consecutive** outages, and **any** non-outage zeroes it. A
  `deadline-timeout` is deliberately not an outage: that is exactly what OAI-119 asked for and OAI-120
  delivered, and it was the right fix — three slow commits must not abort a healthy sweep. **The
  overcorrection is the reset.** A server that is genuinely failing every other commit, with a slow
  commit in between, produces `outage, timeout, outage, timeout, …` and the counter never reaches 3.
  The sweep runs to its full wall clock against a dead server and reports the result as coverage.
  **Evidence it is live, not theoretical:** last night's run recorded **20 deadline-timeouts and zero
  aborts**. That was read at the time as "the OAI-120 fix held in the field" and it did — but the same
  data cannot distinguish *"no outage occurred"* from *"outages occurred and were repeatedly reset"*,
  because **nothing records the counter's history**. This is the repo's own class again: a check that
  reported success without the evidence to fail.
  **OAI-138's cap rise makes it worse and is the reason it surfaced now.** At 1,800s a single
  pathological commit can burn 30 minutes without advancing the counter, so the interval over which a
  genuine outage stays undetected roughly doubles.
  **Fix shape (not decided, and it must not simply re-admit `deadline-timeout` as an outage — that
  reverts OAI-120).** Candidates: count outages in a sliding window rather than requiring them to be
  consecutive; decay the counter instead of zeroing it; or keep the streak but record every outage so
  the report can say how many occurred and how often the streak reset. **The last one is worth doing
  regardless**, since it is what would have let last night's record answer the question at all.
- **OAI-141** — **The reviewer's per-commit output is unstable enough that ~30% of finding-bearing
  commits do not reproduce run-to-run, and every single-run comparison in this tracker was read as if
  it were a measurement.** Filed 2026-08-12 from OAI-139's replication, which was designed to answer a
  different question and answered this one on the way.
  **Four sweeps over the same 40 eligible commits, same pinned SHA, same model, same 1800s cap.** Two
  whole-file, two diff-only. Finding-bearing counts: **17, 22** (whole-file) and **19, 21**
  (diff-only). **Whole-file re-run against ITSELF reproduced only 12 of its own 17 finding-bearing
  commits** — the same number the diff-only arm reproduced.
  **So the spread between identical runs (17 vs 22, and 5 of 17 not reproducing) is LARGER than the
  difference between the two configurations anyone was arguing about.** A single-run A/B in this
  harness cannot resolve an effect smaller than that, and nothing in the tracker previously said so.
  **What this does and does not invalidate**, judged rather than asserted:
  - **OAI-138's cap result SURVIVES.** 20 commits hitting the 900s boundary exactly, against 18
    completions demonstrably needing more than 900s, is far outside this spread. Codex made the same
    call independently.
  - **The diff-only comparison did NOT survive it** and was correctly recorded as inconclusive before
    the replication existed; the replication then refuted it outright.
  - **Anything else here resting on one run against one run should be re-read**, and future arms
    should say what effect size they can actually detect.
  **The likely mechanism is already measured, not speculative:** 97-98% of every completion is
  `reasoning_tokens` on an unconstrained path with no schema (`adr/003`), so what the model attends to
  varies run to run. The same commit has completed once and starved once on identical input.
  **What "absent" means here matters and was nearly mis-recorded:** across the 10 commits where a run
  went quiet, absence usually meant **a different defect reported**, not none — so a naive
  reproduction rate understates agreement. Only 1 of 17 went clean in every re-run.
  **Fix shape (not decided).** Options: report a reproduction rate alongside any sweep comparison;
  require N>=2 runs per arm before an A/B enters this tracker as evidence; or state a minimum
  detectable effect in the pre-registration. **The cheap half is the last one** — it costs a sentence
  and would have stopped this being read as a signal for two days.
  **A FIFTH run, 2026-08-14, and it is recorded here rather than as its own item.** Same model, same
  1800s cap, whole-file, warmed rather than cold-started; 35 eligible commits overlap the arms above.
  On that overlap: **15 finding-bearing tonight against 21**, 23 total findings against 33, **14 of
  21 reproduced, and 1 finding-bearing commit was novel**. That sits inside the spread this item
  measured (17 vs 22; 12 of 17), so it is a data point, **not** a regression — and the discipline
  this item asks for is what produced that reading. **It was nearly filed as a separate defect**: at
  36 of 40 commits the partial run showed 11 against 18 with *zero* novel commits, which looked like
  an asymmetry the noise model does not predict. The last four commits removed it. **A partial sweep
  is not a small sweep — reading one is how this item's own mistake gets made again.**
  One real subtraction survives: **1 of tonight's 7 non-reproductions is a discarded answer, not a
  quiet one** (OAI-156), so a reproduction rate computed off outcomes alone understates agreement by
  at least that much.

- **OAI-143** — **`errorReport` carries none of the caveat fields `jsonReport` does, so a run that was
  CUT tells a harness nothing about what it sent.** Filed 2026-08-12, observed while verifying
  OAI-139: a review cut by `--max-seconds` returns `{error, reason, message, hint, attempts,
  requestedModel}` and nothing else. `estimatedTokens`, `hunksOnly`, `skippedUnsizedWindow` and
  `contextChecked` are all absent — so the run carrying the MOST evidence about a sizing problem is
  the one that reports least about it. Concretely: the first live reproduction attempt for OAI-139 was
  cut at 900s and its envelope could not evidence the skip either way; the claim had to be carried by
  a separate deterministic stub run. `adr/012` already argues the failure path is where the attempt
  record matters most, and the same reasoning applies to the request-shape fields. Not a wide change —
  `errorReport` needs the context `jsonReport` already receives.

- **OAI-146** — **"A detached worker is running" is asserted in many places and established in
  none.** Filed 2026-08-12, from OAI-67's gate rounds, which kept surfacing instances OUTSIDE that
  feature's diff. The `'spawn'` event proves a child was CREATED; nothing in this repo watches it
  afterwards, so every sentence saying a worker "is running", "is alive", or "is about to make a
  billable call" claims continued liveness nobody observed. OAI-67 corrected every instance it
  touched and left these, which are pre-existing and unrelated to it: `adr/020`'s site (e) discussion
  and its evidence-table row name `a busy on the SPAWNED stamp does not lose an id whose worker is
  already running` (renaming it renames a live test, which is why it survives a claim sweep twice over
  — it is quoted text, not prose), and `tests/job-busy-spawn.test.js`'s header
  ("already running and about to make a real, billable model call"). **Why it matters rather than
  being pedantry:** the same overclaim, in `task-submit.mjs`, is what made a spawn rejection destroy
  a live worker's row — OAI-67's central defect — and the shape recurred eight times inside one
  feature once anyone looked. **Cheap first step is a grep, not a redesign**, and the honest bound is
  that this is comment/ADR text, not behaviour: no code reads these sentences.
  **NARROWED 2026-08-14 by the sweep, verified against disk — it is now ONE instance, not two.** The
  `adr/020` site (e) discussion went with the deleted ADR corpus (`d1ad2aa`), and `task-submit.mjs`
  has since been corrected on its own (*"a rejection may mean no child was ever created, or a child
  that is alive"*). What remains is `tests/job-busy-spawn.test.js`'s header and test names —
  *"already running and about to make a real, billable model call"* — which is **quoted test text, so
  renaming it renames a live test**, exactly the reason this survived two claim sweeps.

- **OAI-147** — **`tests/structure.test.js`'s orphaned-doc-comment guard is blind to a file's FIRST
  function, which is where the defect it exists for is most likely to be.** Filed 2026-08-12 from
  OAI-67's review pass 3, and **measured rather than argued**. The guard tracks `seenFunction` and only
  reports once a `function` declaration has been passed (`tests/structure.test.js:69,74`, moved from
  `:120,125` when the ratchet retirement deleted 51 lines above them, 2026-08-17 — the file lost 57
  lines total, but 6 of those sat below this site), so two
  adjacent doc blocks ABOVE a module's first function are invisible to it. That is exactly the shape
  `acceptance-audit` found by eye in `scripts/lib/job-launch-outcome.mjs`, where the module's own
  contract had detached onto a one-line stderr writer and the exported function carried no docstring at
  all — while this guard ran green in the same suite.
  **Positive control, both directions, in one run:** a probe file with the adjacency placed BEFORE the
  first function leaves the guard green; the identical adjacency placed AFTER a function reddens it and
  names the line. So the guard works and its scope is wrong, which is the more dangerous shape — it
  reports success over the case it was written for.
  The `seenFunction` gate is not gratuitous: its comment says it exists so a module HEADER, attached to
  nothing on purpose, is not called a defect. So the fix is not deleting the gate but distinguishing a
  header from an orphan — the last block before the first declaration is a header only if it is the
  ONLY one there. A new module is precisely where a first-function docstring gets written, which is why
  the blind spot and the defect coincide.

- **OAI-148** — **the evidence a ladder produces does not outlive the session that produced it.**
  Filed 2026-08-12 from OAI-67's review, which spent real effort rediscovering its own work twice.
  Two concrete losses, both measured rather than supposed:
  **(a)** the MUTATION SET was never written down. OAI-67 re-ran nine mutations after every batch, but
  the set existed only in one session's context; resuming after a compaction meant reconstructing it
  from what each witness appeared to guard, and one reconstructed mutation was wrong in a way that
  mattered — it produced a SYNTAX ERROR rather than a behavioural failure, which proves a file changed
  and nothing else, and would have been recorded as a passing mutation had it not been re-examined.
  **(b)** the plan cited a ledger at `scratchpad/ledger-oai-67.md` for its round-by-round measurements.
  That path is session-local and resolves to nothing in the repo, so an auditor could not corroborate a
  single cited figure; the plan now says so instead of citing it, which is honest but not a fix.
  **The shape of the fix is a durable per-feature evidence file** — the mutation set as a runnable
  list, and the measurements the plan relies on — sitting beside the plan rather than in a scratchpad.
  **The bar for it being real:** the mutation list must be EXECUTABLE, not prose. A written list of
  mutations nobody runs is exactly the class this repo keeps legislating against, and it would decay
  faster than the code it describes.
  Related: the ladder register already survives the session (`adr/082`), which is the precedent — this
  is the same argument applied to the evidence rather than to the metadata.

- **OAI-151** — **There is no cross-run history, so no sweep can be compared with the sweeps before
  it.** Raised by the user during OAI-132's grill, 2026-08-13, as "some kind of history log using
  SQLite", and deliberately not built there.
  **Its justification is OAI-141**, which measured run-to-run spread (17 vs 22 finding-bearing commits
  on identical inputs; 5 of 17 not reproducing) *above* the difference between the configurations being
  compared. A per-commit reproduction rate across runs is the number that decides whether any sweep A/B
  means anything, and nothing can currently compute it.
  **What was settled and need not be re-derived** (ADR 022): SQLite is not more crash-durable than a
  synchronous append for the *within-run* job, and ADR 018 gates `node:sqlite` as a **capability**, so a
  hard dependency there would have made an unattended run's crash protection conditional on precisely
  what the job store kept optional. **Neither argument applies to a cross-run index**, which is not on
  the crash path and may reasonably be optional.
  **Feedstock already exists**: every run leaves `review-sweep-<stamp>.ledger.jsonl` carrying per-commit
  `startedAt`/`endedAt` and the full enumerated manifest in its header. A history would consume ledgers,
  not replace them.
- **OAI-155** — **The size ladder ends at the diff, so this repo's own large commits cannot be
  reviewed at all.** Filed 2026-08-14 from the overnight sweep. Two of the five never-reviewed
  commits were refused `oversize` in under a second: `d1ad2aa` at **128.9k estimated tokens** and
  `9883f7f` at **101.1k**, against **57.6k usable** (a 61.7k window less a 4.1k reply reserve) on
  `qwen/qwen3.6-27b`.
  **This is the ladder working, and that is what makes it filable rather than a bug report.**
  `prepareLadder` (`scripts/lib/review-ladder.mjs:60`) reaches the `hunks` rung only after the `whole`
  rung has thrown and every changed-file body has been shed, so those two figures are **the diff
  alone, with nothing left to drop**. There is no rung below it, so the refusal is honest and
  instant — and terminal.
  **The consequence is measured, not argued: the harness cannot review its own newest work.** Taken
  with three starvations (OAI-115), the split across the completed run is exact: of the five
  genuinely-unreviewed commits of 2026-08-13, **2 failed oversize and 3 starved — none produced a
  review**, while of the 35 older and smaller commits **33 did** (18 clean, 15 with findings, 1
  starved, 1 unreadable). So a sweep's coverage skews
  systematically toward small old commits, and a header reading "40 eligible" conceals that the
  interesting five were never seen.
  **Fix shape (not decided), and it is a decision rather than a patch**: a per-file rung below
  `hunks` (review each changed file's hunks alone and merge), or split the target and report N
  sub-reviews as one. Both change what a finding is scoped to, and the second changes what "a commit
  reviewed" means in every artifact this repo writes.
  **There is a cheaper repair in front of both, and the measurement is decisive.** The sweep selects
  commits by `--include scripts bench tests` but then sends the **whole** commit, so both refusals
  were mostly content the include filter had already declared irrelevant: `d1ad2aa`'s diff is
  **436,887 bytes whole and 34,800 restricted to those paths — 8%** (the rest is the deleted ADR
  corpus); `9883f7f` is **340,491 against 58,384 — 17%**. Both fit the window comfortably once
  scoped. So the first thing to try is not a new rung but **making the review honour the same
  pathspec the eligibility check uses** — a pathspec through `selectDiff`'s `listArgs` and diff
  command.
  **Do NOT reach for `--file` as the interim.** `collectTarget` (`scripts/lib/git-diff.mjs:199`)
  short-circuits on `options.file` **before** any diff selection, so `--commit X --file path`
  silently discards the commit and reads `path` from the **working tree**, returning `diff: ''` and a
  label of `N file(s)`. In a sweep artifact that would read as a review of the commit while being a
  review of today's tree — the wrong-content-under-a-right-looking-label class this tracker keeps
  filing. This entry previously recommended exactly that, on 2026-08-14, before the code was read.
- **OAI-156** — **A complete answer, in the shape the prompt asked for, is discarded because it is
  not bracketed JSON.** Filed 2026-08-14 from the overnight sweep — one commit, `9a38a2a6b`, and
  **1,245 seconds of work thrown away**.
  Nothing failed. `finishReason: "stop"`, one attempt recorded, `outcome: answered`, `usage` present,
  no truncation (`analysisCut: null`, `atCap: null`). The reply carried a well-formed findings list
  and an `analysis` section, in YAML-ish prose rather than JSON — and the sweep recorded
  `parsed: false`, `findings: null`, `summary: null`, outcome `unreadable`.
  **This is NOT OAI-112.** That item is candidate SELECTION among several bracketed runs; here there
  is no bracketed run at all, so `extractJson` has nothing to select between and `findingsShaped` is
  never reached. It is the tier's other half — the answer was given and thrown away.
  **It follows from the 2026-08-04 default** (OAI-51): the ordinary path asks for the shape **in
  prose** and no grammar compels JSON, so a prose-shaped answer is a *likely* reply rather than a
  malformed one, while the parser accepts only the bracketed form.
  **What was discarded was a REPRODUCING finding, which is what raises this above a curiosity.** Its
  first item names `scanFor`'s parameter list at that commit — `(text, from, open, close, accept)` —
  the same defect the 2026-08-11 baseline reported on the same commit, and which today's
  `json-scan.mjs:66` no longer has. The parser did not discard noise; it discarded agreement.
  **Fix shape (not decided)**: accept a `findings:` list as a candidate shape in
  `findings-candidate.mjs`, or keep the parser strict and make the instruction compel JSON harder.
  The first widens what `parseFindings` will trust; the second costs nothing and enforces nothing.
- **OAI-157** — **A sweep commits a night to a corpus it has never sized, so an impossible target is
  discovered at 08:00 rather than at 22:57.** Filed 2026-08-14, recommended by `codex-rescue` in its
  review of that night's run and adopted because the night it describes had already happened.
  **The evidence is the run itself**: the two commits refused `oversize` were refused in **under a
  second each**, on an arithmetic — estimated tokens against the served window — that needs no model
  and could have been done before the first review started. Instead it was done nine hours later, by
  hand, by a reader comparing two records.
  **Shape**: a `--plan-only` that runs everything up to the first request and then stops, emitting per
  enumerated commit — the resolved SHA, whether any prior ledger already covered it, the whole-file
  and diff-alone token estimates, which ladder rung those imply, and whether the target is reviewable
  at all. **It must run AFTER the warm-up**, or the window is unknown and every estimate it prints is
  the unsized-window case (OAI-139) rather than the one the night will run.
  **What it buys, stated as the thing it prevents**: 9h26m was spent to learn that 5 of 40 targets
  were unreachable. The same fact is a sub-second calculation. It also gives the sweep a refusal it
  cannot currently express — *this corpus contains targets no configuration of this run can review* —
  which is the only signal that would have stopped the 2026-08-13 night going ahead unchanged.
  **Related but NOT the same as OAI-155**: that item is about making a big target reviewable, this one
  about knowing it is not before spending the hardware. Either can land without the other, and this
  one is strictly smaller.
  **Coverage lookup is the one part with a dependency**: "has a prior ledger covered this SHA" is
  OAI-151's cross-run history. Until that exists `--plan-only` should print the sizing half and say
  the coverage column is unavailable, rather than growing its own second index.
- **OAI-158** — **The tracker guard cannot see six of the seven parked items, so its "live and closed
  out at once" check is blind over most of its own domain.** Filed 2026-08-14 by the backlog sweep,
  **mutation-proved**, in the guard the PREVIOUS sweep shipped (OAI-104).
  `tests/backlog-structure.test.js` `closedIds` matches `^- \*\*(OAI-n)\*\*` — the list shape — and
  `BACKLOG_PARKED.md` writes the 2026-08-13 block as `### OAI-n — parked` headings. So the guard sees
  exactly **`OAI-44`**, and is blind to **`OAI-7`, `OAI-36`, `OAI-43`, `OAI-47`, `OAI-82`,
  `OAI-152`**.
  **Positive control, both directions, in one run:** resurrect `OAI-43` as a live body in ID order and
  add it to its tier index — the suite stays **6 pass / 0 fail**, so an item can be live and parked
  simultaneously with nothing going red. Restored, still 6/0.
  **The shape is this repo's signature and the location is the sting**: the guard was written because
  the invariant it enforces had been prose naming a script that did not exist, and it found real drift
  on its first run — but its own domain query cannot reach the file that the last sweep's worth bar
  filled. A check that reports success over the case it was written for.
  **Fix is one line and a decision**: match both shapes in `closedIds`, or normalise
  `BACKLOG_PARKED.md` to one heading shape. Prefer matching both — the parked file's two shapes are a
  real history (the `### ` block carries a reopening bar per item, the older `- ` entries do not), and
  a guard should read the tracker as written rather than require the tracker to be rewritten for it.
  **Whichever is chosen, the mutation above is the test**: a parked id resurrected as live must turn
  the suite red.
- **OAI-159** — **78 citations in this file point at an `adr/` corpus that no longer exists, and 37 of
  the 99 live items depend on one.** Filed 2026-08-14 by the backlog sweep, counted rather than
  estimated: `adr/` was deleted whole in `d1ad2aa` (2026-08-13, 23 files, owner's decision).
  **This is a decision that was deferred, not an oversight** — and the deletion commit says so in its
  own words: *"agents/oai-delegate.md and BACKLOG*.md are pinned by tests and were deliberately not
  touched"*, while comment-only references elsewhere were *"left dangling as history, matching the
  convention used for the deleted routing log"*. So the convention was chosen for code comments and
  **never applied to the tracker**, which is the file where a citation is doing different work.
  **Why the tracker is not the same case.** In a comment an `adr/020` reference is provenance a reader
  can ignore. Here it is frequently the EVIDENCE: OAI-63 argues *"Against the ADR, precisely:
  `adr/014:147-152` states the rule as three origins"*; OAI-69's urgency rests on ADR 014 accepting a
  wedge *"on the stated condition"*; OAI-138's whole cap argument turns on what `adr/021` assigns the
  deadline. Those claims are now **unverifiable by a reader**, and the ones with line numbers were
  already citations into a mutable file.
  **Distinct from the two items about counts** (OAI-110, OAI-146): those are about a figure stated in
  two places drifting. This is about the referent being gone.
  **The options, and none is "rewrite 78 citations by hand"** — that is the rebasing this repo's sweep
  discipline forbids, since it re-rots within hours: (a) declare tracker ADR references historical,
  the same convention the deletion used elsewhere, and say so once in this file's header rather than
  78 times; (b) for the handful that are load-bearing evidence, replace the reference with the
  **quoted sentence** it was standing in for, which survives the file it came from; (c) restore the
  corpus. **(a) plus (b) for the load-bearing few is the cheap combination**, and (b) is the only part
  that needs judgement — it means deciding which citations are evidence rather than provenance.
  The full list of affected items, so the judgement pass has a worklist: OAI-11, OAI-13, OAI-19,
  OAI-27, OAI-39, OAI-42, OAI-45, OAI-52, OAI-53, OAI-54, OAI-55, OAI-56, OAI-59, OAI-63, OAI-64,
  OAI-69, OAI-74, OAI-87, OAI-91, OAI-93, OAI-95, OAI-101, OAI-103, OAI-105, OAI-110, OAI-114,
  OAI-127, OAI-135, OAI-136, OAI-138, OAI-141, OAI-143, OAI-146, OAI-148, OAI-149, OAI-151, OAI-153.
- **OAI-160** — **Twelve branches in the background-job display and queue modules are reachable and
  untested, enumerated by OAI-64's confirmation pass.** Filed 2026-08-14 from that pass, which was
  steered at PRE-BATCH symbols precisely because the three passes before it had reviewed only new
  code. None is a defect and none was introduced by OAI-64 — which is why they are here rather than in
  that change. `job-view.mjs` `openJobs`' null-database return and `cmd-status.mjs` `runStatus`'
  matching "none has ever been submitted" branch; `displayOf`'s `dead` and `never-started` arms,
  reachable only for a row a newer plugin wrote, which `queue-reconcile.test.js` creates but never
  renders; `noteFor`'s matching "written by a newer plugin" note; `stamp`'s `—` fallback,
  `workerField`'s "no worker registered yet", and `fields`/`renderDetail` as a whole for a **queued**
  row, since no test renders the detail view of one; `isAlive`'s `EPERM` arm; `inImmediateTransaction`'s
  ROLLBACK path, which nothing makes `decide` throw inside; `attempt`'s `isBusy` → `blocked` mapping,
  exercised only incidentally by real concurrency; `claimJob`'s `false` return, the late-arrival race
  its own comment names; and `showOne`'s "No job with id" `UserError` — the identically worded
  assertions elsewhere hit `cmd-cancel`'s and `cmd-result`'s own copies, not this one.
  **Two constants are pinned by nothing that names them:** `STARTUP_GRACE_MS` (fixtures sit ~1.5x past
  it) and `STALE_BEAT_MS` (5x past it), so either could change severalfold undetected.
  **The `noteFor` newer-plugin branch is the borderline entry, called out rather than buried:** OAI-64
  is what first puts foreign unknown-version queued rows on a bare `/oai:status` screen, and its own
  version-99 test executes `renderList` over such a row without asserting the note. Judged out of scope
  because the branch itself is untouched.
  *Enumerated by a scout against a fixed manifest, each entry checked by grepping the test tree rather
  than assumed.*
  **AMENDED 2026-08-16 from OAI-162's review — this item is no longer coverage-only, because the
  premise two of its entries rest on is FALSE.** `displayOf`'s `dead`/`never-started` arms and
  `noteFor`'s matching note are described above as "reachable only for a row a newer plugin wrote".
  They are also reachable for an ORDINARY row whose own `schema_version` this build understands, when
  only the DATABASE's `PRAGMA user_version` is too new: `cmd-status.mjs` then skips reconciliation
  entirely, so a genuinely dead worker's row is never collected and renders `dead`. Proved by
  execution against the real CLI on a seeded row — a `schema_version: 1` row with a reaped
  `worker_pid` under `user_version = 2` renders `! written by a newer plugin (row schema 1), so this
  build will not touch it.` That sentence contradicts itself in its own parentheses: it names the
  row's schema as `1`, which is exactly what this build understands, while attributing the row to a
  newer plugin. The unconditional text is `job-render.mjs`'s `noteFor`. So the work is: correct the
  branch to say which version is too new, then pin it — not merely pin what is there. This is the
  `PRAGMA user_version` / `schema_version` conflation the repo elsewhere insists on keeping separate,
  landing at the one place a user reads it.
  **Two entries above moved or aged, recorded so the item stays actionable.** `isAlive`'s `EPERM` arm
  is now `pidLiveness`'s (OAI-162) and is still reached by no test — `grep -rn EPERM tests/` returns
  nothing. **CORRECTED 2026-08-17 by the sweep — this amendment had the two constants' names
  swapped**: `grep -rn STARTUP_GRACE_MS tests/` returns **zero** hits in any test file. It is
  `STALE_BEAT_MS` that is referenced, in three test files (`abandon-record.test.js`,
  `abandon.test.js`, `abandon-transaction.test.js`) — but only as a bare comment (`// past
  STALE_BEAT_MS (60s)`) beside a numeric literal, not as an imported symbol used in arithmetic, so
  changing the constant in `job-liveness.mjs` would not turn any of those tests red. **Net effect on
  the item: unchanged** — "pinned by nothing that names them" holds for `STARTUP_GRACE_MS` (zero
  references) and, despite the comment mentions, effectively still holds for `STALE_BEAT_MS` too (no
  test would fail if it moved).

- **OAI-163** — **A healthy model that reasons without answering is recorded as a SERVER OUTAGE, and
  three in a row would abort the night.** Filed 2026-08-15 from the qwen3.8 characterisation sweep;
  claim put to Codex as a refutation request and confirmed TRUE against the code.
  The same observable behaviour — the model reasons and never emits an answer — reaches the classifier
  in **two shapes, and only one is safe**. `finish_reason: 'length'` is tagged `token-exhaustion`
  (`review-unparsed.mjs:20-43`) and becomes outcome `starved`, which `isOutage` does not admit. But
  `requireAnswer()` throws a `UserError` carrying **no `reason`** for reasoning-only output
  (`client.mjs:104-107`); `errorReport` serialises `reason: null` (`review-report.mjs:200-216`); and
  `isOutage` admits `failed && !reason` **unconditionally** (`sweep-outcome.mjs:109-112`), which
  `runSweep` then counts toward the abort streak (`review-sweep.mjs:207-210`).
  **Evidence, 2026-08-15 02:26Z, commit `caa9d85ba`:** 31,249 characters of reasoning at ~15.4 tok/s
  over 633s, then the model ended its own turn without leaving the reasoning channel. It was recorded
  as the run's **only** server outage. The server was healthy — the commits either side of it answered
  normally, and the model went on to complete 17 reviews.
  **The blast radius is not just the abort.** The report's health section fired its
  "may have done so against a server that was failing intermittently rather than a healthy one"
  caveat on a healthy server, so the morning artifact understates its own trustworthiness.
  **Distinct from OAI-140, and in the OPPOSITE direction** — that one is a real outage the counter
  never reaches; this one is a non-outage the counter does. **A fix to either must not assume the
  other's direction**, and the two should be read together before either is designed.
  **Not covered by OAI-115 or OAI-116** — checked against both bodies. OAI-115 is the allocation
  defect that produces the behaviour; OAI-116 is the missing `attempts[]` on that path. Neither says
  the resulting envelope is admitted as evidence of an unwell server.
  **Fix shape (not decided, and cheap):** the code already distinguishes these two cases — the
  reasoning-only branch runs only after the `finish_reason: 'length'` test did not hold — so giving
  that refusal its own non-null reason would classify it beside `starved` without touching `isOutage`.
  The care needed is that it must not be folded into `token-exhaustion`: they have different causes
  and `tests/review-exhaustion-reason.test.js:56-77` varies `finish_reason` alone to keep them apart.

- **OAI-164** — **Is `qwen3.8-27b-mlx` worth adopting? One run says "findings level, reliability
  worse", and one run cannot say that.** Filed 2026-08-15 from the model's first characterisation
  sweep. **This is a measurement to take, not a defect.**
  **What the release does NOT change, and this is settled:** `loaded_context_length` is **61,696** —
  identical to the outgoing `qwen/qwen3.6-27b` — against a `max_context_length` of 262,144. Same
  `qwen3_5` arch, 4bit, artifact `lmstudio-community/Qwen3.8-27B-MLX-4bit`. So the release buys
  **nothing** on the constraint that actually binds this repo, and the OAI-115 starvation mechanism
  carries over rather than being fixed by it.
  **The 8h run, `--from 8275488`, `--max-seconds 1800`, `--max-attempts 2`:** 30 attempted, 18
  reviewed, 13 findings, 6 starved, 6 failed, 1 (wrongly) judged an outage — see OAI-163.
  **On the 27 commits this run and the 2026-08-13 baseline both attempted: findings 12 vs 12 — level.
  Non-answers 11 vs 6.** Throughput 3.7/hr against 4.2/hr.
  **Why that is not yet a result, and the reason this item exists rather than a conclusion:**
  **OAI-141** puts the run-to-run spread of this harness ABOVE an effect of this size, and records
  that *the same commit has completed once and starved once on identical input*. Codex was asked
  directly whether the non-answer delta clears that spread and said it does not. So what is
  established is "this run had 11 versus 6", **not** a property of the model — exactly the
  single-run-read-as-measurement error OAI-141 was filed to stop.
  **What would settle it:** a second qwen3.8 sweep from the same pinned SHA with the same flags, and —
  per OAI-141's own instruction — **state the detectable effect size before running it**, because a
  second run may still not resolve 11 vs 6. Until then the default model stays `qwen/qwen3.6-27b`.
  Artifacts (gitignored, this machine only): `bench/results/sweep-2026-08-15-qwen38/` — report, JSON
  record, ledger, `run.sh` and `provenance.txt` recording the served id, both context figures, the
  artifact identity and the `lms` CLI commit.

- **OAI-171** — **The review ladder's own rules changed mid-run and the run followed the superseded
  copy for two batches, which is what caused two of its passes.** Filed 2026-08-15 from OAI-166.
  `~/Code/dotfiles` commit `8475d03` (2026-08-15 16:18) added a delete-only carve-out — when a stage
  adjudicates descriptive prose false, DELETE the proposition rather than rewriting it, because a
  rewrite keeps producing the next false description. OAI-166's ladder had loaded `review-ladder`
  before that commit and `feature` before `2f6fac8`, so batches 1 and 2 rewrote where they should
  have deleted, and each introduced a fresh false claim that the next pass then found. The operator
  discovered the staleness only by checking on a hunch.
  **A skill loaded into a session is a snapshot, and nothing tells the session it has gone stale.**
  Filed as a toolchain observation with no proposed fix: the obvious remedies (re-read every skill at
  every step; a version stamp compared at each invocation) each have costs this run is not evidence
  enough to judge. What the run does establish is the cost of not knowing — two discovery passes,
  roughly ten subagents and four Codex calls, spent on prose.

- **OAI-176** — **A `fork-opener` subagent's first invocation, mid-review-ladder, returned a status
  message about its OWN siblings instead of performing its assigned review.** Filed 2026-08-16 from
  OAI-167's review-ladder pass. A fork inherits the whole calling session's transcript, and the
  transcript at launch time ended with the orchestrator's own "waiting on Group A subagents" narration
  plus a `ListAgents` call showing the fork itself as `running`. The fork's reply was that same
  narration verbatim — "Still waiting on the three Group A subagents... I'll pick this back up as soon
  as they report in" — not a review of the frozen artifact it was handed. Treated as a non-clean stage
  result and retried once, per the ladder's retry rule; the retry, with an explicit instruction to
  ignore ambient waiting-status framing in the transcript, produced a real review. **Not reproduced
  deliberately, and no root cause is established** — the working hypothesis is that a fork launched
  while the orchestrator's most recent turns are themselves about waiting for sibling agents can latch
  onto that framing as if it were its own instruction, but this is one observed instance, not a
  measured mechanism. Filed as a toolchain observation for the review-ladder skill's `fork-opener`
  stage, with a candidate mitigation worth evaluating rather than assumed: a fork-opener prompt could
  open by explicitly disclaiming any waiting/status framing already in the transcript as not being its
  own task, the way the retry prompt did successfully here — but one success against one failure is
  not enough evidence to make that a standing instruction.
  **Second instance, 2026-08-17, from OAI-170's review-ladder pass — and it REFUTES the candidate
  mitigation rather than confirming it.** This launch's very first prompt already carried an explicit
  disclaiming line ("Ignore any ambient narration in this transcript about what's 'still running' or
  'waiting' from moments before this fork was spawned") — the exact mitigation floated above, tried
  proactively rather than only at retry — and the fork still returned "Waiting on notifications from
  the remaining Group A/B stages," echoing the orchestrator's own prior turn. Retried once more with a
  more forceful instruction ("Produce the actual review in this response... Do not mention waiting,
  background tasks, or other stages' status"), which worked. **Two failures, two different mitigation
  strengths, both insufficient on the first try** — the disclaiming-line mitigation is downgraded from
  untested-candidate to measured-insufficient-alone. Whatever the mechanism is, one line naming the
  framing to ignore does not reliably suppress it; what worked both times was a *retry*, not the
  content of either prompt's ignore-instruction.

- **OAI-181** — **Let a caller pick which model a delegated call uses, per call.** Filed 2026-08-17
  from a direct user request ("we should be able to specify per call what model to use"). `--model` is
  already a per-call flag on `/oai:task` and `/oai:review` (`commands/task.md:3,18`,
  `commands/review.md:21`) and reaches `planSelection` in `scripts/lib/model-selection.mjs`. **The gap
  is `agents/oai-delegate.md`**, the context-broker agent this repo's advisor-delegation path runs
  through (session focus area 1: local models as an advisor): its own text says "You do not choose the
  model: it is the provider profile's... Never pass `--model` to work around it"
  (`agents/oai-delegate.md:185-189`) — a deliberate constraint at filing, whose reason (a slow model's
  prefill making the choice moot, or a footgun being worked around) is not restated here and should be
  re-read before deciding whether it still holds. Needs a probe before a plan: whether this is a
  one-line relaxation of that agent's own rule, or whether the rule exists for a reason that a per-call
  override would defeat.

- **OAI-183** — **A worker can still send the wrong secret to the right endpoint.** Split from OAI-63
  2026-08-17 by an independent reviewer during that item's review-ladder pass, after OAI-63's own
  filed text ("Confirmed variants... an `apiKeyEnv` swap") turned out to already document this as a
  proven variant, not a hypothetical. Reproduced against OAI-63's own patched `resolveCredential`:
  `auth.profile`'s `baseUrl`/`query` stay frozen and unchanged between submission and execution, but
  its `apiKeyEnv` is repointed to a different environment variable in `providers.json` — the
  endpoint-vs-endpoint compare OAI-63 added passes (`current.baseUrl === transport.baseUrl`), and the
  worker sends whatever secret the new env var now holds to the job's original, unmoved endpoint.
  **Why this is not the same fix widened:** OAI-63's fix works because the endpoint is data already
  frozen on the row (`job.transport`) for an unrelated reason, so comparing against it costs no schema
  change. There is no equivalent already-persisted value for "the credential identity intended at
  submission" — the credential itself is deliberately never stored (`job-auth.mjs`'s own header
  comment). A pin would need either a new persisted field naming what was intended (e.g. the
  `apiKeyEnv` name or a profile fingerprint, not the secret) or a hash of the resolved key at
  submission time to compare against re-resolution — either way a `schema_version` bump and a
  migration story for rows already written, exactly the payload decision OAI-63's own "why this is not
  a batch fix" line described.
  **The live design tension a fix here must resolve first:** a worker re-resolving the credential
  fresh rather than storing it is the whole point of the current design (per the header comment above)
  — and legitimate key rotation *is* "a different secret behind an unchanged endpoint". Any
  value-identity pin that refuses on drift also refuses a rotated key, stranding every job still
  queued across a rotation event. The reproduced exploit is an `apiKeyEnv` *repoint* (the config field
  naming a different variable) rather than the same variable's value changing underneath it — which
  is the one thing distinguishable from rotation without storing or fingerprinting the secret itself:
  persist the `apiKeyEnv` **name** (never its value) in the auth policy at submission and compare names
  at resolution. That is a candidate, not a decided plan — it still needs the schema/migration
  decision above and a grill on whether name-drift is the right boundary or too narrow (it does not
  catch a literal `apiKey` value edited in place, only an `apiKeyEnv` repoint).

- **OAI-184** — **`cmd-task-worker.mjs`'s `runJob(db, seq, job)` never uses `db` or `seq`.** Found by
  Codex during OAI-63's review-ladder pass 6, on a file OAI-63's diff only touched by one docblock
  comment (`transportProfile`'s, unrelated to `runJob`) — confirmed pre-existing via `git diff HEAD`
  on that file, not introduced by that fix. Both parameters are dead inside the function body; only
  `job` is read. Left unfixed there rather than folded in, to keep that diff's "no more, no less"
  scope discipline — a signature change also touches the call site (`:214`) and needs its own check
  that nothing else (a test double, a future caller) depends on the current arity. Cosmetic, no
  behavioural effect.

- **OAI-185** — **The AUTHORIZED endpoint's own `baseUrl` can carry a secret, and a connection failure
  echoes it verbatim into the persisted job record.** Found by Codex at OAI-63's final verdict-point
  check, on a file (`scripts/lib/provider.mjs`) outside that fix's seven-file scope and untouched by
  its diff. **Reproduced with executed evidence**: a profile with `baseUrl:
  'http://127.0.0.1:1/PATH_SECRET_MARKER/v1'`, endpoint unchanged from what the job was authorized for
  (so OAI-63's gate correctly passes it through), server unreachable —
  `client.mjs`'s `chatCompletion` → `provider.mjs`'s `describeFailure` (`:64`) produces `Cannot reach
  vendor at http://127.0.0.1:1/PATH_SECRET_MARKER/v1 — connection refused.`, and
  `cmd-task-worker.mjs`'s `publishFailure` → `errorReport(error)` persists that string verbatim into
  `row.failure.message` — the same failure record OAI-65's file modes protect.
  **This is NOT the same defect class as OAI-63.** OAI-63 is "the right secret goes only to the
  endpoint it was authorized for" — an authorization-gate defect. This is "the endpoint you are
  *legitimately, correctly* talking to might itself be secret-shaped, and a connection diagnostic
  says so." No authorization boundary is crossed; the leak is the job's own already-authorized
  endpoint reaching its own failure record. `describeFailure`'s three `reword(...)` call sites
  (`:64`, `:69`, `:74`) all interpolate `profile.baseUrl`, and this same function serves the
  **foreground** CLI path too, where "Cannot reach X at Y — connection refused" quoting the endpoint
  is the entire point of the message — there is no context-free string to swap in. **Why this is not a
  quick fix, and not a scrub:** the fix needs to distinguish a *display* context (foreground, the
  operator's own terminal, echoing their own config back to them) from a *persistence* context
  (background, written into a shared failure record with its own file-mode exposure), which is a
  design decision about how transport errors carry the endpoint — structured fields versus a
  pre-formatted string, not a line edit. And regex-scrubbing `baseUrl` at the `errorReport` boundary is
  explicitly ruled out: OAI-63's own history is five rounds of that exact approach being defeated by a
  narrower bypass each time, on the same class of problem. **Do not cite "baseUrl is already shown
  unredacted elsewhere in this codebase" (e.g. `/oai:setup`) as a reason to downgrade this** — that
  argument was raised once during OAI-63's review, adjudicated wrong, and reversed: a live,
  operator's-own-terminal display is not the same exposure as a value persisted into a shared,
  longer-lived failure record.
