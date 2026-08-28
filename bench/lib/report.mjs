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
import { reliabilitySection } from './reliability-report.mjs';
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

function tokenCell({ values, measured, completed }) {
  // Em dash, not 0. The old `?? 0` printed a zero-token prompt for a case whose
  // runs all failed, which is a measurement nobody made.
  if (values.length === 0) return '—';
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = low === high ? `${low}` : `${low}–${high}`;
  // Carrying coverage like the timing cells rather than printing a bare range.
  // A prompt size is read from the tokenizer of the model that answered, so a
  // substituted run's is dropped — and without the suffix that exclusion is
  // invisible here while its neighbours declare theirs.
  return measured === completed ? range : `${range} (${measured}/${completed} measured)`;
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
  if (row.control) return '— (control)';
  return `${row.found}/${row.opportunities} (${pct(row.found, row.opportunities)})`;
}

/**
 * The unmatched count, named for what it actually is on this row.
 *
 * On an ordinary case an unmatched finding may be a real defect the anchor-line
 * matcher missed in different words, so the bare count is right and the caveat
 * says why it is not a false-positive tally. On a control — a clean target with
 * no catalogued defects — there is nothing for a finding to have matched, so
 * every unmatched finding is a false positive by construction. The cell says so
 * itself, rather than leaving a reader to carry a prose rule over to the right
 * column. Marked for every measured control value, `0 (false pos)` included — an
 * unmarked control `0` is indistinguishable from an ordinary `0`, when one is
 * perfect precision and the other is an ordinary scoring artifact.
 *
 * But an em dash, not `0 (false pos)`, when NO run was scored: with nothing
 * measured there is no precision to claim, and the affirmative label would be a
 * measurement nobody made — exactly the trap `tokenCell` guards against for a
 * case whose runs all failed.
 */
function unmatchedCell(row) {
  if (!row.control) return `${row.unmatched}`;
  return row.scored === 0 ? '—' : `${row.unmatched} (false pos)`;
}

/**
 * The distinct lenses a case reviewed at, joined — or an em dash when no run was
 * measurable, matching `tokenCell`'s own "nobody measured this". The join, never
 * a pick, is the point: `whole@154624 / hunks@61696` in one cell is the divergence
 * a silent single value would hide.
 */
// The cell for a deduped set of labels — the lens rungs, the reasoning states —
// joined, or an em dash when no run was measurable. One helper across both
// columns, the same way `rangeCell` already serves prefill and generation.
function setCell(values) {
  return values.length > 0 ? values.join(' / ') : '—';
}

function table(rows) {
  const lines = [
    // Prefill and generation are two columns, never one. They are not two views
    // of the same quantity: a prompt cache moves the first by tens of times and
    // leaves the second alone, so summing them produces a figure that describes
    // neither, which is exactly what the `seconds` column they replace did.
    //
    // `lens` sits beside `prompt tokens` on purpose: a hunks lens is why a
    // prompt-token count is small, and reading the pair together is what tells a
    // reviewer two rows were not reviewed at the same depth.
    '| case | defects found | unresolved | anchored | unmatched | scored | truncated | unreadable | failed '
    + '| lens | reasoning | prompt tokens | prefill s | generate s | gen tok/s |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
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
    //
    // A list, not one sub-count: both kinds can occur in the same case, and a
    // cell that could only name one of them would have to pick, silently
    // dropping the other from view while still counting it in `failed`.
    const why = [
      ...(row.timedOut ? [`${row.timedOut} timed out`] : []),
      ...(row.substituted ? [`${row.substituted} substituted`] : []),
    ];
    const failedCell = why.length > 0 ? `${row.failed} (${why.join(', ')})` : `${row.failed}`;
    lines.push(
      `| \`${row.id}\`${row.dropped ? ` +${row.dropped} unlisted` : ''} | ${recallCell(row)} | ${row.unresolved} `
      + `| ${row.anchored} | ${unmatchedCell(row)} | ${scoredCell} | ${row.truncated} | ${row.unreadable} | ${failedCell} `
      + `| ${setCell(row.lens)} | ${setCell(row.reasoning)} | ${tokenCell(row.tokens)} | ${rangeCell(row.prefill)} | ${rangeCell(row.generation)} | ${rateCell(row.rate)} |`,
    );
  }
  return lines;
}

export function renderReport(results, { runsPerCase, model, provider, diffOnly, cold, structuredOutput, timeoutSeconds, maxSeconds, maxTokens, temperature }) {
  const rows = caseRows(results, { cold });
  const lines = [
    `# Benchmark — ${provider} / ${model}${diffOnly ? ' (--diff-only)' : ''}${cold ? ' (--cold)' : ''}`
    + `${structuredOutput ? ' (--structured-output)' : ''}`,
    '',
    `${results.length} case(s), ${runsPerCase} run(s) each.`,
    '',
    ...table(rows),
    '',
  ];
  for (const note of caveats(rows, runsPerCase, { diffOnly, cold, structuredOutput, timeoutSeconds, maxSeconds, maxTokens, temperature })) lines.push(note, '');

  lines.push(...supplements(results));
  return lines.join('\n');
}

/**
 * The residue sections below the table, lifted out of `renderReport` at the
 * function size budget — which it sat exactly on, so the reliability section
 * could not have been added without this.
 */
function supplements(results) {
  const lines = [];
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
  lines.push(...reliabilitySection(results));
  lines.push(...failureSections(results));
  return lines;
}

/**
 * Runs that produced nothing, and runs the wrong model answered.
 *
 * **`## Logical runs that did not complete`**, named for the thing it counts.
 * Physical attempts get their own section above, and the parallel wording is
 * what makes the distinction self-evident to someone skimming headings: a run
 * answered by its third attempt completed, and belongs in neither.
 *
 * Substitutions are excluded here for the same reason and given their own
 * section. They are recorded as failures, but a substituted run completed
 * perfectly — it answered, parsed and was timed. What failed was the
 * attribution, and filing it under a heading that says otherwise is the kind of
 * near-miss label this report exists to remove.
 *
 * Whole stderr, indented, rather than a one-line summary of it: reducing it was
 * what let a hint be printed as the diagnosis.
 */
function failureSections(results) {
  const lines = [];
  const failures = results.flatMap(({ caseDef, runs }) =>
    runs.filter((run) => run.error && run.reason !== 'model-substituted').flatMap((run) => [
      `- \`${caseDef.id}\`:`,
      ...String(run.error).split('\n').map((line) => `      ${line}`),
    ]));
  if (failures.length > 0) lines.push('## Logical runs that did not complete', '', ...failures, '');

  const substituted = results.flatMap(({ caseDef, runs }) =>
    runs.filter((run) => run.reason === 'model-substituted')
      .map((run) => `- \`${caseDef.id}\`: asked for \`${run.report?.requestedModel}\`, `
        + `\`${run.report?.model}\` answered.`));
  if (substituted.length > 0) {
    lines.push(
      '## Runs answered by a different model',
      '',
      'The server was asked for one model and answered as another. These runs completed and their'
      + ' replies are kept in the per-run record, but they are excluded from scoring and from every'
      + ' timing figure above: they measure the model that answered, not the one this report names.',
      '',
      ...substituted,
      '',
    );
  }
  return lines;
}
