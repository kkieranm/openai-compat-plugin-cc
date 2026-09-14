// The executable witness for `prototype-lookup`.
//
// A prose-scored corpus cannot have the review corpus's anchor-liveness guard —
// there is no quoted line to check against real code. This is the replacement:
// a deterministic oracle that FAILS against `before/` and PASSES against
// `after/`, so the case is proved to describe a real defect rather than an
// author's memory of one. A case whose witness does not separate the two is not
// admissible evidence, and `tests/task-corpus.test.js` enforces exactly that.
//
// Usage: `node witness.mjs <dir>` — exit 0 when the defect is ABSENT.
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '');
const { resolveTemplate } = await import(pathToFileURL(join(dir, 'registry.mjs')).href);

// Names that exist on Object.prototype and were never registered as templates.
// A closed set is closed only if it refuses these.
const INHERITED = ['toString', 'constructor', 'valueOf', 'hasOwnProperty'];

const admitted = [];
for (const name of INHERITED) {
  try {
    const template = resolveTemplate(name);
    // Refusing is the correct behaviour; anything returned is the defect.
    if (template) admitted.push(name);
  } catch {
    // A refusal is what we want, whatever its message.
  }
}

if (admitted.length > 0) {
  process.stderr.write(`defect present: resolved ${admitted.length} inherited name(s): ${admitted.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write('defect absent: every inherited name was refused\n');
