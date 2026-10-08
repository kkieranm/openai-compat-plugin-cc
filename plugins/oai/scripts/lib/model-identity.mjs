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
 * THE requested-versus-served judgement, and the only one. The footer, the
 * stderr warning and the bench's `outcome.mjs` all call this rather than
 * writing `a !== b` each: two definitions is how the same pair of ids ends up
 * warning on one path and failing a run on another, over a difference neither
 * author had in mind.
 *
 * `declaredMatch` is likewise the one definition of a reply accepted only
 * through the provider's `servedModelIds`. `substitution()` uses it for its
 * declared branch, and every other reader of a declared match calls it rather
 * than testing the ids inline: multi-pass agreement (`review-passes.mjs`), the
 * footer's declared marker (`render.mjs`), the bench note naming declared
 * pairings (`bench/lib/report.mjs`), the sweep reproduction reader's model
 * provenance (`bench/lib/sweep-reproduction.mjs`) and the sweep report's
 * declared-pairing line (`bench/lib/sweep-report.mjs`).
 */

/**
 * The two ids when they differ, or `null` — also `null` when the served id is
 * the one the provider's `servedModelIds` declares for the requested id.
 *
 * Exact otherwise, with no normalisation. `matchKey` (`model-info.mjs`) strips a
 * `@quant` suffix so a model can be recognised across a server's own endpoints, and
 * reusing it here would be wrong twice over: the ids compared here are what we
 * sent and what the *same* server sent back, so no dialect translation is
 * involved — and the suffix names a real identity. Measured: requesting
 * `qwen/qwen3.6-27b@4bit` made LM Studio attempt to load a different model and
 * fail on system resources, so a swap between two quantizations of one model is
 * exactly the A/B contaminant this exists to catch.
 *
 * `null` when either id is missing rather than a difference: an absent field is
 * "nothing was determined", never evidence that a substitution happened.
 */
export function substitution(requested, served, declared) {
  if (!requested || !served) return null;
  if (requested === served) return null;
  if (declaredMatch({ requestedModel: requested, model: served, declaredServedModel: declared })) return null;
  return { requested, served };
}

/**
 * Whether `model` answered only through the operator's `servedModelIds` entry
 * for `requestedModel`: a server that reports a model under a different
 * spelling than the id it lists.
 *
 * True exactly when `declaredServedModel` is a non-empty string, `model` equals
 * it, and `model` differs from `requestedModel` — an exact match is never a
 * declared one, so a self-mapping `{X: X}` never makes an exact reply read as
 * declared. Matched exactly, and only against the declaration for this
 * requested id. A missing `requestedModel` with a matching declaration reads as
 * declared: the reply still rests on the operator's assertion.
 */
export function declaredMatch({ requestedModel, model, declaredServedModel }) {
  return typeof declaredServedModel === 'string' && declaredServedModel !== ''
    && model === declaredServedModel && model !== requestedModel;
}

/**
 * The id a provider's `servedModelIds` declares the server reports for
 * `requested`, or `null`.
 *
 * An own property only, and only a string: an inherited `Object.prototype`
 * member (`toString`, `constructor`) is not a declaration.
 */
export function declaredServedModel(profile, requested) {
  const ids = profile?.servedModelIds;
  if (!ids || typeof requested !== 'string' || !Object.hasOwn(ids, requested)) return null;
  const declared = ids[requested];
  return typeof declared === 'string' && declared ? declared : null;
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
 * narrow — under `--json` it skips its human rendering, a failure before
 * reporting never reaches it, and a refusal raised while reporting
 * (`unparsedReply` throwing in either branch) propagates to the command's
 * catch — and the whole point is that the operator hears about this while the
 * run is still in front of them.
 */
export function substitutionNotice(result) {
  const swap = substitution(result?.requestedModel, result?.model, result?.declaredServedModel);
  if (!swap) return null;
  return (
    `Warning: asked for "${swap.requested}" but ${swap.served} answered.\n`
    + 'The server substituted a model rather than refusing. Results belong to the model that ran, not the one requested.\n'
  );
}
