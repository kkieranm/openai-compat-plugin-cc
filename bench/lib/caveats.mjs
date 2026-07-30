// The prose that qualifies every number in the benchmark table.
//
// Split from `report.mjs` at the size budget, and the seam is real: that file
// decides what the figures are, this one states what they do and do not mean.
// Each note below has already been earned — every one of them corresponds to a
// reading someone in this repo actually made and had to retract.
//
// `pct` lives here rather than beside the table because the percentage is the
// figure that has misled readers most often (a single run read as a 20% hit
// rate, a censored run read as a clean pass), and one definition sitting next to
// its own caveats is harder to quote out of context than one sitting alone.

function pct(found, total) {
  if (total === 0) return 'n/a';
  return `${Math.round((found / total) * 100)}%`;
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
 * What the prompt cache did to these runs, stated only as far as the data goes.
 *
 * Three careful things here, each of which an earlier draft got wrong.
 *
 * The mechanism is hedged — "may reuse" — because it is a claim about a server
 * this harness cannot inspect: LM Studio publishes no cache field on `usage`, a
 * server may have caching off, and under `--cold` every run is deliberately a
 * miss. Asserting that repeats *are* cheap would be reporting a server-side fact
 * from no evidence, which is the class this whole item exists to close.
 *
 * The ratio is **computed and conditional**, never a remembered number. It needs
 * two positive measurements in one case: one run cannot establish variation, and
 * a zero denominator would print `Infinity×` — a caveat that is itself a defect.
 *
 * And it is scoped to *within a case*, because that is where the comparison is
 * being made. Prefill varying between a 1.5k-token case and a 47k-token one is
 * not the cache, it is the prompt.
 */
function cacheNote(rows) {
  const ratios = rows
    .map((row) => row.prefill.values)
    .filter((values) => values.length >= 2 && Math.min(...values) > 0)
    .map((values) => Math.max(...values) / Math.min(...values));
  if (ratios.length === 0) return [];
  const worst = Math.max(...ratios);
  return [
    // No claim about what generation did. The obvious flourish — "...where
    // generation did not" — was written here and refuted by the first live run
    // that read it: prefill varied 12× and generation varied 4.5× in the same
    // row, because the model reasoned for longer, not because of any cache. Two
    // drafts of this sentence have now overclaimed in the same direction, which
    // is why it now says only what was counted.
    '**Repeat runs may reuse a server-side prompt cache.** Observed prefill varied '
    + `${worst < 10 ? worst.toFixed(1) : Math.round(worst)}× within a case here. Prefill figures are `
    + 'therefore not comparable run to run and must not be averaged, and nothing in the reply says '
    + 'whether a given run was served from cache; pass `--cold` for runs that are independent by '
    + 'construction.',
    // Stated separately and deliberately, because the obvious next sentence —
    // "generation is comparable" — is false and an earlier draft printed it. A
    // cache does not touch generation, which is why the *pair* isolates the
    // cache; it does not follow that generation is like-for-like across runs.
    // This repo has measured 1,709 against 5,450 output tokens on identical
    // input, so a generation figure moves with how much the model chose to say.
    '**Generation is what the cache does not touch — which is not the same as comparable.** A model '
    + 'that reasons for twice as long generates for twice as long on the same input, so these figures '
    + 'are only like-for-like once divided by the tokens actually produced — which is what the '
    + '`gen tok/s` column beside them is. Read that for speed and the generation column for cost; a '
    + 'model can be fast per token and still slow to answer, because it chose to say more.',
  ];
}

/**
 * The wall-clock cap, and what it does to every figure beside it.
 *
 * Its own function because it is the longest of these by far, and lifting it is
 * what keeps `flagNotes` under the function size budget. Stated whenever set,
 * for the same reason `--cold` is: a reader comparing two report files has to
 * know that one of them ran under a cap, or a row with fewer completed runs
 * reads as a worse model rather than a shorter leash.
 */
function capNote(rows, maxSeconds) {
  const capped = rows.reduce((total, row) => total + row.capped, 0);
  if (!maxSeconds && capped === 0) return [];
  return [
    (maxSeconds
      ? `**\`--max-seconds ${maxSeconds}\` was on**`
      : '**A wall-clock cap was in force, from the provider config rather than a flag** — this harness '
        + 'was never told the number, and infers it only from the runs it killed')
    + `, so any run still generating at that point was cut off and recorded as a failure with reason `
    + '`deadline-timeout`. '
    + `**${capped} run(s) here ended on the cap specifically** — the \`(N timed out)\` beside the `
    + '`failed` column is a wider count, covering every budget including the first-token one, so the '
    + 'two numbers differ legitimately and neither is the other. Those runs are a limit this harness '
    + 'imposed, not a result about the reviewer, and a capped report must not be set beside an '
    + 'uncapped one as if they were like for like. '
    + '**And the timing columns describe the runs that survived it**, which under a cap are the fast '
    + 'ones: `prefill s`, `generate s` and `gen tok/s` are computed over runs that reported, so a case '
    + 'whose slow runs were all cut shows the speed of its quick ones with no sign of what is missing. '
    + 'Read those cells against the `failed` count, never alone.',
  ];
}

/**
 * What was switched on for this run, stated whenever it was.
 *
 * Split from `caveats` at the function size budget, and the seam holds: these
 * describe *how the harness was invoked*, where the rest describe what the
 * corpus can and cannot measure. Every one exists because a reader comparing two
 * report files would otherwise credit a difference to the reviewer that belongs
 * to a flag.
 */
function flagNotes(rows, { diffOnly, cold, timeoutSeconds, maxSeconds }) {
  const notes = [];
  // Stated whenever set, for the same reason --cold is: a reader comparing two
  // report files has to know that one of them was run under a wall-clock cap,
  // or a row with fewer completed runs reads as a worse model rather than a
  // shorter leash.
  notes.push(...capNote(rows, maxSeconds));
  if (timeoutSeconds) {
    notes.push(
      `**\`--timeout ${timeoutSeconds}\` was on**, which bounds the wait for each run's *first token* only — `
      + 'prefill, not generation. It does not cap a run that is producing output.',
    );
  }
  // Stated when it was on, like --diff-only below: a reader comparing two report
  // files needs to know that one of them deliberately paid the cold cost on
  // every run, or the timings look like a regression.
  if (cold) {
    notes.push(
      '**`--cold` was on: every run carried a unique cache-buster**, so no run could be served from a '
      + 'server-side prompt cache and the prefill figures are independent. That also means each run '
      + 'sent a slightly different prompt, so this is not a byte-identical repeat of the same request. '
      // The cache-buster is minted per RUN, not per attempt, and a retry re-sends
      // the prompt byte-for-byte on purpose — so the buster alone stopped being
      // sufficient the moment retry existed. Said out loud rather than left as an
      // exclusion a reader would have to infer from a changed denominator.
      + '**A run answered by a retry is the exception**: the retry repeats the prompt exactly, so its '
      + 'prefill could have been served warm and is excluded from the prefill figures above rather '
      + 'than quoted as a cold measurement. The reliability section counts those attempts.',
    );
  }
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
function caveats(rows, runsPerCase, flags) {
  const notes = flagNotes(rows, flags);
  if (runsPerCase === 1) {
    notes.push(
      '**One run per case: this is a sample, not a score.** The same command has produced 1,709 and '
      + '5,450 output tokens on identical input, and a single pass found a real defect in 1 run of 5. '
      + 'Raise --runs before drawing an A/B conclusion from any difference here.',
    );
  }
  notes.push(...censorshipNotes(rows));
  // Not under --cold. The note explains prefill variation as a cache, and under
  // --cold there is no cache to explain it — so printing both left the report
  // saying no run could be served from cache and, three lines later, that
  // repeats may be, recommending a flag that was already on. Contradictory
  // guidance in the artifact whose whole job is to be quoted as evidence.
  if (!flags.cold) notes.push(...cacheNote(rows));
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

export { caveats, pct };
