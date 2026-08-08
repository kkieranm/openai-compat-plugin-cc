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
import { REVIEWED } from './sweep-outcome.mjs';

/**
 * Why each non-reviewed outcome left no findings, in the reader's terms.
 *
 * Prose lives here rather than at the call site so that adding an outcome
 * without explaining it is a visible omission rather than a blank cell.
 */
const WHY = {
  starved: 'ran out of tokens before writing findings — the model reasoned until the budget was gone (OAI-115)',
  truncated: 'the model\'s analysis was cut off before it finished looking, so whatever it managed to say is not a review of this commit',
  unreadable: 'the model answered, but the reply could not be parsed as findings',
  substituted: 'a DIFFERENT model answered than the one requested, so this is not a review by the model asked for',
  crashed: 'the review process died without emitting a report',
  'output-too-large': 'the reply exceeded this harness\'s own capture limit — a sweep defect, not a failure of the review',
  failed: 'the review failed',
  'skipped-deadline': 'the wall-clock deadline passed before this commit was reached',
  'skipped-abort': 'the sweep aborted on repeated server failures before reaching this commit',
  'skipped-no-code': 'the commit touched none of the included paths',
};

/** The model that answered, where one did — rendered on every row, not just findings. */
function answeredBy(entry) {
  return entry.model ? ` *(answered by \`${entry.model}\`)*` : '';
}

/**
 * The caveats that ride along with a review that DID complete.
 *
 * `atCap` and `dropped` do not stop a review counting — findings were produced —
 * but both mean the list is shorter than what the model had to say, and a reader
 * comparing two commits' counts needs to know which.
 */
function incompleteness(entry) {
  const notes = [];
  if (entry.atCap) notes.push('the findings list hit the reporting cap, so it is not the whole of what was found');
  if (entry.dropped) notes.push(`${entry.dropped} finding(s) the model emitted were discarded as unusable (they named no file or no defect)`);
  if (entry.hunksOnly) notes.push('the changed files did not fit the window, so only the diff was reviewed — not the files whole');
  if (entry.rawTruncated) notes.push('the raw reply was truncated in the machine record');
  return notes;
}

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
    lines.push(`### ${subjectLine(entry)}`, '', `*answered by \`${entry.model ?? 'unknown'}\`*`, '');
    for (const note of incompleteness(entry)) lines.push(`> **Incomplete:** ${note}`, '');
    lines.push(...findingLines(entry), '');
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
    // `entry.reason` is the code the classifier captured; without it every
    // failure renders identically and a `bad-json` night is indistinguishable
    // from a `deadline-timeout` one.
    const why = entry.reason ? `${WHY[entry.outcome] ?? 'no explanation recorded'} (\`${entry.reason}\`)` : (WHY[entry.outcome] ?? 'no explanation recorded');
    lines.push(`- ${subjectLine(entry)} — **${entry.outcome}**: ${why}${answeredBy(entry)}`);
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
  // From the enumeration, not from `entries.length`. They agree, and the count
  // the reader is owed is how many commits were CONSIDERED — which must not
  // become a function of how many happened to get recorded.
  const enumerated = record.enumerated ?? record.entries.length;
  return [
    '# Overnight review sweep',
    '',
    `- **Started** ${record.startedAt} · **ended** ${record.endedAt}`,
    `- **Stopped because** ${record.stoppedBecause}`,
    `- **Model requested** \`${record.requestedModel ?? '(provider default)'}\``,
    `- **Enumerated** ${enumerated} commits · **reviewed** ${reviewed} · **no review** ${enumerated - reviewed}`,
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
