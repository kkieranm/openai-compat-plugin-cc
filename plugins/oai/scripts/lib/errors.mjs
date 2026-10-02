/**
 * A failure the user can fix themselves (server down, bad flag, oversized input).
 * The dispatcher prints these without a stack trace and exits 1; anything else
 * is a bug and exits 2.
 */
export class UserError extends Error {
  /**
   * `reason` lets a caller react to a *specific* refusal without re-deriving the
   * verdict that produced it. The context guard tags its oversized-input error
   * `oversize`, which is the only one sending less input can fix; a caller that
   * caught everything would launder an unrelated bug into "too big".
   */
  constructor(message, { hint, reason } = {}) {
    super(message);
    this.name = 'UserError';
    this.hint = hint;
    this.reason = reason;
  }
}
