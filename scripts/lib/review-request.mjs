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
import { chatCompletion } from './client.mjs';
import { UserError } from './errors.mjs';
import { reviewSystemPrompt } from './review.mjs';
import { MIN_REVIEW_RESERVE_TOKENS, reviewSchemaFor } from './review-schema.mjs';
import { prepareLadder, unconstrainedLadder } from './review-ladder.mjs';
import { isFormatRejection, responseFormatFor } from './structured.mjs';

/**
 * The ceiling on a reply budget where the window is known.
 *
 * Big, because the schema's `analysis` field is where the model does its actual
 * reasoning: one 135-line file drew 6k output tokens and was still mid-analysis.
 * A review that runs out of tokens part way returns nothing usable at all, which
 * is why this is nowhere near DEFAULT_RESERVE_TOKENS (1024) — see ADR 003.
 *
 * Raised from 16,384 on 2026-07-28, reversing ADR 004's refusal on the evidence
 * that made it. The refusal was written when nothing bounded the reply and more
 * room bought only a longer runaway; with the schema bounded it buys larger
 * caps instead. What settled it is that the cost the refusal was protecting no
 * longer exists: `prepareRequest` shrinks the reserve toward `REVIEW_MIN_TOKENS`
 * when a large input needs the window, so this number withholds nothing from the
 * input — a review is refused only when under `REVIEW_MIN_TOKENS` remain,
 * whatever this says. The half-window rule below binds first on every model in
 * use here. See ADR 008.
 */
export const REVIEW_MAX_TOKENS = 32_768;

/**
 * The reply budget where the window is *not* known — deliberately not raised.
 *
 * With no window there is no shrink and no budget check, so this number goes on
 * the wire as `max_tokens` against a server whose capacity is a guess. That is
 * already a filed defect (OAI-13 item 4, where `/oai:task` sends none at all);
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
  // work that usually succeeds: ADR 004 measured good runs at 1,333–5,450 output
  // tokens, most of which fit a half-window reserve on an 8k model. Below
  // ~7,824 tokens of window the half-window reserve does drop under the schema's
  // minimum, and there the reply may overrun and fail loudly with
  // `finish_reason: length` — the behaviour ADR 004 chose on purpose, and which
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
 * cold and 11.5s warm, and a head marker restored the cold cost. See ADR 009.
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
 * The request with no grammar behind it — the shape asked for in prose.
 *
 * **The default since 2026-08-04 (OAI-51, ADR 003), and still the fallback after
 * a refused schema.** One function rather than two copies: the request is the
 * same either way, and only what must be said and recorded first differs, which
 * is what the hooks are for.
 *
 * Both hooks run INSIDE the try, and every error leaving here carries the shared
 * ledger, because `unconstrainedLadder` can refuse an oversized prompt without
 * ever reaching `answerWithRetry`.
 */
async function unconstrained({ profile, shared, ladder, send, ledger, refuse, announce }) {
  try {
    // Predicted to be negotiation, settled as such only once the replacement
    // exists — `refuseLast` registers, `ledger.begin` decides (OAI-23). Two
    // things after it can stop the replacement being sent (an oversized prompt,
    // the wall-clock cap), and in both the entry must stay a `shape-rejected`
    // failure rather than a run that died dressed as benign negotiation.
    refuse?.();

    // The instruction has to fit the window too, so the guard runs again —
    // *before* the retry is announced. Announcing first meant a guard refusal
    // arrived right after "Retrying without it", blaming the user's diff size
    // for a request that was never sent and a retry that never happened.
    const built = unconstrainedLadder(shared, ladder);

    // Said out loud: a silent retry would hide a schema this plugin got wrong
    // just as well as it hides a server that cannot take one.
    announce?.();
    const result = await chatCompletion(profile, { ...send, maxTokens: built.reserve, messages: built.messages });
    return { result, structured: false, ...built };
  } catch (fallbackError) {
    throw withLedger(fallbackError, ledger);
  }
}

/**
 * Ask for findings — unconstrained by default, with a grammar only on request.
 *
 * **The default flipped on 2026-08-04 (OAI-51):** `response_format` builds a
 * grammar whose lexer dies at ~14k generated tokens and takes the model process
 * with it, so the schema is opt-in via `--structured-output`. When it IS asked
 * for, the old fallback still stands — the retry is near-free, an unsupported
 * `response_format` being a validation error returned before any generation.
 */
export async function requestFindings(profile, plan) {
  const { model, timeoutMs, idleMs, maxMs, temperature, reserve, contextLength, target, instructions, onProgress } = plan;
  const { maxAttempts, ledger, retryDelayMs, structuredOutput } = plan;
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
  const send = { model, timeoutMs, idleMs, expiresAt, maxMs, temperature, maxAttempts, retryDelayMs, ledger, onProgress };
  const ladder = { target, instructions, windowKnown: Boolean(contextLength) };

  // No grammar unless one was asked for. Not a fallback here and not an error
  // path: it is what an ordinary review does now.
  if (!structuredOutput) return unconstrained({ profile, shared, ladder, send, ledger });

  const first = prepareLadder(shared, ladder);
  // Sized from the reserve this rung actually got, which is the number about to
  // go out as `max_tokens` — not from the ceiling it was capped against. The two
  // differ whenever a large input made the reserve shrink.
  const schema = reviewSchemaFor(first.reserve);
  try {
    const result = await chatCompletion(profile, {
      ...send,
      maxTokens: first.reserve,
      messages: first.messages,
      responseFormat: responseFormatFor(schema),
    });
    return { result, structured: true, schema, ...first };
  } catch (error) {
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
      announce: () => process.stderr.write(
        `${profile.name} rejected response_format (${error.message}). Retrying without it.\n`,
      ),
    });
  }
}
