// Turning benchmark runs into something a person can read and paste into an ADR.
//
// Three files, three questions, all three seams cut by the size ratchet and all
// three real. `run-buckets.mjs` decides which bucket a run falls into;
// `case-rows.mjs` turns runs into the counts and samples a row is made of;
// `caveats.mjs` writes the prose qualifying every figure. What is left here is
// the rendering: cells, the table, and the document around it.
//
// The split worth stating is the last one. A number and the sentence explaining
// what it does not mean have different reasons to change, and keeping them in
// one file is how the sentence quietly stops matching the number.
import { formatRate } from '../../scripts/lib/throughput.mjs';
import { caseRows } from './case-rows.mjs';
import { caveats, pct } from './caveats.mjs';

/**
 * A seconds range, and how much of the case it actually covers.
 *
 * The `(2/3 measured)` suffix is the point. Ranging over whatever figures
 * happened to arrive would print a complete-looking cell for a case where one
 * run never reported one, which is the same defect as a recall denominator
 * computed over two runs while the row says three.
 */
function rangeCell({ values, measured, completed }) {
  if (measured === 0) return '—';
  const seconds = values.map((ms) => ms / 1000);
  const range = `${Math.min(...seconds).toFixed(0)}–${Math.max(...seconds).toFixed(0)}`;
  return measured === completed ? range : `${range} (${measured}/${completed} measured)`;
}

/**
 * A rate range, reusing the measured-coverage suffix the timing cells carry.
 *
 * Rendered through `formatRate`, not a local `toFixed` — the footer prints the
 * same quantity, and two hand-written renderings of one number is how a table
 * and a footer end up disagreeing at the last decimal about a figure they both
 * computed from the same helper.
 */
function rateCell({ values, measured, completed }) {
  if (measured === 0) return '—';
  const low = formatRate(Math.min(...values));
  const high = formatRate(Math.max(...values));
  const range = low === high ? low : `${low}–${high}`;
  return measured === completed ? range : `${range} (${measured}/${completed} measured)`;
}

function tokenCell(values) {
  // Em dash, not 0. The old `?? 0` printed a zero-token prompt for a case whose
  // runs all failed, which is a measurement nobody made.
  if (values.length === 0) return '—';
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low}` : `${low}–${high}`;
}

/**
 * What was actually found — and only that.
 *
 * An earlier draft printed a low–high band here, which was worse than the
 * problem it solved: the high endpoint is not observed recall but the
 * counterfactual that continued reasoning would have found *everything*
 * remaining, so a wholly censored run overlapped a perfect one and the column
 * headed "defects found" reported defects nobody found. The uncertainty is real
 * and stays visible — as its own `unresolved` column, and as a stated bound in
 * the caveats — but it is not smuggled into a figure whose name promises
 * observation.
 */
function recallCell(row) {
  if (row.listed === 0) return '— (control)';
  return `${row.found}/${row.opportunities} (${pct(row.found, row.opportunities)})`;
}

function table(rows) {
  const lines = [
    // Prefill and generation are two columns, never one. They are not two views
    // of the same quantity: a prompt cache moves the first by tens of times and
    // leaves the second alone, so summing them produces a figure that describes
    // neither, which is exactly what the `seconds` column they replace did.
    '| case | defects found | unresolved | anchored | unmatched | scored | truncated | unreadable | failed '
    + '| prompt tokens | prefill s | generate s | gen tok/s |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    // `scored` is printed beside `runs` so the row's own arithmetic can be
    // checked: scored + truncated + unreadable + failed must account for every
    // run, and a reader who cannot see `scored` cannot tell a recall denominator
    // computed over two runs from one computed over three. The cut count rides
    // *inside* the scored cell rather than beside it, because those runs are now
    // scored — printing it as a fifth column would break the sum and read as a
    // bucket it is not.
    const scoredCell = row.cut ? `${row.scored}/${row.runs} (${row.cut} cut)` : `${row.scored}/${row.runs}`;
    // The same shape, for the same reason: a run the wall-clock cap killed is
    // still a failed run, so it stays inside `failed` and the sum holds. What it
    // is *not* is a result about the reviewer — a harness limit and a model that
    // could not answer were one number until the CLI started saying which.
    const failedCell = row.timedOut ? `${row.failed} (${row.timedOut} timed out)` : `${row.failed}`;
    lines.push(
      `| \`${row.id}\`${row.dropped ? ` +${row.dropped} unlisted` : ''} | ${recallCell(row)} | ${row.unresolved} `
      + `| ${row.anchored} | ${row.unmatched} | ${scoredCell} | ${row.truncated} | ${row.unreadable} | ${failedCell} `
      + `| ${tokenCell(row.tokens)} | ${rangeCell(row.prefill)} | ${rangeCell(row.generation)} | ${rateCell(row.rate)} |`,
    );
  }
  return lines;
}

export function renderReport(results, { runsPerCase, model, provider, diffOnly, cold, timeoutSeconds, maxSeconds }) {
  const rows = caseRows(results);
  const lines = [
    `# Benchmark — ${provider} / ${model}${diffOnly ? ' (--diff-only)' : ''}${cold ? ' (--cold)' : ''}`,
    '',
    `${results.length} case(s), ${runsPerCase} run(s) each.`,
    '',
    ...table(rows),
    '',
  ];
  for (const note of caveats(rows, runsPerCase, { diffOnly, cold, timeoutSeconds, maxSeconds })) lines.push(note, '');

  const unmatched = results.flatMap(({ caseDef, runs }) =>
    runs.flatMap((run) => (run.score?.unmatched ?? []).map((finding) => ({ caseId: caseDef.id, finding }))));
  if (unmatched.length > 0) {
    lines.push('## Unmatched findings', '');
    // Printed in full rather than counted. The count alone cannot be checked,
    // and the whole reason to keep a residue is to be able to eyeball what the
    // scorer is missing before trusting the number above it.
    for (const { caseId, finding } of unmatched) {
      lines.push(`- \`${caseId}\` **${finding.file}${finding.line ? `:${finding.line}` : ''}** (${finding.severity}) — ${finding.summary}`);
      if (finding.evidence) lines.push(`  > ${finding.evidence.split('\n')[0].trim().slice(0, 160)}`);
    }
    lines.push('');
  }

  // Whole stderr, indented, rather than a one-line summary of it: reducing it
  // was what let a hint be printed as the diagnosis.
  const failures = results.flatMap(({ caseDef, runs }) =>
    runs.filter((run) => run.error).flatMap((run) => [
      `- \`${caseDef.id}\`:`,
      ...String(run.error).split('\n').map((line) => `      ${line}`),
    ]));
  if (failures.length > 0) lines.push('## Runs that did not complete', '', ...failures, '');

  return lines.join('\n');
}
