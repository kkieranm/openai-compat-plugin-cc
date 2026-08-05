# OAI-83 — the advisor task template

provenance: harness slug splendid-puzzling-steele

## Context

`plans/local-llms-like-codex.md` Stage 2 is "make bounded tasks genuinely useful", and its first
piece is task templates. OAI-5 shipped the *ergonomics* — `agents/oai-delegate.md` selects files and
keeps both the reading and the reply out of the calling session — but it is deliberately generic: it
carries no opinion about what the model is being asked to **do**. So every advisor-shaped call
re-invents its own prompt, and the three things that make an advisor useful (a fixed question, a
fixed reply shape, a fixed standard of evidence) are re-derived per caller and drift.

`/oai:review` is the one exception and the shape to copy — but the probe corrected how it is usually
described. Its "template" is **split across two surfaces**: `review.mjs` owns the question
(`REVIEW_RULES`) and the reply shape (`FINDINGS_FIRST`), while the caller's duty lives partly in
`commands/review.md:31-41` and partly in `review.mjs:176`, the line printed *with every rendering*.
That split is the precedent this plan follows.

Outcome: `/oai:task --template advisor` becomes a thing you invoke instead of a prompt you rewrite,
and OAI-9/OAI-11 get a stable template identity to consume.

## What is in scope

The advisor template and the forks it forces. **The rest of Stage 2 stays filed** — context
manifests, file slices, pre-submission time estimates, separate patch/finding artifacts, and a task
benchmark are not this feature.

## Probe results (verified, do not re-derive)

Codex confirmed all five load-bearing claims TRUE against the real files:

1. `buildMessages` (`prompt.mjs:27-34`) emits exactly two messages — system, then one user message of
   FILE blocks followed by the prompt. `--system` **replaces** the default wholesale; there is no
   composition point, and `task-execute.mjs:123` passes it straight through with nothing refusing a
   conflicting pair.
2. `requestTextOf` (`prompt.mjs:46`) recovers "what the job was asked to do" by slicing after the
   **last** `\n--- END FILE: ` marker. Skeleton text wrapped around the user's prompt would leak into
   `/oai:status`'s excerpt. **This is what forces the whole skeleton into the system message.**
3. `TASK_SPEC` (`cmd-task.mjs:15`) is the authoritative flag list, and `tests/plugin.test.js:90,99`
   asserts `commandFiles() == Object.keys(SPECS)` and that every spec flag appears in its markdown
   (right-anchored, so `--template-name` would not document `template`).
4. **`parseFindings` has exactly one production caller, `cmd-review.mjs:15`.** The task path parses
   nothing — `task-report.mjs:46` prints `requireAnswer(...)` as prose. **So this feature does not
   collide with OAI-84**, which changes that parser. No sequencing dependency.
5. `tests/structure.test.js` — `DEFAULT_MAX_LINES = 300`, `ALLOWLIST` is **empty**, comparison is `>`,
   and the file is itself at **exactly 300**. `tests/task.test.js` is at 299, `tests/helpers.mjs` at
   298. **New tests need a new file.** Markdown is not size-measured.

Also established: `prepareRequest` already computes and returns `estimatedTokens`
(`delegate.mjs:167`), `executeTask` returns it in the outcome (`task-execute.mjs:159`), and
`jobById` parses the `request` JSON column — so `/oai:result` can read what submission froze without
a worker change.

## Grill decisions (settled with the user)

- **What it asks for**: a second opinion on an approach — not a defect hunt (that is `/oai:review`)
  and not failure diagnosis. Reply shape: **strongest objection / assumed without evidence / what I
  would check first**.
- **Surface**: `--template <name>` on `/oai:task`, not a new command and not agent prose.
- **When the attachment set is large**: answer anyway, and **carry the reason in the output**. Never
  silently drop a file; never refuse on a threshold the repo itself calls a heuristic.
- **Lenses**: a lens is a **parameter** of a template, not a template of its own. Decided now,
  recorded in the ADR, **built when OAI-11 needs it** — no `--lens` flag in this feature.

### Fork (b) — how a template composes with the broker

Declared in scope and answered here rather than left implicit. **A template never implies a file
set.** The advisor template contributes the question, the reply shape and the discipline, and
contributes *nothing* to file selection, which stays entirely the broker's — so the "which wins when
a template implies a file set" conflict is designed out rather than arbitrated.

That leaves one real gap the probe found: `agents/oai-delegate.md:119-120` submits
`task --background "$@" --prompt-file …` where `"$@"` is only the accumulated `--file` pairs, so
**the agent built to be the advisor caller would not pass `--template advisor`** and invoking a local
advisor would still mean typing the flag by hand. So the agent is one of the edits below: it gains a rule
that when the delegated work is a *second opinion on an approach* — as opposed to an analysis or a
transformation, which it also takes — it inserts `--template advisor` before `"$@"`.
`tests/plugin.test.js` already guards `agents/`, so this is a checked surface.

**Its existing unverified-claims instruction is KEPT, not replaced.** My first draft dropped it as
duplicated. The Codex re-challenge showed that would lose the duty entirely:
`agents/oai-delegate.md:186` forbids the broker from pasting the model's full reply, so the discipline
line `/oai:result` prints stays **inside the broker's own session and never reaches whoever acts**.
The agent's own sentence is the only copy that crosses that boundary. So the agent keeps it, and
gains a rule to relay the template's discipline note upward when a template was used.

## Decisions I am making in the plan (not grilled — correctness/convention)

- **`--template` with `--system` is refused.** Both write the one system slot and nothing currently
  arbitrates. A silent winner is this repo's most-repeated defect class ("reported state must
  describe what will actually happen"). Refusing is one branch, honest, and reversible — a
  composition rule can be added later, whereas changing a silent winner is a breaking change.
- **No parsing, no schema.** ADR 003: a `response_format` grammar segfaults LM Studio at ~14k
  generated tokens, which is why structured output is opt-in. `parseFindings` is findings-shaped by
  construction. The reply shape is asked for **in prose and never parsed**, and nothing in the output
  asserts the reply conformed. The template's honesty comes from never claiming a check it does not
  perform.
- **The whole skeleton goes in the system message**, leaving the user's prompt byte-identical.
  Forced by probe finding 2 — it keeps `/oai:status`'s excerpt showing what the user actually asked.

## Design

### New module: `scripts/lib/task-template.mjs`

The registry and the notes, in one place, mirroring how `review.mjs` owns the question and the
caveats for the review path.

- `TEMPLATES` — `{ advisor: { system, softCeilingTokens, discipline } }`. `system` is terse and
  negative in the house style of `REVIEW_RULES`: it pins the role (judge an approach, not the code),
  the three-part reply shape, and the prohibitions (no rewriting the code, no praise, never invent
  file contents, say plainly when the files given are not enough to judge).
- `resolveTemplate(name)` — returns the template, or throws `UserError` naming the known names.
- `templateNotes({ name, estimatedTokens })` — returns the note lines both renderings print. It has
  **three** size states, not two:
  - `estimatedTokens` above `softCeilingTokens` → the **size caveat**, worded as a statement true
    wherever it is emitted: the request was large, and a **thin or shallow** answer may mean the model
    was swamped rather than that there was little to say.
    **It must not claim to explain an *empty* answer.** Caught by the blind Codex re-challenge, and it
    is this plan committing the trap it cites elsewhere: an empty answer never reaches either
    rendering — `task-report.mjs:46` and `cmd-result.mjs:31` both throw first — so a caveat promising
    to explain emptiness is unreachable in exactly the case it names. No caveat is added to those
    error paths either: `requireAnswer` failing loudly is already the honest outcome, and trap 14 is
    about *not* converting a loud failure into a valid-looking result, not about decorating it;
  - `estimatedTokens` below it → no caveat;
  - **`estimatedTokens` absent** (an older persisted row, a partial write) → a distinct "the request
    size was not recorded, so this cannot say whether it was large" note. Without this third state a
    large run whose figure is missing renders **identically to a small one**, which is trap 14's
    shape in the module added to prevent it.
  - the **discipline line**, always. Worded for whoever eventually *acts*, not for the immediate
    reader: `/oai:result`'s `allowed-tools` is `Bash(node:*)` with no `Read`, so a line telling its
    reader to go check the code instructs something that command cannot do. "…before anyone acts on
    it" is true on both paths; `commands/result.md`'s "do not act" rule is left intact and
    `allowed-tools` is **not** widened.
  - Returns `[]` when no template was used, so the ordinary `/oai:task` path is byte-identical.

`softCeilingTokens` is set at **8000** and the ADR states it as a heuristic anchored between the two
measured points (1,680 tokens → a checkable finding; 49,378 → nothing), **not** a measured threshold.
The boundary is `>` — strictly above 8000 caveats, exactly 8000 does not — matching how the size
ratchet in `tests/structure.test.js:55` compares against its own budget, so the two conventions agree.

## Plan gate

Codex **APPROVED** this plan at round 4 (`VERDICT: APPROVE`, verified through
`~/Code/dotfiles/tests/check-plan-gate.sh --approved`, exit 0). Rounds 1–3 returned
`CHANGES-REQUIRED` and produced five findings, all folded in above; round 3 was a blind re-ask and
found the unreachable-caveat defect the threaded rounds had missed.

### Threading — eight small edits across seven files

| File | Change |
|---|---|
| `scripts/lib/cmd-task.mjs:15` | add `'template'` to `TASK_SPEC.valueFlags` |
| `commands/task.md` | document `--template` (required by `plugin.test.js:99`) |
| `scripts/lib/task-execute.mjs` (`prepareTask`) | resolve the template; refuse `--template` + `--system`; pass the template's `system` into `prepareRequest`; return `template` in the prep object |
| `scripts/lib/task-execute.mjs` (`executeTask`) | **propagate `template` from `prep` into the returned outcome.** Found by the Codex plan challenge: `executeTask` builds a *new* object with a fixed field set (`result, profile, model, budget, estimatedTokens, durationMs, ledger`), so without this the foreground path silently renders no notes at all while the background path renders them |
| `scripts/lib/task-report.mjs` (`report`) | print `templateNotes(...)` after the footer |
| `scripts/lib/job-request.mjs` (`persistRequest`) | persist the template **name** and `estimatedTokens` — **both gated on a template having been selected**, not added unconditionally (see below). `task-submit.mjs:55` passes the whole `prep`, so both are in hand |
| `scripts/lib/cmd-result.mjs` (`writeAnswer`) | print the same `templateNotes(...)` from `job.request` |
| `agents/oai-delegate.md` | **keep** the existing unverified-claims rule at `:188` — it is the only instruction that makes the broker's upward summary label claims as unverified — and *add* two things: pass `--template advisor` when the delegated work is a second opinion, and relay the template's discipline note upward (fork (b), above) |

**Why persist into `request` rather than add a column**: `job-store.mjs` tracks two versions
separately — a new *column* bumps `USER_VERSION` and makes every older build refuse the whole
database, while an optional field *inside* the `request` payload needs no bump and is ignored by
older builds.

**Both fields are gated on a template being selected.** Caught by the Codex re-challenge: `prep`
*always* carries `estimatedTokens`, so adding it unconditionally would change **every** ordinary task
DTO, and `withoutUndefined` would not strip it because it is defined. The claim "an ordinary task's
DTO is unchanged" is only true if persistence adds the pair `template`/`estimatedTokens` **only when
`prep.template` exists**. `prep.template` holds the stable **name**; the resolved registry object is a
separate value and is never persisted.

**The default system prompt is untouched.** A template supplies an *alternative* system message only
when `--template` is given, so `DEFAULT_SYSTEM_PROMPT` and every run without the flag are unchanged.
Checked against the one test that is sensitive to this — `tests/task.test.js:196` notes "the exact
estimate shifts with the system prompt wording" — and it runs no template, so it is unaffected. New
templated tests must assert the *contract* (both figures named) rather than a hard-coded estimate,
for the same reason.

**Why both renderings**: REPO_TRAPS instance 16 — "a second rendering of the same run must carry
every caveat the first does", which this repo got wrong *inside the module built to prevent it*. Both
call one function, so they cannot drift.

### New test file: `tests/task-template.test.js`

Forced by the ratchet — `structure.test.js` is at 300/300, `task.test.js` at 299, `helpers.mjs` at
298, and none can absorb a line. Covers:

- `--template advisor` puts the skeleton in the **system** message and leaves the user message's
  prompt text byte-identical. **The assertion must read `prepareTask`'s output** (or the CLI through
  `runCompanion`), never `buildMessages` called directly with the template's system text — a test
  written the obvious direct way cannot observe a mutation *in `prepareTask`*, so it would stay green
  and the step-5 mutation would have to be reported as "nothing went red". Assert `requestTextOf` on
  the user message `prepareTask` built still returns exactly the prompt;
- `--template` with `--system` refuses, and the message names both flags;
- an unknown template name refuses and names the known ones;
- `templateNotes` emits the size caveat above the ceiling, omits it below, emits the distinct
  "size not recorded" note when the figure is absent, and emits the discipline line in **all three**
  cases;
- the size caveat **does not claim to explain an empty answer** — a guard on the one path that
  cannot render it, so the wording cannot silently regress into a promise the code cannot keep;
- the notes `task-report` prints and the notes `cmd-result` prints are the same for one run — the
  trap-16 guard;
- **a templated FOREGROUND run actually emits the notes** — the propagation Codex found missing. A
  resolver-and-threshold unit test cannot catch it, so this assertion runs the foreground path end to
  end (existing `tests/task.test.js` fixtures via `runCompanion`, asserted from the new file);
- the persisted DTO carries the template **name**, not the registry object;
- no template ⇒ no notes, and the persisted DTO carries **neither** `template` nor `estimatedTokens`
  — the assertion that keeps "an ordinary task's DTO is unchanged" honest.

## Verification

1. `npm test` — full suite green (`node --test` scoped to `tests/**/*.test.js`; the scope is
   load-bearing, see CLAUDE.md footguns).
2. The repo `verify` skill (`.claude/skills/verify/SKILL.md`) — tests, a real plugin load, and a
   delegation round trip.
3. **Mutation check** of the key invariant. The invariant is *the skeleton must not reach the user
   message*, because that is what silently corrupts `/oai:status`. Mutation: make `prepareTask` pass
   the template text as a prompt prefix instead of as `system`. **The guarding test must run through
   `prepareTask`** or the mutation is invisible to it (see the test list above). Prove the mutation
   landed with `~/Code/dotfiles/tests/mutation-landed.py`, run the suite, **name the failing test**,
   restore, and prove the restore by `diff` against the backup — never by eye.
4. A real end-to-end run against LM Studio if it is up, both foreground and `--background` →
   `/oai:result`, confirming the discipline line appears in **both** renderings. If LM Studio is not
   running, say so rather than claiming it passed.

## What this does not do

No `--lens` flag. No second template. No parsing of the reply. No context manifests, file slices,
time estimates or task benchmark — all still filed under Stage 2.
