import { assertNoFlagsInPrompt, parseCommandLine } from './args.mjs';
import { chatCompletion } from './client.mjs';
import { loadConfig, resolveProfile } from './config.mjs';
import { parseNumericOptions, prepareRequest, resolveIdle, resolveTarget, resolveTimeout } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { collectTarget } from './git-diff.mjs';
import { withProgress } from './progress.mjs';
import { report } from './review-report.mjs';
import { buildReviewPrompt, REVIEW_SYSTEM_PROMPT } from './review.mjs';
import { MIN_REVIEW_RESERVE_TOKENS, REVIEW_SCHEMA, reviewSchemaFor } from './review-schema.mjs';
import { isFormatRejection, parseFindings, responseFormatFor, schemaInstruction } from './structured.mjs';

// Exported so `tests/plugin.test.js` can prove every flag this command accepts
// is documented in `commands/review.md`. The markdown is the only description a
// user ever sees, and nothing but a test notices when a flag outlives its docs.
export const REVIEW_SPEC = {
  valueFlags: ['provider', 'base-url', 'model', 'base', 'commit', 'timeout', 'max-tokens', 'temperature'],
  booleanFlags: ['staged', 'diff-only', 'json'],
  repeatableFlags: ['file'],
};

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
function reserveFor(contextLength, requested) {
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
 * Whole changed files if they fit the window, the diff alone if they do not.
 *
 * Two rungs rather than a per-file shed. The second rung is exactly the
 * behaviour that shipped before whole files existed, so it needs no manifest of
 * what was left out in order to be honest, and there is no drop order to get
 * wrong — largest-first would have shed `model-info.mjs`, the very file whose
 * absent definition produced the false positive this feature removes.
 *
 * Only `target.changed` is droppable. `target.files` is code no diff covers —
 * untracked files, or `--file` where there is no diff at all — so dropping one
 * would review nothing and report a clean pass. See ADR 005.
 */
function prepareLadder(shared, { target, instructions, windowKnown, suffix = '' }) {
  const hasDiff = Boolean(target.diff.trim());
  // Every condition the claim "you hold the complete content of every changed
  // file" depends on. `unreadable` is the one that is easy to forget: a path git
  // listed whose body would not load is absent from `changed` and leaves no
  // other trace, so without this the prompt would vouch for a file that never
  // arrived — this feature's own defect, asserted rather than merely risked.
  const build = (whole) => {
    const prompt = buildReviewPrompt({
      label: target.label,
      diff: target.diff,
      instructions,
      wholeFiles: whole && hasDiff && windowKnown && target.unreadable.length === 0,
    });
    return {
      prompt: suffix ? `${prompt}\n\n${suffix}` : prompt,
      files: whole ? [...target.files, ...target.changed] : target.files,
    };
  };

  if (target.changed.length > 0) {
    try {
      return { ...prepareRequest({ ...shared, ...build(true) }), hunksOnly: false };
    } catch (error) {
      // Only the oversize refusal is retryable by sending less; anything else
      // is a different failure and must not be laundered into "too big".
      if (error.reason !== 'oversize') throw error;
    }
  }
  // The reader's caveat is about what the model saw, not about why: no changed
  // file went whole, whether they did not fit, were not asked for, or were
  // never listed. Pinned files are unaffected — the note only ever qualifies
  // findings the diff alone had to carry.
  return { ...prepareRequest({ ...shared, ...build(false) }), hunksOnly: hasDiff };
}

/**
 * Ask for findings, degrading if the server will not take a schema.
 *
 * The retry is near-free: an unsupported `response_format` is a request
 * validation error, returned before any generation happens.
 */
/**
 * The degraded rung's messages, reserve, and the schema its instruction names.
 *
 * Circular by construction: the suffix carries the schema text, whose length
 * feeds the token estimate, which sets the reserve, which sizes the cap the
 * text states. Broken without an iteration — whose convergence nothing would
 * check — by sizing once with `REVIEW_SCHEMA`, the widest this module builds.
 * That instruction is the longest possible, so the reserve it leaves is a lower
 * bound on what the real one leaves, and a cap derived from it can only
 * under-state the room available. Wrong in the safe direction, by a bounded
 * amount, rather than merely usually right.
 *
 * Sizing it at all is the point: nothing enforces `maxLength` on this rung, so
 * the schema is advice — but advice naming a ceiling the reply budget could
 * never pay for is the same defect as a cap that over-commits, told to the model
 * instead of to the code.
 */
function degradedLadder(shared, ladder) {
  const sized = prepareLadder(shared, { ...ladder, suffix: schemaInstruction(REVIEW_SCHEMA) });
  const schema = reviewSchemaFor(sized.reserve);
  return { ...prepareLadder(shared, { ...ladder, suffix: schemaInstruction(schema) }), schema };
}

async function requestFindings(profile, plan) {
  const { model, timeoutMs, idleMs, temperature, reserve, contextLength, target, instructions, onProgress } = plan;
  const shared = {
    profile,
    model,
    contextLength,
    maxTokens: reserve,
    minReserve: REVIEW_MIN_TOKENS,
    system: REVIEW_SYSTEM_PROMPT,
    oversizeHint:
      'Review a smaller target — a single commit with --commit, a narrower range with --base, or ' +
      'specific files with --file — or raise the model context length in the server and config.',
  };
  const send = { model, timeoutMs, idleMs, temperature, onProgress };
  const ladder = { target, instructions, windowKnown: Boolean(contextLength) };

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

    // The instruction has to fit the window too, so the guard runs again —
    // *before* the retry is announced. Announcing first meant a guard refusal
    // arrived right after "Retrying without it", blaming the user's diff size
    // for a request that was never sent and a retry that never happened.
    // The whole ladder is climbed again, not just the guard: the instruction
    // makes the prompt longer, so the rung that fit a moment ago may not now.
    const second = degradedLadder(shared, ladder);

    // Said out loud: a silent retry would hide a schema this plugin got wrong
    // just as well as it hides a server that cannot take one.
    process.stderr.write(`${profile.name} rejected response_format (${error.message}). Retrying without it.\n`);
    const result = await chatCompletion(profile, { ...send, maxTokens: second.reserve, messages: second.messages });
    return { result, structured: false, ...second };
  }
}

export async function runReview(argv) {
  const { options, prompt: instructions, terminated } = parseCommandLine(argv, REVIEW_SPEC);
  if (instructions && !terminated) assertNoFlagsInPrompt(instructions, REVIEW_SPEC);
  // --file has no diff, so "the diff alone" would be nothing at all. Refusing
  // beats sending an empty review that reads as a clean pass.
  if (options['diff-only'] && options.file?.length) {
    throw new UserError('--diff-only cannot be combined with --file: there is no diff, only whole files.', {
      hint: 'Drop --diff-only to review the files, or use --commit/--base/--staged to review a diff.',
    });
  }
  const { maxTokens, temperature, timeoutSeconds } = parseNumericOptions(options);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  if (profile.credentialWithheld) {
    process.stderr.write(
      `Note: "${profile.name}" has a credential, but --base-url points at a different host, so it was not sent.\n`,
    );
  }

  const target = await collectTarget(options);
  const { model, contextLength } = await resolveTarget(profile, options);
  const reserve = reserveFor(contextLength, maxTokens);

  const startedAt = Date.now();
  process.stderr.write(`Reviewing ${target.label} with ${model} on ${profile.name}...\n`);

  // A review is the long silent run this exists for: whole-file passes measured
  // 38–245s before, and a cold prefill alone is minutes.
  const { result, structured, schema, budget, estimatedTokens, hunksOnly } = await withProgress((onProgress) =>
    requestFindings(profile, {
      model,
      contextLength,
      target,
      instructions,
      reserve,
      temperature,
      timeoutMs: resolveTimeout(profile, timeoutSeconds),
      idleMs: resolveIdle(profile),
      onProgress,
    }),
  );

  report(parseFindings(result, { structured, schema }), {
    result,
    structured,
    profile,
    model,
    target,
    hunksOnly,
    budget,
    estimatedTokens,
    durationMs: Date.now() - startedAt,
    json: Boolean(options.json),
  });
}
