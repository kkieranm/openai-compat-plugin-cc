# openai-compat-plugin-cc

Claude Code plugin (in the style of `openai/codex-plugin-cc`) that delegates work to models on any
OpenAI-compatible server — LM Studio, oMLX, Unsloth Studio, or anything else serving
`/v1/chat/completions`.

Architecture: providers are config data, never code paths — `commands/*.md` shell out to
`scripts/oai-companion.mjs`, which resolves a profile from `~/.config/oai-plugin/providers.json` and
makes one `fetch` call. See [ADR 001](adr/001-generic-openai-compatible-plugin.md).

## Commands

- Test: `npm test` (runs `node --test`, auto-discovers `tests/`)
- Load the plugin in a scratch session: `claude --plugin-dir /Users/kieran/Code/openai-compat-plugin-cc -p "/oai:setup"`
- No build step; the plugin is markdown + JSON + ESM scripts.

## Session footguns (repeat offenders — check before hitting them)

- The shell cwd resets between Bash calls — use absolute paths.
- **Never `spawnSync` in a test that talks to the in-process fake server** — the sync spawn blocks
  the event loop, the server can never answer, and the run hangs until the client timeout (cost: one
  204-second suite). `tests/helpers.mjs` `runCompanion` is async for this reason; `await` it.
- `new URL('localhost:1234')` **parses** (scheme `localhost:`, null origin) — URL parsing alone does
  not validate a base URL, so `normalizeBaseUrl` also checks the protocol is http(s).
- No model server is installed on this machine. Tests must stay network-free (fake server on an
  ephemeral port); for manual end-to-end runs use a stub server rather than assuming a live model.
- Plugin command markdown needs `allowed-tools: Bash(node:*)` or the companion call fails at runtime.

## Grilling checklist — schema/shape forks to always surface

Universal:
- ids: type + provenance (job ids, once async delegation lands — who mints them, where stored)
- strings vs FKs; normalisation aggressiveness
- migration story for persisted state (the providers config, and any future job files)

Domain:
- Provider selection: config profile vs ad-hoc `--base-url` vs auto-detect by probing ports
- Model selection: pinned in config vs whatever is loaded vs JIT-load by name
- Sync vs async delegation, and whether a job model is warranted yet
- Context handling: fail loud vs truncate vs chunk; where the window figure comes from
- How much Claude session context is shipped to a local model, given small windows

## Verifying and reviewing changes

- Prove changes with the repo `verify` skill (`.claude/skills/verify/SKILL.md`).
- Review order: `advisor` → lean workflow (`.claude/workflows/review-lean.js`) per feature →
  built-in `/code-review` (default `medium`, ceiling `high`) once per milestone only.
- Every recurring defect class graduates from a reviewer's prompt to a structural test — size/growth
  is itself such a class and is guarded by `tests/structure.test.js` (ratchet allowlist; raising a
  ceiling is a deliberate commit that says why). `tests/plugin.test.js` guards the markdown command
  surface, which nothing else notices when it rots.
- Commit gate: tests green + verify skill passed before committing.

## Work tracker

- `BACKLOG.md` — ordered, numbered items with stable global IDs (`OAI-1`, `OAI-2`, …).
- `BACKLOG_DONE.md` — completed items, newest first.
- "Pick next item" = top of BACKLOG.md; "mark done" = move the item to BACKLOG_DONE.md with the date.

## ADRs

Architecture decisions live in `adr/` as `NNN-slug.md`.
