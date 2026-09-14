# Contributing

Thanks for your interest in improving this plugin.

## Getting set up

There is no build step — the plugin is markdown command definitions, JSON manifests, and ESM scripts.

```sh
git clone https://github.com/kkieranm/openai-compat-plugin-cc.git
cd openai-compat-plugin-cc
npm test
```

The test suite is **network-free** (it runs against an in-process fake OpenAI-compatible server on an
ephemeral port) and requires **`zsh`** on your `PATH`. No real model server is needed to run the tests.

## Before opening a pull request

- `npm test` must pass.
- Match the surrounding code's style; there is no separate linter or formatter to run.
- If your change touches the command surface, keep the markdown in `commands/` in step with the flag
  definitions in `scripts/lib/cmd-*.mjs` — `tests/plugin.test.js` checks they agree.
- Prefer turning a recurring class of bug into a structural test in `tests/structure.test.js` rather
  than only fixing the one instance.
- Write a comment only where the *why* is non-obvious; a comment should describe current behaviour,
  not the process that produced it.

See [`CLAUDE.md`](CLAUDE.md) for the architecture overview and the repeat-offender footguns worth
knowing before you start.

## Reporting bugs and requesting features

Open an issue on the repository. For anything security-sensitive, see [`SECURITY.md`](SECURITY.md)
instead of filing a public issue.
