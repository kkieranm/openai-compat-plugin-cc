// Turning benchmark runs into something a person can read.
//
// `run-buckets.mjs` decides which bucket a run falls into;
// `case-rows.mjs` turns runs into the counts and samples a row is made of;
// `caveats.mjs` writes the prose qualifying every figure. What is left here is
// the rendering: cells, the table, and the document around it.
//
// The split worth stating is the last one. A number and the sentence explaining
// what it does not mean have different reasons to change, and keeping them in
// one file is how the sentence quietly stops matching the number.
import { declaredMatch } from '../../plugins/oai/scripts/lib/model-identity.mjs';
import { formatRate } from '../../plugins/oai/scripts/lib/throughput.mjs';
import { caseRows } from './case-rows.mjs';
import { reliabilitySection } from './reliability-report.mjs';
import { caveats, pct } from './caveats.mjs';
import { safeCodeSpan } from './markdown-safe.mjs';
import { scoredRuns } from './run-buckets.mjs';

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
  // Em dash, not 0: a case whose runs all failed has no prompt size, and a zero
  // would be a measurement nobody made.
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
 * No low–high band is printed here: the high endpoint is not observed recall but
 * the counterfactual that continued reasoning would have found *everything*
 * remaining, so a wholly censored run would overlap a perfect one and the column
 * headed "defects found" would report defects nobody found. The uncertainty is real
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
 * The cell for a deduped set of labels — the lens rungs, the reasoning states —
 * joined, or an em dash when no run was measurable, matching `tokenCell`'s own
 * "nobody measured this". The join, never a pick, is the point:
 * `whole@154624 / hunks@61696` in one cell is the divergence a silent single
 * value would hide.
 */
function setCell(values) {
  return values.length > 0 ? values.join(' / ') : '—';
}

function table(rows) {
  const lines = [
    // Prefill and generation are two columns, never one. They are not two views
    // of the same quantity: a prompt cache moves the first by tens of times and
    // leaves the second alone, so summing them produces a figure that describes
    // neither.
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
    // The same shape, for the same reason: a run a budget timed out is still a
    // failed run, so it stays inside `failed` and the sum holds. What it is *not*
    // is a result about the reviewer: a harness limit, not a model that could not
    // answer.
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
      `| \`${safeCodeSpan(row.id)}\`${row.dropped ? ` +${row.dropped} unlisted` : ''} | ${recallCell(row)} | ${row.unresolved} `
      + `| ${row.anchored} | ${unmatchedCell(row)} | ${scoredCell} | ${row.truncated} | ${row.unreadable} | ${failedCell} `
      + `| ${setCell(row.lens)} | ${setCell(row.reasoning)} | ${tokenCell(row.tokens)} | ${rangeCell(row.prefill)} | ${rangeCell(row.generation)} | ${rateCell(row.rate)} |`,
    );
  }
  return lines;
}

function modelTitle(model, requestedModel, unanswered) {
  return unanswered
    ? `\`${safeCodeSpan(requestedModel)}\` (requested; no run was answered by it)`
    : `\`${safeCodeSpan(model)}\``;
}

export function renderReport(results, { runsPerCase, model, provider, requestedModel, unanswered, diffOnly, cold, structuredOutput, timeoutSeconds, maxSeconds, maxTokens, temperature, sampling, passes, lens }) {
  const rows = caseRows(results, { cold });
  const lines = [
    // Provider and model ids are server- and config-supplied, so they go in code
    // spans: a newline in either could otherwise open a heading of its own. A
    // model no run answered is named by its requested id, the note outside it.
    `# Benchmark — \`${safeCodeSpan(provider)}\` / ${modelTitle(model, requestedModel, unanswered)}${diffOnly ? ' (--diff-only)' : ''}${cold ? ' (--cold)' : ''}`
    + `${structuredOutput ? ' (--structured-output)' : ''}`
    // The pass strategy in the title, for the same reason as the flags above: two
    // arms differing only in --passes/--lens produce incomparable measurements, so
    // a reader must be able to tell them apart in the artifact, not only the JSON.
    + `${lens ? ` (--lens ${lens})` : ''}${passes ? ` (--passes ${passes})` : ''}`,
    '',
    `${results.length} case(s), ${runsPerCase} run(s) each.`,
    '',
    ...table(rows),
    '',
  ];
  for (const note of caveats(rows, runsPerCase, { diffOnly, cold, structuredOutput, timeoutSeconds, maxSeconds, maxTokens, temperature, sampling })) lines.push(note, '');
  for (const note of declaredIdNotes(results)) lines.push(note, '');

  lines.push(...supplements(results));
  return lines.join('\n');
}

/**
 * The requested → served id pairs a scored run matched only through the
 * provider's `servedModelIds`, named whenever any did.
 *
 * Those runs are scored as the requested model because providers.json says the
 * server reports that model under another id — an assertion by whoever wrote the
 * config, not something the server confirmed. A reader crediting the row to the
 * requested model is trusting that declaration, so it is stated where the row is.
 *
 * A multi-pass report's top-level ids are its first readable pass's, so each
 * readable entry of `passes[]` is read too: a union of one exact pass and one
 * declared pass names the pairing whichever came first. An unreadable pass
 * (`ok: false`) contributed nothing to the score, so its ids are not read.
 */
function declaredIdNotes(results) {
  const pairs = new Set();
  for (const { runs } of results) {
    for (const run of scoredRuns(runs)) {
      const report = run.report ?? {};
      const passes = Array.isArray(report.passes) ? report.passes.filter((pass) => pass?.ok !== false) : [];
      const identities = [report, ...passes];
      for (const identity of identities) {
        if (declaredMatch(identity)) {
          pairs.add(`\`${safeCodeSpan(identity.requestedModel) || '(not recorded)'}\` answered as \`${safeCodeSpan(identity.model)}\``);
        }
      }
    }
  }
  if (pairs.size === 0) return [];
  return [
    `**Accepted through a declared served id: ${[...pairs].join(', ')}.** The server reported a different `
    + 'id than the one requested, and these runs are scored as the requested model only because the '
    + "provider's `servedModelIds` declares that pairing — an operator assertion in providers.json, not "
    + 'something the server confirmed.',
  ];
}

/** The residue sections below the table. */
function supplements(results) {
  const lines = [];
  const unmatched = results.flatMap(({ caseDef, runs }) =>
    runs.flatMap((run) => (run.score?.unmatched ?? []).map((finding) => ({ caseId: caseDef.id, finding }))));
  if (unmatched.length > 0) {
    lines.push('## Unmatched findings', '');
    // Printed in full rather than counted. The count alone cannot be checked,
    // and the whole reason to keep a residue is to be able to eyeball what the
    // scorer is missing before trusting the number above it.
    // Every field but the case id (a fixture name) is model output, so each sits
    // in a code span: nothing in one renders as structure or as a link, and none
    // starts a line. The evidence keeps only its first line, taken before
    // escaping, which folds the newlines that line is cut at; a value that is not
    // a string is left for safeCodeSpan to coerce.
    for (const { caseId, finding } of unmatched) {
      const line = finding.line ? `:\`${safeCodeSpan(finding.line)}\`` : '';
      lines.push(`- \`${safeCodeSpan(caseId)}\` \`${safeCodeSpan(finding.file)}\`${line} (\`${safeCodeSpan(finding.severity)}\`) — \`${safeCodeSpan(finding.summary)}\``);
      if (finding.evidence) {
        const firstLine = typeof finding.evidence === 'string'
          ? finding.evidence.split(/\r\n?|\n/)[0].trim().slice(0, 160)
          : finding.evidence;
        lines.push(`  > \`${safeCodeSpan(firstLine)}\``);
      }
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
      `- \`${safeCodeSpan(caseDef.id)}\`:`,
      // A blank line, then six spaces: two for the list item, four for an
      // indented code block, where server text echoed into stderr renders
      // literally. Split on every line ending, so a lone CR cannot start an
      // unindented line.
      '',
      ...String(run.error).split(/\r\n?|\n/).map((line) => `      ${line}`),
    ]));
  if (failures.length > 0) lines.push('## Logical runs that did not complete', '', ...failures, '');

  const substituted = results.flatMap(({ caseDef, runs }) =>
    runs.filter((run) => run.reason === 'model-substituted')
      .map((run) => `- \`${safeCodeSpan(caseDef.id)}\`: asked for \`${safeCodeSpan(run.report?.requestedModel)}\`, `
        + `\`${safeCodeSpan(run.report?.model)}\` answered.`));
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
