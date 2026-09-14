// How a review's messages are built: whole files if they fit and something could
// size the window, the diff alone otherwise, and the prose instruction that
// stands in for a grammar.
//
// Split from `review-request.mjs` under the size ratchet when the unconstrained
// path became the default and the file crossed 300 lines. The seam is a
// real one rather than a place the knife happened to land: this module decides
// what the model is SHOWN, while `review-request.mjs` decides how much budget
// there is to show it in and what to do when a request comes back refused.
import { prepareRequest } from './delegate.mjs';
import { buildReviewPrompt, lensDirective } from './review.mjs';
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
 * would review nothing and report a clean pass.
 *
 * The first rung needs a CHECKABLE window, not merely a non-empty `changed`
 * list. `windowKnown` already gated the prompt's completeness claim; it now also
 * gates whether those bodies are attached at all, because the two were the same
 * decision wearing one flag. Without this the guard returns unchecked, the
 * oversize refusal below never throws, and nothing else drops `changed` — so a
 * cold process shipped a request nobody could size. The cost is real and is
 * NOT hidden: an unknown window is not evidence of a SMALL one, so a review
 * that would have fitted is narrowed, and
 * `review.mjs` says so and names `contextLength` as the remedy.
 */
export function prepareLadder(shared, { target, instructions, windowKnown, suffix = '', lens }) {
  const hasDiff = Boolean(target.diff.trim());
  // Every condition the claim "you hold the complete content of every changed
  // file" depends on. `unreadable` is the one that is easy to forget: a path git
  // listed whose body would not load is absent from `changed` and leaves no
  // other trace, so without this the prompt would vouch for a file that never
  // arrived — this feature's own defect, asserted rather than merely risked.
  //
  // The lens rides the TAIL, after the diff and after any `suffix` (the schema
  // instruction on the structured paths): the server prefix-caches, so keeping
  // everything up to the diff byte-identical across the passes of a `--lens a,b`
  // run is what makes the extra passes warm rather than each a cold prefill. It
  // is a dedicated parameter, never smuggled through `suffix`, because
  // `unconstrainedLadder` overwrites `suffix` on its sizing calls — a lens hidden
  // there would be dropped on the default path. The `lens ?` guard is
  // load-bearing: `lensDirective` throws on an unknown name, and a lens-less run
  // reaches here with `lens` undefined, so an unguarded call would break every
  // ordinary review.
  const build = (whole) => {
    const prompt = buildReviewPrompt({
      label: target.label,
      diff: target.diff,
      instructions,
      wholeFiles: whole && hasDiff && windowKnown && target.unreadable.length === 0,
    });
    return {
      prompt: [prompt, suffix, lens ? lensDirective(lens) : null].filter(Boolean).join('\n\n'),
      files: whole ? [...target.files, ...target.changed] : target.files,
    };
  };

  if (windowKnown && target.changed.length > 0) {
    try {
      return { ...prepareRequest({ ...shared, ...build(true) }), hunksOnly: false, rung: 'whole', skipped: null };
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
  //
  // `skipped` is the CAUSE beside that state, and it is OBSERVED here rather
  // than re-derived at the renderer. The first version of this feature computed
  // the same predicate a second time where the report is built; the two agreed
  // only by construction, so removing the guard above left the report asserting
  // a skip while whole bodies went on the wire. Both halves of that predicate
  // survive — they are simply evaluated once, at the branch that acts on them.
  //
  // `null`, never `false`, where the rung was taken deliberately: a known-window
  // oversize fallback reaches this line having been sized and shed, and `false`
  // would assert a determination about a cause nobody evaluated.
  return {
    ...prepareRequest({ ...shared, ...build(false) }),
    hunksOnly: hasDiff,
    rung: 'hunks',
    skipped: !windowKnown && target.changed.length > 0 ? 'unsized-window' : null,
  };
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
