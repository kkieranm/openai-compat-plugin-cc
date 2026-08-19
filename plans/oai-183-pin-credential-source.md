provenance: harness slug delegated-soaring-umbrella

# OAI-183 — pin the credential SOURCE a background job was authorized for

## Context

A `/oai:task --background` job stores an authorization decision at submission time and re-resolves the
actual credential fresh at execution time — the secret itself is deliberately never persisted
(`scripts/lib/job-auth.mjs` header comment). OAI-63 closed the endpoint half of that: the freshly
resolved profile's `baseUrl`/`query` must still match the frozen `transport` on the row, so a profile
repointed to a different endpoint cannot have this job's key sent to it.

**What is still open (OAI-183, reproduced against OAI-63's own patched code):** nothing pins *which
credential source* was authorized. A job submitted under profile `foo` with
`providers.json`'s `foo.apiKeyEnv = "KEY_A"` will, if an operator edits that entry to
`apiKeyEnv = "KEY_B"` before the job runs — `baseUrl` and `query` untouched — pass every existing check
and send `process.env.KEY_B`'s value to the job's original, authorized endpoint. The wrong secret goes
to the right endpoint.

Probe (Codex, 4/4 claims TRUE) confirmed: `resolveCredential` (job-auth.mjs:117) compares only
`baseUrl`/`query`; `authPolicyFor` (job-auth.mjs:56) records `mode`, `profile`, `authorizedOrigin`,
`apiKeyAuthorized` and nothing about credential provenance; and `buildProfile` (config.mjs:256)
resolves `apiKeyEnv` to a value via `resolveApiKey` but **drops the variable name** — its emitted
whitelist has no field recording which source produced the key.

**Intended outcome:** an `apiKeyEnv` repoint (or an env↔inline transition) between submission and
execution is refused; an ordinary key *rotation* (a new value behind an unchanged source) still runs,
because that is a routine admin action and refusing it would strand every queued job across a
rotation.

## Decisions already settled (grill, with Codex's steer)

1. **Pin the tagged credential SOURCE, not the key value.** Persist `{kind:'env', name}` or
   `{kind:'inline'}` at submission; compare at resolution. Codex's decisive reason for rejecting a
   key-value hash: it binds the job to a secret value rather than the operator's chosen credential
   slot, breaking the explicitly supported rotation behaviour. Tagging the *kind* (not just the env
   name) is what also covers an inline-`apiKey` profile, which a name-only pin cannot.
2. **Legacy rows: no-op, scoped to the OLD versions literally.** The source check applies only to rows
   written at the new version. The version test is `schemaVersion === 1 || schemaVersion === 2` —
   **never** `< 3` or "the field is missing", so a malformed or future version cannot fall into the
   legacy path. This mirrors the existing `apiKeyAuthorized` legacy default (job-auth.mjs:165) and its
   docblock's stated reasoning (job-auth.mjs:108-115).
3. **A v3 row with a missing or malformed pin fails closed** (refuses), rather than defaulting to the
   current source — which would silently preserve the vulnerability under a migration gap.
4. **Scope boundary, deliberate and documented:** the pin freezes the credential *slot*, not the
   secret *value*. An inline `apiKey` edited in place, or an env var's value changing under an
   unchanged name, both still pass. This is the same rotation-safety property, applied consistently,
   and is consistent with the codebase's standing rule that the credential is never persisted or
   value-pinned. A test asserts this passes, so the boundary is deliberate rather than accidental.

## The one edge this plan decides (not previously grilled — flagged for the gate)

`authPolicyFor` writes `mode: 'profile'` with `apiKeyAuthorized: false` for a **query-only** profile
(job-auth.mjs:57-63) — no `apiKey`, no `apiKeyEnv`, so neither tag applies. Decision: **the source pin
is written and checked only when `apiKeyAuthorized` is true.** When no key was authorized there is no
credential identity to pin, and the existing escalation guard already returns `apiKey: undefined`
without refusing.

This is not merely tidier — it is required to avoid a behaviour regression. The test declared at
`tests/job-auth.test.js:519` pins that a query-only profile which later *gains* an `apiKey` still sends
no key **and completes** (`row.state === 'completed'` at :534, `headers.authorization === undefined` at
:538). A kind-drift refusal at that point would flip that deliberate, tested outcome into a failure,
which is outside OAI-183's scope.

The decision has two halves and each does distinct work: scoping the **check** inside
`if (apiKeyAuthorized)` is what protects that test; scoping the **write** is what keeps the fail-closed
refusal from misfiring on a legitimate query-only row. The `authPolicyFor` `deepEqual` at :67
(query-only, `apiKeyAuthorized: false`) stays green precisely because nothing is written when no key was
authorized.

Note the resulting safety property: pin-presence and `apiKeyAuthorized` are written together by
construction — `profile.apiKey` truthy ⟺ `resolveApiKey` returned a value ⟺ a tag exists — so the
fail-closed refusal in Phase 3 can only ever fire on a corrupt or hand-edited row, never on a
legitimately submitted one.

## Files this plan touches

`scripts/lib/config.mjs`, `scripts/lib/job-auth.mjs`, `scripts/lib/job-store.mjs`,
`tests/job-auth.test.js`, `tests/config.test.js`, and `CLAUDE.md` (Phase 4's architecture note).
`scripts/lib/cmd-task-worker.mjs`, `scripts/lib/task-submit.mjs`, `scripts/lib/job-record.mjs` and
`tests/job-helpers.mjs` are read to confirm they need no change; if the Phase 3 grep finds another
consumer of the `auth` blob's shape, that file joins this list and the plan is re-challenged.

## Implementation

### Phase 1 — carry the credential source out of config resolution

`scripts/lib/config.mjs`. `resolveApiKey` (config.mjs:245-254) is the only place that knows which
branch supplied the key, so the tag is computed there and returned alongside the value; `buildProfile`
(config.mjs:256-279) emits it as a new whitelist field, `credentialSource`.

**First, validate `apiKeyEnv` as a non-empty string — this is a prerequisite, not a nicety.**
`process.env[profile.apiKeyEnv]` coerces its subscript, so `apiKeyEnv: 7` reads `process.env["7"]`.
That submits successfully **only when an env var literally named `7` exists** — otherwise
config.mjs:249 already throws today. The narrow case is real all the same: on that path the plan would
persist `{kind:'env', name: 7}` and then refuse the same job at Phase 3's "non-empty string" check — a
job that submitted cleanly becomes permanently unrunnable with no config change at all, a fail-closed
misfire on a legitimate row. **The validation belongs in `validateConfig` (config.mjs:126), NOT in `resolveApiKey`.** Put it in
`resolveApiKey` and the cross-endpoint `--base-url` path escapes it entirely: `resolveProfile` deletes
`apiKeyEnv` from the raw copy **before** `buildProfile` runs (config.mjs:316-317), so an invalid
`apiKeyEnv` is never seen there — which would contradict both the "fails everywhere" claim and the
matrix row requiring an invalid `apiKeyEnv` to be refused.

`validateConfig` already validates per-profile shape at load time and already carries a
`typeof profile.baseUrl !== 'string'` check in exactly this style (config.mjs:134-136). A sibling check
there — when `apiKeyEnv` is **present**, it must be a non-empty string — fires on every path into the
config regardless of which profile resolution follows, so no scrub can bypass it. Message follows the
neighbours' shape: name the provider and the config path, quote the offending value with
`JSON.stringify` as they do (a variable *name* is not a secret; `config.mjs:249` already quotes it).

Keying on presence rather than truthiness matters here too — an empty string is falsy, so a
truthiness-gated check would never see the case the matrix requires to be refused.

**Acknowledged consequence, not an incidental one:** `loadConfig` runs on *every* command, so a profile
carrying `apiKeyEnv: ""` alongside an inline `apiKey` — which works today by falling through to the
inline key — will start refusing everywhere, `/oai:review` included. That is intended: an empty or
non-string `apiKeyEnv` is almost certainly a typo, and failing loud on it is the point. Recorded so the
blast radius is a decision rather than a surprise.

A regression test covers the non-string and empty-string cases in `tests/config.test.js`, beside the
existing `apiKeyEnv`-unset case at :136.

- `{kind:'env', name: <apiKeyEnv>}` when the env branch supplied the key.
- `{kind:'inline'}` when the inline `apiKey` fallback supplied it.
- Absent/`undefined` when neither did (no credential at all).

Record which branch **actually supplied** the key, never which fields merely exist — `resolveApiKey`
prefers env over inline (config.mjs:246-253), so a profile carrying both is `env`, and dropping
`apiKeyEnv` while leaving the inline key is an env→inline *kind change* that must refuse.

Computing it inside `resolveApiKey` is what makes the cross-endpoint scrub correct for free:
`resolveProfile` deletes both `apiKey` and `apiKeyEnv` from the raw copy **before** `buildProfile` runs
(config.mjs:316-317), so the withheld-credential case yields no tag, as it should.

This single change serves **both** ends of the seam: submission (`prepareTask` →
`authPolicyFor(prep.profile)`) and re-resolution (`resolveCredential` calls `resolveProfile` at
job-auth.mjs:129, which returns a built profile the same way).

Note the whitelist's own comment (config.mjs:265-267) — a field added to validation and forgotten in
`buildProfile` validates and then does nothing. The new field goes in the whitelist explicitly.

The Phase 2 invariant "a key implies a tag" rests on `resolveApiKey` having exactly **one** caller
(config.mjs:277) and `task-submit`'s only profile source being `resolveProfile` → `buildProfile`. That
is true today and is what makes the fail-closed refusal unreachable for a legitimate row — so it goes
in the docblock as a constraint, since a future second caller that skipped the tag would quietly
persist a v3 row that refuses at execution.

### Phase 2 — persist it at submission

`scripts/lib/job-auth.mjs` `authPolicyFor` (:56-66). In the `mode: 'profile'` branch, when
`profile.apiKey` is present (i.e. `apiKeyAuthorized` is true), also record
`credentialSource: profile.credentialSource`. No change to the `mode: 'none'` branch, and nothing
recorded when no key was authorized (per the edge decision above).

**Write the field unconditionally within that branch** — not via a conditional spread. Phase 3a's
prediction that `tests/job-auth.test.js:48-58` goes red holds only under the unconditional write; a
conditional-spread implementation leaves it green. The prescribed fixture change is right either way,
so an implementer who sees no red there should not read it as the phase having been skipped.

`scripts/lib/job-store.mjs`: bump `ROW_SCHEMA_VERSION` from 2 to 3 (:109) and extend its docblock
(:95-108) the way the 1→2 bump did. **No table change and no `USER_VERSION` change** — this is a
payload field, and the two numbers mean different things (job-store.mjs:83-92). **No migration code**:
there is none in this repo by design, and the 1→2 bump (`581ac7b`) added none. Old rows stay readable
via `isKnownVersion`'s `<=` (job-record.mjs:67) and a read-time default scoped to a literal version.
The docblock gains one clause on downgrade posture, and it must be **narrow**: an older build refuses
to *abandon* (`job-abandon.mjs:109`), to *reconcile* (`job-reconcile.mjs:129`), and treats the row as
`blocks` rather than `head` in the queue (`job-queue.mjs:63`) — those three are the only sites gating on
`isKnownVersion`. It does **not** refuse all mutations: `isKnownVersion` is a predicate, not an
enforcement point, and `registerWaiter`, `markSpawned` and `finish` carry no version check, with
`runTaskWorker` calling `registerWaiter` ahead of any downstream refusal. Do not write the blanket
claim — the 1→2 docblock does not make it either, and it would be false.

### Phase 3 — enforce it at resolution

`scripts/lib/job-auth.mjs` `resolveCredential` (:117-173), inside the existing
`if (apiKeyAuthorized)` branch (:166), after the endpoint/query gate and **after the `!current.apiKey`
refusal (:167)** — not before it, so a v3 row whose profile was stripped of its key keeps the more
informative "no longer supplies a credential" message — and before returning the key:

- **Legacy pass-through:** if `schemaVersion === 1 || schemaVersion === 2`, skip the source check
  entirely (today's behaviour). Literal equality on both, never a `<` comparison.
- **Otherwise the pin is required.** Validate exhaustively — accept only `{kind:'inline'}` or
  `{kind:'env', name: <non-empty string>}`. A missing pin, an unrecognised `kind`, or an `env` tag with
  no usable `name` all refuse. A malformed pin must not fall back to legacy behaviour.
- **Compare** the persisted pin against `current.credentialSource`: `kind` must match, and for `env`
  the `name` must match too. Any mismatch refuses. **Read `current` through optional chaining**
  (`current.credentialSource?.kind`) — a bare `current.credentialSource.kind` throws a `TypeError`
  instead of the intended `UserError` on a row where the key-implies-tag invariant had been broken by a
  future second `resolveApiKey` caller, which is precisely the scenario Phase 1's docblock constraint
  exists to warn about.

**Gate the name compare on the PIN's kind (`pin.kind === 'env'`), not on `current`'s.** This is not a
style choice: gated on `current.credentialSource.kind`, mutation 2 below produces no red at all — with
the `kind` compare disabled, `pin.name` (`'KEY_A'`) still mismatches `current`'s `undefined`, the row
still refuses, and the mutation proves nothing. Keep the two conjuncts independent; a single
`deepEqual` over the whole pin would collapse them and defeat the same check.

Refusal message follows the established `credential-unavailable:` shape and the module's standing
"quote nothing raw" rule (job-auth.mjs:131-143, :156-160): name the provider (a config key, already
shown unredacted) and point at `/oai:setup`. **Do not echo the env var name or either endpoint** — a
variable name is lower-risk than a secret but this module's rule is uniform, and the operator can see
both live values on their own terminal.

The worker's call site (`cmd-task-worker.mjs:56`) already passes `job.schema_version` and needs no
change. **Before implementing, run one pre-implementation grep covering three things**, since the plan's
exhaustiveness claims were verified only over the files reviewed:

- other consumers of the `auth` blob's shape (a status renderer, a `--json` envelope), so the new field
  is handled consistently — a consistency check, not a disclosure one: an env var name is not a secret
  and `config.mjs:249` already quotes it in an error;
- `ROW_SCHEMA_VERSION` / `schema_version` **literals**, since a test pinning a fresh row's version to
  `2` goes red on the Phase 2 bump;
- whole-profile equality assertions (`deepEqual` on a built profile), which go red on the new
  `credentialSource` whitelist field.

Each is a red test with a mechanical fix rather than a silent defect; a design consequence found here
re-opens the plan gate per the file-list rule above.

### Phase 3a — two existing fixtures go red, and the fix is in the FIXTURES

Both approvers independently found this, and it is called out here because the red tests invite exactly
the wrong repair:

- **`tests/job-auth.test.js:196-208`** calls `resolveCredential(authorisedQuery, transportQuery)` with
  `apiKeyAuthorized: true` and **no** `schemaVersion`. `undefined` is neither 1 nor 2, so the new branch
  requires a pin the fixture lacks. Fix: pass an explicit `, 2`. Either 1 or 2 takes the legacy
  pass-through; 2 is the honest label, since a v2 row legitimately carries `apiKeyAuthorized: true`.
  (Its siblings at :99, :122, :188 and :292 pass `1`, not `2` — :135 is the only existing `, 2` call
  site. The fix stands; the convention claim does not.) This preserves the test's real subject — the
  commitment path, not versioning.
- **`tests/job-auth.test.js:48-58`** asserts the whole policy with `assert.deepEqual`, which fails on an
  extra `undefined`-valued key. Fix: give the fixture a `credentialSource` and assert it is echoed.

**Forbidden repair, stated explicitly:** neither may be fixed by relaxing the version test to `< 3` or
`!== 3`, nor by letting a missing pin pass. Phase 3's wording already forbids both; the fixture problem
must not be "fixed" in the enforcement code.

Every other unversioned `resolveCredential` call in that file is unaffected, by one of two routes, both
upstream of the new check: `:91` and `:92` return `undefined` through the `mode:'none'`/null early
return (job-auth.mjs:118), and `:145`, `:156`, `:168`, `:221`, `:243`, `:257`, `:279`, `:301`, `:328`,
`:354` and `:371` each throw at the origin, endpoint/query, or config-resolution gate.

**Test-authoring hazard on the flagship cases.** In the `KEY_A`→`KEY_B` repoint test and the
inline→env test, the target environment variable **must actually be set**. If it is not,
`resolveApiKey` throws inside `resolveCredential`'s `try` (job-auth.mjs:128-144) and the test passes on
the *config-resolution* refusal — the wrong gate, proving nothing about source pinning. The Phase 5
mutation check must name these two tests as the ones required to go red, or it cannot tell the two
gates apart.

### Phase 4 — docs

One present-tense line naming `credentialSource` and what it pins. **There is no standalone
`job-auth.mjs` paragraph in `CLAUDE.md`** — the job-auth material (`queryCommitment`/`querySalt`,
`apiKeyAuthorized`) lives inside the `task-submit.mjs` / `noteEndpointPersistence` paragraph at
CLAUDE.md:193-201, and that is the paragraph to edit — identify it by content, since line numbers drift. The rationale, the rotation boundary and the
residual value-drift limitation go in the tracker item, not the note.

## Verification

Run the repo `verify` skill (`.claude/skills/verify/SKILL.md`) — `npm test` plus a real plugin load and
a delegation round trip. Then mutation-check the key invariant per `/feature`'s step 5.

**Two mutations are required, not one — a single one cannot cover both flagship tests.** The `kind`
compare and the `name` compare are independent conjuncts, and in the `KEY_A`→`KEY_B` repoint case both
sides are `kind: 'env'`, so defeating the `kind` compare alone leaves the name mismatch still refusing
and that test stays green:

1. Disable the **env-name** comparison → the `apiKeyEnv` repoint test must go red.
2. Disable the **kind** comparison → the inline→env transition test must go red.

Each mutation separately: back up the file, prove the mutation landed with
`~/Code/dotfiles/tests/mutation-landed.py`, run the suite, name the test that failed, restore, re-run
green, and prove the restore by `diff` against the backup — never by eye. Both target environment
variables must be populated throughout, or a test passes on the config-resolution refusal instead and
proves nothing about source pinning.

Test matrix to add, in `tests/job-auth.test.js` alongside the existing legacy-default cases:

| Case | Expected |
| --- | --- |
| `apiKeyEnv` repointed to a different variable, endpoint unchanged | **refused** (the OAI-183 exploit) |
| Same `apiKeyEnv` name, new value in the environment | passes (rotation) |
| Inline `apiKey` value edited in place | passes (documented scope boundary) |
| env → inline transition (`apiKeyEnv` dropped, inline key remains) | **refused** |
| inline → env transition | **refused** |
| v1 row, no pin | passes (legacy) |
| v2 row, no pin | passes (legacy) |
| v3 row, key authorized, pin missing | **refused** (fail closed) |
| v3 row, malformed pin (bad `kind`; `env` with empty `name`) | **refused** |
| v3 query-only row (`apiKeyAuthorized: false`), no pin | passes, no key sent — the existing :519 behaviour, unchanged |
| A real `--background` submission under an `apiKeyEnv` profile | persists a `{kind:'env'}` pin — one end-to-end arm, since every other env case above is unit-level |
| `apiKeyEnv` set to a non-string (e.g. `7`) or empty string | **refused at config load**, on every command path, with an actionable message (Phase 1) |

`tests/job-helpers.mjs`'s `insertSynthetic` defaults `version = 1`, so any test needing a v3 row must
pass `version` explicitly — otherwise it silently exercises the legacy path and proves nothing.

Also confirm `tests/config.test.js`'s existing `credentialWithheld` matrix (:83-121) and the
`apiKeyEnv`-unset case (:136) still pass, since Phase 1 touches that function.
