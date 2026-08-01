# ADR 012 — Surviving the server: classifying delivery failures, and the attempt record

## Status

Accepted, 2026-07-31. Implements OAI-20 and OAI-21.
Amended 2026-08-01 by **OAI-22**: the `transport` code is split by retryability, classification moves
to the call site, rewording is forbidden from reclassifying, the wall-clock cap is evaluated once per
dispatch, and `--warm-up` interleaves.

## Context

On 2026-07-30 the benchmark could not produce a number. Across four full-corpus invocations,
**27 of 72 runs died server-side (37.5%)** — on both a dense 27B and an MoE 35B-A3B, so the locus is
LM Studio's shared serving path rather than either model. Every death was a failure of *delivery*:
an empty completion, or a stream closed part-way through reasoning. None was a refusal, a timeout,
or a bad answer.

Nothing in the request path retried. The only loops were capability ladders — `postWithDegrade`'s
`stream`/`stream_options` rungs and `review-request.mjs`'s `response_format` fallback — and each
matches a 400 naming a field. A dropped request therefore surfaced as a bare `UserError` with no
machine-readable cause, and the harness filed it in the same bucket as a model that answered badly.

That is the censored-denominator trap this repo has already caught once in its own prose: **missing
data counted as an observed miss.** OAI-19, the baseline re-measure every item below it wants a
number from, closed *blocked*.

Separately, the harness did not keep its own evidence: `run.mjs` wrote the JSON record but printed
the rendered Markdown — the human-readable form of every caveat — to stdout only.

## Decision

### Four delivery shapes, each with a structured reason code

Assigned where the failure is *detected*, never matched out of a server's prose — a defect class
this repo has on file twice over (OAI-13 items 1 and 2).

| Shape | Where | Code |
|---|---|---|
| No text channel was ever present | `completion.mjs` | `empty-completion` |
| Stream ended with no `[DONE]` and no `finish_reason` | `completion.mjs` | `stream-unfinished` |
| Connection closed mid-body | `http.mjs` | `transport` |
| Every channel present and exactly empty | `completion.mjs`, **new** | `blank-completion` |

These four are the shapes **observed** on LM Studio. OAI-22 later split the `transport` row by
whether a retry could survive it, adding a fifth *code* — `non-retryable-transport` — that is not a
fifth delivery shape: it names the pre-response failures that never delivered anything at all. See
the subsection below.

The fourth shape needed finding rather than remembering. `applyText` sets `sawContent` for **any** string
including `''`, so a reply of `content: ""` passed both existing guards and reached the caller
looking successful; `/oai:review` reported "the model did not return findings in the requested
shape" and the benchmark filed it as *unreadable*. A dead request recorded as a bad answer.

It tests `.length`, never `.trim()`. A model answering with whitespace **has** answered — whether
that is useful is the caller's decision — and trimming here would spend two more requests failing to
retrieve a real reply.

### The transport split, and why it is decided at the call site (OAI-22, 2026-08-01)

`transport` began as one bucket holding everything the request layer could raise, and `isRetryable`
said yes to all of it — so a permanent failure this client could recognise, such as a TLS certificate
rejection, cost three requests and two 2-second sleeps to establish what the first already proved.

- **`transport`** — a transport failure a second attempt could plausibly survive: the post-headers
  delivery cut, plus pre-response failures whose code is in a transient whitelist (`ECONNRESET`,
  `EPIPE`, `ETIMEDOUT`, `ECONNABORTED`, `EAI_AGAIN`).
- **`non-retryable-transport`** — a pre-response transport failure not recognised as transient:
  `ENOTFOUND`, `ECONNREFUSED`, and every unrecognised or absent pre-response code. Same whitelist
  direction as `RETRYABLE` itself, and for the same reason.

**Rejected name: `unreachable`.** The pre-response path also carries TLS certificate rejections,
protocol and parser errors and code-less failures — all cases where a peer *was* reached — so the
name would have asserted a fact the classification never established, which is the defect class this
document opens by naming. The name states the decision made; `.code` carries the rest.

**Decided at the CALL SITE, not by inspecting `error.code`.** `transportError` has two callers with
opposite meanings: `bodyStream`'s catch runs only past headers, while the request `'error'` handler
usually runs before them. Measured on Node 26.3, a socket cut mid-body arrives as `Error: aborted`
carrying `ECONNRESET` — but whether Node attaches a code there is version-dependent, and classifying
by code alone would file the most retryable shape in the codebase as terminal on a version that does
not. So the code that knows the phase says so (`delivered`). The request handler classifies on
`state.settled` rather than assuming the connect phase, because it assigns `state.aborted` *before*
`fail` consults `settled` and `bodyStream` gives a stored `state.aborted` priority over what the
iterator threw — so an after-headers request error surfaces through the body path.

**The axis is retryability, never blame.** `EAI_AGAIN` and a pre-response `ECONNRESET` are
`transport` yet carried no response, so a `transport` tally is not a count of server misbehaviour,
and no reader of the reliability table may treat it as one.

**Rewording a failure must never reclassify it.** `provider.mjs` `describeFailure` improves the
message for `ECONNREFUSED`, `ENOTFOUND` and `EAI_AGAIN` — it is the only layer that knows the
provider's name and its start hint — and it used to do so by building *fresh* `UserError`s, silently
dropping `reason`, `code` and `cause`. The consequence was invisible until the retry set was split:
a real `EAI_AGAIN` was classified retryable and then reached `answerWithRetry` with no reason at all,
so it was never retried, and terminal DNS and refusal attempts entered the ledger as `unclassified`
beside genuinely unrecognised failures — in the very table this record exists to make readable. Found
by the OAI-22 adversarial review, after tests that called `transportError` directly all passed. The
message belongs to the layer that knows the provider; the reason to the layer that saw what happened.

`serverResponded` follows the same evidence: `delivered` means headers arrived, which is exactly what
`cmd-setup.mjs` reads to decide whether to tell someone to start a server.

### One cap evaluation per dispatch (OAI-22)

`capBudgets` is evaluated once in `postWithDegrade`, before `ledger.begin`, and carried into
`postChat`, which no longer re-evaluates it. Two evaluations straddling `ledger.begin` can disagree,
and a cap falling due between them minted an entry for a request refused before the socket — filing
this plugin's own deadline as a failed physical attempt. This closes the residual gap recorded below
under OAI-23: a `refused` entry can no longer sit beside a phantom `failed` one.

Revalidating at transport-arming time was considered and rejected: a transport that can *refuse* at
arming reopens exactly the window this closes. The price is that the carried `totalMs` is slightly
generous — bounded by the synchronous work in the gap, which is body serialization, so milliseconds
on a 60k-token prompt against a cap measured in seconds.

### A bounded retry, spanning the transport *and* the judgement

`answerWithRetry` wraps `postWithDegrade → finishAnswer`, inside `chatCompletion`. That pair is the
smallest unit that can see every shape: the transport raises one, `finishAnswer` raises three.
Wrapping `requestFindings` instead would re-run prompt sizing and the oversize ladder — retrying the
wrong thing.

- **`--max-attempts` counts ANSWER attempts, default 3.** Not physical requests: a capability
  degrade already costs an extra request inside one attempt, so capping requests at 1 would disable
  the degrade ladder rather than disabling retry. `--max-attempts 1` reproduces the pre-retry
  behaviour exactly, which is what makes it a **control arm** — one corpus run can measure the
  failure rate with retry and another without.
- **The predicate is a whitelist of reason codes.** An unrecognised failure costs one request and an
  honest error rather than three requests and a misleading one.
- **The negotiated payload is caller-owned** (`createNegotiation`), so a retry resumes from the
  shape the server accepted instead of re-sending a field it already rejected.
- **A fixed delay before each retry**, bounded by what is left of `expiresAt`, and the elapsed wait
  recorded. Fixed rather than exponential: with at most two retries an exponential schedule is two
  numbers pretending to be a policy. When the cap falls due during the wait, the error thrown names
  the **cap** — rethrowing the delivery error would file a wall-clock kill as a server drop.

### The attempt ledger: two denominators, kept apart

One entry per **physical HTTP request**, whatever caused it, carrying index, cause, outcome, reason
code, `prefillMs`, `generationMs`, `waitedMs`, `promptChars` and `warmEligible`.

**Scoring reads logical runs; reliability reads every physical attempt.** A run whose first two
attempts died and whose third answered is one scored run and three requests. A failed attempt is
missing data and never enters a recall denominator.

Three details are load-bearing, and each was found by a reviewer rather than designed in:

- **An entry is settled only after `finishAnswer` has judged it.** `postChat` returns *successfully*
  for three of the four shapes; closing at the transport would file dead requests as answered
  attempts with no reason code — the exact corruption the ledger exists to prevent.
- **A third outcome, `refused`**, for a shape the server rejected and the plugin then replaced.
  Counted in the total, excluded from the failure rate. Without it, a server that refuses
  `stream_options` — routine and permanent — would headline a **50% failure rate while answering
  100% of shaped requests**. Crucially, `refused` is recorded by the layer that actually *sends* the
  replacement, never inferred from a status: a context-limit rejection is also a 400, no fallback
  follows it, and calling it refused would hide a terminal failure.
  **Amended 2026-08-01 (OAI-23), tightening that provenance rather than changing it.** "The layer
  that sends" originally *wrote* the outcome, which made it a claim staked before the sending
  happened — and several things can stop a replacement between the refusal and the wire, chiefly the
  wall-clock cap. So a refusal is now **registered** by that layer and **settled by
  `attempt-ledger.mjs`'s `begin`**, as a consequence of the replacement entry existing: no
  replacement, no reclassification. A refusal nothing replaced therefore stays `failed`, carrying
  the terminal reason **`shape-rejected`** — the server rejected the request's shape and nothing was
  accepted in its place. A *flipped* entry keeps `reason: null`, so it stays byte-identical to the
  records made before this change. `shape-rejected` is deliberately not in `failure-shape.mjs`:
  that file is a taxonomy of delivery failures with the retry whitelist built on it, and this is an
  HTTP validation rejection, which must never be retried.
- **The ledger is attached to the error on every terminal rethrow.** A run whose every attempt died
  carries the most reliability evidence and is the easiest to lose, because nobody looks for a
  record on the failure path.

### `warmEligible` means "a prior dispatch could have warmed this", never "the cache was warm"

`--cold` mints its cache-buster **per run**, but a retry re-sends the prompt byte-for-byte on
purpose. So the answering attempt's prefill may be a cache hit, and under `--cold` such a run is
**excluded from the cold prefill samples** rather than quoted as a cold measurement. Only under
`--cold`: without it every prefill is already cache-affected, and dropping just the retry-warmed
ones would bias the sample they belong to.

The rule is evidence-based in both directions, which took two corrections to get right:

- Computed from the **serialized messages**, not the attempt index — the `response_format` fallback
  is also a later attempt but rewrites the prompt, so an index-based rule would exclude a genuinely
  cold measurement.
- A prior request counts as a dispatch only when a **`prefillMs` was measured** — i.e. model text
  actually arrived. A capability refusal never read the prompt; a connection that died carrying only
  keepalives never delivered one. Over-marking silently *deletes* real measurements, while
  under-marking quotes a possibly-warm figure beside a caveat that says so — only the second failure
  is one a reader can see.

### The bench keeps its evidence and pays the model load (OAI-21)

- The rendered report is written to `<stamp>.md` beside `<stamp>.json`, under **one** stamp computed
  before rendering. Both 2026-07-30 arms kept their reports only because each nohup log was copied
  by hand; a reused log path would have silently overwritten the first.
- `--warm-up` sends one tiny unscored request whenever the resolved provider/model pair **changes
  from the previous case**, carrying the invocation's budgets — so a pair used again after a switch
  is warmed again. Corrected by OAI-22 (2026-08-01): warming every pair up front, the original
  shape, let the last warm-up evict the first on a provider that keeps one model resident, and
  warming only at *first* use has the same defect one step later. Each entry names the case it
  preceded, since interleaved warm-ups are otherwise indistinguishable from pre-run ones. The record
  states it ran — "the flag was passed" and "the request happened" are different facts.
  Its field is `answered`, not `ok`: a reasoning model spends its budget thinking and exits
  non-zero on a request that loaded the weights perfectly well. `durationMs` is what separates
  "loaded" (seconds to tens of seconds) from "never reached the server" (milliseconds).
- A new `## Physical-attempt reliability` section leads with **both denominators together**, and the
  pre-existing section is renamed `## Logical runs that did not complete` so the pair reads as a
  pair. Substituted runs are excluded from the incomplete count — they completed; what failed was
  the attribution, and the adjacent section already says so.

## Consequences

- **Wall clock is documented, not capped.** Without `--max-seconds` there is no finite worst case
  today, and attempts multiply it. `--max-seconds` already exists as the answer and the bench passes
  it; inventing a default would silently kill long legitimate reviews on slow hardware — the shape
  of the error OAI-15 had to undo on the `analysis` cap.
- `retried` is now derived from the ledger, which fixes the counter reset that `|| !structured` was
  papering over.
- **Server state is not recorded**, though OAI-20 asks for it. It is not observable from the client;
  `lms ps` is external. Request size landed as `promptChars`.
- **Retrying is not proven sufficient.** These are the four shapes *observed*, and whether retry
  actually recovers the 37.5% is a measurement OAI-19 will read off the attempt record — not a claim
  made here. The JIT-TTL hypothesis (can a 10-minute idle TTL unload a model under a long prefill?)
  is likewise left to be characterized from that record rather than assumed.
