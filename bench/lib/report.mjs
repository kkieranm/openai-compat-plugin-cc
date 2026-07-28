// Turning benchmark runs into something a person can read and paste into an ADR.
//
// Which bucket each run falls into lives in `run-buckets.mjs`; this file is
// about wording and arithmetic.
//
// The wording here is load-bearing, not decoration. Every number this prints is
// about to be quoted in a design document as evidence, so each one has to say
// what it actually measured — which is narrower than "how good the reviewer is"
// in three separate ways, all named below.
import { analysisCutRuns, truncatedRuns, unreadableRuns } from './run-buckets.mjs';

function pct(found, total) {
  if (total === 0) return 'n/a';
  return `${Math.round((found / total) * 100)}%`;
}

function caseRows(results) {
  return results.map((result) => {
    const { caseDef, runs } = result;
    // Three readings of a cut run, two of them wrong. Discarding it throws away
    // findings that are perfectly good — the cut lands on `analysis`, which the
    // schema orders first, so the model still emitted its findings normally.
    // Folding it in as an ordinary run counts every defect it never reached as a
    // confirmed miss. What is true is narrower than either: its findings are
    // observations and its silence is not, so the silence is counted once, as
    // `unresolved`, and reported beside the figure instead of inside it.
    //
    // `unresolved` is zero wherever nothing was cut, which is what keeps a row
    // comparable with every figure this table printed before.
    const truncated = new Set(truncatedRuns(runs));
    const scored = runs.filter((run) => run.score && !truncated.has(run));
    // Intersected with `scored`, not merely collected — the whole table rests on
    // cut runs being a *subset* of the scored ones. A cut run that somehow
    // carried no score would otherwise report unresolved opportunities against a
    // denominator it never contributed to, so the caveat's stated upper bound
    // could exceed 100%. Enforced rather than assumed, because the assumption
    // holds only while `run.mjs` attaches a score to every parsed reply, and
    // nothing here would notice if it stopped.
    const scoredSet = new Set(scored);
    const cut = analysisCutRuns(runs).filter((run) => scoredSet.has(run));
    const listed = caseDef.defects.length;
    const found = scored.reduce((total, run) => total + run.score.recall.found, 0);
    const anchored = scored.reduce((total, run) => total + run.score.recall.anchored, 0);
    const unmatched = scored.reduce((total, run) => total + run.score.unmatched.length, 0);
    const unresolved = cut.reduce((total, run) => total + (listed - (run.score?.recall.found ?? 0)), 0);
    const failed = runs.filter((run) => run.error).length;
    const seconds = runs.filter((run) => run.report).map((run) => run.report.durationMs / 1000);
    return {
      id: caseDef.id,
      listed,
      dropped: caseDef.dropped.length,
      opportunities: listed * scored.length,
      found,
      unresolved,
      anchored,
      unmatched,
      failed,
      truncated: truncated.size,
      // A sub-count of `scored`, not a bucket beside it — stated here because a
      // number that looks like a bucket and is not is exactly the ambiguity the
      // sum invariant below exists to prevent.
      cut: cut.length,
      unreadable: unreadableRuns(runs, scoredSet).length,
      scored: scored.length,
      runs: runs.length,
      diffOnly: runs.some((run) => run.diffOnly),
      tokens: runs.reduce((total, run) => total + (run.report?.usage?.prompt_tokens ?? 0), 0),
      seconds: seconds.length ? `${Math.min(...seconds).toFixed(0)}–${Math.max(...seconds).toFixed(0)}` : '—',
    };
  });
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
    '| case | defects found | unresolved | anchored | unmatched | scored | truncated | unreadable | failed | prompt tokens | seconds |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
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
    lines.push(
      `| \`${row.id}\`${row.dropped ? ` +${row.dropped} unlisted` : ''} | ${recallCell(row)} | ${row.unresolved} `
      + `| ${row.anchored} | ${row.unmatched} | ${scoredCell} | ${row.truncated} | ${row.unreadable} | ${row.failed} `
      + `| ${row.tokens} | ${row.seconds} |`,
    );
  }
  return lines;
}

/**
 * The three ways a run can produce less than a whole answer, each stated only
 * when it happened. Split from `caveats` at the size budget, and the seam is a
 * real one: these are all claims about *what the harness did to a run*, where
 * the rest describe what the corpus can and cannot measure.
 */
function censorshipNotes(rows) {
  const notes = [];
  const unreadable = rows.reduce((total, row) => total + row.unreadable, 0);
  if (unreadable > 0) {
    notes.push(
      `**${unreadable} run(s) answered but could not be read** — the reply never parsed into findings, and it `
      + 'was not truncated, so it is neither a cut run nor a failure. They are excluded from the recall '
      + 'denominator and counted here instead; their raw replies are in the per-run records.',
    );
  }
  const truncated = rows.reduce((total, row) => total + row.truncated, 0);
  if (truncated > 0) {
    notes.push(
      `**${truncated} run(s) ran out of tokens before finishing their reply** — the JSON never parsed, so `
      + 'there is nothing in them to score and they are excluded from the figures above. This is a '
      + 'harness limit, not a reviewer result: raise the reply budget or review a smaller target.',
    );
  }
  const cut = rows.reduce((total, row) => total + row.cut, 0);
  const unresolved = rows.reduce((total, row) => total + row.unresolved, 0);
  // Gated on `unresolved`, not on `cut`. A cut run that still named every listed
  // defect leaves nothing uncertain, and a caveat announcing an uncertainty band
  // of X% to X% would be a warning firing when it is provably wrong — the
  // inverse of the defect this whole item is about. The `(N cut)` in the scored
  // cell still says the truncation happened; there is simply nothing to caveat.
  if (unresolved > 0) {
    const found = rows.reduce((total, row) => total + row.found, 0);
    const opportunities = rows.reduce((total, row) => total + row.opportunities, 0);
    notes.push(
      `**${cut} run(s) were cut off mid-reasoning, and their findings ARE counted above** — the cut lands `
      + 'on the reasoning field, which the schema puts first, so the model still emitted its findings '
      + 'normally and those are as checkable as any other run\'s. What cannot be read is their silence: a '
      + `defect such a run did not name may be one it never reached. So ${unresolved} of the `
      + `${opportunities} opportunit(ies) above are **unresolved**, not observed misses, and the "defects `
      + 'found" column counts them against the reviewer because that is the conservative reading. True '
      + `recall is therefore somewhere between ${pct(found, opportunities)} and `
      + `${pct(found + unresolved, opportunities)} — the upper figure is what cannot be ruled out, not `
      + 'something anyone measured, which is why it is stated here rather than printed as a result.',
    );
  }
  return notes;
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
  notes.push(...censorshipNotes(rows));
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
