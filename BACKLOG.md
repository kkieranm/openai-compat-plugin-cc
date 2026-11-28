# BACKLOG

Open work only, in ascending ID order. Completed items move to `BACKLOG_DONE.md`; blocked/refuted/
not-worth-doing items to `BACKLOG_PARKED.md`. IDs are stable and never reused; they continue the
GitHub issue/PR numbering this tracker replaced, so an existing `#N` reference names the same item.
The next ID is `max+1` over all three files (highest used: #48).

- **#33. Job-test and runtime-comment residue: stale claims, narration, unexercised races** (filed 2026-10-08)

  Residue from #25 (740c2f7), extended by later runs. Done: entry 2 (history comments, 2bc2cdb and
  02c4112's `run-buckets.mjs` sweep), entry 4 (1c6a5e3; its G1-G3 parked), entry 5 (fb554ce) and entry 6 (15459ff). Entries 1 and 3 and review residuals R5 and
  R7-R10 were dropped on 2026-11-14 and are in `BACKLOG_PARKED.md`. Entries below keep their numbers and
  are as recorded on 2026-11-15 (issue comment 6896151922), not re-verified since unless marked.

  7. **Narration and stale claims in runtime files, outside fb554ce's comment sites (lines at base 0ae7b67):**
     - `plugins/oai/scripts/lib/cmd-task-worker.mjs`:
       - `:170`: "the row now outlives the sweep";
       - `:189`: "the worker-died discussion above" sits below;
       - `:214`: "publish exactly one terminal verdict" when it publishes at most one;
       - `:241-262`: change narration ("used to be discarded");
       - `:273-274`: "bounded well under STALE_BEAT_MS".
     - `plugins/oai/scripts/lib/task-submit.mjs:42-47`, `:124-132`, `:149`, `:193`, `:267-280`: narration.
     - `plugins/oai/scripts/lib/job-auth.mjs:52-54`: says keying on the query alone would "fail every ad hoc job carrying any query string at all". That holds unless the provider the ad hoc profile is named for (`custom`, or the `--provider` name) is configured at exactly the job's endpoint.

     **In progress (unattended /solo, 2026-11-28).** Owner's standing authorization, given 2026-11-27 before
     leaving: queue "#33 all live, then #48 in ID order"; permissions "Same as last run" (commit to main
     and push; record in BACKLOG.md / BACKLOG_DONE.md; live runs and benches from a frozen worktree; opus
     votes if fable is unavailable); widenings "Same-class fixes allowed"; repo gates "Bypass repo-level
     gates" (no absent-operator gate exists). Base 0ae7b67. Work dir `~/.cache/feature/openai-compat-plugin-cc-33e7-AUKk7W`.
     Expected diff size: 180 lines (comments only, the three files above, every narration or false
     sentence in them — 31 sites: 29 from a whole-file scout inventory, one from the independent plan sketch and one from the plan challenge; tracker moves excluded).
  8. **Test files outside the 12:**
     - `tests/job-busy.test.js:73`: "the three tests above". `:91-92`: "`completed_at = ?` appears in no other statement".
     - `tests/job-busy-diagnosis.test.js:27-31` and `:87-90`: narration.
     - `tests/job-launch-outcome.test.js:4-7`, `:110`, `:160-162` and `:242-248`. The last grounds `writeSync` in "the credential-notice design".
  9. **"Split from" headers** in 17 test files (`command grep -l 'Split from' tests/*.js tests/*.mjs`;
     still 17 on 2026-11-24).
  10. **`tests/job-spawn-failure.test.js:130` overstates**: its assertion message says an `acquired`
      verdict means "the test above proves nothing", but `:116-119` says that test fails on its own when
      terminalization is removed (still so on 2026-11-24).
  11. **`/oai:abandon`'s pending-cancel reply joins two sentences** (filed 2026-11-27 from #33 entry 4's
      review): `cmd-abandon.mjs:149-153` appends the shared tail " and it may still have a model request
      in flight" to an arm that already ends in a full stop. Reproduced 2026-11-27 against a stale running
      row with a pending cancel: "…at its next check-in and exit. and it may still have a model request in
      flight." No test pins that arm's text (`tests/abandon-cli.test.js:38` matches the tail alone).
  12. **`/oai:cancel` writes a newer plugin's row** (filed 2026-11-28 from #33 entry 6's review):
      `runCancel` (`cmd-cancel.mjs:55-67`) refuses only a too-new database, and `requestCancel`'s UPDATE
      (`job-record.mjs:205-213`) carries no `schema_version` predicate, so a non-terminal row a newer
      plugin wrote gets `cancel_requested_at` set. `reconcileAll` leaves that row non-terminal because of
      its version. That contradicts `job-reconcile.mjs:17` ("A row a newer plugin wrote is never mutated").
      Reproduced 2026-11-27 in a scratch state dir with the real companion: a `running`, schema-99 row
      with a reaped pid got `cancel_requested_at` set, and the reply said "Cancelling job foreign, running
      since 0s ago. Its worker checks every 5s." for a worker that was gone. The schema-1 control row in
      the same run was reconciled to `failed` and reported "already failed — nothing was cancelled".
      Tests whose wording assumes the invariant: `tests/queue-reconcile.test.js:44` (title),
      `tests/abandon-cli.test.js:106`, `tests/queue-semantics.test.js:29`.

- **#48. Residue from #47 onward: collectTarget path and claim gaps, test isolation, structural guards** (filed 2026-11-08)

  The live list is the 2026-11-17 backlog sweep (issue comment 6941016378). It judged every open item
  against four keep criteria: a recorded incident; wrong model input with no warning, reproduced in an
  ordinary workflow; a recurring class with two or more fixed occurrences and no structural test; or an
  outstanding verification obligation. The sweep's numbering is used below. Each item's full text and
  measurements are in the comment that filed it.

  Done or parked from the original filing:
  - Original entry 2 (`git show` of an NFD path) was fixed in eafb174 and 5b27ceb.
  - Original entry 3 (bench listing without `-z`) was fixed in eafb174, with a structural test.
  - Original entry 6's "Nothing to review ignores `unreadable`" half was fixed in eafb174.
  - The sweep covered 72 IDs: 8 live (below), 7 merged into another item, 54 parked, 3 removed as process
    notes, plus 2 refuted sub-claims. The parked, refuted and removed entries, among them original entry 1
    (NFD alias sent twice), entry 6's Linux non-UTF-8 half and entry 7 (newline in the FILE header), are in
    `BACKLOG_PARKED.md` with their evidence.

  Live:
  - **26. `oai-delegate.md` takes the root through command substitution, which strips trailing
    newlines.** The class ("a path value loses trailing bytes") has two fixed occurrences and no
    structural test.
  - **36. Test repositories inherit the user's global git config** (`core.ignoreStat`,
    `core.disambiguate`, a SHA-256 default, `commit.gpgSign`, `tag.gpgSign`).
  - **37. No REPO_TRAPS entry or structural test for "a whole-file body read from somewhere other than
    what git diffed".** Open occurrences: under a clean filter or eol conversion the disk branch sends
    unfiltered bytes (reproduced: the diff shows `+XXX` while the body carries `SECRET`); the NFC
    spelling of an NFD-tracked skip-worktree file sends disk bytes with an empty diff.
  - **53. No structural test for "a user value reaches a helper's option parser".**
  - **73. The live LM Studio check is pending** for 3e59bf7, e7a14ae, 94ee785, 042ac83, 83c109c, 8c19e34, 1c6a5e3 and 15459ff.
  - **83. Unidentified test failures involving `first-byte-timeout` assertions** (2026-11-16,
    2026-11-17, each followed by a green rerun). Capture the test name and output next time.
  - **85. A merge file with no `--cc` hunk is neither sent nor named on the no-body rungs** (filed
    2026-11-25 from item 3's review). Under `--diff-only`, or when only hunks are sent, a file that
    differs from every parent yet matches one of them in every region it changes has no hunk in the
    combined diff. `--cc` lists it, so it is not in `mergeOmitted`, and no note names it. Reproduced:
    f.txt (lines 1..30, side edits line 1, main edits line 30, a clean combine); g.txt and p (two
    conflicting regions resolved to different sides); a resolution that reverts both edits. A merge whose
    files are all of this kind reaches the model as a bare commit header and reports "No defects
    reported" (exit 0). That was already true at 0713afa: `git-diff.mjs:408` refuses only an empty diff
    with no files. README.md:55 states the gap.
  - **86. Server or model text reaches the terminal raw outside the review and task `--json` writers**
    (filed 2026-11-25 from item 3's review), `/oai:setup --json` included. Item 3 escaped only the merge
    NOTE, `unreadableNote` and those writers. A server's error text carrying ESC sequences can erase or
    rewrite the terminal lines that show the failure.
  - **87. Lossy-decode name collisions in collectTarget's `pinned` filter and `indexTrustedPaths`**
    (filed 2026-11-25 from item 3's review). Two undecodable names decode to the same U+FFFD
    spelling, so one file's state stands for another's with no error. Item 3 closed this for the merge
    listing only (a U+FFFD there gives `mergeOmitted: null`). Pre-existing at 0713afa; it needs a Linux
    non-UTF-8 name plus a literal U+FFFD twin (the parked non-UTF-8 class).
  - **88. A submodule with `ignore = all` hides a gitlink bump in every review mode** (filed
    2026-11-25 from item 3's review). git's `diff.ignoreSubmodules` drops the bump from the diff and
    from every listing, so the review never sees it and no note says so. Pre-existing at 0713afa.
