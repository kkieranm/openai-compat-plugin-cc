// What a review actually sends: how much of the window the reply may have, how
// much of the input fits alongside it, and what to do when a server refuses the
// schema.
//
// Split from `cmd-review.mjs` under the size ratchet, and the seam is a real
// one: that file turns a command line into a request and a request into output,
// while this one decides what the request *is*. The budget constants live here
// rather than there because `requestFindings` is their only consumer — leaving
// them behind would have meant either a circular import or two homes for one
// number, and this repo has already paid for the second.
import { withLedger } from './attempt-ledger.mjs';
import { chatCompletion, isReasoningOnly, reasoningOnlyRefusal } from './client.mjs';
import { checkContextBudget, estimateTokens } from './context-guard.mjs';
import { UserError } from './errors.mjs';
import { reviewSystemPrompt } from './review.mjs';
import { MIN_REVIEW_RESERVE_TOKENS, reviewSchemaFor } from './review-schema.mjs';
import { prepareLadder, unconstrainedLadder } from './review-ladder.mjs';
import { findingsFirst, isFormatRejection, responseFormatFor, schemaInstruction } from './structured.mjs';

/**
 * The ceiling on a reply budget where the window is known.
 *
 * Big, because the schema's `analysis` field is where the model does its actual
 * reasoning: one 135-line file drew 6k output tokens and was still mid-analysis.
 * A review that runs out of tokens part way returns nothing usable at all, which
 * is why this is nowhere near DEFAULT_RESERVE_TOKENS (1024).
 *
 * Raised from 16,384. The earlier ceiling was written when nothing bounded the
 * reply and more room bought only a longer runaway; with the schema bounded it
 * buys larger caps instead. What settled it is that the cost that ceiling was
 * protecting no longer exists: `prepareRequest` shrinks the reserve toward
 * `REVIEW_MIN_TOKENS` when a large input needs the window, so this number
 * withholds nothing from the input — a review is refused only when under
 * `REVIEW_MIN_TOKENS` remain, whatever this says. The half-window rule below
 * binds first on every model in use here.
 */
export const REVIEW_MAX_TOKENS = 32_768;

/**
 * The reply budget where the window is *not* known — deliberately not raised.
 *
 * With no window there is no shrink and no budget check, so this number goes on
 * the wire as `max_tokens` against a server whose capacity is a guess. That is
 * already a known defect (`/oai:task` sends none at all);
 * doubling the guess would deepen it for no gain, since the caps that need the
 * room are derived from the reserve either way.
 */
export const REVIEW_UNKNOWN_WINDOW_TOKENS = 16_384;

/**
 * The smallest reply budget worth having, and the floor the reserve yields to
 * when a big diff needs the room.
 *
 * Reserving the full 16,384 unconditionally cost ~12k tokens of *input* on
 * every review — on a 58k window the usable input fell from 54.0k to 41.7k, so
 * diffs that reviewed fine before were refused for the sake of a reply that
 * arrives at that size in roughly one run in five. This is the old reserve,
 * which is exactly the size that used to work.
 */
export const REVIEW_MIN_TOKENS = 4096;

/**
 * The reasoning-reserve watchdog's floor: ~1.8x the largest
 * observed successful answer (1,116 tokens) across a 17-run sample, well
 * above the median (~420). Hardcoded rather than configurable for v1 — one
 * measurement supports one policy, not a tunable range.
 */
export const TOKEN_RESERVE_TOKENS = 2_048;

/**
 * The watchdog is armed only when there is at least as much room for
 * reasoning as for the reserve itself — below that, the cutoff would fire on
 * the very first reasoning delta and every request on a small-window model
 * would die with nothing salvageable (`reserveFor`'s half-window branch
 * deliberately drops under the schema minimum on small windows, and the
 * resulting `finish_reason: length` behaviour is chosen on purpose, pinned by
 * test; an unguarded watchdog would silently overturn that decision).
 */
function armedReserve(reserve) {
  return reserve >= 2 * TOKEN_RESERVE_TOKENS ? TOKEN_RESERVE_TOKENS : undefined;
}

/**
 * Head+tail retention trim for the reasoning fed back into a salvage
 * follow-up. Deterministic and dumb on purpose — no second model call to
 * summarize, which risks the exact starvation this exists to avoid.
 *
 * `applied: false` when `apply` is false (deadline-timeout), the reasoning
 * already fits inside the combined budget, or the trimmed candidate would not
 * actually come out shorter (see the length check below) —
 * tests/salvage.test.js's existing short-fixture tests pass through
 * unmodified either way.
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

  // slice() can split a UTF-16
  // surrogate pair, leaving an unpaired surrogate in the wire payload. Shift
  // each cut inward by one char when it falls between a high surrogate and
  // its low surrogate. Every downstream figure — retainedChars, the marker's
  // own omitted count — is derived from these ADJUSTED boundaries, never the
  // nominal headChars/tailChars constants: a shifted cut changes both the
  // true retained length and the true omitted count, and reporting the
  // un-adjusted 6,000 here would itself misstate what was actually sent.
  let headEnd = headChars;
  const headHigh = reasoning.charCodeAt(headEnd - 1);
  const headLow = reasoning.charCodeAt(headEnd);
  if (headHigh >= 0xd800 && headHigh <= 0xdbff && headLow >= 0xdc00 && headLow <= 0xdfff) headEnd -= 1;

  let tailStart = originalChars - tailChars;
  const tailHigh = reasoning.charCodeAt(tailStart - 1);
  const tailLow = reasoning.charCodeAt(tailStart);
  if (tailHigh >= 0xd800 && tailHigh <= 0xdbff && tailLow >= 0xdc00 && tailLow <= 0xdfff) tailStart -= 1;

  const retainedChars = headEnd + (originalChars - tailStart);
  const omitted = originalChars - retainedChars;
  const marker = `\n\n[...${omitted} characters of reasoning omitted...]\n\n`;
  const text = `${reasoning.slice(0, headEnd)}${marker}${reasoning.slice(tailStart)}`;

  // For reasoning just past the
  // threshold, the omitted-count marker text can be longer than what the trim
  // actually removed, so `text` comes out LONGER than `reasoning` despite
  // `applied: true` — the opposite of the goal. Checked against the real
  // built length, not the theoretical `headChars + tailChars` sum the branch
  // above already guards — same "nothing to gain, don't pretend to" contract.
  if (text.length >= originalChars) {
    return { text: reasoning, applied: false, originalChars, retainedChars: originalChars };
  }

  return { text, applied: true, originalChars, retainedChars };
}

/**
 * Never reserve more than half the window: on a small-window model a fixed 16k
 * reserve would refuse every review outright, blaming an input that would
 * comfortably have fit.
 */
export function reserveFor(contextLength, requested) {
  // An explicit --max-tokens is honoured verbatim, and nothing downstream raises
  // it, so it is the one path that can ask for a reply too small to hold the
  // schema it is about to be sent. Refused here rather than silently
  // over-committed: the caps would clamp to their floor and the request would go
  // out advertising room the budget cannot pay for.
  if (requested) {
    if (requested < MIN_REVIEW_RESERVE_TOKENS) {
      throw new UserError(
        `--max-tokens ${requested} is below the ${MIN_REVIEW_RESERVE_TOKENS} a review reply needs for its findings and a usable amount of reasoning.`,
        { hint: `Raise --max-tokens to at least ${MIN_REVIEW_RESERVE_TOKENS}, or use /oai:task for a smaller question.` },
      );
    }
    return requested;
  }
  if (!contextLength) return REVIEW_UNKNOWN_WINDOW_TOKENS;
  // **Deliberately not floored at `MIN_REVIEW_RESERVE_TOKENS`, unlike the branch
  // above** — an asymmetry worth stating, because it otherwise reads as the
  // guard being armed on one path and forgotten on the other, which is this
  // repo's most-repeated defect and exactly what a reviewer flagged here.
  //
  // The two situations differ. An explicit `--max-tokens` too small to hold the
  // reply is a *mistake*, and refusing it costs nothing. A model whose window is
  // simply small is not a mistake, and refusing every review on it would deny
  // work that usually succeeds: measured good runs at 1,333–5,450 output
  // tokens, most of which fit a half-window reserve on an 8k model. Below
  // ~7,824 tokens of window the half-window reserve does drop under the schema's
  // minimum, and there the reply may overrun and fail loudly with
  // `finish_reason: length` — a chosen behaviour, which
  // `unparsedReply` reports with a remedy. Pinned by a test so the asymmetry
  // stays a decision.
  return Math.min(REVIEW_MAX_TOKENS, Math.floor(contextLength / 2));
}

/**
 * The system prompt, with an opaque marker ahead of it when one was asked for.
 *
 * At the head of the *system* content — the earliest text the request carries,
 * though not "token 0", since the chat template's own preamble precedes it and
 * may stay cached. A suffix would not work at all: a prefix cache reuses the
 * longest shared *prefix*, so a marker at the end leaves everything before it
 * cached. Measured: the same 56,805-token prompt reached first token in 421.7s
 * cold and 11.5s warm, and a head marker restored the cold cost.
 *
 * The prompt itself depends on whether a grammar will hold the model to it —
 * see `reviewSystemPrompt`.
 */
function systemPromptFor(cacheBuster, structuredOutput) {
  const prompt = reviewSystemPrompt({ structuredOutput });
  return cacheBuster ? `cache-buster ${cacheBuster}\n\n${prompt}` : prompt;
}

/**
 * The parts of the request that do not change between ladder rungs. Lifted out
 * of `requestFindings` at the function size budget.
 */
function sharedRequest(profile, plan) {
  return {
    profile,
    model: plan.model,
    contextLength: plan.contextLength,
    maxTokens: plan.reserve,
    minReserve: REVIEW_MIN_TOKENS,
    system: systemPromptFor(plan.cacheBuster, plan.structuredOutput),
    oversizeHint:
      'Review a smaller target — a single commit with --commit, a narrower range with --base, or ' +
      'specific files with --file — or raise the model context length in the server and config.',
  };
}

/**
 * The reply envelope carried on a post-hoc review failure — the subset of a
 * reply `errorReport` reads back: `reasoning`/`content` for its `partial` field
 * and `usage` for its reasoning witness (`reasoningWitness` reads `usage` as a
 * validated number, never serialized raw). One builder for all three throw
 * branches so a field rides the envelope once rather than being added at each
 * site in lockstep — the drift the witness's own `usage` addition would have
 * risked, silent because a missed site reads an honest-looking `unknown`.
 */
function replyEnvelope(result) {
  return { reasoning: result.reasoning, content: result.content, usage: result.usage };
}

/**
 * The tagged error for a clean stream that never left its reasoning channel —
 * shared by both places that reject that shape (`unconstrained()`'s own
 * request and `attemptSalvage`'s follow-up) so the two never drift into two
 * wordings for the same failure, and so both can hand the same object to
 * `result.markUnanswered()` before using it.
 */
function reasoningOnlyFailure(profile, result) {
  const { message, hint } = reasoningOnlyRefusal(profile);
  const failure = new UserError(message, { reason: 'reasoning-only', hint });
  failure.answer = replyEnvelope(result);
  return failure;
}

/**
 * The failure a salvage follow-up's empty answer is recorded as, by the
 * reply's actual shape — mirroring `client.mjs`'s `requireAnswer` taxonomy, so
 * a `finish_reason: 'length'` follow-up is never persisted as
 * `reasoning-only`, a label `isReasoningOnly` itself excludes for that finish.
 * The bare arm mints `empty-answer` — the branch positively identifies the
 * shape (an answer channel that arrived holding only whitespace), and a bare
 * `null` rendered a known cause as unclassified; deliberately not
 * `empty-completion`/`blank-completion`, whose transport semantics and
 * RETRYABLE/COMPLETION_SHAPES memberships do not apply. The server's
 * unvalidated `finish_reason` rides on `error.finishReason`, never in
 * `.message`. A truly 0-char both-channels
 * reply never reaches here — `refuseUnusable` rejects it as
 * `blank-completion` inside `chatCompletion` — so this arm's reachable shape
 * is a whitespace-only answer, which is not reasoning-only either.
 */
function salvageEmptyFailure(profile, result) {
  if (result.finishReason === 'length') {
    const failure = new UserError(
      `${profile.name} ran out of tokens before the salvage follow-up produced an answer.`,
      { reason: 'token-exhaustion' },
    );
    failure.answer = replyEnvelope(result);
    return failure;
  }
  if (isReasoningOnly(result)) return reasoningOnlyFailure(profile, result);
  const failure = new UserError(`${profile.name} returned an empty answer to the salvage follow-up.`, {
    reason: 'empty-answer',
  });
  failure.finishReason = result.finishReason ?? 'unknown';
  failure.answer = replyEnvelope(result);
  return failure;
}

/**
 * The request with no grammar behind it — the shape asked for in prose.
 *
 * **The default, and still the fallback after
 * a refused schema.** One function rather than two copies: the request is the
 * same either way, and only what must be said and recorded first differs, which
 * is what the hooks are for.
 *
 * Both hooks run INSIDE the try, and every error leaving here carries the shared
 * ledger, because `unconstrainedLadder` can refuse an oversized prompt without
 * ever reaching `answerWithRetry`.
 */
async function unconstrained({ profile, shared, ladder, send, ledger, refuse, announce }) {
  // Hoisted out of the try: a salvage attempt needs the built messages (to
  // reconstruct the follow-up), but only when the ladder itself succeeded —
  // `unconstrainedLadder` refusing an oversized prompt never reaches a stream,
  // so there is nothing to salvage and `built` stays undefined for that case.
  let built;
  try {
    // Predicted to be negotiation, settled as such only once the replacement
    // exists — `refuseLast` registers, `ledger.begin` decides. Two
    // things after it can stop the replacement being sent (an oversized prompt,
    // the wall-clock cap), and in both the entry must stay a `shape-rejected`
    // failure rather than a run that died dressed as benign negotiation.
    refuse?.();

    // The instruction has to fit the window too, so the guard runs again —
    // *before* the retry is announced. Announcing first meant a guard refusal
    // arrived right after "Retrying without it", blaming the user's diff size
    // for a request that was never sent and a retry that never happened.
    built = unconstrainedLadder(shared, ladder);

    // Said out loud: a silent retry would hide a schema this plugin got wrong
    // just as well as it hides a server that cannot take one.
    announce?.();
    // `reasoningReserveTokens` is passed HERE, not added to `send` — `send` is
    // also spread into `trySalvage`'s own follow-up call below, which must
    // never carry it — re-arming the watchdog against the follow-up's
    // own small budget could cut the salvage attempt off before it concludes.
    const result = await chatCompletion(profile, {
      ...send,
      maxTokens: built.reserve,
      reasoningReserveTokens: armedReserve(built.reserve),
      messages: built.messages,
    });
    // A clean stream that never left its reasoning channel is not a transport
    // or budget failure — chatCompletion succeeded — but it is not an answer
    // either. Thrown here, not returned, so it lands in THIS function's own
    // catch below where `built` is already in scope for a salvage attempt,
    // exactly like `deadline-timeout`/`token-reserve-cutoff`. Never applies to
    // the `--structured-output` path: under a response_format grammar the
    // reasoning channel legitimately carries the answer (see `client.mjs`'s
    // `requireAnswer` docstring), so that branch has no counterpart check.
    if (isReasoningOnly(result)) {
      const failure = reasoningOnlyFailure(profile, result);
      // The ledger already closed this physical attempt `answered` (`settle()`
      // ran inside `chatCompletion` before this check ever saw the result) —
      // reclassify it now, before the failure propagates, or a run that
      // later succeeds on a later attempt ends up with two `answered`
      // entries in one `attempts[]` array. The same reclassification
      // `attemptSalvage` below applies to a losing salvage attempt.
      result.markUnanswered(failure);
      throw failure;
    }
    return { result, structured: false, ...built };
  } catch (fallbackError) {
    // Salvage tier 2: at most two bounded attempts (trimmed, then untrimmed
    // once — see `trySalvage`'s own docstring for why) to conclude from
    // whatever reasoning the deadline cut short, before giving up. `built` is
    // undefined when the ladder itself refused (nothing streamed, nothing to
    // salvage).
    const salvaged = built ? await trySalvage(profile, built, built.schema, shared, send, fallbackError) : null;
    if (salvaged) return salvaged;
    throw withLedger(fallbackError, ledger);
  }
}

/**
 * How long a salvage follow-up gets, once. Sized for "conclude now", not
 * "review the commit" — the estimate is ~2-4 minutes given
 * prefill-is-cheap economics (the original system+user turns should hit the
 * server's prefix cache, so only the new turns cost fresh compute). Generous
 * headroom over that estimate, not a measured ceiling: a fixed constant for
 * now rather than a flag, since nothing has asked to tune it yet.
 */
const SALVAGE_MAX_MS = 300_000;

/**
 * The smallest reasoning worth paying a follow-up request for. Below this a
 * "conclude now" ask is unlikely to have anything real to conclude from.
 */
const SALVAGE_MIN_REASONING_CHARS = 500;

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
 * it off — closer to the actual defect than the framing is. At 12x
 * SALVAGE_MIN_REASONING_CHARS (500), well above the floor for even
 * attempting salvage at all.
 *
 * Named risk, unresolved: a fixed trim can discard the one span — likely
 * mid-transcript — that anchors the eventual finding. Not measured against a
 * head+tail shape yet, only against feeding back everything; this is the
 * first trial, and TOKEN_RESERVE_TOKENS/SALVAGE_MAX_MS stay unchanged so
 * transcript size is the only variable it isolates.
 *
 * That isolation claim was
 * already weaker than stated, and the untrimmed fallback (see `trySalvage`)
 * makes it weaker still. Head+tail trimming changes both how much AND which
 * content survives, so a trim failure alone can't distinguish "size was the
 * lever" from "the discarded middle held the answer" — and now that a
 * fallback exists, a trim SUCCESS is ambiguous too, between "the trim rescued
 * it" and "the untrimmed fallback rescued it after the trim failed". Reading
 * a run's own `salvageTrim.applied` is the only way to tell which happened;
 * the 25/75 head/tail split itself remains a stated, unmeasured choice, not a
 * derived one beyond the total budget. No clean size-only isolation exists in
 * this design.
 */
const SALVAGE_TRIM_HEAD_CHARS = 1_500;
const SALVAGE_TRIM_TAIL_CHARS = 4_500;

/**
 * The two failure reasons whose salvage reserve is already the smaller flat
 * TOKEN_RESERVE_TOKENS (see salvageReserve below) — and the
 * only two whose fed-back reasoning gets trimmed. `deadline-timeout` keeps
 * both its full built.reserve and its full untouched reasoning: that
 * combination was never observed failing to rescue in the measured data, so
 * it is deliberately left alone rather than changed on the same trial as the
 * other two. One Set, reused by both branches, so the two decisions cannot
 * silently drift apart.
 */
const SALVAGE_SMALL_RESERVE_REASONS = new Set(['token-reserve-cutoff', 'reasoning-only']);

/**
 * The reasons `trySalvage` will attempt to recover from
 * (`deadline-timeout`, `token-reserve-cutoff`, `reasoning-only`). The first
 * two leave the model actively working when the cut happens; `reasoning-only`
 * is discovered post-hoc — the stream already finished cleanly — but the same
 * logic applies: real reasoning exists, the model simply never transitioned to
 * an answer, and a "conclude now" ask can plausibly still answer it.
 * `idle-timeout` and a raw transport drop mean the SERVER stalled or died;
 * asking it to continue is asking the thing that already stopped answering.
 */
const SALVAGE_REASONS = new Set(['deadline-timeout', 'token-reserve-cutoff', 'reasoning-only']);

/**
 * One physical salvage follow-up: build the messages carrying `reasoningText`
 * back as the model's own prior assistant turn, check the grown prompt
 * against the window, and send it. Extracted out of `trySalvage` so it can
 * be called twice — trimmed, then untrimmed
 * on the trimmed attempt's failure — with each call computing its own
 * `budget`/`estimatedTokens` via its own `checkContextBudget`/`estimateTokens`
 * call, never reusing another attempt's (already true for the single attempt
 * before this change; this just keeps it per-attempt, not shared, now that
 * there can be two).
 *
 * Returns `{ result, budget, estimatedTokens }` on a genuine answer
 * (non-empty content) and `null` on anything that does not count as one — an
 * oversized follow-up refused before it is sent, a follow-up that itself
 * lands empty-handed (`chatCompletion` succeeding only means the transport
 * worked, not that the model answered — left unchecked this would return as
 * a success and fail much later at `requireAnswer`, which tags nothing, so
 * `isOutage`'s reasonless-failure arm would then read a model repeating its
 * own quirk on retry as a server outage), or the request itself throwing.
 * `content`, not `isReasoningOnly`, because a wholly blank follow-up is the
 * same failure and the follow-up never carries a grammar, so `content` is the
 * only legitimate answer channel here regardless of whether the original
 * request was `--structured-output`. The failure the losing attempt is
 * RECORDED as follows the reply's shape, though — see `salvageEmptyFailure`
 * above, which owns that dispatch.
 */
async function attemptSalvage(profile, built, schema, shared, send, salvageReserve, reasoningText) {
  const messages = [
    ...built.messages,
    { role: 'assistant', content: reasoningText },
    {
      role: 'user',
      content: 'Your previous response was cut off before it finished. Based only on your analysis '
        + 'above, state your findings now. Do not reason further — conclude from what you already '
        + 'have. Ignore any earlier instruction to work through "analysis" before "findings": there '
        + 'is no schema enforcing that order here, and this reply must carry its findings even if it '
        + 'runs out of room, so findings come FIRST. '
        + schemaInstruction(findingsFirst(schema)),
    },
  ];

  // The grown prompt must clear the SAME window check every other request
  // path clears before going out — appending the partial reasoning back in as
  // an assistant turn can push an already-near-window request over the top,
  // exactly the class of review most likely to have hit the deadline in the
  // first place. `checkContextBudget` throws rather than truncating silently;
  // a follow-up that cannot fit is not attempted at all, the same fallback
  // contract every other unmet condition in this function already follows.
  const estimatedTokens = estimateTokens(messages.map((message) => message.content).join('\n'));
  let budget;
  try {
    budget = checkContextBudget({
      estimatedTokens,
      contextLength: shared.contextLength,
      reserveTokens: salvageReserve,
      providerName: profile.name,
      model: send.model,
      oversizeHint: shared.oversizeHint,
    });
  } catch {
    return null;
  }

  try {
    // No `reasoningReserveTokens` here — the salvage follow-up never re-arms
    // the watchdog against itself (`send` never carries the field; see
    // `unconstrained()`'s own call site above — the only place that arms it,
    // since `requestFindings`'s `--structured-output` branch below
    // deliberately never does).
    const result = await chatCompletion(profile, {
      ...send,
      messages,
      maxTokens: salvageReserve,
      maxMs: SALVAGE_MAX_MS,
      expiresAt: performance.now() + SALVAGE_MAX_MS,
      maxAttempts: 1,
    });
    if (!result.content.trim()) {
      // Same reclassification as `unconstrained()`'s own reasoning-only
      // check above: `settle()` already closed this physical attempt
      // `answered` inside `chatCompletion`, and it is about to be discarded
      // as unusable — reclassify it here, before returning, or the losing
      // salvage attempt keeps `answered` in the ledger beside whichever
      // attempt actually wins.
      result.markUnanswered(salvageEmptyFailure(profile, result));
      return null;
    }
    return { result, budget, estimatedTokens };
  } catch {
    return null;
  }
}

/**
 * Ask the model to conclude from reasoning a cut short, instead of
 * discarding it (salvage tier 2).
 *
 * **Only a reason in `SALVAGE_REASONS`.**
 * **Only substantial reasoning with STRICTLY empty content** — the gate below
 * trims content first and disqualifies anything left over, however short —
 * matching the documented
 * majority shape (findings JSON is emitted only after reasoning completes, per
 * measurement: 87-98% of every completion is reasoning). A cut mid-CONTENT is
 * a different, rarer shape — resuming a
 * truncated JSON array reliably is a harder prompting problem than
 * "conclude from pure reasoning", and is deliberately not attempted here;
 * tier 1 still preserves that answer on the ordinary failure path.
 *
 * **At most two attempts, never recursed further: trimmed, then untrimmed
 * once.** The trimmed follow-up regressed the one known-working case —
 * confirmed by direct replay — so a trimmed attempt's failure
 * gets exactly one further attempt with the reasoning fed back untouched
 * (the reasoning exactly as an untrimmed salvage always sent it), but only when trimming actually removed
 * something (`trim.applied` — nothing to fall back from otherwise, and
 * `deadline-timeout`'s own attempt is already untrimmed, so this never fires
 * for it). A failure of both attempts (or of the single attempt when
 * trimming never applied) is swallowed — `null` — and the caller falls back
 * to reporting the ORIGINAL `fallbackError`, whose `.answer` (tier 1) is
 * untouched by any of this having been tried and failed.
 *
 * **Worst-case cost, stated plainly:** a case that fails both attempts now
 * spends up to 2×`SALVAGE_MAX_MS` (600s) rather than 300s on the salvage
 * phase alone, on top of the original request. Accepted — the alternative
 * (no fallback) is the regression this amendment measured directly.
 *
 * Returns a result shaped like `unconstrained`'s own success return, tagged
 * `salvaged: true` so nothing downstream can mistake this for an ordinary
 * complete review — `jsonReport` reads that flag explicitly. `result`,
 * `budget` and `estimatedTokens` on that return are ALL sourced from the
 * SAME `attemptSalvage` bundle — whichever attempt's `result.content` was
 * actually non-empty and so became the answer — never a mix between the
 * trimmed attempt's numbers and the fallback's: `checkContextBudget` can pass
 * for both attempts (the trimmed one included, even though it goes on to
 * return empty content), so "whichever check succeeded" does not by itself
 * pin one attempt once there are two. `salvageTrim.applied` and
 * `salvageTrim.retainedChars` are set from the WINNING bundle's own
 * situation too: `retainedChars` is `trim.retainedChars` when the trimmed
 * attempt won, and `originalChars` — the model received the full untrimmed
 * text — when the fallback did.
 *
 * **`schema` is the follow-up turn's OWN source of truth for the shape, never
 * an assumption that `built.messages` already stated it.** The
 * `unconstrained()` call site's `built` always does (`unconstrainedLadder`
 * appends the same instruction to every rung, schema or no). The
 * `--structured-output` call site does not: its first request relies purely
 * on the `response_format` grammar, which is not text the model can see or
 * recall on a later turn — and reusing that rung's own `schema` here, rather
 * than growing that rung's messages to state it up front, is what avoids
 * resizing a request every other window-budget test is tuned against.
 *
 * **Always findings-first, and said explicitly enough to override whatever the
 * inherited system turn said.** `built.messages`/`first.messages`'
 * unchanged system turn may be `ANALYSIS_FIRST` (`review.mjs`) — the ordering a
 * grammar-constrained rung needs, because that model has no scratchpad of its
 * own. This follow-up sends no grammar at all, so that reasoning does not
 * apply here, but the instruction that assumed it is still sitting in the
 * conversation. Silently embedding a findings-first schema without addressing
 * that would leave two contradictory orderings in one prompt, and a real model
 * is not guaranteed to prefer the later one — it could re-run the very
 * open-ended analysis this follow-up exists to cut short. So the ordering is
 * named and reversed out loud, not left for the model to reconcile.
 */
async function trySalvage(profile, built, schema, shared, send, fallbackError) {
  if (!SALVAGE_REASONS.has(fallbackError?.reason)) return null;
  const reasoning = fallbackError.answer?.reasoning?.trim() ?? '';
  const content = fallbackError.answer?.content?.trim() ?? '';
  if (reasoning.length < SALVAGE_MIN_REASONING_CHARS || content.length > 0) return null;

  const trim = trimReasoning(reasoning, { apply: SALVAGE_SMALL_RESERVE_REASONS.has(fallbackError.reason) });

  // A `token-reserve-cutoff` already consumed `built.reserve - TOKEN_RESERVE_TOKENS`
  // tokens of reasoning on the ORIGINAL request — appending that reasoning back
  // into this follow-up and then re-reserving the full `built.reserve` again
  // would very likely overrun the window this exact check exists to enforce,
  // reproducing the original starvation one request later. `reasoning-only` is
  // the same shape by a different route: the model spent most or all of
  // `built.reserve` producing that reasoning before the stream ended cleanly,
  // so it gets the same small reserve. `deadline-timeout` carries no such
  // consumption and keeps its existing, previously re-verified `built.reserve`
  // ceiling unchanged. Both attempts (trimmed and, on fallback, untrimmed)
  // share this same reserve — only the fed-back reasoning text differs
  // between them.
  const salvageReserve = SALVAGE_SMALL_RESERVE_REASONS.has(fallbackError.reason)
    ? TOKEN_RESERVE_TOKENS
    : built.reserve;

  const trimmed = await attemptSalvage(profile, built, schema, shared, send, salvageReserve, trim.text);
  if (trimmed) {
    return {
      result: trimmed.result, structured: false, ...built, budget: trimmed.budget, estimatedTokens: trimmed.estimatedTokens,
      salvaged: true,
      salvageTrim: { applied: trim.applied, originalChars: trim.originalChars, retainedChars: trim.retainedChars },
    };
  }

  // Nothing to fall back from if the reasoning was never trimmed
  // in the first place — resending the identical text a second time would
  // just repeat the same failure for no gain.
  if (!trim.applied) return null;

  const fallback = await attemptSalvage(profile, built, schema, shared, send, salvageReserve, reasoning);
  if (!fallback) return null;
  return {
    result: fallback.result, structured: false, ...built, budget: fallback.budget, estimatedTokens: fallback.estimatedTokens,
    salvaged: true,
    // The model received the FULL untrimmed text on this attempt, so the
    // envelope must say so — never the stale `trim.retainedChars` (6,000)
    // computed before either attempt ran.
    salvageTrim: { applied: false, originalChars: trim.originalChars, retainedChars: trim.originalChars },
  };
}

/**
 * Ask for findings — unconstrained by default, with a grammar only on request.
 *
 * **Unconstrained is now the default:** `response_format` builds a
 * grammar whose lexer dies at ~14k generated tokens and takes the model process
 * with it, so the schema is opt-in via `--structured-output`. When it IS asked
 * for, the old fallback still stands — the retry is near-free, an unsupported
 * `response_format` being a validation error returned before any generation.
 */
export async function requestFindings(profile, plan) {
  const { model, timeoutMs, idleMs, maxMs, temperature, reserve, contextLength, target, instructions, onProgress } = plan;
  const { maxAttempts, ledger, retryDelayMs, structuredOutput, sampling, lens } = plan;
  const shared = sharedRequest(profile, plan);
  // Minted once, here, because this function is the outermost layer that can
  // retry a model call: the `response_format` catch below sends a *second*
  // completion, and each of those may itself climb the capability ladder in
  // chat.mjs. A cap handed down as a duration would be re-armed whole at every
  // one of those attempts, so `--max-seconds 600` could run for 1,800s with
  // every individual attempt honouring its cap. An instant cannot be re-armed.
  //
  // It starts when the model work starts, not when the command did, so the flag
  // bounds what it says it bounds — git collection and model resolution are
  // outside it, and the docs say so.
  const expiresAt = maxMs === undefined ? undefined : performance.now() + maxMs;
  // `ledger` rides with the budgets and is shared by BOTH completion calls
  // below, so the schema request and the degraded one after it land in one
  // record with continuous indexes rather than each starting from 1.
  // `sampling` rides on `send` deliberately: it is spread into the salvage
  // follow-up too (unlike `reasoningReserveTokens`), because the user's chosen
  // sampling settings belong to that same logical request.
  //
  // `removed` is the shared capability-negotiation state, minted ONCE here and
  // carried on `send` so every completion call that spreads `...send` — the
  // schema request, the `response_format` fallback, and its salvage follow-ups
  // (trimmed then untrimmed) — shares one Set. Without it the fallback mints a
  // fresh negotiation and re-offers a capability the schema request already had
  // refused, wasting a round trip and a slice of `--max-seconds`. Scoped to one
  // `requestFindings`, so each `runMultiPass` pass gets its own Set and stays
  // independent.
  const removed = new Set();
  const send = { model, timeoutMs, idleMs, expiresAt, maxMs, temperature, sampling, maxAttempts, retryDelayMs, ledger, removed, onProgress };
  // `lens` rides the ladder object so every consumer that spreads `...ladder` —
  // `unconstrainedLadder`'s two sizing calls, the structured `first`, and the
  // schema-rejection fallback — carries it through; `prepareLadder` composes it
  // at the tail. Only `suffix` is ever overridden downstream, never `lens`.
  const ladder = { target, instructions, windowKnown: Boolean(contextLength), lens };

  // No grammar unless one was asked for. Not a fallback here and not an error
  // path: it is what an ordinary review does now.
  if (!structuredOutput) return unconstrained({ profile, shared, ladder, send, ledger });

  const first = prepareLadder(shared, ladder);
  // Sized from the reserve this rung actually got, which is the number about to
  // go out as `max_tokens` — not from the ceiling it was capped against. The two
  // differ whenever a large input made the reserve shrink.
  const schema = reviewSchemaFor(first.reserve);
  try {
    // NEVER armed here: under a `response_format` grammar the model can never emit the token that
    // closes its own think block, so the actual findings JSON legitimately
    // arrives on the `reasoning` channel, not `content` — this is already
    // documented above `client.mjs`'s `requireAnswer` and in this repo's own
    // CLAUDE.md. The watchdog's false-trigger guard (`content.length === 0`)
    // is therefore always true throughout a structured request regardless of
    // how much real answer has been written, and arming it here would cut
    // off a reply that is actively finishing. `unconstrained()`'s own call
    // has no such ambiguity — its messages always carry a prose schema
    // instruction and the model answers on `content` — so only that path
    // opts in.
    const result = await chatCompletion(profile, {
      ...send,
      maxTokens: first.reserve,
      messages: first.messages,
      responseFormat: responseFormatFor(schema),
    });
    return { result, structured: true, schema, ...first };
  } catch (error) {
    // Salvage tier 2, same as `unconstrained`'s own catch: a
    // deadline-timeout here is a schema-constrained request that ran out of
    // time reasoning, not a rejected schema — `isFormatRejection` would never
    // be true for it, so without this the structured-output path fell straight
    // through to `throw error` and salvage never got a chance to fire for it.
    const salvaged = await trySalvage(profile, first, schema, shared, send, error);
    if (salvaged) return salvaged;
    if (!isFormatRejection(error)) throw error;
    // The whole ladder is climbed again, not just the guard: the instruction
    // makes the prompt longer, so the rung that fit a moment ago may not now.
    return unconstrained({
      profile,
      shared,
      ladder,
      send,
      ledger,
      refuse: () => ledger?.refuseLast(error),
      // The rejection detail lives on `.responseBody` now, not `.message`
      // — present by construction here, since `isFormatRejection`
      // just matched against it. Truncated: the body can run to 400 chars,
      // and this is one stderr line.
      announce: () => process.stderr.write(
        `${profile.name} rejected response_format (${error.responseBody.slice(0, 200)}). Retrying without it.\n`,
      ),
    });
  }
}
