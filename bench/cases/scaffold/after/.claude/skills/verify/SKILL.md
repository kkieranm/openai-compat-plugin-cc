---
name: verify
description: Prove a change to the openai-compat plugin works end to end — tests, a real plugin load, and a delegation round trip.
---

# Verify a change

Run these in order and quote the observed output. Say which steps ran and which were skipped.

## 1. Tests

```sh
cd /Users/kieran/Code/openai-compat-plugin-cc && npm test
```

Must be green. The suite is network-free: it spins up a fake OpenAI-compatible server on an
ephemeral port. `runCompanion` in `tests/helpers.mjs` is async on purpose — a synchronous spawn
deadlocks against that in-process server.

## 2. Plugin surface

Structural guards (`tests/plugin.test.js`) already check that the manifests parse, that every command
declares `allowed-tools: Bash(node:*)`, and that referenced scripts exist. Then load it for real:

```sh
claude --plugin-dir /Users/kieran/Code/openai-compat-plugin-cc -p "/oai:setup"
```

Expect a provider table. With no server running, every provider shows "connection refused" plus its
remediation line — that is a pass for this step, since it proves the command loaded and the
companion ran.

## 3. Delegation round trip

If no real model server is running, use a stub to exercise the whole chain: a small `node:http`
server on :1234 answering `/v1/models` and `/v1/chat/completions`.

```sh
node <scratchpad>/stub-server.mjs &
claude --plugin-dir /Users/kieran/Code/openai-compat-plugin-cc \
  -p "/oai:task --file scripts/lib/errors.mjs what does this file define?"
```

Expect the answer, then a footer naming provider, model, duration and token counts. Read the answer
back — do not judge success from an exit code. Kill the stub afterwards (`pkill -f stub-server.mjs`).

**A stub pass is not a live pass.** It proves command → script → HTTP → render, not that a real
server speaks the dialect we assume.

## 4. Live check (the real thing)

Only possible once a server is installed and a model loaded. Detect one:

```sh
curl -sf http://localhost:1234/v1/models    # LM Studio; oMLX :8000, Unsloth Studio :8888
```

Then rerun step 3 without the stub and against the real provider, and quote the model's actual
answer. If no server is installed, say so plainly and mark the live step pending rather than
reporting the feature as verified.
