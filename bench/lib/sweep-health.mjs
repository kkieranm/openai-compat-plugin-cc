// What the server did to the night, replayed from the record rather than stored.
//
// The sweep aborts after `--abort-after` CONSECUTIVE outages, and any non-outage
// zeroes that counter. So a server failing every other commit, with a
// slow commit in between, produces `outage, timeout, outage, timeout, …` and the
// streak never reaches the threshold — the sweep runs its full wall clock against
// a dead server and reports the result as coverage.
//
// A run recording many timeouts and zero aborts can look like the fail-fast
// holding when it is not. **The same data cannot distinguish "no
// outage occurred" from "outages occurred and were repeatedly reset"**, because
// nothing recorded the counter's history. This is that history — and it is
// DERIVED, not stored.
//
// **Why derived.** The streak is a function of the settled outcome sequence and
// the `isOutage` predicate, both of which the entries already carry. Storing it
// alongside would be a second representation of one fact, free to disagree with
// the first. (A *pure* function of the run's own counter is the stronger claim
// and it does not hold across a crash: an entry reaches disk before the loop
// counts it, so a recovered record can hold one outage the run never counted.) What the record genuinely could not reconstruct was *when* anything
// happened — entries carried only `seconds`, a rounded duration — so the timeline
// is what got recorded, and everything here is computed from it.
import { isOutage } from './sweep-outcome.mjs';

/** Commits the loop actually attempted, in the order it attempted them.
 *
 * Selected on `startedAt` rather than on a list of skip outcome names, because
 * `runSweep` sets that field at the same point it stops skipping — the three
 * skip branches return before both. A name list would be a copy of the loop's
 * control flow, maintained by hand, free to fall out of step with it.
 */
function attempted(entries) {
  return entries.filter((entry) => entry.startedAt);
}

// The `Z` is not decoration. Every sibling timestamp in the report carries one,
// and this is the single line whose purpose is "the server went bad at 02:30" —
// a bare `13:18:38` beside a run the reader remembers starting at 14:18 BST reads
// as a wrong time rather than as a different zone. Rendering it locally instead
// would need a zone the record does not carry.
function clock(iso) {
  return typeof iso === 'string' && iso.length >= 19 ? `${iso.slice(11, 19)}Z` : String(iso ?? '?');
}

/**
 * Replay the counter over the entries that SETTLED, and report what it did.
 *
 * **Not "exactly as the loop ran it", which is what this used to say and is
 * false at the crash boundary.** A settled entry reaches the ledger before the
 * loop updates its counter, so a record recovered from a run killed in between
 * can hold one outage the loop never counted — and the streak derived here would
 * then imply an abort decision the run never took. On a complete record the two
 * agree; on a recovered one this is a reading of what settled, which is why a
 * recovered record renders the incomplete-timeline warning below.
 *
 * `resets` counts the times a non-outage zeroed a LIVE streak — a reset from
 * zero is not a reset, it is an ordinary healthy commit, and counting those
 * would report a number the size of the run. That distinction is why this is
 * the number the reader is given.
 */
export function replayStreak(entries) {
  let streak = 0;
  let longest = 0;
  let resets = 0;
  const outages = [];
  // **Every attempted entry is replayed; the threshold does NOT stop the walk.**
  // It is tempting to break at `abortAfter`, on the reasoning that the loop
  // stopped opening work there — and on a COMPLETE record that break is merely
  // redundant, because a real abort emits `skipped-abort` entries which carry no
  // `startedAt` and are already excluded. On a RECOVERED record it is wrong: a
  // hole between two outages makes them look consecutive, the walk breaks early,
  // and later surviving outages vanish from the count while the header goes on
  // reporting them as attempted. Redundant on one path and lossy on the other is
  // not a bound worth keeping.
  for (const entry of attempted(entries)) {
    if (isOutage(entry)) {
      streak += 1;
      longest = Math.max(longest, streak);
      outages.push(entry);
    } else {
      if (streak > 0) resets += 1;
      streak = 0;
    }
  }
  return { attempted: attempted(entries).length, outages, longest, resets };
}

/**
 * The section, or nothing at all when no commit was attempted.
 *
 * A run that reviewed nothing has no server behaviour to describe, and printing
 * "0 outages" over it would read as a clean bill of health for a night that
 * never asked the server anything.
 */
export function serverHealth(entries, abortAfter, timelineComplete = true) {
  const { attempted: tried, outages, longest, resets } = replayStreak(entries);
  if (tried === 0) return [];
  const lines = ['## Server health', ''];
  // **A holed timeline cannot yield the streak the run took, and saying so is
  // not a caveat but the finding.** A missing entry between two recorded
  // outages makes them look consecutive; a missing entry that WAS the outage
  // understates the streak. **Wrong in BOTH directions, so these are not a lower
  // bound** — that would be its own false claim. They are a reading of what
  // survived, and the rendered text says exactly that.
  if (!timelineComplete) {
    lines.push('> **Derived from an INCOMPLETE timeline.** This record was recovered, so commits are missing from it. A gap between two recorded outages can make them appear consecutive when a healthy commit sat between, and a gap that was itself an outage understates the streak. Read every figure below as a reading of what survived, never as the sequence the run experienced.', '');
  }
  const commits = tried === 1 ? 'commit' : 'commits';
  lines.push(`- **${tried} ${commits} attempted · ${outages.length} judged a server outage** · abort threshold ${abortAfter ?? '(not recorded)'}`);
  if (outages.length === 0) {
    lines.push('- No outage was recorded, so the streak never started. This is the fail-fast having nothing to do, which is different from it holding.', '');
    return lines;
  }
  lines.push(`- **Longest consecutive streak reached: ${longest}** · a non-outage reset a live streak **${resets}** time(s)`);
  // Named individually, because a pattern is what the counts cannot show: three
  // outages in five minutes is a server falling over, three across eight hours
  // is noise, and both render as "3".
  lines.push(`- Outages fell at ${outages.map((entry) => `\`${entry.sha.slice(0, 9)}\` ${clock(entry.startedAt)}`).join(', ')}`);
  if (resets > 0) {
    lines.push('- **Read the abort with that in mind.** A streak that was reset is a streak that did not reach the threshold, so a sweep which ran to its full wall clock may have done so against a server that was failing intermittently rather than a healthy one.');
  }
  lines.push('');
  return lines;
}
