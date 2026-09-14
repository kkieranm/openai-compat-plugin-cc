---
name: verify
description: Prove a change to the LM Studio plugin works end to end — structural tests plus a real plugin-load / delegation check.
---

# Verify a change

1. Run the test suite: `npm test` from the repo root. Must be green.
2. If the change touches plugin structure (`.claude-plugin/`, `commands/`, `agents/`, `hooks/`):
   validate the manifest parses (`node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'))"`)
   and TODO once the skeleton exists: load the plugin in a scratch Claude Code session
   (`claude --plugin-dir .`) and confirm the commands appear.
3. If the change touches delegation to LM Studio:
   - Network-free path first: run the relevant script against a mocked/replayed response (TODO: fixture location once scripts exist).
   - Live check (only if LM Studio is running — `curl -sf http://localhost:1234/v1/models` to detect): run the command against the loaded model and read the actual output back; do not declare success from exit code alone.
4. State plainly which of the above ran and which were skipped (and why).
