// Render a comparison model (from compare-model.mjs) as Markdown.
//
// Every `${…}` interpolation in this file is a `safeInline`/`displayReason` call
// — it is in tests/structure.test.js's SWEEP_RENDER_FILES, whose anchored grammar
// admits nothing else, so a new unwrapped sink fails that test. Trusted numeric
// cells are formatted WITHOUT Markdown metacharacters (no parens/brackets), so
// `safeInline` passes them through untouched while still neutralising any
// metacharacter an untrusted model id, stamp, case id or reason carries. The
// helpers build strings by concatenation (no `${…}`), and only compose trusted
// numbers and fixed words; every untrusted value is wrapped at its interpolation.
import { safeInline, displayReason } from './markdown-safe.mjs';
import { pct } from './caveats.mjs';
import { formatRate } from '../../scripts/lib/throughput.mjs';

// `found/opp = pct`, metacharacter-free so safeInline leaves it intact.
const recallText = (found, opp) => (opp > 0 ? found + '/' + opp + ' = ' + pct(found, opp) : '—');

// Rendered through `formatRate`, not a local `toFixed` — the same discipline
// report.mjs states. `aggregate.throughput` is null or finite, so the null arm
// is the only extra case.
const throughputText = (tps) => (tps === null ? '—' : formatRate(tps) + ' tok/s');

const lensText = (lens) => (Array.isArray(lens) && lens.length ? lens.join(' ') : '—');

// The disjoint failure sub-states of a case no run scored, each with its run
// count rather than one winning label — a case can fail several ways across its
// runs, and naming only the highest-priority one hides the rest. `failed` is
// every errored run; `timedOut` and `substituted` are disjoint sub-counts of it
// and `capped` is a sub-count of `timedOut`, so the residual plain failures and
// the non-cap timeouts are the subtractions here; `unreadable` and `truncated`
// are the two non-errored runs that still never scored. Metacharacter-free
// (digits, words, commas, spaces) so safeInline passes the cell through
// untouched. The buckets sum to `failed + unreadable + truncated`, which — on
// the `scored === 0` branch that is the only route here — is the whole run
// count, so an empty `parts` means the case carried no runs at all (a corrupt
// record): it reads "no runs" rather than fabricating a failure that never ran.
function failureCells(row) {
  const plainFailed = row.failed - row.timedOut - row.substituted;
  const timeoutOnly = row.timedOut - row.capped;
  const parts = [];
  if (plainFailed > 0) parts.push(plainFailed + ' failed');
  if (timeoutOnly > 0) parts.push(timeoutOnly + ' timeout');
  if (row.capped > 0) parts.push(row.capped + ' capped');
  if (row.substituted > 0) parts.push(row.substituted + ' substituted');
  if (row.unreadable > 0) parts.push(row.unreadable + ' unreadable');
  if (row.truncated > 0) parts.push(row.truncated + ' truncated');
  return parts.length ? parts.join(', ') : 'no runs';
}

// A per-case cell: recall + lens when the case was scored, the failure states
// when it was not (never a fabricated 0), and a control marker for controls —
// with the failures named beside the marker when a control's runs all failed,
// so a control that never ran is not read as one that measured clean.
function cellText(row) {
  if (!row) return 'n/a';
  if (row.control) return row.scored > 0 ? '— control' : '— control, ' + failureCells(row);
  if (row.scored > 0) return recallText(row.found, row.opportunities) + ' ' + lensText(row.lens);
  return '— ' + failureCells(row);
}

const aggRecall = (a) => (a.recall === null ? '—' : recallText(a.found, a.opportunities));

// A false-positive count WITH its scored-run denominator ("3 per 4"), so the
// ranking — which tie-breaks on the per-scored-run RATE, not the raw count — is
// legible: without the denominator a larger raw count could rank above a smaller
// one and the table would look mis-sorted. With no scored runs there is no
// false-positive measurement to report — the count is 0 by construction, summed
// over the scored bucket alone — so the cell reads "—", not a "0" that would
// read as a clean measurement. Metacharacter-free for safeInline.
const fpText = (count, scored) => (scored > 0 ? count + ' per ' + scored : '—');

// The four aggregate cells (Recall / Unmatched / Control FP / Throughput),
// already wrapped and joined — shared by the ranked and unranked tables so a new
// column is added once. Concatenation of wrapped cells, so no `${…}` to scan.
const aggCells = (a) =>
  safeInline(aggRecall(a)) +
  ' | ' +
  safeInline(fpText(a.unmatched, a.scoredRuns)) +
  ' | ' +
  safeInline(fpText(a.controlFP, a.controlScored)) +
  ' | ' +
  safeInline(throughputText(a.throughput));

const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '±0');

const rowsById = (record) => new Map((record.rows ?? []).map((row) => [row.id, row]));

export function renderComparison(model) {
  const { records, rankable, ranking, divergences, caseUnion, baselineLabel } = model;
  const readable = records.filter((r) => !r.incompatible);
  const lines = [];

  lines.push('# Cross-run comparison');
  lines.push('');
  lines.push('Records compared, in input order:');
  for (const r of records) {
    lines.push(`- \`${safeInline(r.label)}\` — \`${safeInline(r.path)}\``);
  }
  lines.push('');

  const incompatible = records.filter((r) => r.incompatible);
  if (incompatible.length) {
    lines.push('## Unreadable records');
    lines.push('');
    lines.push('Excluded from every table below — not a review record this build can read:');
    for (const r of incompatible) {
      lines.push(`- \`${safeInline(r.label)}\`: ${displayReason(r.reason)}`);
    }
    lines.push('');
  }

  // Ranking, or the reason it is withheld.
  if (rankable) {
    lines.push('## Ranking');
    lines.push('');
    lines.push('| # | Record | Recall | Unmatched | Control FP | Throughput |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    ranking.forEach((r, i) => {
      // Concatenation of already-wrapped cells (aggCells) plus the wrapped rank
      // and label — a `.find` re-join is gone now that ranking carries records.
      lines.push('| ' + safeInline(i + 1) + ' | ' + safeInline(r.label) + ' | ' + aggCells(r.aggregate) + ' |');
    });
    lines.push('');
    // The disclosure states what actually ORDERED the rows. Recall is uniform
    // across a rankable set (coverage forces per-case scored-agreement), so it is
    // either the order for every row or `—` for every row. When it is `—` for all
    // — a control-only comparison, rankable via `controlScored > 0` — recall orders
    // nothing and the ranking is by control false-positive rate; saying so beats
    // leaving the recall-pooling note to explain a quantity no row displays.
    // Otherwise recall orders, and the pooled-recall WEIGHTING note applies (recall
    // is Sum(found)/Sum(opportunities), a case weighted by how many of its runs
    // scored). Both branches are literal prose, no interpolation.
    if (ranking.every((r) => r.aggregate.recall === null)) {
      lines.push('No record scored a non-control case, so recall (`—`) cannot order these — the ranking is by control false-positive rate, fewer per scored control run first.');
    } else {
      lines.push('Recall is pooled over non-control cases: each contributes its listed-defect count times the number of its runs that scored, so a case weighs by both how many defects it lists and how many of its runs succeeded — records with differing per-case scored-run counts are weighted toward the cases each completed more runs on.');
    }
    lines.push('');
  } else if (readable.length >= 2) {
    // Two reasons the ranking is withheld, and they are NOT the same: the records
    // diverge on an axis (incomparable), or they are comparable but nothing scored
    // (nothing to rank). Printing the empty divergence list under a
    // "not like-for-like" header for the second case would be a header over
    // nothing and a false claim — the records ARE like-for-like.
    if (divergences.length) {
      lines.push('## Ranking withheld — records are not like-for-like');
      lines.push('');
      lines.push('Ranking incomparable records is the mis-comparison this reader exists to prevent. Divergent axes:');
      for (const d of divergences) {
        lines.push(`- **${safeInline(d.axis)}**: ${displayReason(d.detail)}`);
      }
    } else {
      lines.push('## Ranking withheld — no record produced a scoreable run');
      lines.push('');
      lines.push('These records are comparable, but every recall is `—` and no control case scored, so there is nothing to rank.');
    }
    lines.push('');
    lines.push('Per-record aggregates are shown below, unranked.');
    lines.push('');
    lines.push('| Record | Recall | Unmatched | Control FP | Throughput |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of readable) {
      lines.push('| ' + safeInline(r.label) + ' | ' + aggCells(r.aggregate) + ' |');
    }
    lines.push('');
  }

  // Per-case recall matrix — always, for the readable records.
  if (readable.length && caseUnion.length) {
    const baselineRecord = baselineLabel ? readable.find((r) => r.label === baselineLabel) : null;
    const baselineRows = baselineRecord ? rowsById(baselineRecord) : null;

    lines.push('## Per-case recall matrix');
    lines.push('');
    if (baselineLabel) {
      lines.push(`Δ columns are found-count deltas against the baseline \`${safeInline(baselineLabel)}\`.`);
      lines.push('');
    }
    const header = ['Case'];
    for (const r of readable) {
      header.push(r.label);
      if (baselineLabel && r.label !== baselineLabel) header.push('Δ');
    }
    // Assembled by concatenation of already-wrapped cells: a `.map().join()`
    // interpolation is not a single wrapper call, so it would fail the grammar
    // even though every element is safe. No `${…}` here, nothing to scan.
    lines.push('| ' + header.map((h) => safeInline(h)).join(' | ') + ' |');
    lines.push('| ' + header.map(() => '---').join(' | ') + ' |');

    const byRecord = readable.map((r) => ({ record: r, rows: rowsById(r) }));
    for (const caseId of caseUnion) {
      const cells = [safeInline(caseId)];
      for (const { record, rows } of byRecord) {
        const row = rows.get(caseId);
        cells.push(safeInline(cellText(row)));
        if (baselineLabel && record.label !== baselineLabel) {
          const base = baselineRows ? baselineRows.get(caseId) : null;
          const delta = row && base && row.scored > 0 && base.scored > 0 ? signed(row.found - base.found) : '—';
          cells.push(safeInline(delta));
        }
      }
      lines.push('| ' + cells.join(' | ') + ' |'); // already-wrapped cells, no ${…} to scan
    }
    lines.push('');
  }

  return lines.join('\n');
}
