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
// **Every enumerated commit is disposed of in EXACTLY ONE section** — `Findings`,
// `Reviewed, nothing reported`, or `Coverage` — never absent from all three and
// never in two of them. A review that did not complete can still have reported
// something real, and those leads render UNDER ITS COVERAGE ROW with the same
// detail a completed review's would get: disposition and surfacing are the same
// act, so a lead is never lost and a commit is never counted twice.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { incompleteness } from './sweep-notes.mjs';
import { serverHealth } from './sweep-health.mjs';
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
  // Only `recover-sweep.mjs` mints this one, and it must NOT be read as "the run
  // never settled it": since a ledger write can fail without ending the run, an
  // absent entry means either never-reached or settled-and-lost, and nothing on
  // disk distinguishes them. It is not a review that failed — nothing is known
  // about it either way, which is exactly why it must still appear rather than
  // being silently absent from a recovered report.
  unobserved: 'the ledger has no entry for it — the run either never reached this commit or settled it and lost the write, and nothing on disk can tell which',
  // Distinct from `unobserved` on purpose: here the run demonstrably DID settle
  // the commit and the ledger write failed, so the record is lost rather than
  // unknown to have existed.
  unrecorded: 'the run settled this commit and the ledger write failed, so whatever it found was lost',
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
 * Did this review report anything, whatever became of the review itself?
 *
 * Keyed on the findings the entry CARRIES, never on `outcome === 'findings'`. A
 * `truncated` or `substituted` review is not a review of the commit — that is why
 * neither counts as reviewed — but whatever leads it emitted are still leads, and
 * an earlier version dropped them from the morning artifact entirely, leaving
 * them only in the raw JSON.
 */
function hasFindings(entry) {
  return Array.isArray(entry.findings) && entry.findings.length > 0;
}

/**
 * Everything a reader needs about one commit's findings, in one place.
 *
 * Shared by the Findings section and by a Coverage row that carries findings, so
 * the two cannot drift: a lead surfaced from a review that did NOT complete gets
 * the same file, line, severity, summary and evidence, the same answering model
 * and the same incompleteness notes as one from a review that did. Rendering the
 * second more thinly would trade one reporting defect for another.
 */
function findingsBlock(entry, indent = '', { attribute = true } = {}) {
  // The caller may already have named the answering model on its own row — a
  // coverage row does. Naming it twice for one commit is noise the tests could
  // not see, since they assert the string is PRESENT.
  const lines = attribute ? [`${indent}*answered by \`${entry.model ?? 'unknown'}\`*`, ''] : [];
  for (const note of incompleteness(entry)) lines.push(`${indent}> **Incomplete:** ${note}`, '');
  for (const line of findingLines(entry)) lines.push(`${indent}${line}`);
  lines.push('');
  return lines;
}

function findingsSection(entries) {
  // REVIEWED only. A non-reviewed entry's findings are rendered under its
  // coverage row instead, so that each commit is disposed of exactly once.
  const found = entries.filter((entry) => REVIEWED.has(entry.outcome) && hasFindings(entry));
  if (found.length === 0) return ['## Findings', '', 'None reported by a completed review. **Read the coverage section before concluding anything from that** — a commit whose review did not complete can still have reported something, and it is listed there.', ''];
  const lines = ['## Findings', ''];
  for (const entry of found) {
    // The answering model per commit, never once in the header: it can differ
    // request to request, and a single header value would assert a uniformity
    // nothing enforces.
    lines.push(`### ${subjectLine(entry)}`, '', ...findingsBlock(entry));
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
    if (hasFindings(entry)) {
      // A review that did not complete can still have reported something real,
      // and those leads are why OAI-120 mattered. They are rendered HERE rather
      // than in the Findings section so the commit is disposed of exactly once —
      // with the same detail, flagged by the outcome that disqualifies it.
      lines.push('', `  **It reported the following before it was disqualified — treat as leads only:**`, '');
      lines.push(...findingsBlock(entry, '  ', { attribute: false }));
    } else {
      // Caveats are rendered from what the entry CARRIES, for every row — not
      // only where the outcome happened to be `findings`. A `clean` entry with
      // `hunksOnly` is a completed review of a diff, not of the files whole, and
      // the report's permanent caveat claims otherwise unless this says so.
      for (const note of incompleteness(entry)) lines.push(`  - *${note}*`);
    }
  }
  lines.push('');
  return lines;
}

function tally(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([outcome, n]) => `${outcome}: ${n}`).join(' · ');
}

/**
 * Say so when a run found fewer eligible commits than it was asked for.
 *
 * A short arm otherwise reads as a completed one: the counts a reader sees are
 * enumerated and reviewed, neither of which reveals that ten were requested and
 * six were reachable. For a benchmark comparing arms, that is the difference
 * between a result and an artefact of where the scan stopped.
 */
function shortfall(record) {
  const asked = record.requestedCommits;
  const found = record.eligible;
  if (asked === undefined || found === undefined || found >= asked) return '';
  // WHICH cause, not a guess. The walk either stopped because the scan limit was
  // reached, or because the history reachable from the pinned start ran out —
  // and a pinned start makes the second routine. Naming the scan limit either
  // way sent a reader to tune a knob that was never the constraint.
  const hitLimit = record.scanLimit !== undefined && record.walked !== undefined && record.walked >= record.scanLimit;
  const cause = hitLimit
    ? `the scan stopped at its \`--scan-limit\` of ${record.scanLimit} commits`
    : `only ${record.walked ?? 'those'} commits are reachable from that revision`;
  return ` — **only ${found} of the ${asked} requested commits were eligible**: ${cause}`;
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
    // A recovered run passes `endedAt: null` on purpose — it was killed, so it
    // has no end, and the last thing observed is stated in `stoppedBecause`
    // where it can be labelled as an observation rather than an ending.
    `- **Started** ${record.startedAt} · **ended** ${record.endedAt ?? 'not observed'}`,
    // Always, even for a self-review: its ABSENCE is exactly what let a
    // foreign --repo run's artifact go unattributed (OAI-165 review).
    `- **Repository** \`${record.repo ?? '(not recorded)'}\``,
    `- **Stopped because** ${record.stoppedBecause}`,
    `- **Model requested** \`${record.requestedModel ?? '(provider default)'}\``,
    `- **Enumerated** ${enumerated} commits · **reviewed** ${reviewed} · **no review** ${enumerated - reviewed}`,
    `- **Per-commit cap** ${record.maxSeconds}s · **paths included** ${record.include.join(', ')}`,
    // The window this run walked. Without it the artifact cannot say what it
    // enumerated FROM, and two arms of a benchmark cannot be shown to have
    // reviewed the same commits.
    `- **Enumerated from** \`${record.from ?? 'HEAD'}\`${shortfall(record)}`,
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
 * review sees AT MOST the changed files whole (ADR 005) and nothing the commit
 * did not touch, so it cannot see a defect in an existing caller elsewhere. "At
 * most" because this section covers every entry, so it must hold for the worst.
 */
function caveats() {
  return [
    '## What these are, and are not',
    '',
    '- **Unverified claims from a small local model.** Nothing here read the code to check a finding.',
    '  Treat every one as a lead to confirm or refute, never as a conclusion.',
    '- **Commit-local leads.** Each review saw one commit and nothing else, so a defect in the relationship',
    '  between a change and an existing caller elsewhere is invisible to it. Whether it saw that commit\'s',
    '  files whole or only its diff hunks is per entry, in the coverage notes above.',
    '- **An empty findings list is not a clean bill of health** unless the coverage section is also empty.',
    '',
  ];
}

/** The whole report, newest commit first. */
export function renderSweep(record) {
  return [
    ...header(record),
    ...serverHealth(record.entries, record.abortAfter, record.timelineComplete !== false),
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
  // **The record is private; the rendered report is not, because only this JSON
  // carries the raw material.** `classify` keeps up to `MAX_RAW` of a review's
  // stdout AND stderr per entry and the renderer emits neither — the same
  // material the ledger is created `0o600` for, so leaving the record at a
  // default `0o666` would make the ledger's privacy decorative. Mode applies at
  // creation, which is this case: the stamp is fresh.
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { reportPath, recordPath };
}
