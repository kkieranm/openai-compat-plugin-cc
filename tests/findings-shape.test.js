// Which text in a chat completion is read as findings, and what shape counts as
// findings at all. Split out of `structured.test.js` when this feature's repairs
// pushed that file past the size budget — the two subjects had already come
// apart: what a strict schema must LOOK like, and how a reply is READ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFindings } from '../scripts/lib/structured.mjs';
import { REVIEW_SCHEMA } from '../scripts/lib/review-schema.mjs';

const FINDING = { file: 'a.js', line: 3, severity: 'high', summary: 'boom', evidence: 'x()' };
const payload = (findings = [FINDING], summary = 'one defect') =>
  JSON.stringify({ analysis: 'checked each path', findings, summary });

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
