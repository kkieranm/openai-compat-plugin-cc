// The count of contention-handling sites, asserted against the code rather than
// against a reviewer's attention.
//
// A site count in prose drifted THREE TIMES in three review passes — five, six,
// nine, each wrong when written — because a number in prose has nothing holding
// it to the code it describes. This repo's rule is that a recurring defect class
// graduates from a reviewer's prompt to a structural test, and three instances
// in one feature is that signal.
//
// The numbers are NOT hardcoded here. They are counted from `scripts/lib`, spelled
// out, and the resulting sentence is required to appear in each document. Change
// the code and the required sentence changes with it, so the docs redden until
// they agree — which is the whole point, and is what a hardcoded expectation
// would not do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const LIB = join(ROOT, 'scripts/lib');

/** The module that DEFINES these helpers is not a call site of them. */
const DEFINITION = 'job-busy.mjs';

const SPELLED = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
];

/**
 * Comments blanked, so a count never includes the prose that describes it.
 *
 * Without this the guard is circular in the worst way: `job-busy.mjs`'s own doc
 * comment names every call site, so counting raw text there would find the
 * documented number by reading the documentation.
 */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function countCalls(symbol) {
  let total = 0;
  for (const name of readdirSync(LIB)) {
    if (!name.endsWith('.mjs') || name === DEFINITION) continue;
    const matches = code(readFileSync(join(LIB, name), 'utf8')).match(new RegExp(`\\b${symbol}\\(`, 'g'));
    total += matches ? matches.length : 0;
  }
  return total;
}

test('every stated count of contention sites matches the code', () => {
  const counts = { withBusyRetry: countCalls('withBusyRetry'), isBusy: countCalls('isBusy') };

  // A positive control on the instrument itself. If the counters ever return
  // zero — a moved directory, a renamed helper, a regex that stopped matching —
  // every assertion below would pass vacuously against prose saying "zero".
  assert.ok(counts.withBusyRetry > 0, 'counted no withBusyRetry call sites: this guard is examining nothing');
  assert.ok(counts.isBusy > 0, 'counted no isBusy call sites: this guard is examining nothing');
  assert.ok(counts.withBusyRetry < SPELLED.length, 'more call sites than this guard can spell');
  assert.ok(counts.isBusy < SPELLED.length, 'more call sites than this guard can spell');

  const required = [
    `${SPELLED[counts.withBusyRetry]} \`withBusyRetry\` call sites`,
    `${SPELLED[counts.isBusy]} \`isBusy\` call sites`,
  ];

  const documents = ['scripts/lib/job-busy.mjs'];
  const failures = [];
  for (const relative of documents) {
    const text = readFileSync(join(ROOT, relative), 'utf8');
    for (const sentence of required) {
      if (!text.includes(sentence)) failures.push(`${relative}: must state "${sentence}"`);
    }
    // The wrong number beside the right noun is the exact failure this exists
    // for, and it is worth naming separately from a missing sentence.
    for (const [n, word] of SPELLED.entries()) {
      for (const [symbol, actual] of Object.entries(counts)) {
        const wrong = `${word} \`${symbol}\` call sites`;
        if (n !== actual && text.includes(wrong)) failures.push(`${relative}: says "${wrong}", but there are ${actual}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
