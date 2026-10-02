import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { UserError } from './errors.mjs';

// Short and directive: small local models follow terse instructions better than
// the long preambles a frontier model tolerates.
export const DEFAULT_SYSTEM_PROMPT =
  'You are a precise software engineering assistant. Answer the request directly. ' +
  'Base your answer only on the files provided; never invent file contents you were not given. ' +
  'If the request cannot be answered from what you were given, say so.';

/**
 * `path`, or `path:START-END` for a slice.
 *
 * Split off a trailing `:N-M` only — a bare `:N` is not accepted, because "one
 * line" is almost never what someone means and guessing an end is how a slice
 * silently becomes a different slice. A Windows drive letter or any other colon
 * earlier in the path is untouched, since only the final segment is examined.
 */
export function parseFileArg(given) {
  const match = /^(.*):(\d+)-(\d+)$/.exec(given);
  if (!match) return { path: given, slice: null };
  const [, path, from, to] = match;
  const start = Number(from);
  const end = Number(to);
  if (start < 1) throw new UserError(`${given}: line numbers start at 1.`);
  if (end < start) throw new UserError(`${given}: the range ends before it starts.`);
  return { path, slice: { start, end } };
}

export function readFileBlocks(paths = []) {
  return paths.map((given) => {
    const { path: rawPath, slice } = parseFileArg(given);
    const absolute = resolve(rawPath);
    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new UserError(`File not found: ${rawPath}`);
      if (error.code === 'EISDIR') throw new UserError(`${rawPath} is a directory — pass individual files with repeated --file.`);
      throw new UserError(`Could not read ${rawPath}: ${error.message}`);
    }
    const path = relative(process.cwd(), absolute) || rawPath;
    if (!slice) return { path, content };

    // A file ending in a newline splits to a trailing empty element that is not
    // a line. Counting it made every ordinary source file one line too long, so
    // `:2-2` on a one-line file was ACCEPTED and attached nothing.
    const raw = content.split('\n');
    const lines = raw.length > 1 && raw[raw.length - 1] === '' ? raw.slice(0, -1) : raw;
    if (slice.start > lines.length) {
      throw new UserError(`${given}: the file has ${lines.length} lines.`);
    }
    // The END is clamped rather than refused: asking for 40-999 of a 120-line
    // file is an ordinary way of saying "to the end", and refusing it would make
    // the caller count lines to ask a question about a file they can see.
    const end = Math.min(slice.end, lines.length);
    return {
      path,
      content: lines.slice(slice.start - 1, end).join('\n'),
      // Carried so the block header can say so. A slice the model believes is a
      // whole file is the defect `review.mjs` names: it invites "X is not
      // defined" about something defined ten lines above the cut.
      slice: { start: slice.start, end, of: lines.length },
    };
  });
}

/**
 * The warning a sliced request cannot go without.
 *
 * `review.mjs` states the rule this follows: telling a model it has a whole file
 * it does not have "is the very defect this argument exists to remove". A slice
 * invites exactly the false conclusion — that an identifier defined ten lines
 * above the cut is undefined — so the request says plainly what it is carrying.
 *
 * Only emitted when a slice is actually present, so an ordinary whole-file
 * request is unchanged.
 */
function sliceNote(files) {
  const sliced = files.filter((file) => file.slice);
  if (sliced.length === 0) return null;
  const named = sliced.map((file) => `${file.path} (lines ${file.slice.start}-${file.slice.end} of ${file.slice.of})`);
  return (
    `NOTE: ${sliced.length} of these file(s) are PARTIAL — you have only the lines named in the block ` +
    `header: ${named.join(', ')}. Anything they refer to may be defined in a part of the file you cannot ` +
    'see, so do not report an identifier as undefined, unimported or missing in those.'
  );
}

export function buildMessages({ system = DEFAULT_SYSTEM_PROMPT, prompt, files = [] }) {
  const blocks = files.map((file) => {
    // The header carries the range, so the fact travels with the content rather
    // than only in a note that a long request could push far away from it.
    const header = file.slice
      ? `--- FILE: ${file.path} (lines ${file.slice.start}-${file.slice.end} of ${file.slice.of}) ---`
      : `--- FILE: ${file.path} ---`;
    // The END marker is deliberately unchanged: `requestTextOf` finds the tail of
    // the request by the last `\n--- END FILE: `, and `/oai:status` renders that.
    return `${header}\n${file.content}\n--- END FILE: ${file.path} ---`;
  });
  // The note goes BEFORE the blocks, and that position is load-bearing rather
  // than cosmetic. `requestTextOf` recovers the request as everything after the
  // LAST `--- END FILE: `, and `job-render.mjs` shows its FIRST line as what a
  // job was asked to do. With the note after the blocks, every backgrounded
  // sliced job displayed the warning instead of the request — permanently, since
  // the messages are frozen at submission.
  const note = sliceNote(files);
  const body = note ? [note, ...blocks] : blocks;
  const content = body.length > 0 ? `${body.join('\n\n')}\n\n${prompt}` : prompt;
  return [
    { role: 'system', content: system },
    { role: 'user', content },
  ];
}

/**
 * The request text back out of an assembled user message — everything after the
 * last file block.
 *
 * Here rather than in the reader that wants it, beside the function that decides
 * the layout, because the two are one definition: a reader that re-derived this
 * would drift the moment the delimiters changed, and its failure mode is silent.
 * It showed `--- FILE: scripts/lib/errors.mjs ---` as what a job had been asked
 * to do, which is a plausible-looking wrong answer rather than an obvious one.
 */
export function requestTextOf(content) {
  const text = String(content ?? '');
  const marker = text.lastIndexOf('\n--- END FILE: ');
  if (marker === -1) return text.trim();
  const lineEnd = text.indexOf('\n', marker + 1);
  return lineEnd === -1 ? '' : text.slice(lineEnd).trim();
}

export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch (error) {
    // A pipe with nothing ready reports EAGAIN on a non-blocking fd. Treat that
    // as "nothing was piped" — the alternative is blocking the session on a
    // producer that may never write.
    if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') return '';
    throw new UserError(`Could not read piped input: ${error.message}`);
  }
}
