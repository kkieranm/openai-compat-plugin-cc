# 016 — A task template is three things, and the third is the one that matters

Date: 2026-08-05. Status: accepted. Supersedes nothing; consumed by OAI-9 and OAI-11.

## The problem

`/oai:task` is generic by construction: it carries no opinion about what the model is being asked to
*do*. OAI-5 shipped the ergonomics — `agents/oai-delegate.md` picks the files and keeps both the
reading and the reply out of the calling session — but it is equally opinion-free. So every
advisor-shaped call re-invented its own prompt, and the three things that make an advisor useful
were re-derived per caller and drifted.

`/oai:review` was the one exception, and describing it accurately mattered more than it looked.
Its "template" is **split across two surfaces**: `review.mjs` owns the question (`REVIEW_RULES`) and
the reply shape (`ANALYSIS_FIRST`/`FINDINGS_FIRST`), while the caller's duty lives partly in
`commands/review.md` and partly in `review.mjs:176` — the line printed *with every rendering*. That
split is the precedent this decision follows, and the printed-with-every-rendering half is the part
that generalises.

## The decision

**A template is three things: a prompt skeleton, an expected output shape, and the discipline the
caller owes the result.** `scripts/lib/task-template.mjs` owns all three for a named template, and
`/oai:task --template <name>` selects one. The first and only name is `advisor`: a second opinion on
an approach — not a defect hunt, which `/oai:review` already does with its own pinned question.

The third is the one that matters. A judge template returning a confident verdict without carrying
"these are unverified claims from a small model, check them against the code" has made the output
*worse* than the raw reply, because it now reads as adjudicated.

### The whole skeleton goes in the SYSTEM message

Not a stylistic choice. `requestTextOf` (`prompt.mjs:46`) recovers "what this job was asked to do" by
slicing after the last `--- END FILE: ` marker, and `job-render.mjs:47` takes the first line of that
as `/oai:status`'s excerpt. A skeleton wrapped around the user's prompt would therefore replace the
user's own request in that summary with boilerplate identical on every templated job — a
plausible-looking wrong answer, which is the shape this repo keeps having to unpick. Verified on a
live five-file job: the excerpt reads the user's sentence.

This forces one refusal. `--system` replaces the default system prompt wholesale and a template
supplies its own, so the two write one slot with nothing to arbitrate. **`--template` with
`--system` is refused** rather than one silently winning: a silent winner means the model was framed
one way while the command line says another. Refusing is reversible; changing a silent winner later
would not be.

### No parsing, no schema

The reply shape is asked for **in prose and never parsed**, and nothing in the output asserts the
reply conformed. [ADR 003](003-structured-findings.md) is the reason: a `response_format` grammar
segfaults LM Studio at ~14k generated tokens. `parseFindings` is findings-shaped by construction and
has exactly one production caller, so reusing it was never available either — which also means this
work had **no sequencing dependency on OAI-84**, contrary to the assumption it was filed with.

The template's honesty comes from never claiming a check it does not perform.

### The size caveat, and what it may not claim

The measured bracket is a 1,680-token single-file request that produced a checkable finding against a
49,378-token whole-tree request that returned **zero**. A template whose natural use attaches a large
set is a template that produces silence, so `advisor` carries `softCeilingTokens: 8000` and a request
above it is **answered with a caveat**, never refused and never silently trimmed. The ceiling is a
**heuristic anchored between two runs that differ in far more than size** — not a measured threshold,
and the caveat's wording claims no more than that.

It must not offer to explain an **empty** answer: `requireAnswer` throws in both renderings before any
note is written, so such a caveat would be unreachable in exactly the case it named. It says *thin or
shallow*.

`templateNotes` has **three** size states, not two — above, below, and *not recorded*. Folding "not
recorded" into "below" would render a large request identically to a small one, which is trap
instance 14 wearing a new hat. The reachable case is a row whose build persisted the pair
differently; a row written before templates existed carries no `template` and returns earlier. That
precondition was stated wrongly in the first draft and a review caught it.

### Both renderings, one builder

`/oai:task` and `/oai:result` print the same notes from one `templateNotes` call, mirroring how
`renderTaskFooter` is shared. REPO_TRAPS instance 16 is this repo showing a caveat on one of two
renderings of one run — inside the module written to prevent it.

`cmd-result.mjs` reads the template and the size from **`job.request`**, the frozen submission-time
request, not from the outcome: both are facts about what was *asked*, and the worker never needs to
know either. They are persisted **only when a template was selected** — `estimatedTokens` is always
in hand, so persisting it unconditionally would change every ordinary task's DTO, and
`withoutUndefined` cannot strip a defined value. An optional field inside the `request` payload needs
no `USER_VERSION` bump, which a new column would ([ADR 014](014-async-jobs.md)).

A name this build does not recognise gets a **generic** discipline note rather than silence — losing
the unverified-output line on exactly the reply whose template cannot be vouched for is the wrong
failure. Its wording says the job *records* a name, never that a template was *applied*: those differ,
and asserting the latter would be a message whose stated precondition differs from what happened.

### A template never chooses files

Fork (b) is designed out rather than arbitrated. The template contributes the question, the shape and
the discipline; file selection stays entirely the broker's. `agents/oai-delegate.md` passes
`--template advisor` when the work is a second opinion, and **keeps** its own unverified-claims rule:
it never pastes the model's reply, so the note `/oai:result` prints stays in the broker's session and
the agent's own sentence is the only copy that reaches whoever acts.

### A lens is a parameter, not a template

Decided now and deliberately **not built**. OAI-11's correctness / security / edge-case passes share a
skeleton, an output shape and a discipline; only the "what to look for" sentence differs. Three
templates would triplicate legs two and three. `--lens` enters when OAI-11 needs it.

## What this cost, and the part worth remembering

Two review passes, 11 adjudicated entries, dual approval. **Every defect found was in the plumbing,
not the design** — the template design survived four Codex plan-gate rounds and drew nothing
afterwards. The findings were: a nine-line shell fragment, a four-line object lookup, and three tests
that could not fail.

The sharpest was a test that passed while the feature was broken. The delegate recipe used
`${template:+--template "$template"}` unquoted, relying on field splitting for two words. **zsh does
not split unquoted expansions**, so it produced the single argument `--template advisor` and the
companion refused it — every delegate advisor submission failed. The guarding test ran `sh -c` and
was green. zsh is the shell these recipes actually run in.

So `tests/delegate-template.test.js` now extracts the recipe's real block as one unit and runs it
under **every shell present, with zsh required** — declared in CLAUDE.md rather than discovered,
because a suite that silently shrinks its shell matrix has stopped being able to fail. The fix also
had to carry `before_files=$#`: once the template occupies two positional slots, an attachment guard
comparing `$#` against 0 would pass with no files at all — a containment guard disarmed as a side
effect of a correctness fix elsewhere.

Related: a bare `TEMPLATES[name]` accepted `--template toString`, ran with the *default* prompt, and
printed `undefined` where the discipline belongs. A closed set has to be closed against the prototype
chain.

## Known limits

- `/oai:result`'s footer still hardcodes `contextNote: null`, so a background run never shows
  "context window unknown" where the foreground one does. **Pre-existing**, verified unchanged by
  this work, filed as OAI-85 — fixing it needs `budget` persisted.
- The delegate recipe's containment machinery — `canon`'s `--` injection defence, its control-character
  refusal, and the `"$root"/*` boundary — has **no test anywhere**, proved by mutation. Filed as
  OAI-86. `tests/delegate-template.test.js` stubs it deliberately and now says so rather than
  claiming coverage that does not exist.
- The 8000 ceiling has never been measured against a task-shaped corpus. It is a placeholder that
  behaves conservatively, and a small task benchmark (Stage 2's remainder) is what would replace it.
