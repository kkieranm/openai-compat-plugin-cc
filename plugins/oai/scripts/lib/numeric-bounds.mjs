// The domain of every numeric option flag outside the sampling registry, in one
// table that each validator reads: the commands' own parse (`delegate.mjs`), the
// bench's up-front check (`bench/run.mjs`) and the comparison's reading of a recorded value
// (`bench/lib/compare-model.mjs`). A bound written out at each site could be
// changed in one and not the others, giving one flag two domains.
import { MAX_BUDGET_SECONDS } from './http-budgets.mjs';
import { MIN_REVIEW_RESERVE_TOKENS } from './review-schema.mjs';

/**
 * A ceiling on `--max-attempts`, for the reason `MAX_BUDGET_SECONDS` exists.
 *
 * Retries multiply an already-unbounded wall clock: without `--max-seconds` a
 * single attempt is up to the first-token budget plus generation that only the
 * idle budget bounds, so a large attempt count is a run nobody can wait out.
 */
export const MAX_ATTEMPTS_CEILING = 10;

/**
 * A ceiling on `/oai:review --passes`, the multi-pass count. Bounded above for
 * the same reason as `--max-attempts`: each pass is a full model call, so
 * `--passes 1e9` is a typo whose honest response is a refusal in milliseconds,
 * not a run nobody can stop. `--passes` is a `/oai:review`-only flag; `/oai:task`
 * never reads it, and an undefined value here means single-pass.
 */
export const PASSES_CEILING = 10;

/** `parseNumber`'s bounds for each non-sampling numeric flag `/oai:task` and `/oai:review` take. */
export const NUMERIC_BOUNDS = Object.freeze({
  'max-tokens': Object.freeze({ integer: true, min: 1 }),
  temperature: Object.freeze({ min: 0, max: 2 }),
  // Bounded above, for the reason MAX_BUDGET_SECONDS states.
  timeout: Object.freeze({ min: 1, max: MAX_BUDGET_SECONDS }),
  'max-seconds': Object.freeze({ min: 1, max: MAX_BUDGET_SECONDS }),
  'max-wait': Object.freeze({ min: 1, max: MAX_BUDGET_SECONDS }),
  'max-attempts': Object.freeze({ integer: true, min: 1, max: MAX_ATTEMPTS_CEILING }),
  passes: Object.freeze({ integer: true, min: 1, max: PASSES_CEILING }),
});

/**
 * The bench's bounds: the commands' own, except `max-tokens`, floored at
 * `MIN_REVIEW_RESERVE_TOKENS` — `/oai:review` refuses an explicit value below
 * it, so a bench run could never send one.
 */
export const BENCH_NUMERIC_BOUNDS = Object.freeze({
  ...NUMERIC_BOUNDS,
  'max-tokens': Object.freeze({ integer: true, min: MIN_REVIEW_RESERVE_TOKENS }),
});
