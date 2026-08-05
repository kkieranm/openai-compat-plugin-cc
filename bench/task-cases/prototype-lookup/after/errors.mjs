export class UserError extends Error {
  constructor(message, { hint = null } = {}) {
    super(message);
    this.hint = hint;
  }
}
