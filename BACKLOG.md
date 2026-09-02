# Backlog

IDs are stable and global (`OAI-n`, never reused) and never encode order — item bodies are ordered
by priority, most urgent first (owner-directed 2026-08-27), and move as priority changes. To find a
specific item, search for its exact ID rather than scanning by number, e.g.
`grep -n '^- \*\*OAI-123\*\*' BACKLOG.md`. **`tests/backlog-structure.test.js` asserts canonical item
shape and tracker integrity (no duplicate or orphaned ID) on every `npm test`** — it does not and
cannot assert priority order, which is a judgement call. Project direction and prior header
narrative are in `CLAUDE.md`'s Work tracker section; the standing N=1-per-arm methodology note is in
its Session footguns section — not here.

References to a numbered `adr/NNN` ADR name the retired ADR corpus, deleted whole in `d1ad2aa`
(2026-08-13); they are historical provenance beside a claim stated inline, not live links, and are
deliberately not rebased (rewriting each one re-rots within hours — this repo's sweep discipline).

## Items

- **OAI-230** — **`context-guard.mjs`'s 3.4 chars/token estimate under-counts CJK-dense input by ~2.6x, so
  a prompt the guard passes overflows the server.** Dated instance 2026-09-01 (evidence/013.md): a
  200,308-character prompt of distinct CJK characters was estimated at ~58,897 tokens against a
  154,624-token window and refused by LM Studio as over its context length — the refusal is now loud
  (`stream-error-frame`, OAI-229) instead of retried three times, but the guard still let it through.
  `CHARS_PER_TOKEN` was measured against this repo's code and diffs (a different population), which is
  the right default for the review flow; the gap is `/oai:task --prompt-file` on dense text. A fix is
  a design fork, not a constant: a script-aware estimate (count CJK/emoji code points near 1/token), a
  server-side count where the vendor exposes a tokenizer endpoint, or a documented limit — none is
  chosen here.

- **OAI-232** — **`/oai:setup` says the default provider "cannot run here" while `/oai:task` on that
  same provider answers.** Dated instance 2026-09-02 (OAI-231 verify step, LM Studio on :1234 with 7
  models listed): `/oai:setup` reported for `lmstudio` (default) "reachable, but `/oai:task` cannot run
  here: model `qwen3.8-27b-mlx` (defaultModel) is not served", listing `qwen/qwen3.8-27b` among the
  available ids; an immediately following `/oai:task --file scripts/lib/errors.mjs …` answered on
  `provider: lmstudio | model: qwen/qwen3.8-27b` in 27.3s. The two commands reach different
  conclusions about the same profile and server state — `cmd-setup.mjs`'s served-model check against
  `defaultModel` versus the path `/oai:task` actually took (a substitution the footer may report, or
  `planSelection` choosing a loaded model; the verify transcript was tail-truncated, so which is
  unrecorded). Observed, not diagnosed; no fix proposed here. Worth bar: a dated instance in which the
  setup command's operator-facing verdict was wrong about whether a task would run.
