---
description: Delegate a self-contained task to a local model on an OpenAI-compatible server, instead of doing it yourself
argument-hint: '[--background] [--max-wait <s>] [--provider <name>] [--model <id>] [--file <path>]... <what the model should do>'
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
- Preserve the user's own flags (`--provider`, `--model`, `--base-url`, `--timeout`, `--max-seconds`, `--max-attempts`, `--max-tokens`, `--temperature`, `--system`, `--template`) exactly as given.
- `--timeout` bounds the wait for the model's **first token** — connecting plus reading the prompt, which is silent and can take minutes on a large input. Once tokens are flowing it no longer applies; a separate idle budget (`idleSeconds` in the provider config, 60s by default) ends the run only if output *stops*.
- `--max-attempts` bounds how many times a request is **re-sent** when the server drops it — an empty completion, a blank one, or a stream that closes part way. Default 3; `--max-attempts 1` disables retry and behaves exactly as this command did before retry existed. It counts *answer attempts*, not HTTP requests: a server refusing a capability already costs an extra request inside a single attempt. A refusal, a bad answer and a timeout are never retried — only a request the server failed to deliver.
- **Attempts multiply the wall clock**, and without `--max-seconds` there is no ceiling on it: one attempt can run for the first-token budget plus generation that only the idle budget bounds, and three attempts is three of those. Pass `--max-seconds` when that matters — it caps the whole call, retries included.
- `--timeout` therefore does not bound a run that keeps producing. `--max-seconds` does: it is a wall-clock cap on the whole model call, retries included, and a run that hits it fails saying so rather than being reported as a slow success. There is **no default** — without the flag a run that is still generating is not time-limited, which is the behaviour that has always applied here. It bounds the model call only; collecting files and resolving the model sit outside it. Settable per provider as `maxSeconds` in the config.

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
- `--template <name>` runs a named task template, which fixes the question, the reply shape and the
  caveats printed with the answer, so a recurring kind of request stops being a prompt someone
  rewrites each time. One exists: **`advisor`** — a second opinion on an approach you are about to
  take. Describe the plan as the request text and attach the files it touches; the model answers in
  three sections (strongest objection, assumed without evidence, what it would check first) and the
  output carries a line saying the claims are unverified. It judges the **approach**, not the code —
  for a defect hunt over a diff use `/oai:review`. A template supplies its own system prompt, so
  `--template` and `--system` cannot be used together and the script says so rather than picking one.
  Keep the attachment set small: a large request gets an answer with a note saying it may have
  crowded out the reasoning.
- If the request text itself needs to mention one of this command's own flags (as in "explain the
  `--file` flag"), either put it after a bare `--` separator or use `--prompt-file`. The script
  reports such a flag rather than silently treating it as part of the request.

- `--background` hands the task to a detached worker and prints a job id instead of an answer. The
  request is frozen at submission — the full text of every `--file` is captured then, so editing
  those files afterwards does not change what the model is asked. The job outlives this session and
  is retrievable from any other. Use it when the run would otherwise leave the session waiting on a
  model for minutes; a local model's prefill alone can take several. Submission still fails *here*
  and now if the server is unreachable or the request will not fit the window, rather than turning
  into a job that fails quietly later. `/oai:status` says what a job is doing, `/oai:result` prints
  its answer once it has one, and `/oai:cancel` asks it to stop.

- `--json` prints the whole run as one object instead of the answer and its footer: the reply as an
  opaque string under `content`, plus the provider, the model that answered beside the one requested,
  usage, timings, the size figures, and `notes` — the same caveat lines the text rendering prints
  under the footer, as an array. It is for a harness, not a person; the answer's own shape is never
  parsed, so nothing in the envelope claims the reply conformed to anything. A run that fails prints
  a failure object on stdout **and still** writes its message to stderr and exits nonzero, so nothing
  that worked before reads differently. With `--background` it prints `{"id": …, "background": true}`
  rather than a bare id.

- `--max-wait <seconds>` caps how long a background job will sit **queued** waiting for its turn, as
  opposed to how long its own run may take (`--max-seconds`). Two different clocks. A job that cannot
  tolerate sitting behind a long-running one gives up cleanly without ever sending a request to the
  model. The default is to wait indefinitely, so pass this when the answer stops being useful after
  a while.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" task [flags] "<prompt>"
```

Handling failures:

- The script exits 1 with a specific message and remediation for user-fixable problems (server down, no model loaded, input too large for the window, missing file). Show that message; do not retry with different flags, and do not silently drop files to make the input fit.
- If it reports that no provider is reachable, suggest `/oai:setup`.
