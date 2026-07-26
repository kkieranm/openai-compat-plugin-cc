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
