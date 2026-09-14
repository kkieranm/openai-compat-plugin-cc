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
