# 003 — Asking a local model for structured findings

Date: 2026-07-27
Status: accepted
Builds on: [ADR 002](002-context-window-detection.md)

## Context

`/oai:review` needs findings a program can render and a reviewer can check one by one, from a model
small enough to run locally. Strict structured output (`response_format: {type: "json_schema",
strict: true}`) is the obvious mechanism, and it works — every probe against LM Studio serving
`qwen3.6-35b-a3b-ud-mlx` produced schema-valid JSON on the first try.

**But the payload never arrives in `content`.** Every structured reply came back with `content: ""`
and the JSON in `reasoning_content`. The cause is mechanical: the model's chat template opens a
thinking block, the grammar constrains generation from the very first token, and so the model can
never emit the token that closes it. Everything is therefore classed as reasoning.
`chat_template_kwargs: {enable_thinking: false}` does not change it.

Two more measured facts shaped the design:

- **`response_format: {type: "json_object"}` is rejected outright** by LM Studio —
  `'response_format.type' must be 'json_schema' or 'text'`. It is not a portable middle ground, so
  a server that refuses a schema has to be handled by prompt-and-parse.
- **A review is cheap.** A real 50 KB commit diff cost 13.9k prompt tokens and 724 completion tokens
  for five findings, `finish_reason: stop`, in 26 seconds. The window is not the binding constraint;
  the grammar also stops the model rambling, since it leaves nowhere to ramble.

This also exposed a defect in shipped code: `chatCompletion` guarded with `typeof content !==
'string'`, which `''` satisfies. `/oai:task` against a reply that ran out of tokens mid-thought
printed nothing, added a footer, and exited 0.

## Decision

**Both channels are returned; only the caller decides which is legitimate.** `chatCompletion` hands
back `content` and `reasoning` and judges neither.

- **Under a schema**, all output is grammar-constrained, so whichever channel carries text carries
  the constrained payload. Reading `reasoning` is allowed there — and conformance to the schema is
  what proves it, so the fallback is never a guess. `matchesSchema()` checks that literally, driven
  by the schema object rather than a hand-written mirror of it, and a near-miss is **rejected rather
  than repaired**: a server that accepts `response_format` without enforcing it (oMLX and Unsloth
  are unprobed, so this is not hypothetical) would otherwise let the first `{…}` in a scratchpad —
  a draft the model went on to reconsider — ship as findings. Without a schema nothing was promised,
  so there the parser repairs what it can.
- **Without a schema**, that text is the model's scratchpad. `requireAnswer()` refuses, naming
  `--max-tokens` when `finish_reason` was `length`. Printing working-out as an answer would be the
  "reported state must describe what will actually happen" class inverted, and an empty answer
  reported as success is that class outright.

**Degrade on the response, never on the provider name.** `response_format` is always sent. A 400 or
422 whose body names the field is retried once without it, with the schema restated in the prompt —
rendered from the schema object, so it cannot drift from it. The retry is near-free: an unsupported
`response_format` is a request-validation error returned before any generation. The retry is
announced on stderr, because a silent one would hide a schema *this plugin* got wrong just as well
as it hides a server that cannot take one. A 400 about anything else is never retried.

**`REVIEW_MAX_TOKENS = 4096`, not the 1024 a task reserves.** Measured need was 724 tokens for five
findings; this leaves room for roughly 25 while reserving under 8% of a 58k window. A review that
runs out of tokens mid-JSON returns nothing usable at all, which is a worse failure than a truncated
prose answer.

**`CHARS_PER_TOKEN` drops from 4 to 3.4.** Two live measurements: 50,022 chars counted 13,889 tokens
(3.61 chars/token) and 156,376 counted 44,997 (3.48). Code and diffs pack denser than the prose 4
assumed, so the guard was systematically over-estimating how much would fit — and a guard whose only
job is to refuse input the server would reject must err toward refusing. The value sits *below* the
densest sample rather than at it: 3.5 still fell ~300 tokens short of the second measurement, and
"close enough" is the wrong target for a number that exists to stay on the safe side. This tightens
`/oai:task` too, deliberately. `tests/context-guard.test.js` pins it against both samples, because a
review confirmed that reverting the constant left all 118 other tests passing.

## Consequences

- Adding another structured command means a schema and a render function; `structured.mjs` stays the
  only module that knows structured-output dialect, as `model-info.mjs` is for context windows.
- The review target is collected in Node (`git-diff.mjs`), not in the command markdown: diff text
  through `$ARGUMENTS` walks into the prose-vs-shell trap, and a call from Node is testable. The
  default target includes **untracked files**, without which a feature that adds a module — the
  common case — would have none of it reviewed.
- A clean tree, an unknown ref and an over-large diff each refuse and name the alternatives. Nothing
  silently reviews something other than what was asked for.
- Findings are rendered as *claims*. `commands/review.md` requires each one to be checked against the
  code before it is acted on, and refuted ones to be reported with a reason rather than fixed. The
  first live run produced a false positive (an assignment called unreachable that plainly is not),
  which is the expected quality level from a 35B model and the reason the verification step exists.
- **Known limit: a strict schema can require a field, not make it useful.** The system prompt asks
  for the offending line as `evidence`; the server guarantees only that the key is present. The first
  live run emitted `evidence: "The diff shows:"`. A run of contentless evidence fields is expected
  behaviour, not a bug — it makes verifying a finding more expensive, never less correct.
- The `reasoning_content` field name is itself a vendor extension, shared by LM Studio, vLLM and
  DeepSeek-style APIs but not in the OpenAI spec. A server that names it differently degrades to the
  same place as one that returns nothing: a loud refusal, never a wrong answer.
- oMLX and Unsloth Studio remain unprobed for structured output. The degrade path is what makes
  shipping without them honest; it has a test, but not a live confirmation.

## Amendment, 2026-08-04 — the schema is off by default, and the fallback is now the road

**Status: the decision above still holds for what a schema *buys*. What it costs was unknown when
this was written, and the cost is a crashed model process.**

Asking for `response_format` makes LM Studio's MLX backend build a grammar with LLGuidance. That
grammar's lexer carries a 250,000-state budget, and long-form generation exhausts it — measured at
13,956–14,744 generated tokens across five instances, 43–50KB, independent of the schema's own
`maxLength`. The engine then raises `ValueError: LLGuidance matcher error … Stop: LexerTooComplex`
inside the generation thread, which is fatal: `Fatal Python error: Segmentation fault`, and LM Studio
reloads the model about twelve seconds later.

The consequences are worth stating plainly, because this ADR's reasoning was sound and its conclusion
still shipped a defect:

- It cost roughly **38% of long requests**, which this repo attributed to an unreliable server for
  four days and built three separate instruments to characterise (OAI-20's attempt ledger, OAI-24's
  residency sampler, OAI-34's TTL challenge). All three measured a real thing. None of them measured
  the cause.
- The reload is why a retry ever succeeded — it meets a freshly loaded model, not a recovered one.
- `empty-completion` and `stream-unfinished`, filed as two failure shapes, are **one event observed
  either side of first token**.
- The evidence was in `~/.lmstudio/server-logs/` the whole time, and this repo's own error hint says
  "check the server log".

**So the degrade path described above is no longer a fallback for servers that refuse a schema; it is
the ordinary path.** `--structured-output` opts back in. That flag is not deprecation theatre: the
fault is in one backend's grammar engine, and ADR 001 commits this plugin to treating providers as
configuration rather than special cases, so deleting the capability would over-fit to the machine in
front of us. The default protects that machine; the flag keeps the capability for servers that
enforce a schema some other way.

**One thing this amendment REMOVES rather than adds.** `atCap`, `analysisCut` and `analysisCap` are
diagnostics about a grammar, and without one they are not computed. That reads like a loss of
safety and is close to the opposite: bounding `analysis` under a schema is precisely what made a
guillotined reply *valid* — complete JSON, `finish_reason: stop`, an empty findings list — and so
indistinguishable from a clean pass. That was ADR 004's trap instance 14. Unconstrained, a reply cut
off mid-object is **malformed**, `extractJson` fails, and the raw text is shown. The schema created
the hazard the diagnostic then detected.

The residual case is narrower and is handled separately: a reply that parses *and* was cut
(`finish_reason: length`) — complete JSON followed by a truncated tail. See the caveat added in
`review.mjs`.

## Amendment, 2026-08-07 — the channel is chosen by what parses, and one half of the item was filed against this ADR

Two ways a reply was thrown away and reported as "no findings in the requested shape" (OAI-84).
Neither was a new defect; both had been reachable since this ADR shipped, and one of them became
*ordinary* the moment the 2026-08-04 amendment made prose-and-parse the default path.

**A bare top-level array is now the same reply as `{findings: [...]}`.** It was not rejected by the
`typeof` test — arrays pass that — but by `parsed.findings` being undefined, one line further on.
Under a schema this never arose: the grammar produced the object. Asked for the shape *in prose*,
which is what every ordinary review now does, a model emits a bare array about as readily as the
wrapper. The array is wrapped before anything downstream reads it, so the two spellings cannot
diverge on `dropped`, `summary` or the cap diagnostics — merely agreeing about accept/reject would
leave two spellings of one reply producing two different results.

The alternative considered at the grill was to accept `[]` but refuse a non-empty array whose
elements all fail normalization. It was rejected for making the verdict depend on **spelling**:
`["hello"]` would be unreadable while `{"findings":["hello"]}` already parsed to
`findings: [], dropped: 1` and read as a clean review. The all-dropped hazard was filed as its own
item on the reasoning that it belonged to both spellings equally.

**The review ladder overturned that, and the reversal is the useful part.** The reasoning was true
and beside the point: for the BARE spelling this change *created* the false-clean where the old code
failed loudly, so filing it deferred a defect this feature had just introduced. What was wrong with
the rejected alternative was the asymmetry, not the rule — so the rule ships applied to **both**
spellings, below, and the separate item is not filed.

**Channel selection is no longer a guess made before the parse.** The old code picked `content`
unless it was blank, so under a schema one stray character in `content` buried a conforming payload
sitting in `reasoning`, and the user was told the model returned the wrong shape. It is now an
ordered attempt over a candidate list, the first usable payload winning, with `matchesSchema` still
the proof under a schema — so the fallback cannot become a scratchpad channel, which is the whole
point of the rule above.

**What the item got wrong, recorded because acting on it would have reversed this ADR.** OAI-84 filed
the channel defect as applying "regardless of `structuredOutput`" and proposed a try-the-other-channel
fallback. That claim is false. On the default path `reasoning` was never read at all, deliberately,
for the reason stated in the Decision above: without a grammar that text is the model's scratchpad.
The filed fix would have shipped scratchpad as findings. So the channel repair lands **only** under
`--structured-output`, and the default path's candidate list is written out as a list containing
`content` alone — the guarantee stated where a reader can see it, rather than left as a consequence
of a ternary. Its guard is asserted with **non-empty unparseable** content, because with blank
content an early return on empty text would satisfy the assertion without any channel list at all:
the test would pass against the mutation it exists to catch.

**A seam moved.** Pulling JSON out of text that was not promised to be JSON is not structured-output
dialect, and `structured.mjs` is the module that owns dialect. `FENCE`, `balanced` (named `balancedObject` until b7549ed generalised it over both bracket types) and
`extractJson` now live in `scripts/lib/json-scan.mjs`. The trigger was the size budget rather than
taste, and the move is behaviour-preserving — evidenced by its pre-existing cases passing unchanged
either side of it, not by the suite count, which new witnesses also moved.

**A list of things that are not findings is unreadable, not a clean review.** Accepting bare arrays
would otherwise have *created* a false-clean for a spelling that previously failed loudly:
`["some prose string"]` used to return `null` and be shown verbatim, and would now have parsed to
`findings: [], dropped: 1` — a review reporting "no defects" that a harness reads as `parsed: true`
with an empty list. So a **non-empty** raw findings array none of whose entries survives
`normalizeFinding` is `null`, for the bare and the wrapped spelling alike; a non-empty list with at
least one survivor is a review with `dropped` counted; `[]` remains a clean review. That also
repairs the pre-existing hazard in the wrapped spelling, which was filed as out of scope and turned
out to be cheaper to fix than to carry. The count is not lost by refusing: the caller prints the
model's reply verbatim, which contains the unusable findings themselves.

**Accepted limit — schema conformance is evidence, not proof, that a grammar was in force.** Under
`--structured-output` the ordered attempt can fall through from unusable `content` to `reasoning`.
`matchesSchema` is the control, and it is the control this ADR always intended for accept-but-ignore
servers. It is not sufficient, and the rule above does not close it. Codex's concrete residual,
recorded rather than argued away: a server that ignores `response_format` leaves a *substantive*
draft in `reasoning` — `file` and `summary` non-empty, so normalization keeps it, schema satisfied,
and text that says "Tentative: … TODO verify" — which ships as findings. Nothing on the wire
distinguishes it from a final answer. The alternatives were both worse: proving enforcement is not
possible without per-provider probing, and refusing the fall-through restores exactly the defect
OAI-84(a) was filed for. So this ships as a stated limit of the opt-in path. It does not touch the
default path, where `reasoning` is not a candidate at all.

## 2026-08-07, second amendment — which bracketed run in a reply is the answer

The first amendment taught the scanner to look for `[` as well as `{`, so that a prose-wrapped bare
array stopped being lost. Three review passes later that turned out to have opened a hole wider than
the one it closed, and this section records what it was, because the shape recurs.

**The reviewer's own system prompt orders the model to quote the offending source line.** So a reply
routinely carries bracketed *code* before its real answer. The predicate accepted any array whose
elements were objects, and the scanner picked whichever accepted candidate started earliest — and a
quoted array therefore beat the payload behind it, three different ways, each reproduced against the
module:

| quoted before the payload | what the user got |
|---|---|
| `const names = [];` | a **clean review**. `[].every()` is vacuously true, so the empty array was accepted, and the real findings were discarded silently. |
| `const rules = [{"id":1}];` | **unreadable**. Every element was dropped for naming no file and no defect, and the all-dropped rule then reported the whole reply unreadable while the payload sat intact further down. |
| `const CASES = [{"file":"x.js","summary":"…"}];` | a **confident wrong answer** — the decoy reported as the review's sole finding. Checked against the pre-amendment module in a worktree at the base commit: it returned `null` there, a safe refusal. This one was a regression. |

The wrapped spelling had the same gap from the other side: `{"findings": ["hello","world"]}` quoted
as a sample won on position, because nothing ever checked the items *inside* a `findings` key.

Two rules replace earliest-start-across-both-scans, and they divide cleanly:

1. **An accepted object outranks an accepted array**; position decides only *within* one scan. This
   is what saves every case where the payload is a `{findings: […]}` wrapper, wherever it sits. It
   costs the prose-wrapped-array case nothing — that reply contains no acceptable object at all, its
   payload's first element being a bare finding with no wrapper key. Object-versus-array is
   structural, so `json-scan.mjs` still knows nothing about findings.
2. **A candidate the scanner dug out of prose is held to more than one that IS the whole reply.** A
   whole reply competes with nothing, so a bare array of objects is accepted there, empty included.
   A *scanned* array must be non-empty and every element must name a file or a defect. The predicate
   moved to `scripts/lib/findings-candidate.mjs` — the size budget again, and the seam holds: this
   is neither dialect nor prose-scanning but the decision between them.

Rule 2 is easy to believe redundant, and **the step 5 mutation is what proved it is not.** Relaxing
the predicate to accept anything left the whole suite green, because every witness written for it had
a `{findings: […]}` wrapper as its payload and rule 1 was quietly doing all the work. The predicate
is load-bearing only when *both* candidates are arrays — no wrapper exists, so ranking cannot
arbitrate — and nothing covered that. A witness for it was added and the mutation then failed as it
should. A check that cannot fail is this repo's signature defect, and here it was hiding inside the
fix for another one.

**Accepted limit — a complete findings wrapper quoted as an example still wins.** Given
`Return {"findings":[{"file":"x",…}]} like this:` ahead of the real wrapper, both candidates are
objects and position decides. There is no positional rule that separates a schema-shaped example from
a schema-shaped answer, and under `--structured-output` `matchesSchema` cannot help either, since
both conform. This is recorded rather than fixed because **it is not a regression**: the module at
the base commit behaves identically, verified in a worktree. It is also not reachable from our own
prompt, which never asks the model to emit a findings wrapper as an example — unlike the quoted
*source* cases above, which that prompt asks for directly. That difference is the whole reason one is
a limit and the others were defects.

**A note for the benchmark, since OAI-19 runs next.** The all-dropped rule above moves a class of
reply from `scored` to `unreadable`: a reply whose findings all fail normalization used to parse as
`findings: [], dropped: N` and be scored as a zero-recall clean run, and now returns `null`. That
partition is exhaustive by construction in `bench/lib/run-buckets.mjs` — `unreadable` is the
remainder — so such a run is counted and printed in its own column, not dropped. But OAI-19's
predeclared G-B and G-C are counted over exactly that partition, so the shift is stated here rather
than discovered mid-arm. The direction is worth being explicit about: the old behaviour was the
miscount, and a gate that now sees fewer scored runs is the gate working.

## 2026-08-07, third amendment — position decides, and it points the other way

The second amendment's two rules were both wrong, and the fourth review pass proved it by finding
four more defects inside them. They are recorded because the correction is instructive, not because
the churn is:

- **"An accepted object outranks an accepted array"** is unconditional on position, so a real
  bare-array payload appearing FIRST loses to an unrelated findings-shaped object appearing later.
  The comment defending it claimed it "does not cost the prose-wrapped-array case anything". False.
- **The strict predicate was applied to arrays only.** The object branch stayed lenient, and since
  the scanner tried objects first, the lenient branch decided everything. A quoted `{"findings": []}`
  example was accepted vacuously and the review reported CLEAN — *the identical false-clean the array
  branch had just been fixed for, through the spelling the fix never touched.*
- **A fence was matched anywhere in the reply** and passed as the whole reply, so a fenced fixture
  mid-prose skipped both the predicate and the ranking.
- **`every(named)` broke the equivalence this ADR states in its own words.** A mixed
  `[valid, {evidence:"…"}]` was rejected whole when wrapped in prose while the identical payload as a
  whole reply or as `{findings: […]}` kept the valid finding and counted the other as dropped.

### The rule that replaces them

**Among OUTERMOST candidates, the LAST one wins.** Decided with Codex after both of the obvious
options were put to it and both rejected.

`outermost` is what makes `last` safe, and this is the part that is easy to get wrong: every accepted
`{findings: […]}` wrapper CONTAINS an accepted array — its own `findings` value — starting later. A
global last-candidate rule would return that inner array, losing `analysis` and `summary`, and under a
schema the reconstructed value would then fail conformance. So a candidate contained by another
accepted candidate is a *part* of it, not a competitor. With containment handled, object-precedence
becomes unnecessary rather than merely masked, and is deleted.

The predicate keeps `some(named)`, on **both** spellings, with `named` requiring a non-empty string.
Content and position each cover what the other cannot: position rejects a decoy that precedes the
answer, content rejects one that trails it. Trying to make the predicate cover both is what produced
two of the defects above.

**This rests on a judgement, not a measurement, and it should be read as one.** The claim is that a
review model quotes source and reasons BEFORE its answer, because the prompt orders it to quote the
offending line — so the answer is last. The corpus cannot check this: `bench/results` stores `raw`
only when a reply failed to parse, and a decoy that wins *parses*, so a decoy win is recorded as a
scored run with poor recall and is invisible as a parse event. 31 result files and 116 run-shaped
nodes hold zero non-null `raw`. The frequency therefore ships **unmeasured**.

**Accepted limit — JSON in trailing commentary.** The symmetric failure of last-wins: a reply that
emits its payload and then discusses another findings-shaped object after it will select the trailing
one. Judged rarer than leading quoted source. Note that the *previous* rule failed this case too, for
a different reason, so this is a limit rather than a regression. The limit recorded in the second
amendment — a quoted complete wrapper before the real one — is **closed** by this change.

### What the pass actually taught

Four passes produced four instances of a check that could not fail, the last two of them in witnesses
written specifically to end the previous instance. Two independent reviewers proved it by mutation
with the suite green at 680/680. The response was to make the discipline mechanical: **each fix in
this batch was mutated back alone and required to turn a named test red, as it landed.** Two of the
six witnesses did not — the new ranking rule saved their fixtures regardless of the predicate — and
both were rewritten to place the decoy AFTER the payload, which is the only position where the
predicate is the thing deciding. That is the difference between a batch that holds and the three
before it.

## Amendment, 2026-08-07 — enumeration, and the limit that is a choice

The fourth pass replaced the ranking rule. The fifth found three things wrong underneath it, and two
of them were wrong before this feature began.

**`scanFor`'s enumeration was not complete, so the ranking above it could not be sound.** `balanced`
returned the same `null` for two different facts — *no opening bracket remains* and *this opening
bracket never closes* — and `scanFor` read both as exhaustion of the bracket type and stopped. One
stray `[` in quoted source therefore hid every real candidate after it. There are **two** ways to
reach that dead end and only one was reported first:

1. plain depth imbalance — `see line [42` never closes;
2. a bracket **inside a quoted string** — `balanced` enters at its start position with quote-tracking
   off, because nothing has read the text before it, so the string's *closing* quote turns tracking
   ON and swallows the remainder of the reply.

A reader given only the first would have patched the wrong line. Both are cured by the same change:
a failure is one dead **start position**, so skip past it and continue. Its worst shape was not an
unreadable reply but a **wrong reply that parses** — the object scan died, the array scan
independently found the wrapper's own `findings` array, and `analysis` and `summary` vanished with no
error at all. The witness for that case asserts the wrapper's fields survive, not merely that the
result is non-null.

**`findingsShaped` now requires a non-empty `file` AND `summary`.** Under OR, a wrapper sitting inside
an array was named by its own `summary`; the array was accepted, containment absorbed the wrapper as a
*part* of it, and the real findings inside were lost. This closes the **instance**, not the class: an
array element that is a wrapper and *also* carries a non-empty `file` and `summary` still passes and
is kept in place of the payload it wraps. That needs a model to emit a wrapper carrying finding keys,
which no prompt here asks for.

**Accepted limit, and it is a CHOICE rather than an oversight — a prose-wrapped clean review is
reported unreadable.** `Here are the findings: {"findings":[]}` returned a clean review before this
feature and returns `null` now. It is byte-identical to a quoted empty-findings example, so no content
predicate can separate them.

**Correction, 2026-08-07, pass 6 — the trade above is real but the reasoning behind it was a FALSE
BINARY, and this record shipped that error.** "No content predicate can separate them" is true and
beside the point: a third option exists outside the content predicate. Decide by candidate
MULTIPLICITY — accept a lone scanned empty as a clean review, and refuse only when it actually
competes with another outermost candidate. An earlier consult was asked whether a third option existed
*inside these two functions* and answered no; that scoping was the mistake, because multiplicity is
known to neither half of the design. The pass-6 adversarial stage named it. The candidate-selection
design is under a partial plan withdrawal for exactly this reason, and the behaviour described in this
paragraph is what SHIPPED, not what should be kept. The alternative was weighed and refused: accepting scanned empties lets a
**trailing** quoted empty beat real findings and report a **silent** clean review, and because
`objects([])` is vacuously true it would promote every trailing bare `[]`, not merely the wrapped
spelling. `unreadable` is visible and retryable; a false clean is neither. Note what this rule no
longer does: last-outermost already defeats every *leading* empty decoy, including the three that
originally motivated the rule, so its live justification is trailing decoys **alone**. The code
comment says so, because a rule that looks redundant gets tidied away.

### What the pass actually taught, continued

The fourth amendment reported that the per-fix mutation discipline was what made that batch hold. It
was **partly** right, and the correction matters more than the claim. Pass 5 mutated pass 4's fixes
and found **two more** checks that could not fail — `.trim?.()`, whose every fixture used `""` and so
passed identically under plain truthiness, and `scanFor`'s same-type resume, whose only nesting test
exercised the *cross*-type path the independent array scan handles anyway. Both guarded correct
behaviour; neither could have told it from its negation. So six instances across five passes, and the
discipline that was adopted to end the pattern reduced it rather than stopping it.

What did work is narrower and worth stating exactly: mutating **each fix alone, against a named test,
at the moment it lands** catches a decorative witness for the fix in front of you. It says nothing
about the fixes already in the file — those need an outside reviewer instructed to mutate them, which
is how both of pass 5's were found. Two guards defeated by a single mutation are one guard, so the two
resume paths in `scanFor` are written as separate statements.

**Correction, 2026-08-07, pass 6 — that last sentence was false, and so was the reasoning that
produced it.** The two statements are NOT two guards. Deleting the `run.json === null` branch outright
leaves all 692 tests green, because the fall-through advance below does the same thing: `JSON.parse`
of a null candidate yields `null`, `findingsShaped` rejects it, and `from` advances anyway. The branch
buys no behaviour at the only call site. The mutation that "proved" it independent replaced the branch
with `return found;` — an edit no maintainer would make.

**The generalisable lesson, which is sharper than "the discipline is partial": mutate toward
SIMPLIFICATION, not toward breakage.** Ask what someone tidying this file would delete or merge, and
mutate that. Deletion is what happens to code that looks redundant, and deletion is what survived.
The same shape defeated two witnesses written in that batch: their fixtures set both `file` and
`summary` or neither, so every mutation imaginable *from those fixtures* failed, while dropping one
operand of the conjunction — the edit that matters — stayed invisible and left the suite green.

Ten instances across six passes, three of them in witnesses written to end an earlier instance. The
per-fix discipline reduces the pattern; it does not close it. What closes an instance is an outside
reviewer told to mutate the code, and what it finds is the mutation the author could not imagine.
