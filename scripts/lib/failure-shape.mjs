/**
 * The shapes in which a request dies without the model having said no — and
 * which of them are worth sending again.
 *
 * Measured, not guessed. Across four full-corpus benchmark invocations on
 * 2026-07-30, **27 of 72 runs died server-side (37.5%)**, on both a dense 27B
 * and an MoE 35B-A3B — so the locus is LM Studio's shared serving path rather
 * than either model. Every one of them was a failure of *delivery*: an empty
 * completion, or a stream closed part-way through reasoning. None was a refusal,
 * a timeout, or a bad answer. See ADR 012 and BACKLOG.md OAI-20.
 *
 * A code, never a phrase. This repo has the prose-matching defect class on file
 * twice over (OAI-13 items 1 and 2): a matcher reading a server's wording
 * asserts a cause it only guessed, and one vendor rewording its error text turns
 * a retry into a silent no-op. So each shape is tagged where it is *detected* —
 * by the code that already knows what it saw — and every consumer reads the tag.
 */

/** Neither text channel was ever present. The reply carried no message at all. */
export const EMPTY_COMPLETION = 'empty-completion';

/**
 * Text arrived, then the stream stopped without a terminator or a `finish_reason`.
 * Clean at the HTTP layer, truncated as an answer.
 */
export const STREAM_UNFINISHED = 'stream-unfinished';

/**
 * Both channels were present and both were exactly empty.
 *
 * The subtle one, and the reason it needed finding rather than remembering:
 * `applyText` sets `sawContent` for **any** string including `''`, so a reply of
 * `content: ""` passes the two checks above and reaches the caller looking like a
 * successful completion. `/oai:review` then reported "the model did not return
 * findings in the requested shape" and the benchmark filed it as *unreadable* —
 * a dead request recorded as a bad answer, which is the censored-denominator
 * trap one layer down from where this repo already caught it.
 */
export const BLANK_COMPLETION = 'blank-completion';

/** The connection closed mid-body. Tagged by the transport (`http.mjs`). */
export const TRANSPORT = 'transport';

/**
 * The shapes a second attempt could plausibly fix.
 *
 * A whitelist, not a blacklist, and that direction is the whole safety property:
 * an unrecognised failure is *not* retried, so a new failure mode costs one
 * request and an honest error rather than three requests and a misleading one.
 * Notably absent: every budget timeout (the server is slow, not broken — sending
 * the same request again just spends the remaining cap), every 4xx refusal (the
 * request is wrong and will be wrong again), and `oversize` (a size ladder
 * already owns that, and re-sending unchanged input cannot help).
 */
const RETRYABLE = new Set([EMPTY_COMPLETION, STREAM_UNFINISHED, BLANK_COMPLETION, TRANSPORT]);

/**
 * The shapes detected AFTER bytes arrived — the server produced a reply document
 * and `finishAnswer` judged it unusable.
 *
 * Separate from the transport shape because the difference is evidence: these
 * prove the prompt was read and processed, which is what decides whether an
 * identical retry could be served from the server's prompt cache.
 */
export const COMPLETION_SHAPES = new Set([EMPTY_COMPLETION, STREAM_UNFINISHED, BLANK_COMPLETION]);

/** Is this failure one a fresh attempt could plausibly survive? */
export function isRetryable(error) {
  return RETRYABLE.has(error?.reason);
}
