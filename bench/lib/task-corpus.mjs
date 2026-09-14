// Loading the task corpus, and refusing a case that cannot bear evidence.
//
// A separate loader from `corpus.mjs` rather than a pluggable one. That file
// enforces review-specific facts — `defects`, `dropped`, line ranges, review
// modes, `--commit`/`--file` arguments — and making its validator and scorer
// injectable would produce a generic-looking API full of domain branches while
// weakening the validation that is the point of it. `ttl-challenge.mjs` shares
// `loadCases` only because it deliberately runs the SAME review cases; that is
// not evidence that review defects and task claims share a schema.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const TASK_CASES_DIR = 'bench/task-cases';

/** Both framing arms, named once so nothing reconstructs them from a label. */
export const ARMS = ['neutral', 'pointed'];

function fail(id, message) {
  throw new Error(`task case "${id}": ${message}`);
}

/**
 * Everything a case must carry to be admissible, checked at load rather than at
 * use — a corpus that half-validates produces a sweep that dies mid-flight with
 * a record already half-written.
 */
function validate(caseDef, dir) {
  const { id } = caseDef;
  if (!id) fail('(unnamed)', 'needs an id');
  for (const field of ['label', 'template', 'files', 'witness', 'prompts', 'claims']) {
    if (caseDef[field] === undefined) fail(id, `needs "${field}"`);
  }
  if (!Array.isArray(caseDef.files) || caseDef.files.length === 0) fail(id, '"files" must be a non-empty array');
  if (!Array.isArray(caseDef.claims) || caseDef.claims.length === 0) fail(id, '"claims" must be a non-empty array');

  for (const arm of ARMS) {
    if (typeof caseDef.prompts[arm] !== 'string' || !caseDef.prompts[arm].trim()) {
      fail(id, `needs a non-empty "${arm}" prompt — framing is a paired dimension, not a flag`);
    }
  }
  for (const claim of caseDef.claims) {
    if (!claim.id) fail(id, 'every claim needs an id');
    if (!Array.isArray(claim.any) || claim.any.length === 0) fail(id, `claim "${claim.id}" needs "any" markers`);
  }

  // The executable witness, and the fixture pair it separates. Without both
  // trees there is nothing to prove the defect was ever real, which is this
  // corpus's substitute for the review corpus's anchor-liveness guard.
  for (const tree of ['before', 'after']) {
    if (!existsSync(join(dir, tree)) || !statSync(join(dir, tree)).isDirectory()) {
      fail(id, `needs a ${tree}/ tree`);
    }
  }
  if (!existsSync(join(dir, caseDef.witness))) fail(id, `witness ${caseDef.witness} does not exist`);
  for (const file of caseDef.files) {
    if (!existsSync(join(dir, 'before', file))) fail(id, `attaches ${file}, which is not in before/`);
  }

  // The leakage guard: a prompt that contains a marker hands the model the
  // answer, and the case would then measure the prompt.
  for (const arm of ARMS) {
    const prompt = caseDef.prompts[arm].toLowerCase();
    for (const claim of caseDef.claims) {
      // BOTH lists. A prompt containing a contradiction phrase baits the model
      // into echoing it, and the echo then scores as a genuine contradiction —
      // which ranks below a miss, so the case would punish an answer for
      // repeating its own question.
      for (const marker of [...claim.any, ...(claim.contradictions ?? [])]) {
        if (prompt.includes(marker.toLowerCase())) {
          fail(id, `the ${arm} prompt contains the marker "${marker}" — it would be scoring itself`);
        }
      }
    }
  }
  return caseDef;
}

/** Every case on disk, validated, ordered by id so a sweep is reproducible. */
export function loadTaskCases(root) {
  const base = join(root, TASK_CASES_DIR);
  if (!existsSync(base)) throw new Error(`no task corpus at ${base}`);
  const ids = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return ids.map((id) => {
    const dir = join(base, id);
    const caseDef = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
    if (caseDef.id !== id) fail(id, `declares id "${caseDef.id}" but sits in ${id}/`);
    return { ...validate(caseDef, dir), dir };
  });
}

/** The `--file` arguments a case's request carries, absolute so cwd cannot matter. */
export function attachmentArgs(caseDef) {
  return caseDef.files.flatMap((file) => ['--file', join(caseDef.dir, 'before', file)]);
}
