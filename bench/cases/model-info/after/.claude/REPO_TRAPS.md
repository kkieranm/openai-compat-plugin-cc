# Repo traps — confirmed defect classes

Each entry cost real debugging time here. Prefer promoting a repeat offender to a permanent test
over leaving it in this list.

## Synchronous spawn deadlocks against the in-process fake server

`spawnSync`/`execSync` in a test blocks this process's event loop, so the fake OpenAI-compatible
server (which runs in the same process) can never answer the child's request. The run does not fail
— it hangs until the client's own timeout, which looked like a 204-second suite. Use the async
`runCompanion` helper in `tests/helpers.mjs`.
**Guarded by** `tests/structure.test.js` — "tests never spawn a child synchronously".

## Prompt text is prose, not shell syntax

The `"$ARGUMENTS"` blob was originally split with shell-quoting rules "the way a shell would". But
the blob is the user's literal request text, so an apostrophe in `what the file's header does` opened
a quote that never closed — dropping the apostrophe and merging the rest of the sentence into one
token — and a backslash in `what \d+ matches` was eaten as an escape. Both corrupted the model's
input silently, which is the exact failure mode the fail-loud design exists to prevent.

The rule now: tokenize only the **leading flag region**; everything from the first non-flag token
onward is taken verbatim from the original string. Quoting a word marks it as text, so a quoted
`'--model'` is prompt, not a flag; a bare `--` closes the flag region explicitly.

**Guarded by** `tests/args.test.js` (unit) **and `tests/task.test.js`** — "the documented -- escape
hatch runs, prompt intact", which drives `runCompanion` end to end.

A unit guard on one helper is not enough here, and claiming otherwise caused real damage: this entry
previously cited only the `splitBlob` unit test, which passed green while the documented `--` form
failed with exit 1 through the actual CLI. A later review found that defect and noted the false
assurance had let reviewers skip the area. **Any guard for this trap must exercise the companion, not
just the parser.**

## `new URL()` succeeding is not URL validation

`new URL('localhost:1234')` parses happily as scheme `localhost:` with a **null origin**, so building
`${url.origin}${path}` silently produced `null1234` as a base URL. Anything accepting a user-supplied
URL must also assert the protocol is `http:`/`https:`.
**Guarded by** `tests/config.test.js` — "rejects a malformed base URL".

## Plugin command markdown fails silently at runtime

Commands are markdown, so nothing type-checks them: a missing `allowed-tools: Bash(node:*)` entry or
a renamed companion script only surfaces when a user runs the command and it fails.
**Guarded by** `tests/plugin.test.js`.

## A model ceiling is not a context window

Vendor APIs report two different numbers and they can differ by 4.5×: what the server is actually
serving (LM Studio `loaded_context_length`, vLLM `max_model_len`, llama.cpp `/props` `n_ctx`) versus
what the model could theoretically support (`max_context_length`, `n_ctx_train`,
`<arch>.context_length`). Sizing the guard by a ceiling silently admits input the server rejects —
the exact failure the guard exists to prevent. `model-info.mjs` only ever assigns `window` from a
served field; ceilings go to `ceiling` and are display-only. When only a ceiling is known, the
window is **unknown** and we warn.
**Guarded by** `tests/model-info.test.js` — "a model that is not loaded has no known window", and
`tests/model-selection.test.js` — "a ceiling-only server leaves the guard disarmed rather than
guessing".

## Reported state must describe what will actually happen

This class has now bitten **three times in one feature**, so treat any new status output as guilty
until it derives from the same code the real path runs:

1. `/oai:setup` reported the first model with a detected window, which could be a different model
   from the one a task would run — promising a guard the task would not have.
2. `setup --json` reported only the *configured* `contextLength`, so it printed `null` for a run the
   text report described as guarded at 58.1k. Both now derive from one `effectiveWindow()`.
3. `setup` marked an embeddings-only provider `ok` and listed it as `Ready`, while a task against it
   failed instantly — and the remediation it offered ("set contextLength") could never have helped.

**Guarded by** `tests/model-selection.test.js` — "setup reports the window of the model a task would
use", "setup --json reports the same window the text report does", and "setup does not call an
embeddings-only provider ready".

## A credential belongs to one host

`--base-url` overrides a named profile's endpoint but used to inherit its `apiKey`, so
`--provider p --base-url http://other.host` sent p's key as a Bearer token to an unrelated host over
plaintext HTTP. `resolveProfile` now withholds the credential across a differing origin and says so
on stderr. Any future option that redirects a request must ask the same question: does the
credential still belong to where this is going?
**Guarded by** `tests/config.test.js` — "a credential is never forwarded to a different host".

## Reviewer notes that are not yet defect classes

- Watch for silent truncation creeping into the context guard. The whole design says refuse loudly
  with measured sizes; a "just trim it to fit" change would produce confident answers drawn from
  half the input.
- Watch for `apiKey` reaching any output path. `setup --json` deliberately emits only `hasApiKey`.
