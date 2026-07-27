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

async function assertRepository(cwd) {
  const { status } = await git(['rev-parse', '--git-dir'], cwd);
  if (status !== 0) {
    throw new UserError(`Not a git repository: ${cwd}`, {
      hint: 'Run this from inside a repository, or pass --file <path> to review whole files instead.',
    });
  }
}

/**
 * Untracked files, as whole-file blocks. Without these the default target would
 * miss every file a feature adds — which is most of what a new feature is.
 */
async function untrackedBlocks(cwd) {
  const listed = await runGit(['ls-files', '--others', '--exclude-standard'], cwd);
  const paths = listed.split('\n').filter(Boolean);
  const blocks = [];

  for (const path of paths) {
    let content;
    try {
      content = readFileSync(join(cwd, path), 'utf8');
    } catch {
      continue; // Vanished or unreadable between listing and now.
    }
    // A binary blob would be noise the model cannot review, and would eat the
    // window the real files need.
    if (content.includes(NUL)) continue;
    blocks.push({ path, content });
  }
  return blocks;
}

const OVERRIDES = 'Use --staged, --base <ref>, --commit <ref>, or --file <path> to choose what to review.';

async function selectDiff(options, cwd) {
  if (options.commit) {
    return { label: `commit ${options.commit}`, diff: await runGit(['show', options.commit], cwd) };
  }
  if (options.base) {
    const mergeBase = (await runGit(['merge-base', options.base, 'HEAD'], cwd)).trim();
    return { label: `branch vs ${options.base}`, diff: await runGit(['diff', `${mergeBase}..HEAD`], cwd) };
  }
  if (options.staged) {
    return { label: 'staged changes', diff: await runGit(['diff', '--cached'], cwd) };
  }
  return { label: 'uncommitted changes', diff: await runGit(['diff', 'HEAD'], cwd), includeUntracked: true };
}

/**
 * The review target: a diff, whole files, or both. Never silently empty — a
 * clean tree says so and names the overrides rather than reviewing something
 * the user did not ask for.
 */
export async function collectTarget(options, cwd = process.cwd()) {
  if (options.file?.length) {
    return { label: `${options.file.length} file(s)`, diff: '', files: readFileBlocks(options.file) };
  }

  await assertRepository(cwd);
  const { label, diff, includeUntracked } = await selectDiff(options, cwd);
  const files = includeUntracked ? await untrackedBlocks(cwd) : [];

  if (!diff.trim() && files.length === 0) {
    throw new UserError(`Nothing to review: ${label} is empty.`, { hint: OVERRIDES });
  }
  return { label, diff, files };
}
