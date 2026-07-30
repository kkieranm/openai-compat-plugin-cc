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
 * The distinct provider/model pairs the selected cases will actually resolve to,
 * in order of first use.
 *
 * Per-pair rather than one for the whole invocation, because a case may pin its
 * own provider/model (overridden by the command line, exactly as `reviewFlags`
 * resolves it) — so "the resolved model" is not a single value in general. On a
 * corpus where every case resolves alike this yields one pair and costs one
 * request; it stops being wrong the moment a case pins a model.
 *
 * A pair with neither field is still a pair: it means "whatever providers.json
 * supplies", which is a real target that still has to be loaded.
 */
export function resolvePairs(cases, options) {
  const pairs = [];
  const seen = new Set();
  for (const caseDef of cases) {
    const provider = options.provider ?? caseDef.provider ?? null;
    const model = options.model ?? caseDef.model ?? null;
    const key = `${provider ?? ''} | ${model ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ provider, model });
  }
  return pairs;
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
 * One warm-up per pair, recorded.
 *
 * Returns what was warmed and how it went, so the record *states* that warm-up
 * ran instead of leaving the raw options object as the only evidence — "the flag
 * was passed" and "the request happened" are different facts, and only the
 * second one is the reason the first case's prefill can be trusted.
 */
export function warmUp(pairs, options, { companion, cwd }) {
  return pairs.map((pair) => {
    const startedAt = Date.now();
    process.stderr.write(`warm-up — ${pair.model ?? 'configured model'}...\n`);
    try {
      execFileSync(process.execPath, [companion, ...warmUpFlags(pair, options)], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64e6,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ...pair, answered: true, durationMs: Date.now() - startedAt };
    } catch (error) {
      // Recorded, never thrown. See the module note: the corpus run is where a
      // sick server gets reported, with the machinery that reports it properly —
      // and `answered: false` here is routine, not a warning.
      const said = String(error.stderr ?? error.message).trim();
      return { ...pair, answered: false, durationMs: Date.now() - startedAt, error: said };
    }
  });
}
