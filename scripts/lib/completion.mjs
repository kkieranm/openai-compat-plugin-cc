import { UserError } from './errors.mjs';
import { BLANK_COMPLETION, EMPTY_COMPLETION, STREAM_UNFINISHED } from './failure-shape.mjs';

/**
 * Turning what a server sent into an answer — from streamed deltas or from a
 * whole JSON completion, through *one* accumulator.
 *
 * One, deliberately. The two paths must agree about what counts as an answer,
 * and the guard they share is load-bearing: `chatCompletion` used to reject a
 * reply where neither channel was a string, and a delta accumulator initialised
 * to `''` makes that condition unreachable — `typeof content !== 'string'`
 * satisfied by `''`, a run that produced nothing printing a footer and exiting
 * 0 — so the accumulator records whether a channel was ever *seen*, separately
 * from what it collected.
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

/**
 * The server's text when a streamed frame is an error envelope rather than a
 * completion chunk, else null.
 *
 * Shape only, never wording: a non-array object carrying its own `error`
 * that is a non-null object or a non-empty string, and no own `choices` key. A frame
 * with `choices` is a completion chunk whatever else it carries. The object
 * spelling is the one LM Studio streams (`{error: {message}}`); the string
 * spelling is how it words a non-streamed refusal, which never reaches here
 * (`assertOk` refuses the non-2xx first) and is accepted only so a server that
 * streams that spelling under a 200 is read the same way. Streamed frames only:
 * `applyCompletion`'s whole-body path does not consult this. Whether the text
 * means anything for the answer is the caller's question, since only it knows
 * whether generation had begun.
 */
export function errorFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  if (Object.hasOwn(frame, 'choices') || !Object.hasOwn(frame, 'error')) return null;
  const { error } = frame;
  if (typeof error === 'string') return error.length > 0 ? error : null;
  if (!error || typeof error !== 'object') return null;
  return typeof error.message === 'string' ? error.message : JSON.stringify(error);
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
export function finishAnswer(answer, { profile, requestedModel, sawDone, streamed, prefillMs = null, generationMs = null, requestCount = 1 }) {
  refuseUnusable(answer, { profile, sawDone, streamed });
  return {
    content: answer.content,
    reasoning: answer.reasoning,
    model: answer.model ?? requestedModel,
    // Whether the SERVER named a model, or this is the requested id echoed back
    // by the `??` above. Recorded because that distinction is unrecoverable
    // downstream once the fallback has happened, and a benchmark attributing
    // runs to models needs it: without this, a reply that named nothing is
    // indistinguishable from one that confirmed the id, and the run is credited
    // to a build that never said it was there.
    //
    // Additive on purpose. The `??` and its reasoning below are untouched —
    // collapsing the pair still prevents reporting a substitution nothing
    // observed, which is a different question from who answered.
    modelReported: answer.model !== undefined && answer.model !== null,
    // Carried beside what answered so the pair travels together to every
    // consumer, rather than each renderer being handed the requested id
    // separately — which is how one of the two call sites gets forgotten.
    //
    // The `??` above stays, and is not a loss: a server that never names a
    // model yields requested === served, so it cannot report a substitution
    // that nothing observed.
    requestedModel,
    usage: answer.usage,
    finishReason: answer.finishReason,
    prefillMs,
    generationMs,
    requestCount,
  };
}

/**
 * The three shapes in which a completion is not an answer, refused in order.
 *
 * Split out of `finishAnswer` at the function size budget, and the seam is real:
 * these decide whether there is an answer at all, while the caller assembles one.
 * The ORDER is behaviour and must not be rearranged — each refusal names a
 * different thing that went wrong, and a reply matching two of them should be
 * reported as the earlier, more specific one.
 */
function refuseUnusable(answer, { profile, sawDone, streamed }) {
  if (!answer.sawContent && !answer.sawReasoning) {
    // `answer.finishReason` is read straight off the server's own payload
    // (completion.mjs's applyFrame/applyCompletion, no validation) — the same
    // secret-shape risk as every other server-controlled value this feature
    // guards, so it travels on `.finishReason`, never inside
    // `.message`. `transportDetail()` (provider.mjs) composes it for display.
    const failure = new UserError(`${profile.name} returned a completion with no message content.`, {
      reason: EMPTY_COMPLETION,
    });
    failure.finishReason = answer.finishReason ?? 'unknown';
    throw failure;
  }
  if (streamed && !sawDone && !answer.finishReason) {
    const size = answer.content.length + answer.reasoning.length;
    throw new UserError(`${profile.name} ended the stream after ${size} characters without finishing the answer.`, {
      hint: 'The connection closed early — check the server log. The reply is incomplete, so it is not being shown as one.',
      reason: STREAM_UNFINISHED,
    });
  }
  // Third, and only third. A reply that never had a channel is shape one and a
  // truncated stream is shape two; this is the one that *finished*, presented a
  // channel, and put nothing in it.
  //
  // `.length`, never `.trim()`. A model answering with whitespace has answered —
  // the caller decides whether that is useful — and trimming here would delete a
  // real reply and spend two more requests failing to get it back. The test for
  // "the server delivered nothing" is that nothing is what it delivered.
  if (answer.content.length === 0 && answer.reasoning.length === 0) {
    const failure = new UserError(`${profile.name} returned an entirely empty completion.`, {
      hint: 'The channels were present but carried no characters — check the server log.',
      reason: BLANK_COMPLETION,
    });
    failure.finishReason = answer.finishReason ?? 'unknown';
    throw failure;
  }
}
