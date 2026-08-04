import { attemptRows, RESPONSE_BUCKETS } from './attempt-rows.mjs';
import { reasonNotes } from './reason-notes.mjs';

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
 * The reason-code paragraphs — `reasonNotes`, which now lives in
 * `reason-notes.mjs` — read `byReason` rather than a dedicated tally because
 * there is no fixed reason schema: `attemptRows` counts whatever code each failed
 * attempt carried, so a code is present here exactly when it has a row in the
 * table below. Unnumbered deliberately: this said "the two" while there were
 * three, having been written before one was added and never re-read.
 */
function outcomeNotes(stats) {
  const sawReason = (code) => stats.byReason.some(([key]) => key === code);
  const lines = [];
  if (stats.refused > 0) {
    lines.push(
      // "Initiated", never "dispatched" or "sent". `refused` is written by
      // `ledger.begin` when the replacement's ENTRY is minted, which is several
      // frames before anything reaches a socket: `provider.mjs` still has to
      // serialize the body and `http.mjs` to validate the URL, and either can
      // throw. Both earlier drafts read the entry as proof of the wire write —
      // the same claim twice, once per sentence, which is why the closing one
      // had to change with the opening one.
      `${stats.refused} attempt(s) were **refused for their shape**, not dropped — the server rejected a`
      + ' capability (`stream_options`, streaming, or a response schema), triggering a replacement request'
      + ' without it. The original is marked `refused` only once that replacement has its own attempt'
      + ' entry, so one always follows it in the same run. That is negotiation rather than'
      + ' unreliability, so those attempts are counted above but excluded from the failure rate.'
      + ' **It records an initiated replacement, not a guaranteed wire write** — and certainly not a'
      + ' successful one: if the replacement failed in turn, that failure is counted on its own row.',
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

/**
 * What a failed attempt's `prefillMs` does and does not establish.
 *
 * Gated on a failure having occurred — a **count**, never a name test. The
 * paragraphs above are gated by `sawReason`, whose `key === code` is one
 * loosened operator away from printing the `transport` note for a sweep whose
 * only failures were `non-retryable-transport`; nothing here reintroduces that
 * shape. That hazard is no longer only described: OAI-31 pinned it, and
 * `tests/bench-reason-notes.test.js` now fails on exactly that one-token edit.
 *
 * The claim is deliberately narrow, because the tempting one is false. A
 * measured prefill says the attempt crossed the first-model-text boundary, so
 * whatever ended it happened after that point — that is all. It does not say
 * why a later stream died, and a null is the absence of the measurement rather
 * than evidence of any particular cause. Stated this way because the failure
 * class this repo keeps producing is prose that asserts a property of a whole
 * population from examples covering one part of it.
 */
function firstTextNote(stats) {
  if (stats.failed === 0) return [];
  return [
    `The table below splits those ${stats.failed} failed attempt(s) on **whether the model had produced any`
    + ' text yet**, which is'
    + ' what a recorded `prefillMs` means. An attempt with one measured its own prefill, so it reached'
    + ' first model text and whatever ended it happened *after* that boundary — ruling out, for that'
    + ' attempt, any account in which it never got that far. It does **not** say what killed the stream'
    + ' afterwards. An attempt without one is the absence of that measurement — it died before first'
    + ' token, or its failure carried no timings — and absence of the measurement is not evidence of a'
    + ' cause.',
    '',
  ];
}

/**
 * What the response split does and does not settle, AND the table it explains.
 *
 * The two are one unit, returned together and gated once. They were two pushes
 * into the same array, and that is exactly how they came apart: the note was
 * gated on a failure having occurred and the table was not, so a clean sweep
 * printed three all-zero rows with no prose above them — and, since every
 * unseeded sibling correctly vanished, it was the only table in the section. A
 * test had even named the two-separate-pushes risk while covering only the other
 * half of it. Keeping them in one function is the structural form of that test.
 *
 * Gated on a failure having occurred, like `firstTextNote` above and for the same
 * reason: a clean sweep explaining a split that produced no rows would be the
 * report asserting more than it measured.
 *
 * The wording is deliberately about a RESPONSE, never a peer. This is the one
 * place a reader is most likely to substitute the stronger claim, because the
 * table sits directly under a paragraph discussing reachability and reads like an
 * answer to it. It is not: a TLS certificate rejection completes a connection to
 * a real peer and obtains no HTTP response, so it lands in the same bucket as a
 * `ENOTFOUND` that contacted nothing. The two axes agree often enough to be
 * confused and differ exactly where it matters.
 *
 * The three categories print even at zero WHEN THERE ARE FAILURES TO PARTITION,
 * which is when a zero is a measurement: `not recorded: 0` then says the other
 * two counts are complete, and a suppressed row could not say it. With no
 * failures at all there is nothing to partition and the zeroes say nothing —
 * hence the gate on `stats.failed` rather than on the row count, which the
 * seeding makes permanently non-zero.
 */
function respondedSection(stats) {
  if (stats.failed === 0) return [];
  // The completeness claim has to survive the fourth row. `not recorded: 0` says
  // every failure answered the question ONLY IF every failure answered it, and a
  // `recorded as a non-boolean` row means one did not — it is a writer defect,
  // not a count. Asserting completeness beside it would be the claim-about-a-set
  // -from-a-sub-population this repo keeps finding, printed by the very table
  // that disproves it.
  const malformed = stats.byServerResponded.some(([key, n]) => n > 0 && !RESPONSE_BUCKETS.includes(key));
  return [
    `The last table splits those ${stats.failed} failed attempt(s) on **whether an HTTP response was`
    + ' obtained** — whether headers arrived. That is not the same question as whether a peer was'
    + ' reached, and it is deliberately the weaker one: a certificate rejection reaches a peer and'
    + ' obtains no response, so it is counted beside a hostname that resolved to nothing. A `not'
    + ' recorded` row counts attempts carrying no such field — the absence of the question rather'
    + ' than an answer to it'
    + (malformed
      ? ', and a zero there does NOT mean the counts are complete here: a row below reports a value'
        + ' that was not a boolean, so at least one attempt answered the question unreadably.'
      : ', and with no malformed row below it a zero there means every failure above answered the'
        + ' question.'),
    '',
    ...countTable('Failures by whether an HTTP response was obtained', stats.byServerResponded),
  ];
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
    ...firstTextNote(stats),
    ...countTable('Failures by whether first model text arrived', stats.byFirstText),
    ...respondedSection(stats),
  );
  return lines;
}
