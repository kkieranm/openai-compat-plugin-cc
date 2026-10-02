/**
 * Whether the model that answered is the model that was asked for.
 *
 * A local server may serve a request for a model it does not have. Measured
 * against LM Studio: a request naming `totally-not-a-real-model` returned HTTP
 * 200 and a normal completion from whatever happened to be loaded, reporting
 * that model's id in the reply. No error, no warning. A benchmark arm can
 * therefore spend its whole wall clock on a model it does not claim to test,
 * and every record of the run looks clean.
 *
 * THE comparison, and the only one. The footer, the stderr warning and
 * `bench/run.mjs` all call this rather than writing `a !== b` each: two
 * definitions is how the same pair of ids ends up warning on one path and
 * failing a run on another, over a difference neither author had in mind.
 */

/**
 * The two ids when they differ, or `null`.
 *
 * Exact, with no normalisation. `matchKey` (`model-info.mjs`) strips a `@quant`
 * suffix so a model can be recognised across a server's own endpoints, and
 * reusing it here would be wrong twice over: the ids compared here are what we
 * sent and what the *same* server sent back, so no dialect translation is
 * involved — and the suffix names a real identity. Measured: requesting
 * `qwen/qwen3.6-27b@4bit` made LM Studio attempt to load a different model and
 * fail on system resources, so a swap between two quantizations of one model is
 * exactly the A/B contaminant this exists to catch.
 *
 * `null` when either id is missing rather than a difference: an absent field is
 * "nothing was determined", never evidence that a substitution happened. The
 * same rule `budgetError`'s `serverResponded` had to learn — a proxy that
 * asserts a fact it only inferred is the defect class, not the fix.
 */
export function substitution(requested, served) {
  if (!requested || !served) return null;
  return requested === served ? null : { requested, served };
}

/**
 * The warning line for a substituted run, or `null`.
 *
 * Formatted here and written by the commands, which is where the I/O belongs —
 * `render.mjs` follows the same split. The message has one definition because
 * both commands say the same thing about the same fact; the writing is two
 * lines at the edges.
 *
 * Why the commands and not lower down: `finishAnswer` is a pure accumulator and
 * runs once per rung of the capability ladder, so warning there would put I/O in
 * the wrong layer and repeat itself on a retry. `report()` is too late and too
 * narrow — `--json` and every error path route around it, and the whole point is
 * that the operator hears about this while the run is still in front of them.
 */
export function substitutionNotice(result) {
  const swap = substitution(result?.requestedModel, result?.model);
  if (!swap) return null;
  return (
    `Warning: asked for "${swap.requested}" but ${swap.served} answered.\n`
    + 'The server substituted a model rather than refusing. Results belong to the model that ran, not the one requested.\n'
  );
}
