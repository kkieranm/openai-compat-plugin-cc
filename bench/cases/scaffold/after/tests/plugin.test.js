// The command surface is markdown, so nothing but a test notices when it rots:
// a missing allowed-tools entry silently breaks the Bash call at runtime, and a
// renamed script leaves a command pointing at nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const COMMANDS_DIR = join(ROOT, 'commands');

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
