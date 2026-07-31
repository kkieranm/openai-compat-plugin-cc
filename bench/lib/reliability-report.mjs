import { attemptRows } from './attempt-rows.mjs';

/**
 * The `## Physical-attempt reliability` section.
 *
 * Its own section, never folded into the recall table and never appended to
 * "Runs that did not complete". That heading means *logical* runs, which is why
 * substitutions are already excluded from it; attempts 1 and 2 of a run answered
 * by attempt 3 do not belong there either, because the run completed. Keeping
 * them apart is what stops a reader mistaking transport reliability for reviewer
 * recall — the two denominators this feature exists to separate.
 *
 * Nor does this belong in `caveats.mjs`. Caveats say what a figure *means*; a
 * reason-code table is a second measurement, and putting it there would turn
 * prose into a results channel and force physical-attempt data into the logical
 * rows.
 */

function countTable(title, pairs) {
  if (pairs.length === 0) return [];
  return [`${title}`, '', '| | failed attempts |', '| --- | --- |', ...pairs.map(([key, n]) => `| \`${key}\` | ${n} |`), ''];
}

/** Logical runs, counted the way the recall table counts them. */
function runTotals(results) {
  const runs = results.flatMap(({ runs: caseRuns }) => caseRuns);
  // Substitutions carry `run.error` but COMPLETED — they answered, parsed and
  // were timed; what failed was the attribution, and they have their own
  // section saying so. Counting them here would have this line contradict that
  // one about the same runs.
  return { total: runs.length, incomplete: runs.filter((run) => run.error && run.reason !== 'model-substituted').length };
}

export function reliabilitySection(results) {
  const stats = attemptRows(results);
  // No record at all — a sweep from before this existed. Silence is honest;
  // a row of zeroes would claim a 0% failure rate nobody measured.
  if (!stats) return [];

  const runs = runTotals(results);
  const pct = (n) => `${((n / stats.total) * 100).toFixed(1)}%`;
  const lines = [
    '## Physical-attempt reliability',
    '',
    // Both denominators together, in one breath. Stated apart, a reader carries
    // the first into the second and the whole point is lost.
    `${runs.total} logical run(s): ${runs.total - runs.incomplete} completed, ${runs.incomplete} did not.`,
    `${stats.total} physical attempt(s): ${stats.answered} answered, ${stats.failed} failed (${pct(stats.failed)}).`,
    '',
    'A failed attempt is missing data, not an observed miss: it never enters a recall denominator.'
    + ' A run answered by a later attempt is scored once, and its earlier failures are counted only here.',
    '',
  ];
  if (stats.refused > 0) {
    lines.push(
      `${stats.refused} attempt(s) were **refused for their shape**, not dropped — the server rejected a`
      + ' capability (`stream_options`, streaming, or a response schema) and the plugin sent a replacement'
      + ' request without it. That is negotiation rather than unreliability, so those attempts are counted'
      + ' above but excluded from the failure rate. **It says a replacement was sent, not that the'
      + ' replacement succeeded** — if it failed in turn, that failure is counted on its own row.',
      '',
    );
  }
  if (stats.unresolved > 0) {
    lines.push(`**${stats.unresolved} attempt(s) were never resolved** — a request whose record was left open is a plumbing bug, not a server one.`, '');
  }
  if (stats.warmEligible > 0) {
    lines.push(
      `${stats.warmEligible} attempt(s) were **warm-eligible**: an earlier request in the same run carried a`
      + ' byte-identical prompt, so the server *could* have served their prefill from cache. This is not an'
      + ' observed cache hit — nothing here can see one — and their prefill figures are excluded from the'
      + ' cold timings above rather than being quoted as cold measurements.',
      '',
    );
  }
  lines.push(
    ...countTable('Failures by reason', stats.byReason),
    ...countTable('Failures by case', stats.byCase),
    ...countTable('Failures by requested model', stats.byModel),
  );
  return lines;
}
