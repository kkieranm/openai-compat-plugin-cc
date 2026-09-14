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
- Preserve the user's own flags (`--provider`, `--model`, `--base-url`, `--timeout`, `--max-tokens`, `--temperature`) exactly as given.

Building the call:

- Attach files with repeated `--file <path>` when the user names files, or when the request plainly needs specific files you can identify. Attach nothing else — local models have small context windows, and the script refuses oversized input rather than truncating it.
- Do not paste file contents into the prompt text yourself; `--file` does that with proper delimiters.
- If the prompt is a single line without quotes or shell metacharacters, pass it as the trailing text.
- Otherwise write the prompt to a temporary file and pass `--prompt-file <path>`, which is read verbatim.
- Also use `--prompt-file` whenever the prompt text itself contains a `--token` (as in "what does
  `--json` do?"). Prompt text is parsed for flags, so a bare `--word` is rejected as an unknown
  option, and a real flag name would swallow the following word as its value.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" task [flags] "<prompt>"
```

Handling failures:

- The script exits 1 with a specific message and remediation for user-fixable problems (server down, no model loaded, input too large for the window, missing file). Show that message; do not retry with different flags, and do not silently drop files to make the input fit.
- If it reports that no provider is reachable, suggest `/oai:setup`.
