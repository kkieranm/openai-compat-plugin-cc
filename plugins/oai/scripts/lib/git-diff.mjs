// What gets reviewed. Collected here rather than in the command markdown:
// diff text passed through "$ARGUMENTS" walks straight into the prose-vs-shell
// trap in .claude/REPO_TRAPS.md, and a call from here is testable.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserError } from './errors.mjs';
import { readFileBlocks } from './prompt.mjs';

const NUL = String.fromCharCode(0);

// Async only: a synchronous spawn blocks the event loop, which deadlocks the
// in-process fake server the tests run against (repo trap, guarded in
// tests/structure.test.js).
function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) =>
      reject(new UserError(`Could not run git: ${error.message}`, { hint: 'Is git installed and on PATH?' })),
    );
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function runGit(args, cwd) {
  const result = await git(args, cwd);
  if (result.status !== 0) {
    throw new UserError(`git ${args.join(' ')} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

/**
 * The repository root, which is the base every path here is resolved against.
 *
 * `git diff --name-status` reports paths relative to the **root** whatever
 * directory it is run from, while `git ls-files --others` reports them relative
 * to the cwd and lists only what is beneath it. Joining a root-relative path
 * onto a subdirectory cwd fails to read every file, and a swallowed read looks
 * exactly like a file with no content to send — a review that quietly lost its
 * whole files while reporting a normal run.
 */
async function repositoryRoot(cwd) {
  const { status, stdout } = await git(['rev-parse', '--show-toplevel'], cwd);
  if (status !== 0) {
    throw new UserError(`Not a git repository: ${cwd}`, {
      hint: 'Run this from inside a repository, or pass --file <path> to review whole files instead.',
    });
  }
  return stdout.trim();
}

/**
 * One reviewable block, or null when the file cannot be one: vanished between
 * listing and reading, or binary — a blob is noise the model cannot review and
 * would eat the window the real files need.
 */
async function blockFor(path, readContent) {
  let content;
  try {
    content = await readContent(path);
  } catch {
    return null;
  }
  return content.includes(NUL) ? null : { path, content };
}

/**
 * Blocks for every path that yielded one, and the paths that did not.
 *
 * The failures have to come back. A path git listed as changed whose body could
 * not be read (an unmerged path mid-conflict, a file removed under us) would
 * otherwise vanish from `changed` leaving no trace — and the request would go
 * on to claim it holds the complete content of every changed file.
 */
async function blocksFor(paths, readContent) {
  const blocks = [];
  const unreadable = [];
  for (const path of paths) {
    const block = await blockFor(path, readContent);
    if (block) blocks.push(block);
    else unreadable.push(path);
  }
  return { blocks, unreadable };
}

/**
 * Untracked files, as whole-file blocks. Without these the default target would
 * miss every file a feature adds — which is most of what a new feature is.
 */
async function untrackedBlocks(root) {
  const listed = await runGit(['ls-files', '--others', '--exclude-standard'], root);
  return blocksFor(listed.split('\n').filter(Boolean), (path) => readFileSync(join(root, path), 'utf8'));
}

/**
 * Changed paths from `--name-status -z`: STATUS\0path\0 pairs, except renames
 * and copies, which carry both paths (R100\0old\0new\0).
 *
 * A combined diff (`--cc`, for a merge) gives one status letter per parent, so
 * "MM" and "AA" are ordinary. Only an all-`D` status means the file is gone and
 * has no content to fetch; anything else is attempted, and a failed attempt is
 * *recorded* rather than assumed. Guessing existence from the letters would
 * silently drop a file, where attempting and failing merely adds a note.
 */
function changedPaths(raw) {
  const paths = [];
  for (const { status, path } of statusEntries(raw)) {
    if (path && !/^D+$/.test(status)) paths.push(path);
  }
  return paths;
}

/**
 * The paths this change takes away: a deletion's, and a rename's old path. A copy
 * leaves its source in place.
 */
function removedPaths(raw) {
  const paths = [];
  for (const { status, from, path } of statusEntries(raw)) {
    if (/^D+$/.test(status)) paths.push(path);
    else if (/^R\d*$/.test(status)) paths.push(from);
  }
  return paths;
}

// `path` is the new path for a rename or copy: that is the one with content to read.
function* statusEntries(raw) {
  const fields = raw.split(NUL).filter((field) => field !== '');
  for (let i = 0; i < fields.length; ) {
    const status = fields[i];
    const moved = /^[RC]\d*$/.test(status);
    yield { status, from: fields[i + 1], path: fields[i + (moved ? 2 : 1)] };
    i += moved ? 3 : 2;
  }
}

const OVERRIDES = 'Use --staged, --base <ref>, --commit <ref>, or --file <path> to choose what to review.';

/**
 * The one commit `--commit` names, as an id, so the diff, the list and the bodies
 * all read the same object. Two steps: `^{commit}` on the ref itself would refuse
 * `:/text`, and `--verify` alone passes `^HEAD`, printing `^<id>`, a tree, a blob
 * and an id whose object is absent. A range exits nonzero though it prints ids, so
 * the status is read first.
 */
async function singleCommit(ref, root) {
  const resolved = await git(['rev-parse', '--verify', ref], root);
  const ambiguous = /^error: short object ID \S+ is ambiguous$/m.exec(resolved.stderr);
  if (ambiguous) {
    throw new UserError(`--commit ${ref}: ${ambiguous[0].replace(/^error: /, '')}.`, { hint: 'Use a longer id.' });
  }
  const id = resolved.status === 0 ? resolved.stdout.trim() : '';
  const commit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id)
    ? await git(['rev-parse', '--verify', '--quiet', `${id}^{commit}`], root)
    : null;
  if (commit?.status !== 0) {
    throw new UserError(`--commit takes one commit: ${ref || '(empty)'} could not be resolved to one.`, {
      hint:
        'A range is refused: --base <ref> reviews from where that ref meets HEAD up to HEAD; to review up to ' +
        'another commit, check it out first. If the ref is right, its objects may be missing here: fetch them.',
    });
  }
  return commit.stdout.trim();
}

/**
 * Which diff, and — just as importantly — which revision the whole files come
 * from. Reading the working tree for a `--commit` review would show the model
 * code that was never in the change it is being asked about, so every mode
 * pairs its diff with the matching content reader.
 */
async function selectDiff(options, root) {
  if (options.commit !== undefined) {
    const ref = await singleCommit(options.commit, root);
    return {
      label: `commit ${options.commit}`,
      diff: await runGit(['show', ref], root),
      // --root and --cc exist to make this list agree with `git show` above.
      // Without --root a repository's first commit lists no files; without --cc
      // neither does a merge, though `git show` prints a combined diff for any
      // merge that resolved a conflict. Both would drop whole files for a
      // commit that plainly changed them, and nothing would say so. --cc leaves
      // ordinary commits untouched.
      listArgs: ['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', '--cc', '-z', ref],
      readContent: (path) => runGit(['show', `${ref}:${path}`], root),
    };
  }
  if (options.base) {
    // Computed once and reused: a second `merge-base` call could disagree with
    // the one the diff was taken against.
    const mergeBase = (await runGit(['merge-base', options.base, 'HEAD'], root)).trim();
    return {
      label: `branch vs ${options.base}`,
      diff: await runGit(['diff', `${mergeBase}..HEAD`], root),
      listArgs: ['diff', '--name-status', '-z', `${mergeBase}..HEAD`],
      readContent: (path) => runGit(['show', `HEAD:${path}`], root),
    };
  }
  if (options.staged) {
    return {
      label: 'staged changes',
      diff: await runGit(['diff', '--cached'], root),
      listArgs: ['diff', '--cached', '--name-status', '-z'],
      // The index blob, not the working tree: --staged reviews what would be
      // committed, which is not necessarily what is on disk.
      readContent: (path) => runGit(['show', `:${path}`], root),
    };
  }
  return {
    label: 'uncommitted changes',
    diff: await runGit(['diff', 'HEAD'], root),
    listArgs: ['diff', 'HEAD', '--name-status', '-z'],
    // Root-relative, like every path `git diff` emits — see repositoryRoot.
    readContent: (path) => readFileSync(join(root, path), 'utf8'),
    includeUntracked: true,
  };
}

/**
 * The review target. Never silently empty — a clean tree says so and names the
 * overrides rather than reviewing something the user did not ask for.
 *
 * Two file lists, and the distinction is load-bearing. `files` is the request's
 * *only* copy of that code: no diff carries an untracked file's current content,
 * and `--file` produces no diff at all, so dropping one would review nothing while
 * reporting a clean pass. `changed` is the whole content of tracked files the diff
 * already covers, so it can be dropped to fit the window and still leave the model the
 * hunks. Only `changed` is ever dropped.
 */
export async function collectTarget(options, cwd = process.cwd()) {
  if (options.file?.length) {
    const files = readFileBlocks(options.file);
    return { label: `${options.file.length} file(s)`, diff: '', files, changed: [], unreadable: [] };
  }

  // Everything below is resolved against the repository root, so a review run
  // from a subdirectory sees the same change as one run from the top.
  const root = await repositoryRoot(cwd);
  const selected = await selectDiff(options, root);
  const { label, diff, includeUntracked } = selected;
  const untracked = includeUntracked ? await untrackedBlocks(root) : { blocks: [], unreadable: [] };
  const files = untracked.blocks;

  if (!diff.trim() && files.length === 0) {
    throw new UserError(`Nothing to review: ${label} is empty.`, { hint: OVERRIDES });
  }

  // An index-only removal still on disk, unless ignored, is both untracked and
  // deleted in the diff. `changedPaths` drops the deletion, so it arrives once as a
  // block, and its hunk stays because that is HEAD's copy, not the disk's. Keyed by
  // path so a file cannot arrive twice if either list grows.
  const pinned = new Set(files.map((file) => file.path));
  const nameStatus = await runGit(selected.listArgs, root);
  const listed = options['diff-only'] ? [] : changedPaths(nameStatus);
  const tracked = await blocksFor(listed, selected.readContent);

  return {
    label,
    diff,
    files,
    changed: tracked.blocks.filter((block) => !pinned.has(block.path)),
    // Every listed path is a plain deletion, so no path has a body at its tip to
    // withhold. An empty list proves nothing: a clean merge lists no paths, and a combined `DD` entry
    // sits in a merge whose other changes the list leaves out.
    deletionsOnly: /^(?:D\0[^\0]*\0)+$/.test(nameStatus),
    // A body sent as this file's content, for a path the diff says is gone.
    pinnedRemoved: removedPaths(nameStatus).some((path) => pinned.has(path)),
    // Listed as part of this change but with no body to send. Carried out so
    // the request can stop claiming to hold what it does not.
    unreadable: [...untracked.unreadable, ...tracked.unreadable],
  };
}
