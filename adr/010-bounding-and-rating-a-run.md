# ADR 010 — Bound a run in wall clock, and report what it generated per second

**Date:** 2026-07-29
**Status:** accepted
**Builds on:** [ADR 007](007-owning-the-transport.md) (the budgets), [ADR 009](009-measuring-prefill-and-generation.md) (the divisor)

## The problem

Swapping to a dense 27B at 6-bit produced roughly 7.4 tokens/sec, and the benchmark had no way to
describe what happened next. Three gaps, and the probe reshaped two of them.

**Nothing bounded a run that was working.** `--timeout` names the wait for the model's *first*
token — connect, send and prefill, which are legitimately silent for minutes. Once text arrives that
budget is retired and the idle budget takes over, and the idle budget resets on every text-bearing
frame. So a model that keeps emitting runs until it stops of its own accord. Confirmed against the
code by an independent read: *"once text arrives, `deadline.progress()` replaces that timer with the
idle timer, resetting it after every text-bearing frame. There is no absolute total deadline for the
streamed response."* With ADR 009's own figures — generation spanning 165–747s on one case — a
six-case corpus at N=3 had no worst case at all, which is what actually blocks OAI-11's cross-model
passes: you cannot leave a sweep running overnight against a model whose speed is the thing under
test.

**Nothing reported a rate.** ADR 009 landed `generationMs`, so the divisor existed, but no path
printed the quotient — and it is not recoverable by hand from either rendering, because that ADR
also established that `durationMs - prefillMs` is *not* generation.

**A timeout was indistinguishable from a model failure.** Internally it was already structured:
`budgetError` sets `error.reason` to `first-byte-timeout`, `first-token-timeout`, `idle-timeout` or
`total-timeout`. But `oai-companion.mjs` wrote only `message` and `hint` to stderr, so `bench/run.mjs`
stored a prose blob. Telling a harness limit from a server error would have meant pattern-matching
that prose — which this repo already files as a defect class in its own backlog (OAI-13 items 1 and
2: a matcher that reads a server's prose asserts a cause it only guessed).

One correction while we are here: the backlog item motivating this quoted runs dying "on the 300s
client timeout". That number is from before ADR 007 replaced undici, and the old failure record in
`bench/results/` still carries its wording. The default first-token budget is 600s. The gap was real;
the figure was stale, and is not repeated.

## Decision

### A wall-clock cap, opt-in, spanning every retry

`--max-seconds` on `/oai:review` and `/oai:task`, `maxSeconds` per provider in the config. It caps
the model call; `--timeout` keeps meaning what it meant.

**It uses the transport's existing `totalMs`, not a third timer in `createDeadline`.** That timer is
only built after headers arrive, so a cap armed there would have left the worst case at
`timeout + max-seconds` — a flag that does not bound what it says it bounds, which is the class half
this item is about. The transport arms before a byte is written and its deadline deliberately keeps
running across the body.

**One expiry, shared by every attempt — this is the correction that mattered most.** The first draft
armed a fresh `maxMs` inside each attempt, and the plan challenge showed the name would then be a
lie: `postWithDegrade` retries when a server refuses `stream`/`stream_options`, and
`requestFindings`'s `response_format` ladder retries *that*, so three attempts under
`--max-seconds 600` could run for 1,800s with every individual attempt honouring its cap. The
defence for it — refused capabilities are rejected before any generation — is a claim this repo had
*already written down as unverified*: ADR 009's known limits record that a server may prefill before
refusing a field and that nothing here detects it. Citing your own unverified assumption as a
justification is how it becomes load-bearing.

So `requestFindings` mints `expiresAt = performance.now() + maxMs` once, and each attempt receives
`totalMs = expiresAt - performance.now()`. An instant cannot be re-armed. `performance.now()`
because a wall-clock step must not lengthen a cap. An attempt whose remaining budget is already
non-positive is refused rather than dispatched — `armBudgets` gates on `totalMs > 0`, so a zero
would arm *nothing* and the attempt would run unbounded past a cap that had already expired.

**No default.** The other two budgets have one because a request with no bound is a hang; this one
caps work that is *succeeding*, and a default would be a number chosen from the successful runs this
repo happens to have observed. That is exactly the shape of the `analysis` cap OAI-15 had to undo —
set "above every observed successful run" from a sample that had not yet seen a normal run reason
long, and spending its life truncating working reviews. Unset means the old behaviour, precisely.

**What it covers, stated rather than implied:** the model call and every retry inside it. Collecting
files and resolving the model sit outside. They are git and a 5s probe, so the residual is small, but
"max" names a bound and the docs say which.

**Bounded above, at what a timer can express.** Node clamps a `setTimeout` delay over 2,147,483,647 ms
to **1 ms**, so a cap of a hundred days would not have been a long cap — it would have been an
immediate one, killing a run in milliseconds under a flag its author read as generous. Both duration
flags and the two config keys refuse anything above `MAX_BUDGET_SECONDS` (~24.8 days). `--timeout`
carried the same latent flaw before this feature and is fixed with it. Raised by the adversarial
review at 0.99 confidence, and the constant sits in `http-budgets.mjs` beside the timers rather than
beside the flags, because `config.mjs` needs it too and reaching it through `delegate.mjs` would have
closed an import cycle.

### `deadline` is its own budget name

A fifth key in the transport's vocabulary, giving `reason: 'deadline-timeout'`, rather than reusing
`total`. `total`'s hint reads *"This is a control-plane request with a fixed budget, not a model
call"* — true for `/v1/models`, a lie under a cap someone set on a model call. Two different facts,
two names. Its hint is caller-neutral ("send a smaller request", not "review a smaller target")
because the same budget is on `/oai:task` and a transport-layer error cannot assume the caller is
reviewing code.

**`budgetError` now takes `serverResponded` explicitly.** It used to infer it: every budget except
`first-byte` was assumed to mean a status line had arrived. That proxy breaks the moment a budget
spans every phase — `deadline` is armed before DNS, so a black-holed provider hitting the cap would
have been reported as having answered, and `cmd-setup.mjs` reads exactly that field to decide whether
to tell someone to start a server. The transport passes `state.settled`, read **inside the timer
callback**; capturing it at arm time (where it is always false) was the same wrong answer by a
different route, and was caught by the delta re-challenge after being written.

**Ties are decided, not raced — both of them.** The tempting shortcut was to arm the preferred timer
first and let `setTimeout`'s FIFO ordering settle it. Rejected: Node documents equal-delay ordering
as approximate, and which failure a user is told about — and through `serverResponded`, what they are
told to do about it — is not a thing to leave to the scheduler. There are two ambiguous pairs and
they need opposite answers, so each is decided explicitly:

- A **caller-set cap** due no later than the first-byte budget subsumes it, and the first-byte timer
  is not armed at all. Someone passing equal `--timeout` and `--max-seconds` wants the outer bound
  they set.
- The **control plane's `total`** is the reverse: a backstop *behind* first-byte, sharing its exact
  value in `fetchModels`. It cannot be suppressed — it still has to catch a slow drip after the first
  byte — so when it fires with nothing received it reports `first-byte` instead. `/v1/models` against
  a silent host therefore reports `first-byte-timeout` deterministically, which is what
  `cmd-setup.mjs` reads.

The first draft did leave the control-plane pair racing, on the grounds that the explicit
`serverResponded` had removed the harm. The adversarial review pointed out that the *reason string*
is machine-readable output either way, and that a test pinning it would be recording a race rather
than enforcing an invariant. All four cases are a truth table in `tests/http.test.js` — including a
cap *longer* than the first-byte budget, which is the only one that proves the rule is a rule:
without it the comparison could be reversed and every other test would still pass.

### Under `--json`, stdout is machine-readable on both paths

A failed run prints `{"error": true, "reason", "message", "hint"}` to stdout and still exits 1 with
the same prose on stderr. `bench/run.mjs` reads it and records `reason` beside the stderr blob it
already kept.

Two boundaries are deliberate. The envelope covers **everything after argument parsing** — the
command's guards, numeric validation, and an internal crash — because scoping it to "operational
errors" would have left four failure modes prose-only under a flag documented as machine-readable, a
contract broader than its implementation. And the one honest exception is a malformed command line:
parsing is what establishes that `--json` was passed at all. `commands/review.md` says so rather than
leaving it to be discovered.

bench requires **`parsed.error === true`** before trusting the envelope. A partial report flushed to
stdout before a crash would otherwise be read as an error object — the same guessing, reappearing
inside the fix meant to end it.

### A generation rate, on both paths

`tokensPerSecond(usage, generationMs)` in one module, used by the `/oai:review` footer and the
benchmark's `gen tok/s` column. On the human path for the reason `render.mjs` already states: a
diagnostic that changes nothing may live on one path, a fact that changes what the reader should
believe may not — and "this model runs at 7 tok/s" is the second kind.

**What the number is, exactly: provider-reported completion tokens per measured generation second.**
The first draft called it "tokens the model emitted, thinking included". That was refused, correctly:
`jsonReport` passes `usage` through unvalidated *because* its contents are the vendor's word, and
nothing here can confirm that a given server counts reasoning tokens in `completion_tokens`, or
counts them the same way on the streamed and non-streamed paths. One operand is ours; one is theirs.

Null, never a number, when either operand is missing or nonsensical: `generationMs` is null on the
non-streamed path, `usage` is null outright when a server refused `stream_options`, `completion_tokens`
is optional even when `usage` is present, the token count must be `>= 0` (a malformed `usage` would
otherwise render a negative rate), and `generationMs` must be `> 0` — `timings()` rounds to whole
milliseconds, so a genuinely fast generation can land on 0 and produce `Infinity`.

**Per run, ranged — never `sum(tokens)/sum(ms)`.** The pooled form is a real quantity, the corpus's
length-weighted average, but not the one a cell showing endpoints claims. Two runs at 10 tok/s for
one second and 2 tok/s for a hundred pool to 2.08 — a figure neither run produced. This is the same
shape as the `prompt tokens` sum ADR 009 had to fix one commit earlier, in the same file, which is
why it has its own test with numbers chosen so the two answers cannot coincide.

**No prefill-rate column.** The table already prints `prompt tokens` beside `prefill s`, so that
quotient is the reader's division. And a prefill "rate" under a cache hit is not an ingestion speed
at all — it is the cache.

**The timeout count rides inside the `failed` cell**, as `(N timed out)`, the way `(N cut)` rides
inside `scored`. A capped run *is* a failed run, so the row invariant
`scored + truncated + unreadable + failed = runs` still holds; what it is not is a result about the
reviewer. Counted off `reason`, never off the message: a run that died before the envelope could be
written has `reason: null` and is counted as failed and not as timed out, because absent evidence is
not evidence of the other branch.

## What it looks like in the shipped report

`--case config-origin --runs 2` on the dense 27B, live:

```
| case            | ... | prompt tokens | prefill s | generate s | gen tok/s |
| `config-origin` | ... | 1575          | 1–3       | 81–265     | 14.5–16.6 |
```

That row is the argument for the column. Generation spread **3.3×** across two runs of an identical
1,575-token prompt, and the rate spread **1.15×** — so the model was not varying in speed at all, it
was varying in how much it chose to say. Without the quotient beside it, `81–265` reads as a model
whose throughput is wildly unstable, which is the wrong conclusion and the one a reader would draw.

## What the reviews changed, since most of it is not visible in the result

Six defects in this feature's own code were caught before it shipped, none by the tests:

- **The cap was per attempt** (plan challenge, before any code existed) — three attempts under a
  600s cap could have run 1,800s.
- **`serverResponded` was captured when the timer was armed**, where it is always false, rather than
  read when it fired (delta re-challenge). **This one recurred**: a later review found the other
  timer needed the same fix, it was applied by copying the first one's shape, and the wrapping arrow
  that is the whole mechanism was dropped. Caught within a minute by the test written alongside it.
- **A live cap reported its remaining time as the configured number** (delta re-challenge).
- **The tie-break relied on `setTimeout`'s FIFO ordering** (delta re-challenge, then adversarial
  review for the half that was left).
- **A cap above ~24.8 days would have fired immediately**, because Node clamps such a delay to 1 ms
  (adversarial review, 0.99).
- **The deadline hint claimed the model was generating on the strength of raw SSE bytes** — the
  exact inference `http.mjs` refuses in its own module note. Three of four review finders converged
  on it independently. It is worth recording *where* it came from: that branch existed only because
  an earlier reviewer objected to a hint claiming more than was known, so a fix for one false
  assertion introduced another from a worse signal.

Two of those are now in `.claude/REPO_TRAPS.md` as classes rather than instances.

## Known limits, stated rather than assumed away

- **ADR 009's caveat survives this.** `generationMs` still includes the server's own inter-token
  stalls, and dividing by tokens does not remove them. This closes the loop that ADR's caveat opened
  — "these figures are only like-for-like once divided by the tokens actually produced" — but closing
  a loop is not the same as removing a caveat.
- **The cap bounds the model call, not the command.** With one shared expiry the retries can no
  longer multiply it, but `collectTarget` and model resolution sit outside.
- **A cap set too low kills a run that was working**, and to a reader that failure looks like the
  model's. Mitigated only by the distinct message and reason, which is why both exist.
- **`--max-seconds` accepts fractional seconds while `maxSeconds` in the config must be a whole
  number.** That matches `timeoutSeconds` exactly, so it is consistent rather than considered; the
  single domain that *was* deliberate is bench's, which imports the command's own `parseNumber` with
  the command's own options so a flag it merely forwards cannot have two meanings.
- **The rate's numerator and divisor do not describe exactly the same window**, and this was
  accepted on measurement rather than fixed. `completion_tokens` counts every token; `generationMs`
  runs from the first text-carrying frame to the end of the stream — so the first token's generation
  is excluded (a N/(N-1) bias, 0.02% at a few thousand tokens) while post-generation protocol latency
  is included. On the live run above the divisor was 81–265 seconds, and no terminator delay was
  observed on this server — *observed*, not measured: nothing here times the gap between the last
  text frame and `[DONE]`, so what is claimed is that the quotient came out where a prompt run of
  that length should, not that the tail was counted. **The part that is not bounded** is a provider
  that deliberately delays its
  `usage`/`[DONE]` frame: within one server the figure is sound, across two it is sound only if both
  terminate promptly, and nothing here detects the difference. Raised by the adversarial review at
  0.96 confidence, and left as a stated limit with the case that actually needs it filed against
  OAI-11.
- **The rate says nothing about answer quality or about time-to-answer.** A model can be fast per
  token and slow to answer because it chose to say more. Read `gen tok/s` for speed and the
  generation column for cost.
