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

test('every string and array in the schema carries a ceiling', () => {
  // The confirmed defect class, promoted from a comment to a guard: an
  // unbounded field is a runaway waiting to happen, and one measured run
  // generated all 16,384 tokens it was allowed and returned nothing (ADR 004).
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

test('under a schema, the reasoning channel carries the payload', () => {
  // The constrained grammar leaves the model unable to close its think block,
  // so this is the normal case, not the exception.
  const parsed = parseFindings({ content: '', reasoning: payload() }, { structured: true, schema: REVIEW_SCHEMA });
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, 'a.js');
});

test('without a schema, the reasoning channel is never read', () => {
  // That text is the model's scratchpad. Presenting it as an answer is the
  // defect class this repo keeps re-finding.
  assert.equal(parseFindings({ content: '', reasoning: payload() }, { structured: false }), null);
});

test('without a schema, unparseable content does not fall through to reasoning', () => {
  // The discriminating form of the test above, and the mutation target. With a
  // BLANK content the guarantee could also be met by accident — an early return
  // on empty text would satisfy it without any channel list. Here `content` is
  // perfectly non-empty and merely unparseable, so the only thing that keeps
  // the scratchpad out of the answer is `reasoning` not being a candidate.
  assert.equal(
    parseFindings({ content: 'I looked at the diff and here is what I think.', reasoning: payload() }, { structured: false }),
    null,
  );
});

test('under a schema, a stray character in content no longer buries the payload', () => {
  // The old code chose the channel before parsing — `content` unless it was
  // blank — so a single leading character discarded a conforming reply.
  const parsed = parseFindings({ content: `.${payload()}`, reasoning: payload() }, { structured: true, schema: REVIEW_SCHEMA });
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, 'a.js');
});

test('the schema fallback cannot become a scratchpad channel', () => {
  // Reaching `reasoning` is gated on conformance, not on `content` having
  // failed: a non-conforming draft there is still refused outright.
  const draft = JSON.stringify({ findings: [{ file: 'a.js', summary: 'maybe' }] });
  assert.equal(
    parseFindings({ content: 'not json at all', reasoning: draft }, { structured: true, schema: REVIEW_SCHEMA }),
    null,
  );
});

test('content wins over reasoning when both are present', () => {
  const parsed = parseFindings(
    { content: payload([{ ...FINDING, file: 'real.js' }]), reasoning: payload([{ ...FINDING, file: 'scratch.js' }]) },
    { structured: true, schema: REVIEW_SCHEMA },
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
  const rejection = Object.assign(new Error("'response_format.type' must be 'json_schema' or 'text'"), { status: 400 });
  assert.equal(isFormatRejection(rejection), true);

  // A 400 about anything else is a real error the user must see.
  assert.equal(isFormatRejection(Object.assign(new Error('model not found'), { status: 400 })), false);
  // A server that fails while generating has already accepted the format.
  assert.equal(isFormatRejection(Object.assign(new Error('response_format failed'), { status: 500 })), false);
  assert.equal(isFormatRejection(new Error('connection refused')), false);
});

test('a bare top-level array is the same reply as {findings: [...]}, field for field', () => {
  // It used to be discarded and reported as "no findings in the requested
  // shape", so a review that found two defects said it had found nothing
  // readable. Asked for findings in prose — the default since ADR 003's
  // amendment — a model answers with a bare array about as readily as with the
  // wrapper, so this was reachable on every ordinary review.
  //
  // Asserted as EQUIVALENCE rather than as "the array works", because the defect
  // this repair must not reintroduce is the two spellings diverging somewhere
  // downstream: `dropped`, the cap diagnostics and `summary` all have to come
  // out identical, not merely both non-null.
  const findings = [FINDING, { ...FINDING, line: 9, summary: 'second' }];
  const asArray = parseFindings({ content: JSON.stringify(findings), reasoning: '' }, { structured: false });
  const asObject = parseFindings({ content: JSON.stringify({ findings }), reasoning: '' }, { structured: false });

  assert.deepEqual(asArray, asObject, 'one spelling of a reply must not score differently from the other');
  assert.equal(asArray.findings.length, 2);
  assert.equal(asArray.findings[1].summary, 'second');
});

test('a bare empty array is a CLEAN review, not an unreadable one', () => {
  // The distinction the `--json` contract rests on, in its cheapest form: a
  // model that genuinely found nothing says so with `[]`, and that is a result.
  // `null` would report the run as unparseable and lose a real verdict.
  const parsed = parseFindings({ content: '[]', reasoning: '' }, { structured: false });
  assert.notEqual(parsed, null, 'an empty array is an answer, not a failure to answer');
  assert.deepEqual(parsed.findings, []);
  assert.equal(parsed.dropped, 0);
});

test('a fenced bare array parses, because the fence is the shape models actually emit', () => {
  const fenced = '```json\n' + JSON.stringify([FINDING]) + '\n```';
  const parsed = parseFindings({ content: fenced, reasoning: '' }, { structured: false });
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].summary, 'boom');
});

test('accepting arrays does NOT turn unreadable prose into a clean review', () => {
  // The guard on the repair. `findings: null` means nothing could be read;
  // `findings: []` means it was read and was empty. Widening what parses must
  // not widen it to text carrying no JSON at all — that collapse is the exact
  // failure `tests/review-json.test.js` pins at the report level.
  assert.equal(parseFindings({ content: 'I could not comply.', reasoning: '' }, { structured: false }), null);
  assert.equal(parseFindings({ content: '   ', reasoning: '' }, { structured: false }), null);
});
