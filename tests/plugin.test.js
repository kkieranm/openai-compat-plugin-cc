// The command surface is markdown, so nothing but a test notices when it rots:
// a missing allowed-tools entry silently breaks the Bash call at runtime, and a
// renamed script leaves a command pointing at nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { TERMINAL_STATES } from '../plugins/oai/scripts/lib/job-record.mjs';
import { renderDetail } from '../plugins/oai/scripts/lib/job-render.mjs';
import { viewOf } from '../plugins/oai/scripts/lib/job-view.mjs';
import { ABANDON_SPEC } from '../plugins/oai/scripts/lib/cmd-abandon.mjs';
import { CANCEL_SPEC } from '../plugins/oai/scripts/lib/cmd-cancel.mjs';
import { RESULT_SPEC } from '../plugins/oai/scripts/lib/cmd-result.mjs';
import { REVIEW_SPEC } from '../plugins/oai/scripts/lib/cmd-review.mjs';
import { SETUP_SPEC } from '../plugins/oai/scripts/lib/cmd-setup.mjs';
import { STATUS_SPEC } from '../plugins/oai/scripts/lib/cmd-status.mjs';
import { TASK_SPEC } from '../plugins/oai/scripts/lib/cmd-task.mjs';
import { fileURLToPath } from 'node:url';
import { git, tempDir } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN_ROOT = join(ROOT, 'plugins/oai');
const COMMANDS_DIR = join(PLUGIN_ROOT, 'commands');
const AGENTS_DIR = join(PLUGIN_ROOT, 'agents');

// `plugins/oai/agents/oai-delegate.md` drives the job lifecycle from a shell recipe written
// in prose, so two things this repo owns are load-bearing *for a markdown file*:
// the words that mean "finished", and the shape of the line the recipe reads
// them off. Both are pinned below against the code that produces them.
const DELEGATE = join(AGENTS_DIR, 'oai-delegate.md');

// The parser's flag list is the definition; the markdown is the only
// description a user ever sees. Hand-keeping them in agreement is exactly the
// pairing that drifts silently, so it is checked instead.
const SPECS = {
  'abandon.md': ABANDON_SPEC,
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
  const plugin = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));

  assert.equal(plugin.name, 'oai');
  const entry = marketplace.plugins.find((candidate) => candidate.name === plugin.name);
  assert.ok(entry, 'marketplace must list the plugin');
  assert.equal(entry.version, plugin.version, 'marketplace and plugin versions must not drift');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, plugin.version, 'package.json and plugin versions must not drift');
  // An install copies whatever directory `source` names; at the repo root that
  // is tests/ and bench/ too.
  assert.equal(resolve(ROOT, entry.source), resolve(PLUGIN_ROOT), 'marketplace source must name plugins/oai, not the repo root');
});

// Tracked files only: a git-hosted marketplace installs what git tracks.
const PAYLOAD_SHAPES = [
  /^\.claude-plugin\/plugin\.json$/,
  /^LICENSE$/,
  /^commands\/[^/]+\.md$/,
  /^agents\/[^/]+\.md$/,
  /^scripts\/(?!.*\.test\.mjs$).+\.mjs$/,
];
test('the plugin directory ships only the runtime payload', async () => {
  const files = (await git(['ls-files', '-z', '--', '.'], PLUGIN_ROOT)).split('\0').filter(Boolean);
  assert.ok(files.includes('scripts/oai-companion.mjs'), 'git ls-files listed no payload — is this a git checkout?');
  const strays = files.filter((file) => !PAYLOAD_SHAPES.some((shape) => shape.test(file)));
  assert.deepEqual(strays, [], 'only runtime files belong under plugins/oai; tests and fixtures stay outside it');
});

// An import that leaves plugins/oai still resolves in the repo, where tests/ and
// bench/ exist, so every other test stays green while the installed copy —
// plugins/oai alone — fails to load. Static imports are checked by Node itself:
// the tracked payload is copied into an empty directory, at the same depth it
// sits in the repo, and every module is imported there. Anything resolved only
// at run time is invisible to that load, so every `import(`, `import.meta`,
// `require(` or `createRequire` in the payload's modules is refused unless it is
// part of an exact expression listed for that file in RUNTIME_RESOLUTIONS,
// reviewed to stay inside the plugin. The guarantee covers those expressions,
// not what later code composes from their results (a `dirname` or `join` of an
// allowed path), nor paths built from `process.cwd()`, `process.argv` or a bare
// relative path handed to `fs`. The scan skips lines that start with `//` and
// block comments that open a line (inside a string too); a comment inside a
// token (`import/**/.meta`) hides it, and a comment trailing code is still
// scanned.
const RUNTIME_RESOLUTIONS = [
  { file: 'scripts/lib/job-spawn.mjs', expression: "fileURLToPath(new URL('../oai-companion.mjs', import.meta.url))" },
  { file: 'scripts/lib/job-store.mjs', expression: "import('node:sqlite')" },
];
const RUNTIME_RESOLUTION = /\bimport\s*\(|\bimport\s*\.\s*meta\b|\brequire\s*\(|\bcreateRequire\b/g;
const LOAD_EVERY_MODULE = `
const results = [];
for (const file of JSON.parse(process.argv[1])) {
  try { await import('./' + file); results.push({ file }); }
  catch (error) { results.push({ file, error: String(error?.message ?? error) }); }
}
process.stdout.write(JSON.stringify(results));
// The entry module runs its CLI on import and, given no command, sets exitCode 1.
process.exitCode = 0;
`;
test('the plugin loads from its installed layout, with nothing outside it', async () => {
  const tracked = (await git(['ls-files', '-z', '--', '.'], PLUGIN_ROOT)).split('\0').filter(Boolean);
  const modules = tracked.filter((file) => file.startsWith('scripts/') && file.endsWith('.mjs'));
  const copy = join(tempDir('oai-installed-'), 'plugins', 'oai');
  for (const file of tracked) {
    mkdirSync(dirname(join(copy, file)), { recursive: true });
    copyFileSync(join(PLUGIN_ROOT, file), join(copy, file));
  }
  // SIGKILL because a module could trap SIGTERM; stdin is closed so a read at
  // import returns rather than waiting out the timeout.
  const child = promisify(execFile)(process.execPath, ['--input-type=module', '-e', LOAD_EVERY_MODULE, JSON.stringify(modules)], { cwd: copy, timeout: 20_000, killSignal: 'SIGKILL' });
  child.child.stdin.end();
  const stdout = await child.then(
    (result) => result.stdout,
    (error) => {
      if (!error.killed) throw error;
      assert.fail(error.stdout
        ? 'every module was attempted, but something keeps the process alive past 20s'
        : 'the payload did not finish importing within 20s');
    },
  );
  const results = JSON.parse(stdout);
  assert.deepEqual(results.map((result) => result.file), modules, 'every tracked module must be attempted exactly once');
  assert.deepEqual(results.filter((result) => result.error).map((result) => `${result.file}: ${result.error}`), [], 'fails to load from the installed layout');

  const problems = [];
  const unused = new Set(RUNTIME_RESOLUTIONS);
  for (const file of modules) {
    const allowed = RUNTIME_RESOLUTIONS.filter((entry) => entry.file === file);
    let text = readFileSync(join(copy, file), 'utf8')
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, (comment) => comment.replace(/[^\n]/g, ''))
      .split('\n')
      .map((line) => (/^\s*\/\//.test(line) ? '' : line))
      .join('\n');
    for (const entry of allowed) {
      if (text.includes(entry.expression)) unused.delete(entry);
      text = text.split(entry.expression).join('');
    }
    for (const match of text.matchAll(RUNTIME_RESOLUTION)) {
      const line = text.slice(0, match.index).split('\n').length;
      problems.push(`${file}:${line}: unreviewed run-time resolution "${match[0].replace(/\s+/g, ' ')}"`);
    }
  }
  for (const entry of unused) problems.push(`${entry.file}: allowed expression no longer appears — update RUNTIME_RESOLUTIONS: ${entry.expression}`);
  assert.deepEqual(problems, [], 'run-time resolution must be one of the reviewed RUNTIME_RESOLUTIONS expressions');
});

test('the shipped LICENSE is the repository LICENSE', () => {
  assert.ok(
    readFileSync(join(PLUGIN_ROOT, 'LICENSE')).equals(readFileSync(join(ROOT, 'LICENSE'))),
    'plugins/oai/LICENSE must stay byte-identical to the root LICENSE',
  );
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
      assert.ok(existsSync(join(PLUGIN_ROOT, reference)), `${file}: references missing script ${reference}`);
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
      assert.ok(existsSync(join(PLUGIN_ROOT, reference)), `${file}: references missing script ${reference}`);
    }
  }
});
