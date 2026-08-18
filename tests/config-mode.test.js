// `providers.json` can hold an inline `apiKey` (`apiKeyEnv` is preferred, but
// `apiKey` is a supported fallback per `resolveApiKey`), so its file mode is
// what that fallback's confidentiality rests on. `writeFileSync`'s `mode`
// argument protects a freshly-created file, but nothing repaired a
// pre-existing one left loose by an older build or widened by anything else
// — the same shape of gap OAI-65(b) closed for `job-store.mjs`'s directories
// (OAI-72(a)). This file pins the repair that closes it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UserError } from '../scripts/lib/errors.mjs';
import { DEFAULT_CONFIG, configPath, loadConfig } from '../scripts/lib/config.mjs';

function modeOf(path) {
  return statSync(path).mode & 0o777;
}

/** Load the config with a scratch OAI_PLUGIN_CONFIG, restoring the env var after. */
function tryLoad(path) {
  const previous = process.env.OAI_PLUGIN_CONFIG;
  process.env.OAI_PLUGIN_CONFIG = path;
  try {
    return loadConfig();
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previous;
  }
}

test('a fresh config is created at 0600 immediately, not repaired later', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-config-'));
  const path = join(dir, 'nested', 'providers.json');

  tryLoad(path);

  assert.equal(modeOf(path), 0o600);
});

test('a pre-existing config looser than 0600 is repaired on load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-config-'));
  const path = join(dir, 'providers.json');
  // `chmodSync` after the write, not `writeFileSync`'s own `mode` option —
  // that option is masked by the process umask like any real `open(2)`
  // call, so a stricter umask could land the fixture below 0o644 and make
  // this test spuriously fail on a machine, unrelated to the code under test.
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  chmodSync(path, 0o644);
  assert.equal(modeOf(path), 0o644, 'the fixture must actually start loose');

  tryLoad(path);

  assert.equal(modeOf(path), 0o600);
});

// The file's mode is a property of the FILE, not of whether its content
// currently parses — a loose config that is also invalid (bad JSON, or valid
// JSON in the wrong shape) must still be repaired the moment it's read,
// rather than staying loose until someone happens to fix its content too.
test('a loose config that is invalid JSON is still repaired before the parse error is thrown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-config-'));
  const path = join(dir, 'providers.json');
  writeFileSync(path, 'not valid json');
  chmodSync(path, 0o644);
  assert.equal(modeOf(path), 0o644, 'the fixture must actually start loose');

  assert.throws(() => tryLoad(path), (error) => error instanceof UserError);

  assert.equal(modeOf(path), 0o600);
});

test('a loose config with a valid-JSON but wrong-shaped body is still repaired before validation refuses it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-config-'));
  const path = join(dir, 'providers.json');
  writeFileSync(path, '{"no providers key at all": true}');
  chmodSync(path, 0o644);
  assert.equal(modeOf(path), 0o644, 'the fixture must actually start loose');

  assert.throws(() => tryLoad(path), (error) => error instanceof UserError);

  assert.equal(modeOf(path), 0o600);
});

// V8's own SyntaxError for invalid JSON routinely quotes a slice of the
// surrounding raw text, not just a position — but only a SHORT window right
// after the error position, not the whole value. `JSON.parse('{"apiKey":
// sk-LEAKEDSECRET}')` throws a message containing only "sk-LEAKEDS", not the
// rest — so the marker below is deliberately short (well within that window)
// rather than a long, easily-truncated-past string, or this test would pass
// vacuously against a broken fix the same way an earlier draft of it did
// (confirmed empirically: `doesNotMatch(..., /LEAKED-FRAGMENT/)` against a
// 20-char marker never actually matched the truncated leak either way).
test('a JSON syntax error never echoes a fragment of the file\'s own content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-config-'));
  const path = join(dir, 'providers.json');
  writeFileSync(path, '{"apiKey": sk-LEAKEDSECRET9999}');

  assert.throws(
    () => tryLoad(path),
    (error) => {
      assert.ok(error instanceof UserError);
      assert.doesNotMatch(error.message, /LEAKED/);
      // The fix makes this message fully static — assert the exact text too,
      // not just the marker's absence. This discriminates against a reverted
      // fix regardless of what any particular V8 version happens to quote,
      // rather than depending on the truncation-window behavior above.
      assert.equal(error.message, `Config at ${path} is not valid JSON.`);
      return true;
    },
  );
});

// NOT a wx/EEXIST test — a pre-existing file is read on the FIRST attempt
// (readFileSync succeeds, so the ENOENT/create branch is never entered at
// all), so this cannot and does not drive the create-path's 'wx' write or its
// EEXIST-recurse; that is exercised for real by the dangling-symlink test
// below. What this pins: a file that already exists at the target path — the
// ordinary case, not a race — is read and repaired via the normal read path,
// `created: false`, its pre-existing content preserved rather than clobbered
// with defaults.
test('a pre-existing config at the target path is read and repaired, not treated as a fresh creation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-config-'));
  const path = join(dir, 'providers.json');
  const winnerConfig = { defaultProvider: 'winner', providers: { winner: { baseUrl: 'http://winner.test/v1' } } };
  writeFileSync(path, JSON.stringify(winnerConfig));
  chmodSync(path, 0o644);

  // The source's create branch is only reached via a fresh ENOENT read, which
  // a pre-existing file never triggers — so this asserts the code TAKES the
  // ordinary read path, not the create path, for a file that's already there.
  // The create-path fix itself is pinned structurally below.
  const { config, created } = tryLoad(path);
  assert.equal(created, false);
  assert.deepEqual(config, winnerConfig);
  assert.equal(modeOf(path), 0o600);
});

/**
 * Whitespace-collapsed source text for the structural pins below — matched on
 * TOKEN adjacency, not exact indentation/line-wrapping, so a harmless
 * reformat (e.g. wrapping a long condition across two lines) can't fail a
 * pin that is correctly guarding the same code shape. Comments are stripped
 * first (an occurrence of the exact pattern inside PROSE would otherwise
 * satisfy a match identically to the real code).
 */
function normalizedLoadConfigSource() {
  const source = readFileSync(fileURLToPath(new URL('../scripts/lib/config.mjs', import.meta.url)), 'utf8');
  const fn = source.slice(source.indexOf('export function loadConfig('), source.indexOf('\nfunction validateConfig('));
  return fn.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
}

// Same untestable-by-behavior class as job-store-modes.test.js's openOnce
// pins: the actual race (a concurrent creator between readFileSync's ENOENT
// and this writeFileSync) needs two processes or a syscall interleaving no
// deterministic in-process test can drive. Pinned structurally instead —
// anchored on ONE contiguous pattern spanning condition+action, not on the
// textual ORDER of three separate substrings: an order-only check (does
// "EEXIST" appear before "return loadConfigAttempt()" anywhere in the
// function) would pass equally against `if (EEXIST) throw raceError; return
// loadConfigAttempt(...)` — the exact inverted mutant, which recurses on
// every OTHER write failure (EACCES, ENOSPC, EROFS — uncontrolled retries)
// and throws raw on the one case meant to recurse. Confirmed by mutation:
// with the branches swapped, an order-only version of this test still passed.
// Recursion is bounded (MAX_CREATE_RACE_ATTEMPTS in config.mjs) — a dangling
// symlink at the config path makes readFileSync see ENOENT (the target is
// missing) and this writeFileSync see EEXIST (the link itself isn't) on
// every attempt, which an unbounded recurse would spin on forever.
test('the create-path write uses flag "wx" and recurses (bounded) into loadConfigAttempt() on EEXIST', () => {
  const body = normalizedLoadConfigSource();

  assert.match(body, /flag:\s*'wx'/, 'the create-path write must use an exclusive-create flag, not the default truncating one');
  assert.match(
    body,
    /if \(raceError\.code === 'EEXIST'\) return loadConfigAttempt\(attempt \+ 1\); throw raceError;/,
    'EEXIST specifically must recurse, and every OTHER race-write failure must still throw raw — not the other way around',
  );
  assert.match(
    body,
    /if \(attempt >= MAX_CREATE_RACE_ATTEMPTS\) \{ throw new UserError/,
    'exhausting the bounded retries (a dangling symlink, say) must throw a clear error, not recurse forever or fall through silently',
  );
});

// Same untestable-by-behavior class: reproducing a real EPERM/EACCES (or
// EROFS/EIO) from chmodSync needs a file whose permissions genuinely can't
// be changed, which an unprivileged test process cannot reliably construct
// (and — see job-store-modes.test.js — ESM's named `fs` imports can't be
// monkey-patched from a test either). Pinned structurally, anchored the same
// way as the wx test above: on the throw being textually INSIDE the
// "not a mode-less filesystem" if-body, not merely appearing somewhere after
// the condition. An order-only check (does the throw text appear after the
// condition text) would equally pass an inverted mutant that swallows every
// real failure via an empty if-body and throws in an else. The polarity here
// is deliberately inverted from a first draft of this fix: only ENOSYS
// ("chmod not implemented") and EINVAL (the mode argument itself rejected as
// meaningless) are what a genuinely mode-less filesystem returns — treating
// every OTHER code as "no modes here" swallowed EROFS/EIO too, silently
// leaving a loose file on a read-only mount.
test('the read-path chmod repair fails loud on anything but ENOSYS/EINVAL', () => {
  const body = normalizedLoadConfigSource();

  assert.match(
    body,
    /chmodSync\(path, 0o600\); \} catch \(error\) \{ if \(error\.code !== 'ENOSYS' && error\.code !== 'EINVAL'\) \{ throw new UserError\(`Could not set the required 0600/,
    'the repair chmod\'s catch must throw a UserError from INSIDE the "not mode-less" if-body specifically, not merely after the condition somewhere in the function',
  );
});

// The real-world trigger for the bounded-retry fix: a dangling symlink at the
// config path makes readFileSync see ENOENT (the target is missing) and the
// wx write see EEXIST (the link itself isn't) on EVERY attempt — before
// MAX_CREATE_RACE_ATTEMPTS, this recursed without limit into a raw
// RangeError: Maximum call stack size exceeded. Unlike the wx/EEXIST pin
// above, this really does drive the retry-and-give-up path end to end, not
// just one iteration of it.
test('a dangling symlink at the config path throws a clear error instead of recursing forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-config-'));
  const path = join(dir, 'providers.json');
  symlinkSync(join(dir, 'nowhere'), path);

  assert.throws(
    () => tryLoad(path),
    (error) => {
      assert.ok(error instanceof UserError);
      assert.match(error.message, /cannot be read/);
      return true;
    },
  );
});

test('configPath() honours OAI_PLUGIN_CONFIG, which the fixtures above depend on', () => {
  const previous = process.env.OAI_PLUGIN_CONFIG;
  process.env.OAI_PLUGIN_CONFIG = '/tmp/example-providers.json';
  try {
    assert.equal(configPath(), '/tmp/example-providers.json');
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previous;
  }
});
