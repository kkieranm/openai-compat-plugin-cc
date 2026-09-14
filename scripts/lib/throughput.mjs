/**
 * How fast the model generated, as one definition.
 *
 * Two consumers — the human footer and the benchmark table — and one home,
 * because a rate computed twice is a rate that will eventually be computed two
 * different ways. This repo has already paid for that with a figure whose
 * evidence disagreed with itself.
 *
 * **The divisor is `generationMs`, never `durationMs`.** A server-side prompt
 * cache moves prefill by tens of times and leaves generation alone: one measured
 * 56,805-token request spent 421.7s reaching its first token and ~3s generating,
 * so dividing by the total would have reported ~7× low — and reported it lower
 * on a cold run than a warm one, which is the opposite of a throughput figure.
 *
 * **What the number is, stated exactly: provider-reported completion tokens per
 * measured generation second.** One operand is ours and one is the vendor's.
 * `usage` is passed through unvalidated by `jsonReport` precisely because its
 * contents are the server's word, and nothing here can confirm that a given
 * OpenAI-compatible server counts reasoning tokens in `completion_tokens`, or
 * counts them the same way on the streamed and non-streamed paths. So the name
 * to use for it is what was reported divided by what was measured — not "the
 * model's speed", and not a claim about what is inside the numerator.
 *
 * **The endpoints do not match exactly, and the gap is stated rather than
 * hidden.** `completion_tokens` counts every token the provider says it
 * produced, while `generationMs` runs from the first frame carrying text to the
 * end of the stream. So the first token's own generation sits in prefill and is
 * excluded from the divisor, while any latency after the last text frame — the
 * `usage` frame, `[DONE]` — is included in it. Both were measured before this
 * was accepted rather than fixed. The first-token exclusion biases the quotient
 * by exactly N/(N-1) — 0.02% at the few-thousand-token replies this reviewer
 * produces, which is arithmetic rather than an estimate. The terminator tail is
 * the softer half: on a live two-run case the divisor was 81–265 **seconds** and
 * the rates came out where a run of that length should, so no delay was
 * observed — but nothing here times that gap, so "not observed" is the honest
 * claim and "sub-millisecond" is not. A fourth timing field and a
 * second divisor to correct three orders of magnitude below the noise is not a
 * trade worth making.
 *
 * What that reasoning does *not* cover, and what a reader comparing servers must
 * know: a provider that delays its terminator after generation inflates the
 * divisor by however long it delays, with no bound. Nothing here detects it.
 * Within one server the figure is sound; across two it is only sound if both
 * terminate promptly.
 *
 * Null rather than a number whenever either operand is missing or nonsensical,
 * because every caller renders "—" for null and a fabricated 0 would be a
 * measurement nobody made:
 *
 *   - `generationMs` is null on the non-streamed path, where no first-token
 *     boundary was observed, and whenever no text ever arrived.
 *   - It must be **> 0**, not merely finite. `timings()` rounds to whole
 *     milliseconds, so a genuinely fast generation can land on 0 — and 0 as a
 *     divisor yields `Infinity`, which would print as a throughput.
 *   - `usage` is null outright when a server refused `stream_options`, and
 *     `completion_tokens` is optional even when `usage` is present.
 *   - The token count must be **>= 0**: a malformed `usage` carrying a negative
 *     would otherwise render a negative rate, which is a defect wearing the
 *     costume of a measurement.
 */
/**
 * The shortest window worth dividing by.
 *
 * Guarding only `> 0` was not enough, and the gap is exactly the one the
 * docstring above reasoned its way up to and then stopped short of: `timings()`
 * rounds to whole milliseconds, so a 1 ms window carries ±50% quantisation error
 * and a server that buffers its SSE output and flushes the whole reply in one or
 * two writes produces a five-digit rate rendered as a measurement — and in the
 * bench it becomes the *upper endpoint* of the case's range with no coverage
 * suffix to warn anyone. At 50 ms the same rounding is under 2%, which is the
 * justification for the number: it is a resolution floor, not a plausibility
 * one. Below it there was no observable generation window, which is the same
 * situation the non-streamed path already reports as null.
 */
const MIN_GENERATION_MS = 50;

export function tokensPerSecond(usage, generationMs) {
  if (!Number.isFinite(generationMs) || generationMs < MIN_GENERATION_MS) return null;
  const tokens = usage?.completion_tokens;
  if (!Number.isFinite(tokens) || tokens < 0) return null;
  return tokens / (generationMs / 1000);
}

/** One decimal: the interesting range spans 4 tok/s to 400, and neither needs more. */
export function formatRate(rate) {
  return rate === null ? null : rate.toFixed(1);
}
