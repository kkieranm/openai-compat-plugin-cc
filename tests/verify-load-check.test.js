// The verify skill's proof that a slash command ran from the checkout, not from
// a session that reached the companion some other way. The fixtures are real
// `claude -p "/oai:setup" --output-format stream-json --verbose` streams, trimmed
// to the init and result events (plus the absent run's improvised tool calls),
// and the same sessions' on-disk transcripts trimmed to their first two user
// messages; paths are written as /CHECKOUT and /HOME and session ids replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const CHECKER = fileURLToPath(new URL('../.claude/skills/verify/check-load.mjs', import.meta.url));
const PROJECTS = fileURLToPath(new URL('./verify-load-fixtures/projects', import.meta.url));
const LOADED_SESSION = '00000000-0000-4000-8000-00000000000a';
const ABSENT_SESSION = '00000000-0000-4000-8000-00000000000b';
const fixture = (name) => readFileSync(new URL(`./verify-load-fixtures/${name}.jsonl`, import.meta.url), 'utf8');
const args = (command, checkout = '/CHECKOUT') => [command, '--checkout', checkout, '--projects-dir', PROJECTS];

function check(transcript, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHECKER, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(transcript);
  });
}

test('a run where the checkout plugin loaded passes and prints the run text', async () => {
  const result = await check(fixture('setup-loaded'), args('oai:setup'));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^LOADED: oai:setup from oai@inline/);
  assert.match(result.stdout, /lmstudio \(default\) - http:\/\/localhost:1234\/v1/, 'and the report itself');
});

test('a run without the plugin fails, though its final text looks like a report', async () => {
  // The session ran the companion itself; only the init event shows the difference.
  const result = await check(fixture('setup-absent'), args('oai:setup'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /NOT LOADED: the oai plugin did not load; oai:setup is not a registered slash command; the prompt was not dispatched as \/oai:setup/);
  assert.equal(result.stdout, '');
});

test('the plugin loaded from somewhere other than this checkout fails', async () => {
  const result = await check(fixture('setup-loaded'), args('oai:setup', '/ELSEWHERE'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not oai@inline at \/ELSEWHERE\/plugins\/oai/);
});

test('an installed copy instead of the inline one fails', async () => {
  const installed = fixture('setup-loaded').replace('"source": "oai@inline"', '"source": "oai@openai-compat"');
  assert.notEqual(installed, fixture('setup-loaded'), 'fixture carries the inline source');
  const result = await check(installed, args('oai:setup'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /loaded from oai@openai-compat/);
});

test('a command the plugin does not register fails', async () => {
  const result = await check(fixture('setup-loaded'), args('oai:nonexistent'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /oai:nonexistent is not a registered slash command/);
});

test('a registered command the prompt was not dispatched to fails, whatever the run then did', async () => {
  // The loaded session's init with the absent session's transcript: the plugin
  // was there, but the prompt went to the model as text and it ran the companion.
  const rerouted = fixture('setup-loaded').replace(LOADED_SESSION, ABSENT_SESSION);
  assert.notEqual(rerouted, fixture('setup-loaded'), 'fixture names its session');
  const result = await check(rerouted, args('oai:setup'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /NOT LOADED: the prompt was not dispatched as \/oai:setup$/m);
});

test('a resumed session is judged by its latest prompt, not an earlier dispatch', async () => {
  // A session first started with /oai:setup and later resumed with an ordinary
  // prompt keeps its id; the earlier marker must not certify the later run.
  const dir = tempDir('oai-verify-resumed-');
  mkdirSync(join(dir, 'p'));
  const earlier = readFileSync(join(PROJECTS, '-CHECKOUT', `${LOADED_SESSION}.jsonl`), 'utf8');
  const later = JSON.stringify({ type: 'user', sessionId: LOADED_SESSION, promptId: 'later', message: { role: 'user', content: 'what is in this repo?' } });
  writeFileSync(join(dir, 'p', `${LOADED_SESSION}.jsonl`), `${earlier}${later}\n`);
  const result = await check(fixture('setup-loaded'), ['oai:setup', '--checkout', '/CHECKOUT', '--projects-dir', dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /the prompt was not dispatched as \/oai:setup/);
});

test('a resumed prompt without a prompt id does not inherit an earlier dispatch', async () => {
  const dir = tempDir('oai-verify-noid-');
  mkdirSync(join(dir, 'p'));
  const earlier = readFileSync(join(PROJECTS, '-CHECKOUT', `${LOADED_SESSION}.jsonl`), 'utf8');
  const later = JSON.stringify({ type: 'user', sessionId: LOADED_SESSION, message: { role: 'user', content: 'what is in this repo?' } });
  writeFileSync(join(dir, 'p', `${LOADED_SESSION}.jsonl`), `${earlier}${later}\n`);
  const result = await check(fixture('setup-loaded'), ['oai:setup', '--checkout', '/CHECKOUT', '--projects-dir', dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /the prompt was not dispatched as \/oai:setup/);
});

test('a prompt that only quotes the command envelope is not a dispatch', async () => {
  const dir = tempDir('oai-verify-quoted-');
  mkdirSync(join(dir, 'p'));
  const quoted = 'Explain this literal tag: <command-message>oai:setup</command-message>\n<command-name>/oai:setup</command-name>';
  const lines = [
    { type: 'user', sessionId: LOADED_SESSION, promptId: 'q', message: { role: 'user', content: quoted } },
    { type: 'user', sessionId: LOADED_SESSION, promptId: 'q', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'x' }] } },
  ];
  writeFileSync(join(dir, 'p', `${LOADED_SESSION}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  const result = await check(fixture('setup-loaded'), ['oai:setup', '--checkout', '/CHECKOUT', '--projects-dir', dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /the prompt was not dispatched as \/oai:setup/);
});

test('an envelope with no command expansion after it is not a dispatch', async () => {
  const dir = tempDir('oai-verify-noexpansion-');
  mkdirSync(join(dir, 'p'));
  const envelopeOnly = readFileSync(join(PROJECTS, '-CHECKOUT', `${LOADED_SESSION}.jsonl`), 'utf8').split('\n')[0];
  writeFileSync(join(dir, 'p', `${LOADED_SESSION}.jsonl`), `${envelopeOnly}\n`);
  const result = await check(fixture('setup-loaded'), ['oai:setup', '--checkout', '/CHECKOUT', '--projects-dir', dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /the prompt was not dispatched as \/oai:setup/);
});

test('a session whose transcript cannot be found fails', async () => {
  const unknown = fixture('setup-loaded').replace(LOADED_SESSION, '00000000-0000-4000-8000-0000000000ff');
  const result = await check(unknown, args('oai:setup'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no session transcript for 00000000-0000-4000-8000-0000000000ff/);
});

test('plain text instead of a stream-json transcript fails', async () => {
  const result = await check('Config: ~/.config/oai-plugin/providers.json\n', args('oai:setup'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no init event/);
});

test('the verify skill pipes both slash-command steps through the checker', () => {
  // Without this a later edit to the skill silently restores output-only checking.
  const skill = readFileSync(new URL('../.claude/skills/verify/SKILL.md', import.meta.url), 'utf8');
  for (const command of ['oai:setup', 'oai:task']) {
    const pattern = new RegExp(`-p "/${command}[^"]*" --output-format stream-json --verbose \\\\?\\s*(?:< /dev/null\\s*)?\\|\\s*node \\.claude/skills/verify/check-load\\.mjs ${command}\\b`);
    assert.match(skill, pattern, command);
  }
});
