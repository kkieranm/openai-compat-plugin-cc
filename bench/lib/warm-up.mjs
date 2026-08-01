import { execFileSync } from 'node:child_process';

/**
 * Paying the model load before the first measured case, rather than charging it
 * to that case's prefill.
 *
 * `--cold` busts the server's *prompt* cache and deliberately so, but it does
 * nothing about the model itself: LM Studio loads on demand, so the first
 * request of an arm carries a JIT load that belongs to no case. The 2026-07-30
 * arms worked around this with a warm-up request scripted around the harness by
 * hand, which is the kind of step that is remembered once and forgotten twice.
 *
 * The request is unscored on purpose and its outcome does not gate the run: its
 * job is to make the server load the weights, and a server that refuses a
 * two-token prompt will refuse the corpus too — one case later, where the
 * failure is reported properly. So a failed warm-up is *recorded* and the bench
 * carries on. See ADR 006.
 *
 * **`answered` is not "the load was paid", and the field is named for what it
 * actually observes.** A reasoning model spends its whole token budget thinking
 * and never reaches its content channel, so `requireAnswer` refuses it
 * (`client.mjs:97`) and the child exits non-zero — on a request that loaded the
 * weights and did exactly its job. An `ok` flag here would have read `false` on
 * every model this repo runs, and a reader could not have told that apart from
 * "never reached the server", which is the one distinction that matters: the
 * first means case 1's prefill is clean, the second means it is not.
 * `durationMs` is the evidence that separates them — weights take seconds to
 * tens of seconds to load, a connection refusal takes milliseconds — so it is
 * recorded for both outcomes and neither is called success.
 */

/** A prompt small enough that generation time is noise beside the load it forces. */
const WARM_UP_PROMPT = 'hi';
const WARM_UP_MAX_TOKENS = '16';

/**
 * The provider/model pair one case will actually resolve to.
 *
 * Per-case rather than one for the whole invocation, because a case may pin its
 * own provider/model (overridden by the command line, exactly as `reviewFlags`
 * resolves it) — so "the resolved model" is not a single value in general.
 *
 * A pair with neither field is still a pair: it means "whatever providers.json
 * supplies", which is a real target that still has to be loaded.
 */
export function pairFor(caseDef, options) {
  return {
    provider: options.provider ?? caseDef.provider ?? null,
    model: options.model ?? caseDef.model ?? null,
  };
}

/**
 * Identity for "is this the same target as the last case?" — nulls included.
 *
 * `JSON.stringify` of a tuple rather than a joined string, because a separator
 * is only unambiguous while no field can contain it. Concatenating with `" | "`
 * made `{provider: 'a', model: 'b | c'}` and `{provider: 'a | b', model: 'c'}`
 * the same key — and nothing constrains a provider name or a model id against
 * the delimiter. Two distinct targets reading as one suppresses the warm-up
 * between them, which is silently the bug this function exists to prevent.
 * Null is preserved distinctly from the empty string for the same reason.
 */
export function pairKey({ provider, model }) {
  return JSON.stringify([provider ?? null, model ?? null]);
}

/**
 * The command line for one warm-up request.
 *
 * **Every flag before the prompt, which goes last.** `/oai:task` refuses a
 * flag-looking word inside the request text — deliberately, so a prompt that
 * mentions `--file` is not silently parsed as one — so a prompt-first argv is
 * rejected in milliseconds. The first version of this function built exactly
 * that, and the failure was invisible: warm-up records its outcome and never
 * throws, so the arm carried on with a `warmed` entry that had warmed nothing
 * and a first case still paying the model load. Caught only by running it.
 */
export function warmUpFlags({ provider, model }, options) {
  const flags = ['task', '--max-tokens', WARM_UP_MAX_TOKENS];
  if (provider) flags.push('--provider', provider);
  if (model) flags.push('--model', model);
  // The invocation's own budgets, not the defaults. A warm-up that can outlive
  // the cap the caller set for real work is an unbounded preliminary request —
  // its own trap, and one that would hang an arm before it measured anything.
  if (options.timeout) flags.push('--timeout', options.timeout);
  if (options['max-seconds']) flags.push('--max-seconds', options['max-seconds']);
  flags.push(WARM_UP_PROMPT);
  return flags;
}

/**
 * One warm-up request, recorded.
 *
 * Returns what was warmed and how it went, so the record *states* that warm-up
 * ran instead of leaving the raw options object as the only evidence — "the flag
 * was passed" and "the request happened" are different facts, and only the
 * second one is the reason a case's prefill can be trusted.
 *
 * `beforeCase` names the case this warm-up preceded. Warm-ups are interleaved
 * now rather than all run up front, so without it a reader of the record cannot
 * tell a mid-run warm-up from a pre-run one — and telling them apart is the
 * whole reason this function returns anything at all.
 */
export function warmUpPair(pair, options, { companion, cwd, beforeCase }) {
  const startedAt = Date.now();
  process.stderr.write(`warm-up — ${pair.model ?? 'configured model'}...\n`);
  try {
    execFileSync(process.execPath, [companion, ...warmUpFlags(pair, options)], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64e6,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ...pair, beforeCase, answered: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    // Recorded, never thrown. See the module note: the corpus run is where a
    // sick server gets reported, with the machinery that reports it properly —
    // and `answered: false` here is routine, not a warning.
    const said = String(error.stderr ?? error.message).trim();
    return { ...pair, beforeCase, answered: false, durationMs: Date.now() - startedAt, error: said };
  }
}

/**
 * The corpus, warmed on every change of target.
 *
 * **Interleaved, never grouped, and never once up front.** Warming every pair
 * before the first case — the original shape — lets the last warm-up evict the
 * first on a provider that keeps one model resident, so the earlier model's
 * first case still pays the JIT load the flag exists to remove. Warming only at
 * *first* use has the same defect one step later: an alternating corpus reloads
 * on every switch and only the first two cases are covered.
 *
 * The alternative that also fixes it — grouping the cases by pair — was rejected
 * because it reorders them. Cases are scored independently, but they do not run
 * independently: model residency, prompt cache, thermal state and the correlated
 * failure conditions OAI-20 exists to survive are all shared mutable state, so
 * reordering one arm changes which cases meet which conditions and weakens any
 * cross-arm comparison the corpus is used for. Order is preserved; only the
 * warm-ups move.
 *
 * On a single-pair invocation — which is every arm OAI-19 runs, since a
 * command-line `--model` overrides every case — this collapses to exactly one
 * warm-up before the first case, identical to the behaviour it replaces.
 *
 * `warm` and `run` are injected because `bench/run.mjs` calls `main()` at
 * import, so the loop is otherwise unreachable from a test — and a pair-change
 * rule that no test can drive is a rule the next edit deletes silently.
 */
export function runWithWarmUp(cases, options, { warm, run }) {
  const warmed = options['warm-up'] ? [] : null;
  let lastKey = null;
  const results = cases.map((caseDef) => {
    if (warmed) {
      const pair = pairFor(caseDef, options);
      const key = pairKey(pair);
      if (key !== lastKey) {
        warmed.push(warm(pair, caseDef));
        lastKey = key;
      }
    }
    return run(caseDef);
  });
  return { results, warmed };
}
