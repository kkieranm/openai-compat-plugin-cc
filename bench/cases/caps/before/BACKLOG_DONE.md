# Done

Newest first.

- **OAI-4** — `/oai:review`: a local second opinion on the diff. Completed 2026-07-27, pulled ahead
  of OAI-3 so it could be used while building the rest. Strict `json_schema` findings read from
  whichever channel carries them, degrading to prompt-and-parse when a server refuses the schema;
  the target is collected in Node and includes untracked files. Fixed a shipped defect on the way:
  an empty answer was reported as success. Live-verified against LM Studio — five findings on a real
  commit in 32s, a 74.5k-token input refused before sending, and a false positive correctly refuted
  rather than fixed. Design in `adr/003-structured-findings.md`.

- **OAI-2 + OAI-2b** — Context-window auto-detection and embedder exclusion. Completed 2026-07-27.
  Probes by response shape across LM Studio, vLLM, llama.cpp, TGI and (unverified) oMLX, trusting only
  served windows over model ceilings; automatic model selection drops embedders and refuses to guess
  between several candidates. Live-verified against LM Studio with all hand-set config removed:
  detected 58.1k with attribution, picked the chat model over the embedder, and still refused a
  65.4k-token input. Design in `adr/002-context-window-detection.md`.

- **OAI-1** — Plugin skeleton + `/oai:setup` + synchronous `/oai:task`. Completed 2026-07-27.
  Live-verified against LM Studio serving `qwen3.6-35b-a3b-ud-mlx` (58k loaded window): `/oai:setup`
  listed the provider and model, `/oai:task` returned real model output through a `--plugin-dir`
  load, the context guard refused a 65.4k-token input before sending, and a 22.5k-token whole-repo
  summarization ran in 62s. Reviewed by advisor, the lean workflow, and a high-effort `/code-review`
  (15 findings total, all fixed). Design in `adr/001-generic-openai-compatible-plugin.md`.
