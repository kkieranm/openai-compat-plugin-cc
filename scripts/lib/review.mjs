// What the model is asked to do, and how its answer is shown.
import { UserError } from './errors.mjs';
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

// A lens narrows WHAT to look for on one pass, so several passes on one model can
// decorrelate blind spots instead of only sampling noise. A closed named set, not
// free-form text: the run records which lens produced each finding, and a
// comparison can only rank two runs as like-for-like if the lens is drawn from a
// bounded vocabulary. Each directive is a short focus clause in the same
// terse-and-negative register as the rules above — it re-weights attention and
// never restages the reply: the findings-JSON contract is lens-blind.
export const LENSES = {
  correctness:
    'Focus this pass on CORRECTNESS: logic errors, wrong results, off-by-one and boundary mistakes, ' +
    'broken or violated contracts between caller and callee, state left inconsistent on an error path.',
  security:
    'Focus this pass on SECURITY: injection, missing authentication or authorization, unsafe handling ' +
    'of untrusted input, leaked secrets or credentials, unsafe deserialization, and unchecked resource access.',
  'edge-cases':
    'Focus this pass on EDGE CASES: empty, null, zero and maximum inputs, concurrency and ordering, ' +
    'resource exhaustion, partial failure, and the error paths a happy-path reading skips.',
};

/**
 * The focus clause for a named lens, or a refusal naming the set — the one place
 * a lens name is turned into text, so an unknown name cannot reach a request. The
 * caller guards the call on a lens being set (a lens-less run must never invoke
 * this), because an unknown name is a mistake worth a loud stop, not a silent
 * default.
 */
export function lensDirective(name) {
  const directive = Object.hasOwn(LENSES, name) ? LENSES[name] : undefined;
  if (!directive) {
    throw new UserError(`Unknown --lens "${name}".`, {
      hint: `Valid lenses: ${Object.keys(LENSES).join(', ')}.`,
    });
  }
  return directive;
}

/**
 * The `--lens a,b,c` value as a validated list of names, or `[]` when the flag is
 * absent. Every name is checked here — an empty entry (`a,,b`, a trailing comma)
 * is refused rather than silently dropped, and an unknown name throws through
 * `lensDirective` — so a bad list fails before any request, the same up-front
 * posture the numeric flags take. The order is the run order: one pass per name,
 * in the order given.
 */
export function parseReviewLenses(raw) {
  if (raw === undefined || raw === null) return [];
  // Only a string is a lens list. A non-string (a hostile object whose `toString`
  // throws, a symbol) would otherwise leak an uncontrolled error out of `String()`
  // or the error formatting; refuse it as the malformed input it is. The CLI only
  // ever passes a string, so this guards a future caller, not today's path.
  if (typeof raw !== 'string') {
    throw new UserError('--lens must be a comma-separated list of lens names.', {
      hint: `Valid lenses: ${Object.keys(LENSES).join(', ')}.`,
    });
  }
  const names = raw.split(',').map((name) => name.trim());
  const seen = new Set();
  for (const name of names) {
    if (name === '') {
      throw new UserError('--lens has an empty entry.', {
        hint: `Give a comma-separated list of: ${Object.keys(LENSES).join(', ')}.`,
      });
    }
    lensDirective(name); // Throws on an unknown name, naming the valid set.
    // A repeated lens is refused, not silently run twice: one pass per DISTINCT
    // focus is the whole "coverage across focuses" premise — a duplicate would run
    // a focus twice while `mergePasses` dedups its provenance to one lens (so the
    // envelope would under-report the passes), and unbounded repetition would
    // bypass the pass ceiling. Rejecting duplicates is also what makes every merged
    // finding's agreement equal its lens count, which the envelope relies on.
    if (seen.has(name)) {
      throw new UserError(`--lens "${name}" is repeated.`, {
        hint: 'Each lens runs one pass; name each at most once.',
      });
    }
    seen.add(name);
  }
  return names;
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

export const SEVERITY_ORDER = ['high', 'medium', 'low'];

function renderFinding(finding) {
  const place = `${finding.file}${finding.line ? `:${finding.line}` : ''}`;
  const lines = [`${finding.severity.padEnd(6)}  ${place}`, `        ${finding.summary}`];
  if (finding.evidence) lines.push(`        > ${finding.evidence.split('\n')[0].trim()}`);
  return lines.join('\n');
}

/**
 * A fact about the *request*, so every path that shows output derived from it
 * says the same thing — defined once rather than written out at each. The
 * parsed and unparseable paths diverging is how this repo produces that
 * failure: the branch in front of you gets the fix and the adjacent one does
 * not.
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
 * How to name the endpoint whose window is unknown, and how to fix it — the two
 * clauses every "window could not be determined" message needs. Shared so the
 * findings-report note and `/oai:review`'s up-front stderr warning cannot drift
 * on the one part that must be correct: an ad-hoc `--base-url` run has NO config
 * entry, so "set contextLength for X" would name a key the user does not have.
 * Read from the profile, never compared against its NAME — a user may
 * legitimately configure a provider called "custom", which is also the name an
 * ad-hoc run is given.
 */
export function windowSource(profile) {
  return profile.adHoc ? 'the server given with --base-url' : `"${profile.name}"`;
}

export function windowRemedy(profile) {
  return profile.adHoc
    ? 'Add a provider entry with "contextLength" to the config, or pass --provider to name one,'
    : `Set "contextLength" for "${profile.name}" in the config`;
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
 * on a mixed target and would collide with the two-list rule this depends on.
 */
export function unsizedWindowNote(skipped, profile) {
  if (!skipped) return null;
  return (
    `NOTE: the context window for ${windowSource(profile)} could not be determined, so the diff-covered changed ` +
    `files were not sent whole — the model saw only their hunks. ${windowRemedy(profile)} to send them whole.`
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
function caveats({ dropped, atCap, analysisCut, hunksOnly, unreadable, skippedUnsizedWindow, salvaged }, profile) {
  const notes = [];

  // First and loudest — these findings were not written in
  // the model's ordinary findings-first pass: its normal run hit the deadline
  // mid-reasoning, and what is shown is a SECOND, separate request asking it
  // to conclude from that cut-off reasoning. Non-negotiable: a salvaged
  // review must never read as an ordinary complete one.
  if (salvaged) {
    notes.push(
      'WARNING: this review was SALVAGED. The model ran out of time while reasoning; these findings ' +
        'come from a follow-up request asking it to conclude from what it had already worked out, not ' +
        'from its ordinary findings-first pass. Treat this result as less reliable than an ordinary review.',
    );
  }
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
