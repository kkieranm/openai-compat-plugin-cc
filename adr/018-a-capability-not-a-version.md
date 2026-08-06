# ADR 018 — A capability, not a version

**Status:** accepted, 2026-08-06 (OAI-61)

## Context

`package.json` declares `"node": ">=18.18"`. `scripts/lib/job-store.mjs` imported `node:sqlite`
statically, and `scripts/oai-companion.mjs` imports every command module statically, so the whole
graph linked before any command dispatched. On a runtime without that builtin, **every** command died
at load with `ERR_UNKNOWN_BUILTIN_MODULE` — `/oai:setup` and `/oai:review` included, which never open
a database. Reproduced on this machine by making `node:sqlite` unresolvable, and later by the simpler
`node --no-experimental-sqlite`, which removes it from the builtin registry outright.

The obvious repair — raise the declared engine and print a clear message — **cannot work on its own**,
and that is what collapsed the design fork. This package is `private: true` and is never
`npm install`ed for a Claude Code plugin, so `engines` is documentation nothing enforces; and a
version guard at the top of the entry point would never execute, because ES imports are hoisted and
the graph links before the entry body runs. The mechanism that yields a good message *is* deferred
importing. So the real question was never "which mechanism" but "once the import is deferred, do the
unrelated commands keep working, or do we refuse everything" — and refusing them would have been
policy, not necessity.

## Decision

**Detect the capability; never infer it from `process.version`.** `job-store.mjs` performs one caught
dynamic import at module scope and classifies the failure at first use in `requireDatabaseSync()`,
which `openStore`, `openStoreForReading` and `submitTask` all call before touching the filesystem or
the network.

The version is not a usable proxy, and this is the measured reason rather than a stylistic preference:

- `node:sqlite` landed in **v22.5.0** but stayed behind `--experimental-sqlite` until **v22.13.0**
  (**v23.4.0** on the 23.x line), confirmed against `nodejs.org/api/sqlite.html`. A version comparison
  therefore **admits 22.5–22.12**, where the import still throws.
- A build compiled without SQLite, or a process started with `--no-experimental-sqlite`, lacks the
  module at **any** version. The flag case was executed here on v26.3.1. The compiled-without case was
  **not** observed for `node:sqlite` on this machine — it was observed for `node:quic`, on a build with
  `node_use_quic === false`, and carried across as an analogue on the argument below that the `node:`
  scheme raises one code for every kind of absence. That is an inference from an executed neighbour,
  not a direct observation, and it is written that way here because the whole subject of this ADR is
  not claiming a capability you have not verified.

`engines` stays at `>=18.18`. An audit of all **60** `.mjs` files under `scripts/` (59 in
`scripts/lib`, 1 top level) found `node:sqlite` as the only post-18.18 usage, so the declaration is
honest once this one import is gated. Raising it to 22.13 would refuse commands that demonstrably work.

That audit's coverage is **bounded by its method, and the bound is not cosmetic**. It enumerated a
list of candidate APIs — `node:test`, `util.parseArgs`/`styleText`, `fs.globSync`, `Object.groupBy`,
`Promise.withResolvers`, `process.getBuiltinModule`, the `WebSocket` global, `AbortSignal.any`, import
attributes, the RegExp `v` flag, iterator helpers, `Array.fromAsync`, `using` declarations — grepped
for each across all 60 files, then read every hit in context, and separately enumerated every distinct
`node:*` module actually imported. What it **cannot** catch: computed or aliased access that never
spells the API name, behavioural changes to APIs that add no new symbol, and any API absent from the
candidate list. So this is **evidence that `node:sqlite` is the only violation, not proof of it** —
the hedge the plan carried, restored here after a review found it had been dropped in transfer.
(A prior version of this paragraph said "all 36 files", which was wrong under every reading; the
conclusion survived re-enumeration against the real 60, the coverage figure did not.)

### `ERR_UNKNOWN_BUILTIN_MODULE` is the only accepted shape

An earlier draft also accepted `ERR_MODULE_NOT_FOUND`/`MODULE_NOT_FOUND` when the message mentioned
sqlite. A review refuted the claim justifying it: the `node:` scheme resolves against the builtin
registry alone and never falls through to package resolution, so an absent builtin, a flag-gated one
and a build compiled without it **all raise that single code**. Verified by executing both named
scenarios — `node --no-experimental-sqlite` for the flag gate, and `node:quic` on a build with
`node_use_quic === false` for the compiled-without case — and both produced
`ERR_UNKNOWN_BUILTIN_MODULE`.

Two things followed. The branch was **dead code justified by an unenumerated claim**; and its only
trigger was a failure shape the *test fixture had invented for it*, which is this repo's
manufactured-evidence class. Deleting it also removes the residual the message-matching created: a
genuine loader or resolution fault whose text happened to contain "sqlite" would have been relabelled
"your Node is too old", sending the user to fix the one thing that was not wrong. **Anything other
than that one code is now rethrown with its cause intact.**

### The failure is captured, not thrown, at module scope

Rethrowing an unrecognised import failure during module evaluation would take down every command —
OAI-61's own blast radius, reintroduced for a different cause. The error is stored and classified at
first use, so an unrecognised fault reaches only the commands that actually open a database.

### Refuse before the cost, not after it

`submitTask` calls `requireDatabaseSync()` first. It previously ran `prepareTask` — real requests to
the provider — before the store was opened, spending them on a submission that was always going to be
refused. That the provider is now never contacted on this path is proved by a test whose witness is
the server's own request log, against a **reachable** fake server: the refusal message appears either
way, so only the request log distinguishes gated from ungated. (An earlier version of this ADR said
"five real HTTP round trips were paid" and attributed it to verification. Nothing counted round trips;
the number is withdrawn and the claim reduced to what the test actually witnesses.)

The sibling read commands (`cmd-status`, `cmd-result`, `cmd-cancel`) were checked by reading and are
clean — each opens the store as its first real action.

### Withdrawn from this decision, and where it went

Four sections stood here — the credential notice's rewrites, the permission hardening, the WAL
creation order, and what the ordering fix did and did not remove. They are **gone because the code
they described is gone**: a partial plan withdrawal under `adr/033` returned this feature to the
capability gate it was approved for, and moved the credential-notice subsystem and the permission
hardening (`state-permissions.mjs`) to tracker items of their own, carrying their open findings.

They are removed rather than hedged. A decision record that outlives its code is worse than no record,
because a later reader trusts it — and this one would have described a notice, a module and a test
file that no longer exist. The reasoning is not lost; it moved to the items that own the work.

What survives here is what the narrowed change set demonstrates: `requireDatabaseSync()` runs before
`submitTask` spends provider requests it can never use. That ordering is in scope and tested. The
*content* of the credential notice is not, and this ADR no longer says anything about it.

## Alternatives rejected

- **Raise `engines` to 22.13 and refuse everything.** Cannot produce a message on its own (above), and
  refuses commands that work.
- **Convert dispatch to a uniform dynamic-import loader map.** Recommended first by Codex, then
  withdrawn by it when asked to name a concrete present-day failure it prevents; there are exactly two
  `DatabaseSync` construction sites, both in this module, so one guard covers every path by
  construction. The restructure would also split the command surface across a dispatch table and the
  spec table `tests/plugin.test.js` checks — the drift class that test exists to catch.

## What is proven, and what is only cited

**Executed** on this machine (Node v26.3.1): the original defect's reachability; that the guard keeps
non-database commands working; that a database command refuses with an actionable message; that an
unrecognised fault keeps its cause and does not spread; that `--background` refuses before the
provider is contacted; that the worker reaches the guard through `openStore()` in its own right; and
that a submission refused by the store never claims the key was persisted.
`tests/runtime-capability.test.js` runs all of it against the real entry point at its real path.

Each of those assertions has been shown it **can fail**, by positive control rather than by reading:
removing `requireDatabaseSync()` from `submitTask` turns the request log red, and replacing
`openStore`'s call with the module binding turns the worker test red. Each mutation was certified
landed and each restore verified against a byte copy. This matters because two of these assertions
replaced ones that could not fail — see below.

**The harness detects its own instrument, for the same reason the plugin does.**
`--no-experimental-sqlite` only exists from Node 22.5, so hard-coding it made `npm test` die at
`node: bad option:` across 18.18–22.4 — the very range this feature restores. The tests now ask
whether the *parent* runtime has `node:sqlite` and pass the flag only if it does. **The two sides of
the floor therefore prove different things, and neither covers both**: below 22.13 the tests exercise a
genuine absence and never the flag path; from 22.13 they exercise the flag and never a natively absent
runtime. Separately, `node:module`'s `register` arrived in 18.19/20.6, so the unrecognised-fault test
is skipped below that **with its reason named in the skip** — a silent skip would be a check that had
quietly stopped being able to fail.

**Structural, and deliberately not executed**: the `if (!sqlite.DatabaseSync)` branch, which makes
"`DatabaseSync` falsy" always imply "`importFailure` set". No test exercises it, and none should be
built: reaching it needs a fixture that resolves `node:sqlite` to a module without that export, which
no runtime produces — the same manufactured-evidence shape that got `ERR_MODULE_NOT_FOUND` deleted
above. The branch exists so the invariant holds **by construction**, and a fixture inventing a module
shape to witness it would be evidence about the fixture, not about the code. Stated here rather than
left to be rediscovered as a coverage gap.

**Cited, not executed**: the 22.13 / 23.4 floor itself, and the 22.5 / 18.19 / 20.6 introduction
versions above, all from the Node documentation. This machine has only v26.3.1 and no version manager,
so nothing here demonstrates that the plugin runs on Node 18 or 20 — only that the `node:sqlite`
dependency no longer decides whether it loads. A claim of general Node 18/20 compatibility would need
a real old runtime.

**Two assertions here previously could not fail**, and both were caught by review rather than by the
suite going red. One asserted a message was absent on a fixture that could never produce it, so it was
unreachable at any ordering. One pointed at the discard port, so the assertion the test existed for was
never evaluated — the message assertion above it failed first. The lesson is recorded rather than
merely fixed: an assertion that passes in both the correct and the regressed build is not a weak test,
it is not a test.
