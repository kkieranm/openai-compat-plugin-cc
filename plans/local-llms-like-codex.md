# Use local LLMs like Codex — a direction change

Goal, in the user's words: **"I just want to use local LLMs like I use codex."**

Paired with Codex 2026-08-04. This supersedes the measurement-first ordering the backlog has been
running on: OAI-19's baseline, OAI-9's agreement signal and OAI-11's cross-model passes were all
sized to answer "is the reviewer trustworthy" before extending the plugin. That question is not the
one being asked, and today's OAI-51 finding means the thing being measured was broken anyway.

## The verdict

**Build Codex-shaped ergonomics around a local batch worker — not a miniature local Codex.**

The dividing line is prefill economics, and it is not close. A 47k-token prompt costs ~335s of
prefill on the dense model before a single token is generated. A ten-step agentic loop re-pays that
on every step. So:

- **Claude acquires context. The local model transforms or judges it.** Claude already has strong
  repository tools; one careful Claude-side selection is far cheaper than making a local model
  rediscover the repo across five slow turns.
- What transfers from `codex-plugin-cc` is the **async job model** — submit, leave, check status,
  collect a result. What does not transfer is Codex's autonomous runtime, because Codex can explore
  a repository and a local model behind `/v1/chat/completions` cannot.

Codex's one dissent from my framing, which I accept: "cannot" is not permanent. This repo has
measured the same 56.8k-token prefix at **421.7s cold against 11.5s warm**, and LM Studio now exposes
stateful conversations. That makes a 2–4 turn loop worth *measuring* before ruling out — but it is a
spike with a gate, not a foundation to build on. Stateful storage may only save resending bytes; it
is not evidence of KV reuse.

## The workload envelope, as task shapes

Budget (dense / MoE prefill): 10k tokens ~71s / ~14s; 20k ~143s / ~29s; 47k ~335s / ~67s. Generation
adds ~2–2.5 min per 2k tokens dense, ~25–40s MoE.

**In:** targeted analysis of named files; patch synthesis against explicit acceptance criteria
(validated with `git apply --check` — no schema needed); focused review of one commit; one repair
round given a specific failure; mechanical transformation over an enumerated file set.

**Out, at least initially:** "find the bug somewhere in this repo"; multi-module features whose files
are unknown; "run tests until green"; repo-wide review; anything multi-turn that starts at 40–50k
tokens, since the dense model then has only ~15k context left for reasoning, tool results and answer.

**The MoE is the default worker.** Latency changes the viable task class; the dense model is used
only where a benchmark shows enough extra correctness to pay for it.

## Stages

### Stage 0 — remove the crash (small, unblocks everything)

Drop `response_format` for long-form generation. **Removing the `analysis` field is not sufficient
and was my error**: `response_format` constrains the whole generation stream, so there is no
"unconstrained reasoning then constrained findings" in one call. CLAUDE.md already records the same
fact from the other end — the grammar stops the model closing its think block.

Replace with unconstrained generation plus **per-record loose parsing**, so one malformed item does
not destroy the whole result. Raw output stays canonical; record `parsed: complete | partial |
failed`, and a parse failure must never render as "no findings" — that is trap instance 14 wearing a
new hat.

**Gate:** repeated long generation does not crash the backend, *proved by running it*, and a parse
failure cannot render as a clean review. Note the evidence gap this closes: every crash observed so
far is in a grammar context, but no *long* unconstrained generation has been run either, so
"unconstrained is safe" is currently an untested claim — see [[untestability-claims-are-claims]].

### Stage 1 — the async vertical slice (the highest-value increment)

`/oai:task --background` → job id → `/oai:status` → `/oai:result` → `/oai:cancel`.

- Extract the logical task executor so it returns an outcome object instead of owning stdout and
  process exit.
- **Snapshot the submitted context at submission time.** A worker that reads files five minutes later
  reports on a repo state that never existed when the user delegated. Digests recorded.
- Versioned, atomic job files under a workspace-scoped data dir; never store credentials.
- Detached worker; queued/running/completed/failed/cancelled transitions; stale-PID recovery.
- **One active job per normalized server origin** — concurrent jobs destroy cache locality and
  compete for memory already at the ceiling (`estimated_peak 25.10GiB` vs `safe_ceiling 25.08GiB`).
- `agents/oai-delegate.md` — a **context broker**, not a forwarder. Its mandate is to select the
  smallest sufficient file set and make exactly one companion call. This is the piece that differs
  most from `codex-rescue`, and the difference is that Codex can read the repo itself.

  > **Correction, 2026-08-05, when this shipped as OAI-5.** "Exactly one companion call" is not
  > implementable and was never followed: submission itself refuses an oversized request, which is a
  > call, and the broker's own mandate is then to re-select. The invariant as built is **at most two
  > `task` submissions, at most one accepted job** — it bounds submissions, not Bash calls and not
  > `status`/`result` reads. The broker half of this bullet is otherwise exactly what shipped. See
  > [ADR 015](../adr/015-a-context-broker-not-a-forwarder.md). Left in place rather than rewritten,
  > per this repo's convention that a plan records what was believed at the time.

**Gate:** a job launched in one Claude session is retrievable from another, and editing source after
submission does not change what the model saw.

> **SHIPPED 2026-08-05 as OAI-3** — gate met, both halves across a real process boundary. Plan:
> `plans/oai-3-async-jobs.md`; decision record: [ADR 014](../adr/014-async-jobs.md).
>
> **Two of this document's own prohibitions were reversed at the user's direction, and the amendment
> is here rather than in the ADR alone because *What NOT to build* below is what a future reader will
> check against.** Both lines were written by me and Codex; neither came from the user.
>
> - **A queue is IN** (2026-08-04). It was forbidden to keep two model calls off one server; it
>   delivers that *and* removes the need for mutual exclusion at submission entirely, since two
>   submissions both succeed. Refusing the second would have needed the lock — the thing that has to be
>   correct — to deliver a worse outcome.
> - **SQLite is IN** (2026-08-05), via `node:sqlite`, built into Node 26.3.1, **zero dependencies**.
>   Fourteen review rounds went into building atomic publication, a never-reused queue position and
>   terminal immutability out of `wx` files and renames, and each round's fix produced the next round's
>   defect. A transaction, an `AUTOINCREMENT` and a guarded `UPDATE` answer all three.
>
> **A daemon and a web UI stay out**, and nothing about this weakens them: what was adopted is a
> library that runs inside the commands, not a process that outlives them.
>
> Two bullets above are also amended by what shipped. **"Versioned, atomic job files under a
> workspace-scoped data dir"** — the store is a database, and the dir is **global** with each row
> naming its workspace, because an id must resolve from any directory. **"One active job per
> normalized server origin"** — implemented as one active job, full stop; per-origin was not built,
> and the honest statement of the invariant is "one *background* job at a time" (OAI-54 covers the
> foreground gap). `agents/oai-delegate.md` is deferred to **Stage 1b**, tracked as OAI-5.

### Stage 2 — make bounded tasks genuinely useful

Task templates (patch synthesis, focused diagnosis, test drafting, review); context manifests and
file *slices* rather than only whole-file attachment; **estimated prefill and generation time shown
before submission**; patches and findings stored as separate artifacts beside the raw output; a small
task benchmark distinct from the review benchmark.

**Gate:** the artifacts are useful often enough that Claude verifying them costs less than Claude
doing the work.

### Stage 3 — cache feasibility spike (measurement, gated)

Per served model: cold; exact repeat; same prefix + one appended turn; four-turn append-only; the
same with tool-shaped messages. **Gate:** append-only turns process essentially the delta — or reach
first text in ≤20% of cold time — on all three repetitions, without corrupted output or eviction.

### Stage 4 — bounded read-only loop, only if Stage 3 passes

Three read-only tools (`read_range`, `search`, `git_diff`). Hard caps: ≤3 tool turns, ≤5k tool-result
tokens, ≤20–25k transcript, explicit wall clock, no arbitrary shell, no writes to the working tree.
**Gate:** it solves tasks the one-shot path misses often enough to justify the latency. Otherwise
delete it and keep the batch worker.

### Stage 5 — not scheduled

Write/test autonomy. Only after Stage 4 shows both cache reuse and a quality gain, and then only with
an isolated worktree, patch-based edits, an allowlisted command runner and a strict turn budget.

## What NOT to build

A generic ReAct/Codex clone with unlimited tools. A "safe" constrained cap just below 14k — the
measured threshold is not an API guarantee. Automatic two-pass extraction on every result. A
provider-specific tangle (`chat-completions | responses` is *configuration*, not `if LM Studio`).
Concurrent jobs against one physical server. ~~A daemon, SQLite, queue or web UI.~~ **Amended
2026-08-05 — see the Stage 1 note above: SQLite and a queue are IN, at the user's direction, and both
turned out to be the simplifying choice. A daemon and a web UI stay out.** Repo indexing/RAG
before caller-selected context is proven inadequate. Automatic patch application in the live
worktree. Parity features (transfer, hooks, rescue, adversarial-review) merely because the reference
plugin has them. Tiny generation caps on reasoning models — already observed consuming the entire
allowance without answering.

## Two-pass extraction, if ever needed

Sound, and cheaper than I assumed: the cost is `original prompt + answer`, not `original prompt × 2`
— a 10k-token answer adds ~71s dense / ~14s MoE, not another 335s. But use deterministic parsing
first, keep the corpus out of the second call, cap the extraction at 1–2k tokens, and **leave
`response_format` off until the backend defect is known fixed**.

## Consequences for the existing backlog

Most open items are sized for the measurement programme. They are not deleted, but they stop being
the ordering: OAI-19 is suspended (its own entry says so), and OAI-9/OAI-11 want a baseline that
Stage 0 will invalidate anyway by changing how replies are produced. OAI-51 becomes Stage 0.
