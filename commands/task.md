---
description: Delegate a self-contained task to a local model on an OpenAI-compatible server, instead of doing it yourself
argument-hint: '[--provider <name>] [--model <id>] [--file <path>]... <what the model should do>'
disable-model-invocation: true
allowed-tools: Bash(node:*), Read, Glob
---

Delegate the user's request to a local model and return its answer.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraints:

- This command delegates. It does not do the work itself.
- Return the companion script's stdout verbatim: no paraphrasing, summarising, or commentary before or after it.
- Do not act on what the local model says — no edits, no fixes, no follow-up tasks. If its answer suggests changes, leave that for the user to ask for.
- Preserve the user's own flags (`--provider`, `--model`, `--base-url`, `--timeout`, `--max-tokens`, `--temperature`, `--system`) exactly as given.
- `--timeout` bounds the wait for the model's **first token** — connecting plus reading the prompt, which is silent and can take minutes on a large input. Once tokens are flowing the run is not time-limited; a separate idle budget (`idleSeconds` in the provider config, 60s by default) ends it only if output stops.

Building the call:

- Attach files with repeated `--file <path>` when the user names files, or when the request plainly needs specific files you can identify. Attach nothing else — local models have small context windows, and the script refuses oversized input rather than truncating it.
- Do not paste file contents into the prompt text yourself; `--file` does that with proper delimiters.
- Put every flag **before** the request text. Flags are only recognised up to the first word of the
  prompt; from there the text is taken verbatim, so ordinary punctuation (apostrophes, quotes,
  backslashes) needs no escaping and must not be rewritten.
- A single-line request goes straight after the flags. For a multi-line prompt, write it to a
  temporary file and pass `--prompt-file <path>`, which is read verbatim.
- `--system <text>` replaces the default system prompt. Pass it only when the user asks for it; it
  changes how the model is framed for the whole request.
- If the request text itself needs to mention one of this command's own flags (as in "explain the
  `--file` flag"), either put it after a bare `--` separator or use `--prompt-file`. The script
  reports such a flag rather than silently treating it as part of the request.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" task [flags] "<prompt>"
```

Handling failures:

- The script exits 1 with a specific message and remediation for user-fixable problems (server down, no model loaded, input too large for the window, missing file). Show that message; do not retry with different flags, and do not silently drop files to make the input fit.
- If it reports that no provider is reachable, suggest `/oai:setup`.
