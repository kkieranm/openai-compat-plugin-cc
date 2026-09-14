#!/usr/bin/env node
// Read N bench REVIEW records together and print a cross-run comparison.
//
// bench/ writes one record per invocation and nothing consumes more than one, so
// every cross-run ranking was assembled by hand — where the errors were. This is
// the missing reader: it emits the comparison from the records' own numbers and
// refuses to rank records that are not like-for-like. Deliberately not part of
// `npm test`; it takes real records as arguments and writes Markdown to stdout.
//
// Usage: node bench/compare.mjs [--baseline <path>] <record.json> ...
// Flags come BEFORE the record paths (parseArgs stops at the first positional),
// the same order recover-sweep.mjs uses.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/lib/args.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { buildComparison, isReviewRecord, normalizeReviewRecord } from './lib/compare-model.mjs';
import { renderComparison } from './lib/compare-report.mjs';

const SPEC = { valueFlags: ['baseline'], booleanFlags: [], repeatableFlags: [] };

// A file becomes an entry only if it is a REVIEW record — a sweep or task record
// carrying a `results` array is refused here, before normalization, since it is
// OAI-151's concern, not this reader's.
function readEntry(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new UserError(`Cannot read ${path}: ${error.message}`);
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new UserError(`${path} is not valid JSON: ${error.message}`);
  }
  if (!isReviewRecord(record)) {
    throw new UserError(
      `${path} is not a bench review record.`,
      { hint: 'Expected a { runsPerCase, options, results } record from `npm run bench`; sweep/task records are out of scope (OAI-151).' },
    );
  }
  return { path, stamp: basename(path).replace(/\.json$/, ''), record };
}

export function compare(paths, { baseline = null } = {}) {
  if (paths.length === 0) {
    throw new UserError('No records to compare.', { hint: 'Pass one or more bench/results/*.json record paths.' });
  }
  const entries = paths.map(readEntry);
  if (baseline && !paths.includes(baseline)) {
    throw new UserError(`--baseline ${baseline} is not one of the records being compared.`);
  }
  const normalized = entries.map(normalizeReviewRecord);
  const model = buildComparison(normalized, { baseline });
  return renderComparison(model);
}

function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  process.stdout.write(compare(positionals, { baseline: options.baseline ?? null }) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (error instanceof UserError) {
      process.stderr.write(`${error.message}${error.hint ? `\n${error.hint}` : ''}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
