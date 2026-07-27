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

```
/oai:setup
/oai:task summarize what this module is responsible for
/oai:task --file src/parser.js --file src/lexer.js where would an off-by-one hide here?
/oai:task --provider omlx --model mlx-community/Qwen3-8B draft a docstring for this function
```

Useful flags: `--provider <name>`, `--model <id>`, `--base-url <url>`, `--file <path>` (repeatable),
`--prompt-file <path>`, `--timeout <seconds>`, `--max-tokens`, `--temperature`.

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

Per-provider options: `defaultModel`, `contextLength`, `timeoutSeconds`, and `apiKeyEnv` (name of an
environment variable holding the key — preferred) or `apiKey`. All are optional: `contextLength` is
detected where possible, and `defaultModel` is only needed when a server offers more than one chat
model. The seeded ports are each project's documented default; correct them if your server listens
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
- **Calls are synchronous and non-streaming.** A slow local model prints a `Contacting …` line to
  stderr, then the answer with a footer of provider, model, duration and token counts.

## Development

```sh
npm test    # network-free; runs against an in-process fake OpenAI-compatible server
```

See `CLAUDE.md` for conventions and [ADR 001](adr/001-generic-openai-compatible-plugin.md) for the
design rationale.
