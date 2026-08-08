// The morning artifact: what the night looked at, what it found, and — the part
// that takes the most care — what it did NOT look at.
//
// A sweep's coverage section is not a footnote. Token exhaustion (OAI-115) is
// the dominant failure mode on this hardware, and a starved run produces no
// findings for exactly the same reason a clean one does: an empty list. If the
// report renders both as silence, a night that measured almost nothing reads as
// a night that found almost nothing, and the reader draws the opposite
// conclusion from the truth. So every commit appears exactly once, in the
// findings section or in coverage, and never in neither.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Outcomes that mean a model actually read the commit and reported on it. */
const REVIEWED = new Set(['findings', 'clean']);

/**
 * Why each non-reviewed outcome left no findings, in the reader's terms.
 *
 * Prose lives here rather than at the call site so that adding an outcome
 * without explaining it is a visible omission rather than a blank cell.
 */
const WHY = {
  starved: 'ran out of tokens before writing findings — the model reasoned until the budget was gone (OAI-115)',
  unreadable: 'the model answered, but the reply could not be parsed as findings',
  substituted: 'a DIFFERENT model answered than the one requested, so this is not a review by the model asked for',
  crashed: 'the review process died without emitting a report',
  failed: 'the review failed',
  'skipped-deadline': 'the wall-clock deadline passed before this commit was reached',
  'skipped-no-code': 'the commit touched none of the included paths',
};

function subjectLine(entry) {
  return `\`${entry.sha.slice(0, 9)}\` ${entry.subject ?? ''}`.trim();
}

function findingLines(entry) {
  return entry.findings.map((finding) => {
    const where = [finding.file, finding.line].filter((part) => part !== undefined && part !== null).join(':');
    const severity = finding.severity ? `**${finding.severity}** ` : '';
    const evidence = finding.evidence ? `\n    > ${String(finding.evidence).replace(/\n/g, '\n    > ')}` : '';
    return `- ${severity}\`${where || '(no location given)'}\` — ${finding.summary ?? '(no summary)'}${evidence}`;
  });
}

function findingsSection(entries) {
  const withFindings = entries.filter((entry) => entry.outcome === 'findings');
  if (withFindings.length === 0) return ['## Findings', '', 'None reported. **Read the coverage section before concluding anything from that.**'];
  const lines = ['## Findings', ''];
  for (const entry of withFindings) {
    // The answering model per commit, never once in the header: it can differ
    // request to request, and a single header value would assert a uniformity
    // nothing enforces.
    lines.push(`### ${subjectLine(entry)}`, '', `*answered by \`${entry.model ?? 'unknown'}\`*`, '', ...findingLines(entry), '');
  }
  return lines;
}

function coverageSection(entries) {
  const missed = entries.filter((entry) => !REVIEWED.has(entry.outcome));
  const lines = ['## Coverage — what was NOT reviewed, and why', ''];
  if (missed.length === 0) {
    lines.push('Every enumerated commit was reviewed.', '');
    return lines;
  }
  lines.push(`**${missed.length} of ${entries.length} enumerated commits produced no review.**`, '');
  for (const entry of missed) {
    lines.push(`- ${subjectLine(entry)} — **${entry.outcome}**: ${WHY[entry.outcome] ?? 'no explanation recorded'}`);
  }
  lines.push('');
  return lines;
}

function tally(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([outcome, n]) => `${outcome}: ${n}`).join(' · ');
}

function header(record) {
  const reviewed = record.entries.filter((entry) => REVIEWED.has(entry.outcome)).length;
  return [
    '# Overnight review sweep',
    '',
    `- **Started** ${record.startedAt} · **ended** ${record.endedAt}`,
    `- **Stopped because** ${record.stoppedBecause}`,
    `- **Model requested** \`${record.requestedModel ?? '(provider default)'}\``,
    `- **Enumerated** ${record.entries.length} commits · **reviewed** ${reviewed} · **no review** ${record.entries.length - reviewed}`,
    `- **Per-commit cap** ${record.maxSeconds}s · **paths included** ${record.include.join(', ')}`,
    `- ${tally(record.entries)}`,
    '',
  ];
}

/**
 * The caveat is part of the artifact, not decoration.
 *
 * These findings are unverified claims from a small local model, and nothing in
 * this run read the code to check one. Saying so in the file means a reader who
 * finds it weeks later, with no memory of how it was produced, still knows what
 * it is worth. The commit-local point matters just as much: a commit-scoped
 * review sees the changed files whole (ADR 005) but nothing the commit did not
 * touch, so it cannot see a defect that lives in an existing caller elsewhere.
 */
function caveats() {
  return [
    '## What these are, and are not',
    '',
    '- **Unverified claims from a small local model.** Nothing here read the code to check a finding.',
    '  Treat every one as a lead to confirm or refute, never as a conclusion.',
    '- **Commit-local leads.** Each review saw one commit: its changed files in full, and nothing else.',
    '  A defect in the relationship between a change and an existing caller elsewhere is invisible to it.',
    '- **An empty findings list is not a clean bill of health** unless the coverage section is also empty.',
    '',
  ];
}

/** The whole report, newest commit first. */
export function renderSweep(record) {
  return [...header(record), ...findingsSection(record.entries), ...coverageSection(record.entries), ...caveats()].join('\n');
}

/**
 * Write the pair, and return where both landed.
 *
 * Deliberately not `bench/lib/record.mjs` `persist`, which hardcodes
 * `<root>/bench/results` — this harness takes `--out-dir` so its own tests never
 * write into the real results directory, and widening `persist` would change a
 * path three other harnesses depend on.
 */
export function writeSweep(outDir, stamp, record) {
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `review-sweep-${stamp}.md`);
  const recordPath = join(outDir, `review-sweep-${stamp}.json`);
  writeFileSync(reportPath, `${renderSweep(record)}\n`);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return { reportPath, recordPath };
}
