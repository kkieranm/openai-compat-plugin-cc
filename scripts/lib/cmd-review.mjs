import { assertNoFlagsInPrompt, parseCommandLine } from './args.mjs';
import { chatCompletion, requireAnswer } from './client.mjs';
import { loadConfig, resolveProfile } from './config.mjs';
import { parseNumericOptions, prepareRequest, resolveTarget, resolveTimeout } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { collectTarget } from './git-diff.mjs';
import { renderTaskFooter } from './render.mjs';
import { buildReviewPrompt, renderFindings, REVIEW_SYSTEM_PROMPT } from './review.mjs';
import { isFormatRejection, parseFindings, responseFormatFor, REVIEW_SCHEMA, schemaInstruction } from './structured.mjs';

const REVIEW_SPEC = {
  valueFlags: ['provider', 'base-url', 'model', 'base', 'commit', 'timeout', 'max-tokens', 'temperature'],
  booleanFlags: ['staged', 'diff-only'],
  repeatableFlags: ['file'],
};

/**
 * Big, because the schema's `analysis` field is where the model does its actual
 * reasoning: one 135-line file drew 6k output tokens and was still mid-analysis.
 * A review that runs out of tokens part way returns nothing usable at all, which
 * is why this is nowhere near DEFAULT_RESERVE_TOKENS (1024) — see ADR 003.
 *
 * Raising it further was tried and rejected. The run that overran generated
 * every one of these 16,384 tokens on a 135-line file, against 5,450 / 2,521 /
 * 2,301 for the runs that finished — a runaway, not a shortfall, so more room
 * only buys a longer one. The schema's size caps are the fix (ADR 004); this
 * stays a backstop.
 */
export const REVIEW_MAX_TOKENS = 16_384;

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
  if (requested) return requested;
  if (!contextLength) return REVIEW_MAX_TOKENS;
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
async function requestFindings(profile, plan) {
  const { model, timeoutMs, temperature, reserve, contextLength, target, instructions } = plan;
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
  const send = { model, timeoutMs, temperature };
  const ladder = { target, instructions, windowKnown: Boolean(contextLength) };

  const first = prepareLadder(shared, ladder);
  try {
    const result = await chatCompletion(profile, {
      ...send,
      maxTokens: first.reserve,
      messages: first.messages,
      responseFormat: responseFormatFor(REVIEW_SCHEMA),
    });
    return { result, structured: true, ...first };
  } catch (error) {
    if (!isFormatRejection(error)) throw error;

    // The instruction has to fit the window too, so the guard runs again —
    // *before* the retry is announced. Announcing first meant a guard refusal
    // arrived right after "Retrying without it", blaming the user's diff size
    // for a request that was never sent and a retry that never happened.
    // The whole ladder is climbed again, not just the guard: the instruction
    // makes the prompt longer, so the rung that fit a moment ago may not now.
    const second = prepareLadder(shared, { ...ladder, suffix: schemaInstruction(REVIEW_SCHEMA) });

    // Said out loud: a silent retry would hide a schema this plugin got wrong
    // just as well as it hides a server that cannot take one.
    process.stderr.write(`${profile.name} rejected response_format (${error.message}). Retrying without it.\n`);
    const result = await chatCompletion(profile, { ...send, maxTokens: second.reserve, messages: second.messages });
    return { result, structured: false, ...second };
  }
}

function reportFindings(parsed, { result, structured, profile, model, target, hunksOnly }) {
  if (parsed) {
    process.stdout.write(
      renderFindings(
        { ...parsed, hunksOnly, unreadable: target.unreadable },
        { label: target.label, provider: profile.name, model },
      ),
    );
    return;
  }
  // A reply we cut off mid-object is a token-budget problem, not a shape
  // problem. Showing the fragment and calling it a bad shape blames the model
  // for damage we did, and hides the one flag that fixes it.
  if (result.finishReason === 'length') {
    throw new UserError(`${profile.name} ran out of tokens before it finished writing its findings.`, {
      hint: 'Raise --max-tokens, or review a smaller target — the model reasons at length before reporting.',
    });
  }

  // Nothing parseable. Under a schema the reasoning channel carries the
  // constrained output, so it is legitimate to show; without one it is only the
  // model's scratchpad. Either way an empty reply falls through to
  // requireAnswer, which refuses — printing an empty "verbatim" block would
  // report a run that produced nothing as one that merely said something odd.
  const constrained = structured ? result.content.trim() || result.reasoning.trim() : '';
  const text = constrained || requireAnswer(result, profile).trim();
  process.stdout.write(
    `The model did not return findings in the requested shape. Its reply, verbatim:\n\n${text}\n\n` +
      'Nothing here has been checked against the code.',
  );
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

  const { result, structured, budget, estimatedTokens, hunksOnly } = await requestFindings(profile, {
    model,
    contextLength,
    target,
    instructions,
    reserve,
    temperature,
    timeoutMs: resolveTimeout(profile, timeoutSeconds),
  });

  reportFindings(parseFindings(result, { structured }), { result, structured, profile, model, target, hunksOnly });
  process.stdout.write(
    `${renderTaskFooter({
      providerName: profile.name,
      model: result.model,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      contextNote: budget.checked ? `~${estimatedTokens} tokens sent.` : budget.note,
      finishReason: result.finishReason,
    })}\n`,
  );
}
