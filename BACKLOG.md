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

- **OAI-231** — **A `stream-error-frame` sweep row renders as a bare code beside `stream-unfinished`, with no
  `REASON_PARAGRAPHS` entry.** Raised twice by the OAI-229 review ladder (pass-1 fork-opener, pass-3
  closer) and held as a widening beyond that plan, so it is the owner's call: `bench/lib/sweep-report.mjs`'s
  `reasonSuffix` prints `the review failed (`stream-error-frame`)` and `bench/lib/reason-notes.mjs`
  has no paragraph for it, so the morning reader sees a stream-named code next to a delivery failure
  while the reason is deliberately excluded from `serverUnwell` and RESETS the outage streak — the one
  accepted cost of OAI-229's design, explained nowhere in the report. Both recommendations agree: **add
  the entry plus its `tests/bench-reason-notes.test.js` row** (Claude: the cost is acceptable only if
  visible; Codex: an immediate follow-on documenting an already-shipped deterministic classification and
  its otherwise-hidden streak consequence, consistent with the worth bar's purpose though in tension with
  its dated-instance letter). Codex's proposed paragraph, current behaviour only: the server refused the
  request inside an HTTP 200 stream before any content or reasoning text arrived — typically a context
  overflow or a rejected sampling value on LM Studio; not retried because resending would meet the same
  refusal; not counted as a server outage, and like any non-outage row it resets a live outage streak;
  the next commit may still fare better.
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
