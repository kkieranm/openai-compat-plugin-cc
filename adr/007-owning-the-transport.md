# 007 — Streaming, and owning the timeouts it exposes

Status: accepted, 2026-07-28.

## The problem

`timeoutSeconds` never worked above five minutes, and the failure was misreported.

`client.mjs` set `AbortSignal.timeout(timeoutMs)` on the global `fetch`. But Node's `fetch` is undici,
and undici applies its **own** `headersTimeout` — 300s, reachable from nothing in `fetch()`'s options.
An `AbortSignal` beside it can only *lower* the effective bound, so the real limit was always
`min(timeoutMs, 300_000)` and the configured number was decoration above that.

LM Studio does not stream by default, so response headers do not arrive until generation *finishes*.
Any run over five minutes therefore died as `UND_ERR_HEADERS_TIMEOUT` whatever the config said.

Measured cost: with `timeoutSeconds: 1800` set, **14 of 18 benchmark runs died** on 2026-07-28. The
four survivors took 60/147/199/238s — every one under 300. That blocked the dense-27B benchmark arm
outright, and it is why this item was promoted from "a nicety for `/oai:task`" to a blocker.

Two defects were stacked here, and the second is the repo's signature class. `describeFailure`
matched only `TimeoutError`/`AbortError`, so the death rendered as a generic
`fetch failed (UND_ERR_HEADERS_TIMEOUT)` **without** the raise-the-timeout hint — and that hint would
have been wrong anyway. A remedy offered for a cause the code never diagnosed.

## What the probes settled

The obvious fix — `stream: true`, so headers arrive at once — is **not sufficient**, and finding that
out is what shaped this design. Everything below was measured on 2026-07-28, not reasoned about:

| probe | result |
|---|---|
| streaming, a chunk every 60s, 360s total | **survived** — undici's `bodyTimeout` is inactivity-based, so generation time is effectively unbounded |
| headers, then silence | **died at 301s**: `TypeError: terminated`, `cause.code = UND_ERR_BODY_TIMEOUT` |
| ~52k-token prompt, cache-busted (cold) | **first token at 393.7s** |
| the same prompt again (warm) | first token at **9.3s** |
| streaming request, any size | headers at **0.0s**; payload arrives in `delta.reasoning_content`, `delta.content` never appears |
| `stream_options: {include_usage: true}` | a real usage object, in a frame whose `choices` is `[]` |

So streaming fixes slow *generation* and does nothing for slow *prefill*: the 300s wall moves from
`headersTimeout` to `bodyTimeout`, and a cold prefill clears it before one token exists. The ceiling
had to become ours, which meant taking the request off `fetch`.

## Decision

**`node:http`/`node:https`, not a dispatcher wrapper.** The zero-dependency alternative — reaching
Node's bundled undici through `Symbol.for('undici.globalDispatcher.1')` and forwarding with the
timeouts overridden — was verified working on Node 26.3.1 and rejected on its failure mode. The symbol
is not public API; if a future Node moves it, the override stops applying **silently** while the
config still advertises 1800s. A guard reporting itself armed while disarmed is the most-repeated
defect class in this repo (16 recorded instances), and choosing a smaller diff that fails that way
would have been choosing the bug.

**Budgets live at two levels**, and the split is the part worth remembering:

- **Transport (`http.mjs`)** — `firstByteMs`, plus an optional absolute `totalMs`. This is all a
  transport can honestly measure.
- **Semantics (`chat.mjs`)** — one budget reset only by a parsed delta whose `content` or
  `reasoning_content` is a **string**: `firstTokenMs` until the first arrives, then `idleMs`.

The first draft bounded bytes at both levels, which is defeatable: an SSE comment (`: keepalive`), a
role-only delta and a half-delivered frame are all socket activity that prove nothing about
generation. A server emitting `:\n\n` every 30 seconds would have held a byte-driven budget open
forever while the plugin reported it armed — the same class, reintroduced by the fix for it.

**`totalMs` is what keeps the control plane safe.** `/v1/models` (10s) and `model-info`'s probes (2s)
are bounded totals today and can never reach undici's 300s. Handing them a phase-based budget with no
ceiling would have let a slow drip hold `/oai:setup` open forever, since it awaits every provider
before printing anything. That regression was caught in review, not in testing.

**A stderr heartbeat, timer-driven.** Fired by a `setInterval`, not by arriving deltas — a
delta-driven tick is silent during exactly the window that prompts the question, the minutes of
prefill where nothing arrives by definition, and silent for the whole run on a server that ignores
`stream`. stdout and `--json` are untouched; the benchmark parses stdout wholesale.

## What `fetch` was silently providing

Re-established by hand, because nothing else would have noticed their absence:

- **Decompression.** `fetch` asked for gzip and decompressed; `node:http` does neither. A compressed
  body would reach the SSE parser as mojibake, yield no `data:` line, and die on a budget — a symptom
  indistinguishable from the bug being fixed. The request now sends `accept-encoding: identity` and a
  response that carries a `content-encoding` anyway is refused **by name**. (LM Studio sends none even
  when gzip is offered; the plugin's scope is any OpenAI-compatible server, so this cannot rest on one
  vendor.)
- **An `Accept` header**, explicitly, rather than letting a server pick a default for us.
- **Byte-accurate `content-length`**, since a multi-byte character makes string length and byte length
  disagree.
- **`AggregateError` unwrapping.** Node 18.18 turned on address-family autoselection, so a host with
  both A and AAAA records fails with the useful code inside `errors[]` and `undefined` on the outer
  object. Without unwrapping, "connection refused" and its start-the-server hint silently vanish.
- **A bounded error-body read.** "Read the body, then truncate to 400" invites an endless one.

Every error out of the transport is a `UserError`. That is a contract, not a nicety: `cmd-setup.mjs`
and `delegate.mjs` both rethrow anything else, so a plain `Error` would turn one unreachable provider
into an exit-2 crash of the whole `/oai:setup` report.

**Upholding that contract needs one subtlety, and the first implementation got it wrong.** A
connection reset *after* headers is destroyed by Node on the **response** object, not the request — so
a `request.on('error')` handler never runs, the abort sentinel stays null, and a raw `Error: aborted`
escaped past both `instanceof UserError` gates. The `!response.complete` branch could not catch it
either, because the async iterator throws before the loop can exit normally. The body generator's
`catch` therefore wraps anything that is not already a `UserError`. Found by review, reproduced
end to end, and now pinned by a test that fails without the wrap.

## Honest limits

- **No total wall-clock cap on a model call.** The guarantee is narrower than "it always exits": the
  client terminates a request that stops making *semantic progress*. A server emitting one valid token
  every 59 seconds is indistinguishable from a very slow model, and would run indefinitely. That is
  the trade the decision buys — a slow-but-working run is never killed.
- **Redirects are not followed.** `fetch` followed them silently. A 3xx is now refused, naming the
  `Location`. This can break a base URL sitting behind an HTTP→HTTPS or trailing-slash redirect; the
  fix is to point `baseUrl` at the final endpoint, and the error says so.
- **`stream_options` is verified against LM Studio only.** A server that refuses it, or refuses
  `stream: true`, gets one retry without the offending field, matching the ladder already proven for
  `response_format`. Losing `usage` costs a token count; failing costs the run.
- **The live rate in the heartbeat counts deltas**, which is an approximation — most servers emit one
  token per chunk. The footer's figure stays exact, derived from `usage`. Two numbers labelled the same
  that disagree would be worse than one.
- **The benchmark captures stderr wholesale**, so heartbeats land in a failed run's diagnosis rather
  than on screen. The heartbeat fixes direct `task`/`review` invocation; it does not improve
  `npm run bench` output.

## Consequences

`timeoutSeconds` now means time-to-first-token, and its default rises 300s → **600s**, sized from the
measured 393.7s cold prefill on 52k tokens (~132 tok/s, so the corpus's largest case projects to
~485s). A new optional `idleSeconds` (60s) bounds the gap between tokens and is validated beside the
other numeric config keys — an unvalidated `"8k"` there would be a guard reporting itself armed.

`tests/structure.test.js` gains a guard: **no file may call the global `fetch`**. The defect was an
invisible default, so the call site is what it forbids. There are no exemptions.

The return shape of `chatCompletion` is unchanged, so `structured.mjs`, `review-report.mjs`,
`render.mjs` and `bench/` needed no edits. One accumulator serves both the streamed and whole-JSON
paths, deliberately: they must agree about what counts as an answer, and the guard they share is the
one where `typeof content !== 'string'` was satisfied by `''` (REPO_TRAPS instance 10). A delta
accumulator initialised to `''` makes that condition unreachable, so the accumulator records whether a
channel was ever *seen*, separately from what it collected.

**A stream that ends without `[DONE]` and without a `finish_reason` is reported as truncated**, not
returned as an answer. A connection can close cleanly at the HTTP layer while the completion is cut
short, and presenting that as complete is the "confident wrong answer" class.
