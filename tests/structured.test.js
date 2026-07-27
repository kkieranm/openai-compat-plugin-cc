// Getting JSON back out of a reply, and the strict-schema rules that make the
// request valid in the first place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJson,
  isFormatRejection,
  matchesSchema,
  parseFindings,
  responseFormatFor,
  REVIEW_SCHEMA,
} from '../scripts/lib/structured.mjs';

const FINDING = { file: 'a.js', line: 3, severity: 'high', summary: 'boom', evidence: 'x()' };
const payload = (findings = [FINDING], summary = 'one defect') =>
  JSON.stringify({ analysis: 'checked each path', findings, summary });

test('a strict schema declares every property required and forbids extras', () => {
  // OpenAI's strict mode rejects a schema with an optional property, so an
  // absent value must be expressed as a null type. A server that enforces this
  // would reject the whole request, not degrade.
  const walk = (node, path) => {
    if (node.type === 'object') {
      const properties = Object.keys(node.properties ?? {});
      assert.equal(node.additionalProperties, false, `${path}: additionalProperties must be false`);
      assert.deepEqual([...(node.required ?? [])].sort(), properties.sort(), `${path}: every property must be required`);
      for (const [name, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.${name}`);
    }
    if (node.type === 'array') walk(node.items, `${path}[]`);
  };
  walk(REVIEW_SCHEMA, 'schema');
});

test('the response_format wrapper asks for strict mode', () => {
  const format = responseFormatFor(REVIEW_SCHEMA, 'review');
  assert.equal(format.type, 'json_schema');
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, 'review');
});

test('JSON is found bare, fenced, or wrapped in prose', () => {
  assert.equal(extractJson('{"a":1}').a, 1);
  assert.equal(extractJson('```json\n{"a":2}\n```').a, 2);
  assert.equal(extractJson('Here you go:\n{"a":3}\nHope that helps.').a, 3);
  assert.equal(extractJson('no json here'), null);
});

test('a brace inside a string does not end the object early', () => {
  const parsed = extractJson('preamble {"summary":"the } case","findings":[]} trailer');
  assert.equal(parsed.summary, 'the } case');
  assert.deepEqual(parsed.findings, []);
});

test('under a schema, the reasoning channel carries the payload', () => {
  // The constrained grammar leaves the model unable to close its think block,
  // so this is the normal case, not the exception.
  const parsed = parseFindings({ content: '', reasoning: payload() }, { structured: true });
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, 'a.js');
});

test('without a schema, the reasoning channel is never read', () => {
  // That text is the model's scratchpad. Presenting it as an answer is the
  // defect class this repo keeps re-finding.
  assert.equal(parseFindings({ content: '', reasoning: payload() }, { structured: false }), null);
});

test('content wins over reasoning when both are present', () => {
  const parsed = parseFindings(
    { content: payload([{ ...FINDING, file: 'real.js' }]), reasoning: payload([{ ...FINDING, file: 'scratch.js' }]) },
    { structured: true },
  );
  assert.equal(parsed.findings[0].file, 'real.js');
});

test('a finding naming no file or no defect is dropped and counted', () => {
  const parsed = parseFindings(
    { content: payload([FINDING, { severity: 'low', summary: 'vague' }, { file: 'b.js', summary: '' }]), reasoning: '' },
    { structured: false },
  );
  assert.equal(parsed.findings.length, 1, 'unverifiable findings must not be reported as findings');
  assert.equal(parsed.dropped, 2);
});

test('an unknown severity becomes medium rather than being trusted', () => {
  const parsed = parseFindings({ content: payload([{ ...FINDING, severity: 'CRITICAL' }]), reasoning: '' }, { structured: false });
  assert.equal(parsed.findings[0].severity, 'medium');
});

test('a non-numeric line becomes null instead of NaN', () => {
  const parsed = parseFindings({ content: payload([{ ...FINDING, line: 'around 12' }]), reasoning: '' }, { structured: false });
  assert.equal(parsed.findings[0].line, null);
});

test('under a schema, a reply that misses a required key is rejected, not repaired', () => {
  // The schema is the whole proof that the reasoning channel holds the answer
  // rather than a draft, so a near-miss must not be patched up into findings.
  const draft = JSON.stringify({ analysis: 'a', findings: [{ file: 'a.js', summary: 'maybe' }], summary: 'draft' });
  assert.equal(parseFindings({ content: '', reasoning: draft }, { structured: true }), null);

  // Nothing was promised without one, so there repair is the right behaviour.
  const repaired = parseFindings({ content: draft, reasoning: '' }, { structured: false });
  assert.equal(repaired.findings.length, 1);
  assert.equal(repaired.findings[0].severity, 'medium');
});

test('schema conformance is checked against the schema, not a copy of it', () => {
  assert.equal(matchesSchema({ analysis: 'a', findings: [], summary: 'none' }, REVIEW_SCHEMA), true);
  assert.equal(matchesSchema({ analysis: 'a', findings: [] }, REVIEW_SCHEMA), false, 'summary is required');
  assert.equal(matchesSchema({ analysis: 'a', findings: [], summary: 'x', extra: 1 }, REVIEW_SCHEMA), false, 'extras are forbidden');
  assert.equal(
    matchesSchema({ analysis: 'a', findings: [{ ...FINDING, severity: 'catastrophic' }], summary: 'x' }, REVIEW_SCHEMA),
    false,
    'severity is an enum',
  );
  assert.equal(matchesSchema({ analysis: 'a', findings: [{ ...FINDING, line: null }], summary: 'x' }, REVIEW_SCHEMA), true, 'line is nullable');
  assert.equal(matchesSchema({ analysis: 'a', findings: [{ ...FINDING, line: 1.5 }], summary: 'x' }, REVIEW_SCHEMA), false, 'line is an integer');
});

test('a reply without a findings array is not findings', () => {
  assert.equal(parseFindings({ content: '{"verdict":"looks fine"}', reasoning: '' }, { structured: true }), null);
  assert.equal(parseFindings({ content: 'the code looks fine to me', reasoning: '' }, { structured: true }), null);
});

test('only a rejection of the format itself triggers the fallback', () => {
  const rejection = Object.assign(new Error("'response_format.type' must be 'json_schema' or 'text'"), { status: 400 });
  assert.equal(isFormatRejection(rejection), true);

  // A 400 about anything else is a real error the user must see.
  assert.equal(isFormatRejection(Object.assign(new Error('model not found'), { status: 400 })), false);
  // A server that fails while generating has already accepted the format.
  assert.equal(isFormatRejection(Object.assign(new Error('response_format failed'), { status: 500 })), false);
  assert.equal(isFormatRejection(new Error('connection refused')), false);
});
