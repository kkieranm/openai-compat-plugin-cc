import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoFlagsInPrompt, parseArgs, parseCommandLine, splitBlob } from '../scripts/lib/args.mjs';

const TASK_SPEC = {
  valueFlags: ['provider', 'base-url', 'model', 'prompt-file', 'system', 'timeout', 'max-tokens', 'temperature'],
  repeatableFlags: ['file'],
};

test('prompt text is taken verbatim, punctuation and all', () => {
  // Regression: prose was previously parsed with shell-quoting rules, so an
  // apostrophe opened a quote that never closed — silently dropping it and
  // merging the rest of the sentence into one token.
  assert.deepEqual(splitBlob("explain what the file's header does", TASK_SPEC), {
    tokens: [],
    prompt: "explain what the file's header does",
    terminated: false,
  });
  assert.deepEqual(splitBlob('what does \\d+ match in "this" regex?', TASK_SPEC), {
    tokens: [],
    prompt: 'what does \\d+ match in "this" regex?',
    terminated: false,
  });
});

test('leading flags are parsed, and the prompt after them stays verbatim', () => {
  const { tokens, prompt } = splitBlob("--model qwen3 --file src/a.js summarize the module's job", TASK_SPEC);
  assert.deepEqual(tokens, ['--model', 'qwen3', '--file', 'src/a.js']);
  assert.equal(prompt, "summarize the module's job");
});

test('a quoted flag value with spaces survives', () => {
  const { tokens, prompt } = splitBlob('--file "/tmp/a b.txt" explain it', TASK_SPEC);
  assert.deepEqual(tokens, ['--file', '/tmp/a b.txt']);
  assert.equal(prompt, 'explain it');
});

test('-- ends the flag region explicitly', () => {
  const { tokens, prompt, terminated } = splitBlob('--model qwen -- explain the --file flag', TASK_SPEC);
  assert.deepEqual(tokens, ['--model', 'qwen']);
  assert.equal(prompt, 'explain the --file flag');
  assert.equal(terminated, true, 'the terminator must be reported so the prompt is not re-scanned for flags');
});

test('a quoted flag-lookalike is prompt text, not a flag', () => {
  const { tokens, prompt } = splitBlob("'--model' is a flag, explain it", TASK_SPEC);
  assert.deepEqual(tokens, []);
  assert.equal(prompt, "'--model' is a flag, explain it");
});

test('flags are not recognised after the request text begins', () => {
  // The argv path used to keep parsing flags, so "explain the --model flag"
  // consumed "flag" as a model id and truncated the prompt.
  const { options, positionals } = parseArgs(['explain', 'the', '--model', 'flag'], TASK_SPEC);
  assert.deepEqual(options, {});
  assert.deepEqual(positionals, ['explain', 'the', '--model', 'flag']);
});

test('a lone --flag=value keeps a value containing spaces', () => {
  assert.deepEqual(parseCommandLine(['--system=be terse'], TASK_SPEC), {
    options: { system: 'be terse' },
    prompt: '',
    terminated: false,
  });
});

test('an unterminated quote among the flags is an error, not silent corruption', () => {
  assert.throws(() => splitBlob('--file "/tmp/unclosed explain', TASK_SPEC), /Unterminated quote/);
});

test('parseCommandLine handles both the blob and a real argv', () => {
  // One entry: the "$ARGUMENTS" shape.
  assert.deepEqual(parseCommandLine(["--model qwen what's up"], TASK_SPEC), {
    options: { model: 'qwen' },
    prompt: "what's up",
    terminated: false,
  });
  // Several entries: Claude built the Bash call, so a path with a space is intact.
  assert.deepEqual(parseCommandLine(['--file', '/tmp/a b.txt', "what's up"], TASK_SPEC), {
    options: { file: ['/tmp/a b.txt'] },
    prompt: "what's up",
    terminated: false,
  });
  // An unset "$ARGUMENTS" substitutes to one empty argument.
  assert.deepEqual(parseCommandLine([''], TASK_SPEC), { options: {}, prompt: '', terminated: false });
});

test('parses value, repeatable and boolean flags', () => {
  const { options, positionals } = parseArgs(
    ['--provider', 'lmstudio', '--file', 'a.js', '--file', 'b.js', '--json', 'do', 'the', 'thing'],
    { valueFlags: ['provider'], repeatableFlags: ['file'], booleanFlags: ['json'] },
  );
  assert.deepEqual(options, { provider: 'lmstudio', file: ['a.js', 'b.js'], json: true });
  assert.deepEqual(positionals, ['do', 'the', 'thing']);
});

test('accepts --flag=value form', () => {
  assert.equal(parseArgs(['--provider=omlx'], { valueFlags: ['provider'] }).options.provider, 'omlx');
  assert.deepEqual(splitBlob('--provider=omlx explain', { valueFlags: ['provider'] }).tokens, ['--provider=omlx']);
});

test('rejects an unknown flag instead of swallowing it into the prompt', () => {
  assert.throws(() => parseArgs(['--modle', 'x'], { valueFlags: ['model'] }), /Unknown option "--modle"/);
});

test('rejects a value flag with no value', () => {
  assert.throws(() => parseArgs(['--model'], { valueFlags: ['model'] }), /Missing value for --model/);
  assert.throws(() => splitBlob('--model', { valueFlags: ['model'] }), /Missing value for --model/);
});

test('a known flag written after the prompt is reported, not silently absorbed', () => {
  assert.throws(() => assertNoFlagsInPrompt('summarize this --model qwen', TASK_SPEC), /"--model" appears inside the prompt/);
  // A flag this command does not define is ordinary prose.
  assert.doesNotThrow(() => assertNoFlagsInPrompt('what does --json do?', TASK_SPEC));
});
