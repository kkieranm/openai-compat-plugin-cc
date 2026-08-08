// The morning artifact: what the night looked at, what it found, and — the part
// that takes the most care — what it did NOT look at.
//
// A sweep's coverage section is not a footnote. Token exhaustion (OAI-115) is
// the dominant failure mode on this hardware, and a starved run produces no
// findings for exactly the same reason a clean one does: an empty list. If the
// report renders both as silence, a night that measured almost nothing reads as
// a night that found almost nothing, and the reader draws the opposite
// conclusion from the truth.
//
// **Every enumerated commit is accounted for in exactly one disposition
// section** — `Findings`, `Reviewed, nothing reported`, or `Coverage` — and
// never absent from all three. The findings section additionally surfaces leads
// from a review that did NOT complete, flagged as such, because a lead is worth
// reading even when the review that produced it does not count.
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

/**
 * The model that ANSWERED, where one did.
 *
 * Reads `entry.model`, which only a completed report sets. A failure envelope's
 * `requestedModel` is deliberately kept under its own name and is NOT rendered
 * here: it is the model that was asked, and on a failed row nothing answered.
 * Saying "answered by X" there is the requested-versus-served conflation
 * `adr/011` exists to stop this plugin making.
 */
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
  if (entry.stderrTruncated) notes.push('the captured stderr was truncated in the machine record');
  if (entry.signal) notes.push(`the child was terminated by signal ${entry.signal}`);
  return notes;
}

/**
 * Reviews that completed and reported nothing.
 *
 * **This section exists because without it a plain `clean` commit appeared
 * NOWHERE.** It has no findings, so the findings section skips it; it was
 * reviewed, so coverage skips it — and the whole artifact's stated invariant is
 * that no enumerated commit is absent from both. It was found by writing a test
 * for the renderer rather than the classifier, which is where the previous three
 * defects of this shape had also hidden.
 *
 * Its caveats are rendered here too: a commit reviewed diff-only (`hunksOnly`),
 * or one whose findings were all discarded (`dropped`), is a completed review of
 * something narrower than the report's permanent caveat claims.
 */
function reviewedSection(entries) {
  const quiet = entries.filter((entry) => REVIEWED.has(entry.outcome) && !(entry.findings?.length > 0));
  if (quiet.length === 0) return [];
  const lines = ['## Reviewed, nothing reported', ''];
  for (const entry of quiet) {
    lines.push(`- ${subjectLine(entry)}${answeredBy(entry)}`);
    for (const note of incompleteness(entry)) lines.push(`  - *${note}*`);
  }
  lines.push('');
  return lines;
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

/**
 * Every commit whose review produced findings, WHATEVER its outcome.
 *
 * Keyed on the findings the entry carries, not on `outcome === 'findings'`. A
 * `truncated` review is not a review of the commit — that is why it does not
 * count as reviewed — but whatever leads it did emit are still leads, and the
 * first version of this filter dropped them from the morning artifact entirely,
 * leaving them only in the raw JSON. Incompleteness belongs in the heading of
 * such a section, not in the decision to print it.
 */
function withFindings(entries) {
  return entries.filter((entry) => Array.isArray(entry.findings) && entry.findings.length > 0);
}

function findingsSection(entries) {
  const found = withFindings(entries);
  if (found.length === 0) return ['## Findings', '', 'None reported. **Read the coverage section before concluding anything from that.**'];
  const lines = ['## Findings', ''];
  for (const entry of found) {
    // The answering model per commit, never once in the header: it can differ
    // request to request, and a single header value would assert a uniformity
    // nothing enforces.
    const caveat = REVIEWED.has(entry.outcome) ? '' : ` — **${entry.outcome}**, so this is NOT a completed review of the commit`;
    lines.push(`### ${subjectLine(entry)}${caveat}`, '', `*answered by \`${entry.model ?? 'unknown'}\`*`, '');
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
    // Caveats are rendered from what the entry CARRIES, for every row — not only
    // where the outcome happened to be `findings`. A `clean` entry with
    // `hunksOnly` is a completed review of a diff, not of the files whole, and
    // the report's permanent caveat claims otherwise unless this says so.
    for (const note of incompleteness(entry)) lines.push(`  - *${note}*`);
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
  return [
    ...header(record),
    ...findingsSection(record.entries),
    ...coverageSection(record.entries),
    ...reviewedSection(record.entries),
    ...caveats(),
  ].join('\n');
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
