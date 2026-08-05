# openai-compat-plugin-cc

A Claude Code plugin that delegates work to models you host yourself — anything speaking the
OpenAI-compatible `/v1/chat/completions` API: [LM Studio](https://lmstudio.ai), oMLX,
Unsloth Studio, or a remote compatible endpoint.

Inspired by [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), but the transport
is plain HTTP and the providers are configuration rather than code, so adding one is a config edit.

## Install

```sh
claude --plugin-dir /path/to/openai-compat-plugin-cc     # try it in one session
```

## Commands

| Command | What it does |
| --- | --- |
| `/oai:setup` | Probes every configured provider and reports which are reachable and what models they have loaded. Seeds the config file on first run. |
| `/oai:task` | Delegates one request to a local model and returns its answer verbatim. |
| `/oai:review` | Has a local model review your diff, then checks each finding against the code and fixes the real ones. |

```
/oai:setup
/oai:task summarize what this module is responsible for
/oai:task --file src/parser.js --file src/lexer.js where would an off-by-one hide here?
/oai:task --provider omlx --model mlx-community/Qwen3-8B draft a docstring for this function

/oai:review                      # working tree + staged + untracked, vs HEAD
/oai:review --staged
/oai:review --base main          # the whole branch
/oai:review --commit 1ea398f
/oai:review --file src/parser.js pay attention to the error paths
```

Useful flags: `--provider <name>`, `--model <id>`, `--base-url <url>`, `--file <path>` (repeatable),
`--prompt-file <path>`, `--timeout <seconds>`, `--max-tokens`, `--temperature`. `/oai:review` adds
`--staged`, `--base <ref>` and `--commit <ref>`, and takes any trailing text as extra instructions
for the reviewer.

## Configuration

`~/.config/oai-plugin/providers.json`, created on first run (override the location with
`OAI_PLUGIN_CONFIG`):

```json
{
  "defaultProvider": "lmstudio",
  "providers": {
    "lmstudio": { "baseUrl": "http://localhost:1234/v1", "contextLength": 8192 },
    "omlx":     { "baseUrl": "http://localhost:8000/v1" },
    "unsloth":  { "baseUrl": "http://localhost:8888/v1" }
  }
}
```

Per-provider options: `defaultModel`, `contextLength`, `timeoutSeconds`, `prefillTokensPerSecond`,
`generationTokensPerSecond`, and `apiKeyEnv` (name of an environment variable holding the key —
preferred) or `apiKey`. All are optional: `contextLength` is detected where possible, and
`defaultModel` is only needed when a server offers more than one chat model.

The two rate options exist only so `/oai:task` can tell you roughly how long a request will take
**before** it spends it — prefill is silent and can run to minutes on a large input, which is exactly
when you would rather have used `--background`. They are yours to measure, and nothing is estimated
without them: a rate copied from someone else's hardware would be acted on as confidently as a real
one, so the plugin says nothing rather than guessing. Take them from a run's own footer, which
reports prefill, generation and tokens separately. The seeded ports are each project's documented default; correct them if your server listens
elsewhere.

Provider precedence is `--base-url` > `--provider` > `defaultProvider`. Model precedence is
`--model` > the profile's `defaultModel` > the server's sole chat model. If a server offers several
chat models and none is named, the plugin lists them and asks rather than picking one for you;
embedding models are never chosen. A named provider must
exist even when `--base-url` overrides its endpoint, and if that URL points at a different host the
profile's API key is **not** sent with it.

Flags go before the request text; from the first word of the request onward, everything is taken
verbatim, so apostrophes, quotes and backslashes need no escaping. To ask about a flag by name, put
the request after a bare `--` (`/oai:task -- explain the --file flag`) or use `--prompt-file`.

## Notes

- **Oversized input is refused, never truncated.** The plugin refuses work that cannot fit the
  model's context window, quoting both numbers, rather than silently sending half the input.
- **The window is detected automatically** on LM Studio, vLLM, llama.cpp and TGI, and `/oai:setup`
  shows where the number came from. Only the window a server is *actually serving* counts — a
  model's theoretical ceiling is ignored, since guarding on it would admit input the server rejects.
  Where nothing can be detected the plugin warns instead of guessing, and `contextLength` on a
  profile overrides detection.
- **Review findings are claims, not conclusions.** They come from a small model asked for a strict
  JSON schema; each one is checked against the real code before anything is changed, and a finding
  that cannot be reproduced is reported as refuted rather than fixed. Expect false positives.
- **A schema-constrained reply arrives in the model's reasoning channel**, not `content` — the
  grammar leaves it unable to close its thinking block. The plugin reads it there, but only under a
  schema, where parsing proves what it is. Without one, an empty answer is an error, never silence.
- **A foreground call blocks, and prints nothing until it is done.** The transport itself reads the
  reply as an SSE stream, but the command buffers it: a slow local model prints a `Contacting …` line
  to stderr, then the whole answer at once with a footer of provider, model, duration and token
  counts. Nobody sees output arrive incrementally.
- **Work that would outlast your patience goes in the background.** `/oai:task --background` prints a
  job id instead of an answer, and the request — including the full text of every `--file` — is frozen
  at submission, so editing those files afterwards does not change what the model was asked. The job
  outlives the session that made it. `/oai:status` says what it is doing, `/oai:result <id>` prints
  its answer, `/oai:cancel <id>` asks it to stop. One background job runs at a time; the rest queue.
- **`oai:oai-delegate` is a subagent that does the choosing for you.** Give it a bounded task and it
  selects the files, submits one background job, and hands back a short account plus the job id —
  keeping both the file reading and the model's full reply out of your session. The verbatim answer
  stays one `/oai:result <id>` away.

## Development

```sh
npm test    # network-free; runs against an in-process fake OpenAI-compatible server
```

See `CLAUDE.md` for conventions and [ADR 001](adr/001-generic-openai-compatible-plugin.md) for the
design rationale.
