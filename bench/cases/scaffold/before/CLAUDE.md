# lmstudio-plugin-cc

Claude Code plugin (in the style of `openai/codex-plugin-cc`) that delegates work to local LLMs hosted in LM Studio — via its OpenAI-compatible server (`http://localhost:1234/v1`) and/or the `lms` CLI.

## Commands

- Test: `npm test` (runs `node --test`, auto-discovers `tests/`)
- No build step yet; plugin content is markdown + JSON + scripts. TODO: revisit once the first feature lands and the stack is confirmed.

## Session footguns (repeat offenders — check before hitting them)

- The shell cwd resets between Bash calls — use absolute paths.
- LM Studio's server is only up when the user has started it (app → Developer → Start Server, or `lms server start`); tests must not assume a live server — mock or skip network.
- (none confirmed yet — add as they bite)

## Grilling checklist — schema/shape forks to always surface

Universal:
- ids: type + provenance (job ids for async delegation — who mints them, where stored)
- strings vs FKs; normalisation aggressiveness
- migration story for any persisted state (job files, config)

Domain:
- Endpoint config: hardcoded `localhost:1234` vs env var vs plugin settings — and per-command model override?
- Model selection: pinned model name vs "whatever is loaded in LM Studio" vs `lms` query
- Sync vs async delegation (Codex plugin has status/result/cancel job management — do we need that for a local model?)
- Context transfer: how much of the Claude session transcript gets shipped to the local model, and token-limit handling
- API surface: raw OpenAI-compatible `/v1/chat/completions` vs `lms` CLI wrapping

## Verifying and reviewing changes

- Prove changes with the repo `verify` skill (`.claude/skills/verify/SKILL.md`).
- Review order: `advisor` → lean workflow (`.claude/workflows/review-lean.js`) per feature → built-in `/code-review` (default `medium`, ceiling `high`) once per milestone only.
- Every recurring defect class graduates from a reviewer's prompt to a structural test — size/growth is itself such a class and is guarded by `tests/structure.test.js` (ratchet allowlist; raising a ceiling is a deliberate commit that says why).
- Commit gate: tests green + verify skill passed before committing.

## Work tracker

- `BACKLOG.md` — ordered, numbered items with stable global IDs (`LMS-1`, `LMS-2`, …).
- `BACKLOG_DONE.md` — completed items, newest first.
- "Pick next item" = top of BACKLOG.md; "mark done" = move the item to BACKLOG_DONE.md with the date.

## ADRs

Architecture decisions live in `adr/` as `NNN-slug.md`.
