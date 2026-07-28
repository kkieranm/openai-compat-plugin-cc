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

/**
 * Runs that answered, exited 0, and still produced nothing scoreable — a reply
 * that never parsed, without being truncated.
 *
 * Counted because they used to fall out of *every* bucket at once: not `scored`
 * (no findings), not `cut` (`analysisCut` is null and the finish reason is
 * "stop"), not `failed` (the process succeeded) — while still counting toward
 * the run total, so a row could print "0 cut, 0 failed" over three runs whose
 * recall was computed from two. This is the reachable failure of the degraded
 * rung, where the schema is only a prompt instruction and a weaker model
 * answering in prose is the expected outcome, not a contrived one.
 *
 * Note the `=== true`: `jsonReport` deliberately emits `null` for these flags
 * when nothing could be parsed, meaning "not determined", and reading that null
 * as false is how the run disappeared in the first place.
 */
function unreadableRuns(runs) {
  return runs.filter((run) => run.report && run.report.parsed !== true && !cutRuns([run]).length);
}

function pct(found, total) {
  if (total === 0) return 'n/a';
  return `${Math.round((found / total) * 100)}%`;
}

function caseRows(results) {
  return results.map((result) => {
    const { caseDef, runs } = result;
    // Cut runs are excluded from the recall denominator, not merely flagged
    // beside it. A guillotined reply still parses — complete JSON, usually an
    // empty findings list — so it arrives with a score attached and used to
    // enter recall as a genuine zero, which blames the reviewer for the
    // harness's token budget. ADR 006 says these are "counted separately"; this
    // is what makes that true rather than aspirational.
    const cut = new Set(cutRuns(runs));
    const scored = runs.filter((run) => run.score && !cut.has(run));
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
      unreadable: unreadableRuns(runs).length,
      scored: scored.length,
      runs: runs.length,
      diffOnly: runs.some((run) => run.diffOnly),
      tokens: runs.reduce((total, run) => total + (run.report?.usage?.prompt_tokens ?? 0), 0),
      seconds: seconds.length ? `${Math.min(...seconds).toFixed(0)}–${Math.max(...seconds).toFixed(0)}` : '—',
    };
  });
}

function table(rows) {
  const lines = [
    '| case | defects found | anchored | unmatched | scored | cut | unreadable | failed | prompt tokens | seconds |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const recallCell = row.listed === 0
      ? '— (control)'
      : `${row.found}/${row.opportunities} (${pct(row.found, row.opportunities)})`;
    // `scored` is printed beside `runs` so the row's own arithmetic can be
    // checked: scored + cut + unreadable + failed must account for every run,
    // and a reader who cannot see `scored` cannot tell a recall denominator
    // computed over two runs from one computed over three.
    lines.push(
      `| \`${row.id}\`${row.dropped ? ` +${row.dropped} unlisted` : ''} | ${recallCell} | ${row.anchored} `
      + `| ${row.unmatched} | ${row.scored}/${row.runs} | ${row.cut} | ${row.unreadable} | ${row.failed} `
      + `| ${row.tokens} | ${row.seconds} |`,
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
  const unreadable = rows.reduce((total, row) => total + row.unreadable, 0);
  if (unreadable > 0) {
    notes.push(
      `**${unreadable} run(s) answered but could not be read** — the reply never parsed into findings, and it `
      + 'was not truncated, so it is neither a cut run nor a failure. They are excluded from the recall '
      + 'denominator and counted here instead; their raw replies are in the per-run records.',
    );
  }
  const cut = rows.reduce((total, row) => total + row.cut, 0);
  if (cut > 0) {
    const lost = rows.filter((row) => row.cut > 0).reduce((total, row) => total + row.listed, 0);
    notes.push(
      `**${cut} run(s) were cut off mid-reasoning, and are excluded from the recall figures above** — `
      + 'their empty findings mean the model never finished looking, not that the code was clean, so '
      + `counting them as zeroes would charge the reviewer for the token budget. ${lost} listed defect(s) `
      + 'went unscored as a result, showing as n/a rather than 0%.',
    );
  }
  const listed = rows.reduce((total, row) => total + row.listed, 0);
  const scoreable = rows.reduce((total, row) => total + row.opportunities, 0);
  const dropped = rows.reduce((total, row) => total + row.dropped, 0);
  if (dropped > 0) {
    notes.push(
      `**Recall is measured against ${scoreable} scoreable of ${listed} listed defect(s), not against `
      + `everything history claims.** ${dropped} further defect(s) are recorded in the manifests as `
      + 'dropped, each with a reason — they could not be located in the snapshot, so scoring them would '
      + 'be invention. The denominator is therefore smaller than the truth twice over, which flatters '
      + 'recall; the listed and scoreable counts are printed so the gap is visible rather than implied.',
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
