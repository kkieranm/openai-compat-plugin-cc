ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug polymorphic-wiggling-tulip

# OAI-204: bounded head+tail trim for salvage's fed-back reasoning

## Context

`trySalvage` (`scripts/lib/review-request.mjs`) is the recovery path for a review request that hit
`token-reserve-cutoff`, `reasoning-only`, or `deadline-timeout`: it re-sends the model's own partial
reasoning as a new assistant-turn message, plus an explicit "stop reasoning, conclude now" instruction,
hoping the model writes findings instead of continuing to reason. Measured overnight during OAI-19
(`bench/2026-08-23-oai19-run-notes.md`): salvage fires on every eligible failure but rescues almost
none of them — 1 of 14 observed this session. The model ignores the "conclude now" instruction and
keeps reasoning inside the salvage follow-up too, exhausting its 2,048-token budget without ever
emitting content. Confirmed by direct reading: there is currently no length ceiling on the reasoning
fed back — only a 500-char *minimum* (`SALVAGE_MIN_REASONING_CHARS`) before salvage is attempted at
all. On the observed failures the fed-back reasoning was ~45,000-47,000+ characters.

This was steered by a Codex review of the OAI-19 evidence (not re-litigated here): trial a
deterministic, recorded head+tail trim of the fed-back reasoning — not a second model-generated
summary, which risks the same starvation — holding the existing salvage budget
(`TOKEN_RESERVE_TOKENS`=2,048, `SALVAGE_MAX_MS`=300,000ms) fixed, so transcript size is the only
variable this first comparison isolates. Grilled with the user, both Claude's and Codex's independent
recommendations agreeing: ships as `trySalvage`'s new unconditional default (no CLI flag — a future
A/B compares before/after commits via the bench harness, not a runtime toggle), and applies only when
`fallbackError.reason` is `token-reserve-cutoff` or `reasoning-only` — `deadline-timeout`'s follow-up
is left completely untouched, since it was never observed failing to rescue in the measured data and
already keeps a different (larger) budget.

Named risk, carried forward rather than resolved: a fixed trim can discard the one reasoning span that
anchors the eventual finding. This is the first trial specifically to test whether transcript size is
the actual lever — not a claim that it is.

## 1. New constants (`scripts/lib/review-request.mjs`, next to `SALVAGE_MIN_REASONING_CHARS` at line 242)

```js
/**
 * How much of the model's own reasoning gets fed back into a salvage
 * follow-up, in characters, when trimming is scoped in (see
 * SALVAGE_SMALL_RESERVE_REASONS below).
 *
 * ~6,000 chars total (1,500 head + 4,500 tail) — derived, not picked blind:
 * TOKEN_RESERVE_TOKENS (2,048), the budget already shown by its own 17-run
 * sample to be enough room for a real answer, converted through
 * REASONING_CHARS_PER_TOKEN (3.0, stream-collect.mjs's own reasoning-text
 * ratio) gives 6,144 chars; rounds down to a clean 6,000. The follow-up's
 * prior context is sized to the same order of magnitude as the budget
 * already proven to work, not to the 45,000-47,000+ chars measured failing
 * overnight (2026-08-23/24, bench/2026-08-23-oai19-run-notes.md) — that size
 * is the thing this trial exists to test as the actual lever.
 *
 * Split 25/75, tail the larger share: the head keeps the model's initial
 * framing, the tail keeps what it was about to conclude when the reserve cut
 * it off — closer to the actual defect than the framing is. At 16x
 * SALVAGE_MIN_REASONING_CHARS (500), well above the floor for even
 * attempting salvage at all.
 *
 * Named risk, unresolved: a fixed trim can discard the one span — likely
 * mid-transcript — that anchors the eventual finding. Not measured against a
 * head+tail shape yet, only against feeding back everything; this is the
 * first trial, and TOKEN_RESERVE_TOKENS/SALVAGE_MAX_MS stay unchanged so
 * transcript size is the only variable it isolates.
 */
const SALVAGE_TRIM_HEAD_CHARS = 1_500;
const SALVAGE_TRIM_TAIL_CHARS = 4_500;

/**
 * The two failure reasons whose salvage reserve is already the smaller flat
 * TOKEN_RESERVE_TOKENS (see salvageReserve below) — and, per OAI-204, the
 * only two whose fed-back reasoning gets trimmed. `deadline-timeout` keeps
 * both its full built.reserve and its full untouched reasoning: that
 * combination was never observed failing to rescue in the measured data, so
 * it is deliberately left alone rather than changed on the same trial as the
 * other two. One Set, reused by both branches, so the two decisions cannot
 * silently drift apart.
 */
const SALVAGE_SMALL_RESERVE_REASONS = new Set(['token-reserve-cutoff', 'reasoning-only']);
```

Replace the inline `['token-reserve-cutoff', 'reasoning-only'].includes(fallbackError.reason)` array
literal in the existing `salvageReserve` branch (~lines 335-337) with
`SALVAGE_SMALL_RESERVE_REASONS.has(fallbackError.reason)` — same condition, one source instead of a
literal a future edit could fork from the new one.

## 2. Trim helper (local, pure — matches `armedReserve`'s shape at line 79)

```js
/**
 * Head+tail retention trim for the reasoning fed back into a salvage
 * follow-up. Deterministic and dumb on purpose — no second model call to
 * summarize, which risks the exact starvation this exists to avoid.
 *
 * `applied: false` when `apply` is false (deadline-timeout) or the reasoning
 * already fits inside the combined budget — tests/salvage.test.js's existing
 * short-fixture tests pass through unmodified either way.
 *
 * Only ever reads `reasoning`; never mutates it and never touches
 * `fallbackError.answer` — tier 1's partial stays exactly what it was,
 * whether or not tier 2 trims its own copy of it.
 */
function trimReasoning(reasoning, { apply, headChars = SALVAGE_TRIM_HEAD_CHARS, tailChars = SALVAGE_TRIM_TAIL_CHARS } = {}) {
  const originalChars = reasoning.length;
  if (!apply || originalChars <= headChars + tailChars) {
    return { text: reasoning, applied: false, originalChars, retainedChars: originalChars };
  }
  const omitted = originalChars - headChars - tailChars;
  const marker = `\n\n[...${omitted} characters of reasoning omitted...]\n\n`;
  return {
    text: `${reasoning.slice(0, headChars)}${marker}${reasoning.slice(-tailChars)}`,
    applied: true,
    originalChars,
    retainedChars: headChars + tailChars,
  };
}
```

## 3. Wiring into `trySalvage` (`review-request.mjs:305-391`)

At lines 307-323, insert the trim between computing `reasoning` and building `messages`:

```js
const reasoning = fallbackError.answer?.reasoning?.trim() ?? '';
const content = fallbackError.answer?.content?.trim() ?? '';
if (reasoning.length < SALVAGE_MIN_REASONING_CHARS || content.length > 0) return null;

const trim = trimReasoning(reasoning, { apply: SALVAGE_SMALL_RESERVE_REASONS.has(fallbackError.reason) });

const messages = [
  ...built.messages,
  { role: 'assistant', content: trim.text },
  { role: 'user', content: /* unchanged instruction text */ },
];
```

The return at line 387 gains one field, always present on a successful salvage (mirrors `salvaged`'s
own always-present pattern, so a future bench comparison can read per-run whether trimming applied
without cross-referencing `reason` separately):

```js
return {
  result, structured: false, ...built, budget, estimatedTokens,
  salvaged: true,
  salvageTrim: { applied: trim.applied, originalChars: trim.originalChars, retainedChars: trim.retainedChars },
};
```

Everything downstream (`estimatedTokens`, `checkContextBudget`) already derives from `messages`, which
now contains `trim.text` — a trimmed follow-up is automatically less likely to be refused by the
oversize-window check than before. Worth one line in the commit message as an expected side effect,
not a scope change. No change needed at either consumer site — `unconstrained()`'s catch
(~lines 222-224) and `requestFindings`'s `--structured-output` catch (~457-458) — both already do a
bare `if (salvaged) return salvaged;` pass-through.

**On a *failed* salvage** (the case this fix is actually aimed at): `trySalvage` returns `null` before
reaching the `salvageTrim` return, so that field never appears for a failure — but the fix's effect is
still observable there without any new field, because the physical attempt's existing
`attempts[].promptChars` ledger entry is computed from the actual `messages` sent, which now contains
the trimmed text. A future arm comparing before/after this change will see the salvage attempt's
`promptChars` shrink from the ~200,000+ chars measured overnight to roughly the trim budget plus the
original prompt, on both successful and failed salvages alike — no new plumbing needed for this.

## 4. `scripts/lib/cmd-review.mjs` (~line 145-171)

Destructure `salvageTrim` alongside `salvaged`, pass it into `report()`'s context object right beside
`salvaged: Boolean(salvaged),` (~line 164):

```js
const { result, structured, schema, budget, estimatedTokens, hunksOnly, skipped, salvaged, salvageTrim } = await withProgress(...);
...
salvaged: Boolean(salvaged),
salvageTrim: salvageTrim ?? null,
```

## 5. `scripts/lib/review-report.mjs` (`jsonReport`, line 146-202)

Destructure `salvageTrim` from `context` at line 147; add it to the returned envelope right after
`salvaged: Boolean(salvaged),` (line 156):

```js
salvaged: Boolean(salvaged),
// The trim decision trySalvage made about the OUTGOING follow-up request —
// same diagnostic class as budget/estimatedTokens/hunksOnly (a fact about
// what WE sent), never the analysisCap class (a fact read off the model's
// reply). Deliberately JSON-only, same posture as analysisLength/analysisCap
// above. `null` when no salvage happened; `{ applied: false, ... }` when
// salvage happened but the reason (deadline-timeout) was scoped out.
salvageTrim: salvageTrim ?? null,
```

No change to the human text footer or to `reportFindings()` — stays JSON-only by design.

## 6. Tests (`tests/salvage.test.js`, reusing fixtures from `tests/token-reserve-cutoff.test.js`)

**Existing tests — confirmed unaffected, no edits:** every current `salvage.test.js` test drives
`deadline-timeout` with short (`REASONING_CHUNK`-sized) transcripts, well under the 6,000-char budget
and/or scoped out by reason — both `trimReasoning`'s size check and the reason gate leave them
untouched. `tests/token-reserve-cutoff.test.js`'s partial-preserved-on-failure tests read
`fallbackError.answer`/tier 1's partial, which `trimReasoning` never touches — unaffected.

**New test 1 — long `token-reserve-cutoff` reasoning gets trimmed.** Reuse
`wideReasoningPastThresholdThenFollowUp` (`token-reserve-cutoff.test.js`, `WIDE_CONTEXT_LENGTH`,
well past both the reserve-cutoff threshold and the 6,000 retention budget), with the follow-up
handler returning a real findings reply. Assert `salvaged === true`, `salvageTrim.applied === true`,
`salvageTrim.retainedChars === 6_000`, and the follow-up's assistant-turn content is exactly
`headChars + marker.length + tailChars` long, starting with the known fixture pattern's first 1,500
chars, ending with its last 4,500, with the omitted-count marker text in between. Bound
`originalChars`, never assert it exactly (the watchdog cuts at threshold-crossing, not at total chunk
count).

**New test 2 — long `reasoning-only` reasoning gets trimmed.** Needs the same WIDE context length so
the reserve watchdog never fires before the stream finishes cleanly (otherwise it reclassifies as
`token-reserve-cutoff` first). Custom handler: request 1 streams ~20,000 chars of `reasoning_content`
then finishes with `finish_reason: 'stop'` and empty `content`; request 2 returns real findings.
Assert the same shape as test 1.

**New test 3 — long `deadline-timeout` reasoning is NOT trimmed (the mutation-test target).** Same WIDE
context so a >6,000-char accumulation never crosses the reserve-cutoff threshold. Extend
`endlessReasoningThenFollowUp` to write ~10,200 chars before `--max-seconds 1` fires the deadline;
follow-up returns real findings. Assert `salvageTrim.applied === false`,
`originalChars === retainedChars`, and the follow-up's assistant-turn content has the full captured
length with no omitted-marker text.

**New test 4 — `salvageTrim` is `null` on an ordinary non-salvaged run.** Trivial extension of any
existing successful review test: assert `envelope.salvageTrim === null` when `envelope.salvaged` is
falsy — pins the `?? null` normalization in both `cmd-review.mjs` and `jsonReport`.

## 7. Mutation-test target (step 5 of `/feature`)

**Fault:** invert or drop `SALVAGE_SMALL_RESERVE_REASONS.has(fallbackError.reason)` feeding
`trimReasoning`'s `apply` argument (e.g. hardcode `apply: true` unconditionally). **Caught by:** new
test 3 (`deadline-timeout` must not trim) — `salvageTrim.applied` would flip to `true` and the
assistant-turn content would shrink and gain the marker text, both asserted false. This is the most
load-bearing scoping decision in the item, so it gets the dedicated mutation check rather than relying
on the positive-path tests alone to notice its absence.

## Verification

1. `npm test` green (full suite — this touches shared request-construction code, not just the new
   tests).
2. The repo's `verify` skill (`.claude/skills/verify/SKILL.md`) — real plugin load, real delegation
   round trip.
3. Mutation check per §7, restored and re-verified clean per the `/feature` process's own protocol.
4. Manual sanity: run `/oai:review --json` against a case known to hit `token-reserve-cutoff` (e.g.
   this repo's own `model-info`/`scaffold` bench cases against the dense model, if LM Studio is
   available) and confirm `salvageTrim` appears in the output with the expected shape — not required
   to pass gate (no LM Studio guarantee in CI), but worth doing once given a live server, and noted
   as skipped if not.

## Amendment — review-ladder pass 1, findings from `codex-adversarial` and `codex-plain`

The implementation above shipped and was reviewed. Five findings; all five are addressed here, before
any further review pass:

**Finding 1 (HIGH, `codex-adversarial`) — the trim regresses the one known-working case, CONFIRMED by
direct replay.** The MoE control's sole successful salvage (2026-08-23/24 overnight,
`bench/results/2026-08-24T03-29-42-980Z.json`) grew from 90,878 to 136,309 prompt chars — a
~45,431-char untrimmed reasoning transcript — and found one anchored defect. Replayed tonight
(`bench/results/2026-08-24T10-10-10-981Z.json`) against the shipped trim, `--case scaffold --runs 3
--max-attempts 1 --model qwen/qwen3.6-35b-a3b`: run 1 started from the same 90,878-char first attempt,
trimmed correctly (grew only ~7,458 chars) — and failed. 0 of 3 replay runs found an anchored defect,
against 1 of 3 last night. Codex's own conditional recommendation ("if the trimmed path repeatedly
misses while an untrimmed control succeeds, then add a fallback based on that evidence") is now met by
direct evidence, not just theory. **Decision (user, after Codex steer favoring verify-first, which this
replay completed): add an untrimmed fallback.**

**Verified, per Codex's round-1 challenge to this evidence:** the replay's run 1 genuinely hit the
technical-failure condition this fallback activates on, not a valid-but-empty findings reply that would
read the same on the bench scoreboard but never reach `trySalvage`'s fallback gate. Reasoning: run 1's
attempt 2 (the trimmed salvage) has `outcome: "answered"` (the transport succeeded, no throw) yet the
run's overall `report` is absent and the top-level `reason` stays `token-reserve-cutoff` — the only
code path from "answered, no throw" to "trySalvage returns null" in the current, pre-amendment function
is the `if (!result.content.trim()) return null` branch at line 458 (confirmed by reading the function:
every earlier `return null` requires either failing the reason/length/content-already-present gates
before the request is even sent, or `checkContextBudget` throwing, or the request itself throwing —
none of which is consistent with `outcome: "answered"`). So the replay's failure was empty content, the
exact shape the fallback exists to catch.

Fix: `trySalvage` (`scripts/lib/review-request.mjs`) tries the trimmed follow-up first (cheap, fast,
unchanged from the current shipped behavior); if THAT attempt fails (empty content, or the request
itself throws) AND trimming was actually applied (`trim.applied === true` — nothing to fall back from
if it wasn't), it makes exactly one further attempt with the reasoning fed back **untrimmed** — the
exact pre-OAI-204 behavior, same `salvageReserve`/`SALVAGE_MAX_MS` per attempt. Extract the
attempt-building logic (the `messages` array construction and the `chatCompletion` call) into a small
local helper, `attemptSalvage(reasoningText, salvageReserve, ...)`, called twice: once with
`trim.text`, once — only on the first's failure and only when `trim.applied` — with the untrimmed
`reasoning`. Have `attemptSalvage` return its own `{ result, budget, estimatedTokens }` alongside
success/failure, rather than reusing `trySalvage`'s outer-scope `budget`/`estimatedTokens` — each
attempt computes its own via its own `checkContextBudget`/`estimateTokens` call (already true today for
the single attempt; this just keeps that per-attempt, not shared, once there are two).

**The success return's every field describes the attempt that actually succeeded — this is the
whole fix, stated precisely because round 1 left it underspecified and both reviewers independently
caught the gap:**
- `salvageTrim.applied`: `true` if the trimmed attempt answered, `false` if the fallback did.
- `salvageTrim.retainedChars`: `trim.retainedChars` (6,000, or less if the guard in Finding 4 below
  left it untouched) when the TRIMMED attempt succeeded; **equal to `originalChars`** when the
  FALLBACK succeeded — the model received the full untrimmed text, so the envelope must say so, never
  the stale `6,000` from the `trim` object computed before either attempt ran. `salvageTrim.applied ===
  false` must always imply `originalChars === retainedChars`, matching the invariant Finding 4's fix
  and this amendment's own new tests both rely on.
- `result`/`budget`/`estimatedTokens`: **all three from the SAME selected attempt object — the one
  whose `result.content` is non-empty and therefore becomes the actual salvage result — never "whichever
  attempt's `checkContextBudget` call succeeded."** Round 2's wording left this gap: `checkContextBudget`
  can pass for BOTH attempts (the trimmed one included, even though it goes on to return empty
  content), so "whichever check succeeded" does not pin a single attempt when both clear the budget
  check. Precisely: `attemptSalvage` returns `{ result, budget, estimatedTokens }` as one bundle per
  attempt; `trySalvage` calls it for the trimmed attempt first, and if that bundle's `result.content` is
  non-empty, returns using THAT bundle's `budget`/`estimatedTokens` — it never reaches the fallback
  attempt at all. Only when the trimmed bundle's content is empty (or the call threw) does it call
  `attemptSalvage` again for the fallback, and — if that succeeds — returns using the FALLBACK bundle's
  `budget`/`estimatedTokens`, discarding the trimmed bundle's numbers entirely. This is the same
  invariant the function's existing docstring already states for the single-attempt case ("describe the
  GROWN prompt this function actually sends, never... stale numbers for the smaller original one") —
  the amendment must not violate it once there are two attempts. **Test**: the fallback test must assert
  `envelope.estimatedTokens` against a value computed from the THIRD request's actual sent messages
  (not merely present, or structurally plausible) — a stale trimmed-attempt `estimatedTokens` would
  otherwise pass every other proposed assertion undetected.

Update the function's docstring: "Exactly one attempt, never recursed" no longer holds as stated —
replace with "at most two attempts: trimmed, then untrimmed once, never recursed further" and name why
(this finding, this evidence). Also update `unconstrained()`'s own comment where it currently describes
calling "Salvage tier 2: one bounded attempt to conclude..." — that description goes stale under
two-attempt salvage and round 1 missed it; fix it in the same pass. This is a genuine change to a
previously documented invariant, not silently dropped.

Worst-case cost, stated plainly: a case that fails both attempts now spends up to 2×`SALVAGE_MAX_MS`
(600s) rather than 300s on the salvage phase alone, on top of the original request. Accepted — the
alternative (no fallback) is the regression finding 1 measured directly.

**Finding 2 (MEDIUM, `codex-adversarial`) — the trial's causal claim was already weaker than stated,
and the fallback makes it weaker still; not fixed by code, strengthened in documentation.** Head+tail
trimming changes both how much and which content survives, so a trim failure alone can't distinguish
"size was the lever" from "the discarded middle held the answer" — and now that a fallback exists, a
trim SUCCESS can also mean "the untrimmed fallback saved it," which the `salvageTrim.applied` fix above
exists specifically to keep visible per-run. The 25/75 head/tail split remains a stated, unmeasured
choice, not a derived one beyond the total budget. No code fix — this is an experiment-design
limitation, already partly named in the shipped docstring; strengthen `CLAUDE.md`'s note and the
constant's own docstring to state plainly that a trim success is now ambiguous between "trim rescued
it" and "fallback rescued it" without reading `salvageTrim.applied` per run, and that no clean
size-only isolation exists in this design.

**Finding 3 (MEDIUM, `codex-adversarial`) — the test oracle has a real periodic-fixture blind spot.**
`PERIODIC_SAMPLE` repeats every 51 chars: a shifted slice (e.g. off by exactly 51, or any multiple)
would still satisfy the head/tail slice assertions in tests 1 and 2 while dropping the true first/last
51 characters, and the omitted-count marker is checked only by substring
(`sent.includes('characters of reasoning omitted')`), never its exact digits — a wrong-but-same-width
count would pass. Fix: replace the periodic `REASONING_CHUNK`-based reasoning fixture in tests 1 and 2
with an indexed, non-repeating one (e.g. a chunk carrying a monotonically increasing counter, so no
two 51-char windows are identical), and assert the ENTIRE captured assistant-turn message
(`chatRequests[1].body.messages[2].content`) against an exact expected string built from the real
captured source plus the exact expected marker — not length-plus-slice-plus-substring separately. This
closes both the shift blind spot and the substring-marker gap in one change, and is confined to
`tests/salvage.test.js` — no production code changes.

**Finding 4 (P2, `codex-plain`) — `trimReasoning` can EXPAND a near-threshold transcript.** For
reasoning 6,001–6,045 chars (the omitted-count marker text is longer than what a trim in that range
actually removes), `trim.text` ends up longer than the original despite `applied: true` — the opposite
of the goal, and could push an already-near-window follow-up over `checkContextBudget`. Fix: in
`trimReasoning`, after building the trimmed candidate, compare its length to `originalChars`; if the
trimmed candidate is not actually shorter, return the untrimmed `reasoning` with `applied: false` —
the same "nothing to gain, don't pretend to" contract the existing `originalChars <= headChars +
tailChars` branch already follows, just checked against the real output length instead of the
theoretical one.

**Finding 5 (P2, `codex-plain`) — slice() can split a UTF-16 surrogate pair.** A non-BMP character
(e.g. an emoji) straddling either cut boundary leaves an unpaired surrogate. **Correction from round 1,
per Codex's re-review: `JSON.stringify`/`JSON.parse` round-trips a lone surrogate successfully in
JavaScript — it does NOT throw, so a round-trip check is not a valid way to detect this defect,
contrary to what round 1 assumed.** The real hazard is a strict OpenAI-compatible server's own JSON
parser rejecting the resulting wire payload, which this repo cannot execute a fixture against directly;
the correct check is a direct scan for an unpaired surrogate in the constructed string. Fix: after
computing the head/tail slice boundaries, adjust each inward by one character if it falls in the middle
of a surrogate pair (check `reasoning.charCodeAt(boundary - 1)` is a high surrogate and
`charCodeAt(boundary)` is a low surrogate; if so, shift the boundary by one). **The adjustment must
feed the SAME adjusted boundaries into every downstream computation, not just the slice call**: moving
a boundary changes both the true retained length and the true omitted count, so `retainedChars` and the
marker's `omitted` figure must be derived from the post-adjustment boundaries, never from the original
`headChars`/`tailChars` constants — an adjustment that shifts the cut but leaves `retainedChars`
reporting the un-adjusted 6,000 would itself reintroduce a version of Finding 2's "the field says
something that isn't what was sent" problem. Small enough to write inline in `trimReasoning`, no new
dependency. Test: assert the exact unpaired-surrogate absence directly —
`/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(sent)` is `false` — never
via a `JSON.stringify`/`parse` round-trip, which would pass even on the unfixed code.

### Test additions for this amendment

- A new fallback test: the trimmed attempt returns empty content (a fake server whose SECOND request —
  the trimmed follow-up — answers with empty content, and THIRD request — the untrimmed fallback —
  answers with real findings); assert `salvaged: true`, `salvageTrim.applied === false` (the fallback,
  not the trim, succeeded), **`salvageTrim.retainedChars === salvageTrim.originalChars`** (the field
  attribution fix both reviewers required — the model received the FULL text, the envelope must say
  so, never the stale trimmed-attempt numbers), and that the third request's assistant-turn content is
  the FULL untrimmed reasoning. This is the mutation target for the field-attribution fix: mutate
  `salvageTrim` back to always reading `trim.retainedChars` regardless of which attempt succeeded, and
  confirm this test catches it (`retainedChars` would read 6,000 instead of the full length).
- A new test: the trimmed attempt succeeds directly; assert exactly 2 physical requests total (no
  fallback attempt fired), `salvageTrim.applied === true`, `salvageTrim.retainedChars === 6_000`
  (unchanged from the pre-amendment behavior).
- A new test: both the trimmed and the fallback attempts fail; assert the function falls through to
  the ordinary failure report exactly as before this amendment (`envelope.salvaged === undefined`),
  and exactly 3 physical requests (original + trimmed + untrimmed fallback).
- Finding 4's fix: a boundary test with reasoning at 6,020 chars (inside the expansion-prone range)
  asserting `salvageTrim.applied === false` and `retainedChars === originalChars` — the mutation target
  for this fix (mutate the new length-comparison guard away, prove this test catches it).
- Finding 5's fix: a test with a surrogate-pair character (e.g. an emoji) placed exactly at the
  1,500-char head boundary and another at the 4,500-char tail boundary. Assert (a) the sent message
  contains no unpaired surrogate, checked directly via
  `/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(sent)` is `false` —
  **never** a `JSON.stringify`/`parse` round-trip, which passes even on unfixed code since JS round-trips
  lone surrogates without error; (b) `salvageTrim.retainedChars` reflects the ACTUAL adjusted
  head+tail length (not the unadjusted 6,000), proving the boundary shift propagated to the reported
  figure; and (c) **the marker's own printed count is exact, not merely `retainedChars`** — assert the
  sent message's omitted-count digits equal `salvageTrim.originalChars - salvageTrim.retainedChars`
  (equivalently, extract the number from the marker text and compare it directly). Asserting only (b)
  is not sufficient: an implementation could adjust the slice boundaries and report the correct
  `retainedChars` while still building the marker string from the original, unadjusted
  `headChars`/`tailChars` constants — every other proposed assertion in this test would still pass with
  that bug present, so the marker's exact digits must be checked independently of `retainedChars`.

This amendment re-enters the plan gate (whole plan, threaded against what was raised) before
implementation resumes, per `/feature` step 3's re-challenge rule for a changed approach.
