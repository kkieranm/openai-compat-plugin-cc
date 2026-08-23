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
the file above rather than from a shell variable a caller's text would ever populate directly.

Placed after the `template` case, before `before_files=$#` — so `before_files` still counts only
real attachments regardless of whether `--template`, `--model`, both, or neither contributed
arguments. **The existing comment on `before_files`** ("How many arguments the template
contributed, so the attachment check below still counts FILES... a containment guard disarmed as a
side effect of a fix somewhere else") **gets generalized** from naming `template` alone to naming
both conditional sources, since it now has to survive two of them, not one.

**Amended after this plan's original approval (round 6, digest `867eed106378`), during this item's
review-ladder pass — the original design above shipped, then was rewritten. Recorded here because
the design actually shipped is materially different from what round 6 approved, and this section is
the record of why.** The original sketch (`model=''` / `IFS= read -r` / a bare `if`) went through
three successive shell-only patches across review-ladder pass 1 and pass 2, each closing one byte
class and reopening another:

1. **Pass 1 (Group B, `codex-plain`)**: a stale cross-reference in section 3's prose ("recipe
   below" instead of "recipe above") — fixed in prose only, no code change.
2. **Pass 1 (Group B, `codex-adversarial`)**: `IFS= read -r` strips a trailing `\n` but not a
   trailing `\r`, so a CRLF-saved `model` file leaked a hidden control character. Fixed by adding a
   `case "$model" in *[[:cntrl:]]*)` guard after the read.
3. **Pass 1's own verdict point (Codex dissent, `CHANGES-REQUIRED`)**: `read -r` stops at the FIRST
   newline in the file, so `qwen\nrest-of-line` was silently truncated to `qwen` — which contains no
   control character — *before* finding 2's guard ever saw the discarded remainder. Fixed by
   replacing `IFS= read -r` with `model=$(cat "$dir/model")`, which reads the whole file so an
   embedded control character survives into the guard's view. This mutated the frozen artifact after
   a verdict-point dissent, so pass 1 closed (3 accepted findings total) and pass 2 opened fresh
   against the new version, per the review-ladder skill's rule that any accepted fix requires the
   result to go back through full review.
4. **Pass 2 (Group A, `fork-opener`)**: a NUL byte cannot survive `$(...)` command substitution in
   bash, sh, or dash — those shells store variables as C-strings, so `qwen<NUL>rest-of-line` becomes
   `qwenrest-of-line`, containing no control character the guard could catch. Only zsh preserves a
   NUL. Independently verified directly against all four shells before being accepted. Fixed by
   checking the raw file's byte length against its length with NUL bytes stripped (`tr -d '\000'`)
   *before* the value ever touched a shell variable.
5. **Pass 2 (Group B, `codex-adversarial` and `codex-plain`, both independently)**: two more gaps in
   the same design, found in the same round: (a) `$(cat …)` strips *all* trailing newlines, not
   just one, so a malformed `qwen\n\n` file was silently accepted as `qwen` — contrary to the
   unconditional "refuse a newline" rule in section 1's `model` bullet; (b) the `case … [[:cntrl:]] …` guard
   itself is locale- and shell-dependent — a Unicode C1 control character (U+0085 NEXT LINE, UTF-8
   `c2 85`) was demonstrated to pass `dash` under one locale and fail it under another, on
   byte-identical input. `codex-plain` additionally found unchecked failure modes in the `wc`/`tr`/
   `cat` pipeline from finding 4's fix, and a test-description mismatch (a test named for "a
   CRLF-saved file" that only ever wrote a bare `\r`, never real `\r\n` bytes).

**This is the trigger this repo's own review discipline names explicitly: the same architectural
region — a caller-supplied string validated in shell — produced a new accepted finding on three
consecutive review rounds (pass 1's verdict point, pass 2 Group A, pass 2 Group B), each time from
an independent reviewer, each time a different byte class. Both pass-2 Group B reviewers, working
independently, converged on the same recommendation: validate in Node, not shell, matching the
`canon()` function this same file already uses for path validation.** That recommendation is what
shipped, replacing every shell-level check above with one Node read:

```sh
model=''
if [ -f "$dir/model" ]; then
  model=$(node -e '
    const fs = require("fs");
    let s;
    try { s = fs.readFileSync(process.argv[1], "utf8"); } catch (e) { process.exit(2); }
    if (s.endsWith("\n")) s = s.slice(0, -1);
    if (!s) process.exit(3);
    if (/[\x00-\x1f\x7f-\x9f]/.test(s)) process.exit(1);
    process.stdout.write(s);
  ' -- "$dir/model")
  case "$?" in
    0) ;;
    2) echo "refusing: cannot read $dir/model"; exit 1 ;;
    3) echo "refusing: model file is empty — omit it entirely when no model was named"; exit 1 ;;
    *) echo "refusing: model id contains a control character"; exit 1 ;;
  esac
fi
if [ -n "$model" ]; then set -- "$@" --model "$model"; fi
```

Node's `fs.readFileSync` reads raw bytes with no C-string truncation (closes finding 4 for every
shell, not just three of four), the `[\x00-\x1f\x7f-\x9f]` check runs as a JS regex with no locale
to vary the outcome (closes finding 5b), and exactly one trailing `\n` is stripped as the file's own
terminator — never more than one — before the control-character check runs (closes finding 5a while
deliberately keeping the one exception section 1's `model` bullet already implied: a file's own terminating
newline is not "a newline in the id" any more than the newlines separating entries in `files` are
part of any single path). An empty file (present but empty, the state the `model` bullet above tells
the agent never to write) is refused with its own message rather than silently treated as "no model
requested." An unreadable file is refused with its own message rather than silently treated as no
model requested with no explanation. Every one of these five findings has its own regression test in
`tests/delegate-template.test.js` (see Tests below, amended to match).

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
> recipe above already runs `result "$id"` on a completed job, so you see this if it happens; the
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
  `model=''`/`if [ -f … ]`/`case "$?"` lines, since they're inserted in that same span — confirmed
  by construction, no extraction-window change needed.

**Amended alongside the section 2 rewrite above, to cover each of the five findings that drove it,
one dedicated regression test per finding:**

- A model id carrying a bare CR, and (as its own separate case, per `codex-plain`'s finding that the
  original test's name promised real CRLF bytes it never wrote) a model id saved with actual `\r\n`
  bytes → both refused.
- A model id with a single trailing `\n` → **tolerated**, stripped as the file's own terminator, not
  refused — the one deliberate exception, proven as its own positive case rather than only inferred
  from the negative cases around it.
- A model id with a *second* trailing `\n` (`qwen\n\n`) → refused — the case that would have caught
  finding 5a (`$(cat …)` stripping *all* trailing newlines) had it shipped.
- A model id with an embedded `\n` before more content → refused (finding 3).
- A model id with an embedded NUL byte → refused (finding 4).
- A model id containing a Unicode C1 control character (U+0085 NEXT LINE) → refused — the case that
  would have caught finding 5b (locale-dependent `[[:cntrl:]]`) had it shipped; JS regex has no
  locale to vary the outcome, closing the class rather than one instance of it.
- An empty-but-present `model` file → refused with its own message, not silently treated as no model
  requested (the contract violation the `model` bullet's "do not write an empty file" line names).

## Verification

1. `npm test` — full suite green, including the extended `delegate-template.test.js`.
2. Mutation checks, one per closed finding, each following the same back-up/mutate/confirm-fails/
   restore/confirm-green cycle: (a) narrow the Node validator's control-character regex from
   `[\x00-\x1f\x7f-\x9f]` back to `[\x00-\x1f]`, confirm only the U+0085 test fails; (b) remove the
   `if (!s) process.exit(3)` empty-file check, confirm only the empty-file test fails; (c) remove the
   `if (s.endsWith("\n")) s = s.slice(0, -1)` line, confirm only the single-trailing-newline-tolerated
   test fails (proving the strip is load-bearing, not merely inert). The shell-metacharacter test
   itself — run once, as written, against the real recipe — is the injection proof: there is no
   toggleable guard to disable here (safety comes from the file-based channel never touching shell
   interpolation at all, not from a conditional check on the value), so a mutation cycle would have
   nothing to mutate between "safe" and "unsafe" short of reverting to a shell-interpolated design
   plan-gate round 1 already rejected.
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
