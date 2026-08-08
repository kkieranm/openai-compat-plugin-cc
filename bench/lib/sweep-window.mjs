// Which window a sweep walked, pinned so that two runs can be compared.
//
// Its own module because the harness file reached this repo's size budget, and
// because the seam is real: this decides WHICH revision is enumerated from, and
// nothing else in the sweep cares how that was arrived at.
//
// The flag exists for the benchmark, where several models review "the same ten
// commits". Enumerating from `HEAD` meant a commit landing between arms silently
// shifted the window and the arms were no longer comparable — so what is
// recorded here is the RESOLVED commit, never the text the caller typed.
import { UserError } from '../../scripts/lib/errors.mjs';

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
  // `git rev-parse` on an unknown revision EXITS 128, so the real caller's
  // `execFileSync` throws before any empty-result check could run. An earlier
  // version tested `!sha` and was dead code in production: the user saw a raw
  // `Command failed: git rev-parse …` instead of this sentence, and the test
  // passed only because its stub returned an empty string where git throws.
  let out;
  try {
    out = String(git(['rev-parse', `${from}^{commit}`]) ?? '');
  } catch {
    throw new UserError(`--from did not resolve to a commit: "${from}".`);
  }
  const sha = out.split('\n').map((line) => line.trim()).filter(Boolean)[0];
  // Kept as well as the catch: a git that someday exits 0 with no output would
  // otherwise pin `undefined`. Two ways to fail, both answered.
  if (!sha) throw new UserError(`--from did not resolve to a commit: "${from}".`);
  return sha;
}
