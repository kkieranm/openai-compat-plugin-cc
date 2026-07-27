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

export function buildReviewPrompt({ label, diff, instructions }) {
  const parts = [`Review these ${label} for defects.`];
  if (instructions) parts.push(`The requester adds: ${instructions}`);
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
export function renderFindings({ findings, summary, dropped, atCap, analysisCut }, { label, provider, model }) {
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
  // Said loudly, and before the findings count is believed: the model was cut
  // off while still reasoning, so an empty list here means "did not finish
  // looking", not "found nothing". Without this the reply is identical to a
  // clean review.
  if (analysisCut) {
    lines.push(
      '',
      'WARNING: the model was still reasoning when it hit its length limit, so it never finished ' +
        'looking. Treat this result as incomplete — especially an empty one. Review a smaller ' +
        'target, or raise the limit.',
    );
  }
  // The schema caps the list, so a reply arriving at exactly the cap may have
  // been cut. There is no way to tell "found this many" from "found more and was
  // stopped", so this says that rather than inventing a count it cannot know —
  // but it must be said, because an unreported cut is a defect silently binned.
  if (atCap) {
    lines.push(
      '',
      `(The findings list hit its limit of ${MAX_FINDINGS}, so there may be more. ` +
        'Review a smaller target to see the rest.)',
    );
  }
  if (dropped > 0) {
    lines.push('', `(${dropped} finding(s) were dropped: they named no file or no defect, so nothing could be checked.)`);
  }
  lines.push('', 'These are unverified claims from a local model. Check each one against the code before acting on it.');
  return lines.join('\n');
}
