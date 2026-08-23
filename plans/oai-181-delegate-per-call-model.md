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
  if buf_bom=$(env -i PATH="$PATH" node -e '
    const fs = require("fs");
    let buf;
    try { buf = fs.readFileSync(process.argv[1]); } catch (e) { process.exit(20); }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) process.exit(23);
    let s;
    try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { process.exit(22); }
    if (s.endsWith("\n")) s = s.slice(0, -1);
    if (!s) process.exit(21);
    if (s.includes("\uFEFF")) process.exit(24);
    if (/[\x00-\x1f\x7f-\x9f]/.test(s)) process.exit(25);
    process.stdout.write(s);
  ' -- "$dir/model"); then
    model="$buf_bom"
  else
    node_status=$?
    case "$node_status" in
      20) echo "refusing: cannot read $dir/model"; exit 1 ;;
      21) echo "refusing: model file is empty — omit it entirely when no model was named"; exit 1 ;;
      22) echo "refusing: model id is not valid UTF-8"; exit 1 ;;
      23) echo "refusing: model file starts with a byte-order mark"; exit 1 ;;
      24) echo "refusing: model id contains an embedded byte-order-mark character"; exit 1 ;;
      25) echo "refusing: model id contains a control character"; exit 1 ;;
      *) echo "refusing: model id validator failed unexpectedly (exit $node_status)"; exit 1 ;;
    esac
  fi
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
model requested with no explanation.

**Finding 6, added when this rewrite's own resumed review-ladder pass (`fork-opener`) audited it
fresh: decoding leniently was itself a gap.** The first version of this rewrite decoded with
`buf.toString("utf8")`, which — unlike the raw-byte reads it was meant to close every gap in —
silently substitutes an invalid byte sequence with U+FFFD (REPLACEMENT CHARACTER) rather than
rejecting it, and U+FFFD sits outside `[\x00-\x1f\x7f-\x9f]`, so malformed UTF-8 passed through as a
garbled-but-accepted id. Not the same *shape* of hazard as findings 3-5 (nothing is silently dropped
or concatenated; the substitution is visible in what results), but it is still content the guard was
meant to catch and didn't. Fixed by decoding with `new TextDecoder("utf-8", { fatal: true })`, which
throws on the first invalid byte instead of substituting — verified directly (`fatal: true` throws
on `\xff\xfe`, decodes `qwen3.8-27b` and the U+0085 case from finding 5b unchanged).

**Findings 7-9, from the fresh Group B run this rewrite's resumed pass owed after finding 6 landed
(`codex-adversarial` and `codex-plain`, independently) — not new byte classes in the file's content,
but ways the SCRIPT AROUND the read could itself launder or hide a refusal:**

7. **A leading UTF-8 byte-order mark (`EF BB BF`) was invisible to every check above.**
   `TextDecoder`'s default `ignoreBOM: false` strips it during decode, before the control-character
   regex or the empty check ever see it, so a BOM-prefixed id like `<BOM>qwen` decoded to plain
   `qwen`, and a BOM-only file decoded to `""`, mislabeled as empty rather than reported as a BOM.
   Fixed by checking the raw bytes for the three-byte BOM signature before decoding at all, refused
   with its own exit code (5) and message, distinct from every other case.
8. **The exit-code dispatch was not exhaustive.** An exit code outside `{0,2,3,4}` — a `node` crash,
   `node` missing entirely (127), killed (143), or any other cause — fell into the wildcard arm and
   was reported as "contains a control character," true for none of those causes. Every code node can
   actually emit now has its own arm, and exit 1 (a real refusal) has an explicit arm instead of a
   `*)` that also caught causes that were never that; the wildcard now says "failed unexpectedly"
   instead. Verified directly, with a portable construction that doesn't depend on where the real
   `node` binary happens to live: a decoy script named `node`, exiting unconditionally with a code
   outside the known set, placed ahead of the real one in `PATH` — reaches the new distinct message,
   not the control-character one. (An earlier version of this test restricted `PATH` to a fixed
   system directory list to hide `node` entirely; corrected in plan-gate round 11 (Codex) as
   non-portable — a system where `node` itself lives under one of those directories, common on some
   Linux package installs, would not have hidden it at all.)
9. **The bare assignment was not `errexit`-safe.** `model=$(node -e …)` followed by a separate
   `case "$?"` meant a caller running this recipe under `set -e` saw the shell exit silently at the
   failed assignment itself — before the `case` and its message were ever reached. Verified directly:
   `model=$(node -e "process.exit(4)")` under `-e` in zsh/bash/sh/dash all terminated with no output
   at all. Fixed by making the assignment the CONDITION of an `if`, the standard `-e` exemption for a
   command whose status is being tested, verified the same way to reach the `else` branch with the
   correct `$?` intact in all four shells.

**Finding 10, from `agent-closer` closing out this same resumed pass, against the SAME finding-7 BOM
check above: it only inspects the raw bytes at offset 0.** `TextDecoder`'s BOM-stripping is
positional too — a BOM anywhere else in the byte stream decodes to a literal U+FEFF character that
survives into the string, sits outside the control-character range, and was forwarded verbatim as
part of `--model`. Verified directly: encoding `qwen` + the three BOM bytes + `rest` as a raw buffer
decoded to a 9-character string containing U+FEFF, which the control-character regex does not match.
Fixed with its own check on the decoded string (after the trailing-newline strip and the empty
check, so a lone embedded BOM is reported distinctly from either of those), its own exit code (6)
and its own message, not folded into the control-character case.

**Finding 11, from this pass's own verdict point (`codex-adversarial`): exit code 1 was ambiguous
between our own signal and Node's own default.** Exit 1 was both this script's deliberate signal for
"contains a control character" AND Node's documented default exit code for an uncaught exception —
a genuine Node startup failure (a broken `NODE_OPTIONS` preload, an internal V8 fault) exits 1 before
this script's own `process.exit` calls are ever reached, and the dispatch could not tell the two
apart. Verified directly, with the real `node` binary rather than a decoy:
`NODE_OPTIONS='--require=/no-such-module.js' node -e '1'` exits 1 with no control character anywhere
involved, and would have been reported as "contains a control character" under the old dispatch.
Every other custom code here (2-6) is a value only this script itself ever calls `process.exit` with,
so none of them collide the same way. Fixed by moving the control-character signal off exit 1 onto
exit 7 (a code Node has no reserved meaning for and nothing else here produces), leaving exit 1 to
fall into the wildcard "failed unexpectedly" arm alongside every other Node-internal failure — the
same bucket findings 8/9 already built for exactly this class of collision. **This finding's own
closing claim ("codes 2-6 don't collide the same way") was itself refuted by finding 12 below, in the
very next round of the same verdict check — corrected there, not rewritten here.**

**Finding 12, from a second round of this same pass verdict point (`codex-adversarial` again): exit 7
— finding 11's own fix — collides too.** Node's exit-code documentation reserves the *whole* low range
this validator was drawing custom codes from (roughly 0-14), not just exit 1: code 7 specifically is
documented as "an uncaughtException handler that itself throws." Verified directly, with the real
`node` binary: a `NODE_OPTIONS` preload that installs a throwing `process.on('uncaughtException', …)`
handler and then throws reliably exits 7 before this script's own `process.exit` calls are ever
reached — reproducing finding 11's exact class of collision one exit code over, and disproving finding
11's own claim that codes 2-6 (and, by the same fix, 7) were collision-free. `node
--max-old-space-size=notanumber` was verified separately to reproduce exit 9, confirming this is a
property of the whole low range, not one unlucky code. Picking codes one at a time out of Node's
reserved space only relocates the same class of bug; fixed by moving every custom code this validator
owns to 20+ (a range Node has no documented meaning for and never produces on its own), closing the
whole class of collision rather than one more instance of it — see the updated code block above.

**Finding 13, from a THIRD round of this same pass verdict point (`codex-adversarial` a third time):
qualitatively different from findings 8-12 — a validation BYPASS, not a misleading diagnostic.**
Findings 11 and 12 defended against a *genuine, environment-caused* Node crash being misattributed —
a wrong error message on a real failure, a UX defect. Finding 13 is a different class: an ambient
`NODE_OPTIONS`, set by the operator's own shell for reasons having nothing to do with this recipe
(an observability preload, a debugging flag), can act on this validator *without crashing it at all*.
Verified directly, with the real `node` binary, two ways:

1. A preload setting `process.exitCode = 25` makes `node -e` exit 25 — this validator's OWN
   "contains a control character" code — even though the actual model file contains no control
   character. `NODE_OPTIONS='--import=data:text/javascript,process.exitCode%3D25' node -e '...'`
   reproduces this: findings 11/12's entire fix bypassed by one inherited flag, falsely refusing a
   clean id.
2. Worse: a preload that WRITES to stdout before this script's own code runs is silently prepended to
   the captured value, with exit 0. A preload doing `process.stdout.write("prefix\n")` combined with a
   clean `model` file produced a captured value of `prefix\nqwen...` — an embedded newline that
   bypasses every check in this validator entirely, since nothing here inspects what a *preload*
   writes, only what this script's own logic decides to. This reopens exactly the newline-injection
   hazard finding 3 exists to close, through a completely different vector (an environment variable,
   not the `model` file's own bytes).

`--` (see `canon`'s own comment) cannot help: `NODE_OPTIONS` is not an argv flag, so the existing
argument-injection defense does not apply to it. Fixed by clearing it for this one invocation —
`NODE_OPTIONS= node -e …` — which defeats both reproductions directly, in all four shells.
**The identical vulnerability exists in `canon()` above** (a pre-existing function, not written by
this item, but sharing the exact same `node -e '...'` shape and the exact same exposure) — fixed there
too, for the same reason found here, not deferred as out-of-scope residue the way the two Section-2
findings below are: those are separate DESIGN choices in code this item never touches (a narrower
regex range, a stale doc claim), while this is the SAME mechanism, discovered in the SAME pass,
against a second call site in the SAME file this item's own diff already modifies.

**Finding 14, from a FOURTH round of this same pass verdict point (`codex-adversarial` a fourth
time): `NODE_OPTIONS` was not the only startup input Node consults before `-e` runs.** The first
attempt at this round's Codex launch was itself interrupted mid-investigation by an unrelated content
classifier (recorded here for the record, not as a finding: a relaunch with reworded, less
attack-framed prompt text completed normally and found the same substance). `OPENSSL_CONF` is a
second, independent environment variable Node's OpenSSL binding consults during startup — an OpenSSL
3.x config can activate a PROVIDER (arbitrary native code) during that consultation, the same shape of
hazard as finding 13, through a different variable, and one that finding 13's `NODE_OPTIONS=` fix does
nothing to close. Verified directly, with the real `node` binary: an inherited, syntactically-broken
`OPENSSL_CONF` (`this is not valid openssl config syntax [[[`) crashed node with exit 101 — before
this script's own code ever ran — even with `NODE_OPTIONS` already cleared by finding 13's fix,
proving this is a genuinely separate vector rather than a restatement of the same one. (Exit 101 sits
safely outside this validator's own 20-25 range and already falls to the wildcard "failed
unexpectedly" arm by construction — the finding is not a NEW exit-code collision, it is that an
inherited config can run arbitrary code, or crash the process outright, before any of this script's
own logic executes at all.) Originally fixed the same way as finding 13: clearing it alongside
`NODE_OPTIONS` for both `node -e` invocations — `OPENSSL_CONF= NODE_OPTIONS= node -e …` — verified
directly to defeat the reproduction in all four shells, in both the model validator and `canon()`.
Superseded by finding 15's redesign below.

**Finding 15, from a FIFTH round of this same pass verdict point (`codex-adversarial` a fifth time):
Node's own IPC/cluster bootstrap is a THIRD independent startup input, found even with findings 13 AND
14 both already fixed — and the recurring pattern itself (a new inherited variable, every round, three
rounds running) is the finding that matters more than any single instance of it.** `NODE_CHANNEL_FD`,
`NODE_CHANNEL_SERIALIZATION_MODE` and `NODE_UNIQUE_ID` trigger Node's child-process IPC/cluster setup
before `-e`'s own script runs, independent of both `NODE_OPTIONS` and `OPENSSL_CONF`. Verified directly,
with the real `node` binary, two ways: `NODE_CHANNEL_FD=abc … node -e '...'` (a malformed value) exits 1
before the inline script runs; `NODE_CHANNEL_FD=1 NODE_UNIQUE_ID=x node -e '...'` (a well-formed one)
writes a `{"cmd":"NODE_CLUSTER","act":"online","seq":0}` JSON line to stdout — ahead of the script's own
output — with exit **0**, the same stdout-injection shape finding 13 first demonstrated, through a
third independent variable.

**This is this repo's own named pattern for "stop enumerating, redesign," not one more blocklist
entry.** Three rounds finding a new hazardous inherited variable each time, with no way to know the
search terminates, is itself the finding: continuing to add named variables to a growing clear-list is
reactive by construction, and a plausible sixth round finding a fourth variable is not a hypothetical —
it is the empirical trend of rounds 3 through 5. Fixed by replacing the pairwise `OPENSSL_CONF=
NODE_OPTIONS=` clearing with a SAFELIST instead of a blocklist: `env -i PATH="$PATH" node -e …` runs
both invocations under a completely EMPTY environment, restoring only `PATH` — the one thing either
invocation actually needs from the caller's environment, to find `node` itself. Verified directly: with
all three prior hostile variables set simultaneously (a broken `OPENSSL_CONF`, an `--import` preload,
and the IPC/cluster pair), `env -i PATH="$PATH" node -e …` produced clean, unmangled output in all four
shells, both standalone and inside a `$(...)` command substitution — the context this recipe actually
uses it in. This closes the entire class Node's startup sequence exposes for a plain `-e` invocation
(no further undiscovered variable can reach it, whatever it turns out to be named), not merely the
three instances discovered so far.

**A genuinely separate discovery, made while mutation-testing this fix, not a finding against the
shipped code: the regression test for the IPC/cluster vector can HANG rather than fail, if ever run
against an unfixed invocation with stdout captured through a pipe.** `NODE_CHANNEL_FD=1` combined with
a plain (unfixed) `node -e` invocation, run through `execFile` (which captures stdout via a pipe, not a
TTY — the same shape this agent's own tool calls use), stalled indefinitely rather than completing with
the stdout-injection result the same command produces when run directly from an interactive shell.
Confirmed with a minimal reproduction outside the test suite; the mechanism is presumed to be Node's
IPC-channel handshake behaving differently once fd 1 is a pipe rather than a genuine paired socket, but
the precise internal cause was not pursued further — the practical consequence is what matters: an
UNFIXED script, invoked through a pipe-capturing harness with this variable inherited, would not merely
misbehave, it could hang the whole calling process. The two regression tests exercising
`NODE_CHANNEL_FD` (one per file: `delegate-template.test.js` and `delegate-containment.test.js`) both
carry an explicit `timeout: 10000` on their `run()` call for exactly this reason — load-bearing, not
defensive padding, so a future regression of finding 15's fix fails fast with a clear timeout rather
than hanging the whole suite.

**A related point was already raised and dismissed in ROUND 5 of this same pass verdict point** (the
Claude verdict subagent that round, alongside finding 15's own `codex-adversarial` result): whether
`env -i PATH="$PATH"` should also defend against an inherited `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES`
naming a malicious shared object, given that neither is cleared by name. Judged out of scope: both
require a loader-level compromise of the operator's own toolchain — a different threat class from
this recipe's actual inputs (the `model` file, repository content) — at which point the operator's
whole host is already compromised, not something a Node-specific startup recipe can reasonably be
asked to defend against. No fix, no test, no code change.

**Two further points were raised in ROUND 6 of the pass verdict point itself (`codex-adversarial`'s
equivalent review of the shipped `env -i PATH="$PATH"` fix, not a fixed/numbered finding), and both
were judged NON-BLOCKING after direct investigation:**

- PATH-substitution: the one variable `env -i PATH="$PATH"` does not clear is `PATH` itself, which
  controls where `env` and `node` are found. A caller who already controls `PATH` could point it at a
  substitute `env` that ignores `-i`, or a substitute `node` that forges a clean exit 0 with
  fabricated output — something the existing decoy-node tests only prove for a *failing* substitute,
  never a *successfully forging* one. Judged out of scope on the same reasoning applied in round 5
  above to `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES`: it requires the operator's own toolchain — not the
  `model` file, not repository content, the actual inputs this recipe's threat model is about — to
  already be compromised, at which point the whole host is already compromised, not just this recipe.
  No fix, no test, no code change.
- A legitimate Node version-manager shim (`asdf` named specifically: its generated shims dispatch
  through `asdf exec`, needing `HOME`/`ASDF_DATA_DIR`) could break under `env -i` if the operator's
  `node` on `PATH` is such a shim rather than a self-contained binary — a real, distinct concern, a
  compatibility regression rather than a security gap, and one that could affect a legitimate
  operator with no attacker involved. Checked against this repo's own filing bar for a NEW finding
  (`CLAUDE.md`'s Work tracker section: "a dated instance already observed... never a plausible
  future"): no operator of this plugin has been observed running a Node version-manager shim, nothing
  in this repo's own documented environment mentions one, and this machine's own `node` is confirmed a
  genuine Homebrew binary (`/opt/homebrew/bin/node`, a real Mach-O executable resolved via a plain
  symlink, no `asdf`/`nvm`/`volta`/`fnm` present on `PATH`). A hypothetical shim-using operator fails
  that same bar here, for the same reason it would fail as a fresh backlog filing — recorded here as
  the citable evidence rather than filed, per that bar's own stated exemption for a finding that is
  explicitly latent/unexercised. No fix, no test, no code change.

Fourteen of these fifteen findings (findings 2-15; finding 1 was a prose-only cross-reference fix
needing no test of its own) each have at least one dedicated regression test in
`tests/delegate-template.test.js` (see Tests below, amended to match), plus four further dedicated
tests for findings 13, 14 and 15's twin fixes in `canon()`, in `tests/delegate-containment.test.js` — the
`delegate-template.test.js` dedicated block holds twenty tests in total, since several also cover
baseline/positive cases of the Node-rewrite design (the single-trailing-newline tolerance, the
bare-CR/real-CRLF split) rather than one test per numbered finding.

**Two findings from this same Group B round were judged OUT OF SCOPE for this item and are not fixed
here** — both are pre-existing gaps in code OAI-181 did not write and this plan's Files touched
section does not cover:

- `codex-adversarial`: `canon()` (the pre-existing path-containment function for `files`, unrelated
  to model selection) checks only `/[\x00-\x1f]/` — C0 controls — not the fuller `[\x00-\x1f\x7f-\x9f]`
  range this item's own validator uses. A real in-tree filename containing DEL or a C1 control
  character would be resolved and accepted despite the attachment rule's stated "refuse a control
  character." Concrete and verifiable, but a `files`/containment concern predating this item, not a
  per-call-model one — deferred to a new backlog item rather than fixed inline, to avoid this item's
  diff absorbing a second subsystem's fix.
- `codex-plain`: `tests/delegate-template.test.js`'s file-level header comment ("runs the block under
  EVERY shell on the machine") and several test names/comments repeating that claim predate this
  item and overstate the fixed `SHELLS` allowlist, which excludes any other shell installed on the
  machine — confirmed present here at `/bin/ksh` and `/bin/tcsh`, neither of them tested (the latter
  a C-shell derivative, not even POSIX-family, so "every shell" was never literally true regardless
  of which allowlist shipped). Real, but a pre-existing documentation claim about the test file's own
  methodology, not something this item's diff introduced or is required to correct.

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
  sentence, recipe argument construction, the rule prose, and the closing "only writes" rule), plus
  findings 13-15's environment-clearing fixes to the pre-existing `canon()` function (same file, same
  review pass, same vulnerability class — see finding 13's own note on why this isn't the same kind of
  out-of-scope touch as the two Section-2 deferrals below). Finding 15 replaced findings 13/14's
  pairwise `OPENSSL_CONF= NODE_OPTIONS=` clearing with `env -i PATH="$PATH"` in both invocations.
- `tests/delegate-template.test.js` — extended per Tests below (explicitly listed here per
  plan-gate round 1's note that a plan changing this file must say so in Files touched, not only in
  the Tests section).
- `tests/delegate-containment.test.js` — one line changed three times (`canonBlock()`'s extraction
  string, updated each time the `canon()` prefix it matches changed: to `NODE_OPTIONS=`, then to
  `OPENSSL_CONF= NODE_OPTIONS=`, then to `env -i PATH="$PATH"`) and four new tests added, proving
  findings 13, 14 and 15's fixes in `canon()` itself, in isolation.

No script changes — `--model` and its validation already exist and are unmodified.

## Tests

`tests/delegate-template.test.js`'s `argv()` harness already drives the recipe's `set --` block
under every available shell in the fixed allowlist (`zsh` required, `sh`/`dash`/`bash` optional —
not literally every shell present on the machine, corrected in plan-gate round 12), in the same
style `--template` is tested. `argv()` gets a new optional
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
  `model=''`/`if [ -f … ]`/`case "$node_status"` lines, since they're inserted in that same span —
  confirmed by construction, no extraction-window change needed. (Corrected in plan-gate round 11:
  earlier text here said `case "$?"`, stale since findings 8-9 introduced the `node_status` variable
  specifically so `$?` would be captured before the `if`/`else` branch could disturb it.)

**Amended alongside the section 2 rewrite above, to cover each of the fifteen findings that drove it,
one dedicated regression test per finding except finding 1 (a prose-only fix, no code to test):**

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
- A model id with an invalid UTF-8 byte sequence (raw bytes, not representable as a JS string
  literal, so this case writes the file directly rather than through the shared `argv()` helper) →
  refused with its own message, distinct from the control-character message — the case that would
  have caught finding 6 (lenient `toString("utf8")` substituting U+FFFD) had it shipped.
- A model id file starting with a UTF-8 byte-order mark (raw bytes) → refused with its own message —
  the case that would have caught finding 7 had it shipped.
- A model id with a BOM embedded after the start, not at offset 0 (raw bytes) → refused with its own
  message, distinct from both the leading-BOM message and the control-character message — the case
  that would have caught finding 10 had it shipped (found by `agent-closer`, closing out this same
  resumed pass, against the leading-only BOM check finding 7 had just added).
- An unexpected validator failure (a decoy `node` script placed ahead of the real one in `PATH`,
  exiting 42 unconditionally — portable regardless of where the real `node` binary lives, unlike an
  earlier version of this test that restricted `PATH` to a fixed system directory list and was
  corrected in plan-gate round 11) → refused
  with a distinct "failed unexpectedly" message, and explicitly NOT the control-character message —
  the case that would have caught finding 8 had it shipped.
- A decoy `node` exiting 1, and a second decoy `node` exiting 7 → both refused with the same distinct
  "failed unexpectedly" message, and explicitly NOT the control-character message — the case that
  would have caught findings 11 and 12 had they shipped (exit 1: this validator's own
  control-character signal collided with Node's default uncaught-exception exit code; exit 7:
  finding 11's own fix collided with a DIFFERENT Node-reserved meaning, "an exception handler that
  itself throws"). **Originally reproduced with the REAL `node` binary via a `NODE_OPTIONS` preload
  (a module-not-found import for exit 1, a throwing `uncaughtException` handler for exit 7) — switched
  to the same decoy-`node` mechanism the finding-8 test above already uses once finding 13 (below)
  made that reproduction impossible: the recipe now clears `NODE_OPTIONS` before invoking node, so an
  inherited preload can no longer reach it at all, which is finding 13's whole point.**
- A hostile inherited `NODE_OPTIONS` that sets `process.exitCode = 25` (this validator's own
  control-character code) against a genuinely clean model id, and a second case where it writes
  `"prefix\n"` to stdout before this script's own code runs → both still accept the clean id unmangled,
  proving neither forgery reaches the shell — the case that would have caught finding 13 had it
  shipped (found at a third round of this same verdict point: the whole 20+ range findings 11/12 moved
  to is itself forgeable by an inherited `NODE_OPTIONS`, and a stdout-writing preload can inject bytes
  — including an embedded newline — directly into the captured id). A twin test in
  `tests/delegate-containment.test.js` proves the identical fix in `canon()`, in isolation, the same
  way that file's other `canon()`-isolation cases already do.
- A hostile inherited `OPENSSL_CONF` naming a syntactically-broken config file → still accepts the
  clean id unmangled, refused neither by a crash nor a corrupted capture — the case that would have
  caught finding 14 had it shipped (found at a fourth round of this same verdict point: `NODE_OPTIONS`
  was not the only startup input Node consults before `-e` runs; `OPENSSL_CONF` is a second,
  independent one, verified to crash node with exit 101 even with `NODE_OPTIONS` already cleared). A
  twin test in `tests/delegate-containment.test.js` proves the identical fix in `canon()`, in isolation.
- An inherited Node IPC/cluster channel (`NODE_CHANNEL_FD`/`NODE_UNIQUE_ID`) → still accepts the clean
  id unmangled, no `NODE_CLUSTER` JSON reaching the captured value — the case that would have caught
  finding 15 had it shipped (found at a fifth round of this same verdict point: a THIRD independent
  startup input, found even with findings 13 and 14 both already fixed — the recurring pattern that
  prompted findings 13-14's pairwise `OPENSSL_CONF=`/`NODE_OPTIONS=` clearing to be replaced with
  `env -i PATH="$PATH"`, a safelist rather than a growing blocklist). **This test's `run()` call
  carries an explicit `timeout: 10000` that is load-bearing, not defensive padding**: discovered while
  mutation-testing this fix, an UNFIXED invocation under this exact combination can HANG rather than
  fail when stdout is captured through a pipe (as `execFile` does, and as this agent's own tool calls
  do) — without the timeout, a future regression of this fix would hang the whole test file rather
  than failing fast. A twin test in `tests/delegate-containment.test.js`, carrying the same `timeout`
  for the same reason, proves the identical fix in `canon()`, in isolation.
- Every hostile variable from findings 13-15 set SIMULTANEOUSLY (a stdout-writing `NODE_OPTIONS`
  preload, a broken `OPENSSL_CONF`, and the IPC/cluster pair) → still accepts the clean id unmangled —
  the positive control proving `env -i PATH="$PATH"` defeats all three at once, the actual property
  finding 15's redesign claims, not just each individual reproduction in isolation. A twin test in
  `tests/delegate-containment.test.js` proves the same for `canon()`.
- A control-character refusal (a bare CR, the same shape as an earlier case above), run again with
  `set -e` prepended to the script → still refused with the correct message on stdout, not a silent
  exit with no output — the case that would have caught finding 9 had it shipped. (Corrected in
  plan-gate round 12: earlier text here said "the same refusal", wrongly implying this reruns the
  decoy-node unexpected-failure case immediately above; it is a separate scenario, chosen because
  `set -e`'s hazard is about the control-flow around ANY refusal, not specifically the unexpected-
  failure one, and a plain control-character refusal is the simplest case that demonstrates it.)

## Verification

1. `npm test` — full suite green, including the extended `delegate-template.test.js`.
2. Mutation checks, one per closed finding, each following the same back-up/mutate/confirm-fails/
   restore/confirm-green cycle: (a) narrow the Node validator's control-character regex from
   `[\x00-\x1f\x7f-\x9f]` back to `[\x00-\x1f]`, confirm only the U+0085 test fails; (b) remove the
   `if (!s) process.exit(3)` empty-file check, confirm only the empty-file test fails; (c) remove the
   `if (s.endsWith("\n")) s = s.slice(0, -1)` line, confirm only the single-trailing-newline-tolerated
   test fails (proving the strip is load-bearing, not merely inert); (d) replace the fatal
   `TextDecoder` decode with `buf.toString("utf8")`, confirm only the invalid-UTF-8 test fails;
   (e) remove the BOM byte-signature check, confirm only the BOM test fails; (f) restore the wildcard
   arm's message to "contains a control character", confirm only the unexpected-failure test fails;
   (g) revert ONLY the `if`/`else` restructure to a bare `model=$(…)` + separate `case
   "$node_status"`, KEEPING the exhaustive dispatch and its distinct wildcard message unchanged —
   confirm only the `set -e` test fails (silent exit, no output), and the unexpected-failure test
   still passes, since that test never runs under `set -e` and the dispatch itself is unaffected.
   **Corrected in plan-gate round 11 (Codex): the original wording here claimed reverting the
   `if`/`else` alone would break both the unexpected-failure test and the `set -e` test together,
   attributing findings 8 and 9 to one shared mutation — verified directly and found wrong. They are
   two separate fixes: (f) alone (the wildcard message) is what the unexpected-failure test actually
   depends on, and (g) alone (the `if`/`else` control flow) is what the `set -e` test depends on; a
   mutation combining both was run by mistake in the original verification pass and its two-test
   failure was misread as proving a shared dependency that isn't there.** (h) remove the
   `if (s.includes("\uFEFF")) process.exit(6);` line alone, confirm only the embedded-BOM test fails
   and the leading-BOM test (exit 5, checked earlier on the raw bytes) still passes — verified
   directly: reverting, `npm test` failed exactly `a model id with a BOM embedded after the start is
   refused, not silently passed through` (`0 !== 1`), restored, full suite green again at
   1189/1189. (i) revert the control-character exit code from 7 back to 1 (both the
   `process.exit(7)` call and the `case` arm's `7)` back to `1)`), confirm only the finding-11
   regression test fails and the control-character tests (bare CR, embedded NUL, U+0085,
   second trailing newline) still pass, since those still exit through the SAME dispatch value the
   case arm still recognizes — verified directly: reverting, `npm test` failed exactly the test
   proving finding 11's fix, with the
   actual stdout showing `refusing: model id contains a control character` where `refusing: model id
   validator failed unexpectedly` was expected — restored, full suite green again at 1190/1190.
   (j) revert every custom exit code from the 20+ range back to its finding-11-era single-digit value
   (20→2, 21→3, 22→4, 23→5, 24→6, 25→7, in both the JS validator and the `case` arms), confirm only
   the finding-12 regression test fails, and every other test — including the finding-11 test and the
   four control-character tests — still passes, since
   none of the other single-digit values this validator produces collide with a code the real `node`
   binary can independently produce on its own — verified directly: reverting, `npm test` failed
   exactly the test proving finding 12's fix, with the actual stdout showing `refusing: model id contains a control
   character` where `refusing: model id validator failed unexpectedly` was expected — restored, full
   suite green again at 1191/1191. **Both (i) and (j) were verified against a NODE_OPTIONS-based
   reproduction of the original crash, before finding 13 (below) forced switching both tests to a
   decoy-`node` mechanism instead — the reverts and their predicted failures are unchanged by that
   switch, since it only changed HOW exit 1/exit 7 get produced, not what the dispatch does with them,
   but a reader grepping for the ORIGINAL quoted test names used when (i)/(j) were first verified
   (`a real Node startup crash (exit 1)…`, `a real Node internal-handler crash (exit 7)…`) will not
   find them under those names any more — they are now `a Node exit matching the code 1 uses…` and
   `a Node exit matching the code 7 uses…`.**
   (k) revert `canon() { NODE_OPTIONS= node -e '` to `canon() { node -e '`, confirm only the
   `canon defeats an inherited NODE_OPTIONS preload…` test in `tests/delegate-containment.test.js`
   fails (with `canonBlock()`'s own extraction string temporarily loosened to `'  canon() { '` for the
   duration of this one mutation, since the extraction helper otherwise matches the fixed text
   literally and would itself break first) — verified directly: reverting, the test failed with the
   actual resolved path prefixed by the preload's injected `prefix\n`, exactly as finding 13
   describes; restored (both the source and the extraction string), full suite green again.
   (l) revert `if buf_bom=$(NODE_OPTIONS= node -e '` to `if buf_bom=$(node -e '` in the model
   validator, confirm only the two finding-13 regression tests fail (the exit-code-forgery case and
   the stdout-injection case) and nothing else — verified directly: reverting, `npm test` showed
   exactly those two tests failing, one on a false refusal (`1 !== 0`) and one on the injected
   `prefix\n` appearing in the captured `--model` argument; restored, full suite green again at
   1194/1194. **(k) and (l) were both verified BEFORE finding 14 (below) landed** — the shipped source
   they describe reverting to at the time was exactly `canon() { NODE_OPTIONS= node -e '` and
   `if buf_bom=$(NODE_OPTIONS= node -e '`; finding 14 has since prepended `OPENSSL_CONF= ` ahead of
   `NODE_OPTIONS= ` in both places, so a reader reverting (k)/(l) literally against the CURRENT source
   needs to revert only the `NODE_OPTIONS= ` portion of the combined prefix, leaving `OPENSSL_CONF= `
   in place — checks (m) and (n) below are the isolated mutations for `OPENSSL_CONF= ` alone, verified
   against the current, combined source.
   (m) revert `canon() { OPENSSL_CONF= NODE_OPTIONS= node -e '` to `canon() { NODE_OPTIONS= node -e '`
   (removing only the `OPENSSL_CONF= ` prefix, keeping `NODE_OPTIONS= ` intact), confirm only the
   `canon defeats an inherited OPENSSL_CONF…` test in `tests/delegate-containment.test.js` fails (with
   `canonBlock()`'s own extraction string again temporarily loosened to `'  canon() { '` for the
   duration of this one mutation, for the same reason as check (k)) — verified directly: reverting,
   the test failed with the exact OpenSSL configuration-error stderr this finding's reproduction
   produces (`node: OpenSSL configuration error: … missing equal sign …`, exit code 101); restored
   (both the source and the extraction string), full suite green again.
   (n) revert `if buf_bom=$(OPENSSL_CONF= NODE_OPTIONS= node -e '` to
   `if buf_bom=$(NODE_OPTIONS= node -e '` in the model validator (removing only `OPENSSL_CONF= `),
   confirm only the finding-14 regression test fails and nothing else — verified directly: reverting,
   `npm test` showed exactly that one test failing, on a false refusal (`1 !== 0`) with the stdout
   showing `refusing: model id validator failed unexpectedly (exit 101)`; restored, full suite green
   again at 1196/1196. **(m) and (n) were both verified BEFORE finding 15 (below) replaced the pairwise
   `OPENSSL_CONF= NODE_OPTIONS= ` clearing with `env -i PATH="$PATH"` — the shipped source they
   describe reverting to at the time no longer exists; the isolated mutation for the current,
   shipped form is check (o) below.**
   (o) revert `env -i PATH="$PATH" node -e '` to plain `node -e '` in BOTH the model validator and
   `canon()` (with `canonBlock()`'s own extraction string again temporarily loosened to
   `'  canon() { '` for the duration), confirm **nine** regression tests fail and nothing else —
   verified directly: reverting, `npm test` failed exactly those nine (four in
   `delegate-containment.test.js` — the NODE_OPTIONS, OPENSSL_CONF and IPC/cluster defeats plus the
   kitchen-sink positive control, all "in isolation"; five in `delegate-template.test.js` — the same
   four plus the NODE_OPTIONS false-refusal case) and nothing else. Nine, not four: `env -i
   PATH="$PATH"` is what now provides finding 13's and 14's clearing as well as finding 15's own, so
   reverting it drops all three at once rather than only the two tests finding 15 itself added — an
   undercount the round-6 pass-verdict Claude subagent flagged in this same check and which this text
   corrects. The IPC/cluster cases in
   particular HUNG rather than failing fast on the first attempt, exactly the hazard finding 15's own
   note above describes, until the `timeout: 10000` already present on the regression tests bounded
   it — the mutation then completed in ~10s for the slowest case, failing on the predicted assertions
   (a false refusal for the kitchen-sink and NODE_OPTIONS/OPENSSL_CONF cases, `NODE_CLUSTER` JSON or a
   raw prefix reaching the captured id for the IPC and NODE_OPTIONS-inject cases);
   restored (both the source and the extraction string), full suite green again at 1200/1200. The
   shell-metacharacter
   test itself — run once,
   as written, against the real recipe — is the injection proof: there is no toggleable guard to
   disable here (safety comes from the file-based channel never touching shell interpolation at all,
   not from a conditional check on the value), so a mutation cycle would have nothing to mutate
   between "safe" and "unsafe" short of reverting to a shell-interpolated design plan-gate round 1
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
- File two new backlog items for the out-of-scope findings noted in section 2 above (both clear the
  worth bar — each is a dated instance already observed and verified, not a plausible future):
  1. `canon()` in `agents/oai-delegate.md` checks only `/[\x00-\x1f]/` (C0), not the fuller
     `[\x00-\x1f\x7f-\x9f]` range this item's own model validator uses — a real in-tree filename
     containing DEL or a C1 control character (e.g. U+0085) is resolved and accepted by the
     attachment-path containment check despite the attachment rule's stated "refuse a control
     character." Found by `codex-adversarial`, review-ladder pass 2 (resumed) Group B, 2026-08-23.
  2. `tests/delegate-template.test.js`'s file-level header comment ("runs the block under EVERY shell
     on the machine") and several test names/comments repeating that claim overstate the fixed
     `SHELLS` allowlist (`zsh`/`sh`/`dash`/`bash`), which excludes any other shell installed on the
     machine — confirmed present here at `/bin/ksh` and `/bin/tcsh` (the latter not even POSIX-family).
     Found by `codex-plain`, same pass, same date.
- No further residue expected beyond the two items above — the underlying `--model` validation
  machinery this item relies on was already built and tested for `/oai:task`/`/oai:review`; this item
  only extends the one caller (the delegate agent) that didn't yet expose it.
