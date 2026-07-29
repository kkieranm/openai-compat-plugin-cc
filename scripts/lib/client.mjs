import { readJson } from './body.mjs';
import { postWithDegrade } from './chat.mjs';
import { finishAnswer } from './completion.mjs';
import { UserError } from './errors.mjs';
import { authHeaders, request } from './provider.mjs';

export { authHeaders };

/**
 * The first-token budget. Raised from 300s on measurement, not taste: a
 * cache-busted 52k-token prompt took 393.7s to its first token on the author's
 * machine (~132 tok/s of prefill), and the benchmark corpus's largest case is
 * bigger still, projecting to ~485s. See ADR 007.
 */
export const DEFAULT_TIMEOUT_MS = 600_000;

/** The gap between tokens once output has started. Short, because it means a stall. */
export const DEFAULT_IDLE_MS = 60_000;

/** Control-plane calls are bounded totals, so a slow drip cannot hold setup open. */
const MODELS_TIMEOUT_MS = 10_000;

/**
 * The raw /v1/models payload. Returned whole rather than as ids, because vLLM
 * carries the served context length on the same objects (see model-info.mjs).
 */
export async function fetchModels(profile, { timeoutMs = MODELS_TIMEOUT_MS } = {}) {
  const response = await request(profile, '/models', { firstByteMs: timeoutMs, totalMs: timeoutMs });
  return readJson(response, profile.name);
}

/**
 * One chat completion, streamed.
 *
 * Both text channels are returned. A reasoning model can leave `content` empty
 * and put everything in `reasoning_content` — under a constrained grammar it
 * always does, because it can never emit the token that closes its think block
 * (ADR 003). Which channel is legitimate depends on what was asked for, so that
 * decision belongs to the caller, not here.
 */
export async function chatCompletion(profile, options) {
  const { model, messages, temperature, maxTokens, responseFormat, onProgress } = options;
  const firstTokenMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const body = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (responseFormat !== undefined) body.response_format = responseFormat;

  // Streaming and stream_options are new demands on servers that worked before,
  // and a strict one refusing either would fail every request from here on. So
  // each gets a rung on the degrade ladder already proven beside it for
  // response_format. Losing `usage` costs a token count; failing costs the run.
  //
  // A loop, not two nested catches: a server can refuse *both*, and the first
  // shape of this returned the second rung's retry from inside the first rung's
  // catch — so a `stream` rejection arriving after `stream_options` had been
  // dropped escaped with no fallback at all. Each capability is removed at most
  // once, which is also what bounds the loop.
  const result = await postWithDegrade(profile, body, { firstTokenMs, idleMs, onProgress });
  return finishAnswer(result.answer, {
    profile,
    requestedModel: model,
    sawDone: result.sawDone,
    streamed: result.streamed,
    prefillMs: result.prefillMs,
    generationMs: result.generationMs,
    attempts: result.attempts,
  });
}

/**
 * The answer to an unconstrained request, or a loud failure.
 *
 * There is deliberately no fallback to `reasoning` here. That text is the
 * model's scratchpad, not its reply: printing it would present working-out as
 * an answer, which is exactly the "reported state must describe what will
 * actually happen" class this repo keeps re-finding. A structured caller may
 * read the other channel, but only because parsing it against the schema proves
 * what it is.
 */
export function requireAnswer(result, profile) {
  if (result.content.trim()) return result.content;

  if (result.finishReason === 'length') {
    throw new UserError(
      `${profile.name} stopped at the token limit before writing an answer` +
        `${result.reasoning ? ', having spent the whole budget reasoning' : ''}.`,
      { hint: 'Raise --max-tokens (reasoning models can think for thousands of tokens before replying).' },
    );
  }
  if (result.reasoning.trim()) {
    throw new UserError(`${profile.name} returned only internal reasoning and no answer.`, {
      hint: 'Raise --max-tokens, or ask a narrower question — the model never left its reasoning channel.',
    });
  }
  throw new UserError(
    `${profile.name} returned an empty answer (finish_reason: ${result.finishReason ?? 'unknown'}).`,
    { hint: 'Try again, or check the server log — nothing was generated.' },
  );
}
