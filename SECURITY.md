# Security Policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

Use GitHub's private vulnerability reporting on this repository — the **Security** tab →
**Report a vulnerability** — which opens a private advisory visible only to the maintainers.

Please include:

- what the issue is and where in the code it lives,
- how to reproduce it, and
- the impact you foresee.

You'll get an acknowledgement as soon as the report is seen. Please give a reasonable window for a
fix before any public disclosure.

## Scope notes

This plugin runs locally and talks only to the model server you configure; it has no backend service
of its own. Two behaviours are known and documented rather than treated as vulnerabilities:

- A credential placed in a provider's URL rather than in an `apiKeyEnv` environment variable is
  stored as given: a credential in the URL **path**, or in an ad-hoc `--base-url` query string, is
  persisted verbatim, and a path-embedded one is also displayed back to the operator on `/oai:status`
  and in interactive error output. It is not written to persisted failure messages or shared worker
  logs. (A query string on a *configured* provider is committed to the jobs database as a hash rather
  than stored.) Prefer `apiKeyEnv`.
- Background jobs persist their request — including attached file contents — in a local SQLite
  database under your state directory (`$XDG_STATE_HOME`, or `~/.local/state` by default), created
  with restrictive file permissions.
