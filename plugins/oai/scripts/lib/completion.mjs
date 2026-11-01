import { ERROR_BODY_CHARS, UserError } from './errors.mjs';
import { BLANK_COMPLETION, EMPTY_COMPLETION, STREAM_ERROR_FRAME, STREAM_UNFINISHED } from './failure-shape.mjs';
import { declaredServedModel } from './model-identity.mjs';

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
    // The latest error the server stated, as `errorFrame` read it, unless
    // `errorSettled`: the first one at or after a `finish_reason` of `error` stays.
    serverError: null,
    errorSettled: false,
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
 * A `finish_reason` is evidence of how a reply ended only as a non-blank string;
 * a malformed value must not outrank an error the server stated.
 */
function isFinishReason(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
  const stated = errorFrame(frame);
  if (stated !== null && !answer.errorSettled) answer.serverError = stated;
  const choice = frame?.choices?.[0];
  // A later finish outranks an earlier error, and an error stated after a finish
  // reopens it.
  if (isFinishReason(choice?.finish_reason)) answer.finishReason = choice.finish_reason;
  else if (stated !== null && answer.finishReason !== 'error') answer.finishReason = null;
  // The first error stated at or after a `finish_reason` of `error` is the cause,
  // so a warning on a trailing frame cannot replace it; a later finish clears that.
  answer.errorSettled = answer.finishReason === 'error' && (answer.errorSettled || stated !== null);
  return applyText(answer, choice?.delta);
}

const ERROR_DEPTH = 8;

/**
 * Whether a value carries anything: a non-blank string, a truthy scalar, or an
 * object or array holding one. Past the depth bound a non-empty object is taken
 * as carrying something, so a hostile nesting stays cheap and a deep real error
 * is still read.
 */
function saysSomething(value, depth = 0) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object') return Boolean(value);
  if (depth >= ERROR_DEPTH) return Object.keys(value).length > 0;
  return Object.values(value).some((inner) => saysSomething(inner, depth + 1));
}

/**
 * The server's text when a frame or whole reply states an error, else null.
 *
 * Shape only, never wording. A non-array object carrying its own `error` is an
 * error frame when that error is a string or object that says something, whatever
 * else the frame carries, so a placeholder of blanks and zero values serialised on
 * every chunk of a healthy reply is no signal, nor is a number or boolean as the
 * error itself. MTPLX sends a stated error beside `choices` and a
 * `finish_reason` of `error`; LM Studio streams `{error: {message}}` with no
 * `choices`, and words a non-streamed refusal as a bare string, which `assertOk`
 * refuses on its status before it reaches here. Whether the text means anything
 * for the answer depends on whether any text arrived, which is
 * `refusalIfStated`'s and `refuseUnusable`'s question.
 */
export function errorFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  if (!Object.hasOwn(frame, 'error')) return null;
  const { error } = frame;
  if (typeof error !== 'string' && (!error || typeof error !== 'object')) return null;
  if (!saysSomething(error)) return null;
  if (typeof error === 'string') return error;
  return typeof error.message === 'string' && saysSomething(error.message) ? error.message : JSON.stringify(error);
}

/**
 * Whether this frame ends generation with a stated error: one with its own
 * `finish_reason` of `error`, or one with no `choices`. Before any text the stream
 * stops here, so nothing after it is read; after text the finished reply decides.
 * Any other error beside `choices` waits for the finished reply.
 */
export function endsGeneration(frame) {
  if (errorFrame(frame) === null) return false;
  return frame?.choices?.[0]?.finish_reason === 'error' || !Object.hasOwn(frame, 'choices');
}

/** A whole non-streamed completion, folded through the same accumulator. */
export function applyCompletion(answer, payload) {
  if (payload?.model) answer.model = payload.model;
  if (payload?.usage) answer.usage = payload.usage;
  answer.serverError = errorFrame(payload);
  const choice = payload?.choices?.[0];
  if (isFinishReason(choice?.finish_reason)) answer.finishReason = choice.finish_reason;
  applyText(answer, choice?.message);
}

/** Server-controlled detail travels off `.message`, as `assertOk` keeps it. */
function carryStated(failure, answer) {
  failure.serverResponded = true;
  if (answer.serverError !== null) failure.responseBody = answer.serverError.slice(0, ERROR_BODY_CHARS);
  if (answer.finishReason) failure.finishReason = answer.finishReason;
  return failure;
}

function hasText(answer) {
  return answer.content.length > 0 || answer.reasoning.length > 0;
}

/**
 * A stated error no finish has outranked, as bounded display text. Only a reply
 * with text can outrank one, as `refusalIfStated` and `refuseUnusable` read it.
 */
export function heldError(answer) {
  if (hasText(answer) && answer.finishReason && answer.finishReason !== 'error') return undefined;
  return answer.serverError?.slice(0, ERROR_BODY_CHARS);
}

/**
 * The refusal an answer amounts to when the server stated an error and no text
 * had arrived on either channel, else null. Asked of a stream frame that
 * `endsGeneration`, so the refusal ends the stream, and of the finished reply by
 * `refuseUnusable`, which is where a bare `finish_reason` of `error` is judged: an
 * envelope may yet follow it.
 */
export function refusalIfStated(answer, name) {
  if (hasText(answer)) return null;
  if (answer.serverError === null && answer.finishReason !== 'error') return null;
  return carryStated(new UserError(`${name} reported an error before any text, inside a successful response.`, {
    hint: 'The server stated an error with no text received, so this reply was not retried.',
    reason: STREAM_ERROR_FRAME,
  }), answer);
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
    // The id the provider's `servedModelIds` declares this server reports for
    // `requestedModel`, or null. Carried together with the pair so every
    // `substitution()` caller has all three.
    declaredServedModel: declaredServedModel(profile, requestedModel),
    usage: answer.usage,
    finishReason: answer.finishReason,
    prefillMs,
    generationMs,
    requestCount,
  };
}

/**
 * The shapes in which a completion is not an answer, refused in order.
 *
 * Split out of `finishAnswer` at the function size budget, and the seam is real:
 * these decide whether there is an answer at all, while the caller assembles one.
 * The ORDER is behaviour and must not be rearranged — each refusal names a
 * different thing that went wrong, and a reply matching two of them should be
 * reported as the earlier, more specific one.
 */
function refuseUnusable(answer, { profile, sawDone, streamed }) {
  const refusal = refusalIfStated(answer, profile.name);
  if (refusal !== null) throw refusal;
  // With text, a finish reason outranks an error stated with it or before it, so
  // a warning beside a finished reply stays a reply. A bare envelope decides only
  // when no finish reason stands.
  if (answer.finishReason === 'error' || (!answer.finishReason && answer.serverError !== null)) {
    const size = answer.content.length + answer.reasoning.length;
    const failure = carryStated(new UserError(`${profile.name} reported an error during the reply (${size} characters received).`, {
      hint: 'The server stated an error, so the reply is not being shown as a finished answer.',
      reason: STREAM_UNFINISHED,
    }), answer);
    failure.answer = answer;
    throw failure;
  }
  if (!answer.sawContent && !answer.sawReasoning) {
    // `answer.finishReason` is a string the server chose
    // (completion.mjs's applyFrame/applyCompletion) and could
    // carry a secret-shaped value, so it travels on `.finishReason`, never
    // inside `.message`. `transportDetail()`
    // (provider.mjs) composes it for display.
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
  // Last, and only last. A reply that never had a channel and a truncated stream
  // are refused above; this is the one that *finished*, presented a channel, and
  // put nothing in it.
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
