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
import { emptyFindingsDocument } from '../scripts/lib/findings-empty.mjs';

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

test('a severity with no usable primitive coercion is kept as medium, not thrown', () => {
  const hostile = { toString: null, valueOf: null };
  const parsed = parseFindings({ content: payload([{ ...FINDING, severity: hostile }]), reasoning: '' }, { structured: false });
  assert.equal(parsed.findings[0].severity, 'medium');
});

test('a line with no usable primitive coercion is kept as null, not thrown', () => {
  const hostile = { toString: null, valueOf: null };
  const parsed = parseFindings({ content: payload([{ ...FINDING, line: hostile }]), reasoning: '' }, { structured: false });
  assert.equal(parsed.findings[0].line, null);
});

test('a numeric-string line still resolves to a real line number', () => {
  const parsed = parseFindings({ content: payload([{ ...FINDING, line: '42' }]), reasoning: '' }, { structured: false });
  assert.equal(parsed.findings[0].line, 42);
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

// A model that reviews a diff and finds nothing sometimes answers in whole-document
// YAML-ish prose — `findings: []` then an `analysis:` paragraph — instead of JSON.
// That reply is a clean review, and it used to be discarded as unreadable because no
// bracketed candidate exists for the JSON path and its opener is inline, not the block
// list `findingsInYaml` reads.
const REAL_YAML_REPLIES = {
  'single-line analysis': 'findings: []\nanalysis: The diff implements the cap correctly. No defects found.',
  'analysis carrying a markdown bullet': [
    'findings: []',
    'analysis:',
    'I checked the changed functions:',
    '- addField refuses a repeated key rather than last-write-wins.',
    '- no path constructs a UserError from server content.',
    'No defects found.',
  ].join('\n'),
  'bare opener with no prose tail': 'findings: []',
};

// The one observed clean reply that carries a bracket in prose. It is a genuine
// no-defects review, but its analysis quotes `response_format: {type: "json_schema"}`,
// and the acceptor refuses ANY `[`/`{` past the opener (a bracket is material
// `extractJson` was meant to read and could not — its content is unknown). So this
// reply is read loud-unreadable, not silently clean: the disclosed, fail-closed cost
// of the bracket guard, pinned here rather than left as a surprise. 1 of 15 recorded
// `findings: []` replies trips it; the operator still sees the raw text.
const BRACKET_IN_PROSE_CLEAN_REPLY = [
  'findings: []',
  '',
  'analysis:',
  'The change adds /oai:review and structured output via response_format: {type: "json_schema"}.',
  'No defects were found in the changed code.',
].join('\n');

test('a clean review that quotes a bracket in prose goes loud-unreadable (disclosed cost)', () => {
  assert.equal(emptyFindingsDocument(BRACKET_IN_PROSE_CLEAN_REPLY), null);
  assert.equal(
    parseFindings({ content: BRACKET_IN_PROSE_CLEAN_REPLY, reasoning: '' }, { structured: false }),
    null,
  );
});

for (const [name, reply] of Object.entries(REAL_YAML_REPLIES)) {
  test(`a whole-document empty-findings YAML reply reads as a clean review (${name})`, () => {
    const parsed = parseFindings({ content: reply, reasoning: '' }, { structured: false });
    assert.notEqual(parsed, null, 'a clean review must not be discarded as unreadable');
    assert.deepEqual(parsed.findings, []);
    assert.equal(parsed.summary, '');
  });
}

test('emptyFindingsDocument accepts the observed shapes and refuses everything else', () => {
  // Accepted: an inline empty declaration on line 1, whatever prose follows.
  assert.deepEqual(emptyFindingsDocument('findings: []'), { findings: [] });
  assert.deepEqual(emptyFindingsDocument('findings: []\nanalysis: clean'), { findings: [] });
  assert.deepEqual(emptyFindingsDocument('findings: [ ]\nanalysis: also clean'), { findings: [] });
  // Refused: never a string / empty text.
  assert.equal(emptyFindingsDocument(null), null);
  assert.equal(emptyFindingsDocument('   '), null);
  // Refused: the opener is not on line 1 (embedded mid-prose).
  assert.equal(emptyFindingsDocument('Here is my review.\nfindings: []'), null);
  // Refused: a non-empty inline list is a real finding, not a clean review.
  assert.equal(emptyFindingsDocument('findings: [{"file":"a"}]'), null);
});

test('mutation-1 witness: an arbitrary prose reply with no findings line is unreadable', () => {
  // Its refusal routes SOLELY through the line-1 anchor — findingsInYaml and extractJson
  // both decline (no `findings:` opener, no brackets), and the tail-scan finds nothing.
  // This is the negative that goes red if the anchor is removed.
  const prose = 'The review is complete; no issues were found.';
  assert.equal(emptyFindingsDocument(prose), null);
  assert.equal(parseFindings({ content: prose, reasoning: '' }, { structured: false }), null);
});

test('a real bracketed payload after findings: [] is read by extractJson, not the acceptor', () => {
  // extractJson reads the real named-finding array. The acceptor and extractJson are
  // DISJOINT by construction — the acceptor refuses any `[`/`{` past the opener, so it
  // can only fire on a body extractJson found no candidate in — which is why its
  // position in the chain is no longer load-bearing (the old ordering mutation is inert;
  // the two decline arms below are the real witnesses).
  const reply = `findings: []\n[${JSON.stringify(FINDING)}]`;
  const parsed = parseFindings({ content: reply, reasoning: '' }, { structured: false });
  assert.notEqual(parsed, null);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, FINDING.file);
  // Disjointness stated directly: when the acceptor fires, extractJson found nothing.
  assert.equal(emptyFindingsDocument(reply), null);
});

// A reply that DECLARED findings: [] yet carries a real finding extractJson could not
// read must stay loud-unreadable, never silently clean. These are the bracket-guard's
// reason to exist (OAI-212 Pass 4, F1): each has a bracketed payload extractJson maps
// to null, so pre-guard the acceptor would have read them clean and vanished the finding.
const HIDDEN_FINDING_REPLIES = {
  // Quote-blinded: the unterminated `"` leaves extractJson's scanner in-string, hiding
  // the trailing array.
  'quote-blinded array': 'findings: []\nSource line: doSomething("unterminated\n[{"file":"a.js","summary":"real bug"}]',
  // Bare object, no findings wrapper — extractJson's acceptor rejects it.
  'bare finding object': 'findings: []\nOn reflection:\n{"file":"a.js","summary":"real bug","severity":"high"}',
  // Malformed (unquoted keys) — never JSON.parse-able, so extractJson finds no candidate.
  'malformed object': 'findings: []\nActually:\n{file: "a.js", summary: "real bug"}',
  'malformed array': 'findings: []\nActually:\n[{file: "a.js", summary: "real bug"}]',
  // Truncated mid-finding (unclosed brace) — the token-exhaustion shape.
  'truncated finding': 'findings: []\n{file: "a.js", summary: "real bug"',
};

test('a findings: [] reply carrying a bracketed payload extractJson cannot read is unreadable', () => {
  for (const [name, reply] of Object.entries(HIDDEN_FINDING_REPLIES)) {
    assert.equal(emptyFindingsDocument(reply), null, `${name}: acceptor must refuse`);
    assert.equal(
      parseFindings({ content: reply, reasoning: '' }, { structured: false }),
      null,
      `${name}: whole reply must be loud-unreadable, never clean`,
    );
  }
});

test('a findings: [] opener followed by a second findings declaration is left unreadable', () => {
  // Contradictory: an empty declaration, then a real block of findings. Loud-unreadable
  // is the safe reading — never a silent clean review. The scan is indent-tolerant, so a
  // second declaration nested under another key (a real defect a column-0 scan would have
  // read as clean) is caught too.
  const listForm = 'findings: []\nfindings:\n  - file: a.js\n    summary: real bug';
  const mappingForm = 'findings: []\nfindings:\n  file: a.js\n  summary: real bug';
  const indentedList = 'findings: []\nnotes:\n  findings:\n    - file: a.js\n      summary: real bug';
  const indentedMapping = 'findings: []\nnotes:\n  findings:\n    file: a.js\n    summary: real bug';
  const tabIndented = 'findings: []\n\tfindings:\n\t- file: a.js';
  // A second declaration under a QUOTED key is the same decoy, spelled with quotes.
  // It must be a BLOCK-form body: an inline bracketed `"findings": [{...}]` would be
  // read by extractJson and never reach this acceptor, so it would prove nothing here.
  const doubleQuoted = 'findings: []\nnotes:\n  "findings":\n    - file: a.js\n      summary: real bug';
  const singleQuoted = "findings: []\n'findings':\n  - file: a.js\n    summary: real bug";
  for (const reply of [listForm, mappingForm, indentedList, indentedMapping, tabIndented, doubleQuoted, singleQuoted]) {
    assert.equal(emptyFindingsDocument(reply), null);
    // And end to end: the whole reply is unreadable, not a silent clean review.
    assert.equal(parseFindings({ content: reply, reasoning: '' }, { structured: false }), null);
  }
});

test('an indented non-findings key does not defeat the empty-findings clean review', () => {
  // The reject scan matches the `findings` KEY specifically — plain or paired-quoted,
  // at any indentation — NOT any indented key, and NOT a mismatched quote pair. Without
  // these witnesses, over-widening the scan to `/^\s*\w+\s*:/` (any key) or dropping the
  // quote pairing would go unnoticed.
  const nestedOtherKey = 'findings: []\nanalysis:\n  detail: the diff is clean';
  const indentedSummary = 'findings: []\n  summary: no defects were found';
  // A quoted NON-findings key stays clean (pins "findings, not any quoted key").
  const quotedOtherKey = 'findings: []\n"analysis": the diff is clean';
  // A mismatched quote pair is not a real key spelling, so the doc stays clean (pins
  // the backreference — reds if someone "simplifies" to independent optional quotes).
  const mismatchedQuote = 'findings: []\n\'findings": were all clear';
  for (const reply of [nestedOtherKey, indentedSummary, quotedOtherKey, mismatchedQuote]) {
    assert.deepEqual(emptyFindingsDocument(reply), { findings: [] });
    assert.deepEqual(parseFindings({ content: reply, reasoning: '' }, { structured: false }).findings, []);
  }
});

test('a case-variant Findings: second declaration is accepted-clean residue', () => {
  // The reject scan is case-sensitive on purpose: `Findings:` is a distinct YAML key no
  // reader here treats as findings, and a case-insensitive scan would wrongly reject a
  // clean review whose prose carries a `Findings:` heading — a common shape. So this
  // (contradictory, 0/15) reply is read clean, the disclosed residue. This pins the
  // boundary: a future case-insensitive change reds here and forces a re-decision.
  const caseVariant = 'findings: []\nFindings:\n  - file: a.js\n    summary: real bug';
  assert.deepEqual(emptyFindingsDocument(caseVariant), { findings: [] });
  assert.deepEqual(parseFindings({ content: caseVariant, reasoning: '' }, { structured: false }).findings, []);
});

test('the empty-findings acceptor never runs on the structured path', () => {
  // Under a schema the reply must conform to that schema; a YAML clean-review spelling
  // is not read here. `{findings: []}` also lacks the required analysis/summary, so it is
  // rejected downstream regardless — the gate keeps it off the schema path explicitly.
  const reply = 'findings: []\nanalysis: clean';
  assert.equal(parseFindings({ content: reply, reasoning: '' }, { structured: true, schema: REVIEW_SCHEMA }), null);
});
