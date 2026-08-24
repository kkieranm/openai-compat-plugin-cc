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
