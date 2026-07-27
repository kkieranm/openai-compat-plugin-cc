/**
 * A failure the user can fix themselves (server down, bad flag, oversized input).
 * The dispatcher prints these without a stack trace and exits 1; anything else
 * is a bug and exits 2.
 */
export class UserError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'UserError';
    this.hint = hint;
  }
}
