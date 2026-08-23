ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug oai-181-delegate-per-call-model

# OAI-181 — let a caller pick which model a delegated call uses, per call

## Context

Filed 2026-08-17 from a direct user request: "we should be able to specify per call what model to
use." `--model` is already a working per-call flag on `/oai:task` and `/oai:review`
(`commands/task.md:3,18`, `commands/review.md:21`, `scripts/lib/cmd-task.mjs:18`'s `TASK_SPEC`) and
reaches `scripts/lib/model-selection.mjs`'s `planSelection(profile, explicitModel, described)` —
confirmed by reading it: `explicitModel` (line 227-228) is checked first, before any profile default
or auto-selection, via `unservedProblem(explicitModel, described)` — which, **only when the
provider offers a recognized catalogue** (see Probe correction 1 below; otherwise the id is
accepted and sent as given), refuses cleanly with a specific error naming the unserved id. The
CLI-level mechanism this item needs already exists; nothing here touches `model-selection.mjs`.

**The gap is `agents/oai-delegate.md`** — the context-broker agent the advisor-delegation path runs
through. Its own text (lines 184-189) says: *"You do not choose the model: it is the provider
profile's, and on a dense local model prefill alone has been measured here at 191–335s before a
single token is generated. So a large attachment set makes the 540s bound expire and the id-only
path the normal outcome, which is one more reason to keep the set small. Never pass `--model` to
work around it."*

**Probe: what the rule actually guards against.** Read in full context, the rule is about the
*agent* unilaterally swapping models to route around its own problem (a slow response, an expiring
deadline) — not about a caller who has a genuine, independent reason to name a model. Those are
different situations: the first is the agent second-guessing the operator's provider configuration;
the second is the operator's own instruction, exactly the class of thing `planSelection` already
treats as outranking automatic inference (its own comment: *"a named model is the caller's
instruction and outranks our inference"*). The rule's underlying safety property — nothing silently
picks a model to dodge a timeout — is preserved either way; only the source of a *deliberate,
named* choice changes from "never" to "the caller's own instruction, when given." Codex's plan-gate
review confirmed this reinterpretation is sound and needs no additional guard: a caller-named
slower model can only make the *already-handled* "deadline passed while still running" path fire
more often — it is not a new failure mode (terminal states stay `completed`/`failed`/`cancelled`/
`queue-timeout`; a still-running job past its deadline already exits 0 and is reported as running).

**Probe correction 1 (plan-gate round 1, Codex, `CHANGES-REQUIRED`): `unservedProblem`'s validation
is catalogue-dependent, not universal.** Read directly against `scripts/lib/model-selection.mjs`:
`unservedProblem` (line 79) returns `undefined` (no problem — accepted on trust) immediately unless
`refusesUnlisted(described)` is true, which itself (line 38-40) requires the provider to report
*both* a non-empty model list *and* a non-empty `catalogueIds` — i.e. a provider whose dialect this
build recognises well enough to trust an absence as meaningful. Without that, an unrecognised model
id is accepted and sent as-is, and per this same function's own comment, a wrong id can come back
as an HTTP 200 with a normal completion from whatever the server actually has loaded, reporting
that model's id — the same silent substitution `model-identity.mjs` already names and defends
against elsewhere in this codebase (`substitutionNotice`). The original plan's claim ("the companion
validates it against the server's own catalogue and refuses cleanly if the server doesn't serve
it") overstated this as unconditional; corrected below to describe the real, conditional behavior.

**Probe correction 2 (plan-gate round 1, Codex, `CHANGES-REQUIRED`): a caller-supplied model string
must not be shell-interpolated.** The original design set a literal `model=''` default inside the
recipe and had the agent replace it with the caller's model id as shell-quoted text — exactly the
class of hazard this file's own `files` list mechanism exists to avoid for any caller-influenced
string ("hand-quoting that correctly every time is a promise you should not have to keep"). Unlike
`template`, a model id is not a closed set validated by a `case` statement before use; a hostile
value (reached, per this file's own threat model, via a successful prompt injection from repository
content the agent read and then wrote verbatim into the script) could terminate the shell literal
and inject arbitrary shell syntax — the same command-injection shape `canon`'s `--` separator and
the raw `files` file both already exist specifically to close for every other caller-influenced
value in this recipe. Fixed below: the model id travels through a third raw file in `$dir`, exactly
like `files`, never through shell interpolation.

No genuine product fork — the shape (an optional per-call model id, forwarded verbatim to the
existing, already-validated `--model` flag) follows the sibling commands' established convention
directly; grill skipped.

## Fix

### 1. `agents/oai-delegate.md` — a third raw file for the caller's model, never shell-interpolated

**Self-caught during plan-gate round 3 preparation**, the same class of miss round 2 found in the
closing "your only writes are the two files" rule: the bullet's own OPENING sentence, "Then write
two files there with the `Write` tool" (line 66), is equally hardcoded and equally wrong the moment
a third, optional file exists — fix it too, not only the closing rule round 2 already caught.
Reword to "Then write the following files there with the `Write` tool" (dropping the count
entirely, matching the same future-proofing the closing rule's fix already applies), then add a
third, **optional** entry, using the exact same rationale and constraints the `files` bullet
already states for the identical reason — a caller-influenced string never becomes shell text:

> - `model` — **optional**, present only when the person who invoked you named a specific model as
>   part of their own request. One line, raw: the model id exactly as named, no quoting, no
>   escaping. Omit this file entirely when no model was named — do not write an empty file. The same
>   reason `files` is a raw file and not a shell argument applies here: a model id is caller-supplied
>   text, not a value this agent chooses from a closed set the way `--template` is, and hand-quoting
>   it correctly every time is a promise this file already declines to make elsewhere. **Refuse — do
>   not write — a model id containing a newline or a control character**, the same restriction
>   `files` already states.

### 2. The recipe's argument construction

The `set --` block already has one closed-set case (`template`) that conditionally adds arguments
before the file loop. Add a second, independent one right after it, reading the caller's model from
the file above rather than from a shell variable a caller's text would ever populate directly:

```sh
model=''
[ -f "$dir/model" ] && IFS= read -r model < "$dir/model"
if [ -n "$model" ]; then set -- "$@" --model "$model"; fi
```

Placed after the `template` case, before `before_files=$#` — so `before_files` still counts only
real attachments regardless of whether `--template`, `--model`, both, or neither contributed
arguments. **The existing comment on `before_files`** ("How many arguments the template
contributed, so the attachment check below still counts FILES... a containment guard disarmed as a
side effect of a fix somewhere else") **gets generalized** from naming `template` alone to naming
both conditional sources, since it now has to survive two of them, not one.

### 3. `agents/oai-delegate.md` — the rule itself

Replace the paragraph at lines 184-189 with:

> If the deadline passes while the job is still running, that is **not** a failure — the script
> exits 0 and prints the id, and you report it as still running. **Expect this on a slow model.**
> **You do not choose the model on your own** — it is the provider profile's, and on a dense local
> model prefill alone has been measured here at 191–335s before a single token is generated. So a
> large attachment set makes the 540s bound expire and the id-only path the *normal* outcome, which
> is one more reason to keep the set small. **Never pick a different model yourself to route around
> that** — a slow response or an expiring deadline is never a reason to swap models on your own
> initiative, and naming one does not change what "still running past the deadline" means: it is
> already a normal, non-failure outcome you report the same way regardless of which model answered.
> If the person who invoked you named a specific model as part of their own request, write it to the
> `model` file above and it is passed through as `--model <id>`. The companion validates it only
> when the server's own dialect is well-understood enough to trust an absence as meaningful — where
> it can, an unserved id is refused cleanly before anything is sent; where it can't, an unrecognised
> id is sent as given, and a server that does not have it may silently answer with whatever else is
> loaded instead (the same substitution `/oai:result`'s footer already reports when it happens — the
> recipe below already runs `result "$id"` on a completed job, so you see this if it happens; the
> existing "Never paste the model's full reply" rule is what keeps it out of what you relay, not
> whether you saw it). You do not need to check availability yourself either way — only pass through
> what you were actually told.

### 4. The final rule — "your only writes are the two files" is now wrong

**Found in plan-gate round 2 (Codex, `CHANGES-REQUIRED`)**: the recipe's own last bullet ("Never
edit, create or delete anything inside the working tree. Your only writes are the two files in the
temporary directory above.") directly contradicts the new, optional third file the moment it can
exist — round 1's own "No change needed" claim for this section was wrong, caught only because
round 2 read the literal sentence rather than trusting the earlier round's scope call. Fix: change
"the two files" to "the files described above" — future-proof against however many optional files
this section ends up describing, rather than hardcoding a count that a later change could just as
easily invalidate again.

Everything else about Response style stands: the model actually used is already visible via
`/oai:result`'s footer (`model: <id>`, including any substitution notice) — **not** `/oai:status`,
whose renderer only shows the requested/selected job model and never calls `substitutionNotice`
(**corrected in plan-gate round 4, Codex, `CHANGES-REQUIRED`**: confirmed by reading
`scripts/lib/cmd-status.mjs`/`job-render.mjs` directly — `substitutionNotice` is imported and called
only in `scripts/lib/cmd-result.mjs`). The agent does not currently echo `/oai:result`'s footer and
does not need to for this change.

## Files touched

- `agents/oai-delegate.md` — the four edits above (the `model` file bullet including its opening
  sentence, recipe argument construction, the rule prose, and the closing "only writes" rule).
- `tests/delegate-template.test.js` — extended per Tests below (explicitly listed here per
  plan-gate round 1's note that a plan changing this file must say so in Files touched, not only in
  the Tests section).

No script changes — `--model` and its validation already exist and are unmodified.

## Tests

`tests/delegate-template.test.js`'s `argv()` harness already drives the recipe's `set --` block
under every shell present, in the same style `--template` is tested. `argv()` gets a new optional
`model` parameter: when given, it writes `$dir/model` (the same real, already-mktemp'd directory
`files` is already written into) before running — never a shell-interpolated variable, matching the
production design's own file-based mechanism exactly, so this suite drives the real code path
rather than a stand-in for it. Extend the cases:

- A caller-named model, no template → `--model <id>` appears in argv before the file arguments,
  exactly one occurrence, and `before_files` still gates on file count alone (an empty attachment
  list with only a `model` file present is still refused, same as the existing template-alone case).
- A caller-named model together with a template → both `--template <name>` and `--model <id>`
  appear, in that order (template first, matching the recipe's own top-to-bottom argument order),
  ahead of the files.
- No `model` file written (the default, matching every existing test in this file) → `--model`
  never appears in argv, and argc is unaffected — behavior-preserving for every existing call site.
- A model id containing shell metacharacters (a single quote, a semicolon) → passed through
  unmangled to argv as one literal argument, proving the file-based channel is genuinely immune to
  the interpolation hazard plan-gate round 1 found in the original shell-variable design — this is
  the test that would have caught that defect had it shipped.
- `recipeBlock()`'s extraction window (`set --` through `id=$(node `) already contains the new
  `model=''`/read/`if` lines, since they're inserted in that same span — confirmed by construction,
  no extraction-window change needed.

## Verification

1. `npm test` — full suite green, including the extended `delegate-template.test.js`.
2. Mutation check: temporarily change the recipe's `[ -f "$dir/model" ] && IFS= read -r model <
   "$dir/model"` to unconditionally set a non-empty literal (matching the existing "the recipe ships
   with NO template selected by default" test's own pattern for `template`), confirm the "no model
   file written" test fails, restore, confirm green. The shell-metacharacter test itself — run once,
   as written, against the real recipe — is the injection proof: there is no toggleable guard to
   disable here (safety comes from the file-based channel never touching shell interpolation at
   all, not from a conditional check on the value), so a mutation cycle would have nothing to mutate
   between "safe" and "unsafe" short of reverting to the shell-variable design plan-gate round 1
   already rejected.
3. Manual end-to-end, if a real provider is reachable during verification: invoke the delegate agent
   with an explicit model name matching one the provider serves, confirm the resulting job's
   `/oai:status` shows that model; then, **only if that provider is one whose dialect this build
   recognizes with a catalogue** (`refusesUnlisted` true — LM Studio's `/api/v0/models` reporting
   qualifies, confirmed during the original probe), retry with a model name the provider does not
   serve and confirm the submission is refused with the companion's own unserved-model error, not a
   crash. Against a provider without a recognized catalogue, the equivalent case is: the submission
   proceeds, and `/oai:result <id>`'s footer (never `/oai:status`, per the correction above) may show
   a different model than named — the documented, pre-existing substitution behavior, not a new
   failure mode this item introduces or needs to guard against.

## Step 9 residue

- Close OAI-181.
- No further residue expected — the underlying `--model` validation machinery this item relies on
  was already built and tested for `/oai:task`/`/oai:review`; this item only extends the one
  caller (the delegate agent) that didn't yet expose it.
