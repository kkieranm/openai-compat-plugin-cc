# 002 — Detecting the context window, and what counts as one

Date: 2026-07-27
Status: accepted
Amends: [ADR 001](001-generic-openai-compatible-plugin.md)
Amended by: [ADR 011](011-which-model-actually-answered.md) — automatic selection now reads `state` to pick the loaded model, and an id absent from a recognised catalogue is refused before the run.

## Context

The size guard from ADR 001 only ran when a profile hand-declared `contextLength`. In practice that
meant it was inert: it stayed off until someone read a vendor API by hand and copied a number into
the config. A guard that is off by default is not a guard.

Detecting the number is harder than it looks. **No OpenAI-compatible server reports a context window
in the standard `/v1/models`** — the spec's model object is `id`/`created`/`object`/`owned_by`, and
this was confirmed live: LM Studio's `/v1/models` carries none of it while its native
`/api/v0/models` carries all of it. Every context field in existence is a vendor extension.

Worse, those extensions do not all mean the same thing. They split in two:

- **Served windows** — what the server will actually accept right now: LM Studio's
  `loaded_context_length`, vLLM's `max_model_len`, llama.cpp's `/props` → `n_ctx`, TGI's
  `max_total_tokens`.
- **Model ceilings** — what the model could theoretically support: LM Studio's `max_context_length`,
  llama.cpp's `meta.n_ctx_train`, Ollama's `<arch>.context_length`.

The gap is not marginal. On the verification machine the same model reported a ceiling of 262144 and
a served window of 58112 — 4.5× apart. llama.cpp will happily report a 131072 training context while
serving 4096.

## Decision

**Detect by response shape, never by provider name.** `scripts/lib/model-info.mjs` is the only module
that knows a vendor dialect. It tries `/v1/models` first (free — vLLM's field rides on a response we
already fetch), then a short chain of native endpoints under the same origin, and uses the first
recognisable shape. It never consults the profile's name, so an unknown server that happens to speak
a known dialect is detected correctly and a provider renamed in config behaves identically. This
amends ADR 001's "nothing branches on provider identity" rather than breaking it: the property that
rule protects — that a provider is data — still holds.

**Only a served window counts.** A ceiling is recorded as `ceiling` and used for display only; it can
never become the number the guard divides by. Guarding on a ceiling would silently admit input the
server then rejects, which is precisely the failure the guard exists to prevent — so when only a
ceiling is known the window stays *unknown* and the plugin warns, exactly as before detection
existed. LM Studio reports `loaded_context_length` only while a model is `loaded`, so a model awaiting
a JIT load correctly lands in that unknown-and-warn state.

**Every reported window names its source.** `/oai:setup` prints
`context: 58.1k (detected via LM Studio /api/v0/models)`. This is what keeps an unverified probe
honest: the oMLX reader was written from documentation rather than a running server, and is
reportedly liable to advertise a global default rather than the model's real window. Attribution
means a guess never looks like a measurement. It also has to describe the model a task would
*actually* use — reporting some other loaded model's window would promise a guard the task will not
have.

**Automatic model selection excludes embedders, and refuses to guess.** Models whose type is
`embeddings` are dropped — a denylist, not an allowlist, because the chat model on the verification
machine reports type `vlm` and future types must keep working. If more than one candidate remains and
none was named, the run stops and lists them instead of taking the first, which is how an embedding
model could have been sent a chat request.

## Consequences

- The guard is armed by default on LM Studio, vLLM, llama.cpp and TGI with no configuration; the
  hand-set `contextLength` that verification previously required has been removed from the author's
  own config, since a stale explicit value would now silently outrank correct detection.
- ~~A fully configured profile (`defaultModel` + `contextLength`) performs no probes at all; detection
  runs only for what the config leaves unanswered.~~ **Superseded by [ADR 011](011-which-model-actually-answered.md).**
  Once `planSelection` could refuse a model for being absent from the server's catalogue, this
  short-circuit meant `/oai:setup` (which always probes) and `/oai:task` (which did not) fed the same
  planner different evidence — and disagreed about the same provider. `resolveTarget` now always
  fetches the model list. The consequence below, that a stale hand-set `contextLength` silently
  outranks correct detection, is why this path was already discouraged.
- Servers that report nothing (LocalAI, mlx-openai-server) or only a ceiling (Ollama) keep the old
  behaviour: proceed and warn, with `contextLength` available as the override. Detection is
  best-effort in the strict sense — when the model is already known and only the window is being
  sized, a `/v1/models` that 404s or times out must not fail the task. Choosing a model is the one
  case where the same failure is fatal, because there is nothing to send to.
- `/oai:setup` calls a provider `ok` only when a task could actually pick a model there, and it
  determines that by calling `planSelection()` — the same function the task path uses — rather than
  approximating it. Two review rounds produced nine instances of setup promising something the task
  refused; the cure was a single authority, not a better approximation. Any future status output
  must call the planner, never re-derive it.
- A configured `contextLength` still wins over detection, but when the server reports a *different*
  served window the report says so. ADR 002 originally named that staleness hazard and left it to
  the operator; the code now surfaces it in the one place that knows both numbers.
- `contextLength` and `timeoutSeconds` are validated as positive integers at config load. A string
  like `"8k"` previously turned every comparison in the guard into `NaN`, so it reported an armed
  check that tested nothing — the worst possible failure for a guard whose contract is to refuse
  loudly.
- A server offering several chat models now needs `--model` or `defaultModel`. That is a deliberate
  behaviour change: the previous silent first-entry pick was the OAI-2b defect.
- Adding a dialect is a code change, in one module, with one test per dialect. The alternative —
  a config-authored probe definition — was rejected as a mini query language for a case the existing
  `contextLength` override already covers.
