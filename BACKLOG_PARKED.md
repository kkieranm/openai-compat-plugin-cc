# BACKLOG — parked

Blocked, refuted, or not-worth-doing items, with the reasoning that parked them so they aren't
re-litigated. Each keeps its stable ID.

- **#33 entry 4, G1-G3 (parked 2026-11-27 by fork 1, unanimous A; G4 shipped in 1c6a5e3)**
  - **G1: cancel-confirmation's FIFO cleanup can leave a wedged child.** Its loop runs only on an already-failing run.
  - **G2: the initial simultaneous-acquisition race is not deterministically exercised.** The exclusion rests on SQLite's `BEGIN IMMEDIATE`.
  - **G3: the queue hold spans about three waiter polls.** Observation depth; `maxInFlight === 1` backs the invariant.
- **#33, sub-items dropped 2026-11-14** (scope vote at 02c4112, issue comment 6881915865)
  - **Entry 1: the TTL no-exposure test overruns under load.** `tests/ttl-challenge-e2e.test.js:193`'s
    100ms reply under a 300ms bar flipped once under background QoS plus 20 `yes` processes. Not
    reproduced: 19/19 green under background QoS with 16 busy loops (2026-11-14). Accepted limitation:
    widening the bar lengthens every TTL test.
  - **Entry 3: `tests/http.test.js` hangs under `taskpolicy -c background`.** Seen three times in
    whole-suite background-QoS runs (48 min killed; 2026-11-01: 9 min idle in `kevent`, then a 7-min miss
    with `--test-timeout=45000` that named no test). Alone under background QoS the file passes in 2.1s.
    Not reproduced in 3 later runs; cause unknown.
  - **R5, R7-R10** (review residuals, numbered by position in issue comment 6726529900), outside the
    scope taken:
    - R5: held-test teardown never awaits worker exit.
    - R7: job-auth's `heldScenario` has no release in finally; its 5s first-byte budget is tight under
      starvation.
    - R8: `job-launch-outcome.test.js:280` (30s) and the bench tests (15s) keep fixed SIGKILL backstops.
    - R9: `isAlive` is a production export with only a test-helper caller
      (`plugins/oai/scripts/lib/job-liveness.mjs`, still so on 2026-11-24).
    - R10: `tests/retention-helpers.mjs` duplicates the ack/log path helpers.

- **#48, sub-items parked by the 2026-11-17 sweep** (issue comment 6941016378, at 042ac83). Item numbers
  are the sweep's.

  #### Parked: not worth doing

  The framing is right, but nothing on record meets the criteria. "Probe" means a constructed reproduction, not a real run that went wrong.

  | Item | What it is | Evidence on record |
  |---|---|---|
  | 1 | macOS: an NFD-tracked file is also sent as an untracked block | probe. On 2026-11-14 duplicate bodies were observed; window pressure and misattributed findings were not. Three dedup filters failed review; any future dedup must prove the dropped body arrives elsewhere |
  | 4 | Linux: a non-UTF-8 untracked name is withheld (its "Nothing to review" half was already fixed in eafb174) | reasoned; APFS rejects such names |
  | 5 | a newline in a path splits the FILE header | code reading |
  | 8, 25, 33, 40, 56, 68 | changes verified on Apple git 2.54.0 / macOS only. Item 68: `core.disambiguate` before git 2.11, and test skips before 2.29 | none |
  | 11 | blob specs parsed as object names | probe in a hand-built tree with a `.` entry, which git's own commands do not write. The describe-suffix (`-g<hex>`) case is derived from git 2.39.5's source and was not run; on 2.54 the specs read their own body |
  | 13 | untested reader properties: `:!`/`:^` names, textconv/smudge parity, Linux FIFO, device, `closeSync` | coverage gaps confirmed by reading; textconv/smudge parity rests on earlier probes; removing `closeSync` leaves the tests green |
  | 14, 55 | stale citations and counts in `.claude/REPO_TRAPS.md` entries, and history narration in a `tests/context-window.test.js` comment | confirmed by reading. Any edit to those lines can fix them in passing |
  | 16 | open edges of the symlink fix: a parent swapped for a link after listing (race), Windows without `O_NOFOLLOW`, hard links, absolute link text, no "(symbolic link)" marker on a link block, lossy decoding, `cancel-ack.mjs`'s separate reader, `blockFor`'s docblock | confirmed by reading. The race needs a swap between git's listing and the read; Windows is untested; a link block sends the link text the diff shows. None reproduced in an ordinary workflow |
  | 18 | no structural test for a fake server left unclosed | one occurrence, fixed in 72651fd; comes back on a second |
  | 27 | `git()` cannot preserve a non-UTF-8 root; an unenterable working directory gets the "Is git installed" hint | code reading |
  | 28 | a git that ends `rev-parse` output with CRLF would leave `\r` on the root | code reading; Git for Windows not run |
  | 29, 30, 31 | skip-worktree / assume-unchanged paths: Claude verifies against the working tree while the index body was sent; git's diff hides those disk edits; a flag can flip between `ls-files -v` and the diff | code reading; no affected review recorded. The open read-path occurrences are in item 37 |
  | 32 | untested: partial clone offline, a blob read failing through a race | none |
  | 62 | production half: `singleCommit` (`/oai:review --commit`) matches git's ambiguity error by its English text, and its first `rev-parse --verify` honours the user's `core.disambiguate` | probe. A translated git gets the generic refusal instead of "Use a longer id"; `core.disambiguate=blob` gets the generic refusal. Its test sub-claim is merged into item 36 |
  | 38 | the review-sweep classification stub treats a missing fixture as a commit with no paths, so one test passes when every lookup misses | probe (renamed fixture keys, test still green). A green test with no affected real sweep |
  | 39 | the replay test has no `--repo` subdirectory case | probe at review time |
  | 41-46, 48, 49 | blind spots in the structural argv and `-z` guards: multi-line and assembled argvs, an option value taken as the revision, path-only argvs flagged, the `>= 9` and `>= 10` floors, spreads, regex literals, untested `${` and backtick arms | synthetic probes and mutations. 2026-11-16 sweep found no production argv in the missed forms; item 42's misplaced `--` is caught by a behavioural test |
  | 47 | `--` does not stop case 5's `..` split | probe; case 5 now reads through `cat-file`, covered in `tests/git-diff.test.js` |
  | 51 | no test pins `--commit`'s refusal order | mutation check |
  | 52 | inline `--base=-x` / `--commit=-x` untested | checked by hand |
  | 54 | REPO_TRAPS's "`--` before arguments you did not author" does not fit `git show --stat -- HEAD` | probe |
  | 57 | empty flag values lack consistent validation. Merges items 59 and 60 | probe. `parseCommandLine` drops empty argv entries, so a shifted token that names a valid ref selects an unintended target; other shifted values fail in git. `--temperature=`, `--top-p=`, `--min-p=`, `--presence-penalty=` become 0; `--model=`, `--provider=`, `--base-url=`, `--cache-buster=` fall back. Successful output shows the effective target, model and provider, and JSON shows sampling, but nothing names the empty argument. Item 60: no REPO_TRAPS entry for the class. Only one occurrence has been fixed (empty `--base`, e7a14ae), so criterion 3 is not met; it comes back on a second |
  | 58 | whitespace or literal-quote `--base` values reach git's own error | probe; the error is loud |
  | 65, 66, 67, 69, 70, 71, 72 | bench sweep `--from` edge cases: reflog-date warning, ambiguous refnames, forwarded stderr, generic refusal, short-id handling, untested accepted inputs | mixed. Probes for 65 and 66 (on 2026-11-16 `main@{2020-01-01}` resolved to the oldest reflog entry with a warning, unchanged across versions); code reading for 67; collision fixtures for 70; exact-argv coverage for 71; 72's accepted-input claims not re-probed |
  | 74 | `--commit HEAD` on an unborn branch gets the generic hint | probe |
  | 75 | a misspelt `--base` on an unborn branch gets the no-commits message | deliberate, chosen by item 19's grill |
  | 76 | an unborn branch beside a ref literally named `HEAD` keeps git's error | code reading; documented limit |
  | 77 | `HEAD` pointing at a missing tag ref is told "This branch has no commits yet" | probe |
  | 78, 79 | the unborn-branch probe's `catch` fallback, and a non-UTF-8 branch name, untested | 78: fallback confirmed by reading. 79: passing literal `HEAD` avoids rebuilding the decoded name |
  | 80 | `git-diff.mjs` says its async-only git rule is guarded in `tests/structure.test.js`, but that guard scans only `tests/` | confirmed by reading. A coverage gap like 13 and 51; no escaped regression found |
  | 82 | on an unborn untracked-only repo, `--staged` gives "Nothing to review" with the generic hint | probe |
  | 84 | REPO_TRAPS does not cite the unborn-branch probe's keep-git's-error tests | confirmed by reading |

  #### Parked: refuted

  - **Item 13**, first sub-claim: "a `cat-file -p` mutant passes all tests". It now fails "a review lists a changed skip-worktree gitlink unreadable". This comes back if that test is removed.
  - **Item 51**, second sub-claim: "`--base`'s order is pinned only through values git itself fails on". Moving the `--base` check after `merge-base` fails 2 tests, including values `merge-base` accepts (`--octopus`, `--independent`, `--fork-point`).

  #### Removed: process notes, not product work

  - **Item 50:** the REPO_TRAPS scope sentence took findings in two review passes; reverting it was not taken.
  - **Item 81:** the review's REVERT option for the `onUnbornBranch` probe region was not taken.
  - **Item 85:** the plan did not search for the old names of tests it renamed.
