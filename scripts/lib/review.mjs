// What the model is asked to do, and how its answer is shown.
import { MAX_FINDINGS } from './structured.mjs';

// Terse and negative: a small model follows a short list of prohibitions far
// better than a long description of good reviewing.
export const REVIEW_SYSTEM_PROMPT =
  'You are a code reviewer. Report only defects you can point at in the code you were given: ' +
  'bugs, unhandled edge cases, security holes, broken contracts, tests that assert the wrong thing. ' +
  'No style opinions, no praise, no summaries of what the code does. ' +
  'Never speculate about code you were not shown. ' +
  'Every finding must name the file it is in and quote the exact line as evidence. ' +
  'If you find no defects, return an empty findings list and say so in the summary — do not invent one. ' +
  'Use the "analysis" field first: work through the code path by path, considering for each function ' +
  'what it accepts and what a careless caller or an attacker could pass it. Only then fill in findings.';

/**
 * `wholeFiles` says the complete current content of every changed file is in the
 * request, so the model can resolve an identifier defined outside the hunks
 * rather than reporting it missing. It is passed only when that is *verified* —
 * with the context window unknown we cannot rule out the server truncating the
 * request, and telling a model it has a whole file it does not have is the very
 * defect this argument exists to remove.
 *
 * `hunksOnly` is the opposite claim and is equally load-bearing: it warns the
 * model off the "X is not defined" conclusion the hunks alone invite.
 */
export function buildReviewPrompt({ label, diff, instructions, wholeFiles }) {
  const parts = [`Review these ${label} for defects.`];
  if (instructions) parts.push(`The requester adds: ${instructions}`);

  if (wholeFiles) {
    parts.push(
      'You have been given the complete current content of every changed file, plus a diff showing ' +
        'what changed. Use the files to resolve anything the diff refers to but does not show. ' +
        'Report defects in the changed code. If you find a real defect in code this change did not ' +
        'touch, report it too, but begin its summary with "pre-existing:".',
    );
  } else if (diff.trim()) {
    // The fallback is scoped to what is actually in the request rather than
    // asserting anything about the whole of it, which makes it true in every
    // partial case: some files whole and some not, none whole, or one body that
    // could not be read. A blanket "you have only hunks" would be false about a
    // pinned untracked file the model can see completely, and would suppress
    // exactly the findings on the files that appear in no diff.
    parts.push(
      'Any file given below in a "--- FILE: ---" block is complete. For every other file you have ' +
        'only the changed hunks, so anything they refer to may be defined in a part of the file you ' +
        'cannot see: do not report an identifier as undefined, unimported or missing in those.',
    );
  }

  if (diff.trim()) parts.push(`--- DIFF ---\n${diff}\n--- END DIFF ---`);
  return parts.join('\n\n');
}

const SEVERITY_ORDER = ['high', 'medium', 'low'];

function renderFinding(finding) {
  const place = `${finding.file}${finding.line ? `:${finding.line}` : ''}`;
  const lines = [`${finding.severity.padEnd(6)}  ${place}`, `        ${finding.summary}`];
  if (finding.evidence) lines.push(`        > ${finding.evidence.split('\n')[0].trim()}`);
  return lines.join('\n');
}

/**
 * The findings, ordered by severity. Framed as claims, not conclusions: they
 * come from a small local model and have not been checked against the code yet.
 */
/**
 * Every reason this result may be less than it appears, in one place.
 *
 * Each is a claim about what happened, so each must be true on every path that
 * can reach it — the repo's most-repeated defect is a message whose precondition
 * differs from the condition actually tested. Kept together because they are one
 * idea, and because a new one added beside them inherits the same scrutiny.
 */
function caveats({ dropped, atCap, analysisCut, hunksOnly, unreadable }) {
  const notes = [];

  // Said loudly, and before the findings count is believed: the model was cut
  // off while still reasoning, so an empty list means "did not finish looking",
  // not "found nothing". Without this the reply is identical to a clean review.
  if (analysisCut) {
    notes.push(
      'WARNING: the model was still reasoning when it hit its length limit, so it never finished ' +
        'looking. Treat this result as incomplete — especially an empty one. Review a smaller ' +
        'target, or raise the limit.',
    );
  }
  // A reply arriving at exactly the cap may have been cut, and there is no way
  // to tell "found this many" from "found more and was stopped" — so this says
  // that rather than inventing a count it cannot know. It must be said: an
  // unreported cut is a defect silently binned.
  if (atCap) {
    notes.push(
      `(The findings list hit its limit of ${MAX_FINDINGS}, so there may be more. ` +
        'Review a smaller target to see the rest.)',
    );
  }
  // Worded for the state, not the cause: equally true whether the files did not
  // fit, were not asked for, or were never listed.
  if (hunksOnly) {
    notes.push(
      'NOTE: the model saw only the diff hunks for the changed files, not their whole contents. ' +
        'A claim that something is undefined, unimported or missing may just mean it is defined in ' +
        'a part of the file that was not sent.',
    );
  }
  if (unreadable?.length) {
    notes.push(
      `NOTE: ${unreadable.length} file(s) changed by this work could not be read, so only their diff ` +
        `hunks were sent: ${unreadable.join(', ')}. An unmerged path during a conflicted merge does ` +
        'this. The same caveat applies to any finding naming them.',
    );
  }
  if (dropped > 0) {
    notes.push(`(${dropped} finding(s) were dropped: they named no file or no defect, so nothing could be checked.)`);
  }
  return notes;
}

/**
 * The findings, ordered by severity. Framed as claims, not conclusions: they
 * come from a small local model and have not been checked against the code yet.
 */
export function renderFindings(parsed, { label, provider, model }) {
  const { findings, summary } = parsed;
  const lines = [`${findings.length} finding(s) from ${model} on ${provider} — ${label}`, ''];

  if (findings.length === 0) {
    lines.push('No defects reported.');
  } else {
    const sorted = [...findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    lines.push(sorted.map(renderFinding).join('\n\n'));
  }

  if (summary) lines.push('', `Summary: ${summary}`);
  for (const note of caveats(parsed)) lines.push('', note);
  lines.push('', 'These are unverified claims from a local model. Check each one against the code before acting on it.');
  return lines.join('\n');
}
