# 011 — Which model actually answered, and picking the one that is loaded

Date: 2026-07-29
Status: accepted
Amends: [ADR 002](002-context-window-detection.md)

## Context

Swapping the local model exposed two halves of one gap: the plugin could not tell you which model
had answered, and it refused to choose a model while holding the evidence needed to choose.

**The server substitutes silently, and it is worse than a stale pin.** The backlog item described a
config pinning a model that no longer existed while LM Studio served another and answered normally.
Probing it produced something broader, in one call:

```
POST /v1/chat/completions {"model":"totally-not-a-real-model", …}
→ 200 {"model":"qwen/qwen3.6-27b","choices":[…]}
```

Not a stale-pin problem: *any* unserved id gets a normal completion from whatever is loaded. HTTP
200, a well-formed reply, no error and no warning. `jsonReport` already recorded the served id
correctly — `result.model || model`, with a comment saying the run belongs to the model that ran —
but nothing anywhere compared it to the id requested, so the fact was recorded and never used. A
benchmark arm can therefore spend its full wall clock on a model it does not claim to test and leave
a record that reads as clean, which is the failure `bench/` exists to prevent.

**Refusing while holding the answer.** ADR 002 established that automatic selection refuses rather
than guesses when several chat models are offered, because the previous silent first-entry pick was
the OAI-2b defect. Correct — but `readLmStudio` already reads `state` from `/api/v0/models` and
stores it on every record, using it only to gate `loaded_context_length`. Live, exactly one model is
`loaded` and four are `not-loaded`. The refusal was being issued over a question the server had
already answered.

## Decision

**One predicate decides what "a different model" means.** `scripts/lib/model-identity.mjs` exports
`substitution(requested, served)`, and the footer, the stderr warning and `bench/run.mjs` all call
it. Two definitions is how the same pair of ids ends up warning on one path and failing a run on
another.

**Exact, with no normalisation.** `matchKey` strips a `@quant` suffix so one model can be recognised
across a server's own endpoints, and reusing it here would be wrong twice. The ids compared are what
*we sent* and what the *same server* sent back, so no dialect translation is involved. And the
suffix names a real identity: requesting `qwen/qwen3.6-27b@4bit` made LM Studio attempt to load a
different model and fail on system resources. A swap between two quantizations of one model is
exactly the A/B contaminant this exists to catch, and normalising would hide it.

**Missing is not different.** `substitution` returns `null` when either id is absent.
`finishAnswer` already falls back to the requested id, so a server that never names a model yields
`requested === served` and cannot produce a false positive. An absent field is "nothing was
determined", never evidence of a swap — the rule `budgetError`'s `serverResponded` had to learn.

**Caught twice: before the run, and after it.**

- *Before.* `planSelection` refuses an id the catalogue does not list, on both the `--model` and
  `defaultModel` paths, so a wrong id costs a refusal in milliseconds instead of a full run.
- *After.* The reply-time comparison warns on stderr and renders inside the footer's `model:` field
  — `model: <served> (requested <requested>)`. Inside that field rather than on a line of its own,
  because it is the field a reader consults to learn which model produced the output, so the
  correction belongs where the mistake would otherwise be read. A separate warning line is skimmed;
  this one cannot be.

**A substitution warns; it never fails the run.** The work is already paid for, and discarding it
would be worse than reporting it — ADR 008 records what discarding runs cost when it was tried.

**Selection reads `state`, under two conditions.** When several chat candidates remain and none was
named, the one the server reports `loaded` is selected. That is a fact being read, not a guess: ADR
002 **already treats `loaded` as authoritative**, which is exactly why `loaded_context_length` is
trusted and `max_context_length` is not. The OAI-2b defect it warns against was taking the *first*
entry, which is arbitrary; this is the only entry the server has committed resources to. The two
conditions:

1. **Every candidate carries a recognised state**, not merely one. `readLmStudio` writes
   `state: entry.state` unconditionally, so the property exists even when the value is `undefined` —
   testing for the key would call a stateless response observable and then report "none loaded".
   Partial coverage is no safer: a candidate whose state is unknown might be the loaded one, so a
   0-loaded or 1-loaded conclusion drawn over an incomplete set asserts something nobody measured.
2. **The record was joined on an exact id.** `merge` transfers the dialect record through a
   `matchKey` join. That is conservative for the embeddings denylist — a loose hit can only *add* an
   exclusion — but here it would become a routing decision: `/v1/models` offering `qwen@4bit` while
   the dialect reports `qwen` as loaded would select and send `qwen@4bit`, an id no evidence said was
   resident. Same data, two trust levels, so `merge` records `exactMatch` per record.

A non-empty string is the whole test for "recognised" — no list of vendor state values, for the
reason ADR 002 gives about every other field here: shape, not vocabulary.

**"None loaded" is its own message.** "No model can answer a chat request" and "several can, none is
resident" are different facts with different remedies — one needs a download, the other a load.
Several loaded at once is also its own message, listing them and asking. **Nothing measured says a
server holds only one model resident**, so the code does not depend on it.

**The choice names its evidence.** `planSelection` returns `because: 'loaded'` and `/oai:setup`
says so, in both renderings. ADR 002's standing rule is that a reported fact names its source so a
guess never looks like a measurement; a selection made from evidence should say which evidence.

## Consequences

- **`resolveTarget` now always fetches the model list, superseding an ADR 002 consequence.** The
  first version of this feature left the refusal *opportunistic*: `resolveTarget` probed only for
  what the config left unanswered, so a profile carrying both `defaultModel` and `contextLength`
  never fetched a catalogue and never got the check. That was documented and tested as a compromise
  — and it was wrong, in a way the compromise framing hid. `/oai:setup` probes **unconditionally**,
  so it *did* refuse: it printed `reachable, but /oai:task cannot run here` and `No provider can take
  a task right now` about a task that ran perfectly well.

  That is this repo's most-repeated defect class with its sign flipped. ADR 002's own consequence
  says setup determines readiness "by calling `planSelection()` — the same function the task path
  uses — rather than approximating it", because two review rounds produced nine instances of setup
  promising what a task refused, and "the cure was a single authority, not a better approximation".
  **One authority is not enough if its two callers feed it different evidence** — the cure needs one
  *input*, and teaching setup this function's probing rule would just be a second copy of it.

  The cost is one `/v1/models` GET against a server the next line is about to post a whole prompt
  to, and it is not really a new cost: ADR 002 already discourages setting `contextLength` at all
  (a stale value silently outranks correct detection, which is why it was removed from the author's
  own config), so the recommended configuration was already probing on every task. Confirmed by the
  built-in review, reproduced end to end.
- **The refusal is gated on `catalogued`, not on `source`.** llama.cpp's `/props` and TGI's `/info`
  are recognised dialects that publish no per-model list, so `described.models` falls back to the
  bare `/v1/models` ids — and those servers ignore the requested model name entirely. Gating on
  "a dialect was recognised" would have refused `defaultModel: "qwen3"` against a llama.cpp server
  listing `models/qwen3-8b-Q4_K_M.gguf`, breaking a working setup in the name of a catalogue nobody
  published. A bare `/v1/models` may equally be aliases, routed names or permission-filtered, and
  absence there is not evidence.
- **No escape hatch for requesting an unlisted model.** No case for one has been observed, and the
  three conditions above are narrow enough that inventing a flag now would be scaffolding for a
  need nobody has. The refusal names every id the server offers, so recovery is one corrected flag.
- **A substituted benchmark run is recorded as failed**, reason `model-substituted`, surfacing as
  `(N substituted)` inside the failed cell and in its own report section — not under "Runs that did
  not complete", because it did complete. Its record is kept in full. This is deliberately a
  different call from a truncated run: ADR 008 scores those because a cut run is *this* model
  measured incompletely, whereas this is a *different* model measured correctly. The number is not
  uncertain, it is mislabelled, and no amount of sampling fixes a wrong label.
- **The `scored` bucket gained an explicit `!run.error` guard.** The other three had one; `scored`
  held the partition together by relying on `run.mjs` declining to attach a score to a failed run —
  an invariant living in a different file, which is the fragility `unreadableRuns` documents about
  itself. A substituted run is the first that can carry a report, a scoreable reply and a failure at
  once, so the guard moved to where the sum is computed.
- **Timing, throughput and prompt-size samples exclude failed runs.** They gated on the presence of
  a report alone, so a substituted run would have contributed prefill, generation and tok/s figures
  measured on the wrong model to a row whose failed cell disowned it.
- **Selection policy moved to `scripts/lib/model-selection.mjs`.** Extracting it rather than the
  vendor readers keeps `positiveInteger` — which `effectiveWindow` uses for plain config validation
  — out of a dialect module. There is still exactly one `planSelection`, so ADR 002's
  single-authority rule is untouched.
- **Auto-selection makes "which model answered" a per-invocation fact** rather than a config one,
  which is why the served id is now recorded per run. OAI-11's cross-model passes inherit that.
- **Absence from one endpoint's list is not evidence; only absence from both refuses.** The two
  endpoints can disagree about how many models exist, in either direction. `merge` keys
  `described.models` on the `/v1/models` ids, so a model the dialect enumerated — even one it
  reports `loaded` — is missing from that array whenever `/v1/models` is narrower, which this ADR
  itself says to expect from a filtered, aliased or permission-scoped list. Gating the refusal on
  "the dialect published a catalogue" while testing membership in the *other* endpoint's list
  refused precisely the model the server was holding in memory. `merge` therefore carries
  `catalogueIds`, and membership is the union. **Found the hard way**: the adversarial review raised
  it at 0.98 confidence, it was dismissed, and the lean review then reproduced it end to end.
- **A model only the dialect lists can be requested by name but is never auto-selected.**
  Deliberate, and the same asymmetry `planSelection` already ran on: a named model is the caller's
  instruction and outranks our inference, while an automatic choice is one this code has to justify.
  Declining to consider a model means refusing and saying why — the conservative direction — whereas
  admitting it would route to an id only one of two endpoints ever mentioned.
- **A server that canonicalises ids reads as substituting, and that is accepted.** Answering a
  request for `gpt-4` as `gpt-4-0613` is a difference by this comparison, so every run against such
  a server would be recorded `model-substituted` and dropped from scoring. Deliberate: no
  OpenAI-compatible server observed here does it, resolving aliases would mean trusting a
  server-supplied mapping to tell us its own answer was equivalent — precisely the guessing this
  amends ADR 002 to *avoid* — and the failure is maximally loud rather than silent. A sweep would
  show `6 (6 substituted)` and a section naming every pair, with the remedy being one `--model`
  flag carrying the canonical id. Raised at 0.96 confidence by the adversarial review, which wanted
  a `same`/`different`/`unverified` tri-state; `null` already carries "unverified", and it resolves
  toward *not* excluding a run, which is the safe direction.
- **The catalogue is a snapshot, and a model can load or unload before the request goes out.**
  Named because it is a real race, not because it is a hazard: selection sends an **explicit id**,
  so a server that has since unloaded it loads it again rather than answering as something else.
  The race can cost a JIT load; it cannot pick the wrong model. And if a server does answer as
  something else, the reply-time comparison is exactly the backstop for it. Revalidating
  immediately before dispatch was rejected — it narrows the window without closing it, and buys
  nothing the reply-time check does not already provide.
- **State values are read by shape, not from a vendor vocabulary.** A recognised state is any
  non-empty string, and `'loaded'` is simply the value that selects. An allowlist of known values
  would rot as servers add states, and the failure direction here is safe: an unrecognised
  vocabulary yields no `'loaded'` match and therefore a refusal, never a wrong selection.
- **Not claimed:** this does not detect a server that substitutes *and* reports the requested id.
  Nothing observed does, and there would be no evidence to read if one did.
