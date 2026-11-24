# BACKLOG

Open work only, in ascending ID order. Completed items move to `BACKLOG_DONE.md`; blocked/refuted/
not-worth-doing items to `BACKLOG_PARKED.md`. IDs are stable and never reused; they continue the
GitHub issue/PR numbering this tracker replaced, so an existing `#N` reference names the same item.
The next ID is `max+1` over all three files (highest used: #48).

- **#33. Job-test and runtime-comment residue: stale claims, narration, unexercised races** (filed 2026-10-08)

  Residue from #25 (740c2f7), extended by later runs. Done: entry 2 (history comments, 2bc2cdb and
  02c4112's `run-buckets.mjs` sweep) and entry 5 (fb554ce). Entries 1 and 3 and review residuals R5 and
  R7-R10 were dropped on 2026-11-14 and are in `BACKLOG_PARKED.md`. Entries below keep their numbers and
  are as recorded on 2026-11-15 (issue comment 6896151922), not re-verified since unless marked.

  4. **Pre-existing job-test gaps, recorded and not fixed:** cancel-confirmation's FIFO cleanup can leave
     a wedged child; the initial simultaneous-acquisition race is not deterministically exercised; the
     queue hold spans about three waiter polls; the `started_at` ordering assert has a pre-lock stamp
     window.
  6. **False or stale claims in the 12 job test files fb554ce edited, on lines it did not rewrite.** None is narration:
     - `tests/liveness-unreadable-pid.test.js:12-13`: says `1.5` throws a TypeError. `:37-41`: the `deadPid` rationale says the assertion would pass, but `'unreadable'` ≠ `'gone'`, so it would fail.
     - `tests/abandon-recovery.test.js:1`: says the file covers rows `/oai:abandon` did not simply write off, but several of its tests do write rows off. `:29`: "a row that never had one" sits on a synthetic fixture that carries a spawn stamp. `:195`: "the plain stale wedge above" is not above. `:205`: "retention can prune the row".
     - `tests/queue-reconcile.test.js:101`: "never spawned" prose on a stamped fixture. `:307-315`: the `never-started` liveness reading is right, but "no worker to have changed state at all" and "a worker that never existed" infer more than the fixture shows. `:181-186`: "holds while its pid is READABLE" and "FIRST rung". `:214`: the label `(6)` contradicts `:222`.
     - `tests/status-blocker-render.test.js`:
       - `:122-137`: "Three conditions" and "read from a database a newer plugin wrote";
       - `:217-218`: a causal "so";
       - `:233-234`: "the only action that clears it";
       - `:242-243`: "this file".
     - `tests/job-busy-placement.test.js:4`, `:141-143` ("the stamp only shortens a startup grace window"; the stamp's absence does that) and `:210` ("id of a running job").
     - `tests/blocker-helpers.mjs:20-25`: the `breakStamps` docblock says `ago()` "always yields a parseable ISO string". But `ago(null)` returns `null` (`tests/job-helpers.mjs:111`), and `agedMs: null` feeds both stamps.
  7. **Narration and stale claims in runtime files, outside fb554ce's comment sites:**
     - `plugins/oai/scripts/lib/cmd-task-worker.mjs`:
       - `:170`: "the row now outlives the sweep";
       - `:189`: "the worker-died discussion above" sits below;
       - `:214`: "publish exactly one terminal verdict" when it publishes at most one;
       - `:241-262`: change narration ("used to be discarded");
       - `:273-274`: "bounded well under STALE_BEAT_MS".
     - `plugins/oai/scripts/lib/task-submit.mjs:42-47`, `:124-132`, `:149`, `:193`, `:267-280`: narration.
     - `plugins/oai/scripts/lib/job-abandon.mjs:254`: "the placement is the fix".
     - `plugins/oai/scripts/lib/job-auth.mjs:52-54`: says keying on the query alone would "fail every ad hoc job carrying any query string at all". That holds only without a configured `custom` provider.
  8. **Test files outside the 12:**
     - `tests/job-helpers.mjs:16`: names a `job-secrets.test.js` that does not exist. `:87-89`: loose "rejected on shape" wording.
     - `tests/abandon-cli.test.js:128-129`: says its twin lives in abandon-messages.
     - `tests/job-busy.test.js:73`: "the three tests above". `:91-92`: "`completed_at = ?` appears in no other statement".
     - `tests/job-busy-diagnosis.test.js:27-31` and `:87-90`: narration.
     - `tests/job-launch-outcome.test.js:4-7`, `:110`, `:160-162` and `:242-248`. The last grounds `writeSync` in "the credential-notice design".
     - `tests/queue-semantics.test.js:3-5`: ordinal and split narration.
  9. **"Split from" headers** in 17 test files (`command grep -l 'Split from' tests/*.js tests/*.mjs`;
     still 17 on 2026-11-24).
  10. **`tests/job-spawn-failure.test.js:130` overstates**: its assertion message says an `acquired`
      verdict means "the test above proves nothing", but `:116-119` says that test fails on its own when
      terminalization is removed (still so on 2026-11-24).

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
  - **2. A case-only rename leaves `pinnedRemoved` false** (original entry 4). Reproduces on macOS:
    `Dir/gone.txt`, renamed to `dir` on disk and `rm --cached`, is sent as `files: ["dir/gone.txt"]` with
    `pinnedRemoved: false`. `git-diff.mjs` compares NFC spellings only, with no case folding.
  - **3. A merge reviewed with `--commit` can claim completeness for files it does not hold** (original
    entry 5). Reproduced: a merge that resolves `a.txt` and brings `c.txt` in from one parent gives
    `changed: ["a.txt"]` (`diff-tree --cc`). `c.txt` is in neither the blocks nor the combined diff, and no
    note names it.
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
  - **73. The live LM Studio check is pending** for 3e59bf7, e7a14ae, 94ee785 and 042ac83.
  - **83. Unidentified test failures involving `first-byte-timeout` assertions** (2026-11-16,
    2026-11-17, each followed by a green rerun). Capture the test name and output next time.
