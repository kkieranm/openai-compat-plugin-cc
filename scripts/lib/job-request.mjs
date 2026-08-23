// The request, across a process boundary.
//
// A job is submitted by one process and sent by another, so the request has to
// survive JSON. It is a DTO with an explicit conversion at each end, never the
// live request object handed to `JSON.stringify` — those are not the same thing
// and treating them as one changes what goes on the wire.
import { resolveIdle, resolveMax, resolveRetryDelay, resolveTimeout } from './delegate.mjs';

/**
 * **The one rule, stated once so no call site re-invents it: a field whose
 * foreground value is `undefined` is absent from the DTO and absent from the
 * reconstructed request. `null` is not a second spelling of absence — it is
 * invalid.**
 *
 * `client.mjs` builds its body with `!== undefined`, so a `temperature` that
 * round-tripped as `null` would put `"temperature": null` on the wire where the
 * foreground path omits the field entirely. Same request, different bytes.
 */
function withoutUndefined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/**
 * What submission persists.
 *
 * Only *resolved* values: `send()` refuses a non-positive first-byte budget, so
 * a stored `timeoutMs: 0` would be unusable. The resolvers run here, where the
 * profile is still in hand.
 *
 * `expiresAt` is deliberately NOT persisted. It derives from
 * `performance.now()`, whose origin is per-process and meaningless in the worker
 * — it would be an instant on a clock that no longer exists. `maxMs` is stored
 * and the worker mints its own, exactly as the foreground path does.
 */
export function persistRequest({ profile, numeric, messages, template, estimatedTokens, budget }) {
  const { maxTokens, temperature, timeoutSeconds, maxSeconds, maxAttempts } = numeric;
  return {
    messages,
    // Gated on the template, because `estimatedTokens` is ALWAYS in hand:
    // spreading it unconditionally would change every ordinary task's DTO, and
    // `withoutUndefined` cannot strip a value that is defined. It is persisted
    // only because a template's size caveat is rendered again by `/oai:result`.
    //
    // Note precisely what this gate does and does not guarantee. It emits the
    // pair or nothing — but if a caller ever passes a template with no estimate,
    // it writes `template` alone, and the renderer's "size not recorded" state is
    // what covers that. The pairing is a property of this function's single
    // caller, not of this line, and saying otherwise here would be a comment
    // whose stated precondition differs from what is tested.
    ...(template ? { template, estimatedTokens } : {}),
    // The same pair `task-report.mjs` and `review-report.mjs` already compute
    // for the foreground rendering — persisted here so `/oai:result` can show
    // the identical caveat for the same run instead of hardcoding it away.
    // Unconditional, not `withoutUndefined`: `checked` is always a real
    // boolean and `note` is only ever meaningful opposite it, so `null` is the
    // right spelling of "nothing to say" rather than absence.
    contextChecked: budget.checked,
    contextNote: budget.checked ? null : budget.note,
    ...withoutUndefined({
      timeoutMs: resolveTimeout(profile, timeoutSeconds),
      idleMs: resolveIdle(profile),
      retryDelayMs: resolveRetryDelay(profile),
      maxMs: resolveMax(profile, maxSeconds),
      temperature,
      maxTokens,
      maxAttempts,
    }),
  };
}

/**
 * What the worker sends, rebuilt from the DTO plus the things that cannot cross
 * a process: the model id, a fresh ledger, and the deadline.
 */
export function reconstructRequest(dto, { model, ledger }) {
  const { maxMs } = dto;
  return {
    ...withoutUndefined({
      model,
      messages: dto.messages,
      timeoutMs: dto.timeoutMs,
      idleMs: dto.idleMs,
      retryDelayMs: dto.retryDelayMs,
      maxMs,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      maxAttempts: dto.maxAttempts,
      // Minted here, on this process's clock, at the last moment before the
      // call — the same rule the foreground path follows for the same reason.
      expiresAt: maxMs === undefined ? undefined : performance.now() + maxMs,
    }),
    // Has methods, so it cannot be persisted and is recreated per process.
    ledger,
  };
}
