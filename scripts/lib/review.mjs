// What the model is asked to do, and how its answer is shown.
import { MAX_FINDINGS } from './review-schema.mjs';

// Terse and negative: a small model follows a short list of prohibitions far
// better than a long description of good reviewing.
const REVIEW_RULES =
  'You are a code reviewer. Report only defects you can point at in the code you were given: ' +
  'bugs, unhandled edge cases, security holes, broken contracts, tests that assert the wrong thing. ' +
  'No style opinions, no praise, no summaries of what the code does. ' +
  'Never speculate about code you were not shown. ' +
  'Every finding must name the file it is in and quote the exact line as evidence. ' +
  'If you find no defects, return an empty findings list and say so in the summary — do not invent one. ';

// Under a grammar, and only there. Generation is constrained from the first
// token, so the model has no scratchpad of its own and `analysis` has to be one:
// opening with `findings` made it commit before reading, and the reviewer got
// measurably worse. See the note in `review-schema.mjs`.
const ANALYSIS_FIRST =
  'Use the "analysis" field first: work through the code path by path, considering for each function ' +
  'what it accepts and what a careless caller or an attacker could pass it. Only then fill in findings.';

// Without one, the model has already reasoned in its own channel before it
// writes a character of the answer, so asking it to reason again in `analysis`
// asks twice — and nothing bounds the second ask now that no `maxLength` does.
// Measured 2026-08-04: 38,956 characters of `analysis` on a 100-line file, the
// whole token budget spent, no findings ever written. The answer goes first, so
// a reply that runs out of room still carries what it found.
const FINDINGS_FIRST =
  'You have already thought about this before writing anything — do not think it through again in the ' +
  'reply. Write "findings" FIRST, before any other field: a reply that runs out of room must still ' +
  'carry what you found. Then put a SHORT note of your reasoning in "analysis" — a few sentences for ' +
  'the reader, not a second review. Length there costs you findings.';

/**
 * What the model is told, which depends on whether a grammar will hold it to it.
 *
 * Two orderings rather than one, because the reason for the original ordering is
 * a property of constrained generation and does not survive without it. A single
 * prompt would be wrong on one path whichever ordering it chose.
 */
export function reviewSystemPrompt({ structuredOutput = false } = {}) {
  return REVIEW_RULES + (structuredOutput ? ANALYSIS_FIRST : FINDINGS_FIRST);
}

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
 * A fact about the *request*, so every path that shows output derived from it
 * says the same thing — defined once rather than written out at each. The
 * parsed and unparseable paths diverging is how this repo produced instance 11:
 * the branch in front of you gets the fix and the adjacent one does not.
 */
export function unreadableNote(unreadable) {
  if (!unreadable?.length) return null;
  return (
    `NOTE: ${unreadable.length} file(s) changed by this work could not be read, so only their diff ` +
    `hunks were sent: ${unreadable.join(', ')}. An unmerged path during a conflicted merge does ` +
    'this. The same caveat applies to any claim naming them.'
  );
}

/**
 * The whole-file rung was not attempted because the window could not be sized.
 *
 * Exported and shared for the same reason `unreadableNote` above is: the parsed
 * and unparseable paths both derive their output from this request, so both must
 * say it. A reply that came back as prose is not a reply that saw more.
 *
 * Says the CAUSE and the REMEDY, which is why it sits beside the `hunksOnly`
 * note rather than replacing it — that one is deliberately worded for the state
 * and stays true whatever produced it.
 *
 * Names the PROVIDER and no model. The window was established for the model that
 * was *requested*, while the report heads itself with the model that *answered*,
 * and under substitution those differ — a single report naming two models is the
 * defect `review-report.mjs` avoids by choosing one. The config key is per
 * provider anyway, so the provider is also the only id the remedy needs.
 *
 * Scoped to the DIFF-COVERED files: `target.files` — untracked, or `--file` —
 * is still sent whole, so "the changed files were not sent whole" would be false
 * on a mixed target and would collide with the two-list rule ADR 005 rests on.
 */
export function unsizedWindowNote(skipped, profile) {
  if (!skipped) return null;
  // Named for what it is on each path. An ad-hoc `--base-url` run has no config
  // entry, so "set contextLength for X" would name one the user does not have.
  // Read from the profile rather than compared against its NAME: a user may
  // legitimately configure a provider called "custom".
  const server = profile.adHoc ? 'the server given with --base-url' : `"${profile.name}"`;
  const remedy = profile.adHoc
    ? 'Add a provider entry with "contextLength" to the config, or pass --provider to name one,'
    : `Set "contextLength" for "${profile.name}" in the config`;
  return (
    `NOTE: the context window for ${server} could not be determined, so the diff-covered changed ` +
    `files were not sent whole — the model saw only their hunks. ${remedy} to send them whole.`
  );
}

/**
 * Every reason this result may be less than it appears, in one place.
 *
 * Each is a claim about what happened, so each must be true on every path that
 * can reach it — the repo's most-repeated defect is a message whose precondition
 * differs from the condition actually tested. Kept together because they are one
 * idea, and because a new one added beside them inherits the same scrutiny.
 */
function caveats({ dropped, atCap, analysisCut, hunksOnly, unreadable, skippedUnsizedWindow }, profile) {
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
  // Directly after the state note it explains, and before the rest: a reader who
  // has just been told the model saw only hunks is owed the reason and the fix
  // in the next breath.
  const unsized = unsizedWindowNote(skippedUnsizedWindow, profile);
  if (unsized) notes.push(unsized);
  const missing = unreadableNote(unreadable);
  if (missing) notes.push(missing);
  if (dropped > 0) {
    notes.push(`(${dropped} finding(s) were dropped: they named no file or no defect, so nothing could be checked.)`);
  }
  return notes;
}

/**
 * The findings, ordered by severity. Framed as claims, not conclusions: they
 * come from a small local model and have not been checked against the code yet.
 */
export function renderFindings(parsed, { label, profile, model }) {
  const { findings, summary } = parsed;
  const lines = [`${findings.length} finding(s) from ${model} on ${profile.name} — ${label}`, ''];

  if (findings.length === 0) {
    lines.push('No defects reported.');
  } else {
    const sorted = [...findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    lines.push(sorted.map(renderFinding).join('\n\n'));
  }

  if (summary) lines.push('', `Summary: ${summary}`);
  for (const note of caveats(parsed, profile)) lines.push('', note);
  lines.push('', 'These are unverified claims from a local model. Check each one against the code before acting on it.');
  return lines.join('\n');
}
