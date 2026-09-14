/**
 * Evidence read from `lms ps --json` — what the server says is resident, and the
 * time-windowed readings derived from a sampled series.
 *
 * One of two evidence modules feeding `ttl-verdict.mjs`; the other,
 * `ttl-attempts.mjs`, reads the plugin's own attempt record. Neither decides
 * anything: the rule that says what an episode MEANS lives in the verdict module,
 * pure and unit-tested, so the reading of the result is fixed before the numbers
 * arrive.
 */

/**
 * What `lms ps --json` says about each resident model, or null when it could not
 * be read at all.
 *
 * The fields are taken from a real reply rather than guessed — an earlier draft
 * of this file assumed the TTL was not reported and said so in a comment, which
 * was false. A live entry carries: `modelKey`, `ttlMs`, `lastUsedTime`,
 * `status`, `contextLength`, `maxContextLength`.
 *
 * `lastUsedTime` is recorded and never acted on. It is the anchor the server's
 * idle timer counts from, so whether it advances during a long prefill states
 * the hypothesis in the server's own terms — but its update semantics are
 * undocumented, so a verdict must not rest on them. That prohibition
 * extends to using it as a CLOCK anchor, which would be acting on it in all but
 * name.
 */
export function residencyOf(psOutput) {
  try {
    const parsed = JSON.parse(psOutput);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((entry) => entry?.modelKey)
      .map(({ modelKey, ttlMs, lastUsedTime, status, contextLength, maxContextLength }) => ({
        modelKey, ttlMs, lastUsedTime, status, contextLength, maxContextLength,
      }));
  } catch {
    return null;
  }
}

/** The resident entry for one model, or null when absent or unreadable. */
export function entryFor(loaded, model) {
  return Array.isArray(loaded) ? loaded.find((entry) => entry.modelKey === model) ?? null : null;
}

/**
 * Samples belonging to one window of the episode.
 *
 * Every sample is stamped with its `phase` at COLLECTION time, and each reader
 * selects the window it is actually entitled to. One place decides what a sample
 * is; three places consume it — the alternative was three ad-hoc filters over one
 * flat array, which is how two window bugs got into the withdrawn draft.
 *
 * `pre-dispatch` — taken before the child was spawned.
 * `in-flight`    — taken while the child process was alive. NOT the same as
 *                  "while the HTTP request was open": the request can fail well
 *                  before the companion exits, so an absence seen here may
 *                  postdate the failure. That gap was fatal to the confirming
 *                  verdict this instrument no longer has, and survives as a
 *                  caveat on recorded evidence rather than as a verdict input.
 * `post-exit`    — taken after the child closed. Never evidence about the run.
 */
export function inPhase(samples, ...phases) {
  return samples.filter((sample) => phases.includes(sample.phase));
}

/**
 * Did the server's idle anchor move while the model was still PREFILLING?
 *
 * Restricted to in-flight samples before first token, because that is the window
 * the question is about. The first draft compared the first and last readable
 * sample of the whole episode — which spans load, generation and completion — so
 * it would have read `true` off generation, the one activity nobody disputes
 * counts, and reported it as an answer about prefill.
 *
 * Null unless two readings actually exist in that window: an unreadable or
 * absent sample must never become an answer in either direction.
 */
export function activityObserved(samples, model, firstTokenMs) {
  const window = inPhase(samples, 'in-flight')
    .filter((sample) => firstTokenMs === null || firstTokenMs === undefined || sample.atMs < firstTokenMs);
  const seen = window
    .map((sample) => entryFor(sample.loaded, model)?.lastUsedTime)
    .filter((value) => typeof value === 'number');
  if (seen.length < 2) return null;
  return seen[seen.length - 1] > seen[0];
}

/**
 * The first IN-FLIGHT sample in which the model stopped being resident, or null.
 *
 * Post-exit samples are excluded: the sampler takes a final reading once the
 * child closes, and an absence first seen there happened after the run was over.
 *
 * Null when it never left AND when residency could not be read — different
 * facts, and the caller keeps every raw sample so the difference survives into
 * the manifest rather than being collapsed here.
 */
export function firstUnload(samples, model) {
  return inPhase(samples, 'in-flight')
    .find((sample) => Array.isArray(sample.loaded) && !entryFor(sample.loaded, model)) ?? null;
}

/**
 * The last in-flight sample showing the model resident before `atMs`, or null.
 *
 * With `firstUnload` this brackets the true disappearance into
 * `(lastPresentBefore, firstUnload]`. Recorded as observation quality, never as
 * attribution: the bracket says how precisely the absence was located, and
 * nothing about why it happened.
 */
export function lastPresentBefore(samples, model, atMs) {
  const present = inPhase(samples, 'in-flight')
    .filter((sample) => sample.atMs < atMs && entryFor(sample.loaded, model));
  return present.length ? present[present.length - 1] : null;
}

/**
 * Every model key seen resident in-flight that is NOT the target.
 *
 * The protocol requires nothing else connected, because another resident model
 * can trigger Auto-Evict and produce the same client-visible shape. So this is
 * an instrument-VALIDITY check (G2): a competing model means the precondition was
 * violated, which voids the sweep rather than saying anything about the server.
 */
export function otherModelsSeen(samples, model) {
  const others = new Set();
  for (const sample of inPhase(samples, 'in-flight')) {
    if (!Array.isArray(sample.loaded)) continue;
    for (const entry of sample.loaded) if (entry.modelKey !== model) others.add(entry.modelKey);
  }
  return [...others];
}

/**
 * How many in-flight samples before `atMs` could not be read at all.
 *
 * A polling error is not an absence, and collapsing the two would let a broken
 * sampler read as an observed unload. Recorded so a reader can see how continuous
 * the observation was.
 */
export function unreadableBefore(samples, atMs) {
  return inPhase(samples, 'in-flight')
    .filter((sample) => sample.atMs < atMs && !Array.isArray(sample.loaded)).length;
}

/** Was the target resident in the FIRST in-flight sample? Null when unreadable. */
export function residentAtStart(samples, model) {
  const [first] = inPhase(samples, 'in-flight');
  if (!first || !Array.isArray(first.loaded)) return null;
  return Boolean(entryFor(first.loaded, model));
}
