/**
 * What a server refuses, and the smaller request to send instead.
 *
 * Lifted out of `chat.mjs` at the file size budget, and the seam is a real one:
 * this module is the vendor-compatibility table — which refusals are about a
 * *capability* rather than about this request — while `chat.mjs` owns the budgets
 * and the loop that climbs it.
 */

/** A 400 that names the field it refused, rather than the request as a whole. */
function refusedField(error, pattern) {
  if (error?.status !== 400 && error?.status !== 422) return false;
  return pattern.test(error.message ?? '');
}

/**
 * The capability this failure blames, or null if it is not a capability problem.
 *
 * `\bstream\b` does not match inside `stream_options` — `_` is a word character,
 * so there is no boundary — which is what keeps the two rungs distinct.
 */
export const RUNGS = [
  {
    name: 'stream_options',
    matches: (error) => refusedField(error, /stream_options/i),
    note: 'rejected stream_options; retrying without it (token counts will be unavailable)',
    apply: ({ stream_options: _dropped, ...rest }) => rest,
  },
  {
    name: 'stream',
    // `streaming is not supported` is at least as likely a vendor phrasing as
    // the bare parameter name, and matching only the latter would leave the
    // fallback unreachable for it. Neither alternative matches `stream_options`:
    // `_` is a word character, so there is no boundary after `stream`.
    matches: (error) => refusedField(error, /\bstream(ing)?\b/i),
    note: 'rejected streaming; retrying without it (no progress will be shown)',
    apply: ({ stream_options: _dropped, ...rest }) => ({ ...rest, stream: false }),
  },
];

