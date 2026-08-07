// Which text in a chat completion is read as findings, and what shape counts as
// findings at all. Split out of `structured.test.js` when this feature's repairs
// pushed that file past the size budget — the two subjects had already come
// apart: what a strict schema must LOOK like, and how a reply is READ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFindings } from '../scripts/lib/structured.mjs';
import { REVIEW_SCHEMA } from '../scripts/lib/review-schema.mjs';

import { FINDING, payload } from './findings-fixtures.mjs';

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

test('under a schema, unusable content falls through to a conforming reasoning payload', () => {
  // THE witness for the feature's headline behaviour, and it was written wrong
  // the first time: `content` was `'.' + payload()`, which `extractJson` reads
  // straight out of `content` by scanning for a balanced object — so the
  // fallback was never reached and the test passed against the code it was
  // supposed to replace. A check that cannot fail.
  //
  // `content` must therefore contain NO brace at all, asserted rather than
  // eyeballed: `extractJson` tries the whole text, the fence, and then EVERY
  // balanced object in turn, and this repo's system prompt asks the model to
  // quote source lines — so prose here routinely carries braces.
  const unusable = 'I read the diff and I am not confident enough to report anything.';
  assert.ok(!unusable.includes('{'), 'the fixture must not contain a candidate for extractJson');

  const parsed = parseFindings({ content: unusable, reasoning: payload() }, { structured: true, schema: REVIEW_SCHEMA });
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, 'a.js');
});

test('a list of things that are not findings is unreadable, not a clean review', () => {
  // `[]` means the model looked and found nothing. A non-empty list none of
  // whose entries survives normalization means it answered and we cannot read
  // the answer — reporting that as "no defects reported" is trap instance 14
  // inverted, and it is what accepting bare arrays would otherwise have
  // introduced for a spelling that previously failed loudly.
  const junk = [{ severity: 'low', summary: 'vague' }, { file: '', summary: '' }];
  assert.equal(parseFindings({ content: JSON.stringify(junk), reasoning: '' }, { structured: false }), null);

  // The SAME verdict for the wrapped spelling, which is the whole point: the
  // repair must not depend on which of the two the model happened to emit.
  assert.equal(parseFindings({ content: JSON.stringify({ findings: junk }), reasoning: '' }, { structured: false }), null);

  // And one survivor is enough to make it a review again.
  const mixed = parseFindings({ content: JSON.stringify([FINDING, ...junk]), reasoning: '' }, { structured: false });
  assert.equal(mixed.findings.length, 1);
  assert.equal(mixed.dropped, 2);
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
  // This predates the ordered-attempt loop and is now the ONLY thing pinning
  // candidate order: the other channel tests all have exactly one channel that
  // can win, so they would pass just as happily against `[reasoning, content]`.
  // Reorder that list and this is the single test that goes red.
  const parsed = parseFindings(
    { content: payload([{ ...FINDING, file: 'real.js' }]), reasoning: payload([{ ...FINDING, file: 'scratch.js' }]) },
    { structured: true, schema: REVIEW_SCHEMA },
  );
  assert.equal(parsed.findings[0].file, 'real.js');
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

test('a conforming answer that is unreadable stops the search rather than falling through', () => {
  // The regression the all-dropped rule itself introduced. `findingsIn` returned
  // null both for "nothing here" and for "answered, and the answer is
  // unreadable", so the loop treated the second as the first: a schema-CONFORMING
  // `content` payload whose findings all normalize away handed the review over to
  // whatever sat in `reasoning` — which, under a server that ignored the schema,
  // is a draft. The primary answer must refuse, loudly, on its own behalf.
  // Fully schema-conforming — every required key, valid enum — and every entry
  // normalizes away. Anything less and this test would pass for the wrong
  // reason: a non-conforming payload is a `NO_PAYLOAD`, which SHOULD fall through.
  const empty = { file: '', line: 1, severity: 'low', summary: '', evidence: '' };
  const unreadable = JSON.stringify({ analysis: 'a', findings: [empty], summary: 's' });
  assert.equal(
    parseFindings({ content: unreadable, reasoning: payload() }, { structured: true, schema: REVIEW_SCHEMA }),
    null,
  );

  // And the fall-through still works when `content` genuinely carries nothing —
  // otherwise this guard would have been a reversal of the feature.
  const parsed = parseFindings({ content: '   ', reasoning: payload() }, { structured: true, schema: REVIEW_SCHEMA });
  assert.equal(parsed.findings.length, 1);
});

test('an array wrapped in prose is the same reply as an object wrapped in prose', () => {
  // The scan anchored on `{`, so this yielded the first ELEMENT — which has no
  // `findings` key — and a recoverable reply was reported unreadable. The object
  // spelling of the same reply always worked, so the two spellings agreed only
  // for bare and fenced text.
  const asArray = parseFindings({ content: `Here are the findings:\n${JSON.stringify([FINDING])}`, reasoning: '' }, { structured: false });
  const asObject = parseFindings({ content: `Here are the findings:\n${JSON.stringify({ findings: [FINDING] })}`, reasoning: '' }, { structured: false });
  assert.equal(asArray?.findings.length, 1);
  assert.deepEqual(asArray, asObject, 'prose wrapping must not make one spelling unreadable');
});

// The system prompt orders the model to quote the offending source line, so a
// reply routinely carries bracketed code BEFORE its real answer. Scanning arrays
// as well as objects made four different quoted shapes outrank the payload, each
// failing a different way. All four are pinned here because the single witness
// that used to stand for the class quoted `["alpha","beta"]` — an array of
// STRINGS, the one element type the predicate already rejected — so it passed
// without ever reaching the case that mattered.
const REAL = JSON.stringify({ analysis: 'a', findings: [FINDING], summary: 'one defect' });

for (const [name, quoted, wrong] of [
  ['an array of strings', 'const names = ["alpha", "beta"];', 'the original witness, kept'],
  ['an EMPTY array', 'const names = [];', 'accepted vacuously, and reported a CLEAN REVIEW'],
  ['an array of unnamed objects', 'const rules = [{"id":1},{"id":2}];', 'every element dropped, so the reply read as unreadable'],
  ['an array of NAMED objects', 'const CASES = [{"file":"x.js","summary":"quoted from the test"}];', 'a confident wrong answer: the decoy was reported as the sole finding'],
  ['a sample findings wrapper', 'reply like {"findings":["hello","world"]}', 'the wrapped spelling never checked its own items'],
]) {
  test(`quoted ${name} does not outrank the real payload`, () => {
    const parsed = parseFindings({ content: `The code reads:\n\n${quoted}\n\nwhich is wrong.\n\n${REAL}`, reasoning: '' }, { structured: false });
    assert.ok(parsed, `expected the real payload, not null — ${wrong}`);
    assert.equal(parsed.findings.length, 1, `expected exactly the real finding — ${wrong}`);
    assert.equal(parsed.findings[0].file, 'a.js', `expected the real finding, not the decoy — ${wrong}`);
  });
}

test('a decoy array does not outrank a payload that is ALSO a bare array', () => {
  // The case that proves the predicate is load-bearing, found by mutating it and
  // watching nothing go red. Every witness above survives a generous predicate,
  // because the real payload is a `{findings: […]}` wrapper and objects outrank
  // arrays whatever the predicate says. Here there IS no wrapper — both
  // candidates are arrays — so ranking cannot arbitrate and the predicate is the
  // only thing standing between the reader and the decoy.
  const reply = 'The code reads:\n\nconst rules = [{"id":1},{"id":2}];\n\nwhich is wrong.\n\n' + JSON.stringify([FINDING]);
  const parsed = parseFindings({ content: reply, reasoning: '' }, { structured: false });
  assert.equal(parsed?.findings.length, 1);
  assert.equal(parsed.findings[0].file, 'a.js', 'the decoy array must not win when the payload is a bare array too');
});

// Pass 4's set. Every one of these was a confirmed defect in the previous
// batch's own candidate selection, and each is written so that reverting ITS
// fix alone turns it red — the previous batch's witnesses passed under three
// different mutations of the code they were supposed to guard.
const REAL_ARRAY = JSON.stringify([FINDING]);
const REAL_WRAPPER = JSON.stringify({ analysis: 'a', findings: [FINDING], summary: 'one defect' });
const parse = (content) => parseFindings({ content, reasoning: '' }, { structured: false });

test('a fence must BE the whole reply to be judged as one', () => {
  // `FENCE` matches anywhere, so a model fencing a quoted fixture mid-prose had
  // it accepted under the generous whole-reply rule — skipping the scanned
  // predicate and the ranking both. The empty case is the false-clean again.
  assert.equal(parse(`Fixture:\n\n\`\`\`json\n[{"file":"f.js","summary":"s"}]\n\`\`\`\n\nFindings:\n${REAL_ARRAY}`).findings[0].file, 'a.js');
  assert.equal(parse(`Example:\n\n\`\`\`json\n[]\n\`\`\`\n\n${REAL_WRAPPER}`).findings.length, 1, 'a fenced [] must not read as a clean review');
  // …and a fence that IS the whole reply still gets the generous rule.
  assert.deepEqual(parse('```json\n[]\n```').findings, []);
});

test('a NAMED decoy array does not outrank a payload that is also an array', () => {
  // The case the previous witness missed: it used an unnamed decoy, which the
  // predicate rejects, so it never tested the ranking at all. A named decoy
  // passes the predicate, and then only position can decide.
  const parsed = parse(`I saw \`const CASES = [{"file":"f.js","summary":"s"}];\` then:\n${REAL_ARRAY}`);
  assert.equal(parsed.findings[0].file, 'a.js');
});

// The two tests below decoy AFTER the payload, and that is the whole point of
// them. Ranking takes the last outermost candidate, so a decoy sitting BEFORE
// the answer is rejected by position no matter what the predicate says — both of
// these passed under a mutated predicate when written the obvious way round, and
// were rewritten. Trailing junk is precisely where content has to decide,
// because position now argues for it.
test('a wrapped decoy is held to the same rule as a bare one', () => {
  // The object branch was lenient where the array branch was strict, so a
  // trailing `{"findings":[…]}` example outranks the answer and — its items all
  // dropping — reports the whole reply unreadable.
  assert.equal(parse(`${REAL_ARRAY}\n\nFor example {"findings":[{"note":"eg"}]}`)?.findings[0]?.file, 'a.js');
  // A quoted EMPTY wrapper is the false-clean again, through the spelling the
  // previous batch's fix never touched.
  assert.equal(parse(`${REAL_WRAPPER}\n\nThe shape is {"findings": []}`)?.findings.length, 1, 'a trailing empty wrapper must not read as a clean review');
});

test('a decoy naming only empty strings is not a candidate', () => {
  // `file: ""` is a string. Testing presence rather than content let such a
  // decoy win, drop to nothing, and take the real payload down with it.
  assert.equal(parse(`${REAL_ARRAY}\n\nThe shape is [{"file":"","summary":""}]`)?.findings[0]?.file, 'a.js');
});

test('one malformed entry does not discard its siblings, in any spelling', () => {
  // The guarantee ADR 003 states in its own words: a bare array is the SAME
  // REPLY as `{findings: […]}`. Requiring EVERY element to be named broke it for
  // the prose-wrapped spelling alone, which is why this asserts all three
  // together rather than the repaired one on its own.
  const mixed = [FINDING, { evidence: 'also suspicious' }];
  const expected = { findings: [FINDING], dropped: 1 };
  for (const [spelling, content] of [
    ['prose-wrapped', `Findings: ${JSON.stringify(mixed)}`],
    ['whole reply', JSON.stringify(mixed)],
    ['object-wrapped', JSON.stringify({ findings: mixed })],
  ]) {
    const parsed = parse(content);
    assert.equal(parsed?.findings.length, expected.findings.length, `${spelling}: the valid finding must survive`);
    assert.equal(parsed.dropped, expected.dropped, `${spelling}: the malformed sibling must be counted, not fatal`);
  }
});

test('a wrapper is never replaced by the array nested inside it', () => {
  // What makes "last wins" safe. Every accepted wrapper contains an accepted
  // array — its own `findings` — which starts later, so a global last-candidate
  // rule would return that array and lose `analysis` and `summary` with it.
  const parsed = parse(`Findings:\n${REAL_WRAPPER}`);
  assert.equal(parsed.summary, 'one defect', 'the wrapper must win over its own findings array');
});

test('a bare array that IS the whole reply keeps the generous rule', () => {
  // The strict rule applies only to what the scanner digs out of prose. A whole
  // reply competes with nothing, so an empty one stays a clean review and a list
  // of unnamed objects stays an answer we cannot read — the distinction ADR 003
  // exists to protect. Tightening the scanned case must not reach these.
  assert.deepEqual(parseFindings({ content: '[]', reasoning: '' }, { structured: false }).findings, []);
  assert.equal(parseFindings({ content: '[{"id":1}]', reasoning: '' }, { structured: false }), null);
});
