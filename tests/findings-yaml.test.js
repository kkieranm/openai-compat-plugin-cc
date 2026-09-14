import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingsInYaml } from '../scripts/lib/findings-yaml.mjs';
import { parseFindings } from '../scripts/lib/structured.mjs';
import { payload } from './findings-fixtures.mjs';

test('the reproduced ticket shape parses to a findings list', () => {
  const text = [
    'findings:',
    '  - file: scripts/lib/json-scan.mjs',
    '    line: 42',
    '    severity: medium',
    '    summary: scanFor loses its start position on a dead candidate',
  ].join('\n');
  const parsed = findingsInYaml(text);
  assert.deepEqual(parsed, {
    findings: [
      {
        file: 'scripts/lib/json-scan.mjs',
        line: '42',
        severity: 'medium',
        summary: 'scanFor loses its start position on a dead candidate',
      },
    ],
  });
});

test('wiring: an unconstrained whole-document YAML reply reaches parseFindings', () => {
  const text = ['findings:', '  - file: scripts/lib/json-scan.mjs', '    line: 42', '    summary: boom'].join('\n');
  const parsed = parseFindings({ content: text, reasoning: '' }, { structured: false });
  assert.notEqual(parsed, null);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, 'scripts/lib/json-scan.mjs');
});

test('a trailing top-level summary scalar is captured', () => {
  const text = ['findings:', '  - file: a.js', '    summary: boom', 'summary: one defect found'].join('\n');
  assert.deepEqual(findingsInYaml(text), {
    findings: [{ file: 'a.js', summary: 'boom' }],
    summary: 'one defect found',
  });
});

test('a bracketed JSON reply is not YAML-shaped', () => {
  assert.equal(findingsInYaml(payload()), null);
});

test('trailing prose after the list is a flat reject, not a partial list', () => {
  const text = ['findings:', '  - file: a.js', '    summary: boom', '', 'That is everything I found.'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a nested list inside an item is a flat reject', () => {
  const text = ['findings:', '  - file: a.js', '    summary: boom', '    - nested: oops'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a value starting with [ is a flow collection and a flat reject', () => {
  const text = ['findings:', '  - file: a.js', '    evidence: [1, 2, 3]', '    summary: boom'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a value starting with { is a flow collection and a flat reject', () => {
  const text = ['findings:', '  - file: a.js', '    summary: { not: "this" }'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a flow-collection-shaped TRAILING top-level summary is also a flat reject', () => {
  // The trailing `summary:` branch used to take its value with no leading-bracket
  // check at all, unlike every item field.
  const text = ['findings:', '  - file: a.js', '    summary: boom', 'summary: { oops: 1 }'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a bracket embedded after other scalar text does not disqualify the document', () => {
  const text = [
    'findings:',
    '  - file: a.js',
    '    summary: found a { in the config on line 3',
  ].join('\n');
  assert.deepEqual(findingsInYaml(text), {
    findings: [{ file: 'a.js', summary: 'found a { in the config on line 3' }],
  });
});

test('more than 200 items is a flat reject', () => {
  const lines = ['findings:'];
  for (let index = 0; index < 201; index += 1) lines.push(`  - file: f${index}.js`);
  assert.equal(findingsInYaml(lines.join('\n')), null);
});

test('exactly 200 items still parses', () => {
  const lines = ['findings:'];
  for (let index = 0; index < 200; index += 1) lines.push(`  - file: f${index}.js`);
  const parsed = findingsInYaml(lines.join('\n'));
  assert.equal(parsed.findings.length, 200);
});

test('more than 20 fields on one item is a flat reject', () => {
  const lines = ['findings:', '  - file: a.js'];
  for (let index = 0; index < 20; index += 1) lines.push(`    field${index}: v`);
  assert.equal(findingsInYaml(lines.join('\n')), null);
});

test('exactly 20 fields on one item still parses', () => {
  const lines = ['findings:', '  - file: a.js'];
  for (let index = 0; index < 19; index += 1) lines.push(`    field${index}: v`);
  const parsed = findingsInYaml(lines.join('\n'));
  assert.notEqual(parsed, null);
  assert.equal(Object.keys(parsed.findings[0]).length, 20);
});

test('never throws, including on empty and garbage input', () => {
  assert.equal(findingsInYaml(''), null);
  assert.equal(findingsInYaml('   \n  '), null);
  assert.equal(findingsInYaml('\x00\x01binary garbage\xff'), null);
  assert.equal(findingsInYaml(null), null);
  assert.equal(findingsInYaml(undefined), null);
  assert.equal(findingsInYaml(42), null);
});

test('a value starting with # (a YAML comment) is a flat reject, not literal text', () => {
  // A leading '#' used to be accepted and kept verbatim as if it were the real
  // scalar, e.g. "summary: # comment" parsed to summary: "# comment".
  const text = ['findings:', '  - file: a.js', '    summary: # comment'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a single __proto__ field key is a flat reject, not a silent drop', () => {
  // Assigning a string to item.__proto__ is a silent no-op, never an own
  // property — so it would otherwise defeat the duplicate-key fix below
  // (Object.hasOwn never sees it as already set) and silently drop the field.
  const text = ['findings:', '  - file: a.js', '    __proto__: evil', '    summary: boom'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a repeated __proto__ field key is a flat reject too', () => {
  const text = ['findings:', '  - file: a.js', '    __proto__: one', '    __proto__: two'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a repeated field key on one item is a flat reject, not a silent overwrite', () => {
  // The earlier code let a repeated key overwrite the first value silently, and
  // also bypass MAX_FIELDS_PER_ITEM (which counted distinct keys, not field
  // lines).
  const text = ['findings:', '  - file: a.js', '    file: b.js', '    summary: boom'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('a quoted scalar value is a flat reject, not read literally with its quotes', () => {
  const text = ['findings:', '  - file: "a.js"', '    summary: boom'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

test('an anchor/alias/tag/block-scalar-leading value is a flat reject', () => {
  for (const value of ['&anchor x', '*alias', '!tag x', '|', '>']) {
    const text = ['findings:', '  - file: a.js', `    summary: ${value}`].join('\n');
    assert.equal(findingsInYaml(text), null, `expected reject for value: ${value}`);
  }
});

test('a continuation indent that does not textually extend the item indent is a flat reject', () => {
  // Comparing indent by LENGTH alone let a tab-indented continuation pass as a
  // "deeper" indent under a space-indented item, which is not a consistent
  // single indentation scheme. Three tabs (length 3) is longer than the
  // two-space item indent (length 2) but is not a textual extension of it —
  // the length-only check would have wrongly accepted this as a valid
  // continuation.
  const text = ['findings:', '  - file: a.js', '\t\t\tsummary: boom'].join('\n');
  assert.equal(findingsInYaml(text), null);
});

// A document that is BOTH whole-document YAML-shaped AND contains a genuinely
// balanced, findings-shaped JSON object embedded in a value (not leading it,
// so it does not trip the leading-bracket rule). The YAML reading and a
// JSON-bracket-scan reading of the embedded object disagree on which finding
// comes out, so which one wins is directly observable.
const DISCRIMINATING_TEXT = [
  'findings:',
  '  - file: a.js',
  '    line: 1',
  '    summary: see {"findings": [{"file": "b.js", "line": 99, "summary": "decoy"}]} for detail',
].join('\n');

const DECOY_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
        },
        required: ['file', 'line', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

test('unstructured: the YAML reading wins precedence over an embedded JSON candidate', () => {
  const parsed = parseFindings({ content: DISCRIMINATING_TEXT, reasoning: '' }, { structured: false });
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, 'a.js');
});

test('structured: the YAML acceptor never runs, and extractJson finds the embedded object', () => {
  const parsed = parseFindings(
    { content: DISCRIMINATING_TEXT, reasoning: '' },
    { structured: true, schema: DECOY_SCHEMA },
  );
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, 'b.js');
  assert.equal(parsed.findings[0].line, 99);
});

test('a bracketed JSON reply is unaffected by the new acceptor (no regression)', () => {
  // Comparing two calls of the same function to each other cannot fail
  // regardless of any regression. Pinned against the actual expected shape
  // `extractJson` has always produced for this fixture instead — findingsInYaml
  // never runs at all for a bracketed reply (checked directly), and
  // parseFindings' output matches FINDING byte for byte.
  assert.equal(findingsInYaml(payload()), null);
  const parsed = parseFindings({ content: payload(), reasoning: '' }, { structured: false });
  assert.deepEqual(parsed, {
    findings: [{ file: 'a.js', line: 3, severity: 'high', summary: 'boom', evidence: 'x()' }],
    dropped: 0,
    atCap: false,
    analysisCut: false,
    analysisLength: 17,
    analysisCap: null,
    summary: 'one defect',
  });
});
