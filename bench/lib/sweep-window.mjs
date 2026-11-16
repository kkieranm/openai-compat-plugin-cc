// Which window a sweep walked, and when it stops opening new work.
//
// Its own module because the harness file reached this repo's size budget, and
// because the seam is real: this decides WHICH revision is enumerated from and
// UNTIL WHEN, and nothing else in the sweep cares how either was arrived at.
//
// The flag exists for the benchmark, where several models review "the same ten
// commits". Enumerating from `HEAD` meant a commit landing between arms silently
// shifted the window and the arms were no longer comparable — so what is
// recorded here is the RESOLVED commit, never the text the caller typed.
import { UserError } from '../../plugins/oai/scripts/lib/errors.mjs';
import { FULL_OBJECT_ID } from '../../plugins/oai/scripts/lib/git-diff.mjs';

/**
 * When to stop STARTING work.
 *
 * `--until` is the flag this exists for — you say 06:00 at bedtime and mean
 * tomorrow morning — so an hour already past today resolves to the next
 * occurrence rather than to a deadline in the past, which would end the sweep
 * before it began. One of the two is required: a sweep with no stop condition is
 * not the thing that was asked for, so it must not be reachable by omission.
 *
 * The next occurrence is the next local CALENDAR DATE at the requested
 * hour and minute, not "24 hours later". Across a DST boundary those differ by
 * an hour, and it is precisely the overnight run that crosses one — in
 * Europe/London, `--until 06:00` started at 23:00 on the spring transition
 * resolved to 07:00 when this added a fixed 86,400,000 ms.
 */
export function resolveDeadline({ until, minutes }, startMs) {
  if (until && minutes) throw new UserError('Pass --until or --minutes, not both.');
  if (minutes !== undefined) {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) throw new UserError(`--minutes must be a positive number, got "${minutes}".`);
    return startMs + n * 60_000;
  }
  if (!until) throw new UserError('A stop condition is required: pass --until <HH:MM> or --minutes <N>.');
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(until);
  if (!match) throw new UserError(`--until must be HH:MM in 24-hour local time, got "${until}".`);
  const at = new Date(startMs);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (at.getTime() > startMs) return at.getTime();
  at.setDate(at.getDate() + 1);
  return at.getTime();
}

/**
 * Resolve a revision to the commit SHA that will be recorded and reviewed.
 *
 * A branch name or `HEAD` is accepted at the command line and pinned here.
 * Recording the raw ref instead would let two arms enumerate different histories
 * from identical-looking input, which is precisely the defect this exists to
 * remove — the ref is the caller's convenience, the SHA is the evidence.
 *
 * `^{commit}` is load-bearing, not decoration: without it an annotated tag
 * resolves to the TAG object rather than the commit it points at, and the
 * recorded `from` would be a SHA no `git log` walk starts at.
 */
export function resolvePin(from, git) {
  // Refused before it can reach `git log`, where a leading dash is read as an
  // OPTION rather than a revision.
  if (from.startsWith('-')) throw new UserError(`--from must be a revision, got "${from}".`);
  // Resolved to a commit SHA, and it is the RESOLVED value that is recorded and
  // reviewed. A branch name or `HEAD` is accepted at the command line and pinned
  // here — recording the raw ref would let two benchmark arms enumerate
  // different histories from the same-looking input, which is the whole defect
  // this flag exists to remove.
  // `git rev-parse` exits 128 on a revision it cannot resolve, so the real
  // caller's `execFileSync` throws; the catch reports it as this sentence rather
  // than a raw `Command failed`.
  // `--verify` makes git turn the argument into one id or fail. Without it a range
  // prints several lines, and an argument naming a file in the swept repository
  // is echoed back with exit 0. It still prints `^<sha>` for `^X`, so each
  // output must also be one full object id.
  // Two steps, because a suffix appended to the caller's text becomes part of
  // it: `:/<text>^{commit}` searches for `<text>^{commit}`. The caller's
  // revision is resolved on its own, and only the id it named is peeled.
  // `-c core.disambiguate=committish` lets a short id that a commit shares with a
  // tree or blob name the commit, as a `^{commit}` suffix does, and overrides any
  // `core.disambiguate` the user set.
  const refused = () => new UserError(`--from did not resolve to a commit: "${from}".`);
  const resolve = (revision, config = []) => {
    let out;
    try {
      out = String(git([...config, 'rev-parse', '--verify', revision]) ?? '').trim();
    } catch {
      throw refused();
    }
    if (!FULL_OBJECT_ID.test(out)) throw refused();
    return out;
  };
  return resolve(`${resolve(from, ['-c', 'core.disambiguate=committish'])}^{commit}`);
}
