// Which of several bracketed runs in a model's prose is read as the answer, when
// quoted source and sample shapes compete with the real payload. Split out of
// `findings-shape.test.js` at the size ceiling — that file covers which CHANNEL
// carries a reply and what shape counts as findings; this one covers which
// CANDIDATE within one channel's text wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFindings } from '../scripts/lib/structured.mjs';
import { findingsShaped } from '../scripts/lib/findings-candidate.mjs';

import { FINDING } from './findings-fixtures.mjs';

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
  // The guarantee, in its own words: a bare array is the SAME
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

test('a non-object sibling does not discard the list either, in any spelling', () => {
  // The malformed-object case above didn't cover this: a non-object primitive
  // sibling vetoed the whole candidate under the old `every`-based gate,
  // discarding a real finding sitting right beside it.
  const mixed = [FINDING, 'junk'];
  const expected = { findings: [FINDING], dropped: 1 };
  for (const [spelling, content] of [
    ['prose-wrapped', `Findings: ${JSON.stringify(mixed)}`],
    ['whole reply', JSON.stringify(mixed)],
    ['object-wrapped', JSON.stringify({ findings: mixed })],
  ]) {
    const parsed = parse(content);
    assert.equal(parsed?.findings.length, expected.findings.length, `${spelling}: the valid finding must survive`);
    assert.equal(parsed.dropped, expected.dropped, `${spelling}: the non-object sibling must be counted, not fatal`);
  }
});

test('a malformed field that is truthy but not a string does not crash candidate selection', () => {
  // `item.file?.trim?.()` looks guarded but is not: optional chaining only skips
  // a call on null/undefined, so a truthy non-function `trim` (e.g. an object
  // with its own `trim` key) still gets invoked and throws. That throw used to
  // be unreachable here because the old all-objects gate rejected any list
  // carrying a non-object sibling before `named` ever ran on this element; once
  // that gate was relaxed, a hostile malformed object sitting beside a real
  // finding could crash candidate selection and take the real finding down
  // with it. Explicit `typeof === 'string'` checks close that.
  const mixed = [{ file: { trim: 1 }, summary: 'x' }, 'junk', FINDING];
  const expected = { findings: [FINDING], dropped: 2 };
  for (const [spelling, content] of [
    ['prose-wrapped', `Findings: ${JSON.stringify(mixed)}`],
    ['whole reply', JSON.stringify(mixed)],
    ['object-wrapped', JSON.stringify({ findings: mixed })],
  ]) {
    const parsed = parse(content);
    assert.equal(parsed?.findings.length, expected.findings.length, `${spelling}: the valid finding must survive`);
    assert.equal(parsed.dropped, expected.dropped, `${spelling}: both malformed siblings must be counted, not fatal`);
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
  // of unnamed objects stays an answer we cannot read — the distinction this
  // rule exists to protect. Tightening the scanned case must not reach these.
  assert.deepEqual(parseFindings({ content: '[]', reasoning: '' }, { structured: false }).findings, []);
  assert.equal(parseFindings({ content: '[{"id":1}]', reasoning: '' }, { structured: false }), null);
});

test('findingsShaped itself distinguishes not-a-candidate from a candidate that reads unreadable', () => {
  // `parseFindings` collapses NO_PAYLOAD and UNREADABLE to the same `null`, so
  // a test at that layer cannot prove `[{"id":1},"junk"]` is REJECTED as a
  // candidate (the every(record) boundary holding) rather than merely ending
  // up unreadable for some other reason. Asserted directly against the
  // exported predicate instead.
  assert.equal(findingsShaped([{ id: 1 }], true), true, 'an all-object, none-named whole list is still a candidate — it reads unreadable downstream, not absent');
  assert.equal(findingsShaped([{ id: 1 }, 'junk'], true), false, 'adding a non-object sibling with nothing named anywhere makes it NOT a candidate at all — the every(record) boundary');
  assert.equal(findingsShaped([FINDING, 'junk'], true), true, 'a non-object sibling beside a genuinely named finding IS a candidate — the some(named) fix');
  assert.equal(findingsShaped([1, 2, 3], true), false, 'an all-primitive whole list is not a candidate');
  assert.equal(findingsShaped([], true), true, 'an empty whole list is a candidate — the clean-review case');
});

test('a whole-reply array does not preempt recovery of a valid wrapper nested inside it', () => {
  // A whole array containing SOME real object (but none of them named) used to
  // win as the candidate over the wrapper nested inside one of its elements,
  // then normalize to nothing and report unreadable — discarding a finding a
  // rejected outer array would have let a later scan recover from the wrapper.
  // `usable` for a whole reply now requires either every element be a real
  // object (the original gate, still covering the pure-unnamed-objects case
  // above) or some element be a genuinely named finding — a wrapper alone
  // satisfies neither, so the outer array is correctly not a candidate here.
  const wrapper = JSON.stringify({ findings: [FINDING], summary: 'one defect' });
  const parsed = parse(`[${wrapper}, "junk"]`);
  assert.deepEqual(parsed?.findings, [FINDING], 'the wrapper nested inside the rejected outer array must still be found');
});

test('a fully-formed trailing decoy still wins on position — accepted, not a defect', () => {
  // Content alone cannot distinguish a one-finding real reply from a
  // one-finding decoy; only position tries, and a decoy that TRAILS the real
  // payload wins there. Pinned so this known, accepted trade cannot silently
  // regress into "found" or "fixed" without anyone noticing the change.
  const real = JSON.stringify({ findings: [FINDING], summary: 'the real one' });
  const decoy = JSON.stringify([{ file: 'fake.js', summary: 'fake' }]);
  const parsed = parse(`${real}\n\nAlso note: ${decoy}`);
  assert.deepEqual(
    parsed?.findings,
    [{ file: 'fake.js', line: null, severity: 'medium', summary: 'fake', evidence: '' }],
    'a trailing well-formed decoy wins on position, by design',
  );
});

// Pass 5's set. Two of these guard behaviour the pass repaired; three guard
// behaviour that was already CORRECT and that no test could distinguish from
// its own negation — found by mutating the previous batch's fixes rather than
// by reading them. Each is written so that exactly ONE mutation turns it red.

test('an unmatched bracket in quoted source does not hide the payload after it', () => {
  // `balanced` reported "this opener never closes" as the same null it uses for
  // "no opener left", so `scanFor` read one dead start position as exhaustion of
  // the whole bracket type and stopped — losing every later candidate.
  const parsed = parse(`see line [42 and then:\n${REAL_ARRAY}`);
  assert.deepEqual(parsed.findings, [FINDING]);
});

test('a bracket inside a quoted string does not hide the wrapper after it', () => {
  // A DIFFERENT mechanism reaching the same dead end, and the reason the fix is
  // "skip this start position" rather than "handle unbalanced input": `balanced`
  // enters at the first `open` with quote-tracking off whatever the real state,
  // so a `{` inside a string is entered as JSON and the string's closing quote
  // then swallows the rest of the reply.
  const parsed = parse(`analysis says "assume x { y" then real data:\n${REAL_WRAPPER}`);
  // The wrapper must win, not the bare `findings` array nested inside it — the
  // array scan finds that independently, so asserting non-empty findings alone
  // would pass while `analysis` and `summary` were silently lost.
  assert.equal(parsed.summary, 'one defect');
  assert.deepEqual(parsed.findings, [FINDING]);
});

test('a wrapper inside an array is not mistaken for a finding', () => {
  // `named` was OR, so a wrapper was named by its own `summary`; the array was
  // accepted, containment absorbed the wrapper as a PART of it, and the real
  // findings inside were lost. Requires AND — this is the conjunction's witness
  // and the empty-string one below cannot stand for it, since `"" || ""` and
  // `"" && ""` are alike false.
  const parsed = parse(`Here are the findings: ${JSON.stringify([JSON.parse(REAL_WRAPPER)])}`);
  assert.deepEqual(parsed.findings, [FINDING]);
});

test('a whitespace-only decoy trailing the payload is not a candidate', () => {
  // `named` trims. Every other decoy fixture uses `""`, which is falsy without
  // trimming, so plain truthiness passed the whole suite identically — this is
  // the only witness that separates them. It must TRAIL the payload: leading
  // decoys are refused by position regardless of what the predicate says.
  const parsed = parse(`Findings:\n${REAL_ARRAY}\n\ne.g. [{"file":"   ","summary":"   "}]`);
  assert.deepEqual(parsed.findings, [FINDING]);
});

test('a payload nested inside a rejected candidate of the SAME type is still found', () => {
  // `scanFor` resumes at `run.start + 1`, not past the rejected span, so a
  // same-type nesting can still be re-entered. The existing wrapper test only
  // exercises CROSS-type nesting, which the independent array scan handles, so
  // it cannot tell this apart from skipping the whole span.
  const parsed = parse(`noise [[{"file":"a.js","summary":"boom"}]] more noise`);
  assert.deepEqual(parsed.findings.map((f) => f.file), ['a.js']);
});

test('a prose-wrapped CLEAN review is deliberately unreadable, not clean', () => {
  // Not a defect — a chosen failure. `Here are the findings: {"findings":[]}` is
  // byte-identical to a quoted empty-findings example, and accepting it would
  // let a TRAILING quoted empty beat real findings and report a silent clean
  // review. Unreadable is visible and retryable; false-clean is neither. If this
  // goes red because someone relaxed the rule, understand it before changing it.
  assert.equal(parse('Here are the findings: {"findings":[]}'), null);
  // The same bytes as the WHOLE reply stay a clean review — that is the boundary.
  assert.deepEqual(parse('{"findings":[]}').findings, []);
});
