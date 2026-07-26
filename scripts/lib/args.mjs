import { UserError } from './errors.mjs';

const QUOTES = new Set(["'", '"']);

/**
 * Read one token starting at `index`. Quotes group a value; backslashes are
 * literal, because this only ever reads the leading flag region — never prompt
 * text, where a backslash means a backslash.
 */
function readToken(raw, start) {
  let index = start;
  while (index < raw.length && /\s/.test(raw[index])) index += 1;
  if (index >= raw.length) return null;

  const tokenStart = index;
  let token = '';
  let quote = null;
  let quoted = false;

  for (; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (QUOTES.has(character)) {
      // Remember that the token opened with a quote: quoting is how a user says
      // "this is text, not a flag", so the stripped value must not be re-read
      // as one.
      if (index === tokenStart) quoted = true;
      quote = character;
      continue;
    }
    if (/\s/.test(character)) break;
    token += character;
  }

  return { token, tokenStart, next: index, unterminated: quote !== null, quoted };
}

/**
 * Split the single-argument form that "$ARGUMENTS" produces.
 *
 * Leading flags are tokenized; everything from the first non-flag token onward
 * is the prompt, taken verbatim from the original string. Prompt text is prose,
 * not shell syntax: an apostrophe in "what the file's header does" and a
 * backslash in "what \d+ matches" must survive exactly as typed. A bare `--`
 * ends the flag region explicitly.
 */
export function splitBlob(raw, { valueFlags = [], repeatableFlags = [] } = {}) {
  const takesValue = new Set([...valueFlags, ...repeatableFlags]);
  const tokens = [];
  let index = 0;

  for (;;) {
    const read = readToken(raw, index);
    if (!read) return { tokens, prompt: '', terminated: false };

    if (!read.quoted && read.token === '--') {
      return { tokens, prompt: raw.slice(read.next).trim(), terminated: true };
    }
    // A quoted token is prompt text even when it looks like a flag; the slice
    // starts at the quote so the user's characters survive exactly.
    if (read.quoted || !read.token.startsWith('--')) {
      return { tokens, prompt: raw.slice(read.tokenStart).trim(), terminated: false };
    }
    if (read.unterminated) {
      throw new UserError(`Unterminated quote in option "${read.token}".`);
    }

    tokens.push(read.token);
    index = read.next;

    const name = read.token.slice(2).split('=')[0];
    if (takesValue.has(name) && !read.token.includes('=')) {
      const value = readToken(raw, index);
      if (!value) throw new UserError(`Missing value for --${name}.`);
      if (value.unterminated) throw new UserError(`Unterminated quote in the value for --${name}.`);
      tokens.push(value.token);
      index = value.next;
    }
  }
}

/**
 * Minimal long-flag parser. Unknown flags are an error rather than positionals,
 * so a typo never gets silently swallowed into a prompt.
 */
export function parseArgs(argv, { valueFlags = [], booleanFlags = [], repeatableFlags = [] } = {}) {
  const values = new Set([...valueFlags, ...repeatableFlags]);
  const booleans = new Set(booleanFlags);
  const repeatable = new Set(repeatableFlags);
  const options = {};
  const positionals = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (passthrough) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      passthrough = true;
      continue;
    }
    if (!token.startsWith('--')) {
      // Flags are recognised only before the request text starts, matching
      // splitBlob. Continuing to parse them let "explain the --model flag"
      // swallow "flag" as a model id and truncate the prompt.
      positionals.push(...argv.slice(index));
      break;
    }

    const separator = token.indexOf('=');
    const key = separator === -1 ? token.slice(2) : token.slice(2, separator);
    const inline = separator === -1 ? undefined : token.slice(separator + 1);

    if (booleans.has(key)) {
      options[key] = inline === undefined ? true : inline !== 'false';
      continue;
    }
    if (!values.has(key)) {
      const known = [...values, ...booleans].sort().map((flag) => `--${flag}`).join(', ');
      throw new UserError(`Unknown option "${token}".`, { hint: `Supported options: ${known}` });
    }

    const value = inline ?? argv[index + 1];
    if (value === undefined) throw new UserError(`Missing value for --${key}.`);
    if (inline === undefined) index += 1;

    if (repeatable.has(key)) (options[key] ??= []).push(value);
    else options[key] = value;
  }

  return { options, positionals, terminated: passthrough };
}

// A lone "--flag=value with spaces" argument is one flag, not a blob to split.
const SINGLE_ASSIGNMENT = /^--[A-Za-z][\w-]*=/;

/**
 * Parse argv however it arrives: as one "$ARGUMENTS" blob, or as a properly
 * separated argv when Claude builds the Bash call itself.
 */
export function parseCommandLine(argv, spec = {}) {
  const entries = argv.filter((entry) => entry !== '');

  if (entries.length === 1 && /\s/.test(entries[0]) && !SINGLE_ASSIGNMENT.test(entries[0])) {
    const { tokens, prompt, terminated } = splitBlob(entries[0], spec);
    return { options: parseArgs(tokens, spec).options, prompt, terminated };
  }

  const { options, positionals, terminated } = parseArgs(entries, spec);
  return { options, prompt: positionals.join(' '), terminated };
}

/**
 * Flags are only recognised before the prompt begins. Saying so beats letting a
 * trailing "--model qwen" silently become part of the request text.
 */
export function assertNoFlagsInPrompt(prompt, spec) {
  const names = [...(spec.valueFlags ?? []), ...(spec.booleanFlags ?? []), ...(spec.repeatableFlags ?? [])];
  const found = names.find((flag) => new RegExp(`(^|\\s)--${flag}(\\s|=|$)`).test(prompt));
  if (!found) return;
  throw new UserError(`"--${found}" appears inside the prompt text rather than before it.`, {
    hint: 'Put flags before the request, separate them with --, or use --prompt-file for text that mentions flags.',
  });
}
