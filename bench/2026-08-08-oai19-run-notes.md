# OAI-19 run provenance, recorded by hand (G-F; OAI-47 is not landed)

Recorded BEFORE the first arm, 2026-08-07:
 - harness SHA at launch: 93c20636b7f5ab31715ac56bf5dc873246641d60, working tree CLEAN
 - LM Studio CLI commit: 71bd99c
 - `lms ps` before arm: EMPTY after `lms unload --all` (dense qwen/qwen3.6-27b had been resident,
   IDLE, context 61696, no TTL). Saved to bench/results/2026-08-07-oai19-arm-moe-state-BEFORE.log
 - model ids served, by hand: qwen/qwen3.6-27b, qwen/qwen3.6-35b-a3b (plus three gemma-4 variants and
   one embedding model, none used)
 - sole tenancy: yes, nothing else connected

HONEST PROVENANCE NOTE, recorded rather than smoothed over: after the MoE arm was launched, commit
a053318 landed on HEAD. It touches HANDOVER.md ONLY — no harness file, no bench case, no corpus.
So the instrument the arm ran is byte-identical to 93c2063's, and that is the SHA the arm should be
recorded against. Stating it because "tree clean at SHA X" would otherwise be checkable and wrong.

THE PARSER BOUNDARY, which the harness SHA exists to mark:
This arm measures the reply parser as it stands after OAI-84. OAI-112 (candidate-selection design,
withdrawn and awaiting the user), OAI-113 (quadratic scan) and OAI-114 (primitive sibling discards a
whole list) will all change that parser again. A later arm must NOT be differenced against this one
across that boundary without saying so.

G-G COUNTER — a reading, stated before the result, not after:
Invocation 1 (2026-08-04, MoE) failed its gate and invocation 2 was deliberately aborted. I am
treating THIS run as a FRESH G-G counter, because both ran against the crashing instrument — before
OAI-51 removed the schema by default and before OAI-84 repaired the parser, and BACKLOG.md itself
says records from that instrument are reliability evidence and not recall evidence. If the user
rejects that reading, the MoE arm publishes as a FAILURE on its next gate miss instead of getting a
second attempt. Recorded now so the choice cannot be made after seeing the number, which is the exact
optional-stopping failure G-G exists to prevent.

INVOCATIONS THIS RUN (G-G requires every one reported, aborted included):
 - Invocation A — MoE qwen/qwen3.6-35b-a3b, full corpus, --runs 3 --warm-up --max-attempts 3.
   Launched 2026-08-07 ~16:5x BST. Warm-up fired and paid the JIT load. Outcome: PENDING.

## Invocation A — MoE, full corpus, --runs 3 --warm-up --max-attempts 3. INVALID.
Record `bench/results/2026-08-07T17-55-12-678Z.json`, report `...678Z.md`. ~55 min.
`lms ps` after: qwen/qwen3.6-35b-a3b IDLE, context 71936 — sole tenancy held.

FAILS THREE INDEPENDENT CRITERIA:
 - G-B (>=2 scored of 3 per case): caps 0/3, config-origin 1/3, model-info 1/3, scaffold 0/3,
   structured 0/3. Only docs-only reached 3/3. FIVE of six cases below the floor.
 - G-C (unresolved-from-unscored <=3 of 33): 13 of 18 runs unscored. Far over.
 - G-E (ledger completeness): the 10 failed runs carry `attempts: null` — NO ledger at all. The 8
   completed runs keep theirs at `run.report.attempts`, one attempt each. Established by walking the
   JSON and printing the true path of every `attempts` key, after two probes disagreed with grep;
   the disagreement was my probe reading the wrong nesting level, not the data.
G-L passes on what was scored: contextChecked true on all 8 completed runs.

THE CAUSE, AND IT IS NOT 2026-08-04's. All 10 failures are ONE shape: the model reasons without
ever emitting content until the token budget is exhausted. Peak reasoning per failed run:
  caps 122,885 | config-origin 109,913 | model-info 95,713 / 94,189
  scaffold 77,591 / 69,687 / 67,019 | structured 28,070 / 27,992 / 27,305 chars
There were ZERO transport failures — 8 physical attempts, 8 answered, 0 failed. 2026-08-04 was the
opposite: 31 attempts, 17 failed, split cleanly into empty-completion and stream-unfinished. So the
drop mechanism that motivated OAI-20/OAI-34 did not appear here AT ALL, and a different one dominates.

HYPOTHESIS, stated as one and not as a result: this is downstream of OAI-51 making the no-schema
prose path the default. Under a schema the grammar forced the model to close its think block and
emit; with no schema nothing does, so it reasons until the budget dies. The same behaviour was
observed twice by hand during OAI-84's verify step (a real review hit --max-seconds after 20k+ chars
of reasoning with no content). NOT confirmed here — confirming it needs a --structured-output arm,
which is a different instrument and therefore a different item.

ALSO: 3 of the 8 completed runs came back `parsed: false` (caps x2, config-origin x1) — a reply
arrived and did not parse into findings, on the parser OAI-84 just repaired and OAI-112/113/114 are
open against. Raw replies are in the record. Worth reading before OAI-112 is planned.

 - Invocation A outcome: FAILED THE GATE. Under G-G a second invocation follows, and it is final.

## The three `parsed: false` replies — checked, and only ONE is interesting
Suspected an OAI-84-class parser defect. It is NOT one, and the check refuted my suspicion:
 - caps x2: the model answered in YAML-ish prose (`findings: []` then `analysis:`), never JSON.
   Legitimately unreadable; the model did not follow the format.
 - config-origin x1: LOOKS like well-formed `{"findings":[...],"summary":...}` and is NOT.
   `json.loads` fails with "Invalid \escape: line 15 column 27". `parseFindings` returns null,
   which is CORRECT behaviour, not a defect.

WHY it is malformed is the finding, and it is the feature's own tension in the wild:

    "evidence": "return \`${url.origin}${path === '' ? '/v1' : path}\`;"

The system prompt ORDERS the model to quote the offending source line. The offending line was a JS
template literal, so the model quoted it including backticks and escaped them as `\`` — which is a
valid JS escape and NOT a valid JSON one. The instruction that makes the reviewer useful is the same
instruction that breaks its transport.

This is real model output, not a constructed case, and it belongs in OAI-112's replacement design:
a lenient repair for invalid escapes would recover this reply intact. Filing it as evidence rather
than acting on it — the candidate-selection design is withdrawn and awaiting the user.

## Invocation B — MoE, identical configuration. INVALID. MoE ARM PUBLISHES AS A FAILURE.
Record `2026-08-07T19-29-44-696Z`, ~95 min. `lms ps` after: MoE IDLE, sole tenancy held.
 - G-B FAIL: caps 0/3, model-info 1/3, scaffold 1/3, structured 0/3 (config-origin 2/3 and
   docs-only 3/3 cleared it). Four of six below the floor.
 - G-C FAIL: 9 of 18 runs unscored.
 - G-E FAIL: 9 failed runs carry `attempts: null`; the 9 completed keep theirs at report.attempts.
 - G-L passes on all 9 completed runs.
Both invocations are now spent, so under G-G the MoE arm is PUBLISHED AS A FAILURE — the predeclared
outcome, exactly as 2026-07-30 was.

THE MECHANISM REPLICATES EXACTLY, and this is the arm's real deliverable:
  A: 10/10 lost runs = token budget exhausted by reasoning, 0 of 8 attempts failed in transport.
  B:  9/9  lost runs = the same,                            0 of 9 attempts failed in transport.
19 lost runs across 36, one mechanism, zero transport drops in either invocation. Peak reasoning in B
mirrors A case by case (caps ~119-127k, model-info ~96-99k, scaffold ~75-77k, structured ~27k).
`structured` failed 3/3 in BOTH — deterministic for that request, not sampling.
So a third invocation would not be a retry, it would be resampling a deterministic failure. G-G
forbids it anyway.

TWO THINGS THE ARMS DID SHOW, as bounded observations and NOT as the baseline:
 - `scaffold` produced one ANCHORED catch in B (1 of 3 scoreable, 33%) — a real defect located on a
   real commit diff. `config-origin` anchored one in both invocations.
 - `docs-only`, the NEGATIVE CONTROL, returned 0 unmatched in A and **3 unmatched in B**. On that case
   unmatched IS false-positive by construction (it contains no code). So the false-positive rate is
   not stable across two identical invocations, which is itself worth more than either number.

STILL UNRESOLVED, and the write-up must say so: the cause of the 2026-07-30 / 2026-08-04 request
drops. These arms neither reproduce them (zero transport failures in 17 attempts) nor explain them.

## DIAGNOSTIC TESTS — user-authorised 2026-08-07, to run AFTER the dense arm
These are NOT arms and carry no gate. They are reported anyway, and must never be quoted as recall.
Sole tenancy still applies: run them one at a time, nothing else connected.

THE MECHANISM THEY TEST. `max_tokens` is ONE budget shared by reasoning and the answer; the client
computes it as ~(window - prompt), capped 32768; qwen3.6 spends essentially all of it thinking.
Evidence, from the LM Studio server log matched against measured peak reasoning — four cases, four
DIFFERENT budgets spanning 4.5x, reasoning stopping at 86-94% of each:
    structured   27,305 chars ~6,826 tok   max_tokens  7,331   93%
    scaffold     76,700 chars ~19,175 tok  max_tokens 22,358   86%
    model-info   98,890 chars ~24,722 tok  max_tokens 27,371   90%
    caps        122,885 chars ~30,721 tok  max_tokens 32,768   94%
The model does not reason a fixed amount and overflow — it reasons until the budget is gone, whatever
the budget is. This also explains why `structured` failed 3/3 in BOTH invocations: largest prompt ->
smallest reply budget -> dies fastest. The biggest input is the LEAST likely to answer.

T1 — allocation, not sizing. `structured` alone, --diff-only (small prompt -> large budget),
     explicit large --max-tokens. PREDICTION: it completes. If it does not, the hypothesis is wrong
     and the cause is not budget starvation.
T2 — the schema arm. One case with --structured-output. Under a grammar the model is FORCED to close
     its think block and emit. PREDICTION: the token-exhaustion failures vanish. This is also the
     test that distinguishes instrument-wide from a qwen3.6 quirk, AND the direct test of whether the
     2026-07-30/08-04 TRANSPORT drops return with the schema — which would confirm OAI-51 as their
     cause, something the JIT-TTL line never could.
T3 — reasoning cap. Check whether LM Studio passes a thinking control (reasoning_effort, /no_think)
     for qwen3.6. Separates "reasons too much" from "budget too small". May be unavailable; if so,
     record that rather than substituting a proxy.
T0 — free, already running: the DENSE arm is a different model on the same instrument. Identical
     failure => the cause is the instrument, not qwen3.6-35b.

ORDER: dense arm -> T1, T2, T3 -> then the gate's --max-attempts 1 control arm on scaffold, both
models. The control arm is predeclared WEAK and temporally confounded by running last, so the extra
confounding these tests add does not change its status — but say so in the write-up.

## Invocation C — DENSE qwen/qwen3.6-27b, full corpus, N=3. INVALID, but it REFUTES my hypothesis.
Record `2026-08-08T00-01-31-181Z`, ~3h20m. `lms ps` after: dense IDLE, sole tenancy held.
 - G-B FAIL: scaffold 0/3. Every OTHER case scored 3/3 — caps, config-origin, docs-only, model-info
   AND structured.
 - G-E FAIL: the 3 failed runs carry `attempts: null`.
 - G-L passes on all 15 completed; analysisCut false on all 15 (nothing censored).

T0 ANSWERED, AND IT KILLS THE "INSTRUMENT-WIDE" READING I RECORDED EARLIER:
    MoE   8-9 of 18 runs completed, 4-5 of 6 cases failing
    DENSE  15 of 18 runs completed, 1 of 6 cases failing
Same instrument, same corpus, same flags. So the failure is NOT instrument-wide — it is
MODEL-MODULATED. And note the direction is the opposite of the naive guess: dense has the SMALLER
window (61,696 vs 71,936), so smaller reply budgets, and still failed far less. The MoE simply
reasons about twice as much for the same case (scaffold ~76k chars MoE vs ~41k dense).

REFINED MECHANISM, which both arms support:
  A run dies when (window - prompt) is smaller than the tokens the model wants to spend reasoning.
  Two independent terms: PROMPT SIZE sets the budget, MODEL VERBOSITY sets the demand. scaffold has
  the largest prompt, so it starves on BOTH models. Everything else starves only on the MoE.
This also explains `structured` cleanly, and the explanation is the gate's OWN documented confound:
dense sent it down ADR 005's diff-only rung (prompt 28,816, hunksOnly true) while the MoE sent whole
files — so the arms did not review the same request, and "dense scored structured 3/3" is a
budget difference, NOT a model-quality difference. The gate predeclared exactly this; it is why no
case here is a clean model-only comparison.

TRANSPORT FAILURES ACROSS ALL THREE ARMS: 0 of 8, 0 of 9, 0 of 15 = 0 of 32 attempts.
Against 37.5% (2026-07-30) and 38.9% (2026-08-04), both of which ran WITH the schema. Consistent with
OAI-51 (the grammar lexer segfault) having been the cause. Still confounded; T2 is the direct test.

DENSE DID FIND THINGS: config-origin 3 of 6 opportunities with 3 ANCHORED catches. docs-only, the
negative control, returned 2 unmatched (false positives by construction) — MoE returned 0 then 3.

## T3 — RESULT: NEGATIVE. No effective reasoning control exists on this server.
`reasoning_effort:"low"`, `chat_template_kwargs:{enable_thinking:false}` and
`reasoning:{max_tokens:512}` are ALL accepted (no error) and ALL silently ignored.
My first single-shot probe looked like `reasoning.max_tokens` worked — 75 chars of reasoning and a
clean "OK" where the other two produced empty content. That reading was NOISE, and the control is
what caught it:
    CONTROL (no parameter):        OK / OK / OK    reasoning 77, 184, 76 chars
    reasoning:{max_tokens:512}:    OK / '' / OK    reasoning 106, 313, 70 chars
The control is as good or better. Run-to-run variance, not a parameter effect. Recorded because a
single probe of each would have shipped "reasoning.max_tokens fixes it" as a finding.
CONSEQUENCE: the failure class cannot be fixed by asking the server to think less. It has to be fixed
by giving the answer its own budget, or by reinstating something that forces emission (T2).

## T1 — RESULT: PREDICTION PARTIALLY REFUTED. Budget starvation is real but is NOT the whole cause.
MoE + `structured` + `--diff-only`, 3 runs. Record in bench/results/2026-08-08-T1-*.log.
    prompt 64.6k tok (whole files) -> max_tokens  7,331 -> 0 of 3 scored (both arm invocations)
    prompt 28.8k tok (--diff-only) -> max_tokens 32,768 -> 1 of 3 scored
A 4.5x larger reply budget moved the case from 0/3 to 1/3. I predicted it would COMPLETE. It did not.
So the MoE consumes whatever budget it is given, up to the 32,768 cap — the cap is the binding
constraint for this model, not the prompt size. Consistent with the arm: `caps` had the full 32,768
and still died at ~122k chars of reasoning (~30.7k tokens, 94% of budget).
CONSEQUENCE: "give it a bigger budget" is NOT the fix for the MoE. Combined with T3 (no reasoning
control exists), the only remaining levers are (a) reserve tokens for the answer so reasoning cannot
consume them, or (b) reinstate something that FORCES emission — which is exactly what T2 tests.

## T2 attempt 1 — INCONCLUSIVE, discarded. The target did not stress the budget.
`--commit 674cf49`, MoE, 3 runs each mode. ALL SIX completed: parsed=true, finish=stop, 1 attempt,
0 transport failures, findings=0 in every run — in BOTH modes. Since the CONTROL never failed, the
test cannot discriminate: "the schema fixed it" is unfalsifiable on a target where nothing was broken.
Recorded rather than quietly re-run, because reading this as "schema works" is exactly the
positive-control failure this repo keeps producing. (One run's line is a traceback from MY extraction
script hitting a raw newline in a JSON string — not a CLI failure.)

## T2 v2 — DECISIVE, but for the OTHER question. Split the two claims carefully.
Target `--base 4f6975a` (whole files, promptChars ~112,700), MoE, 3 runs each mode.
    CONTROL (no schema):  3/3 completed, parsed=true, 1 ATTEMPT EACH, 0 failures.
    --structured-output:  2/3 runs ERROR reason=`empty-completion` after 3 ATTEMPTS EACH;
                          the 1 survivor also needed 3 attempts.
So roughly 7 of 9 physical attempts failed under the schema against 0 of 3 without it, on the SAME
target, same model, same session, minutes apart.

**ESTABLISHED: the schema causes the transport drops.** `empty-completion` is precisely the
2026-07-30 / 2026-08-04 signature (13 of 17 failed attempts there were empty-completion). It appears
only under `--structured-output` and never in the control. This is the direct causal evidence that
OAI-51 asserted from the server log and that the OAI-20 / OAI-24 / OAI-34 line spent weeks failing to
reach from the client side — including OAI-34's intervention run, which refuted JIT-TTL without
supplying a cause. It also explains why all three arms today saw 0 transport failures in 32 attempts:
they ran without the schema.
This does NOT rest on the drop-rate arithmetic; it rests on a controlled A/B.

**NOT ESTABLISHED: whether the schema fixes token exhaustion.** The control did not starve on this
target — all 3 control runs returned findings=0 quickly, so the model never reasoned at length. A
target where the control succeeds cannot show the schema rescuing anything. That question is still
open and needs a target that reproducibly starves the control (the bench `structured` case with whole
files does, but bench cannot pass --structured-output — which is itself a gap worth filing).

TAKEN TOGETHER, the two failure classes are now SEPARATED and each has a cause:
 - WITH schema:    grammar-driven `empty-completion` transport drops (OAI-51, now causally confirmed).
 - WITHOUT schema: reasoning consumes the whole shared token budget and no findings are emitted
                   (this run's finding; model-modulated, worst on the MoE).
OAI-51 traded the first for the second. That is the sentence the write-up needs.
