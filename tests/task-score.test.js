// The task scorer: what an answer demonstrated, and what that does not prove.
//
// Driven by the four canonical answers Codex's design asks every marker scorer
// to pin — exact, partial, contradictory, missed — using the real answers ADR 016
// recorded, so the fixtures are transcripts rather than inventions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARKER_LIMITS, PROFILES, profileOf, scoreAnswer, tallyArm } from '../bench/lib/task-score.mjs';

const CLAIMS = [
  { id: 'site', any: ['TEMPLATES[name]', 'bracket notation', 'direct lookup'] },
  {
    id: 'mechanism',
    any: ['prototype', 'inherited'],
    contradictions: ['is not a security', 'no such risk'],
  },
  { id: 'remedy', any: ['Object.hasOwn', 'hasOwnProperty', 'Object.create(null)'] },
];

// The real pointed-arm reply from ADR 016's evaluation, abridged.
const EXACT = `Passing an unsanitized CLI string directly into resolveTemplate as an object key relies on
bracket notation for existence checks. In JavaScript this is a known prototype pollution vector. If the
flag contains __proto__ or constructor, TEMPLATES[name] returns inherited properties. Whether
Object.hasOwn(TEMPLATES, name) is used instead of direct bracket notation.`;

// The real NEUTRAL reply, which found none of it.
const MISSED = `The plan to ship registry.mjs as-is is rigid because it hardcodes the TEMPLATES object and
provides no extension mechanism. Any addition of new templates requires modifying the source directly.`;

test('an answer naming every claim scores exact', async () => {
  const { byClaim, profile } = scoreAnswer(EXACT, CLAIMS);
  assert.equal(profile, 'exact');
  assert.deepEqual(byClaim.map((c) => c.id), ['site', 'mechanism', 'remedy']);
  assert.ok(byClaim.every((c) => c.hit));
});

test('the real neutral reply scores missed, which is the finding ADR 016 recorded', async () => {
  const { profile, byClaim } = scoreAnswer(MISSED, CLAIMS);
  assert.equal(profile, 'missed');
  // It does mention TEMPLATES, but not as a lookup site — the markers are chosen
  // so that naming the identifier is not the same as naming the defect.
  assert.ok(!byClaim.find((c) => c.id === 'mechanism').hit);
  assert.ok(!byClaim.find((c) => c.id === 'remedy').hit);
});

test('naming some claims and not others scores partial, and the VECTOR says which', async () => {
  const partial = 'The lookup uses bracket notation, which I would replace with Object.hasOwn.';
  const { profile, byClaim } = scoreAnswer(partial, CLAIMS);
  assert.equal(profile, 'partial');
  assert.deepEqual(
    byClaim.map((c) => [c.id, c.hit]),
    [['site', true], ['mechanism', false], ['remedy', true]],
  );
});

test('an affirmatively WRONG claim is contradicted, not merely missed', async () => {
  // ADR 016's zsh answer named the right site and the wrong mechanism. Collapsing
  // that into "miss" would lose the most informative thing about it, and a wrong
  // assertion costs a reader more than silence because it has to be disproved.
  const wrong = 'TEMPLATES[name] is fine here — this is not a security concern in practice.';
  const { profile, byClaim } = scoreAnswer(wrong, CLAIMS);
  assert.equal(profile, 'contradicted');
  assert.ok(byClaim.find((c) => c.id === 'mechanism').contradicted);
});

test('contradiction outranks a full house, so a wrong mechanism cannot score exact', async () => {
  const mixed = `${EXACT} That said, this is not a security concern.`;
  assert.equal(scoreAnswer(mixed, CLAIMS).profile, 'contradicted');
});

test('matching is whitespace- and case-insensitive, so a reflowed reply still counts', async () => {
  const reflowed = 'the lookup relies on\n   BRACKET   NOTATION\nand should use object.hasown instead, since\nprototype members leak through';
  assert.equal(scoreAnswer(reflowed, CLAIMS).profile, 'exact');
});

test('an empty claim list is missed, never vacuously exact', async () => {
  // `[].every()` is true, which is how a sweep reports success from no evidence —
  // the same trap bench/lib/ttl-verdict.mjs names.
  assert.equal(profileOf([]), 'missed');
  assert.equal(scoreAnswer('anything at all', []).profile, 'missed');
});

test('a tally counts every profile and reports runs that produced no score', async () => {
  const runs = [
    { score: { profile: 'exact' } },
    { score: { profile: 'partial' } },
    { score: { profile: 'missed' } },
    { error: true },
  ];
  const { counts, scored, failed } = tallyArm(runs);
  assert.equal(scored, 3);
  assert.equal(failed, 1, 'a failed run is missing data, never an observed miss');
  assert.equal(counts.exact, 1);
  assert.equal(counts.contradicted, 0);
  assert.deepEqual(Object.keys(counts).sort(), [...PROFILES].sort());
});

test('the scorer ships its own limits, so no report can present it as comprehension', async () => {
  assert.ok(MARKER_LIMITS.length >= 3);
  assert.ok(MARKER_LIMITS.some((limit) => /never that it understood/.test(limit)));
  assert.ok(MARKER_LIMITS.some((limit) => /UNDERCOUNTS/.test(limit)));
  // The one that matters most: this is not the gate.
  assert.ok(MARKER_LIMITS.some((limit) => /not the Stage 2 gate/.test(limit)));
});
