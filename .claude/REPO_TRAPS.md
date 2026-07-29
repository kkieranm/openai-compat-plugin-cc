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

**The most-repeated defect in this repo: nine confirmed instances across two features.** Two rounds
of fixes failed because each one patched the branch that was reported while leaving the cause in
place — `selectModel` decided what would happen, and `canDelegate` and `effectiveWindow` each
re-derived that decision independently. Three models of one truth drift by construction, so every
branch fixed left the others free to disagree.

**The fix is one authority, never a patched branch.** `planSelection()` in `model-info.mjs` is now
the only code that decides which model a task will use, or why it cannot pick one. `selectModel`
throws its `problem`, the readiness marker is `!problem`, and the report *formats* it. A new view of
that decision must call it, not re-implement it. The same rule applies to the window: one
`effectiveWindow()` feeds both the text report and `--json`.

Instances, for the pattern rather than the detail:

1. `/oai:setup` reported the first model with a detected window, which could be a different model
   from the one a task would run — promising a guard the task would not have.
2. `setup --json` reported only the *configured* `contextLength`, so it printed `null` for a run the
   text report described as guarded at 58.1k. Both now derive from one `effectiveWindow()`.
3. `setup` marked an embeddings-only provider `ok` and listed it as `Ready`, while a task against it
   failed instantly — and the remediation it offered ("set contextLength") could never have helped.
4. Same marker said `ok`/`Ready` with **two** chat models and no `defaultModel`, where a task refuses
   to guess — the case the fix for (3) did not cover. A repo test asserted this broken behaviour.
5. Same marker said `ok` when `defaultModel` named a model the server itself calls an embedder.
6. `setup` told the user to "set defaultModel" when `defaultModel` was set but absent from the
   server's list — a case the code deliberately supports, since a model may load on demand.
7. A configured `contextLength` silently outranked a *disagreeing* detected window, with no warning
   in the one place that knew both numbers.
8. The text report hid the window on an error row while `--json` still reported it.
9. `setup` called a provider unreachable when it merely lacked `/v1/models`, while a task against it
   succeeded — the same class inverted, telling the user to restart a working server.
10. `chatCompletion` guarded content with `typeof content !== 'string'`, which `''` satisfies. A
    reasoning model that spent its whole budget thinking returned an empty answer, and `/oai:task`
    printed nothing, added a footer naming the token counts, and **exited 0** — a run that produced
    nothing reported as a success. `requireAnswer()` is now the one place that decides whether a
    reply is an answer.
11. `/oai:review` showed a reply it had truncated itself — the model hit `--max-tokens` mid-JSON —
    as "did not return findings in the requested shape", and exited 0. The shape was fine; we cut it
    off. Reporting our own truncation as the model's error sends the user to fix the wrong thing and
    hides the one flag that works. Found by the lean review, in a fix written earlier the same
    session for the *adjacent* case (both channels empty) — patching the branch in front of you is
    how this class keeps regenerating.
12. The findings-cap warning ("the list hit its limit, there may be more") was raised on the
    prompt-and-parse path, where no grammar ever ran and therefore nothing can have been cut.
13. The same warning used `>=` where only `===` is true. A list *longer* than the cap is reachable
    on a server that took the schema and ignored `maxItems`, and there every finding is already on
    screen — so the warning fired precisely when it was provably wrong.

14. **A guard turned a loud failure into a valid-looking wrong answer.** Bounding `analysis` made a
    guillotined review *parseable* — complete JSON, `finish_reason: stop`, empty findings — so the
    user saw `0 finding(s) … No defects reported.` with a normal footer, identical to a review that
    looked properly and found nothing. The previous behaviour was a loud "ran out of tokens". The
    ADR that introduced this described the symptom and called it an acceptable trade. Fixed with an
    `analysisCut` flag and a warning. **When a change converts an error into a valid-looking result,
    the result must carry the reason** — otherwise the trade is an error for a lie.
15. `extractJson` anchored on the *first* `{` and never retried from a later one, so a degraded
    reply that quoted source before its JSON (`if (!contextLength) { return DEFAULT; }`) had the
    quoted brace swallow the anchor — and good findings were discarded with "the model did not
    return findings in the requested shape". Our parser's limitation, reported as the model's fault.
    Now every balanced object is tried.

**12 and 13 are one warning, added in one change, wrong in two directions within an hour.** That is
the tell for this class: the risk is not the happy path but every path where the *precondition for
the message* differs from the condition actually tested. Before adding any warning, state the fact
it asserts and find the paths where the code could emit it without that fact being true.

**Guarded by** `tests/model-selection.test.js` and `tests/context-window.test.js` — including "setup
does not promise delegation when the model is ambiguous", which asserts that a real task refuses
whenever setup declines to promise — and, for 12 and 13, `tests/structured.test.js`: "the cap warning
is never raised on the path that has no cap" and "a list longer than the cap proves nothing was cut".

## A credential belongs to one host

`--base-url` overrides a named profile's endpoint but used to inherit its `apiKey`, so
`--provider p --base-url http://other.host` sent p's key as a Bearer token to an unrelated host over
plaintext HTTP. `resolveProfile` now withholds the credential across a differing origin and says so
on stderr. Any future option that redirects a request must ask the same question: does the
credential still belong to where this is going?
**Guarded by** `tests/config.test.js` — "a credential is never forwarded to a different host".

## Constrained output does not arrive where unconstrained output does

A strict `response_format` schema constrains generation from the first token, so a model whose chat
template opens a thinking block can never emit the token that closes it. Every schema-valid reply
therefore lands in `reasoning_content` with `content: ""`. Code that reads only `content` gets an
empty string and no error. Reading the other channel is correct **only** under a schema, where
parsing against it is the proof; without one the same text is the model's scratchpad and must never
be shown as an answer.
**Guarded by** `tests/structured.test.js` — "under a schema, the reasoning channel carries the
payload" and "without a schema, the reasoning channel is never read" — and `tests/review.test.js`.

## A ceiling without a floor is an exit the model will take

A grammar constrains generation from the first token, so a schema keyword is not a preference — it
is the set of tokens the model is permitted to emit next. Putting `maxItems: 3` on the reasoning
field to stop a runaway produced `analysis: []` in **six tokens**: the grammar made closing the array
legal immediately, and the model took the cheapest legal path. The cap has to come with `minItems`,
or the field has to be something with no early exit — a bounded string, which is what shipped.

The general rule: a ceiling on *output* is safe, a ceiling on *thinking* needs a floor beside it.
Before adding any schema constraint, ask what the cheapest string the grammar now accepts is, because
that is what you will eventually get.
**Guarded by** `tests/structured.test.js` — "every string and array in the schema carries a ceiling"
(the growth guard) — and ADR 004, which records why `analysis` is a string and not a list.

## `key in object` is not "the object has this key"

`in` walks the prototype chain, so every plain object "has" `constructor`, `toString`, `valueOf`,
`hasOwnProperty` and `__proto__`. `matchesSchema` used `!(key in properties)` for its
`additionalProperties: false` check, so a reply carrying an extra key named after any of those
passed as conformant — and that check is the *whole proof* that text taken from `reasoning_content`
is the grammar-constrained payload rather than a scratchpad draft. Use `Object.hasOwn` for any
membership test that decides whether data is trustworthy.
**Guarded by** `tests/structured.test.js` — "a key named after an Object prototype member is still
an extra key".

## Two git commands that "list the same change" do not agree at the edges

`git show <ref>` prints a **root** commit's diff; `git diff-tree -r <ref>` lists nothing for it
without `--root`. Same for a **merge**: `git show` prints a combined diff whenever the result differs
from all parents (a resolved conflict, an evil merge), and `diff-tree` lists nothing without `--cc`.
Pairing them meant the whole-file bodies vanished for exactly the commit a new repository reviews
first, and for every merge that did real work — while the hunks-only note truthfully said the bodies
were absent, so it looked intended rather than broken.

**The merge half was found twice, which is the lesson.** The first fix asserted in this file and in
ADR 005 that merges were consistent because "both produce nothing" — checked against one trivially
mergeable merge and generalised. A review found the counterexample within the hour.

The rule: when two commands are used as two views of one change, name the cases where they disagree
— root commits, merges, renames, deletions, subdirectory cwd — and assert **each**, with an input
that actually exercises it. Agreement on ordinary input proves nothing about the edges, and a
passing check on a degenerate edge case proves nothing about the real one.
**Guarded by** `tests/git-diff.test.js` — "a repository's first commit still sends its files whole",
"a merge commit that resolved a conflict still sends its files whole", "a review run from a
subdirectory still reads the changed files", plus the deletion, rename and binary cases beside them.

## A read that fails must be recorded, not swallowed

`blockFor` returned `null` for any unreadable file, so a path git had listed as changed simply
vanished from the collected set with nothing left to say it had ever existed. During a conflicted
merge `git show :<path>` fails (no stage-0 blob), so `--staged` lost the file — and the prompt then
told the model it had *"the complete current content of every changed file"*, vouching for content
that never arrived. A swallowed error is indistinguishable from "there was nothing there", and the
difference is exactly what the next claim depends on.

`blocksFor` now returns `{ blocks, unreadable }`, the unreadable paths reach `renderFindings`, and
the completeness claim requires the list to be empty.
**Guarded by** `tests/git-diff.test.js` — "a file whose content cannot be read is recorded, not
silently dropped" — and `tests/review-context.test.js` — "a file that could not be read is named,
and voids the completeness claim".

## A second rendering of the same run must carry every caveat the first does

Instance 16, and the sharpest one yet: it happened **inside the module created to prevent it**.
`review-report.mjs` exists so the text report and `--json` sit side by side and cannot drift, and its
own docstring promises "every caveat the text report carries appears here too". It shipped omitting
the context-budget caveat — the text footer says whether the size guard actually ran, and the JSON
emitted a bare `estimatedTokens` with nothing to distinguish a checked figure from an unverified
guess. With the guard disarmed is precisely when an oversized request goes out unrefused.

Two corollaries the same review produced, both worth checking before adding a second view:

- **A field meaning "not determined" must not be read as "did not happen".** `jsonReport` carefully
  emits `null` for the parse-derived flags when nothing could be parsed; a downstream reader treated
  that null as `false`, and a run that answered unreadably vanished from every bucket at once — not
  scored, not cut, not failed — while still counting toward the total.
- **A summary line must report the cause, not the remedy.** A failed run recorded the *last* stderr
  line, and `UserError` writes its hint after its message, so the report showed the advice
  ("Raise `--max-tokens`") as the reason and discarded the fact ("ran out of tokens").

**Guarded by** `tests/review-json.test.js` — "an unarmed size check reaches the JSON, as it always
has the text footer" — and `tests/bench-report.test.js` — "every run lands in exactly one bucket, so
the row accounts for itself" and "a failed run reports what happened, not the advice that followed
it".

## Every field a downstream artifact reads must be validated where cases are loaded

`bench/lib/corpus.mjs` validates the fields a case manifest needs and says so; `dropped` was consumed
unconditionally by the report and checked nowhere. A manifest missing it loaded fine, every model call
was paid for, and the render then died on a raw `TypeError` — *before* the per-run records were
written, so the run lost its report and its evidence together. A validator's promise is only worth the
fields somebody remembered to list, so derive the list from what is read, not from what came to mind.
**Guarded by** `tests/bench-corpus.test.js` — "a manifest without \"dropped\" is refused by the
loader, not by the renderer".

## A library's invisible default outranks the value you configured

Node's global `fetch` is undici, and undici applies its own `headersTimeout` and `bodyTimeout` — 300s
each, reachable from nothing in `fetch()`'s options. An `AbortSignal.timeout()` beside them can only
*lower* the effective bound, so `timeoutSeconds: 1800` was really `min(1800s, 300s)`: **14 of 18
benchmark runs died at five minutes while the config advertised half an hour**, and the error carried
no hint because `describeFailure` matched only `TimeoutError`/`AbortError`. The hint it would have
given — "raise the timeout" — was wrong anyway, which is this repo's signature class: a remedy for a
cause the code never diagnosed.

Two general rules, both earned here:

- **A configured value is not in force until something proves it is.** Nothing in the plugin ever
  observed a timeout above 300s taking effect; the number was read back from config and believed.
- **Fixing the visible half can move the wall rather than remove it.** `stream: true` was believed to
  settle this, because headers then arrive at once (measured: 0.0s). But `bodyTimeout` is the same
  300s and **prefill emits no body**, so a cold 52k-token prompt — 393.7s to its first token — still
  died, now as `UND_ERR_BODY_TIMEOUT`. The claim was written into the backlog as settled before it was
  measured.

The corollary for budgets generally: **bound the thing you mean, not a proxy for it.** The first fix
here reset an idle timer on raw TCP chunks, which an SSE keepalive comment or a role-only delta
satisfies forever — activity that proves nothing about generation.
**Guarded by** `tests/structure.test.js` — "nothing calls the global fetch" — plus the budget tests in
`tests/http.test.js`, and ADR 007 records the measurements.

## A budget that discards its own censored data

**Confirmed 2026-07-28 (OAI-15).** A guard that truncates output leaves *right-censored* data behind,
and the two obvious readings of it are both wrong. `bench/lib/report.mjs` excluded every guillotined
run from recall — half the corpus, 17 of 41 runs, carrying two of the four anchored matches ever
recorded. The opposite reading, folding them in as ordinary runs, is equally wrong: it counts every
finding the run never reached as a confirmed miss.

The rule: **a truncated run's positives are trustworthy and its absences are unknown.** Report the
gap rather than resolving it in either direction.

**And report it under a name that is true.** The first attempt printed a low–high band in the
`defects found` column, which failed the same test one step later: the high endpoint is the
counterfactual that continued reasoning would have found everything remaining, so a wholly censored
run rendered as `0–3/3 (0%–100%)` — overlapping a perfect reviewer, under a heading promising
observation. Uncertainty belongs *beside* the measurement, in its own column and in prose, never
inside a figure whose name claims something was seen.

Two sibling shapes to watch for, both found in the same review:

- **A constant that has to agree with a variable will disagree.** The `analysis` cap was fixed at
  28,000 while the budget paying for it shrank per run; on the largest input the schema's envelope
  exceeded the `max_tokens` actually sent. Nothing had tripped it, so nothing reported it. Derive one
  from the other — `reviewSchemaFor(reserve)`.
- **A test named for a guarantee the code does not give.** Budgeting for eight findings while the
  schema permits twenty is a deliberate trade, not an arithmetic bound — so the test asserts the
  formula, never "the envelope fits". Naming it for the guarantee would institutionalise a false
  claim behind a green tick.

**Guarded by** `tests/review-schema.test.js` (formula and clamps across a swept range of reserves,
and the per-run cut judgement) and `tests/bench-report.test.js` (the band collapses when nothing is
cut; the buckets still sum to the run count). ADR 008 records the measurements.

## A measurement that averages across a boundary it cannot see

**Instance 18 (OAI-18, 2026-07-29).** The benchmark reported one wall-clock number per run and ranged
it across `--runs 3`. That number was two quantities added together, and a server-side prompt cache
moves one by ~37× and leaves the other alone: the same 56,805-token prompt reached its first token in
421.7s cold and 11.5s warm, generating for ~3s in both. The `seconds` cell said `13–425` and was
quoted as a spread in the reviewer. It was one cold run and two cache hits.

Three shapes worth recognising, each of which cost a draft:

- **The reply does not always carry the fact you want to condition on.** LM Studio publishes no
  `cached_tokens` and an empty `stats` object, so nothing observable says whether a run was a cache
  hit. The tempting substitute — "run 1 of a case is the cold one" — is *inference from position*,
  and it is wrong: a first call in a fresh process came back warm because an earlier process had
  prefilled the same prefix. **Position is not evidence.**
- **A derived figure inherits every clock it was not measured against.** Computing generation as
  `durationMs - prefillMs` looks free and is not: `durationMs` starts before prompt building and any
  rejected `response_format` attempt, so a schema rejection alone would appear as seconds of
  "generation" for a reply that generated instantly. **Measure both sides of a boundary inside one
  attempt, or measure neither.** And a null on one side must never reach the arithmetic —
  `durationMs - null` is `durationMs`, which relabels a whole run's wall clock as generation without
  raising anything.
- **A fixture that is only accidentally fixed.** `materialize()` builds a fresh repo per run and
  `--commit HEAD` sends `git show HEAD`, whose first three lines carry the commit sha and date — so
  the "same" case sent different bytes whenever two runs fell in different clock seconds. Inside one
  second they agree, which is what a test reproduces; minutes apart they do not, which is what a real
  run reproduces. **When a test and production sample a clock at different rates, the test proves the
  case that never happens.** The guard therefore asserts the pinned date is in force, not merely that
  two materializations agree — agreement alone passes against the defect.

**A fourth shape, and the one that took two goes to get right.** The sentence explaining the split
wanted a symmetry it does not have. Draft one: *"prefill figures are not comparable run to run;
generation is."* Refuted by the adversarial review — generation moves with how much the model chose
to emit, and this repo has measured 1,709 against 5,450 output tokens on identical input. Draft two
weakened it to *"prefill varied 12× here, where generation — which a cache does not touch — did
not"*, and the very first live run that printed the sentence disproved it in its own row: prefill
1–10s, generation 165–747s. **"The cache does not affect X" and "X is comparable" are different
claims, and the tidy contrast between them is exactly what invites the second to be smuggled in.**
The note now states only the ratio it counted.

**A fifth shape: an aggregate that is correct at N=1.** `prompt tokens` summed `usage.prompt_tokens`
over a case's runs. Every figure ADR 006 quotes came from an N=1 sweep, where a sum *is* the per-run
value — so the column was right for its whole history and became wrong by a factor of `runs` the
first time anything ran a case twice, printing 82,020 for a case recorded elsewhere at 41,016.
The test is not "is this a reduce" — `found`, `anchored`, `unmatched` and `unresolved` in the same
row are reduces and are all correct. It is **what the column's name promises**: a figure the runs each
*sampled independently* (defects found) sums legitimately, while one the runs *share* (the prompt
they were all sent) does not. **Sum what varied per run; never sum what was held constant.** And no
test written at N=1 can tell the two apart, because there the sum equals the value. This one shipped
past a plan challenge, two Codex reviews, a lean review and a mutation check, and was caught only by
asking why two live runs disagreed on a figure that is a property of the input.

**Guarded by** `tests/timing.test.js` (a fake server stalling on both sides of its first token, so a
stamp taken at either end fails; two delays, because one leaves the assertion flaky rather than
false), `tests/bench-corpus.test.js` (the pinned commit date), and `tests/bench-report-timing.test.js`
(separate columns, partial-measurement cells, a computed ratio omitted rather than printed as
`Infinity×`, and a prompt-size column asserted over **three** runs so a sum cannot pass). ADR 009
records the measurements.

## Reviewer notes that are not yet defect classes

- Watch for silent truncation creeping into the context guard. The whole design says refuse loudly
  with measured sizes; a "just trim it to fit" change would produce confident answers drawn from
  half the input.
- Watch for `apiKey` reaching any output path. `setup --json` deliberately emits only `hasApiKey`.
