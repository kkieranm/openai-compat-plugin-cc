# BACKLOG

Open work only, in ascending ID order. Completed items move to `BACKLOG_DONE.md`; blocked/refuted/
not-worth-doing items to `BACKLOG_PARKED.md`. IDs are stable and never reused; they continue the
GitHub issue/PR numbering this tracker replaced, so an existing `#N` reference names the same item.
The next ID is `max+1` over all three files (highest used: #48).

- **#33. TTL e2e residue: no-exposure timing margin; history comments; http.test under background QoS** (filed 2026-10-08)

  Residue from #25 (740c2f7).

  1. **The no-exposure test still depends on load.** In `tests/ttl-challenge-e2e.test.js`, the test "a wasted episode…" relies on the fake server's 100ms challenge reply staying under the 300ms exposure bar. Under background QoS plus 20 `yes` processes, the measured prefill reached 1239ms and the verdict flipped to `survived-past-expiry`. That delay comes from a `setTimeout` in the in-process fake server (`tests/ttl-e2e-harness.mjs`), which the stub fix does not touch. It has not been seen failing in a normal `npm test`.
  2. **Process-history comments in TTL and bench test support files** should be restated as current behaviour, or deleted where they are pure history:
     - `tests/ttl-e2e-harness.mjs:11` ("Split from the test file at the 300-line ratchet"). This is also stale: the test file is now over 300 lines.
     - `tests/ttl-e2e-harness.mjs:25` ("once cost a 204-second suite")
     - `tests/ttl-e2e-harness.mjs:57-60` ("The first run of this harness got that wrong")
     - `bench/lib/run-buckets.mjs:14`
     - `bench/lib/sweep-report.mjs:108` ("used to be")
  3. **`tests/http.test.js` does not finish under `taskpolicy -c background`.** It ran for 48 minutes before it was killed, during a whole-suite run with background QoS. The normal-QoS suite is unaffected.

- **#48. Residue from #47: path identity and listing gaps in collectTarget** (filed 2026-11-08)

  Residue from #47 (38a06cc). Each entry records what was observed. All of them except entry 1 were already true at f730116.

  1. **macOS: a file tracked under an NFD name is also sent as an untracked block.** Open. Under precomposition, `ls-files --others -z` lists the NFC spelling of an NFD-tracked file as untracked.
     - The file is sent as an extra FILE block whenever it exists. When it is modified, it is sent twice, because the `changed` dedup is byte-exact. The same happens after a case-plus-normalization rename on case-insensitive APFS.
     - A tree with nothing else changed is reviewed instead of reported as "Nothing to review".
     - The whole-files claim stays true and no body is lost. The cost is window: the alias is a pinned block, so the ladder cannot drop it.
     - This became visible with #47; before it, the quoted alias was unreadable.
     - Three filters that dropped the alias each passed a plan gate and then failed review with a reproduced case:
       - An NFC name key missed a case rename.
       - Inode identity over the index (lstat plus nlink 1) matched a genuinely new file reached through a tracked path's symlinked ancestor, and dropped its only copy.
       - Excluding `git diff-files --diff-filter=D` paths missed assume-unchanged and skip-worktree entries, with the same silent drop.
     - An alias that git lists under an ASCII spelling (a tracked U+212A or U+017F name) was never examined.
     - Any future dedup would need proof that the dropped body arrives elsewhere in the request.
  2. **`git show <ref>:<NFD path>` fails under precomposition.** Open. For `--commit`, `--base` and `--staged`, git precomposes argv, so a tracked NFD path is looked up as NFC. The result is `fatal: path ... exists on disk, but not in 'HEAD'`, and the body lands in `unreadable`. It fails loudly. Reproduced in a scratch repo.
  3. **A git path listing without `-z` in the bench.** Open. `bench/review-sweep.mjs:92` runs `show --name-only` without `-z`, and `tests/bench-corpus.test.js:107,113` list paths the same way. This is the second instance of the missing-`-z` class, and it is a candidate for a structural test in `tests/structure.test.js`.
  4. **A case-only rename leaves `pinnedRemoved` false.** Open. On case-insensitive APFS, take tracked `Dir/gone.txt`, rename the directory to `dir` on disk, and `rm --cached` the file. The diff lists `D Dir/gone.txt` and the untracked listing lists `dir/gone.txt`. The removed file's disk copy is sent while the claim stands. Reproduced.
  5. **A merge reviewed with `--commit` can claim completeness for files it does not hold.** Open. `diff-tree --cc` lists only paths that differ from every parent. A merge that resolves a conflict in one file and brings another in from one parent lists only the first, so the claim can stand while the second is in neither the blocks nor the combined diff. Reasoned by Codex; not run.
  6. **A non-UTF-8 untracked name (Linux) is still withheld, and "Nothing to review" ignores `unreadable`.** Open. `git()` decodes stdout as UTF-8, so a Latin-1 name decodes to U+FFFD, names no file, and lands in `unreadable`. `collectTarget` throws "Nothing to review" when the diff is empty and `files` is empty, whatever `unreadable` holds. A tree whose only change is an unreadable untracked file therefore reports empty and loses the note. Shown on macOS with a mode-000 file. The non-UTF-8 half is reasoned, because APFS rejects such names.
  7. **A newline in a path splits the FILE header line.** Open, cosmetic. `buildMessages` writes `--- FILE: <path> ---` verbatim. `requestTextOf` still finds the END marker. `--file` could already produce such a header, and #47 lets the untracked path reach it too.

  Also learned in this run: the NFD `pinnedRemoved` test skips on Linux, and no CI exists, so the NFC branch is covered only by macOS runs.
