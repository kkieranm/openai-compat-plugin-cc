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

/**
 * The three REASON codes a reader could misread, each gated on its own code.
 *
 * Split from the outcome paragraphs below at the function size budget, and the
 * seam is the one the report already draws: those describe an `outcome` field,
 * these describe a `reason`, and only the second kind has a row in the table.
 *
 * Every paragraph is gated on the code it is ABOUT. Stated because the first
 * draft got it wrong in a way three reviewers had to find: the `transport`
 * disclaimer sat inside the `non-retryable-transport` block, so a sweep whose
 * only failures were `transport` — the shape LM Studio actually produces —
 * printed a bare row with the one sentence forbidding the server-blame reading
 * nowhere in the document.
 *
 * And each paragraph says what the RECORD holds, never where else in the report
 * a cause might be found. Three drafts tried the latter — "read `.code`", then
 * "the code is not carried in this report", then "the listing below usually
 * names it" — and review refuted all three, the last one decisively: a TLS
 * rejection's message is the words "certificate has expired" and contains no
 * `CERT_HAS_EXPIRED` anywhere, so the sentence was false for exactly the
 * examples the paragraph itself cites. The attempt record carries a reason code
 * and nothing more, and that is the whole of what these paragraphs may claim.
 */
function reasonNotes(sawReason) {
  const lines = [];
  if (sawReason('shape-rejected')) {
    lines.push(
      // Names `refused` rather than saying "that outcome": the paragraph above
      // is itself gated, so on a sweep with no refusals there is no antecedent
      // for a pronoun to point at.
      '`shape-rejected` below is the terminal twin of the `refused` outcome, and the reason the two must'
      + ' never be read as synonyms: the server rejected the request\'s shape and **nothing replaced it** —'
      + ' the fallback never reached the wire, so no later attempt carries the same work. These are'
      + ' counted as failures, and they are not a server dropping requests. A `shape-rejected` row says'
      + ' the client stopped, not that the server went quiet.',
      '',
    );
  }
  if (sawReason('non-retryable-transport')) {
    lines.push(
      '`non-retryable-transport` below is a failure that arrived **before any response was obtained**,'
      + ' carrying an error code this client does not recognise as transient — or no code at all — so it'
      + ' was not retried. It records that retry decision, and in particular it does **not** say whether'
      + ' a peer was reached: some of these did reach one — a TLS certificate rejection, a protocol or a'
      + ' parser error — and some never did, `ENOTFOUND` and `ECONNREFUSED` among them. This table cannot'
      + ' tell you which, because the reason code is all an attempt record carries.',
      '',
    );
  }
  if (sawReason('transport')) {
    lines.push(
      '`transport` below is a failure a further attempt could plausibly survive, and it is **not** a count'
      + ' of server misbehaviour. It covers a connection closing mid-body — the shape it was named for —'
      + ' but also pre-response failures whose code says to try again: `EAI_AGAIN` is a resolver\'s own'
      + ' "ask again", and a pre-response `ECONNRESET` carried no response at all. The axis is'
      + ' retryability, never blame.',
      '',
    );
  }
  return lines;
}

/**
 * The prose for every outcome and reason code a reader could misread, each gated
 * on having actually occurred in this sweep.
 *
 * Gated, not printed as a standing glossary, because this is a results section:
 * a clean sweep explaining failures that did not happen would be the report
 * asserting more than it measured. And lifted out of `reliabilitySection` at the
 * function size budget — the seam is "what a code means" against "what this
 * sweep counted", which is the same split `caveats.mjs` already draws one level
 * up.
 *
 * The two reason-code paragraphs read `byReason` rather than a dedicated tally
 * because there is no fixed reason schema: `attemptRows` counts whatever code
 * each failed attempt carried, so a code is present here exactly when it has a
 * row in the table below.
 */
function outcomeNotes(stats) {
  const sawReason = (code) => stats.byReason.some(([key]) => key === code);
  const lines = [];
  if (stats.refused > 0) {
    lines.push(
      `${stats.refused} attempt(s) were **refused for their shape**, not dropped — the server rejected a`
      + ' capability (`stream_options`, streaming, or a response schema) and a replacement request without'
      + ' it was dispatched. An attempt can only *read* `refused` once that replacement\'s own entry'
      + ' exists, so one always follows it in the same run. That is negotiation rather than'
      + ' unreliability, so those attempts are counted above but excluded from the failure rate.'
      + ' **It says a replacement was sent, not that the replacement succeeded** — if it failed in'
      + ' turn, that failure is counted on its own row.',
      '',
    );
  }
  lines.push(...reasonNotes(sawReason));
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
  return lines;
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
  lines.push(
    ...outcomeNotes(stats),
    ...countTable('Failures by reason', stats.byReason),
    ...countTable('Failures by case', stats.byCase),
    ...countTable('Failures by requested model', stats.byModel),
  );
  return lines;
}
