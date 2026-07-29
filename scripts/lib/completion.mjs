import { UserError } from './errors.mjs';

/**
 * Turning what a server sent into an answer — from streamed deltas or from a
 * whole JSON completion, through *one* accumulator.
 *
 * One, deliberately. The two paths must agree about what counts as an answer,
 * and the guard they share is load-bearing: `chatCompletion` used to reject a
 * reply where neither channel was a string, and a delta accumulator initialised
 * to `''` makes that condition unreachable. That is REPO_TRAPS instance 10
 * verbatim — `typeof content !== 'string'` satisfied by `''`, a run that
 * produced nothing printing a footer and exiting 0 — so the accumulator records
 * whether a channel was ever *seen*, separately from what it collected.
 */

export function emptyAnswer() {
  return {
    content: '',
    reasoning: '',
    // "Did any frame carry this key as a string", which is not the same question
    // as "is the accumulated text non-empty".
    sawContent: false,
    sawReasoning: false,
    model: null,
    usage: null,
    finishReason: null,
    deltas: 0,
  };
}

/**
 * One `delta` (streaming) or one `message` (whole completion) folded in.
 *
 * Returns true when the fragment carried actual text, which is what the caller
 * treats as progress. `null` is a real value here — the opening role frame sends
 * `content: null` — and must not count as having seen the channel, or the guard
 * above is disabled by the very first frame of every stream.
 */
export function applyText(answer, fragment) {
  if (!fragment) return false;
  let carried = false;
  if (typeof fragment.content === 'string') {
    answer.sawContent = true;
    answer.content += fragment.content;
    carried ||= fragment.content.length > 0;
  }
  if (typeof fragment.reasoning_content === 'string') {
    answer.sawReasoning = true;
    answer.reasoning += fragment.reasoning_content;
    carried ||= fragment.reasoning_content.length > 0;
  }
  if (carried) answer.deltas += 1;
  return carried;
}

/**
 * One `chat.completion.chunk`.
 *
 * Nothing indexes `choices[0]` unconditionally: the frame carrying `usage` has
 * `choices: []` (measured against LM Studio), and `finish_reason` arrives on a
 * different frame from the last text delta. Both are read from whichever frame
 * has them.
 */
export function applyFrame(answer, frame) {
  if (frame?.model) answer.model = frame.model;
  if (frame?.usage) answer.usage = frame.usage;
  const choice = frame?.choices?.[0];
  if (choice?.finish_reason) answer.finishReason = choice.finish_reason;
  return applyText(answer, choice?.delta);
}

/** A whole non-streamed completion, folded through the same accumulator. */
export function applyCompletion(answer, payload) {
  if (payload?.model) answer.model = payload.model;
  if (payload?.usage) answer.usage = payload.usage;
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason) answer.finishReason = choice.finish_reason;
  applyText(answer, choice?.message);
}

/**
 * The accumulated answer in the shape every caller already reads, or a refusal.
 *
 * `sawDone` matters and is not cosmetic. A stream can end cleanly at the HTTP
 * layer while the completion is truncated, and calling that a finished answer is
 * the "confident wrong answer" class: the reply looks complete, carries a normal
 * footer, and is missing its tail. A terminator or a `finish_reason` is the proof
 * it finished; text with neither is reported as cut short.
 */
export function finishAnswer(answer, { profile, requestedModel, sawDone, streamed, prefillMs = null, generationMs = null, attempts = 1 }) {
  if (!answer.sawContent && !answer.sawReasoning) {
    throw new UserError(
      `${profile.name} returned a completion with no message content (finish_reason: ${answer.finishReason ?? 'unknown'}).`,
    );
  }
  if (streamed && !sawDone && !answer.finishReason) {
    const size = answer.content.length + answer.reasoning.length;
    throw new UserError(`${profile.name} ended the stream after ${size} characters without finishing the answer.`, {
      hint: 'The connection closed early — check the server log. The reply is incomplete, so it is not being shown as one.',
    });
  }
  return {
    content: answer.content,
    reasoning: answer.reasoning,
    model: answer.model ?? requestedModel,
    usage: answer.usage,
    finishReason: answer.finishReason,
    // Measured by the transport, defaulted to null here rather than omitted: a
    // caller reading `result.prefillMs` must get "not determined" from every
    // path, including the whole-JSON one and any future caller that does not
    // pass them, not `undefined` that a `?? 0` downstream would turn into a
    // measurement nobody took.
    prefillMs,
    generationMs,
    // How many requests this one answer cost. Defaults to 1 so a caller that
    // never retried is not reported as unknown.
    attempts,
  };
}
