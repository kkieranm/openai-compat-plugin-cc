// `--repo` + `--include`, driven through the REAL CLI against a real
// second git repo — not the exported functions, because `git()` and `invoke()`
// are module-private and the defect this covers was both of them independently
// hardcoding this tool's own ROOT as `cwd`. A unit test against `optionsFrom`
// alone cannot see that; only spawning `main()` can.
//
// `--include` deliberately names a prefix the scratch commit does NOT touch,
// so it is enumerated as ineligible and `runSweep` never calls `execute` — no
// companion process, and no model, is ever invoked. What proves the wiring is
// enumeration alone: the walked commit's subject is one only the scratch repo
// has, which it could not be if `git()` were still rooted at this tool's own
// history — and `runSweep` records every enumerated commit, eligible or not,
// so an ineligible one still shows up to check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closedPort, writeConfig } from './helpers.mjs';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const CLI = join(ROOT, 'bench/review-sweep.mjs');
const SUBJECT = 'a commit only the scratch repo has, never this one';

async function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-repo-cli-'));
  const git = (args) => run('git', args, { cwd: dir });
  await git(['init', '--quiet']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'file.txt'), 'x\n');
  await git(['add', 'src/file.txt']);
  await git(['commit', '--quiet', '-m', SUBJECT]);
  return dir;
}

function readRecord(outDir) {
  const recordFile = readdirSync(outDir).find((name) => name.endsWith('.json'));
  return JSON.parse(readFileSync(join(outDir, recordFile), 'utf8'));
}

function readReport(outDir) {
  const reportFile = readdirSync(outDir).find((name) => name.endsWith('.md'));
  return readFileSync(join(outDir, reportFile), 'utf8');
}

test('--repo without --include refuses loudly rather than reviewing this repo instead', async () => {
  const target = await scratchRepo();
  await assert.rejects(
    run('node', [CLI, '--repo', target, '--minutes', '1'], { cwd: ROOT }),
    /--include must be given explicitly/,
  );
});

test('--repo + --include enumerates the TARGET repo\'s own history, not this tool\'s', async () => {
  const target = await scratchRepo();
  const outDir = mkdtempSync(join(tmpdir(), 'sweep-repo-out-'));
  await run('node', [CLI, '--repo', target, '--include', 'zzz-nomatch', '--minutes', '1', '--max-commits', '1', '--out-dir', outDir], { cwd: ROOT });
  const record = readRecord(outDir);
  const subjects = record.entries.map((entry) => entry.subject);
  assert.ok(subjects.includes(SUBJECT), `expected the scratch repo's own commit subject among ${JSON.stringify(subjects)}`);

  // The JSON record and rendered report must
  // name the repo they describe, or a foreign-repo artifact is unattributed
  // and indistinguishable from this tool's own history.
  assert.equal(record.repo, target);
  assert.match(readReport(outDir), new RegExp(`Repository.*${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

// The test above proves enumeration is rooted at the target repo, but every
// commit is deliberately INELIGIBLE, so `runSweep` never calls `execute` and
// `invoke()`'s own `cwd` wiring — the other of the two call sites that
// hardcoded ROOT — goes unexercised. This one makes the commit
// ELIGIBLE and lets the real companion process run, pointed at a closed local
// port so it fails fast without a network dependency. The two possible
// failures are distinguishable: wrong cwd resolves `git show <sha>` against
// THIS repo, where the scratch sha does not exist ("fatal: bad object");
// correct cwd resolves it, gets past commit resolution, and fails only on the
// unreachable model server ("connection refused").
//
// **Isolated from the ambient machine**: a throwaway
// `OAI_PLUGIN_CONFIG` — the same override `runCompanion` uses — stops this
// from reading, or first-run CREATING, the real `~/.config/oai-plugin/`; a
// `closedPort()` server-then-close, not a guessed always-closed port number,
// stops it depending on nothing else on the machine having bound port 1.
test('--repo + --include roots the COMPANION process too, not just enumeration', async () => {
  const target = await scratchRepo();
  const outDir = mkdtempSync(join(tmpdir(), 'sweep-repo-out-'));
  const { path: configPath } = writeConfig({ defaultProvider: 'test', providers: { test: { baseUrl: 'http://127.0.0.1:1/v1' } } });
  const port = await closedPort();
  await run('node', [
    CLI, '--repo', target, '--include', 'src', '--minutes', '1', '--max-commits', '1',
    '--max-attempts', '1', '--max-seconds', '5', '--base-url', `http://127.0.0.1:${port}`, '--out-dir', outDir,
  ], { cwd: ROOT, env: { ...process.env, OAI_PLUGIN_CONFIG: configPath } });
  const record = readRecord(outDir);
  assert.equal(record.entries.length, 1);
  const envelope = JSON.parse(record.entries[0].raw);
  assert.match(envelope.message, /connection refused|ECONNREFUSED/i, `expected a network failure proving the commit resolved in the target repo, got: ${envelope.message}`);
  assert.doesNotMatch(envelope.message, /bad object|unknown revision/i, 'a git-resolution failure means invoke() was still rooted at this tool, not the target repo');
});
