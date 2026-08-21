// `spawnWorker`'s log-file open used to be `openSync(logPathFor(seq), 'a', 0o600)`
// — no `O_NOFOLLOW`. The path is predictable (`logs/<seq>.log`), so a symlink
// planted there ahead of the worker would be followed and appended to.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';

import { stateDir } from './job-helpers.mjs';
import { logPathFor, logsPath } from '../scripts/lib/job-store.mjs';
import { spawnWorker } from '../scripts/lib/job-spawn.mjs';

// Not gated on NEEDS_SQLITE: spawnWorker's log-file open happens before any
// database is touched, so this test's exercised path has no SQLite
// dependency — skipping it on a runtime without node:sqlite would lose
// O_NOFOLLOW regression coverage there for no reason.
test('a symlink at the predictable log path is refused, not followed and appended to', async () => {
  const state = stateDir();
  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = state;
  try {
    mkdirSync(logsPath(), { recursive: true });
    const target = `${state}/some-other-file.txt`;
    writeFileSync(target, 'untouched\n');
    symlinkSync(target, logPathFor(999));

    await assert.rejects(
      () => spawnWorker(999),
      (error) => {
        assert.equal(error.code, 'ELOOP', `expected O_NOFOLLOW to refuse the symlink, got: ${error.message}`);
        return true;
      },
    );

    assert.equal(readFileSync(target, 'utf8'), 'untouched\n', 'the symlink target must never have been opened, let alone appended to');
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }
});
