---
description: Get a second-opinion code review from a local model, then verify each finding and fix the ones that are real
argument-hint: '[--staged] [--base <ref>] [--commit <ref>] [--file <path>]... [--diff-only] [--structured-output] [--json] [extra instructions]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Read, Grep, Glob, Edit
---

Have a local model review the diff, then check its claims yourself and fix the real ones.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" review [flags] "<extra instructions>"
```

Put every flag **before** the instructions, and quote the instruction text as one argument. From its first word onward it is taken verbatim, so apostrophes, quotes and backslashes must survive exactly as the user typed them — never rewrite or re-escape them. If the instructions themselves need to name one of this command's flags, put them after a bare `--`.

The script decides what to review — do not build a diff yourself or paste one into the arguments. With no flags it reviews uncommitted work (working tree, staged changes, and untracked files). `--staged`, `--base <ref>`, `--commit <ref>` and repeated `--file <path>` change the target; `--provider`, `--model`, `--base-url`, `--timeout`, `--max-seconds`, `--max-attempts`, `--max-tokens` and `--temperature` behave as in `/oai:task`, except that `--max-tokens` has a floor here: a review reply carries a findings array and a reasoning field, and a budget too small to hold both is refused rather than sent, naming the minimum. Pass the user's flags through exactly. Any trailing text is forwarded as extra instructions for the reviewer, verbatim.

Each changed file is sent whole alongside the diff, so the model can resolve anything defined outside the changed hunks. `--diff-only` sends just the diff — faster on a slow local model, at the cost of the "X is not defined" false positives that whole files exist to prevent. It cannot be combined with `--file`, which has no diff.

`--cache-buster <token>` puts the token at the head of the system prompt, which changes the request's leading text and so defeats a server-side prompt cache. It exists for measurement: repeating a review against the same target is otherwise served from cache, and a cached repeat reaches its first token tens of times faster than the first run did, so a timing taken from it is not the cost a first review pays. Pass a value that has not been used before — the point is that the server has never seen this prefix. It changes nothing about what is reviewed, but it does change what the model reads, so use it when timing a run rather than by default.

`--structured-output` asks the server to enforce the reply's shape with an OpenAI `response_format` JSON schema, instead of describing that shape in the prompt and parsing what comes back. **It is off by default, and the default is deliberate: on LM Studio's MLX backend a schema is not a formatting preference but a crash.** The grammar built from it exhausts its lexer's state budget after roughly 14,000 generated tokens and takes the model process down with it, which cost this plugin about 38% of its long requests before anyone read the server log. Without the flag the reply is generated unconstrained and parsed leniently, which is slightly less reliable to parse and vastly more reliable to obtain. Suggest it only for a server known to enforce schemas without that grammar engine, and never as a fix for a reply that failed to parse.

`--json` prints the whole run as one JSON object on stdout — findings, summary, every caveat the text report carries, plus token usage and timing — instead of the report below. It exists for scripts and for the benchmark harness (`npm run bench`). Pass it only if the user asks for it: the verification duty below still applies to whatever it returns, and `"parsed": false` means the model's reply could not be read, which is not the same as finding nothing.

**The findings are unverified claims from a small model. Treat them as leads, not conclusions.**

For every finding, in order:

1. Read the code it names. Not the diff — the file as it stands.
2. Decide **confirmed** or **refuted**, and say why in one line. Refute anything you cannot reproduce from the code in front of you: a finding about code that was not shown, a rule this repo does not follow, or an assertion that is simply wrong about what the code does.
3. Fix only what you confirmed. Show the change as a diff. Do not fix a refuted finding, and do not "fix" something the model did not report just because you noticed it — say so instead and leave it.

Then report, in this order: what you fixed (with diffs), what you refuted (with the reason), and anything you could not decide. Run the repo's tests after making any edit, and say plainly if they fail.

If the script reports that the reply could not be parsed into findings, show its verbatim output and stop — do not act on unstructured text.

Handling failures:

- The script exits 1 with a specific message for user-fixable problems (nothing to review, server down, no model loaded, diff too large for the window). Show that message. Do not retry with a different target to make it fit, and do not fall back to reviewing the code yourself unless the user asks.
- If it reports that no provider is reachable, suggest `/oai:setup`.

With `--json`, stdout is machine-readable on **both** paths: a successful run prints the report, and a
failed one prints `{"error": true, "reason": ..., "message": ..., "hint": ...}` and still exits 1 with the
same prose on stderr. `reason` carries the transport's own vocabulary — `deadline-timeout`,
`idle-timeout`, `first-token-timeout`, `oversize`, and so on — or `null` where nothing was determined, so
a caller can tell a wall-clock cap from a server error without matching prose. The one case that stays
prose-only is a malformed command line: parsing is what establishes that `--json` was passed at all.
