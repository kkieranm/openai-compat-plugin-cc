// What counts as "the model found this defect". The bench's whole number
// depends on these rules, so each one is pinned by the case that would break it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recall, scoreRun } from '../bench/lib/score.mjs';

const ANCHOR = 'if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in properties)))';

const ANCHORED = { id: 'key-in-properties', file: 'scripts/lib/structured.mjs', lines: [120, 124], anchor: ANCHOR };
// A defect that is *missing* code: there is no offending line to quote, so the
// manifest carries no anchor and only the range can recognise it.
const MISSING = { id: 'no-cap-report', file: 'scripts/lib/structured.mjs', lines: [200, 210], anchor: null };

function finding(overrides = {}) {
  return { file: 'structured.mjs', line: null, severity: 'high', summary: 'a summary', evidence: '', ...overrides };
}

test('a finding quoting the offending line matches by anchor', () => {
  const hit = finding({ evidence: `Here: ${ANCHOR} — the key check is inverted.` });

  const { matched, unmatched, byDefect } = scoreRun([hit], [ANCHORED]);

  assert.deepEqual(matched, [{ id: 'key-in-properties', via: 'anchor', finding: hit }]);
  assert.deepEqual(unmatched, []);
  assert.deepEqual(byDefect, [{ id: 'key-in-properties', found: true, via: 'anchor' }]);
});

test('anchor matching survives reindented and reflowed quotes', () => {
  // What a model actually returns: the same code, wrapped and indented into its
  // own prose. Comparing raw strings would score this correct finding a miss.
  const reflowed = ANCHOR.replace(' && ', '\n      && ').replace('(key in', '(key\n        in');
  const hit = finding({ evidence: `        ${reflowed}\n` });

  assert.equal(scoreRun([hit], [ANCHORED]).matched[0].via, 'anchor');
});

test('a defect with no anchor is recognised by line range alone', () => {
  const hit = finding({ line: 205, evidence: 'the cap is never reported' });

  const { matched, byDefect } = scoreRun([hit], [MISSING]);

  assert.deepEqual(matched, [{ id: 'no-cap-report', via: 'range', finding: hit }]);
  assert.deepEqual(byDefect, [{ id: 'no-cap-report', found: true, via: 'range' }]);
});

test('the right file at the wrong line, with nothing quoted, is unmatched', () => {
  const miss = finding({ line: 300, evidence: 'something about validation' });

  const { matched, unmatched, byDefect } = scoreRun([miss], [ANCHORED]);

  assert.deepEqual(matched, []);
  assert.deepEqual(unmatched, [miss], 'unmatched findings are carried whole, not counted');
  assert.deepEqual(byDefect, [{ id: 'key-in-properties', found: false, via: null }]);
});

test('file matching compares whole segments, so myconfig.mjs is a different file', () => {
  const defect = { id: 'apikey', file: 'scripts/lib/config.mjs', lines: [10, 20], anchor: null };

  // Suffix matching on raw strings would accept this and credit a defect in a
  // file the model never mentioned.
  assert.deepEqual(scoreRun([finding({ file: 'myconfig.mjs', line: 15 })], [defect]).matched, []);
  assert.equal(scoreRun([finding({ file: 'config.mjs', line: 15 })], [defect]).matched.length, 1);
  assert.equal(scoreRun([finding({ file: 'lib/config.mjs', line: 15 })], [defect]).matched.length, 1);
});

test('a finding with no line and no quoted evidence matches nothing', () => {
  const vague = finding({ line: null, evidence: 'the validation logic looks suspicious' });

  const { matched, unmatched } = scoreRun([vague], [ANCHORED, MISSING]);

  assert.deepEqual(matched, []);
  assert.deepEqual(unmatched, [vague]);
});

test('one finding can satisfy two defects — findings are not consumed', () => {
  // The inflation risk the corpus avoids by not co-locating defects: this one
  // finding sits in both ranges, and both defects are credited to it.
  const overlapping = { id: 'second', file: 'scripts/lib/structured.mjs', lines: [118, 130], anchor: null };
  const hit = finding({ line: 121, evidence: ANCHOR });

  const { matched, unmatched } = scoreRun([hit], [ANCHORED, overlapping]);

  assert.deepEqual(
    matched.map((entry) => [entry.id, entry.via]),
    [['key-in-properties', 'anchor'], ['second', 'range']],
  );
  assert.deepEqual(unmatched, []);
});

test('two findings on one defect credit the anchored one and neither is unmatched', () => {
  const anchored = finding({ line: null, evidence: ANCHOR });
  const ranged = finding({ line: 122, evidence: 'roughly around here' });

  const { matched, unmatched } = scoreRun([ranged, anchored], [ANCHORED]);

  assert.deepEqual(matched, [{ id: 'key-in-properties', via: 'anchor', finding: anchored }]);
  // The range-matching finding matched the defect too, so calling it unmatched
  // would describe a correct finding as an extra one.
  assert.deepEqual(unmatched, []);
});

test('recall splits found defects by how they were recognised', () => {
  const byDefect = [
    { id: 'a', found: true, via: 'anchor' },
    { id: 'b', found: true, via: 'range' },
    { id: 'c', found: true, via: 'anchor' },
    { id: 'd', found: false, via: null },
  ];

  assert.deepEqual(recall(byDefect), { total: 4, found: 3, anchored: 2, ranged: 1 });
  assert.deepEqual(recall([]), { total: 0, found: 0, anchored: 0, ranged: 0 });
});
