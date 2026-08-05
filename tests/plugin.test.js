// The command surface is markdown, so nothing but a test notices when it rots:
// a missing allowed-tools entry silently breaks the Bash call at runtime, and a
// renamed script leaves a command pointing at nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { TERMINAL_STATES } from '../scripts/lib/job-record.mjs';
import { renderDetail } from '../scripts/lib/job-render.mjs';
import { viewOf } from '../scripts/lib/job-view.mjs';
import { CANCEL_SPEC } from '../scripts/lib/cmd-cancel.mjs';
import { RESULT_SPEC } from '../scripts/lib/cmd-result.mjs';
import { REVIEW_SPEC } from '../scripts/lib/cmd-review.mjs';
import { SETUP_SPEC } from '../scripts/lib/cmd-setup.mjs';
import { STATUS_SPEC } from '../scripts/lib/cmd-status.mjs';
import { TASK_SPEC } from '../scripts/lib/cmd-task.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const COMMANDS_DIR = join(ROOT, 'commands');
const AGENTS_DIR = join(ROOT, 'agents');

// `agents/oai-delegate.md` drives the job lifecycle from a shell recipe written
// in prose, so two things this repo owns are load-bearing *for a markdown file*:
// the words that mean "finished", and the shape of the line the recipe reads
// them off. Both are pinned below against the code that produces them.
const DELEGATE = join(AGENTS_DIR, 'oai-delegate.md');

// The parser's flag list is the definition; the markdown is the only
// description a user ever sees. Hand-keeping them in agreement is exactly the
// pairing that drifts silently, so it is checked instead — this guard was
// written after finding /oai:task had accepted --system with no mention of it
// anywhere in commands/task.md.
const SPECS = {
  'cancel.md': CANCEL_SPEC,
  'result.md': RESULT_SPEC,
  'review.md': REVIEW_SPEC,
  'setup.md': SETUP_SPEC,
  'status.md': STATUS_SPEC,
  'task.md': TASK_SPEC,
};

function commandFiles() {
  return readdirSync(COMMANDS_DIR).filter((name) => name.endsWith('.md'));
}

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'command file must open with a YAML frontmatter block');
  return Object.fromEntries(
    match[1]
      .split('\n')
      .filter((line) => /^[a-z-]+:/.test(line))
      .map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
  );
}

test('plugin and marketplace manifests parse and agree', () => {
  const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));

  assert.equal(plugin.name, 'oai');
  const entry = marketplace.plugins.find((candidate) => candidate.name === plugin.name);
  assert.ok(entry, 'marketplace must list the plugin');
  assert.equal(entry.version, plugin.version, 'marketplace and plugin versions must not drift');
});

test('every command declares a description and can run the companion script', () => {
  const files = commandFiles();
  assert.ok(files.length > 0, 'expected at least one command');

  for (const file of files) {
    const source = readFileSync(join(COMMANDS_DIR, file), 'utf8');
    const meta = frontmatter(source);
    assert.ok(meta.description, `${file}: needs a description`);
    assert.ok(
      meta['allowed-tools']?.includes('Bash(node:*)'),
      `${file}: invokes node, so allowed-tools must include Bash(node:*)`,
    );
  }
});

test('every flag a command accepts is documented in its markdown', () => {
  // A new command with no spec listed here would escape the check entirely,
  // which is the same silent gap one directory up.
  assert.deepEqual(commandFiles().sort(), Object.keys(SPECS).sort(), 'every command file needs its spec listed in SPECS');

  const undocumented = [];
  for (const [file, spec] of Object.entries(SPECS)) {
    const source = readFileSync(join(COMMANDS_DIR, file), 'utf8');
    const flags = [...(spec.valueFlags ?? []), ...(spec.booleanFlags ?? []), ...(spec.repeatableFlags ?? [])];
    for (const flag of flags) {
      // Anchored on the right: `--base-url` in the prose must not be read as
      // documentation of `--base`, which is a different flag entirely.
      if (!new RegExp(`--${flag}(?![\\w-])`).test(source)) undocumented.push(`${file}: --${flag}`);
    }
  }
  assert.deepEqual(undocumented, [], 'a flag the parser accepts but no doc mentions');
});

function agentFiles() {
  return readdirSync(AGENTS_DIR).filter((name) => name.endsWith('.md'));
}

/** One child, fed on stdin, awaited — never the synchronous form. */
function run(command, args, input) {
  const child = promisify(execFile)(command, args);
  child.child.stdin.end(input);
  return child;
}

/**
 * One markdown bullet, whole, however many lines it wraps onto.
 *
 * Line-scoped extraction was the first attempt here and it silently dropped
 * `queue-timeout`, which wraps onto the bullet's second line. A guard that reads
 * half a list and passes is worse than no guard at all.
 */
function bulletStartingWith(source, prefix) {
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `expected a "${prefix}" bullet`);
  const rest = source.slice(start);
  const end = rest.search(/\n\s*\n|\n- /);
  return end === -1 ? rest : rest.slice(0, end);
}

/** A finished row, rendered the way `/oai:status <id>` renders one. */
function terminalView(state) {
  return viewOf({
    seq: 1,
    id: 'a1b2c3d4',
    state,
    workspace: ROOT,
    created_at: '2026-08-05T12:00:00.000Z',
    request: { messages: [{ role: 'user', content: 'summarise this' }] },
  });
}

test('every agent declares a name matching its filename, a description and its tools', () => {
  const files = agentFiles();
  assert.ok(files.length > 0, 'expected at least one agent');

  for (const file of files) {
    const meta = frontmatter(readFileSync(join(AGENTS_DIR, file), 'utf8'));
    assert.equal(meta.name, file.replace(/\.md$/, ''), `${file}: name must match the filename`);
    assert.ok(meta.description, `${file}: needs a description — it is the routing trigger`);
    assert.ok(meta.tools, `${file}: needs a tools list`);
  }
});

test('every script path an agent references exists', () => {
  for (const file of agentFiles()) {
    const source = readFileSync(join(AGENTS_DIR, file), 'utf8');
    const references = [...source.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?\.mjs)/g)].map((match) => match[1]);
    assert.ok(references.length > 0, `${file}: expected at least one companion script reference`);
    for (const reference of references) {
      assert.ok(existsSync(join(ROOT, reference)), `${file}: references missing script ${reference}`);
    }
  }
});

// Both sites, because the agent carries the terminal states TWICE: the prose
// bullet a reader learns them from, and the `case` pattern the recipe actually
// breaks its poll loop on. Pinning only the bullet would let a fifth state turn
// this test red, get "fixed" in the prose, and leave the executed pattern short
// — so the agent would poll a finished job until its deadline and report it as
// still running. Silent, and indistinguishable from a slow model.
test('the delegate agent names exactly the states this build treats as terminal', () => {
  const source = readFileSync(DELEGATE, 'utf8');
  const expected = [...TERMINAL_STATES].sort();

  const bullet = bulletStartingWith(source, '- Terminal states');
  const named = [...bullet.matchAll(/`([a-z-]+)`/g)].map((match) => match[1]);
  assert.deepEqual(named.sort(), expected, 'the prose bullet a reader learns the terminal states from');

  const pattern = source.match(/^\s*(completed\|[a-z|-]+)\)/m);
  assert.ok(pattern, 'the recipe must carry a case pattern breaking the poll loop on terminal states');
  assert.deepEqual(
    pattern[1].split('|').sort(),
    expected,
    'the case pattern the poll loop actually breaks on — the executed list, not the documented one',
  );
});

// Two assertions, because neither catches the other's fault: collapsing the
// separator to one space leaves `$3` still returning the state, and reordering
// the fields leaves the line's shape superficially intact. The second runs the
// real awk over the agent's own expression — the recipe the agent is told to
// run is the recipe under test, not a paraphrase of it.
test('the status line the delegate agent reads keeps its shape and its field order', async () => {
  const match = readFileSync(DELEGATE, 'utf8').match(/awk '([^']+)'/);
  assert.ok(match, 'the agent must carry the awk expression it reads job state with');
  const expression = match[1];

  for (const state of TERMINAL_STATES) {
    const rendered = renderDetail(terminalView(state));
    assert.equal(rendered.split('\n')[0], `job a1b2c3d4  ${state}`, 'the detail line the agent parses');
    // Async, never the *Sync form: `tests/structure.test.js` forbids a
    // synchronous spawn outright, because one deadlocks the in-process fake
    // server the rest of this suite runs against.
    const { stdout } = await run('awk', [expression], rendered);
    assert.equal(stdout.trim(), state, `awk '${expression}' must read "${state}" off the rendered detail`);
  }
});

test('every script path a command references exists', () => {
  for (const file of commandFiles()) {
    const source = readFileSync(join(COMMANDS_DIR, file), 'utf8');
    const references = [...source.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?\.mjs)/g)].map((match) => match[1]);
    assert.ok(references.length > 0, `${file}: expected at least one companion script reference`);
    for (const reference of references) {
      assert.ok(existsSync(join(ROOT, reference)), `${file}: references missing script ${reference}`);
    }
  }
});
