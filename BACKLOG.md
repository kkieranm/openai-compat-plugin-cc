# BACKLOG

Open work only, in ascending ID order. Completed items move to `BACKLOG_DONE.md`; blocked/refuted/
not-worth-doing items to `BACKLOG_PARKED.md`. IDs are stable and never reused; they continue the
GitHub issue/PR numbering this tracker replaced, so an existing `#N` reference names the same item.
The next ID is `max+1` over all three files (highest used: #48).

- **#33. Job-test and runtime-comment residue: stale claims, narration, unexercised races** (filed 2026-10-08)

  Residue from #25 (740c2f7), extended by later runs. Done: entry 2 (history comments, 2bc2cdb and
  02c4112's `run-buckets.mjs` sweep), entry 4 (1c6a5e3; its G1-G3 parked), entry 5 (fb554ce), entry 6 (15459ff), entry 7 (87e1258) and entry 8 (04dd5d1). Entries 1 and 3 and review residuals R5 and
  R7-R10 were dropped on 2026-11-14 and are in `BACKLOG_PARKED.md`. Entries below keep their numbers and
  are as recorded on 2026-11-15 (issue comment 6896151922), not re-verified since unless marked.

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
  13. **Same-class comment and hint residue outside entry 7's files** (filed 2026-11-28 from #33 entry 7's
      review; each line unchanged at 0ae7b67 and read by a review stage that day):
      - `plugins/oai/scripts/lib/job-reconcile.mjs:72-73`, a user-facing `cancel-unconfirmed` hint: "a worker
        killed after the model answered and before it recorded anything held that answer only in memory".
        On the path where the worker's `completed` write threw, `salvageOutcome` had already written the
        answer to the job log, so the hint steers the user away from the one place the answer is, until
        retention prunes the row and unlinks that log.
      - `plugins/oai/scripts/lib/job-store.mjs:96`: "Bumped to 2: a `transport` may now carry …".
      - `plugins/oai/scripts/lib/config.mjs:361-363` ("Skipping this check let a typo yield …") and
        `:383-385` ("… instead was a real defect"): history narration.
      - `plugins/oai/scripts/lib/job-heartbeat.mjs:110-116`: "… are now attempted independently".
      - Added 2026-11-28 from #33 entry 8's review (each line read at 04dd5d1):
        `plugins/oai/scripts/lib/job-auth.mjs:157-160` says `normalizeBaseUrl` quotes a malformed baseUrl
        "verbatim" and a JSON-parse error "can quote a snippet of the config FILE"; both are false
        (`config.mjs:232` never interpolates the URL, `config.mjs:109-119` throws a static parse message).
        `plugins/oai/scripts/lib/job-store.mjs:377-380`: a caller's statement "has no retry loop around it",
        though seven `withBusyRetry` call sites wrap callers' statements.
        `tests/job-busy-heartbeat.test.js:50-52` ("Before the fix …") and `:100` ("until this test
        existed"); `tests/retention.test.js:189-193` ("now has a witness") and `:208` ("predates this
        one"): history narration.
  14. **No test discriminates `resolveCredential`'s no-forward catch** (filed 2026-11-28 from #33 entry 8's
      review). `job-auth.mjs:156-170` is the only layer keeping some raw config values out of a job's
      failure message: `resolveApiKey` quotes `apiKeyEnv` (`config.mjs:299`), so a key pasted into that
      field reaches the catch. Every leak test in `tests/job-auth.test.js` drives `normalizeBaseUrl` or
      `loadConfig`, whose messages are already static. Reproduced 2026-11-28 in a scratch copy: the catch
      changed to forward `e.message` left all six leak tests green, and `resolveProfile` with
      `apiKeyEnv: "sk-live-PASTED"` threw a message quoting that value.


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
  - **73. The live LM Studio check is pending** for 3e59bf7, e7a14ae, 94ee785, 042ac83, 83c109c, 8c19e34, 1c6a5e3, 15459ff, 87e1258 and 04dd5d1.
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
