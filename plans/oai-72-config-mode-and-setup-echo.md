provenance: harness slug vivid-wiggling-starlight

## Context

OAI-72 files two credential-exposure defects outside OAI-3's range, both independently confirmed
against the current code (probed with Codex; all four load-bearing claims TRUE):

- **(a)** `scripts/lib/config.mjs`'s `loadConfig()` writes `providers.json` with
  `writeFileSync(path, content)` — no mode argument — on first run (`config.mjs:48`), and nothing else
  in the file ever `chmod`s it, on that path or the read path. The file can hold an inline `apiKey`
  (the `apiKeyEnv` field is preferred, but `apiKey` is still a supported fallback per `resolveApiKey`,
  `config.mjs:170-179`), so its mode is what that fallback's confidentiality rests on. This is the same
  shape of gap OAI-65(a)/(b) just closed for `jobs.db` and its containing directory — a file holding a
  secret, created with no explicit protection, never repaired on a later load either.
- **(b)** `scripts/lib/cmd-setup.mjs`'s `probeProvider`, when `buildProfile` throws (a common case: a
  configured `apiKeyEnv` whose environment variable is unset), builds its fallback row from the RAW,
  un-normalized `rawProfile.baseUrl` string directly (`cmd-setup.mjs:21`) — never passed through
  `normalizeBaseUrl`, which is what the SUCCESS path always uses to split the query string out into a
  separate field (`config.mjs:126-149`) before anything is ever displayed. `render.mjs:111` then
  interpolates this raw value directly into a report line written to stdout, with no redaction. A
  provider configured with a query-embedded credential (`http://host/v1?api_key=SECRET` — a real
  pattern this plugin's own `normalizeBaseUrl` doc comment names as something it must NOT fold into the
  path) would have that credential printed to the operator's terminal on any `/oai:setup` run where
  `buildProfile` fails for an unrelated reason (e.g. a missing `apiKeyEnv` value) — the exact secret the
  success path takes care to keep separate leaks whole on the failure path.

Both fixes are settled by convention already established in this exact codebase, not genuine product
forks: (a) mirrors OAI-65(b)'s just-shipped precedent (unconditional repair of a secret-bearing file's
mode on every load, matching `job-store.mjs`'s `jobs.db` handling) exactly; (b) extends
`normalizeBaseUrl`'s existing query-stripping redaction to the one code path that currently bypasses
it. Neither needed a grill.

**Out of scope, already filed separately:** OAI-186 covers `config.mjs`'s directory-creation symlink-
following gap (a different file, a different exploit shape) — this item is the FILE's mode only, not
the directory's symlink safety.

## Changes

**`scripts/lib/config.mjs`** — `loadConfig()`:
- On the ENOENT (first-run) branch, pass `{ mode: 0o600 }` to `writeFileSync` at the point of creation
  (`writeFileSync`, unlike `mkdirSync`, DOES apply its mode argument at creation time — this is not the
  no-op OAI-65(b) found for directories).
- Unconditionally `chmodSync(path, 0o600)` after every successful read too (the non-ENOENT branch,
  before `validateConfig` returns), in the same best-effort `try { chmodSync(...) } catch {}` shape
  `job-store.mjs` already uses for `jobs.db` (a filesystem without Unix modes is not a reason to refuse
  to run) — this is what repairs a pre-existing file left loose by an older build, mirroring OAI-65(b)'s
  "the mode argument alone only protects a fresh file" lesson.
- One-line comment at the chmod site naming why (secret-bearing file, same posture as `jobs.db`),
  matching this repo's established comment density for a security-relevant repair, not a paragraph.

**`scripts/lib/cmd-setup.mjs`** — `probeProvider`'s catch block:
- Import `normalizeBaseUrl` from `./config.mjs` alongside the existing `buildProfile, loadConfig`
  import.
- Replace the raw `rawProfile?.baseUrl ?? '(no baseUrl)'` fallback with an attempt to redact it first:
  call `normalizeBaseUrl(rawProfile?.baseUrl)` in its own `try`, and on success use its returned
  `.baseUrl` (query already stripped by that function). On failure (the raw value isn't even a valid
  URL — plausibly why `buildProfile` itself threw), fall back to a static placeholder,
  `'(unparseable baseUrl)'`, never the raw string. This never re-throws to the outer catch and never
  displays a query string or embedded credential on this path, matching what the success path already
  guarantees.

No schema change, no new file, no new dependency between these two fixes — they close in one diff
because they're both OAI-72's stated scope, not because they share a mechanism.

**Addendum (review-ladder pass 4, digest 1ab6e1dca27a) — superseded by the pass-5 addendum below,
kept for history:** the plain best-effort `try { chmodSync(...) } catch {}` shape described above for
the read-path repair is superseded. Two Codex reviewers at Group B found it swallowed `EPERM`/`EACCES`
too — a file the process cannot `chmod` stays loose and `loadConfig()` proceeds anyway — so those two
codes now re-throw a `UserError` instead of being swallowed; every other `chmodSync` failure (a
genuinely mode-less filesystem) still falls through silently. The same review also found the
ENOENT-branch `writeFileSync` used the default `'w'` flag, so a concurrent creator racing between the
ENOENT check and this write would have its file silently truncated while keeping whatever mode it gave
the file — that write now uses `flag: 'wx'`, and on `EEXIST` (someone else won the race) recurses into
`loadConfig()` to read and repair what they wrote rather than truncating it.

**Addendum 2 (review-ladder pass 5, digest f7b9162d73d4):** the pass-4 addendum above is itself now
inaccurate on two points, corrected here, plus two more fixes from the same review chain it never
recorded:

- The chmod-repair swallow set is **not** "every code except EPERM/EACCES" — a second Codex round
  found that polarity backwards: `EROFS`/`EIO` are real failures on a mode-capable filesystem (e.g. a
  read-only mount), not evidence of "no modes here," and the old logic silently left a loose file on
  one. The catch now re-throws for **everything except `ENOSYS`/`EINVAL`** (what a genuinely mode-less
  filesystem actually returns), inverted from the pass-4 description.

- The `EEXIST`-recurse is **not** unbounded `loadConfig()` — a third round found a dangling symlink at
  the config path makes `readFileSync` see `ENOENT` (the target is missing) and the `wx` write see
  `EEXIST` (the link itself isn't) on *every* attempt, recursing forever into a raw stack-overflow
  `RangeError`. `loadConfig()` is now a zero-arg wrapper around `loadConfigAttempt(attempt)`, bounded
  by `MAX_CREATE_RACE_ATTEMPTS = 3`; exhausting it throws a clear `UserError` instead.

- Two further fixes belong to this same review chain and were never recorded in either addendum:
  `normalizeBaseUrl`'s three throw sites, and `loadConfig`'s `JSON.parse` catch, no longer interpolate
  raw input (the URL string, or `error.message`) into their thrown messages. Without these,
  `probeProvider`'s `row.error.message` — the same row plan (b)'s fallback-`baseUrl` fix targets —
  would still echo a raw credential even after that fix, which `tests/cmd-setup-redaction.test.js`'s
  "a userinfo-embedded credential never survives in row.error.message either" test proves end to end.
  Fixing only the fallback string as originally planned would have left OAI-72(b) half-closed.

All fixes and their tests are mutation-proven; see `tests/config-mode.test.js`'s `wx`/`EEXIST`,
bounded-retry, dangling-symlink, and chmod-polarity tests, and `tests/config.test.js`'s
`normalizeBaseUrl` no-raw-interpolation test.

## Tests

**`tests/config-mode.test.js`** (new file, mirroring `tests/job-store-modes.test.js`'s naming and
structure):
- A discriminating fixture: pre-create `providers.json` at a loose mode (e.g. `0o644`), call
  `loadConfig()`, assert the file comes back `0o600` — proves repair runs on the READ path, not just at
  creation (an already-`0o600` fixture would pass against a no-op implementation).
- A fresh-creation case: no existing file, call `loadConfig()`, assert the newly-created file is
  `0o600` immediately (not merely eventually) — proves the `writeFileSync` mode argument is present,
  not relying on a second call ever repairing it.

**`tests/cmd-setup-redaction.test.js`** (new file):
- A provider whose `apiKeyEnv` is set but the named environment variable is unset (the real trigger
  path for `buildProfile` throwing after `normalizeBaseUrl` has already run once inside it), with a
  `baseUrl` carrying `?api_key=SECRET-VALUE` — run `probeProvider` (or the smallest slice of
  `runSetup`/`cmd-setup.mjs` that reaches it) and assert the returned row's `profile.baseUrl` does NOT
  contain `SECRET-VALUE` or the raw query string, and does equal the normalized, query-free form.
- A provider whose raw `baseUrl` is not a valid URL at all (e.g. `"not a url"`) — assert the fallback
  is the static placeholder, not the raw string, and that constructing the row does not itself throw.
- If a positive control is cheaper here than a full behavioural fixture (confirming the OLD code would
  have leaked the secret in the fixture above), include it — this is the same shape of proof OAI-63's
  own credential-leak fix used (quote the exact request line before/after).

**Mutation-test both fixes** per this repo's standing discipline: back up each file, revert the fix
(the `chmodSync`/`mode` argument for (a); the `normalizeBaseUrl` wrap for (b)), confirm the exact
expected new test(s) go red and nothing else, restore, confirm clean, re-run green.

## Verification

- `npm test` green, including both new test files.
- Live check for (a): hand-loosen a real `providers.json` (`chmod 644`) in a scratch
  `OAI_PLUGIN_CONFIG`, run `/oai:setup` through the real plugin CLI, confirm `stat`/`ls -la` shows
  `0600` after — the same live-check shape OAI-65's own verification used.
- Live check for (b): point a scratch config at a provider with an unset `apiKeyEnv` and a
  query-embedded fake secret in `baseUrl`, run `/oai:setup` through the real plugin CLI, and confirm
  the secret does not appear anywhere in the printed report.
