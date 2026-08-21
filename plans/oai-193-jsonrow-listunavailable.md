provenance: harness slug quiet-percolating-oasis

# OAI-193: jsonRow never reads listUnavailable

## Context

`scripts/lib/cmd-setup.mjs`'s `probeProvider` (line 43-61) already detects the "server responded but
serves no model list" case and returns `{ profile, rawProfile, built: true, models: [], described: null,
listUnavailable }`, where `listUnavailable` is a composed string (`error.message` plus `transportDetail`
when present). The text-rendering path (`render.mjs`'s `providerLines`, line 65-66) already reads this
field and prints "reachable, but it does not serve a model list (<listUnavailable>)."

`jsonRow` (cmd-setup.mjs line 65-97) destructures `{ profile, rawProfile, models, error, described }` —
never `listUnavailable` — so for this exact case (no `error` field returned, just `listUnavailable`),
`reachable: !error` evaluates to `true` and `error: null`, producing a JSON row indistinguishable from a
fully healthy provider. `/oai:setup --json`'s only consumers (a script, a future dashboard) cannot see
this state at all. Confirmed by reading the source at both call sites; a comment at cmd-setup.mjs:69-75
already documents this exact gap and points at OAI-193.

`tests/setup.test.js`'s existing test `'setup still shows a probe failure's echoed response body in the
text view'` (line 47) already exercises this exact server behavior (a 404 on `/v1/models`) and its
comment (line 69-71) explicitly says the `--json` case is untested there — "a pre-existing gap ...
not covered here."

## Change

In `scripts/lib/cmd-setup.mjs`'s `jsonRow`:
- Destructure `listUnavailable` alongside the existing fields.
- Add a `listUnavailable: listUnavailable ?? null` field to the returned object, placed near
  `error`/`reachable` since it's part of the same reachability story.
- No change to `reachable`/`error` computation — the server genuinely is reachable in this case (that's
  already correct), so the fix is purely to surface the extra fact, matching the text view's semantics
  rather than replacing them.
- Update the two-line comment at cmd-setup.mjs:69-75 that currently states this gap exists (it will no
  longer be true).

In `tests/setup.test.js`: add one test using the same fake-server-returns-404-on-/v1/models pattern as
the existing text-view test, but calling `runCompanion(['setup', '--json'], ...)` and asserting the
parsed JSON's matching provider row has `listUnavailable` containing the marker text, and `reachable:
true` (confirming reachable stays true, only the new field is added).

## Verification

- `npm test` green.
- Mutation check on the key change: back up `cmd-setup.mjs`, mutate `listUnavailable ?? null` to always
  return `null` (i.e., drop the read), confirm the new test goes red, restore, confirm green again.
