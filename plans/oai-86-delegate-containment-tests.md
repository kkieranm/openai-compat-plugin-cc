provenance: harness slug oai-86-delegate-containment-tests

# OAI-86 — the delegate recipe's containment machinery has no test anywhere

## Context

`agents/oai-delegate.md`'s shell recipe is the one place this repo enforces that a delegated
attachment stays inside the working tree: it resolves every `--file` path with a Node-based
`canon()` (guarding against `--`-prefixed argument injection and a resolved path carrying a control
character) and refuses anything whose canonicalized path falls outside `root` (the git top level,
or cwd outside a repo). `tests/delegate-template.test.js`'s own `argv()` driver stubs both `canon`
and `root` to identity/`/tmp` (lines 76-87) with an explicit comment: "Nothing anywhere in `tests/`
exercises the recipe's containment — not the boundary check, not `canon`'s `--` argument-injection
defence, not its control-character refusal."

**Probe, confirmed with a positive control**: reverted the `"$root"/*` boundary check to always
match (`case "$real" in *) ;; esac`) and ran the full suite — 1158/1158 still green, including all 7
`delegate-template.test.js` cases. Restored, confirmed clean. This is the exact "a check that
reports success may be one that cannot fail" shape CLAUDE.md names.

No genuine product fork — this adds test coverage for existing, unchanged logic; grill skipped, per
the same convention OAI-59 and other no-fork test-coverage items in this backlog use.

## Fix

New file `tests/delegate-containment.test.js`, split from `delegate-template.test.js` the same way
that file was split from `task-template.test.js` — a real seam (containment vs. argument
construction), not a size ratchet alone this time, though it also keeps the new file's own real-git-
repo fixtures from bloating the existing one.

### 1. Extract a wider block, unstubbed

```js
function containmentBlock() {
  const source = readFileSync(new URL('../agents/oai-delegate.md', import.meta.url), 'utf8');
  const start = source.indexOf("dir='<the absolute path mktemp returned>'");
  const end = source.indexOf('  id=$(node ', start);
  assert.ok(start !== -1 && end > start, 'the recipe must open with the dir/root preamble and submit after it');
  return source.slice(start, end);
}
```

This starts *before* `recipeBlock()`'s existing window (which begins at `set --`), so it now
includes the `dir=`/`case "$dir" in`/`[ -L "$dir" ]`/`chmod 700`/`canon()`/`root=` preamble — the
real `canon` function, unstubbed, and the real `git rev-parse --show-toplevel` resolution.

### 2. Drive it against a real scratch git repo

A `withScratchRepo(fn)` helper: `mkdtempSync`, `git init -q`, runs `fn(repoPath)`, and a driver
`runContainment(repoPath, files)` that:

- `mktemp -d /tmp/oai-delegate.XXXXXX` for real (so the recipe's own `case "$dir" in
  /tmp/oai-delegate.*)` prefix check passes) — the temp directory the recipe writes `files`/reads
  from, distinct from `repoPath` (the scratch git tree `root` resolves against).
- Substitutes the placeholder `dir='<...>'` line with the real mktemp'd path, sets `cwd: repoPath`
  when spawning so `git rev-parse --show-toplevel` resolves `root` to the scratch repo for real.
  `SHELL = REQUIRED_SHELL` (zsh) only — `delegate-template.test.js`'s multi-shell matrix exists for
  the argument-construction bug that was shell-specific; containment is shell-agnostic node/git
  logic, so one real interpreter is sufficient here and running the full matrix would be padding,
  not coverage.
- Appends the same `for a in "$@"; do printf '%s\0' "$a"; done` capture tail
  `delegate-template.test.js`'s `argv()` already uses, so argv is observed losslessly the same way.

### 3. Test cases (all against real filesystem entries, real git, real `canon`)

- **A plain in-tree file** → accepted; argv contains `--file <its real resolved path>`.
- **An in-tree symlink pointing to another in-tree file** → accepted (containment is about the
  *resolved* location, not whether the entry is itself a symlink).
- **An in-tree symlink pointing outside the tree** (the exact hazard the recipe's own prose names:
  "an in-tree symlink pointing outside the tree is recorded under the innocuous in-tree name") →
  refused, message names the offending path and `$root`, exit 1.
- **An absolute path outside the tree, not a symlink** (e.g. a sibling scratch directory) → refused
  the same way — covers "`--file` accepts absolute paths ... so resolving the name is not enough"
  from the recipe's own docs, distinct from the symlink case above.
- **The `root="$PWD"` fallback, outside any git repository.** **Added in plan-gate round 1** (Codex:
  the original design's `withScratchRepo` always ran `git init`, so `root=$(git rev-parse
  --show-toplevel...)` never fell through to its own stated fallback — a real, distinct branch of
  root-resolution the plan's own prose claimed was covered by "containment" but wasn't). One case
  in a scratch directory with no `git init`: a plain file inside it → accepted, `$root` resolves to
  the directory itself (`git rev-parse` fails, `root="$PWD"` fires); a symlink pointing outside that
  same directory → refused the same way as the git-repo case above, proving containment still
  enforces a boundary when there is no repository to anchor to.
- **A raw manifest entry that starts with `--`, exercising Node's own CLI parser.**
  **Corrected in plan-gate round 1 (Codex, `CHANGES-REQUIRED`)**: the original design proposed a
  filename containing `/` inside one path component, which the filesystem cannot represent.
  **Corrected AGAIN in plan-gate round 2**: round 1's own replacement (`--require/evil.js`) was
  itself wrong — Codex's round-2 review and this session's own direct empirical check both confirmed
  `--require/evil.js` is not valid `--require` option syntax; without `--`, Node reports a generic
  `bad option: --require/evil.js` (exit 9) and never attempts to load anything — a different,
  shallower failure than the documented exploit. The Claude verdict subagent's round-2 approval of
  the wrong construction is exactly the "don't silently trust one verdict over a conflicting one"
  case: both were checked directly against real Node rather than taken on either reviewer's word.

  **Verified construction** (directory literally named `--require=.` containing `evil.js`,
  referenced by the manifest string `--require=./evil.js`):
  ```
  mkdir -- '--require=.'; echo payload > '--require=./evil.js'
  ```
  - `fs.realpathSync('--require=./evil.js')` resolves correctly (confirmed: `--require=.` is
    treated as a literal directory name, never as a `.`-shorthand, since it only means "current
    directory" as an entire path *component* on its own — here it is 12 characters ending in `.`,
    not the single character `.`).
  - **With `--` present** (the real recipe): `canon` resolves it and returns the real path, exit 0
    — confirmed directly.
  - **With `--` removed** (the mutation check): Node parses `--require=./evil.js` as its own
    `--require` flag with argument `./evil.js`, genuinely attempts `require('./evil.js')` relative
    to Node's cwd, and fails with `MODULE_NOT_FOUND` (`Cannot find module './evil.js'`) — confirmed
    directly, exit 1, no resolved path printed. This is real, specific evidence that Node's flag
    parser is actually invoked on the raw string (attempting real module resolution), not merely a
    generic dash-prefix rejection — the precise property `--` exists to prevent.
  Two integration cases, using this construction:
  - The `--require=.` directory is in-tree → accepted, argv's `--file` value is the resolved real
    path.
  - The same directory is reached via an in-tree symlink pointing **outside** the tree → refused,
    asserting the specific "outside `$root`" boundary message (not merely a nonzero exit) — proving
    the injection defence and the containment check compose, rather than one masking whether the
    other still runs.
  Plus the isolated mutation check above (drive the extracted `canon` alone, `--` present vs.
  removed) as the load-bearing proof for this specific guard, the same isolation principle applied
  to the control-character check below.
- **`canon`'s control-character guard, tested directly and in isolation — NOT through the full
  integration block.** **Replaced in plan-gate round 1 (Codex, `CHANGES-REQUIRED`)**: the original
  design placed a control-character path *outside* the tree, reached via an in-tree symlink — but
  Codex correctly identified that with the control-character check hypothetically absent, the
  outside-root boundary check still refuses the same resolved path for its own, independent reason.
  Both "guard present" and "guard absent" branches produce the same observable outcome (refused),
  so that design could never distinguish a working control-character check from a broken one — the
  exact "a check that reports success may be one that cannot fail" shape this repo's own CLAUDE.md
  names. Codex's proposed alternative (a truncation-collision attack via a real file named with a
  trailing newline, colliding with an in-tree sibling once bash's `$(...)` strips it) is the actual
  documented attack, but constructing it reliably is itself involved and admitted by Codex's own
  hedging ("proves guard ordering, not that the documented bypass is prevented" was raised as a risk
  of an *insufficiently* isolated version of that same design). The simpler, robust fix: extract
  `canon()`'s own function definition as its own small block (a second, narrower extraction distinct
  from `containmentBlock()`) and drive it directly under `node`, with no shell integration and no
  other guard in the path to mask a result:
  ```js
  function canonBlock() {
    const source = readFileSync(new URL('../agents/oai-delegate.md', import.meta.url), 'utf8');
    const start = source.indexOf('  canon() { node -e ');
    const end = source.indexOf('\n\n', start);
    assert.ok(start !== -1 && end > start);
    return source.slice(start, end);
  }
  ```
  Run the extracted `canon` shell function directly (`zsh -c "$(canonBlock()); canon \"$1\""`) against:
  - A clean, real in-tree path → succeeds, prints the resolved path, no control character.
  - A real filesystem entry literally named with an embedded newline (confirmed creatable on this
    filesystem during probing — `fs.realpathSync` returns the literal control character intact) →
    `canon` itself throws/refuses, independent of any boundary check, since there is none in this
    narrower harness to mask the result either way.
- **The dir preamble, tested separately** (no git repo needed — this doesn't reach `canon`/`root`):
  a small `dirPreambleBlock()` extraction of the `case "$dir" in /tmp/oai-delegate.*)`/`[ -L "$dir"
  ]`/`[ -d "$dir" ]`/`chmod 700` lines. Two cases: a `$dir` not matching the `/tmp/oai-delegate.*`
  prefix → refused; a `$dir` that is itself a symlink (point a real symlink at a real directory,
  named under the `/tmp/oai-delegate.*` pattern so only the symlink check is under test) → refused.

## Files touched

- `tests/delegate-containment.test.js` — new file, all of the above.

No production code changes — `agents/oai-delegate.md`'s recipe is unmodified; this is pure test
coverage for existing, already-shipped logic.

## Verification

1. `npm test` — full suite green, new file included.
2. Mutation check, once per guard, the established pattern: temporarily weaken
   `agents/oai-delegate.md`'s real recipe (the boundary check, the `--` separator, the
   control-character check, the `[ -L "$dir" ]` check, the dir-prefix check), confirm the
   corresponding new test fails with the predicted symptom, restore, confirm green. This is the
   same positive-control shape the probe already used once to confirm the gap was real.
3. Confirm the existing `delegate-template.test.js` suite is unaffected — it keeps its own stubbed
   `canon`/`root` for argument-construction testing, which is a legitimate, distinct concern from
   containment and stays stubbed on purpose.

## Step 9 residue

- Close OAI-86.
- No further residue expected — this closes the exact gap the item names, with no discovered
  extension during the probe (the recipe's containment logic is confined to `agents/oai-delegate.md`
  alone; nothing elsewhere in the codebase re-implements it).
