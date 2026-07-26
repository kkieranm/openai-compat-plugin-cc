---
description: Check which OpenAI-compatible model servers (LM Studio, oMLX, Unsloth Studio, ...) are reachable and what models they have loaded
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" setup "$ARGUMENTS"`

Present the report above to the user.

- Show it as-is. Do not re-run the command, and do not probe the servers yourself with curl.
- If a provider is unreachable, repeat its remediation line rather than inventing your own.
- If no provider is reachable, tell the user to start one of the servers, and point at the config path in the report for correcting a port or adding a provider.
- Do not offer to install any server; the user manages those.
