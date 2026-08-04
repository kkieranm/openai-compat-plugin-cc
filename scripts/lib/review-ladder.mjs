// How a review's messages are built: whole files if they fit, the diff alone if
// they do not, and the prose instruction that stands in for a grammar.
//
// Split from `review-request.mjs` under the size ratchet when the unconstrained
// path became the default (OAI-51) and the file crossed 300 lines. The seam is a
// real one rather than a place the knife happened to land: this module decides
// what the model is SHOWN, while `review-request.mjs` decides how much budget
// there is to show it in and what to do when a request comes back refused.
import { prepareRequest } from './delegate.mjs';
import { buildReviewPrompt } from './review.mjs';
import { REVIEW_SCHEMA, reviewSchemaFor } from './review-schema.mjs';
import { findingsFirst, schemaInstruction } from './structured.mjs';

/**
 * Whole changed files if they fit the window, the diff alone if they do not.
 *
 * Two rungs rather than a per-file shed. The second rung is exactly the
 * behaviour that shipped before whole files existed, so it needs no manifest of
 * what was left out in order to be honest, and there is no drop order to get
 * wrong — largest-first would have shed `model-info.mjs`, the very file whose
 * absent definition produced the false positive this feature removes.
 *
 * Only `target.changed` is droppable. `target.files` is code no diff covers —
 * untracked files, or `--file` where there is no diff at all — so dropping one
 * would review nothing and report a clean pass. See ADR 005.
 */
export function prepareLadder(shared, { target, instructions, windowKnown, suffix = '' }) {
  const hasDiff = Boolean(target.diff.trim());
  // Every condition the claim "you hold the complete content of every changed
  // file" depends on. `unreadable` is the one that is easy to forget: a path git
  // listed whose body would not load is absent from `changed` and leaves no
  // other trace, so without this the prompt would vouch for a file that never
  // arrived — this feature's own defect, asserted rather than merely risked.
  const build = (whole) => {
    const prompt = buildReviewPrompt({
      label: target.label,
      diff: target.diff,
      instructions,
      wholeFiles: whole && hasDiff && windowKnown && target.unreadable.length === 0,
    });
    return {
      prompt: suffix ? `${prompt}\n\n${suffix}` : prompt,
      files: whole ? [...target.files, ...target.changed] : target.files,
    };
  };

  if (target.changed.length > 0) {
    try {
      return { ...prepareRequest({ ...shared, ...build(true) }), hunksOnly: false };
    } catch (error) {
      // Only the oversize refusal is retryable by sending less; anything else
      // is a different failure and must not be laundered into "too big".
      if (error.reason !== 'oversize') throw error;
    }
  }
  // The reader's caveat is about what the model saw, not about why: no changed
  // file went whole, whether they did not fit, were not asked for, or were
  // never listed. Pinned files are unaffected — the note only ever qualifies
  // findings the diff alone had to carry.
  return { ...prepareRequest({ ...shared, ...build(false) }), hunksOnly: hasDiff };
}

/**
 * The unconstrained rung's messages, reserve, and the schema its instruction names.
 *
 * Circular by construction — the suffix carries the schema text, whose length
 * feeds the estimate that sets the reserve that sizes the cap the text states —
 * and broken without an iteration by sizing once against `REVIEW_SCHEMA`, the
 * widest this module builds. That instruction is the longest possible, so the
 * cap derived from it can only under-state the room available: wrong in the safe
 * direction by a bounded amount, rather than merely usually right.
 *
 * Sizing it at all is the point: nothing enforces `maxLength` here, so the
 * schema is advice — but advice naming a ceiling the budget cannot pay for is
 * the same defect as a cap that over-commits, told to the model not the code.
 */
export function unconstrainedLadder(shared, ladder) {
  const sized = prepareLadder(shared, { ...ladder, suffix: schemaInstruction(findingsFirst(REVIEW_SCHEMA)) });
  const schema = reviewSchemaFor(sized.reserve);
  // Findings ahead of analysis: nothing enforces a cap here, so the answer has
  // to come before the reasoning or a long think eats the whole budget.
  return { ...prepareLadder(shared, { ...ladder, suffix: schemaInstruction(findingsFirst(schema)) }), schema };
}
