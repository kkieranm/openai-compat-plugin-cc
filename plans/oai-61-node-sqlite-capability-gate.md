# OAI-61 — capability-gate `node:sqlite` so the plugin loads on the runtimes it declares

provenance: no harness plan-mode slug — this feature ran in an autonomous session where the user
delegated the step 3 sign-off to Codex (2026-08-06). The plan gate below is Codex's `APPROVE`, not a
user `ExitPlanMode`. Recorded here so the disposition ledger can say which of the two forms closed it.

## The defect, as verified rather than as filed

`scripts/oai-companion.mjs:2-8` statically imports every command module, so the whole module graph
links before any command dispatches. `scripts/lib/job-store.mjs:13` is
`import { DatabaseSync } from 'node:sqlite'` at top level, and `package.json:8` declares
`"node": ">=18.18"`. On a runtime without `node:sqlite`, **every** command dies at load with
`ERR_UNKNOWN_BUILTIN_MODULE` — including `/oai:setup` and `/oai:review`, which never open a database.

Probe results:

- All five cited claims returned TRUE from Codex's independent read (thread `019fd755`).
- **Reachability is EXECUTED, not argued.** An ESM `resolve` hook that makes `node:sqlite`
  unresolvable was run against the real entry point on this machine's Node v26.3.1:
  `node probe.mjs no-sqlite.mjs scripts/oai-companion.mjs setup` died with
  `Error: No such built-in module: node:sqlite / code: 'ERR_UNKNOWN_BUILTIN_MODULE'` before dispatch.
- **The threshold in the tracker item is wrong, and wider than filed.** The item says `node:sqlite`
  "arrived in Node 22.5". It did — but it stayed behind `--experimental-sqlite` until **v22.13.0**
  (and **v23.4.0** on the 23.x line), confirmed against `nodejs.org/api/sqlite.html` after Codex
  raised it. So the broken range is **18.18–22.12 and 23.0–23.3**, not 18.18–22.4.
- **`node:sqlite` is the only post-18.18 dependency in `scripts/`.** A scout audited all 60 `.mjs` files
  against every post-18.18 builtin, global and syntax form I could enumerate; the only hit is
  `job-store.mjs:13`. So `>=18.18` becomes an honest declaration once this one import is gated.

## The fork, and how it was settled

**(A)** raise `engines` to the real floor and refuse everything, versus **(B)** gate the capability so
only background jobs need the newer runtime.

Codex settled it as **B** (thread `019fd758`), and agreed with the argument that collapses the fork:
**A cannot produce a clear message on its own.** `package.json` is `private: true` and is never
`npm install`ed for a Claude Code plugin, so `engines` is documentation that nothing enforces; and a
version guard at the top of `oai-companion.mjs` would never execute, because ES imports are hoisted and
the graph links before the entry body runs. The mechanism that yields a good error message *is*
deferred importing — the same mechanism as B. So the real question is only whether non-job commands
keep working, and refusing them would be policy rather than technical necessity.

**Capability detection, not a version comparison** — and the 22.13 correction is what makes this
decisive rather than stylistic: a `process.version` check would *pass* on 22.5–22.12 while the import
still throws, and would also mis-refuse a build compiled without SQLite.

### Scope narrowed against Codex's first recommendation

Codex initially wanted a second change: converting dispatch to a uniform dynamic-import loader map.
I argued that is speculative generality, and it agreed (thread `019fd75d`, `VERDICT: AGREE-NARROWED`):

- There are exactly **two** `new DatabaseSync` sites in shipped code — `openStore()` and
  `openStoreForReading()`, both in `job-store.mjs`. One guard covers every path *by construction*.
- Once `job-store.mjs` no longer throws at link time, the static chain is harmless.
- Codex confirmed by reading `job-view.mjs` that there is no bypass around those two constructors.
- Asked to name a concrete present-day failure the restructure prevents, it named none.

## Phases

### Phase 1 — the capability guard (`scripts/lib/job-store.mjs`)

Replace the static import with one caught top-level dynamic import, cached at module scope, plus a
shared `requireDatabaseSync()` helper that both constructors call.

- Module scope rather than lazy, because both store-opening functions are **synchronous** and their
  callers (`openJobs()` and up) would all have to become async for no benefit. Top-level `await` makes
  `job-store.mjs` an async module; its importers are awaited by the loader, which is fine for a CLI.
- Catch **only** the unavailability shape (`ERR_UNKNOWN_BUILTIN_MODULE`, or a
  `Cannot find module`-class failure naming sqlite). Any other import failure must stay an unexpected
  failure rather than being laundered into "your Node is too old".
- The error is a `UserError` (exit 1, no stack) with a `hint`, since `errors.mjs` already carries that
  shape and `oai-companion.mjs:31-35` already renders it.

Message and hint:

> Background jobs need `node:sqlite`, which this Node.js <version> does not provide.
> Run the plugin on Node.js 22.13 or newer (23.4+ on the 23.x line). `/oai:setup`, `/oai:review` and
> foreground `/oai:task` work on this runtime.

**Superseded during the review ladder** (recorded rather than rewritten, so the plan stays a record of
what was decided when). The hint above is wrong on a runtime that is *already* past the floor, which
is the case that actually reaches it most often: telling a v26 user to run 22.13 is advice that cannot
help them. Adversarial review raised it; the shipped hint names the floor and then names the two ways
a newer runtime can still lack the module. The same age framing was reproduced in phase 3's command
docs and in ADR 018, and was corrected in all three surfaces together — see `adr/018`. The plan's
other superseded item is phase 2's file: the tests were extracted to
`tests/runtime-capability.test.js` at the leave-it-clean checkpoint rather than left in
`tests/plugin.test.js`.

**Ordering is load-bearing, in both functions.** In `openStore()` the capability check runs before the
two `mkdirSync` calls, so an unsupported runtime fails without creating state directories it will
never use — raised at the plan gate and folded in. In `openStoreForReading()` it must run **before**
the `existsSync(path)` check. That function returns `null` to mean "no database exists, nothing to
report", and rendering unavailability as `null` would report a missing capability as an *absence of
jobs* — trap instance 14 in `.claude/REPO_TRAPS.md`, the `findings: null` versus `[]` class this repo
has filed four times (OAI-84, OAI-59, OAI-70, OAI-68). Codex independently flagged the same ordering.

### Phase 2 — the guard that cannot silently stop failing (`tests/plugin.test.js`)

Two fixture modules in the flat `tests/` convention already used by `helpers.mjs` / `job-helpers.mjs`
(named `.mjs`, so `node --test "tests/**/*.test.js"` does not discover them as tests):

- `tests/no-sqlite-hook.mjs` — a `resolve` hook throwing `ERR_UNKNOWN_BUILTIN_MODULE` for `node:sqlite`.
- `tests/no-sqlite-register.mjs` — registers it, for `node --import`.

Then one test that spawns the **real entry point at its real path** under that hook and asserts both
sides of the boundary:

1. A non-job invocation still links and dispatches — asserted on the dispatcher's own usage error for
   an unknown command, which proves the **graph linked** with no network and no filesystem state.
2. `status` fails **exit 1** with our message, and its output contains neither
   `ERR_UNKNOWN_BUILTIN_MODULE` nor `Unexpected failure:`.
3. The `status` case doubles as the **positive control that the hook is active** — without an active
   hook it would not fail at all.

Assertion (2) is also independent of whether the machine running the test has a `jobs.db`, precisely
because the capability check precedes the existence check — so the test exercises phase 1's ordering
decision rather than just its message.

Async `execFile` only. `tests/structure.test.js` forbids a synchronous spawn outright, and
CLAUDE.md records the 204-second hang that rule came from.

### Phase 3 — say what is true where a reader looks

- Keep `engines: ">=18.18"`. It is now honest for everything but background jobs, and raising it to
  22.13 would refuse working commands. The *capability* requirement is stated where it binds.
- `commands/status.md`, `commands/result.md`, `commands/cancel.md` and the `--background` section of
  `commands/task.md` get one line naming the runtime requirement.
- `adr/018-a-capability-not-a-version.md` records the decision: why capability detection rather than a
  `process.version` comparison (the 22.5–22.12 flagged window is the case a version check gets wrong),
  why the fork collapsed onto deferred importing, and why the dispatch restructure was declined.
- `CLAUDE.md` gains one present-tense line naming `requireDatabaseSync` and linking that ADR.

## Verification

- `npm test` green (requires `zsh` on PATH per CLAUDE.md).
- The repo `verify` skill: real plugin load plus a delegation round trip. LM Studio is up on :1234, so
  the round trip runs against a real model rather than the stub.
- **Mutation, on the feature's key invariant**: replace the dynamic-import machinery in
  `job-store.mjs` with a valid static `import { DatabaseSync } from 'node:sqlite'` — a *replacement*,
  not a duplicate binding added alongside, which would leave the guard intact and prove nothing. Prove
  the mutation landed with `~/Code/dotfiles/tests/mutation-landed.py`, run the suite, name the failing
  test, restore, re-run green, and diff against the backup.
  **Corrected after the plan gate:** an earlier draft claimed the *non-job* assertion is the sole
  detector and that the `status` assertion "fails either way". That is wrong, and Codex caught it. The
  full `status` assertions also catch this mutation, because the expected `UserError` message
  disappears and `ERR_UNKNOWN_BUILTIN_MODULE` appears in its place. Only an exit-code-alone check on
  `status` would be non-discriminating — which is the reason phase 2 asserts on the *message* and on
  the absence of the raw builtin error, not merely on exit 1.

## What this does NOT prove, stated rather than left implicit

The ESM hook proves the **import graph** is gated. It does **not** prove the plugin runs on Node 20:
this machine has only v26.3.1, no nvm/fnm/volta, and the user declined a Node 20 download. So the
22.13 floor stays **cited** (nodejs.org) and the *reachability and the fix* are **executed** (hook).
Anything claiming general Node 18/20 compatibility would need a real old runtime; the scout's API
audit is evidence for that claim but not proof of it.

## Risks

- **Async module conversion.** `job-store.mjs` gains top-level await, so every importer is
  loader-awaited. Expected to be invisible; the suite is the check.
- **Over-broad catch.** Mitigated by matching the unavailability shape only.
- **Hook realism.** The hook simulates *unresolvable*, which is what an old runtime does. It does not
  simulate 22.5–22.12's flagged-but-present state — where the import also throws, by a different
  code. Worth one assertion tolerant of both shapes rather than pinned to one string.

---

## Disposition ledger (review ladder, step 6)

Recorded here because the ladder did **not** reach its verdict point — see "Ladder state" below.

**Pass 1** — `E1` plan file-list incomplete; `E2` a mutation-discrimination claim of mine that was
simply wrong (Codex caught it); `F1` (high) rethrowing an unrecognised import failure at module scope
reintroduced OAI-61's own blast radius *inside the feature built to remove it*; `F2` (medium) the hint
told a v26 user to upgrade to 22.13; `L1` `--background` paid real round trips and announced a stored
credential before refusing; `L2` a branch whose only trigger was a shape the fixture invented.
All fixed in the pass-1→2 batch.

**Pass 2** — `N1` a reachable `throw null`; `N2`/`N3`/`N6`/`N7` four evidence overstatements in the ADR
the previous batch had just written (a `node:quic` analogue described as a direct observation, dropped
hedges, "all 36 files" where there are 60, "Verified: five HTTP round trips" that nothing counted);
`N4` age framing in four command docs; `N5` a superseded plan section; `C1`/`C2` **the harness could
not run on Node 18.18–22.4 — the exact range this feature restores**, because it hard-coded
`--no-experimental-sqlite` (22.5+) and `module.register` (18.19/20.6); `W1` an assertion that could not
fail; `W2` `openStore`'s own guard untested; `W3` the credential claim still false via
`DatabaseTooNewError`, which returned `L1` to open. All fixed in the pass-2→3 batch.

**Pass 3** — `Q1` the "36" figure surviving in this plan after the ADR was corrected; `Q2` a dead
fixture branch; `Q3`/`Q4` two assertions with no independent mutation, deleted; `Q5` **dismissed** —
flagged as masked, but a named mutation (an error message interpolating the base URL) reddens it
alone, later confirmed when it fired independently under the S1 control; `Q6` a flat claim about
`/oai:setup`, `/oai:review` and foreground `/oai:task` that no test executed; `Q7` the
`if (!sqlite.DatabaseSync)` branch left deliberately unexercised and stated as such;
`S1` **(high, executed)** the notice warning about a credential *printed the credential*;
`S2` an indicative notice after `insertJob` depending on surviving to report a row;
`SR1` **(medium, measured)** `jobs.db-wal` born `0644` on a first-ever open, holding the query string,
the prompt and every attached file. All fixed in the pass-3→4 batch.

**Filed to the backlog, out of OAI-61's scope** — `SR2`: `provider.mjs` `assertOk` embeds 400 chars of
a server's error body into the persisted `failure` column, rendered by `/oai:status`. A proxy that
echoes the request URI in a 4xx page puts `?api_key=…` into durable state. Requires a cooperating
server. `SR3` (`http.mjs` echoing a full URL) is unreachable behind `normalizeBaseUrl`'s protocol
check — dismissed, noted only in case that validation is relaxed.

### Ladder state — NOT closed

Pass 3 ran `acceptance-audit`, `advisor-opener`, `codex-adversarial` (APPROVE, 0 findings),
`codex-plain` (clean) and `security-review`. **`lean-wide` and `advisor-closer` did not run, and the
verdict point was not reached** — stopped on budget, at roughly 2.4M subagent tokens against this
repo's recorded ~1.7M one-feature-per-session baseline. The pass is therefore **incomplete**, which
blocks approval: every entry stands at `pending verification`, none at `verified`.

What IS proven independently of the ladder: 630 tests green, size ratchet clean, the key-invariant
mutation re-run and certified after each batch, and the repo `verify` skill passed all four steps
including a live delegation round trip and a live background job lifecycle against LM Studio.
