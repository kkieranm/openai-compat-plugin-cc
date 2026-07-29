// Turning benchmark runs into something a person can read and paste into an ADR.
//
// Which bucket each run falls into lives in `run-buckets.mjs`, and the prose
// qualifying every figure lives in `caveats.mjs`; this file is the table and the
// arithmetic behind it.
//
// Both seams were cut by the size ratchet and both are real. The split worth
// stating is this one: a number and the sentence explaining what it does not
// mean have different reasons to change, and keeping them in one file is how the
// sentence quietly stops matching the number.
import { caveats, pct } from './caveats.mjs';
import { analysisCutRuns, truncatedRuns, unreadableRuns } from './run-buckets.mjs';

/**
 * The two halves of a run's wall clock, gathered separately because a
 * server-side prompt cache moves one of them and not the other.
 *
 * Measured: the same 56,805-token prompt reached its first token in 421.7s cold
 * and 11.5s warm, generating for ~3s in both. So a `seconds` range of `13–425`
 * across three runs of one case was never a spread in the reviewer — it was one
 * cold run and two cache hits, reported as if they were samples of one thing.
 *
 * `Number.isFinite` is the gate, not truthiness or `!= null`. A non-streamed
 * reply reports null for both because no first-token boundary was observed, and
 * `null` arithmetic silently yields a number: `durationMs - null` is
 * `durationMs`, which would relabel a whole run's wall clock as generation. The
 * count of what was measured is returned alongside the values so a cell can say
 * `2/3 measured` rather than quietly ranging over the runs that happened to
 * carry a figure. See ADR 009.
 */
export function timingSamples(runs, field) {
  const completed = runs.filter((run) => run.report);
  const values = completed.map((run) => run.report[field]).filter((value) => Number.isFinite(value));
  return { values, measured: values.length, completed: completed.length };
}

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
 * The prompt's size, **per run** — the one figure in this row that is a property
 * of the input rather than a count over the runs.
 *
 * It was a `reduce` summing every run's `prompt_tokens`, which is invisible at
 * N=1 (where sum equals per-run) and wrong by exactly a factor of `runs`
 * everywhere else. ADR 006 harvested all six of its per-case figures from an N=1
 * sweep and quotes them as prompt sizes — `config-origin` at 1,575, `model-info`
 * at 41,016 — so the first N>1 report printed 4,725 and 82,020 for those same
 * cases, in a column a reader has every reason to divide a generation figure by.
 * Two quantities welded into one number, which is the defect ADR 009 exists to
 * remove, surviving in the table it added its own columns to.
 *
 * A range rather than one number when runs disagree, because they can: `--cold`
 * prepends a per-run nonce, so the prompt genuinely differs run to run and a
 * single figure would have to pick one and call it the prompt.
 */
function promptSamples(runs) {
  return runs.map((run) => run.report?.usage?.prompt_tokens).filter((value) => Number.isFinite(value));
}

function tokenCell(values) {
  // Em dash, not 0. The old `?? 0` printed a zero-token prompt for a case whose
  // runs all failed, which is a measurement nobody made.
  if (values.length === 0) return '—';
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low}` : `${low}–${high}`;
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
    const prefill = timingSamples(runs, 'prefillMs');
    const generation = timingSamples(runs, 'generationMs');
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
      tokens: promptSamples(runs),
      prefill,
      generation,
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
    // Prefill and generation are two columns, never one. They are not two views
    // of the same quantity: a prompt cache moves the first by tens of times and
    // leaves the second alone, so summing them produces a figure that describes
    // neither, which is exactly what the `seconds` column they replace did.
    '| case | defects found | unresolved | anchored | unmatched | scored | truncated | unreadable | failed | prompt tokens | prefill s | generate s |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
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
      + `| ${tokenCell(row.tokens)} | ${rangeCell(row.prefill)} | ${rangeCell(row.generation)} |`,
    );
  }
  return lines;
}


export function renderReport(results, { runsPerCase, model, provider, diffOnly, cold }) {
  const rows = caseRows(results);
  const lines = [
    `# Benchmark — ${provider} / ${model}${diffOnly ? ' (--diff-only)' : ''}${cold ? ' (--cold)' : ''}`,
    '',
    `${results.length} case(s), ${runsPerCase} run(s) each.`,
    '',
    ...table(rows),
    '',
  ];
  for (const note of caveats(rows, runsPerCase, { diffOnly, cold })) lines.push(note, '');

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
