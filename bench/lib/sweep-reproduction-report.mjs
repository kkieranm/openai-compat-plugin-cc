// Render the cross-run reproduction model (from sweep-reproduction.mjs) as Markdown.
//
// Every `${…}` interpolation in this file is a `safeInline`/`displayReason` call —
// it is in tests/structure.test.js's SWEEP_RENDER_FILES, whose anchored grammar admits
// nothing else, so a new unwrapped `${…}` sink fails that test. Every untrusted scalar
// (stamp, model, sha, subject, reason, axis value) reaches such an interpolation — the
// matrix data row's sha and n/k counts included. ONE untrusted value stays outside the
// grammar's view: the matrix COLUMN HEADER composes a variable number of run stamps via
// `runs.map((r) => safeInline(r.stamp))` — wrapped, but not a `${…}` — so a stamp there
// is safe, yet a value ADDED to that map must be wrapped by hand. The per-row cell glyphs
// and the ` ⚑` flag are fixed trusted text, not untrusted values. compare-report.mjs
// shares that column-header residual; its data rows go further and concatenate wholly,
// where this file's data row keeps sha/n/k as scanned sinks.
import { safeInline, displayReason } from './markdown-safe.mjs';
import { groupRuns, reproductionOf } from './sweep-reproduction.mjs';

// The short-sha width the sibling sweep reports (sweep-report.mjs, sweep-health.mjs)
// already use, so the same commit reads identically across reports.
const SHORT = (sha) => (typeof sha === 'string' ? sha.slice(0, 9) : String(sha));

// The matrix cell for one run's outcome on one commit. Only a completed review is
// a finding-bearing or clean observation; everything else — a starved sha, an
// absent one — reads as not-reviewed. Grouped runs are gap-free by construction,
// so no gap cell arises here (a gap forces its run ungroupable). Metacharacter-free.
const cell = (outcome) => (outcome === 'findings' ? 'F' : outcome === 'clean' ? '·' : '—');

const axisValue = (axis) => (axis.state === 'known' ? JSON.stringify(axis.value) : 'unrecorded');

// One run's identity line: stamp, observed model, and the window it ran under.
function runLine(run) {
  const model = run.signature.hard.observedModel;
  const modelText = model.state === 'known' ? model.value : 'model unprovable';
  return `- ${safeInline(run.stamp)} — ${safeInline(modelText)}, ${safeInline(axisValue(run.signature.hard.maxSeconds))}s cap`;
}

// The per-run integrity + gap disclosure: a lost record is named by sha, never
// collapsed into the matrix's not-reviewed cell, because a settled-but-lost write
// is a different fact from a commit a run never reached.
function integritySection(runs) {
  const damaged = runs.filter((run) => run.integrity.gaps.length > 0 || run.integrity.discarded > 0);
  if (damaged.length === 0) return [];
  const lines = ['', '### Lost records (integrity)', ''];
  for (const run of damaged) {
    lines.push(`- ${safeInline(run.stamp)}: ${safeInline(String(run.integrity.discarded))} discarded line(s)`);
    for (const gap of run.integrity.gaps) {
      lines.push(`  - gap at ${safeInline(SHORT(gap.sha))} — ${displayReason(gap.why)}`);
    }
  }
  return lines;
}

// The truncated/substituted leads: real signal, but non-observations for the rate,
// so they are listed apart from it and never counted.
function leadsSection(runs) {
  const withLeads = runs.filter((run) => run.leads.length > 0);
  if (withLeads.length === 0) return [];
  const lines = ['', '### Leads (truncated/substituted — not counted)', ''];
  for (const run of withLeads) {
    for (const lead of run.leads) {
      const subject = lead.subject ? ` — ${safeInline(lead.subject)}` : '';
      lines.push(
        `- ${safeInline(run.stamp)} ${safeInline(SHORT(lead.sha))}` + subject
          + `: ${safeInline(lead.outcome)}, ${safeInline(String(lead.count))} finding(s)`,
      );
    }
  }
  return lines;
}

function ungroupableSection(group) {
  const [run] = group.runs;
  return ['', `## Ungroupable: ${safeInline(run.stamp)}`, '', `Not comparable — ${displayReason(group.reason)}.`];
}

function comparableSection(group, index) {
  const result = reproductionOf(group);
  const { runs } = result;
  const lines = ['', `## Comparable group ${safeInline(String(index))}`, ''];
  for (const run of runs) lines.push(runLine(run));

  if (result.suppressed) {
    lines.push('', '**Ranking withheld — the runs are not like-for-like:**');
    for (const s of result.suppressions) {
      lines.push(`- \`${safeInline(s.axis)}\` differs across runs: ${safeInline(s.values.join(', '))}`);
    }
    return lines;
  }

  for (const caveat of result.caveats) {
    lines.push('', `> ⚠ \`${safeInline(caveat.axis)}\` is unverifiable for: ${safeInline(caveat.runs.join(', '))} — reproduction is reported despite it.`);
  }

  const { aggregate, rows, perRun } = result;
  lines.push('', `**Reproduction:** ${safeInline(String(aggregate.unanimous))} of ${safeInline(String(aggregate.comparableCommits))} commits reviewed by ≥2 runs agreed (all reviewing runs clean, or all reviewing runs finding-bearing).`);
  lines.push('', `**Finding-bearing reproduction:** ${safeInline(String(aggregate.findingBearingReproduced))} of ${safeInline(String(aggregate.findingBearingCommits))} finding-bearing commits reproduced — every reviewing run found a finding. _(Outcome-level: agreement that a finding exists, not that it is the same one.)_`);

  lines.push('', '**Per run:**');
  for (const p of perRun) {
    lines.push(`- ${safeInline(p.stamp)}: ${safeInline(String(p.reviewedCount))} reviewed, ${safeInline(String(p.findingBearingCount))} finding-bearing`);
  }

  // The matrix: one row per commit reviewed by >=1 run, cells across the runs. The
  // column header composes a variable number of run stamps by concatenation (runs.map,
  // no `${…}` — the residual noted in the file header); each data row keeps sha/n/k as
  // scanned `${…}` sinks, and only its per-run cell glyphs and flag are concatenated.
  lines.push('', '| commit | ' + runs.map((r) => safeInline(r.stamp)).join(' | ') + ' | n | k |', '| --- | ' + runs.map(() => '---').join(' | ') + ' | --- | --- |');
  for (const row of rows) {
    const cells = row.cells.map((c) => safeInline(cell(c.outcome))).join(' | ');
    const flag = row.flagged ? ' ⚑' : '';
    lines.push(`| ${safeInline(SHORT(row.sha))}` + flag + ' | ' + cells + ` | ${safeInline(String(row.n))} | ${safeInline(String(row.k))} |`);
  }
  lines.push('', '_`F` finding-bearing · `·` clean · `—` not reviewed · `⚑` reviewed by one run only (no reproduction claim)._');

  return lines;
}

/**
 * The whole report: a header, then one section per group. A comparable group with
 * <2 runs, or whose runs share no reviewed commit, still renders (its per-run
 * totals and any integrity/leads are real), with the reproduction line reading 0
 * of 0 rather than a spurious rank.
 */
export function renderReproduction(runs, droppedDuplicates = 0) {
  const groups = groupRuns(runs);
  const dropped = droppedDuplicates > 0
    ? ` ${safeInline(String(droppedDuplicates))} duplicate ledger(s) (alias or copy of a run) collapsed.`
    : '';
  const lead = `${safeInline(String(runs.length))} run(s) read.` + dropped;
  const lines = ['# Cross-run sweep reproduction', '', lead];
  let index = 0;
  for (const group of groups) {
    if (group.groupable) {
      index += 1;
      lines.push(...comparableSection(group, index));
    } else {
      lines.push(...ungroupableSection(group));
    }
    // The integrity and leads disclosures are the same for every group shape —
    // both read group.runs, which an ungroupable group carries as its singleton —
    // so they hang here once rather than at each section's return.
    lines.push(...integritySection(group.runs), ...leadsSection(group.runs));
  }
  return lines.join('\n') + '\n';
}
