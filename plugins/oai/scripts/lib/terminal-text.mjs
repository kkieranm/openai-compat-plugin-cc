// Text that reaches the user's terminal from an untrusted source (git's stderr, a path
// name) must not carry a character that rewrites what is shown around it.

// Control characters (C0, DEL, C1), every Bidi_Control character, and the line and
// paragraph separators. Written in escapes only: a literal U+2028 in source is a line
// terminator.
const UNSAFE_SOURCE = '[\\p{Cc}\\p{Bidi_Control}\\u2028\\u2029]';

/** `text` with every unsafe character removed. */
export function stripUnsafe(text) {
  return text.replace(new RegExp(UNSAFE_SOURCE, 'gu'), '');
}

const PLAIN_PATH = /^[A-Za-z0-9._/+@=-]+$/;

/**
 * A path as shown to the user: unchanged when it is plain ASCII letters, digits and
 * `._/+@=-`, else JSON-quoted with every character outside printable ASCII written as a
 * `\uXXXX` escape. An unquoted path holds no space, comma or quote, and a quoted one is
 * printable ASCII, so neither can pass for list or sentence punctuation around it.
 */
export function displayPath(path) {
  if (PLAIN_PATH.test(path)) return path;
  return JSON.stringify(path).replace(/[^\x20-\x7e]/g, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * `JSON.stringify(value, null, space)` with every unsafe character written as a
 * `\uXXXX` escape, so JSON bound for a terminal cannot rewrite the display. U+000A is
 * left alone: stringify escapes control characters inside strings, so a raw newline in
 * its output is indentation, and `\u000a` outside a string is not JSON. The result
 * parses to the same value.
 */
export function safeJson(value, space) {
  return JSON.stringify(value, null, space).replace(new RegExp(UNSAFE_SOURCE, 'gu'), (char) =>
    char === '\n' ? char : `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
