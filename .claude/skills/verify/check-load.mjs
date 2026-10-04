#!/usr/bin/env node
// Prove a `claude -p "/oai:<command> ..."` run executed the checkout's slash
// command, not a session that reached the companion some other way.
//
//   claude --plugin-dir plugins/oai ... -p "/oai:setup" --output-format stream-json --verbose \
//     | node .claude/skills/verify/check-load.mjs oai:setup [--checkout <dir>] [--projects-dir <dir>]
//
// The command's own output cannot tell: a session without the plugin can run
// the companion script directly and print the same report. Two records can:
// the stream's init event lists the loaded plugins and their slash commands,
// and in the session's transcript on disk a prompt dispatched as that command
// is recorded as the command envelope (`<command-message>…<command-name>/oai:…`)
// followed at once by the command's expansion, marked `isMeta`; a session that
// did not recognise it records the bare text. The prompt checked is this run's
// — the last real prompt in the file, since a resumed session keeps its id — and
// it must be the envelope itself, not text that quotes one. Passes only when the `oai` plugin came
// from `oai@inline` at `<checkout>/plugins/oai`, registered the command, and the
// session transcript shows it dispatched; then prints the run's final text.
// Exits 1 otherwise, naming what was missing. `--checkout` defaults to the
// working directory; `--projects-dir` to the `projects` directory of
// `$CLAUDE_CONFIG_DIR` or `~/.claude`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const parse = (text) =>
  text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

function sessionTranscript(projectsDir, sessionId) {
  if (!existsSync(projectsDir)) return null;
  for (const dir of readdirSync(projectsDir)) {
    const file = join(projectsDir, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) return readFileSync(file, 'utf8');
  }
  return null;
}

const content = (entry) => entry?.message?.content;

// A prompt the user (or `claude -p`) sent: not a command expansion, not a tool
// result, not a subagent's turn.
const isPrompt = (entry) =>
  entry.type === 'user' &&
  !entry.isSidechain &&
  !entry.isMeta &&
  !(Array.isArray(content(entry)) && content(entry).some((block) => block.type === 'tool_result'));

const envelope = (command) =>
  new RegExp(`^<command-message>${command}</command-message>\\n<command-name>/${command}</command-name>(?:\\n<command-args>[\\s\\S]*</command-args>)?$`);

function checkLoad(transcript, { command, checkout, projectsDir }) {
  const events = parse(transcript);
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init');
  const result = events.findLast((event) => event.type === 'result');
  const problems = [];
  if (!init) problems.push('no init event (was --output-format stream-json --verbose passed?)');
  else {
    const expected = resolve(checkout, 'plugins/oai');
    const plugin = (init.plugins ?? []).find((entry) => entry.name === 'oai');
    if (!plugin) problems.push('the oai plugin did not load');
    else if (plugin.source !== 'oai@inline' || resolve(plugin.path ?? '') !== expected) {
      problems.push(`the oai plugin loaded from ${plugin.source} at ${plugin.path}, not oai@inline at ${expected}`);
    }
    if (!(init.slash_commands ?? []).includes(command)) problems.push(`${command} is not a registered slash command`);
    const session = init.session_id ? sessionTranscript(projectsDir, init.session_id) : null;
    if (session === null) problems.push(`no session transcript for ${init.session_id ?? 'an unnamed session'} under ${projectsDir}`);
    else {
      const users = parse(session).filter((entry) => entry.type === 'user' && !entry.isSidechain);
      const at = users.findLastIndex(isPrompt);
      const prompt = users[at];
      const dispatched = typeof content(prompt) === 'string' && envelope(command).test(content(prompt));
      if (!dispatched || !users[at + 1]?.isMeta) problems.push(`the prompt was not dispatched as /${command}`);
    }
  }
  if (!result) problems.push('no result event');
  else if (result.is_error) problems.push(`the run ended in error: ${result.subtype}`);
  return { ok: problems.length === 0, problems, text: result?.result ?? '' };
}

function main(argv) {
  const [command, ...rest] = argv;
  const flag = (name) => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1] ?? '';
  };
  const checkout = flag('--checkout') ?? process.cwd();
  const projectsDir = flag('--projects-dir') ?? join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  if (!command || !checkout || !projectsDir) {
    process.stderr.write('usage: check-load.mjs <oai:command> [--checkout <dir>] [--projects-dir <dir>] < stream-json transcript\n');
    process.exitCode = 2;
    return;
  }
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    const { ok, problems, text } = checkLoad(Buffer.concat(chunks).toString('utf8'), { command, checkout, projectsDir });
    if (!ok) {
      process.stderr.write(`NOT LOADED: ${problems.join('; ')}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`LOADED: ${command} from oai@inline\n\n${text}\n`);
  });
}

main(process.argv.slice(2));
