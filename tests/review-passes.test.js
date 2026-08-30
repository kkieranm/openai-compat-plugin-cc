// The pure core of multi-pass review: the union, its agreement count, and the
// fail-closed served-model guard. Each rule that the report leans on has a
// mutation proof — a case that RED-fails if the rule is inverted — because an
// agreement count that silently over-merges or a denominator that drops a clean
// pass would corrupt the one signal the feature exists to produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allFailedError, caveatUnion, contextCheckedAll, mergePasses, partitionPasses, passesEnvelope, passesText, servedModelFailure, totalDuration } from '../scripts/lib/review-passes.mjs';
import { lensDirective, parseReviewLenses } from '../scripts/lib/review.mjs';

const finding = (over = {}) => ({ file: 'a.js', line: 10, severity: 'medium', summary: 'a bug', evidence: '', ...over });
const readablePass = (findings) => ({ ok: true, parsed: { findings } });

test('two passes reporting the same file+line merge into one finding with agreement 2', () => {
  // Mutation proof for the dedup key: if the key included the (paraphrased)
  // summary, these two would NOT merge and agreement would read 1/1 twice.
  const merged = mergePasses([
    readablePass([finding({ summary: 'off-by-one in the loop' })]),
    readablePass([finding({ summary: 'the loop overruns by one' })]),
  ]);
  assert.equal(merged.findings.length, 1);
  assert.equal(merged.findings[0].agreement, 2);
  assert.equal(merged.findings[0].readablePasses, 2);
  // Distinct phrasings are retained so a reader can see what each pass said.
  assert.deepEqual(merged.findings[0].summaries, ['off-by-one in the loop', 'the loop overruns by one']);
});

test('a different line at the same file is a different finding', () => {
  const merged = mergePasses([readablePass([finding({ line: 10 }), finding({ line: 20 })])]);
  assert.equal(merged.findings.length, 2);
});

test('one pass reporting the same line twice is still one vote', () => {
  // Mutation proof: agreement counts PASSES, not raw findings — the per-pass
  // `seen` set. Without it a pass double-reporting a line would read agreement 2
  // from a single observation.
  const merged = mergePasses([readablePass([finding({ summary: 'first mention' }), finding({ summary: 'again' })])]);
  assert.equal(merged.findings.length, 1);
  assert.equal(merged.findings[0].agreement, 1);
});

test('an empty pass stays in the denominator as a no-finding vote', () => {
  // Mutation proof for the denominator: a readable-but-empty pass is an
  // observation, so S counts it. Dropping it would turn one hit plus two clean
  // passes into a misleading 1/1.
  const merged = mergePasses([
    readablePass([finding()]),
    readablePass([]),
    readablePass([]),
  ]);
  assert.equal(merged.findings.length, 1);
  assert.equal(merged.findings[0].agreement, 1);
  assert.equal(merged.findings[0].readablePasses, 3);
});

test('null-line findings are never merged with each other', () => {
  // Mutation proof: with no location to anchor on, keying on file+summary would
  // reintroduce the paraphrase problem — so each null-line finding is its own
  // entry, agreement 1, even across passes at the same file.
  const merged = mergePasses([
    readablePass([finding({ line: null, summary: 'somewhere in a.js' })]),
    readablePass([finding({ line: null, summary: 'a.js has a leak' })]),
  ]);
  assert.equal(merged.findings.length, 2);
  assert.deepEqual(merged.findings.map((f) => f.agreement), [1, 1]);
});

test('the highest severity wins on a merge', () => {
  // Mutation proof for severity-max: a low and a high at one location merge to
  // high, never low or "last write wins".
  const merged = mergePasses([
    readablePass([finding({ severity: 'low' })]),
    readablePass([finding({ severity: 'high' })]),
  ]);
  assert.equal(merged.findings[0].severity, 'high');
});

test('partitionPasses splits readable from non-observations', () => {
  const passes = [
    { ok: true, parsed: { findings: [] } }, // readable (empty)
    { ok: true, parsed: null }, // unreadable
    { ok: false, error: new Error('boom') }, // threw
  ];
  const { readable, nonObs } = partitionPasses(passes);
  assert.equal(readable.length, 1);
  assert.equal(nonObs.length, 2);
});

const confirmed = (model) => ({ ok: true, parsed: { findings: [] }, result: { model, requestedModel: model, modelReported: true } });

test('servedModelFailure is null when every readable pass confirmed the same model', () => {
  assert.equal(servedModelFailure([confirmed('qwen-27b'), confirmed('qwen-27b')]), null);
});

test('an unconfirmed served model fails closed', () => {
  // Mutation proof: result.model is the requested id echoed back when
  // modelReported is false, so substitution() sees no mismatch though nothing
  // was confirmed. The confirmation guard is what closes that.
  const pass = { ok: true, parsed: { findings: [] }, result: { model: 'qwen-27b', requestedModel: 'qwen-27b', modelReported: false } };
  const failure = servedModelFailure([confirmed('qwen-27b'), pass]);
  assert.equal(failure?.reason, 'unconfirmed-served-model');
});

test('two passes served different confirmed models fail closed as disagreement', () => {
  // The `served.length > 1` branch: every pass confirmed its model and none is a
  // substitution (each requested===served), but the served models differ across
  // passes — unreachable while one target is shared, reached here directly, and
  // the guard OAI-11's per-pass models will rely on.
  const a = { ok: true, parsed: { findings: [] }, result: { model: 'modelX', requestedModel: 'modelX', modelReported: true } };
  const b = { ok: true, parsed: { findings: [] }, result: { model: 'modelY', requestedModel: 'modelY', modelReported: true } };
  const failure = servedModelFailure([a, b]);
  assert.equal(failure?.reason, 'served-model-disagreement');
  assert.deepEqual(failure.servedModels, { served: ['modelX', 'modelY'] });
});

test('a substituted model fails closed with the ids off the message', () => {
  const pass = { ok: true, parsed: { findings: [] }, result: { model: 'other-model', requestedModel: 'qwen-27b', modelReported: true } };
  const failure = servedModelFailure([pass]);
  assert.equal(failure?.reason, 'served-model-disagreement');
  assert.deepEqual(failure.servedModels, { requested: 'qwen-27b', served: 'other-model' });
  assert.doesNotMatch(failure.message, /other-model|qwen-27b/, 'served ids ride on a field, not the message');
});

test('a caveat true on any readable pass is true for the union', () => {
  // Mutation proof for the fail-closed OR: one truncated pass makes the union
  // read truncated, so an incomplete union can never look clean-and-complete.
  const flags = caveatUnion(
    [{ analysisCut: false, hunksOnly: false }, { analysisCut: true, hunksOnly: false }],
    { unreadable: false },
  );
  assert.equal(flags.analysisCut, true);
  // …and false only when EVERY pass is false.
  const clean = caveatUnion([{ analysisCut: false }, { analysisCut: false }], { unreadable: false });
  assert.equal(clean.analysisCut, false);
});

test('degraded on any readable pass makes the union degraded', () => {
  // Mutation proof for the degraded OR: a union in which any readable pass ran
  // degraded reads degraded, so a bench degradation axis never mistakes it for
  // clean. Reverting the OR drops the key entirely (undefined), reding this.
  const flags = caveatUnion([{ degraded: false }, { degraded: true }], { unreadable: false });
  assert.equal(flags.degraded, true);
  const clean = caveatUnion([{ degraded: false }, { degraded: false }], { unreadable: false });
  assert.equal(clean.degraded, false);
});

test('contextChecked is the AND — unchecked on any pass makes the union unchecked', () => {
  assert.equal(contextCheckedAll([{ contextChecked: true }, { contextChecked: true }]), true);
  assert.equal(contextCheckedAll([{ contextChecked: true }, { contextChecked: false }]), false);
});

test('totalDuration sums EVERY pass, not just readable, and nulls on a non-finite one', () => {
  // Mutation proof for F-dur/ADV2-2: the failed second pass consumed 5s, so the
  // total must include it. A readable-only sum would report 1000, not 6000.
  assert.equal(totalDuration([{ durationMs: 1000 }, { ok: false, durationMs: 5000 }]), 6000);
  // Null, never a partial sum treating a missing duration as zero.
  assert.equal(totalDuration([{ durationMs: 1000 }, { durationMs: Number.NaN }]), null);
});

const textFor = (finding) =>
  passesText(
    { readablePasses: 2, findings: [{ file: 'a.js', line: 10, severity: 'high', evidence: '', agreement: 2, readablePasses: 2, ...finding }] },
    {
      passCount: 2,
      passSummaries: [
        { index: 0, durationMs: 1000, findings: 1, reason: null, servedNote: null },
        { index: 1, durationMs: 1000, findings: 1, reason: null, servedNote: null },
      ],
      caveatFlags: { salvaged: false, analysisCut: false, atCap: false, hunksOnly: false, skippedUnsizedWindow: false, dropped: 0, unreadable: false },
      label: '1 file(s)',
      profile: { name: 'lmstudio' },
      model: 'test-model',
    },
  );

test('a merged finding with differing summaries is marked and shows them all', () => {
  // Mutation proof for the over-merge disclosure (ADV-1): K keys on location, so
  // two passes flagging one line with DIFFERENT descriptions count K=2 though
  // neither corroborated the other. The render must mark that and show both, so K
  // is never read as defect agreement. This asserts the RENDER, not the merge: a
  // merged finding already carries summaries[] regardless of the fix, so only the
  // rendered marker + both summaries reds when the divergence branch is reverted.
  const text = textFor({ summary: 'off-by-one in the index', summaries: ['off-by-one in the index', 'unrelated null-deref on the same line'] });
  assert.match(text, /\[2\/2 passes — summaries differ\]/);
  assert.match(text, /off-by-one in the index/);
  assert.match(text, /unrelated null-deref on the same line/);
});

test('a merged finding with one distinct summary carries no divergence marker', () => {
  const text = textFor({ summary: 'the one defect', summaries: ['the one defect'] });
  assert.match(text, /\[2\/2 passes\]/);
  // The marker itself — not the bare phrase, which the standing disclosure
  // paragraph also contains.
  assert.doesNotMatch(text, /— summaries differ\]/);
});

test('the text report renders a per-pass line for every pass', () => {
  const text = textFor({ summary: 's', summaries: ['s'] });
  assert.match(text, /pass 1: 1\.0s · 1 finding\(s\)/);
  assert.match(text, /pass 2: 1\.0s · 1 finding\(s\)/);
});

const profile = { name: 'lmstudio' };

test('allFailedError takes the reason from the first pass IN ORDER, not the first thrown', () => {
  // Mutation proof for ADV2-1: a leading parse-null token-exhaustion pass sets
  // the run's reason, even though a LATER pass threw. `find(!ok)` would skip the
  // starved pass and report the thrown reason, misclassifying the run for the
  // sweep's `starved` bucket. The classified error is rethrown whole, so its
  // reason (and hint and usage) survive.
  const starved = { ok: true, parsed: null, structured: false, result: { finishReason: 'length', usage: { completion_tokens: 400 } }, ledger: { entries: () => [{ id: 'a1' }] } };
  const thrown = { ok: false, error: Object.assign(new Error('boom'), { reason: 'deadline-timeout' }), ledger: { entries: () => [{ id: 'b1' }] } };
  const error = allFailedError([starved, thrown], profile);
  assert.equal(error.reason, 'token-exhaustion', 'the first pass in order wins, not the thrown one');
  // P-c: attemptRecords span EVERY pass, overwriting the classified error's own
  // single-pass records with the whole-run superset.
  assert.deepEqual(error.attemptRecords, [{ id: 'a1' }, { id: 'b1' }]);
});

test('allFailedError keeps a thrown first pass\'s own error and reason', () => {
  const thrown = Object.assign(new Error('transport'), { reason: 'protocol' });
  const error = allFailedError(
    [
      { ok: false, error: thrown, ledger: { entries: () => [{ id: 'a1' }] } },
      { ok: true, parsed: null, structured: false, result: { finishReason: 'length', usage: {} }, ledger: { entries: () => [{ id: 'b1' }] } },
    ],
    profile,
  );
  assert.equal(error, thrown, 'the first pass threw, so it IS the terminal error');
  assert.equal(error.reason, 'protocol');
  assert.deepEqual(error.attemptRecords, [{ id: 'a1' }, { id: 'b1' }]);
});

test('allFailedError stamps all-passes-unreadable on a reason-less reasoning-only first pass', () => {
  // Mutation proof for F-reason: a reasoning-only first pass (content empty,
  // reasoning present, finish stop) routes through `unparsedReply` to
  // `requireAnswer`, which throws WITHOUT a `reason`. Without the catch-branch
  // fallback the terminal envelope's `reason` reads null for exactly that shape.
  // Reverting `error.reason ??= 'all-passes-unreadable'` reds this to undefined.
  const pass = { ok: true, parsed: null, structured: false, result: { content: '', reasoning: 'a long think with no answer', finishReason: 'stop', usage: { completion_tokens: 300 } }, ledger: { entries: () => [{ id: 'r1' }] } };
  const error = allFailedError([pass], profile);
  assert.equal(error.reason, 'all-passes-unreadable');
});

test('allFailedError synthesizes the whole-run claim for a shape-unreadable first pass', () => {
  // A first pass whose reply is prose (not token-exhausted, not reasoning-only):
  // `unparsedReply` RETURNS it, so no per-pass reason applies and the honest
  // top-level claim is the whole-run `all-passes-unreadable`, never a per-pass
  // `unreadable`.
  const pass = { ok: true, parsed: null, structured: false, result: { content: 'looks fine to me', reasoning: '', finishReason: 'stop' }, ledger: { entries: () => [{ ok: true }] } };
  const synth = allFailedError([pass], profile);
  assert.equal(synth.reason, 'all-passes-unreadable');
  // errorReport reads `error.attemptRecords` for its `attempts` field — the
  // OAI-116 regression is a null there on the dominant failure mode.
  assert.deepEqual(synth.attemptRecords, [{ ok: true }], 'the ledger entries ride the error so errorReport.attempts is not null');
});

// ---------------------------------------------------------------------------
// LENS PROVENANCE (OAI-11): each finding is attributed to the lens that produced
// it, BY VALUE off the pass, never by an index into the compacted readable array.

const lensPass = (lens, findings) => ({ ok: true, lens, parsed: { findings } });

test('a merged finding carries the lenses of every pass that flagged it, by value', () => {
  const merged = mergePasses([
    lensPass('correctness', [finding({ summary: 'off-by-one' })]),
    lensPass('security', [finding({ summary: 'unsanitised input reaches the same line' })]),
  ]);
  assert.equal(merged.findings.length, 1);
  assert.deepEqual(merged.findings[0].lenses, ['correctness', 'security']);
});

test('lens provenance survives a failed MIDDLE pass — attribution is by value, not compacted index', () => {
  // The discriminating test named in the plan. `reportPasses` compacts the
  // readable passes before `mergePasses`, so the array here is the two SURVIVORS
  // of a three-lens run whose middle (security) pass failed: correctness (orig
  // index 0) and edge-cases (orig index 2). A by-value read off `pass.lens` gives
  // the right answer; an index-into-[correctness,security,edge-cases] map would
  // read compacted index 1 as 'security' and MIS-ATTRIBUTE. The all-readable
  // 0-and-2 case cannot expose this, since with no gap compacted index == orig.
  const merged = mergePasses([
    lensPass('correctness', [finding({ summary: 'off-by-one' })]),
    lensPass('edge-cases', [finding({ summary: 'no bound check on the same line' })]),
  ]);
  assert.deepEqual(merged.findings[0].lenses, ['correctness', 'edge-cases']);
  assert.ok(!merged.findings[0].lenses.includes('security'), 'the failed middle lens is never attributed');
});

test('a null-line single carries its originating pass lens, bypassing the keyed Set', () => {
  const merged = mergePasses([lensPass('security', [finding({ line: null, summary: 'a leak somewhere' })])]);
  assert.equal(merged.findings.length, 1);
  assert.deepEqual(merged.findings[0].lenses, ['security']);
});

test('a plain --passes run (no lens) leaves lenses empty on every finding', () => {
  // Mutation proof that `pass.lens` gates the push: a lens-less pass contributes
  // no lens, so the array is empty rather than carrying a stray null.
  const merged = mergePasses([readablePass([finding()]), readablePass([finding({ line: null })])]);
  assert.deepEqual(merged.findings.map((f) => f.lenses), [[], []]);
});

test('passesEnvelope carries the strategy and lens list at the top level', () => {
  const merged = mergePasses([lensPass('correctness', [finding()])]);
  const envelope = passesEnvelope(merged, {
    label: '1 file(s)', provider: 'lmstudio', requestedModel: 'm', model: 'm', modelReported: true,
    perPassReports: [], usage: null, reasoning: { label: 'unknown' }, caveatFlags: {}, contextChecked: true,
    strategy: 'lenses', lenses: ['correctness', 'security'],
  });
  assert.equal(envelope.strategy, 'lenses');
  assert.deepEqual(envelope.lenses, ['correctness', 'security']);
});

const lensTextFor = (over = {}) =>
  passesText(
    { readablePasses: 2, findings: [{ file: 'a.js', line: 10, severity: 'high', evidence: '', agreement: 1, readablePasses: 2, summary: 'a defect', summaries: ['a defect'], lenses: ['security'], ...over }] },
    {
      passCount: 2,
      passSummaries: [
        { index: 0, durationMs: 1000, findings: 1, reason: null, servedNote: null },
        { index: 1, durationMs: 1000, findings: 0, reason: null, servedNote: null },
      ],
      caveatFlags: { salvaged: false, analysisCut: false, atCap: false, hunksOnly: false, skippedUnsizedWindow: false, dropped: 0, unreadable: false },
      label: '1 file(s)', profile: { name: 'lmstudio' }, model: 'test-model',
      strategy: 'lenses', lenses: ['correctness', 'security'],
    },
  );

test('the lens-path text tags a finding by lens and DROPS the confidence framing', () => {
  // Two-sided control with the passes path below: the confidence paragraph the
  // `--passes` path prints ("LOWER BOUND on true agreement") must be ABSENT on the
  // lens path, replaced by lens provenance, or K reads as confidence across
  // deliberately disjoint focuses.
  const text = lensTextFor();
  assert.match(text, /\[flagged by: security\]/);
  assert.match(text, /COVERAGE across focuses, not confidence/);
  assert.doesNotMatch(text, /LOWER BOUND on true agreement/);
});

test('the passes-path text KEEPS the LOWER BOUND framing (control for the lens path)', () => {
  // The other half of the control: the plain `--passes` rendering is unchanged, so
  // the confidence paragraph is present there. If the branch leaked, this reds.
  const text = passesText(
    { readablePasses: 2, findings: [{ file: 'a.js', line: 10, severity: 'high', evidence: '', agreement: 2, readablePasses: 2, summary: 's', summaries: ['s'], lenses: [] }] },
    {
      passCount: 2,
      passSummaries: [{ index: 0, durationMs: 1000, findings: 1, reason: null, servedNote: null }, { index: 1, durationMs: 1000, findings: 1, reason: null, servedNote: null }],
      caveatFlags: { salvaged: false, analysisCut: false, atCap: false, hunksOnly: false, skippedUnsizedWindow: false, dropped: 0, unreadable: false },
      label: '1 file(s)', profile: { name: 'lmstudio' }, model: 'test-model',
    },
  );
  assert.match(text, /LOWER BOUND on true agreement/);
  assert.doesNotMatch(text, /flagged by:/);
});

test('lensDirective returns a focus clause for a known lens and throws naming the set for an unknown one', () => {
  assert.match(lensDirective('security'), /SECURITY/);
  assert.throws(() => lensDirective('nonsense'), /Unknown --lens "nonsense"/);
});

test('parseReviewLenses validates the list, refusing empty, unknown, duplicate, and non-string', () => {
  assert.deepEqual(parseReviewLenses(undefined), []);
  assert.deepEqual(parseReviewLenses('correctness,security'), ['correctness', 'security']);
  assert.throws(() => parseReviewLenses('correctness,,security'), /empty entry/);
  assert.throws(() => parseReviewLenses('correctness,bogus'), /Unknown --lens "bogus"/);
  // Duplicate rejection: a repeated focus would run twice while mergePasses dedups
  // its provenance to one lens, and is what makes agreement === lenses.length hold.
  assert.throws(() => parseReviewLenses('security,security'), /repeated/);
  // A non-string yields a controlled UserError, never a leaked toString throw.
  assert.throws(() => parseReviewLenses(['security']), /comma-separated list of lens names/);
  assert.throws(() => parseReviewLenses({ toString() { throw new Error('hostile'); } }), /comma-separated list of lens names/);
});

test('the lens-path envelope OMITS per-finding agreement/readablePasses; the --passes path KEEPS them', () => {
  // Two-sided control for the §5 drop: after duplicate-rejection agreement equals
  // the lens count, so a confidence-shaped number over redundant data is stripped
  // at the envelope seam — but ONLY on the lens path. mergePasses stays neutral
  // (still computes agreement); the omission is passesEnvelope's alone.
  const baseEnv = {
    label: '1 file(s)', provider: 'lmstudio', requestedModel: 'm', model: 'm', modelReported: true,
    perPassReports: [], usage: null, reasoning: { state: 'unknown' }, caveatFlags: {}, contextChecked: true,
  };
  const lensEnv = passesEnvelope(
    mergePasses([lensPass('correctness', [finding()]), lensPass('security', [finding()])]),
    { ...baseEnv, strategy: 'lenses', lenses: ['correctness', 'security'] },
  );
  assert.equal(lensEnv.findings[0].agreement, undefined, 'no agreement on a lens finding');
  assert.equal(lensEnv.findings[0].readablePasses, undefined, 'no readablePasses on a lens finding');
  assert.deepEqual(lensEnv.findings[0].lenses, ['correctness', 'security'], 'lenses[] is the sole signal');
  const passesEnv = passesEnvelope(
    mergePasses([readablePass([finding()]), readablePass([finding()])]),
    { ...baseEnv, strategy: 'passes', lenses: [] },
  );
  assert.equal(passesEnv.findings[0].agreement, 2, 'the --passes path keeps agreement');
  assert.equal(passesEnv.findings[0].readablePasses, 2, 'the --passes path keeps readablePasses');
});
