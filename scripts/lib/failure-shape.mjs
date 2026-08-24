/**
 * The shapes in which a request dies without the model having said no — and
 * which of them are worth sending again.
 *
 * Measured, not guessed. Across four full-corpus benchmark invocations,
 * **27 of 72 runs died server-side (37.5%)**, on both a dense 27B
 * and an MoE 35B-A3B — so the locus is LM Studio's shared serving path rather
 * than either model. Every one of them was a failure of *delivery*: an empty
 * completion, or a stream closed part-way through reasoning. None was a refusal,
 * a timeout, or a bad answer.
 *
 * A code, never a phrase. This repo has the prose-matching defect class on file
 * twice over: a matcher reading a server's wording
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

/**
 * A transport failure a second attempt could plausibly survive. Tagged by the
 * transport (`http.mjs`).
 *
 * **Not** "the server dropped it", and the difference is load-bearing for the
 * reliability figure this vocabulary feeds. It covers the connection closing
 * mid-body — the shape it was named for — but also the *pre-response* failures
 * below whose code says "try again": a DNS server answering `EAI_AGAIN` carried
 * no response at all, and neither party is at fault. The axis is retryability,
 * never blame, so nothing downstream may read a `transport` tally as a count of
 * server misbehaviour.
 */
export const TRANSPORT = 'transport';

/**
 * A pre-response transport failure this client does not recognise as transient.
 *
 * Named for the decision it records, after a first draft called it `unreachable`
 * and was refuted: `request.on('error')` before headers carries TLS certificate
 * rejections and protocol and parser errors — each fired by bytes a peer sent —
 * beside failures with no `code` at all, which establish nothing either way.
 * "Unreachable" would have asserted a fact the classification never
 * established, which is the exact defect class the module note above exists to
 * keep out. So the name says what was decided and the reader takes `.code` for
 * the rest.
 */
export const NON_RETRYABLE_TRANSPORT = 'non-retryable-transport';

/**
 * The pre-response failure codes worth another attempt.
 *
 * A whitelist, in the same direction and for the same reason as `RETRYABLE`
 * below: an unrecognised code costs one honest request rather than three
 * misleading ones, and a future Node version that stops populating `code` on a
 * permanent failure degrades to "not retried" rather than to a doomed loop.
 *
 * `ENOTFOUND` and `ECONNREFUSED` are the deliberate exclusions. Both will fail
 * identically on every attempt, and `http-errors.mjs` already hangs the
 * provider-specific *start your server* hint off the code — so retrying only
 * delays the message that helps by ~4 seconds, while filing three phantom
 * failures against a server that was never running.
 */
export const TRANSIENT_CONNECT_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNABORTED',
  // DNS's own "temporary failure, ask again" — the one resolver answer that
  // says a retry is the correct response.
  'EAI_AGAIN',
]);

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
