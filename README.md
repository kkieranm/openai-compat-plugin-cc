# openai-compat-plugin-cc

A Claude Code plugin that delegates work to models you host yourself — anything speaking the
OpenAI-compatible `/v1/chat/completions` API: [LM Studio](https://lmstudio.ai), oMLX,
Unsloth Studio, or a remote compatible endpoint.

Inspired by [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), but the transport
is plain HTTP and the providers are configuration rather than code, so adding one is a config edit.

## Install

Clone it and load it into a Claude Code session:

```sh
git clone https://github.com/kkieranm/openai-compat-plugin-cc.git
claude --plugin-dir ./openai-compat-plugin-cc/plugins/oai -p "/oai:setup"    # try it in one session
```

Or add it as a plugin marketplace and install from there:

```
/plugin marketplace add kkieranm/openai-compat-plugin-cc
/plugin install oai@openai-compat
```

Foreground `/oai:task` and `/oai:review` run on Node 18.18+. Background jobs (`/oai:task
--background`) additionally need `node:sqlite`, available unflagged on Node 22.13+.

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
`generationTokensPerSecond`, `servedModelIds` (below), and `apiKeyEnv` (name of an environment variable
holding the key — preferred) or `apiKey`. All are optional: `contextLength` is detected where possible,
and `defaultModel` is only needed when a server offers more than one chat model. Setting
`contextLength` is worth it for `/oai:review`: without a window figure it sends the diff-covered
changed files as hunks alone rather than building a request nothing can size, so a review is narrower
than it needs to be (it says so when it does). Files covered by no diff — untracked, or given with
`--file` — still go whole either way, because withholding the only copy of that code would review
nothing.

The two rate options exist only so `/oai:task` can tell you roughly how long a request will take
**before** it spends it — prefill is silent and can run to minutes on a large input, which is exactly
when you would rather have used `--background`. They are yours to measure, and nothing is estimated
without them: a rate copied from someone else's hardware would be acted on as confidently as a real
one, so the plugin says nothing rather than guessing. Take them from a run's own footer, which
reports prefill, generation and tokens separately. The seeded ports are each project's documented default; correct them if your server listens
elsewhere.

`servedModelIds` is for a server whose replies name a model under a different id than the one it
lists. Unsloth Studio, for example, lists `lmstudio-community/Qwen3.8-27B-MLX-4bit` but every reply
reports `Qwen3.8-27B-MLX-4bit`, so each run is reported as a substitution (and the benchmark excludes
it). Map the requested id to the id the server reports:

```json
"unsloth": {
  "baseUrl": "http://localhost:8888/v1",
  "servedModelIds": { "lmstudio-community/Qwen3.8-27B-MLX-4bit": "Qwen3.8-27B-MLX-4bit" }
}
```

A reply naming exactly the declared id for the requested id is then not a substitution; every other
pair is still compared exactly. The mapping is your assertion that the two ids are the same model,
not proof of it — nothing the plugin can query confirms it — so `--json` records it as
`declaredServedModel` beside `requestedModel` and `model`, the `/oai:task`, `/oai:review` and
`/oai:result` footers show such a reply as `model: <served> (declared for <requested>)`, the
benchmark and review-sweep reports name each pairing a scored run or sweep entry relied on, and the
sweep reproduction reader discloses such a run as provenance-unverifiable. Declare only an id the
server does not also list as a model of its own: if it does, a real swap to that model would be
accepted as the requested one. The declaration describes the provider's own endpoint: it does not
apply under `--base-url` to a different endpoint, or to a bare `--base-url` with no `--provider`.

Provider precedence is `--base-url` > `--provider` > `defaultProvider`. Model precedence is
`--model` > the profile's `defaultModel` > the server's sole chat model. If a server offers several
chat models and none is named, the plugin lists them and asks rather than picking one for you;
embedding models are never chosen. **`--model` selects which model is requested; it does not
configure how the server loads it.** Whether an id that is downloaded but not resident gets loaded on
demand is the server's decision, and observed behaviour differs — observed on LM Studio 0.4.20,
which attempts the load, sizes it by its own settings, and may refuse for want of memory
(a 7.15 GB model it sized at 44.87 GB), and on oMLX 0.5.7, which loads on demand successfully. Those
are two observations at two versions, not an account of every server: if yours is neither, nothing
here predicts what it will do — including whether it refuses at all, since a server may instead answer
from whatever it already has loaded. A named provider must
exist even when `--base-url` overrides its endpoint, and if that URL points at a different host the
profile's API key is **not** sent with it.

Flags go before the request text; from the first word of the request onward, everything is taken
verbatim, so apostrophes, quotes and backslashes need no escaping. To ask about a flag by name, put
the request after a bare `--` (`/oai:task -- explain the --file flag`) or use `--prompt-file`.

## Notes

- **Oversized input is refused, never truncated.** The plugin refuses work that cannot fit the
  model's context window, quoting both numbers, rather than silently sending half the input. The
  size is an estimate. Non-ASCII text (accented Latin, CJK, emoji, …) is counted conservatively —
  about threefold for Chinese prose — so input dense in it can be refused before the window is
  actually full; the refusal usually notes when that may be the cause.
- **A refused reply budget is retried once, at the budget the server names.** A server can refuse a
  request's `max_tokens` with HTTP 413 and state the largest it would take — vMLX sends
  `safe_cap=<N>` when the budget exceeds its projected memory headroom, a figure that moves with load.
  `/oai:review` then plans the whole request again with `N` as its reply budget, says so on stderr, and
  sends it once, inside the same `--max-seconds` deadline. A second refusal is final, and so is a
  stated budget below the 4,096 tokens a review's reserve shrinks to for a large input, or no smaller
  than the one refused. `/oai:task` does not retry; its error names the budget to pass as
  `--max-tokens`, unless the request already asked for no more than that. An HTTP 413 is reported
  with the reason `request-too-large`, and each attempt in the `--json` record carries the
  `maxTokens` it asked for. A cap stated with any other status is not read.
- **The window is detected automatically** on LM Studio, oMLX, vMLX, vLLM, llama.cpp and TGI, and
  `/oai:setup` shows where the number came from. On vMLX it is the server's prompt cap, for the model
  under the name the server lists (another name the server also accepts gets none), read only while
  a model is loaded so that probing does not wake a sleeping vMLX (for a `baseUrl` at the server's
  root; one with a query string is sent `/v1/models` without it once `/health` identifies vMLX, while
  an unidentified `/health`, or a 401/403 for `/v1/models` without the query, sends `/v1/models` with
  it, which can wake the model); a cap set with `--max-prompt-tokens` above the model's own context
  is taken as given, so set `contextLength` in that case. Only the window a server is *actually
  serving* counts — a model's theoretical ceiling is ignored, since guarding on it would admit input
  the server rejects. Where nothing can be detected the plugin warns instead of guessing, and
  `contextLength` on a profile overrides detection. An undetected window is not treated as a large
  one: `/oai:review` stops sending the diff-covered changed files whole rather than shipping a
  request it cannot size, and reports the skip. Files covered by no diff still go whole — see the
  review command's docs.
- **Review findings are claims, not conclusions.** They come from a small model asked to report
  findings in a fixed shape — requested in prose and parsed leniently by default, or as a strict JSON
  schema under `--structured-output`. Each one is checked against the real code before anything is
  changed, and a finding that cannot be reproduced is reported as refuted rather than fixed. Expect
  false positives.
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

## Privacy

Your prompts and any files you attach are sent only to the model server you configure — there is no
other network destination. A background job persists its request (including the full text of every
attached file) in a local SQLite database under your state directory (`$XDG_STATE_HOME`, or
`~/.local/state` by default), created with restrictive permissions; the provider config lives in
`~/.config/oai-plugin/providers.json`. Prefer an `apiKeyEnv` entry over putting a credential in a
provider's URL. A credential in the query string of a *configured* provider is committed to the jobs
database as a hash rather than stored; but a credential in the URL path — or in an ad-hoc `--base-url`
query — is stored as given, and a path-embedded one is also shown back to you on `/oai:status` and in
interactive error output.

## Development

```sh
npm test    # network-free; runs against an in-process fake OpenAI-compatible server
```

The test suite requires `zsh` on `PATH`. See [`CLAUDE.md`](CLAUDE.md) for architecture and conventions,
and [`CHANGELOG.md`](CHANGELOG.md) for shipped capabilities.

## License

[MIT](LICENSE).
