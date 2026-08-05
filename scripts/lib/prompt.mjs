import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { UserError } from './errors.mjs';

// Short and directive: small local models follow terse instructions better than
// the long preambles a frontier model tolerates.
export const DEFAULT_SYSTEM_PROMPT =
  'You are a precise software engineering assistant. Answer the request directly. ' +
  'Base your answer only on the files provided; never invent file contents you were not given. ' +
  'If the request cannot be answered from what you were given, say so.';

export function readFileBlocks(paths = []) {
  return paths.map((given) => {
    const absolute = resolve(given);
    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new UserError(`File not found: ${given}`);
      if (error.code === 'EISDIR') throw new UserError(`${given} is a directory — pass individual files with repeated --file.`);
      throw new UserError(`Could not read ${given}: ${error.message}`);
    }
    return { path: relative(process.cwd(), absolute) || given, content };
  });
}

export function buildMessages({ system = DEFAULT_SYSTEM_PROMPT, prompt, files = [] }) {
  const blocks = files.map((file) => `--- FILE: ${file.path} ---\n${file.content}\n--- END FILE: ${file.path} ---`);
  const content = blocks.length > 0 ? `${blocks.join('\n\n')}\n\n${prompt}` : prompt;
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
