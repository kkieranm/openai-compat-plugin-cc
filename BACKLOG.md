# BACKLOG

Open work only, in ascending ID order. Completed items move to `BACKLOG_DONE.md`; blocked/refuted/
not-worth-doing items to `BACKLOG_PARKED.md`. IDs are stable and never reused; they continue the
GitHub issue/PR numbering this tracker replaced, so an existing `#N` reference names the same item.
The next ID is `max+1` over all three files (highest used: #48).

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
  - Items 26, 36, 37, 53 and 85-88 were parked by the 2026-11-28 sweep (no real occurrence), in
    `BACKLOG_PARKED.md`.
  - Item 73 (the pending live check) was closed on 2026-11-28 by a live run; see `BACKLOG_DONE.md`.

  Live:
  - **83. Unidentified test failures involving `first-byte-timeout` assertions** (2026-11-16,
    2026-11-17, each followed by a green rerun; both in session transcript
    `2e52b799-def9-4f7d-9248-84c5a9c73208`, `actual: 'first-byte-timeout'`, output truncated). Capture the
    test name and output next time.
