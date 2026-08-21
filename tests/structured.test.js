// Getting JSON back out of a reply, and the strict-schema rules that make the
// request valid in the first place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFormatRejection,
  matchesSchema,
  parseFindings,
  responseFormatFor,
} from '../scripts/lib/structured.mjs';
import { MAX_FINDINGS, REVIEW_SCHEMA } from '../scripts/lib/review-schema.mjs';

import { FINDING, payload } from './findings-fixtures.mjs';

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

test('every string and array in the schema carries a ceiling', () => {
  // The confirmed defect class, promoted from a comment to a guard: an
  // unbounded field is a runaway waiting to happen, and one measured run
  // generated all 16,384 tokens it was allowed and returned nothing.
  // A field added later without a cap fails here rather than in production.
  const missing = [];
  const walk = (node, path) => {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.includes('string') && !node.enum && node.maxLength === undefined) missing.push(path);
    if (types.includes('array')) {
      if (node.maxItems === undefined) missing.push(path);
      walk(node.items, `${path}[]`);
    }
    for (const [name, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.${name}`);
  };
  walk(REVIEW_SCHEMA, 'schema');
  assert.deepEqual(missing, []);
});

test('a value over its cap is still findings, not a rejected reply', () => {
  // Deliberate: conformance proves the reply is the constrained payload, and
  // that is settled by types and required keys. The size caps instruct the
  // generator; they are not claims about the payload. A server that accepted
  // the schema and ignored a cap must not have good findings binned for being
  // wordy — so this must keep passing if someone teaches matchesSchema lengths.
  const long = JSON.stringify({
    analysis: 'x'.repeat(REVIEW_SCHEMA.properties.analysis.maxLength + 5000),
    findings: [FINDING],
    summary: 'still usable',
  });
  const parsed = parseFindings({ content: long, reasoning: '' }, { structured: true, schema: REVIEW_SCHEMA });
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.summary, 'still usable');
});

test('a findings list at the cap is flagged, one below it is not', () => {
  // At exactly the cap we cannot tell "found this many" from "found more and
  // was cut", so the caller has to be told. An unreported cut is a real defect
  // silently binned.
  const atCap = parseFindings(
    { content: payload(Array(MAX_FINDINGS).fill(FINDING)), reasoning: '' },
    { structured: true, schema: REVIEW_SCHEMA },
  );
  assert.equal(atCap.atCap, true);

  const under = parseFindings(
    { content: payload(Array(MAX_FINDINGS - 1).fill(FINDING)), reasoning: '' },
    { structured: true, schema: REVIEW_SCHEMA },
  );
  assert.equal(under.atCap, false);
});

test('a list longer than the cap proves nothing was cut, so it is not flagged', () => {
  // Reachable exactly because matchesSchema stays out of the size business: a
  // server that took the schema and ignored maxItems returns more than the cap.
  // Every finding is on screen, so telling the user to review a smaller target
  // to see "the rest" would be a warning about a cut that did not happen.
  const over = parseFindings(
    { content: payload(Array(MAX_FINDINGS + 3).fill(FINDING)), reasoning: '' },
    { structured: true, schema: REVIEW_SCHEMA },
  );
  assert.equal(over.findings.length, MAX_FINDINGS + 3);
  assert.equal(over.atCap, false);
});

test('the cap warning is never raised on the path that has no cap', () => {
  // Without a schema no grammar ran, so a full list was not cut — saying it
  // might have been would report a truncation that cannot have happened.
  const degraded = parseFindings(
    { content: payload(Array(MAX_FINDINGS).fill(FINDING)), reasoning: '' },
    { structured: false },
  );
  assert.equal(degraded.findings.length, MAX_FINDINGS);
  assert.equal(degraded.atCap, false);
});

test('a key named after an Object prototype member is still an extra key', () => {
  // `in` walks the prototype chain, so these passed the extras check — and that
  // check is the proof the text is the constrained payload, not a draft.
  for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    const value = { analysis: 'a', findings: [], summary: 's', [key]: 'smuggled' };
    assert.equal(matchesSchema(value, REVIEW_SCHEMA), false, `${key} must be rejected as an extra key`);
  }
});

test('a cut analysis is flagged, so an empty result cannot pass as a clean one', () => {
  // Bounding `analysis` made a guillotined run *valid*: complete JSON,
  // finish_reason stop, no findings. Without this flag it renders exactly like
  // a review that looked and found nothing.
  const cap = REVIEW_SCHEMA.properties.analysis.maxLength;
  const cut = JSON.stringify({ analysis: 'x'.repeat(cap), findings: [], summary: '' });
  assert.equal(parseFindings({ content: cut, reasoning: '' }, { structured: true, schema: REVIEW_SCHEMA }).analysisCut, true);

  const whole = JSON.stringify({ analysis: 'x'.repeat(cap - 1), findings: [], summary: '' });
  assert.equal(parseFindings({ content: whole, reasoning: '' }, { structured: true, schema: REVIEW_SCHEMA }).analysisCut, false);
});

test('the response_format wrapper asks for strict mode', () => {
  const format = responseFormatFor(REVIEW_SCHEMA, 'review');
  assert.equal(format.type, 'json_schema');
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, 'review');
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
  assert.equal(parseFindings({ content: '', reasoning: draft }, { structured: true, schema: REVIEW_SCHEMA }), null);

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
  assert.equal(parseFindings({ content: '{"verdict":"looks fine"}', reasoning: '' }, { structured: true, schema: REVIEW_SCHEMA }), null);
  assert.equal(parseFindings({ content: 'the code looks fine to me', reasoning: '' }, { structured: true, schema: REVIEW_SCHEMA }), null);
});

test('only a rejection of the format itself triggers the fallback', () => {
  // The refusal wording lives on `.responseBody`, not `.message` —
  // `assertOk()` puts the server's echoed body there so a secret-shaped URL
  // never reaches the persisted `.message`.
  const rejection = Object.assign(new Error('a generic 400'), {
    status: 400,
    responseBody: "'response_format.type' must be 'json_schema' or 'text'",
  });
  assert.equal(isFormatRejection(rejection), true);

  // A 400 about anything else is a real error the user must see.
  assert.equal(
    isFormatRejection(Object.assign(new Error('a generic 400'), { status: 400, responseBody: 'model not found' })),
    false,
  );
  // A server that fails while generating has already accepted the format.
  assert.equal(
    isFormatRejection(
      Object.assign(new Error('a generic 500'), { status: 500, responseBody: 'response_format failed' }),
    ),
    false,
  );
  assert.equal(isFormatRejection(new Error('connection refused')), false);
});
