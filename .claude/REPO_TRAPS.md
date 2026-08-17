# Repo traps — confirmed defect classes

Each entry cost real debugging time here. Prefer promoting a repeat offender to a permanent test
over leaving it in this list.

## Synchronous spawn deadlocks against the in-process fake server

`spawnSync`/`execSync` in a test blocks this process's event loop, so the fake OpenAI-compatible
server (which runs in the same process) can never answer the child's request. The run does not fail
— it hangs until the client's own timeout, which looked like a 204-second suite. Use the async
`runCompanion` helper in `tests/helpers.mjs`.
**Guarded by** `tests/structure.test.js` — "tests never spawn a child synchronously".

## A detached child that holds a descriptor is not detached

`detached: true` and `unref()` decide whether a child *survives its parent*. They decide nothing about
when the parent is observed to have **finished**. That is settled by its descriptors: `'close'` fires
only once every stdio stream the process opened has been closed, and a child inherits its parent's
pipes unless told otherwise. So a background worker spawned with `'inherit'` — or with a pipe — keeps
the submitter's stdout open long after the submitter exits, `tests/helpers.mjs` `runCompanion`
(which resolves on `'close'`, not `'exit'`) does not return, and **`--background` silently becomes a
foreground run**: the test hangs for the length of a real model call and then fails for a reason that
looks nothing like the cause.

The rule: a detached worker writes to a **file** — `stdio: ['ignore', log, log]` — never `'inherit'`
and never a pipe. Its output has to be readable after the fact anyway, which is the same requirement
from the other direction.

One adjacent ordering in the same spawn, equally load-bearing: **`unref()` comes *after* awaiting
`'spawn'` against `'error'`.** Spawn failure is usually an async event, and an unresolved promise does
not keep node alive — unref first and a failed spawn exits the submitter silently, leaving a row
nothing will ever pick up. (The third ordering in a spawn, flags before the prompt, has its own entry
below.)

**Guarded by** `tests/queue-guards.test.js` — "the detached worker never inherits a descriptor from its
parent", which reads `job-spawn.mjs` and asserts both the stdio shape and `detached: true`. It is a
structural guard on purpose: the behavioural symptom is a hang, and a hang is exactly what a test
suite is worst at attributing.

This is the same family as the `spawnSync` entry above — **both are the event loop being blocked by a
descriptor nobody meant to hold** — and it was the single most-reconfirmed finding of the OAI-3 review
rounds, raised again in every pass that looked at spawning.

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

**The fix is one authority, never a patched branch.** `planSelection()` in `model-selection.mjs` is now
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

## A budget handed down as a duration is re-armed by every retry

Found 2026-07-29, by the plan challenge, before any of it was written.

`--max-seconds` was drafted as a duration passed into each request. Two retry ladders nest here —
`postWithDegrade` retries when a server refuses `stream`/`stream_options`, and `requestFindings`
retries *that* when a server refuses `response_format` — so three attempts under a 600s cap could
have run for 1,800s with every individual attempt honouring the number. The fix is to pass an
**instant, not a duration**: an expiry cannot be re-armed, and each attempt subtracts from it.

Two things generalise past the timer.

**The defence was this repo's own unverified note, quoted back as a fact.** The draft argued that a
refused capability is rejected before any generation, so retries cost nothing — which is exactly
what ADR 009's known limits already record as *not established*: a server may prefill before
refusing a field, and nothing here detects it. A caveat written to mark uncertainty had, one feature
later, become the premise of a design. When a design leans on a claim, check whether the claim is one
of ours, and whether we wrote it down as a guess.

**Reporting has to follow the same split as arming.** With one expiry shared across retries, a
later attempt's *remaining* time is not a number anyone configured, so the timer must run for what is
left while the message names what was set — the split `createDeadline` had already made for the
first-token budget, and which the first draft of this one did not copy. Caught by the delta
re-challenge.

## A value read when a timer is armed is not the value when it fires

Same feature, same review pass. `budgetError` gained an explicit `serverResponded`, and the transport
passed `{ serverResponded: state.settled }` — evaluated at arm time, where it is **always false**. A
cap firing after headers would have reported that nothing was heard from the server, which is the
precise falsehood the parameter was added to prevent, arrived at by a different route. It has to be
read inside the callback.

**It then happened a second time, in the same feature, after being written up.** A later review
found the *other* timer needed the same treatment; the fix was applied by copying the first one's
shape — and the wrapping arrow, which is the entire mechanism, was dropped. Two instances, hours
apart, one of them by someone who had just documented the class. Copying a line that works is not
copying the reason it works, and a value read through a closure looks identical to one captured by
value at the call site.

The broader shape, which is the one worth keeping: **an inference that is a safe proxy until a new
case is added to it.** `serverResponded` had been derived from the budget's *name* — every budget
except `first-byte` was assumed to mean a status line had arrived — and that held for as long as
every other budget was armed after headers. A budget spanning all phases broke it silently, and
`cmd-setup.mjs` reads that field to decide whether to tell someone to start a server that is already
running. When adding a case to a set, check what the existing members were quietly guaranteeing.

## A counter is not evidence of what produced it

Found 2026-07-29 by the built-in review, in a fix written hours earlier for a different reviewer's
finding — three of four finders converged on it independently.

`budgetError`'s `received` parameter carries **model text** when `chat.mjs` passes it and **raw body
bytes** when the transport does. A hint added to stop the code asserting unobserved activity branched
on that counter to say *"the model was still generating"* — from the transport, where it counts SSE
framing, keepalive comments and role-only deltas. A server emitting `:\n\n` every thirty seconds
moves it while producing nothing, and `http.mjs`'s own module note already refuses exactly that
inference for exactly that reason. The same count was also printed to the user as "characters", which
overstates a reply by roughly an order of magnitude at ~130 bytes of envelope per delta.

Two things to carry forward. **One parameter carrying two quantities is the defect**, and it survives
because both are plausible integers — the name `received` is true of either. And **a fix aimed at one
false assertion is a normal place for the next one to appear**: this branch existed only because a
reviewer objected to a hint claiming more than was known, and it replaced that claim with a different
one from a worse signal.

## Scheduler ordering is not a tie-break you may report to a user

Same feature. Two budgets due at the same instant: the draft armed the one it wanted to win first and
relied on `setTimeout` resolving equal delays in registration order. Node documents that ordering as
approximate. Which failure a user is told about — and, through `serverResponded`, what they are told
to do about it — is not a thing to leave to scheduler behaviour.

The fix is suppression rather than a race: a cap due no later than an inner budget subsumes it, so
the inner timer is not armed at all. And the guard has to cover the branch **in both directions** —
every end-to-end test set a cap shorter than the inner budget, so reversing the comparison would have
left the whole suite green. The case that makes the others mean anything is the one where the cap is
*longer*.

## A test fixture whose last frame silently overwrites what the test set

`applyFrame` lets the LAST streaming frame carrying a `model` win, and `tests/helpers.mjs`'
`completionFrames` emits a trailing usage frame that carries one. A test for OAI-16 that set the
served model on the text frames alone would have been overwritten by that frame and passed no matter
what the code did — green, asserting the opposite of what it claimed. Any fixture field an
accumulator takes "last wins" on has to be threaded through *every* frame able to carry it, not just
the interesting ones. Mutation-check fixtures like this one: if the assertion cannot go red, it is
decoration.

## Refusing while holding the answer

`planSelection` refused with "this provider offers N models" while `readLmStudio` was already
reading and storing each model's `state`, using it only to gate a context window. A refuse-to-guess
rule is right, but check what the code already knows before applying it — the weak half of a good
rule is refusing over a question already answered.

Its mirror, from the same feature: a *present key* is not a *known value*. `state: entry.state`
creates the property even when the value is `undefined`, so `'state' in model` is true for a
response that said nothing about state. Testing presence rather than value would have concluded
"none loaded" from no evidence at all. Partial coverage is the same defect one step along: a
conclusion drawn over a subset asserts something about the whole.

## One authority, two inputs — the setup-vs-task class, with its sign flipped

The nine-instance entry above says the cure for "setup promises what a task refuses" was a single
authority: both paths call `planSelection`. OAI-16 found the loophole. Both callers *did* call it,
and they still disagreed, because `/oai:setup` probes the server unconditionally while
`resolveTarget` used to skip the probe for a fully configured profile. Same function, different
evidence, opposite verdicts — setup printed "No provider can take a task right now" about a task
that ran fine.

**A shared authority only agrees if its callers hand it the same input.** When adding a rule to
`planSelection` (or any such single authority), check what every caller passes as well as that they
call it. And note the direction is not the safety: this instance was the *safe* direction and still
had to be fixed, because a false refusal in the status command is a lie about the task command.

## An invariant enforced in a different file from the one that depends on it

`case-rows.mjs` computes `scored + truncated + unreadable + failed = runs`. Three of those buckets
filtered `!run.error` themselves; `scored` did not, and stayed correct only because `run.mjs`
declined to attach a score to a failed run. `unreadableRuns` documents this exact hazard about
itself — "the assumption holds only while run.mjs attaches a score to every parsed reply, and
nothing here would notice if it stopped" — and it came true the moment a run could carry a report, a
scoreable reply and a failure at once. Enforce a sum's precondition where the sum is computed.

## A figure quoted as measured that traces to nothing in the cited evidence

Confirmed 2026-07-30 by the lean review, in documentation of the OAI-19 attempt — twice in one
diff, both in prose whose stated job was to keep claims bounded:

- The MoE's context window was written as `71,936` beside a citation of the bench records — which
  contain no window field and explicitly log "context window unknown" for that model. The number
  was real (read live off `lms ps` mid-session) but its provenance existed only in the session, so
  in the record it was indistinguishable from an invention. **A true number with no traceable
  source decays into "neither now checkable" the moment the session ends** — the same failure ADR
  006 opens with. Fix: state the provenance beside the figure, or cut the figure.
- The dense arm's two anchored true positives were summarised as one catch found "in both attempts
  independently". The records show two *different* defect ids, one per attempt, neither found
  twice — the claim asserted replication the evidence refutes, in the passage written to stop the
  reviewer being overrated.

A third instance then appeared **in the fix for the second**: the reworded passage claimed the two
catches were "the first anchored true positives on a real commit diff", refuted by a record two
days older (`2026-07-28T07-57-15-522Z.json`, same case, same mode, same defect id, the old MoE
quant) — and by the same file's own "four anchored matches ever produced" line. The class
regenerates at fix sites; check every superlative against the record set, not against memory.

The rule: **every number, replication claim or superlative in a summary must be re-derivable from
the artifact the summary cites** — a session observation goes in with its provenance named, or not
at all.
Prose entries in BACKLOG/ADRs have no test harness, which is why this class lands there: the lean
review's trap finder is currently the only guard, so keep it primed with this entry.

## A timer used as WORK, unref'd like a watchdog

Every timer in this repo is a budget — a watchdog that must never keep the process alive — so
`unref()` is the reflex. The retry delay is the opposite: it *is* the work. Unref'd, Node found an
empty event loop mid-wait and **exited 0** on a run that had failed and was about to try again,
printing nothing. Caught by the existing suite (2026-07-31, OAI-20).

The rule: **before `unref`-ing a timer, ask whether the process finishing during it would be
correct.** For a budget, yes. For anything the program is waiting *on*, no.

## Warm/cold eligibility derived from identity without asking what the server did

A retry re-sends a byte-identical prompt, so "same prompt as an earlier request" looks like a
sufficient test for "the server could serve this from cache". It is not — it says nothing about
whether the earlier request was ever *processed*. Two instances in one build: a capability degrade
changes only `stream`/`stream_options`, leaving the messages identical, so every degraded run's
answering attempt was marked warm and its prefill silently dropped from the benchmark's cold
samples; then the fix's own first version accepted a raw socket byte count, which keepalive frames
satisfy.

The rule: **eligibility needs evidence of model execution, not of message identity** — here, a
measured `prefillMs`. And note the asymmetry that decides ties: over-marking DELETES real
measurements with no trace, under-marking quotes a possibly-warm figure beside a caveat. Only the
second failure is one a reader can see.

## An outcome inferred from a status code rather than recorded by the layer that acted

A 400 that the plugin answers by sending a different shape is negotiation; a 400 that is terminal is
a failure. Both look identical at the catch site. Classifying on the status alone was wrong in both
directions within one build: first every capability refusal was recorded as a server *fault*
(a server refusing `stream_options` would have headlined a 50% failure rate while answering 100% of
shaped requests), then the fix over-corrected and marked *every* 4xx as negotiation — hiding
terminal failures like a context-limit rejection behind a claim that another shape was accepted.

The rule: **an outcome that depends on what the program did next must be recorded by the code that
does it**, not inferred from what the server returned. `refuseLast()` is called only on the branch
that actually sends the replacement.

## Child-process argv built prompt-before-flags

`/oai:task` deliberately refuses a flag-looking word inside the request text, so an argv with the
prompt first is rejected in milliseconds. The bench warm-up built exactly that, and because warm-up
*records* its outcome rather than throwing, an arm would have carried on with a `warmed` entry that
had warmed nothing and a first case still paying the model load. Invisible except by running it —
and a `durationMs` of 84ms against the expected ~11s was the only tell. Guarded now by
`tests/bench-warm-up.test.js`.

## A fix reported as landed that a stash cycle dropped, behind a test that could not see it

Two failures compounding, 2026-07-31 (OAI-20). A `git stash push`/`pop` — run to test whether a slow
suite was caused by the code or by machine load — silently dropped one file's edit. `git diff --stat`
afterwards *listed that file as modified*, so the check that should have caught it read as fine. And
the regression test written for the lost fix was **vacuous**: its subject was the ORDER of two calls
inside `degraded()`, but it hand-built the ledger and exercised the primitives directly, so it passed
identically with and without the fix. The suite was green, the commit message said the fix had
landed, and neither was true. What caught it was a reviewer reverting the fix and observing the suite
stay green.

Two rules, and the second is the load-bearing one:

- **After any stash, checkout or restore cycle, re-verify the specific edits by CONTENT** — grep for
  the changed line — never by `--stat`, which reports a file as modified whatever survived in it.
- **A test whose subject is call ordering must drive the call.** Testing the primitives it orders
  proves nothing about the order, and reads as coverage. The general form: when a test's claim is
  about *where* something happens, exercising *what* it does cannot establish it.

## An ordering that carries an invariant, pinned by nothing

**Confirmed 2026-08-01** by the OAI-23 wide review, which proved it by mutation rather than by
argument: moving `capBudgets` below `ledger.begin` in `postWithDegrade` left all 370 tests green
while reopening the exact defect OAI-23 had just closed on the capability-rung path — a refusal
reclassified as benign negotiation for a replacement that was never dispatched, plus a phantom
ledger entry for a request that never went on the wire.

This is the sibling of the vacuous-ordering-test trap above, and the harder one. There the test
existed and proved nothing. Here **no test existed at all**, because the two statements sit a few
call frames apart and the window between them cannot be reached behaviourally: the transport arms
the remaining cap as its own deadline, so a request can never *complete* after expiry, and any
end-to-end test trying to land an expiry in that gap is a coin flip.

- **When an invariant is carried by the ORDER of two adjacent statements, and the gap between them
  is too small to reach behaviourally, write a structural guard** — a source-text assertion that one
  precedes the other, in `tests/structure.test.js`. Timing cannot pin it and a behavioural test that
  tries will be flaky, which is worse than none.
- **Strip comments first** (`withoutComments`), or the guard matches the prose explaining the
  ordering and passes vacuously.
- **Absence of either token must FAIL**, not silently pass. A rename has to break the guard, not
  disable it.
- The tell that you need one: you have just written a code comment explaining why two lines are in
  the order they are in. That comment is an invariant with no test.

## Reviewer notes that are not yet defect classes

- Watch for silent truncation creeping into the context guard. The whole design says refuse loudly
  with measured sizes; a "just trim it to fit" change would produce confident answers drawn from
  half the input.
- Watch for `apiKey` reaching any output path. `setup --json` deliberately emits only `hasApiKey`.

## Rewording an error discards its classification

`provider.mjs` `describeFailure` improves a transport failure's message — it is the only layer that
knows the provider's name and its start hint — and it did so by constructing **fresh** `UserError`s
for `ECONNREFUSED`, `ENOTFOUND` and `EAI_AGAIN`, silently dropping `reason`, `code` and `cause`.

Invisible for months, because losing a reason only matters once something reads it. OAI-22 split the
retry set and the cost surfaced at once: `EAI_AGAIN` was classified retryable and then reached
`answerWithRetry` with no reason at all, so it was never retried; and terminal DNS and refusal
attempts entered the attempt ledger as `unclassified`, beside genuinely unrecognised failures, in
the very `Failures by reason` table the benchmark exists to make readable.

The rule: **the message belongs to the layer that knows the provider; the verdict belongs to the
layer that saw what happened.** Any code that rebuilds an error to improve its wording must carry
`reason`, `code`, `cause` and `serverResponded` across — that is what `reword()` exists for.
**Guarded by** `tests/transport-classification.test.js` — "a classified failure keeps its reason
through the provider rewording" and "an unresolvable host keeps a NAMED reason", both of which drive
the real `request()` boundary.

## A claim verified at the producer can be false at the consumer

The sibling of the trap above, and the reason it survived a probe designed to catch exactly this.
OAI-22's step-1 probe claimed "an unresolvable hostname is retried three times", citing
`http-errors.mjs` and `failure-shape.mjs`. Both were checked and both were **true as cited** — the
defect was one layer up, in a wrapper the claim never named. It then survived the grill, seven
plan-gate rounds and all of phase 1's tests, because every test constructed the error at the
producer and asserted on it in place.

The rule: when a claim is about what a value **reaches** — a retry predicate, a ledger, a report —
state it as an assertion about the endpoint and cite the path, not one file. At least one test must
cross the real boundary rather than build the value and assert on it where it was built. A ten-line
script driving the production entry point settles it in seconds; here it printed
`reason=undefined ... retryable=false` and ended the argument.

## Untracked files are invisible to the review workflow

A review stage that scopes itself with `git diff` does not see untracked files. Observed in the
since-retired `review-lean` workflow, whose scope agent said so in its own output ("need `git add -N
<file>` first") — but the trap belongs to any stage that takes its scope from a diff rather than
from the transcript. During OAI-22 that meant a newly extracted 109-line production module,
`scripts/lib/stream-collect.mjs`, was very likely never read by any of the five finders, while the
review still reported clean. Worse, `git commit -am` would have shipped
`chat.mjs` with those lines *removed* and the module they moved into absent — a tree broken on any
fresh clone, with the local suite green because the file existed in the working tree.

**`git add` new files before launching a review pass, and check `git status` before the commit
gate.** A review that cannot see a file has not reviewed it, and "no findings" from a run that never
read the code is the incomplete-run trap wearing a different hat.

## A guard justified by "this cannot be tested" carries an untested claim

**Three confirmed instances, and the first two were found only when the third was being fixed.**
`tests/structure.test.js`'s two cap-ordering guards each justified their own existence with "it
cannot be reached behaviourally" and "unreachable behaviourally for the same reason". Both were
false: moving `capBudgets` below `ledger.begin` turns `tests/failure-shape.test.js` red, and the
narrow mid-window case is reachable by replacing `globalThis.performance`, which `capBudgets` reads
bare. OAI-25 then reproduced the class **in its own fix**, shipping a comment that read "No mutation
distinguishes the two placements" — a claim about all possible mutations derived from one experiment,
caught in review. A third instance survives at `tests/structure.test.js:222,230` (moved from
`:279,287` when the ratchet retirement deleted 57 lines above them, 2026-08-17) ("nothing
behavioural can pin it", "A test cannot make Node drop the code on demand"), filed as OAI-30.

The class is not "the guard is wrong" — all three guards are correct and earn their place. It is
that **the justification is a load-bearing claim nobody tested**, and it is self-protecting: a
reviewer who reads "this cannot be tested" stops looking for the test. The damage is that a
structural guard gets treated as a substitute for behavioural cover rather than as a localisation of
where a rule lives.

**The rule: never justify a guard by asserting untestability. State what was TRIED and what it
cost.** "A controlled clock reaches this; the guard localizes the contract" is checkable. "This
cannot be reached" is a claim about every possible test, and this repo has now been wrong about it
three times.

**Checked by hand**, since it is prose rather than code: grep the changed test files for
`cannot|impossible|unreachable|never reach|no (mutation|test)` and confirm each hit states a
mechanism or an experiment, not an impossibility.

## Reader-facing prose asserts a property of a whole class from one sub-population

**Six confirmed instances in a single feature (OAI-26, 2026-08-01/02), each found by a different
reviewer, each in the text written to fix the one before it — and three of them landed AFTER this
entry was written, by the author who had just written it.** That is the entry's most useful fact:
documenting the class did not stop the class. The subject was two paragraphs
explaining reason codes in the benchmark's reliability report — prose, no logic, and every draft was
wrong about the code it described:

1. "`non-retryable-transport` is **not a reachability finding**: TLS certificate rejections, protocol
   errors and parser errors all reached a peer." True of those three examples; false of the class.
   `ENOTFOUND` and `ECONNREFUSED` are deliberate exclusions from `TRANSIENT_CONNECT_CODES`, so they
   carry that reason and reached nothing. **The instruction came from the tracker item itself** —
   inherited, not invented, and shipped unexamined until a wide finder read the whitelist.
2. "The code that prompted it is not carried in this report." False: `report.mjs` prints a dead run's
   whole stderr, and a Node syscall message embeds the code verbatim. The plan file had *already
   recorded* this — the prose contradicted its own author's note.
3. "The message under 'Logical runs that did not complete' **usually** names the underlying code."
   False for precisely the examples the same paragraph cites: a TLS rejection's message is the words
   "certificate has expired" and contains no `CERT_HAS_EXPIRED`. The claim held only for the OS
   syscall sub-population — and the test written for it hand-picked `EHOSTUNREACH`, a message chosen
   because it embeds the code, so the assertion passed by demonstrating the pattern only where it was
   true.

The class is **not** "prose is unreliable". It is that a sentence naming two or three examples reads
as illustration while functioning as a universal quantifier over a set the author never enumerated —
and unlike a wrong branch, nothing goes red. Instance 3 is the sharpest warning: it was written *as
the correction* to instance 2, by someone who had just been shown the class.

**The rule: prose about a code may claim only what the record holds.** Do not characterise a
population you have not enumerated, and do not tell a reader where else in the output a fact can be
found — that is a claim about every path that produces the output. When a draft names examples, ask
what the set is and go read it; when it says "usually", "all", or "not", it is quantifying.

**A fixture chosen to make a claim true is not evidence.** If a test supplies the input that
demonstrates the pattern, add the case the fixture avoided — the TLS wording sits in
`tests/transport-classification.test.js` and refuted the claim in one line.

**The class reproduces at the TEST level, which is instances 4–6 and the reason this entry grew.**
The fix for instance 3 added a two-fixture test whose comment claimed the pair "proves the
difference" — but the paragraph is static prose gated only on a reason code and never reads
`run.error`, so both fixtures assert identical facts and a verifier turned one to junk with the suite
still green. Alongside it, `assert.match(markdown, /`shape-rejected`/)` was matching the *count
table* row rather than the prose it was written to pin, and the `sawReason` discriminator survived
`key === code` → `key.includes(code)` untouched, though `transport` is a substring of
`non-retryable-transport` and the loosened gate prints the wrong paragraph. **A test written to guard
a claim is itself a claim.** Prove it the way those three were proved: mutate the thing the assertion
names and watch it go red — a green suite after the mutation means the assertion was never about
that thing.

**Instance 7 is the fix for instance 1, and it is the subtlest of the set.** OAI-31 replaced the
false "the reason code is all an attempt record carries" with "the attempt record has no
peer-reachability field" — which *reads* as the narrow, specific form this entry asks for and is
not. It quantifies over the **meaning** of every field that might ever exist, so it goes false via
a field named anything at all, and the test written to pin it (`Object.hasOwn(entry,
'serverResponded') === false`) could drift from it in **both** directions: a future `peerReached`
falsifies the prose while that assertion stays green, and `serverResponded` is not peer-reachability
anyway — a TLS rejection reaches a peer and obtains no response. A blind re-ask caught it; the
thread-carrying round before it did not.

**The rule that came out of it: do not assert what a record LACKS — enumerate what it HOLDS.** An
absence is a claim about an open set and cannot be pinned; a closed list is checkable in one place.
The paragraph now names the ten fields, and the test pins the whole key set rather than one name,
which couples it to every ledger addition **on purpose** — a new field is exactly when a human must
re-read the sentence.

**And the enumeration is only half-guarded, which the entry must say rather than imply.** A key-set
test pins the list the prose must describe; it cannot read English. The first enumeration named
**eight** of the nine — `outcome` was missing — with that test green, and a reviewer found it. Note
also that a field's *name* is not its meaning to a reader: `cause` is `{answerAttempt, degrade}`,
why the attempt was initiated, and rendering it as the bare word "cause" inside a paragraph about an
unknown failure cause reads as the opposite of what it holds.

**Instance 8 was in a BACKLOG ITEM, not in code, and that is the new part.** OAI-35 was filed saying
it would "let the reliability report split failures on whether a peer was reached", and that it
"removes the limitation rather than describing it". Both were false in the same way as the rest of
this entry: the field it adds, `serverResponded`, settles whether an **HTTP response was obtained**,
which is true of a strictly smaller set. `ENOTFOUND` contacted nothing, `ECONNREFUSED` reached a host
that answered with a reset, and a TLS rejection reached a peer outright — all three record `false`,
so the reachability axis is exactly as unsettled as before. Caught at the plan gate's **blind**
re-ask, after two rounds carrying the finding thread had passed it — the second time in this file
that blindness found what the thread could not.

The consequence to notice is that **a refuted premise in a tracker item is more dangerous than one in
code**, because it is what the next session reads to decide what to build, and nothing executes it.
Had the plan inherited the framing, the work would have deleted ADR 012's rejection of the name
`unreachable` as an obsolete limitation, and a reader of the report would have been handed a
reachability finding that no record supports. The fix was to keep the hedge, correct the
`ECONNREFUSED` clause beside it, and name the axis in both the prose and the table title.

**Guarded by** `tests/bench-reason-notes.test.js` — the two-axis pair, which asserts the response
clause and the reachability hedge together so neither can be dropped alone; the enumeration against a closed ledger entry
(proved twice: simulating that copy turned it red, and OAI-35 then landed it for real and turned it red again, with the message the test was written to print); the `transport`
paragraph's absence from a `non-retryable-transport`-only sweep, which is the gate `key === code`
holds and `key.includes(code)` breaks; the `shape-rejected` assertion scoped through
`paragraphAbout` rather than matching the count-table row; and the two-message fixture whose halves
assert different things. **The prose sentences themselves are still checked by hand**, since no test
can read English: for each factual sentence in reader-facing output, name the set it quantifies over
and the file that defines that set. If the sentence cites examples, confirm the examples are
representative rather than the only members that work.

## A validity guard that narrates instead of refusing

Confirmed 2026-08-03 by the OAI-24 review, where **three independent lenses converged on eight
instances in one new file** — `advisor`, both Codex stages, and a wide `review-lean`. The shape: code
detects that its own preconditions failed, says so, and then carries on as though they held.

The canonical instance printed `ABORT: ... The challenge would test nothing.` to stderr and then
fell through to `return`, so the caller ran the full ~45-minute experiment and wrote a record with a
real verdict and a zero exit code. The word named an action the code never took.

The variants all follow from the same reflex — *report the problem* rather than *refuse the result*:

- **A fallback that launders a failure into a measurement.** `firstTokenMs ?? durationMs` let a
  request that timed out at 1,800s satisfy a "prefill must exceed 180s" gate, because the wall clock
  stood in for a measurement that was never taken.
- **A read-back that nothing consumes.** The applied TTL was read from the server specifically to
  detect a mismatch, then the verdict was computed against the *requested* constant — making the
  check decorative.
- **A disqualifier that only warns.** A mismatched treatment printed a WARNING and the episode was
  classified anyway.
- **A contradiction resolved silently in favour of the happy path.** A request that succeeded while
  residency showed the model unloaded was recorded as a clean survival.

**The tell**: a branch whose body is only `process.stderr.write(...)` or a `WARNING` string, sitting
in a function whose caller acts on the return value. Ask what the *caller* does differently — if the
answer is "nothing", the guard does not guard.

**The rule**: a precondition failure must be visible in the **return value or an exception**, never
only in output a reader has to have been watching for. Where a run produces a record, the
disqualification must be *in the record* — the reader of a JSON artifact never saw the stderr.

**Guarded by** nothing committed yet, and that is deliberate: the driver these were found in was
**withdrawn** from OAI-24's commit (see OAI-34). Its tests — calibration-not-cleared,
unconfirmed-TTL, survived-despite-unload, mixed-sweep — each assert the refusal rather than the
message, and land when it does.

**The meta-lesson, which is the reason this entry exists at all.** Pass 1 of the review found eight
instances in one new file; pass 2 found ten more, **one introduced by pass 1's own fix**. Every one
was in decision logic that had never executed against a real server. Review caught them all and
review was not converging. When a new module's job is to *decide* something, get it running against
a stub before reviewing it harder — reading cannot substitute for the one thing that exercises the
branches.

## A test that manufactures the evidence it claims to guard

Confirmed 2026-08-04 by OAI-35's second review pass, where **both Codex lenses and a `lean-wide`
verifier independently landed on the same test**. The shape: a test is written to prove that some
producer still sets a field, and it builds its own input with that field already set.

The instance. `serverResponded` is minted at nine sites; for the `protocol`/`bad-json`/`transport`
family it is the *only* evidence a response arrived, since those errors carry no HTTP status and are
no completion shape. A test was written for exactly that risk — and its input was

```js
Object.assign(new Error(reason), { reason, serverResponded: true })
```

so it exercised `fail()` copying a flag, never any site setting one. Its own comment claimed that
dropping the write at `sse.mjs`, `body.mjs` or `http.mjs` would leave the suite red. A verifier
deleted the write in `body.mjs`'s `bad-json` branch and ran all 415 tests: **green**.

**The tell**: the test constructs the object under test rather than obtaining it, and the assertion
names a value the construction supplied. Read the fixture and the assertion together — if the
asserted value appears literally in the setup, the test cannot fail for the reason it was written.
The comment is often the giveaway, because it describes a *deletion elsewhere* that the test has no
path to.

**The rule**: a test that a PRODUCER still does something has to run the producer. Reaching it needs
a fixture that gets there — here, a fake server returning a non-JSON document (`body.mjs`) or a
malformed SSE frame (`sse.mjs`) — and the test must pin the reason code too, or a scenario that stops
reaching its branch still passes on some other site's flag. Where a site genuinely cannot be reached
(`body.mjs`'s oversized-document branch needs 8,000,000 characters), say so in the file as an
uncovered gap rather than letting a nearby passing case imply coverage.

**And the derived rule, which is the more useful half.** Where a fact has a single witness that
depends on a site *remembering* to set it, prefer a witness that is *derived from work already done*.
`obtainedResponse` gained a fourth: a measured `prefillMs`, stamped at the first frame carrying model
text, which proves headers arrived without any site remembering anything. Redundancy that relies on
discipline is not redundancy.

**Guarded by** `tests/attempt-response-sites.test.js`, which drives **three** minting sites end to
end — `http-errors.mjs`'s delivered-body path, `body.mjs`'s `bad-json` branch and `sse.mjs`'s
`protocol` branch. Deleting any one of the three flag writes reddens exactly its own case, each
verified by mutation. **Two further sites are named there as uncovered** and are not claimed:
`http.mjs`'s `!response.complete` branch, which no fixture reaches, and `body.mjs`'s
oversized-document branch, which needs 8,000,000 characters.

**And the sting, which is why this entry has a second half.** The first version of that file made
this exact error one round later. Its `http.mjs` case delivered model text before cutting the socket,
so the *fix* for this trap — a fourth witness deriving the answer from a measured prefill — silently
satisfied the assertion, and deleting the flag write left the suite green. A debug stack then showed
the case never reached `http.mjs` at all. **A redundant witness added for safety will mask the test
that guards the thing it is redundant with.** So: drive a minting-site test with the flag as the
*only* available evidence — here, a role-only SSE delta, which is bytes without text — and run the
mutation rather than reasoning about it. Every claim of "guarded by test" in this repo has been wrong
at least once; the mutation is the only thing that has not been.

**Related**: this is [A guard justified by "this cannot be tested"](#a-guard-justified-by-this-cannot-be-tested-carries-an-untested-claim)
one turn further on — there the claim was that no test was possible, here a test existed and proved
something else. Both are self-protecting: the passing test is the reason nobody looks again.

## A reassuring measurement taken after the thing being measured is gone

Confirmed 2026-08-05 (OAI-58 ladder), by two security agents reaching **opposite** conclusions about
the same file from the same repo on the same day.

`job-store.mjs` opens SQLite in WAL mode and chmods `jobs.db` to `0600`. One agent measured the state
directory after its probe finished and reported: "state dir 700, `jobs.db` 600, `logs/` 700 — no
WAL/SHM left behind with looser modes after close." The other measured **with a handle still open**,
and after a `SIGKILL`, and found `jobs.db-wal` at `-rw-r--r--` **holding the prompt and the full text
of every attached file, while `jobs.db` held neither** — because pre-checkpoint the row lives only in
the sidecar.

Both measurements were correct. SQLite **removes the WAL on a clean close**, so the tidy-looking
observation was taken at the one moment the defect cannot exist. Had only the first been recorded,
OAI-65 would read as refuted by evidence.

The class is wider than SQLite: **anything that cleans up after itself cannot be characterised by a
post-hoc `stat`, `ls` or `ps`** — temp files, lock files, sidecars, a child process's descriptors, a
`.tmp` written and renamed. The window in which the artefact exists is the window that must be
sampled, and "I looked afterwards and it was fine" is not evidence about it.

**How to sample it:** hold the resource open and measure from a second process; or kill -9 mid-flight
and measure the wreckage. Both are what the second agent did, and both are cheap. Pair with the
repo's standing positive-control rule: a check that samples the wrong window is one that *cannot*
fail, which is the failure mode [A test that manufactures the evidence it claims to
guard](#a-test-that-manufactures-the-evidence-it-claims-to-guard) describes from the other side.

**Related**: [A claim verified at the producer can be false at the
consumer](#a-claim-verified-at-the-producer-can-be-false-at-the-consumer) — that one is wrong about
*where*, this one is wrong about *when*.

## A terminal verdict inferred from an intent flag rather than from what happened

Confirmed 2026-08-05 (OAI-58 ladder), executed with a positive control.

`job-reconcile.mjs:30-33` decides a dead worker's terminal state by asking whether
`cancel_requested_at` is set. If it is, the row is published `cancelled` with `failure: null` and
`outcome: null`, returning before the `worker-died` branch that would have recorded a reason. The
probe reconciled **the identical abrupt death** (a real child `SIGKILL`ed while `running`) twice: with
no cancel pending it produced `worker-died` / `failed`; with a cancel pending, `cancelled` and no
diagnostic at all. The control fired, so the code *can* tell the two apart — it simply never asks.

The flag records that a user **asked** for something. It is not evidence the thing **happened**, and a
crash that merely coincides with the request is filed as a clean success. Worse, the crash is the case
that needed the diagnostic, and `job-render.mjs`'s `noteFor` prints no note for terminal `cancelled` —
so the information is discarded silently.

**The rule**: a terminal state is a claim about what occurred, so derive it from a witness the acting
party left behind, never from the request that preceded it. Where no such witness exists — and here it
did not, which is *why* the inference was written — the fix spans the actor, not just the reader: the
worker must record that it exited *because of* the cancel. Changing the reader alone flips legitimate
cancellations to `failed`, which `tests/cancel.test.js:44-101` asserts against.

**Related**: [An outcome inferred from a status code rather than recorded by the layer that
acted](#an-outcome-inferred-from-a-status-code-rather-than-recorded-by-the-layer-that-acted) — the
same substitution of a nearby signal for the fact itself.

## A visibility filter keyed on raw state, where blocker-ness is a derived property

Confirmed 2026-08-05 (OAI-58 ladder), executed. **Fixed by OAI-64, 2026-08-14** — the code below is
history, and the correction underneath it is the part worth reading twice.

As found in 2026-08-05's terms: `job-view.mjs:127` decided what a bare `/oai:status` shows from
another workspace with `row.workspace === cwd || row.state === 'running'`. But whether a row **blocks
the queue** was said to be decided by `job-queue.mjs`'s `queuedRole()`, which returns `blocks` for a
queued row that is live-but-unknown-version, `starting`, or `malformed`. **Every one of those has
`state='queued'`**, so the filter excluded exactly the rows the user most needs to see — while the
file's own comment eight lines above said "a malformed row holding the head of the queue is the one
thing a user most needs to see", and ADR 014 promised the same. (That corpus was deleted 2026-08-13,
OAI-159; the constraint now lives inline at the code it protects.)

**Correction, OAI-64, 2026-08-14 — the diagnosis above was itself incomplete, and building from it
would have shipped a fix that did not work.** Blocker-ness is not a derived property of a row either.
It is a RELATION between two rows: `queuedRole` returns `blocks` only for the *pathological* shapes,
while an ordinary live known-version queued row returns **`head`** and still blocks everyone behind it,
through `decide`'s `row.seq !== seq` branch. The reproduction recorded in OAI-64 — a queued job
elsewhere whose waiter is alive but silent — is that ordinary case, so a filter written to the
enumeration above would have passed a test drawn from the item's own transcript and still hidden the
commonest blocker there is. The fix exports the queue's head rule (`scanQueued`) and asks it "blocks
whom?", with the asking workspace as the second operand — and, per the second correction below, walks
the running rung before that head is ever consulted.

**Second correction, from OAI-64's own review pass 2 — and this one is the more useful of the two,
because the FIX made the mistake the entry is about.** The first implementation of that fix consulted
the queued rung alone. `decide` has two rungs: it returns `blocked` from its running loop *before* queue
order is ever consulted. So with a live running row present, the display marked the queued head — a row
the user could clear with no effect — while the row actually holding them sat unmarked below it.
Proven by executing it, not argued. **A display that claims to mirror a decision must mirror ALL of that
decision's exits, in order; sharing one rung of it is what makes the mismatch look impossible.**

The sting, as recorded then: `viewOf()` ran at then-line 125, one line *before* the then-filter, and
had already computed the note ("pid N is alive but has not beaten since 10m ago"). The information was
in hand and thrown away. (Both coordinates are the 2026-08-05 file; neither resolves in today's.)

**The rule**, strengthened by the correction: when a predicate exists in derived form, filtering on the
raw column that *usually* correlates with it will diverge the moment the derivation grows a case the
column does not carry — and before reaching for the derived predicate instead, check that it takes only
one operand. Here no per-row predicate could ever have been right. Two
things make this worse than an ordinary bug — the divergence is silent, and here the discarded display
was the **stated mitigation** for an accepted design risk (the recycled-pid wedge), so a display defect
quietly voided a correctness trade-off recorded in an ADR. **Check whether anything upstream accepted a
risk on the strength of the thing you filtered out.**

## A necessary condition, restated as a sufficient one, in the prose beside it

Confirmed 2026-08-14 (OAI-64), three times in one feature — each instance written while fixing the
previous one.

The marker `/oai:status` prints for a blocking row says *"must clear before this workspace's queued
job can proceed"*. That is deliberately a **necessary** condition: clearing it is required, and
promises nothing about what runs next. The code has been right about this since the wording was
settled. The prose beside it was not, three times: *"takes its turn first"* (refuted at plan round 1,
because a pathological head may never take a turn at all), then *"has to clear first"*, then *"what
to deal with now, not merely something ahead of you"* — each an upgrade to sufficiency, each caught by
a different reviewer, each written into a file being edited to remove the previous one.

**The rule**: when the code states a necessary condition, the prose describing it will drift toward
sufficiency, because sufficiency is what a reader wants and the weaker claim reads as evasive. The
drift is invisible to tests — every one of these shipped green — and invisible to a diff reviewer,
who sees a sentence that matches the feature's intent.

**The check that works**: for each user-facing sentence, ask *what does the code guarantee if the user
does exactly what this says?* Here, clearing the flagged row guarantees only that one obstruction is
gone; another may sit behind it. Where the honest answer is weaker than the sentence, the sentence is
wrong even when the feature is right.

**Related, and the reason this is its own entry rather than a note on that one**: [A visibility filter
keyed on raw state](#a-visibility-filter-keyed-on-raw-state-where-blocker-ness-is-a-derived-property)
is about the *code* misdescribing the queue. This is about the *prose* misdescribing correct code, and
it survived four review passes that were all looking at the code.

## A helper parses the attacker-influenced value you passed it as its own option

Found 2026-08-05 in OAI-5, in a fix the *previous* review pass had just introduced — which is the
whole reason it is written down here.

`agents/oai-delegate.md` canonicalises each attachment path so it can refuse one that resolves
outside the tree. Pass 3 wrote that check with `readlink -f`; pass 4 replaced it with node, to drop a
GNU-utility assumption from a plugin that is generic by construction:

```sh
canon() { node -e '…realpathSync(process.argv[1])…' "$1"; }   # the defect
```

`node -e <script>` does **not** stop option parsing at the script. `"$1"` is still parsed as a node
option, so a repository file named `--require=/tmp/evil.js` is **preloaded and executed**, and one
named `--eval=…` replaces the script entirely — which means the attacker also **controls stdout**, so
the forged path sails through the `case "$real" in "$root"/*)` containment test that follows. Both
were demonstrated: `--require=` ran the payload; `--eval=` exited 0 having printed an in-tree path.
`-- "$1"` refuses both and still resolves ordinary files.

**The rule**: passing a value safely through the *shell* is only half of it. Single quotes, `argv`
arrays and NUL/newline delimiting all stop the **shell** interpreting your data — and none of them
stop the **program you handed it to** interpreting it. Any helper with its own option parser
(`node`, `grep`, `rm`, `git`, `curl`) needs `--` before an argument you did not author.

Two sharpeners specific to this instance. The class was *latent* under `readlink -f` — the same
malicious name produced `illegal option` and rc=1, so the swap to a more capable tool is what armed
it; **a portability fix changed the blast radius of an input the code already accepted**. And the
payload defeats the one check the file advertises as not depending on the agent's compliance, so the
guard's own promise is what it falsifies. **When you replace a helper, re-ask what its argument
parser does with hostile input — equivalence on the happy path is not equivalence.**

## Command substitution silently truncates the value you are about to validate

Found 2026-08-05 in OAI-5, one pass after the trap above, in the same six-line block — and it was
first dispositioned as a low-severity nit on grounds that execution then refuted.

`real=$(canon "$f")` canonicalises an attachment path so the next line can refuse one that resolves
outside the repository. Command substitution strips **trailing newlines**. So for a symlink whose
target's filename ends in a newline, `$real` is the resolved path minus its last byte — a string that
**names a different file, and one nobody canonicalised**. Plant a sibling at that shortened name
pointing outside the tree, and every downstream step behaves correctly on a value that is no longer
the thing that was checked: containment compares the truncated string and passes, `--file` receives
it, and `prompt.mjs` labels the result with the innocent in-tree name.

Demonstrated: attaching `sub/a` (→ `sub/target\n`) with a sibling `sub/target` → `/etc/passwd` sent
the password file while the recorded attachment read `sub/target`. Fixed by making the canonicaliser
itself refuse a resolved path containing any control character, which closes it at the one place both
call sites share rather than at each comparison.

**The rule**: `$(…)` is not a transparent pipe — it eats trailing newlines, and a filename is one of
the few values where that byte is legal and load-bearing. Whenever you capture a path, a name or any
attacker-influenceable string and then *validate* the captured copy, the thing you validated is not
provably the thing you will use. Either forbid the characters that survive the round trip badly, or
never let the value transit a shell at all.

Two sharpeners. **The harm was mis-scoped on the first look** — called reporting-integrity because
"both files are inside the root", which was simply not true of the sibling; a disposition that reasons
about *where the files are* rather than *what the resolved path points at* will get this class wrong
every time. And the defect **forges the very audit trail** the surrounding design tells its reader to
trust, so the mitigation and the exploit share a mechanism.

17. **An export that reads as shipped and is reachable by nothing.** Four instances in one change set
    (Stage 2, 2026-08-05/06): `saveArtifact` gated on a field nothing ever set; `NO_RATE_NOTE`
    documented as "so every caller says it the same way" with no caller; an `unavailable` branch
    matching a stderr string `git apply --check` never emits; and a delegate recipe arm for a flag
    combination the CLI had just started refusing. Each was reviewed by eye and survived, because
    reading a module tells you what it *would* do, not whether anything asks it to.
    **A structural guard was attempted and does NOT work here, which is worth knowing before someone
    tries again.** "Every `scripts/lib` export has a non-test consumer" produces 38 hits, most of them
    wrong: this repo has deliberate test-only exports (`RESULT_SPEC` and the other command SPECs say so
    in their own docstrings — they exist so `tests/plugin.test.js` can check the markdown). Narrowing
    it to "used by nothing at all, tests included" catches only one of the four. So reachability here
    is not syntactically decidable, and the honest control is the review question: **for each new
    export, name the production call site.** If you cannot, it is not shipped.

## A stub gentler than the dependency it stands for

Confirmed twice in one sitting, in the same three tests, so it is a class rather
than a slip.

- `resolvePin`'s failure test used a stub that **returned `''`** where the real
  `git` **throws** — `git rev-parse <unknown>^{commit}` exits 128, so
  `execFileSync` raises. The refusal being tested was therefore dead code in
  production while the test stayed green, and a user with a typo'd `--from` got a
  raw `Command failed:` instead of the crafted message.
- The same file's happy-path stub **ignored `args[1]` entirely**, returning its
  configured SHA whatever revision was requested. A reviewer mutation-proved it:
  replacing the call with a hardcoded `['rev-parse','HEAD']` — dropping both the
  ref and the `^{commit}` peel — left the whole suite passing.

**The test is not "does the stub return the right value" but "does the stub FAIL
the way the real thing fails".** A dependency that throws must be stubbed by
something that throws; a call whose ARGUMENTS carry the meaning must be stubbed by
something that records them. Both stubs were written in one sitting beside a
sibling test that does capture its arguments — proximity to a correct example is
not protection.

**No repo-wide scanner is proposed for this**, deliberately: a grep for "stubs
that return sentinels where the real call throws" cannot be written so that it
fails reliably, and a guard that cannot fail is the very defect this file exists
to record. The guard here is per injection point — for each injected dependency,
the test covering its failure path uses a stub that throws — plus this entry.

## A test that asserts presence where the code guarantees presence

`reported()` sets all five carried caveat fields with `?? null`, so **every key is always present**.
The tests written to guard "every report-derived entry carries the caveats" assert `key in entry` —
which that default satisfies unconditionally. Reading the wrong source field (`report?.hunksOnlyTypo`)
leaves the key there holding `null` and the assertion still passes.

**The assertion tests the SHAPE of the mapping, not that it read the right field.** Where a default
guarantees presence, presence is not evidence; assert the VALUE, from a fixture where the right and
wrong sources differ.

Distinct from the stub-fidelity entry above, and filed separately for that reason: that one is about a
double being kinder than its dependency, this one is about an assertion the production code makes
unfalsifiable. Fifth confirmed instance of "a test that cannot fail" in a single feature, second
distinct shape.

## A sentence that grows one clause per fix ends up asserting something false

**Confirmed four times in one feature (OAI-139, 2026-08-12)**, by four different lenses, always in
prose and never in the mechanism it described.

The shape: a user-visible note or an ADR paragraph states a fact about what the code did. A review
finds a case the statement is wrong about. The fix APPENDS a qualifying clause. The longer sentence
now asserts one more thing that must be true on every path that can render it — and the next review
finds a path where the new clause is false.

The four instances, in order:

1. `adr/005` said the incompleteness note is not raised under `--diff-only`. It is, and a shipped test
   asserted so. Adjudicated FALSE by `codex-adversarial` at confidence 1.0.
2. "the whole-file rung is skipped" was stated unqualified in four artifacts. Only DIFF-COVERED files
   are skipped; pinned and untracked ones always go whole.
3. The ADR called the pinned path "unaffected" — true about the skip, and read as reassurance about
   safety, while those bodies are exactly what still goes unmeasured.
4. The fix for (3) added "Files given with --file, and untracked files, still went whole" to the
   note — asserted on every unsized run, including ordinary tracked-only reviews where **no such
   bodies existed**. The clause added to stop a false claim made a new one.

**What actually worked, after three patches failed**: stop describing the adjacent path in the
user-facing sentence at all. The note now states only what the run OBSERVED — the window could not be
sized, the diff-covered files were not sent whole, here is the remedy — and the ADR carries the
residual. Silence about a path is not a false claim about it; a clause is.

**The tell, and it is checkable before writing the clause**: if the new clause describes something
the note's own firing CONDITION does not require, it will be false whenever the condition holds and
the described thing does not. `skippedUnsizedWindow` requires an unsized window and a non-empty
`changed` list; it says nothing about `files`, which is exactly why a clause about `files` was wrong.

**Guarded by** `tests/review-unsized-window.test.js` — three negative controls that assert the REMEDY
TEXT IS ABSENT, not merely that a flag is false; and `tests/sweep-report.test.js`
"an unsized-window review says WHY, and never re-asserts a measurement", which asserts a FORBIDDEN
phrase rather than only required ones. A test that checks only what should be present cannot catch a
sentence that grew.
