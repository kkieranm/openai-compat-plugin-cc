// Turning benchmark runs into something a person can read and paste into an ADR.
//
// The wording here is load-bearing, not decoration. Every number this prints is
// about to be quoted in a design document as evidence, so each one has to say
// what it actually measured — which is narrower than "how good the reviewer is"
// in three separate ways, all named below.

/** Runs the model never finished. Their empty findings mean "did not look", not "found nothing". */
function cutRuns(runs) {
  return runs.filter((run) => run.report?.analysisCut || run.report?.finishReason === 'length');
}

function pct(found, total) {
  if (total === 0) return 'n/a';
  return `${Math.round((found / total) * 100)}%`;
}

function caseRows(results) {
  return results.map((result) => {
    const { caseDef, runs } = result;
    const scored = runs.filter((run) => run.score);
    const listed = caseDef.defects.length;
    const found = scored.reduce((total, run) => total + run.score.recall.found, 0);
    const anchored = scored.reduce((total, run) => total + run.score.recall.anchored, 0);
    const unmatched = scored.reduce((total, run) => total + run.score.unmatched.length, 0);
    const failed = runs.filter((run) => run.error).length;
    const seconds = runs.filter((run) => run.report).map((run) => run.report.durationMs / 1000);
    return {
      id: caseDef.id,
      listed,
      dropped: caseDef.dropped.length,
      opportunities: listed * scored.length,
      found,
      anchored,
      unmatched,
      failed,
      cut: cutRuns(runs).length,
      runs: runs.length,
      diffOnly: runs.some((run) => run.diffOnly),
      tokens: runs.reduce((total, run) => total + (run.report?.usage?.prompt_tokens ?? 0), 0),
      seconds: seconds.length ? `${Math.min(...seconds).toFixed(0)}–${Math.max(...seconds).toFixed(0)}` : '—',
    };
  });
}

function table(rows) {
  const lines = [
    '| case | defects found | anchored | unmatched | cut runs | failed | prompt tokens | seconds |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const recallCell = row.listed === 0
      ? '— (control)'
      : `${row.found}/${row.opportunities} (${pct(row.found, row.opportunities)})`;
    lines.push(
      `| \`${row.id}\`${row.dropped ? ` +${row.dropped} unlisted` : ''} | ${recallCell} | ${row.anchored} `
      + `| ${row.unmatched} | ${row.cut}/${row.runs} | ${row.failed} | ${row.tokens} | ${row.seconds} |`,
    );
  }
  return lines;
}

/**
 * The caveats, stated every time rather than left to the reader's memory.
 *
 * Each is a way this table is narrower than it looks, and each has already
 * misled someone in this repo's own record: a single run was read as a result
 * (OAI-9 measured a 20% hit rate per run), a cut run was read as a clean pass
 * (trap instance 14), and an unmatched finding was called a false positive when
 * it may be a real catch the anchor missed.
 */
function caveats(rows, runsPerCase, diffOnly) {
  const notes = [];
  // Named, not assumed. --diff-only cannot apply to a `file` case, so asking for
  // it switches some cases and not others; a reader comparing two runs would
  // otherwise credit the difference to a switch that never reached every row.
  if (diffOnly) {
    const applied = rows.filter((row) => row.diffOnly).map((row) => `\`${row.id}\``);
    const skipped = rows.filter((row) => !row.diffOnly).map((row) => `\`${row.id}\``);
    notes.push(
      `**\`--diff-only\` applied to ${applied.join(', ') || 'no cases'}.**`
      + (skipped.length
        ? ` It does not apply to ${skipped.join(', ')} — a file case has no diff to reduce to, so `
          + 'those rows are unchanged and are not part of the comparison.'
        : ''),
    );
  }
  if (runsPerCase === 1) {
    notes.push(
      '**One run per case: this is a sample, not a score.** The same command has produced 1,709 and '
      + '5,450 output tokens on identical input, and a single pass found a real defect in 1 run of 5. '
      + 'Raise --runs before drawing an A/B conclusion from any difference here.',
    );
  }
  const cut = rows.reduce((total, row) => total + row.cut, 0);
  if (cut > 0) {
    notes.push(
      `**${cut} run(s) were cut off mid-reasoning** and are excluded from nothing — their empty findings `
      + 'mean the model never finished looking, not that the code was clean. Treat their rows as missing '
      + 'data rather than as zeroes.',
    );
  }
  const dropped = rows.reduce((total, row) => total + row.dropped, 0);
  if (dropped > 0) {
    notes.push(
      `**Recall is measured against ${rows.reduce((total, row) => total + row.listed, 0)} listed defects, `
      + `not against everything history claims.** ${dropped} further defect(s) are recorded in the manifests `
      + 'as dropped, each with a reason — they could not be located in the snapshot, so scoring them would '
      + 'be invention. The denominator is smaller than the truth, which flatters recall.',
    );
  }
  notes.push(
    '**"Unmatched" is not "false positive".** The scorer matches a quoted anchor line or a line range, so '
    + 'it undercounts a finding that describes a known defect in different words. Only `docs-only` — which '
    + 'contains no code — turns unmatched into false-positive by construction.',
  );
  return notes;
}

export function renderReport(results, { runsPerCase, model, provider, diffOnly }) {
  const rows = caseRows(results);
  const lines = [
    `# Benchmark — ${provider} / ${model}${diffOnly ? ' (--diff-only)' : ''}`,
    '',
    `${results.length} case(s), ${runsPerCase} run(s) each.`,
    '',
    ...table(rows),
    '',
  ];
  for (const note of caveats(rows, runsPerCase, diffOnly)) lines.push(note, '');

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

  const failures = results.flatMap(({ caseDef, runs }) =>
    runs.filter((run) => run.error).map((run) => `- \`${caseDef.id}\`: ${run.error}`));
  if (failures.length > 0) lines.push('## Runs that did not complete', '', ...failures, '');

  return lines.join('\n');
}
