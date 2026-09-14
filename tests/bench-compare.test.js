import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildComparison, isReviewRecord, normalizeReviewRecord } from '../bench/lib/compare-model.mjs';
import { renderComparison } from '../bench/lib/compare-report.mjs';
import { compare } from '../bench/compare.mjs';
import { UserError } from '../scripts/lib/errors.mjs';
import { tempDir } from './helpers.mjs';

// ---- fixtures: build real review-record shapes caseRows can read ----

function scoredRun({
  found = 1,
  anchored = 1,
  unmatched = 0,
  provider = 'lmstudio',
  model = 'model-a',
  requestedModel = 'model-a',
  hunksOnly = false,
  contextWindow = 154624,
  diffOnly = false,
  degraded = false,
  completion_tokens = 200,
  generationMs = 1000,
  prompt_tokens = 5000,
  // Feeds `reasoningWitness`: a finite number classifies as reasoning-observed
  // (>0) / no-reasoning-observed (0); `null` omits the detail entirely so the
  // witness reads `unknown`.
  reasoningTokens = 0,
} = {}) {
  return {
    diffOnly,
    report: {
      provider,
      model,
      requestedModel,
      hunksOnly,
      contextWindow,
      skippedUnsizedWindow: false,
      finishReason: 'stop',
      analysisCut: false,
      degraded,
      usage: {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        ...(reasoningTokens === null ? {} : { completion_tokens_details: { reasoning_tokens: reasoningTokens } }),
      },
      generationMs,
      prefillMs: 200,
      attempts: [{ outcome: 'answered', warmEligible: false }],
    },
    score: {
      recall: { found, anchored },
      unmatched: Array.from({ length: unmatched }, (_, i) => ({ file: 'f', line: i + 1, severity: 'high', summary: 's' })),
      byDefect: [],
    },
  };
}

const failedRun = (reason = 'deadline-timeout') => ({ error: new Error('x'), reason });

// A clean run that answered, exited 0, and parsed nothing scoreable — no score,
// no error, finishReason 'stop': the `unreadableRuns` bucket.
const unreadableRun = () => {
  const run = scoredRun();
  delete run.score;
  return run;
};

// A run counted as SCORED (has a score, no error, not truncated) but carrying NO
// report — so `measurable()`/`reasoningSamples`/`lensByCase` all drop it, leaving
// an empty reasoning AND lens set on a scored row. The real writer couples a score
// to a parsed report, but `normalizeReviewRecord` is a defensive reader that
// accepts this shape, so both axes must fail closed on it rather than rank through.
const scoredNoReportRun = ({ found = 1, anchored = 1 } = {}) => ({
  diffOnly: false,
  score: { recall: { found, anchored }, unmatched: [], byDefect: [] },
});

// A run cut off by the token budget: a real report (finishReason 'length') so it is
// MEASURABLE, but excluded from the SCORED population (`run-buckets.mjs`). Used to
// prove the comparison reads the scored population, not measurable — a truncated run
// carrying a different reasoning/lens state must NOT inflate the compared set.
const truncatedRun = (over = {}) => {
  const run = scoredRun(over);
  run.report.finishReason = 'length';
  return run;
};

function caseDef({ id = 'c1', defects = 1, control = false, mode = 'commit', origin = { commit: 'a' }, files = [], dropped = 0 } = {}) {
  return {
    id,
    label: 'L',
    mode,
    origin,
    files,
    provider: null,
    model: null,
    defects: Array.from({ length: defects }, (_, i) => ({ id: `d${i}`, file: 'f', lines: [1, 2], anchor: 'x', fixedIn: 'y' })),
    dropped: Array.from({ length: dropped }, (_, i) => ({ id: `dr${i}` })),
    ...(control ? { control: true } : {}),
  };
}

const record = ({ runsPerCase = 1, options = {}, results }) => ({ runsPerCase, options, warmed: false, results });
const norm = (rec, path = 'p.json', stamp = 'stamp') => normalizeReviewRecord({ path, stamp, record: rec });

// A record with one case (2 defects), one scored run finding 1 — the base both
// sides of a flip share.
const baseCase = (over = {}) => ({ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1, ...over })] });
const baseRecord = (opts = {}) => record({ runsPerCase: 1, options: opts, results: [baseCase()] });

const axisNames = (comp) => comp.divergences.map((d) => d.axis);

// ---- comparability: rankable when like-for-like ----

test('two matching records are rankable with a correct, un-re-tallied aggregate', () => {
  const a = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 })] },
    { caseDef: caseDef({ id: 'c2', defects: 3 }), runs: [scoredRun({ found: 2 })] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 })] },
    { caseDef: caseDef({ id: 'c2', defects: 3 }), runs: [scoredRun({ found: 2 })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, true, `expected rankable, got divergences: ${JSON.stringify(comp.divergences)}`);
  // opportunities = 2*1 + 3*1 = 5; found = 1 + 2 = 3; recall = 0.6 — hand-checked.
  const agg = comp.records[0].aggregate;
  assert.equal(agg.found, 3);
  assert.equal(agg.opportunities, 5);
  assert.equal(agg.recall, 0.6);
});

// ---- divergence flip set: each axis, in turn ----

const flip = (optsB) => {
  const a = norm(baseRecord(), 'a.json', 'a');
  const b = norm(baseRecord(optsB), 'b.json', 'b');
  return buildComparison([a, b]);
};

test('flipping cold suppresses ranking, naming cold', () => {
  const comp = flip({ cold: true });
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('cold'), JSON.stringify(comp.divergences));
});

test('flipping structured-output suppresses ranking, naming it', () => {
  const comp = flip({ 'structured-output': true });
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('structured-output'), JSON.stringify(comp.divergences));
});

test('flipping warm-up, timeout, temperature, max-attempts, max-seconds each suppresses ranking', () => {
  for (const [opt, axis] of [
    [{ 'warm-up': true }, 'warm-up'],
    [{ timeout: 30 }, 'timeout'],
    [{ temperature: 0.7 }, 'temperature'],
    [{ 'max-attempts': 3 }, 'max-attempts'],
    [{ 'max-seconds': 300 }, 'max-seconds'],
    // A multi-pass record's findings are a deduplicated union across N passes,
    // not one pass's output, so it must not rank against a single-pass record.
    [{ passes: 3 }, 'passes'],
  ]) {
    const comp = flip(opt);
    assert.equal(comp.rankable, false, `${axis} should suppress`);
    assert.ok(axisNames(comp).includes(axis), `${axis}: ${JSON.stringify(comp.divergences)}`);
  }
});

test('an explicit --passes 1 does not diverge from a no-flag record (both single-pass)', () => {
  // Mutation proof for the `?? 1` normalize: an absent `passes` is the
  // byte-identical single-pass code path, so it must compare EQUAL to an explicit
  // `--passes 1`, never suppress. Reverting `?? 1` makes absent `known(null)` vs
  // `known(1)`, which would put `passes` in the divergence list.
  const comp = flip({ passes: 1 });
  assert.ok(!axisNames(comp).includes('passes'), `passes must not diverge: ${JSON.stringify(comp.divergences)}`);
});

// ---- OAI-11 pass-strategy axes (derived from raw persisted options.lens) ----

test('a --lens record is incomparable to a plain-pass record (strategy + effective count derived)', () => {
  const comp = flip({ lens: 'correctness,security' });
  assert.equal(comp.rankable, false);
  const axes = axisNames(comp);
  assert.ok(axes.includes('strategy'), `strategy: ${JSON.stringify(comp.divergences)}`);
  // The effective pass count (2) is derived from the lens list, so the `passes`
  // axis (2 vs the plain record's 1) diverges too — proving the derivation.
  assert.ok(axes.includes('passes'), `passes: ${JSON.stringify(comp.divergences)}`);
});

test('two lens runs differing only in ORDER are incomparable (the lens-set axis is UNSORTED)', () => {
  // Mutation proof for the unsort: execution order is material (the first lens pays
  // cold prefill, later lenses warm), so `correctness,security` and
  // `security,correctness` must NOT rank as like-for-like. Sorting the axis (the
  // reverted code) makes them equal and wrongly rankable.
  const a = norm(baseRecord({ lens: 'correctness,security' }), 'a.json', 'a');
  const b = norm(baseRecord({ lens: 'security,correctness' }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('lenses'), JSON.stringify(comp.divergences));
});

test('a malformed persisted options.lens fails closed — no real run could persist it', () => {
  // Every shape the CLI/bench refuse at write time: a non-string, an explicit null,
  // an unknown name, a duplicate, an empty string. Each must read `malformed` and
  // suppress on all three derived axes.
  const bads = [['security'], null, 'bogus', 'security,security', ''];
  // The DISCRIMINATING assertion (Group C): a malformed-vs-plain pair diverges under
  // BOTH the correct fix AND a buggy `null → present with names []` impl, so it
  // cannot pin the fix. Two IDENTICAL malformed records CAN: the correct fix makes
  // both `unknown` (suppressed even for a matched pair), while a buggy zero-pass
  // "present" reading makes them equal and wrongly rankable.
  for (const bad of bads) {
    const a = norm(baseRecord({ lens: bad }), 'a.json', 'a');
    const b = norm(baseRecord({ lens: bad }), 'b.json', 'b');
    const comp = buildComparison([a, b]);
    assert.equal(comp.rankable, false, `two identical malformed-lens records must not rank: lens=${JSON.stringify(bad)} → ${JSON.stringify(comp.divergences)}`);
    // The non-rank must be caused by the fail-closed AXES, not by the records
    // bailing `incompatible` (which also yields rankable:false, but with EMPTY
    // divergences — a test that checked only `rankable` would pass for the wrong
    // reason if a value ever threw outside lensAxisState's catch). A matched pair of
    // unknown-axis records lists all three axes in `divergences`; an incompatible
    // bail lists none, so this assertion discriminates the two — for EVERY bad value,
    // not just one.
    for (const axis of ['passes', 'strategy', 'lenses']) {
      assert.ok(axisNames(comp).includes(axis), `lens=${JSON.stringify(bad)} must fail closed on ${axis} (not bail incompatible): ${JSON.stringify(comp.divergences)}`);
    }
  }
  // A record carrying BOTH --lens and --passes is impossible (the CLI and bench
  // refuse the combination at write time), so it must fail closed too — even though
  // the lens value is itself valid. Without this, a `{lens, passes}` record would
  // read as an ordinary lens run with the passes silently ignored.
  const bothA = norm(baseRecord({ lens: 'security', passes: 3 }), 'a.json', 'a');
  const bothB = norm(baseRecord({ lens: 'security', passes: 3 }), 'b.json', 'b');
  const both = buildComparison([bothA, bothB]);
  assert.equal(both.rankable, false, 'two identical lens+passes records must not rank');
  for (const axis of ['passes', 'strategy', 'lenses']) {
    assert.ok(axisNames(both).includes(axis), `lens+passes must fail closed on ${axis}: ${JSON.stringify(both.divergences)}`);
  }
  // ...and it must NOT rank against a legit lens-only record (it reads malformed,
  // the legit one reads present — known vs unknown suppresses).
  const vsLegit = buildComparison([
    norm(baseRecord({ lens: 'security', passes: 3 }), 'a.json', 'a'),
    norm(baseRecord({ lens: 'security' }), 'b.json', 'b'),
  ]);
  assert.equal(vsLegit.rankable, false, 'a lens+passes record must not rank against a legit lens-only record');
});

test('flipping runsPerCase suppresses ranking', () => {
  const a = norm(record({ runsPerCase: 1, options: {}, results: [baseCase()] }), 'a.json', 'a');
  // runsPerCase 2 = one case with two runs, NOT two case entries sharing an id
  // (that is a duplicate-id record, now correctly incompatible).
  const b = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 }), scoredRun({ found: 1 })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('runs-per-case'), JSON.stringify(comp.divergences));
});

test('a per-case lens difference suppresses ranking, naming lens', () => {
  const a = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ hunksOnly: false, contextWindow: 154624 })] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ hunksOnly: true, contextWindow: 61696 })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('lens'), JSON.stringify(comp.divergences));
});

// A record covering one case at the given reasoning-token counts (one run each).
const reasoningRecord = (counts, path, stamp) =>
  norm(record({ runsPerCase: counts.length, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: counts.map((n) => scoredRun({ found: 1, reasoningTokens: n })) },
  ] }), path, stamp);

test('a per-case reasoning difference (observed vs none) suppresses ranking, naming reasoning', () => {
  const a = reasoningRecord([12], 'a.json', 'a'); // reasoning-observed
  const b = reasoningRecord([0], 'b.json', 'b'); // no-reasoning-observed
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('reasoning'), JSON.stringify(comp.divergences));
});

test('a known-vs-unknown reasoning difference suppresses ranking (fail-closed)', () => {
  const a = reasoningRecord([12], 'a.json', 'a'); // reasoning-observed
  const b = reasoningRecord([null], 'b.json', 'b'); // usage carries no detail -> unknown
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('reasoning'), JSON.stringify(comp.divergences));
});

test('records agreeing on reasoning state stay rankable (both unknown)', () => {
  const a = reasoningRecord([null], 'a.json', 'a');
  const b = reasoningRecord([null], 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
  assert.ok(!axisNames(comp).includes('reasoning'), JSON.stringify(comp.divergences));
});

test('the same multi-state reasoning set in different run order stays rankable (sort guard)', () => {
  // Both records observe {reasoning-observed, no-reasoning-observed} for the case,
  // in opposite first-seen order — the dedup preserves that order, so without the
  // canonicalising sort the two signatures would false-diverge.
  const a = reasoningRecord([12, 0], 'a.json', 'a');
  const b = reasoningRecord([0, 12], 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
  assert.ok(!axisNames(comp).includes('reasoning'), JSON.stringify(comp.divergences));
});

test('a scored record with no report classifies unknown and suppresses vs a known reasoning state', () => {
  // A scored run with no report is IN the scored population; `reasoningWitness`
  // reads no usage -> `unknown`. So it suppresses against B's known state via the
  // value arm (unknown vs observed), fail-closed.
  const a = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredNoReportRun({ found: 1 })] },
  ] }), 'a.json', 'a');
  const b = reasoningRecord([12], 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('reasoning'), JSON.stringify(comp.divergences));
});

test('two records both scored-without-report rank through on reasoning (both unknown) but lens suppresses', () => {
  // Both scored runs classify reasoning `unknown` -> shared witnessed state, ranks
  // through on reasoning (Option A). Lens is the fail-closed catch: a scored run with
  // no report has an unprovable strict lens (`unknown`), so the lens axis suppresses.
  const noReport = (stamp) => norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredNoReportRun({ found: 1 })] },
  ] }), `${stamp}.json`, stamp);
  const comp = buildComparison([noReport('a'), noReport('b')]);
  assert.equal(comp.rankable, false);
  assert.ok(!axisNames(comp).includes('reasoning'), JSON.stringify(comp.divergences));
  assert.ok(axisNames(comp).includes('lens'), JSON.stringify(comp.divergences));
});

test('a scored record with an unprovable lens suppresses ranking (lens fail-closed)', () => {
  // The score-without-report shape on lens: A's scored run has no report -> its strict
  // lens is `unknown`; B has a normal lens. A must not rank through.
  const a = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredNoReportRun({ found: 1 })] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1, hunksOnly: false, contextWindow: 154624 })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('lens'), JSON.stringify(comp.divergences));
});

test('a truncated run cannot conceal a real scored-run reasoning difference', () => {
  // The concealment regression (the whole reason the comparison reads the SCORED
  // population, not measurable). A's SCORED run reasoned; B's SCORED run did not; each
  // has a TRUNCATED run carrying the opposite state. The measurable sets are equal
  // ({observed, no-observed}) — under the old measurable population this ranked
  // through — but the scored sets differ, so it must suppress.
  const a = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1, reasoningTokens: 12 }), truncatedRun({ reasoningTokens: 0 })] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1, reasoningTokens: 0 }), truncatedRun({ reasoningTokens: 12 })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('reasoning'), JSON.stringify(comp.divergences));
});

test('a truncated run cannot conceal a real scored-run lens difference', () => {
  // The same concealment on the lens axis: A's scored run is whole@154624, B's is
  // hunks@61696; each has a truncated run at the other depth, so the measurable lens
  // sets are equal but the scored ones differ -> suppress.
  const a = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1, hunksOnly: false, contextWindow: 154624 }), truncatedRun({ hunksOnly: true, contextWindow: 61696 })] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1, hunksOnly: true, contextWindow: 61696 }), truncatedRun({ hunksOnly: false, contextWindow: 154624 })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('lens'), JSON.stringify(comp.divergences));
});

test('a dropped case id suppresses ranking, naming the case set', () => {
  const a = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun()] },
    { caseDef: caseDef({ id: 'c2', defects: 2 }), runs: [scoredRun()] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun()] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('case set'), JSON.stringify(comp.divergences));
});

test('a middle-era run (contextWindow KEY absent) is lens-unknown and suppresses ranking', () => {
  // contextWindow entered the writer (OAI-217, 2026-08-27 18:40) later than the
  // other lens fields, written `?? null`. A record with hunksOnly/skippedUnsized
  // but NO contextWindow key predates it: its lensLabel reads @unsized even if
  // the window was actually sized, so the lens cannot be proven → unknown.
  // BOTH records are middle-era with the same @unsized label, so the ONLY reason
  // to suppress is the unprovable lens — dropping the contextWindow-key check
  // would let them rank as equal.
  const middleEra = () => {
    const run = scoredRun({ hunksOnly: false });
    delete run.report.contextWindow;
    run.report.skippedUnsizedWindow = false;
    return run;
  };
  const mk = (s) => norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [middleEra()] }] }), `${s}.json`, s);
  const comp = buildComparison([mk('a'), mk('b')]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('lens'), JSON.stringify(comp.divergences));
});

test('a current-writer unsized run (contextWindow present as null) is lens-known and rankable', () => {
  // Under the current writer the key is always present; null is the legitimate,
  // provable unsized state — two such records must still rank.
  const unsizedNull = () => {
    const run = scoredRun({ hunksOnly: false });
    run.report.contextWindow = null;
    run.report.skippedUnsizedWindow = false;
    return run;
  };
  const mk = (s) => norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [unsizedNull()] }] }), `${s}.json`, s);
  const comp = buildComparison([mk('a'), mk('b')]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
});

test('a pre-lens-feature run (missing hunksOnly) is lens-unknown and suppresses ranking', () => {
  const preFeature = () => {
    const run = scoredRun();
    delete run.report.hunksOnly;
    delete run.report.skippedUnsizedWindow;
    return run;
  };
  const a = norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [preFeature()] }] }), 'a.json', 'a');
  const b = norm(baseRecord(), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('lens'), JSON.stringify(comp.divergences));
});

// ---- absence is not unknown ----

test('two records both omitting cold/structured-output are rankable (absence = false, not unknown)', () => {
  const a = norm(baseRecord({}), 'a.json', 'a');
  const b = norm(baseRecord({}), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
});

// ---- cap: config vs outcome ----

test('same explicit max-seconds but different capped counts is still rankable (capped is an outcome)', () => {
  const a = norm(record({ runsPerCase: 2, options: { 'max-seconds': 300 }, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 }), failedRun('deadline-timeout')] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 2, options: { 'max-seconds': 300 }, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 }), scoredRun({ found: 1 })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
});

test('an absent max-seconds with a capped run is unknown and suppresses ranking', () => {
  const a = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 }), failedRun('deadline-timeout')] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 }), scoredRun({ found: 1 })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('max-seconds'), JSON.stringify(comp.divergences));
});

// ---- incompatible vs unreadable-run ----

test('a record whose nested shape caseRows cannot read is incompatible, not a throw', () => {
  const n = norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: { id: 'c1' }, runs: [] }] }), 'bad.json', 'bad');
  assert.equal(n.incompatible, true);
  assert.match(n.reason, /could not be read|not a readable review record/);
  // and it is excluded from ranking rather than crashing a comparison
  const good = norm(baseRecord(), 'g.json', 'g');
  const comp = buildComparison([n, good]);
  assert.equal(comp.records.find((r) => r.path === 'bad.json').incompatible, true);
});

test('a clean unreadable run does NOT make the record incompatible', () => {
  const n = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [unreadableRun()] },
  ] }), 'u.json', 'u');
  assert.equal(n.incompatible, false);
});

// ---- case definition: input and classification, not just scoring ----

test('same id but changed defects / mode / control each suppresses ranking (whole-caseDef)', () => {
  const build = (cd) => norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: cd, runs: [scoredRun()] }] }), 'x.json', 'x');
  const a = build(caseDef({ id: 'c1', defects: 2 }));
  for (const changed of [
    caseDef({ id: 'c1', defects: 3 }), // changed scoring ground truth
    caseDef({ id: 'c1', defects: 2, mode: 'worktree' }), // changed input mode
    caseDef({ id: 'c1', defects: 2, origin: { commit: 'zzz' } }), // changed revision
    caseDef({ id: 'c1', defects: 2, control: true }), // changed classification
  ]) {
    const b = norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: changed, runs: [scoredRun()] }] }), 'y.json', 'y');
    const comp = buildComparison([a, b]);
    assert.equal(comp.rankable, false, `caseDef change should suppress: ${JSON.stringify(changed)}`);
    assert.ok(axisNames(comp).includes('case definition'), JSON.stringify(comp.divergences));
  }
});

test('a reordered array in caseDef suppresses ranking (array order is preserved, e.g. files order is material)', () => {
  // caseDef.files order is material (attachment/prompt order to the review
  // command), so canonicalJson preserves array order and a reorder is a
  // definition difference — fail-closed. Records from one manifest share order,
  // so this never fires spuriously in practice.
  const cdA = caseDef({ id: 'c1', defects: 2, files: ['x.mjs', 'y.mjs'] });
  const cdB = { ...cdA, files: ['y.mjs', 'x.mjs'] };
  const a = norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: cdA, runs: [scoredRun()] }] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: cdB, runs: [scoredRun()] }] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('case definition'), JSON.stringify(comp.divergences));
});

// ---- numeric value flags compare numerically ----

test('max-tokens "1024" vs 1024 and temperature "1" vs 1.0 are rankable (numeric compare)', () => {
  const a = norm(baseRecord({ 'max-tokens': '1024', temperature: '1' }), 'a.json', 'a');
  const b = norm(baseRecord({ 'max-tokens': 1024, temperature: 1.0 }), 'b.json', 'b');
  assert.equal(buildComparison([a, b]).rankable, true, JSON.stringify(buildComparison([a, b]).divergences));
});

// ---- per-case coverage (B) ----

test('a case scored in one record but failed in another suppresses ranking (coverage)', () => {
  const a = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 })] },
    { caseDef: caseDef({ id: 'c2', defects: 2 }), runs: [scoredRun({ found: 1 })] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 })] },
    { caseDef: caseDef({ id: 'c2', defects: 2 }), runs: [failedRun('deadline-timeout')] }, // c2 never scored in b
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('coverage'), JSON.stringify(comp.divergences));
});

// ---- per-case effective degradation (A) ----

test('per-case degradation on DIFFERENT cases suppresses ranking, though record-level "any degraded" is equal', () => {
  // Both records have exactly one degraded case, so a record-level boolean would
  // call them equal; but they degraded on DIFFERENT cases.
  const a = norm(record({ runsPerCase: 1, options: { 'structured-output': true }, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1, degraded: true })] },
    { caseDef: caseDef({ id: 'c2', defects: 2 }), runs: [scoredRun({ found: 1, degraded: false })] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 1, options: { 'structured-output': true }, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1, degraded: false })] },
    { caseDef: caseDef({ id: 'c2', defects: 2 }), runs: [scoredRun({ found: 1, degraded: true })] },
  ] }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('structured-output-effective'), JSON.stringify(comp.divergences));
});

// ---- hostile numeric coercion (C) ----

test('numeric option strings the CLI accepts (.5, 1e2, +5) read as known numbers, so equivalents rank', () => {
  const a = norm(baseRecord({ temperature: '.5', timeout: '1e2', 'max-tokens': '+5' }), 'a.json', 'a');
  const b = norm(baseRecord({ temperature: 0.5, timeout: 100, 'max-tokens': 5 }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
});

test('an empty-string numeric option is UNKNOWN and suppresses ranking (fail-closed; the writer would read it as 0)', () => {
  const a = norm(baseRecord({ temperature: '' }), 'a.json', 'a');
  const b = norm(baseRecord({ temperature: '' }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('temperature'), JSON.stringify(comp.divergences));
});

test('a hostile non-numeric option value is unknown, not coerced to a number', () => {
  // Number([]) === 0, so a coercing reader would call these two records EQUAL on
  // max-tokens (both 0) and rank them. Treating [] as unknown makes them diverge.
  const a = norm(baseRecord({ 'max-tokens': [] }), 'a.json', 'a');
  const b = norm(baseRecord({ 'max-tokens': 0 }), 'b.json', 'b');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, false);
  assert.ok(axisNames(comp).includes('max-tokens'), JSON.stringify(comp.divergences));
});

// ---- never-throws on a pathological record (F) ----

test('a pathologically deep caseDef is incompatible, never a thrown RangeError', () => {
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 100000; i += 1) {
    cur.a = {};
    cur = cur.a;
  }
  const cd = caseDef({ id: 'c1', defects: 2 });
  cd.pathological = deep;
  let n;
  assert.doesNotThrow(() => {
    n = norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: cd, runs: [scoredRun()] }] }), 'x.json', 'x');
  });
  assert.equal(n.incompatible, true);
});

// ---- ranking order (G) ----

test('the tie-break is the per-scored-run unmatched RATE, not the raw total (a failed run must not rank a record higher)', () => {
  // Two 2-defect cases, runsPerCase 2, recall tied at 0.5. A scored 1 of 2 runs
  // per case (2 unmatched over 2 scored ⇒ rate 1.0); B scored all 4 (3 unmatched
  // over 4 scored ⇒ rate 0.75). Raw unmatched ranks A first (2<3); the RATE ranks
  // B first (0.75<1.0). The fix must produce [B, A].
  const two = (id) => caseDef({ id, defects: 2 });
  // A plain (non-timeout) failure — so this does NOT trip the wall-clock-cap
  // axis; it only reduces the scored-run count.
  const a = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: two('c1'), runs: [scoredRun({ model: 'm-A', requestedModel: 'm-A', found: 1, unmatched: 1 }), failedRun('provider-error')] },
    { caseDef: two('c2'), runs: [scoredRun({ model: 'm-A', requestedModel: 'm-A', found: 1, unmatched: 1 }), failedRun('provider-error')] },
  ] }), 'A.json', 'A');
  const b = norm(record({ runsPerCase: 2, options: {}, results: [
    { caseDef: two('c1'), runs: [scoredRun({ model: 'm-B', requestedModel: 'm-B', found: 1, unmatched: 1 }), scoredRun({ model: 'm-B', requestedModel: 'm-B', found: 1, unmatched: 1 })] },
    { caseDef: two('c2'), runs: [scoredRun({ model: 'm-B', requestedModel: 'm-B', found: 1, unmatched: 1 }), scoredRun({ model: 'm-B', requestedModel: 'm-B', found: 1, unmatched: 0 })] },
  ] }), 'B.json', 'B');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
  assert.deepEqual(comp.ranking.map((r) => r.label), ['m-B @ B', 'm-A @ A']);
});

test('the ranking ORDER is recall desc, then unmatched-rate asc, deterministically', () => {
  // Every record scores every case (so the coverage axis does not suppress) and
  // shares all axes; only found/unmatched differ. A ties B on recall and wins on
  // fewer unmatched.
  const mk = (s, found, unmatched) =>
    norm(record({ runsPerCase: 1, options: {}, results: [
      { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ model: `m-${s}`, requestedModel: `m-${s}`, found, unmatched })] },
    ] }), `${s}.json`, s);
  const hi = mk('a', 2, 0); // recall 1.0
  const midFew = mk('b', 1, 0); // recall 0.5, 0 unmatched
  const midMany = mk('c', 1, 1); // recall 0.5, 1 unmatched
  const comp = buildComparison([midMany, hi, midFew]); // deliberately out of order
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
  assert.deepEqual(comp.ranking.map((r) => r.label), ['m-a @ a', 'm-b @ b', 'm-c @ c']);
});

// ---- comparator is a total, antisymmetric order (same stamp) ----

test('two entries with the same stamp (same file twice) rank in a deterministic label order', () => {
  // Identical records ⇒ every ranking key ties down to the final tie-break. With
  // the old `stamp`-only tie-break the comparator returned 1 for both (a,b) and
  // (b,a) — invalid. The label three-way (#1 < #2) is a total order.
  const one = record({ runsPerCase: 1, options: {}, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 1 })] }] });
  const a = norm(one, 'same.json', 'same');
  const b = norm(one, 'same.json', 'same');
  const comp = buildComparison([a, b]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
  const labels = comp.ranking.map((r) => r.label);
  assert.equal(labels.length, 2);
  assert.deepEqual(labels, [...labels].sort(), 'ranking order must be the deterministic label order');
  assert.notEqual(labels[0], labels[1], 'the two entries carry distinct (#i) labels');
});

// ---- the pooled-recall disclosure is rendered and complete ----

test('a comparison WITH recall shows the pooled-recall weighting disclosure, not the control-FP one', () => {
  const mk = (s) => norm(record({ runsPerCase: 1, options: {}, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ model: `m-${s}`, requestedModel: `m-${s}`, found: 1 })] }] }), `${s}.json`, s);
  const out = renderComparison(buildComparison([mk('a'), mk('b')]));
  assert.match(out, /pooled over non-control/);
  assert.match(out, /listed-defect count/);
  assert.match(out, /runs that scored/);
  assert.doesNotMatch(out, /control false-positive rate/); // recall orders here, so no control-FP disclosure
});

test('a control-only ranking discloses the control-FP order, not the recall-pooling note', () => {
  // Every recall is `—`, so the recall-pooling sentence would explain a quantity no
  // row displays; the disclosure must name the control-FP rate that actually ordered.
  const ctrl = (fp, stamp) =>
    norm(record({ runsPerCase: 1, results: [{ caseDef: caseDef({ id: 'ctrl', control: true, defects: 0 }), runs: [scoredRun({ found: 0, unmatched: fp })] }] }), stamp + '.json', stamp);
  const out = renderComparison(buildComparison([ctrl(1, 'a'), ctrl(3, 'b')]));
  assert.match(out, /## Ranking/); // it IS ranked (control-FP evidence), not withheld
  assert.match(out, /ranking is by control false-positive rate/);
  assert.doesNotMatch(out, /pooled over non-control/); // recall orders nothing here
});

// ---- delta values (H) ----

test('the N==2 baseline-relative delta shows the correct signed found-count on the right column', () => {
  const a = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ model: 'm-a', requestedModel: 'm-a', found: 2 })] },
  ] }), 'a.json', 'a');
  const b = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ model: 'm-b', requestedModel: 'm-b', found: 1 })] },
  ] }), 'b.json', 'b');
  const out = renderComparison(buildComparison([a, b]));
  // baseline is the first record (a); b found 1 vs a found 2 => −1 (U+2212).
  assert.match(out, /−1/, `expected a −1 delta in:\n${out}`);
});

// ---- deltas gating ----

test('deltas are enabled for N==2 and disabled for N==3 without a baseline', () => {
  const mk = (s) => norm(baseRecord(), `${s}.json`, s);
  assert.ok(buildComparison([mk('a'), mk('b')]).baselineLabel, 'N==2 should pick a baseline');
  assert.equal(buildComparison([mk('a'), mk('b'), mk('c')]).baselineLabel, null, 'N==3 without --baseline should not');
});

test('a valid --baseline path resolves to that record and re-enables N>2 deltas', () => {
  // N==3 disables the auto-baseline (above); an explicit --baseline PATH re-enables
  // deltas against exactly that record — exercising `readable.find(r => r.path === baseline)`,
  // the valid-baseline arm (the invalid-baseline arm is covered separately).
  const mk = (s) => norm(baseRecord(), `${s}.json`, s);
  const comp = buildComparison([mk('a'), mk('b'), mk('c')], { baseline: 'b.json' });
  assert.equal(comp.baselineLabel, 'model-a @ b'); // resolved to the NAMED record, not the first
  assert.match(renderComparison(comp), /deltas against the baseline `model-a @ b`/);
});

// ---- rendering: failure cells, control, markdown safety ----

test('an all-failed case renders its failure state, never a fabricated 0', () => {
  const n = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [failedRun('deadline-timeout')] },
  ] }), 'a.json', 'a');
  const out = renderComparison(buildComparison([n]));
  assert.match(out, /capped/);
  assert.doesNotMatch(out, /c1 \| 0\/2/);
});

test('an all-failed case with mixed failure kinds names every one, not just the top-priority label', () => {
  const n = norm(record({ runsPerCase: 3, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [
      failedRun('model-substituted'),
      failedRun('provider-error'),
      failedRun('provider-error'),
    ] },
  ] }), 'a.json', 'a');
  const out = renderComparison(buildComparison([n]));
  // Both the substitution and the two ordinary failures are visible — a
  // single-label cell would have shown only "substituted" and concealed them.
  // Anchored on the trailing cell delimiter so a trailing "0 unreadable, 0
  // truncated" (a `> 0` guard flipped to `>= 0`) would not still match.
  assert.match(out, /— 2 failed, 1 substituted \|/);
});

test('a case that carried no runs reads "no runs", never a fabricated failure', () => {
  const n = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [] },
  ] }), 'a.json', 'a');
  const out = renderComparison(buildComparison([n]));
  // Every failure bucket is 0, so the cell falls through to the empty-runs
  // fallback. This also pins the whole `> 0` guard set: any guard flipped to
  // `>= 0` would push "0 <label>" here and the fallback would never fire.
  assert.match(out, /— no runs \|/);
  assert.doesNotMatch(out, /— 0 /);
});

test('an all-failed control case discloses its failure beside the control marker', () => {
  // A control whose only run timed out must not read the same as a control that
  // measured clean — the cell names the failure alongside the control marker.
  const n = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'ctrl', control: true, defects: 0 }), runs: [failedRun('first-byte-timeout')] },
  ] }), 'a.json', 'a');
  const out = renderComparison(buildComparison([n]));
  assert.match(out, /— control, 1 timeout \|/);
  // A control that DID score still reads bare "— control" (no failure suffix).
  const scored = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'ctrl', control: true, defects: 0 }), runs: [scoredRun({ found: 0, unmatched: 0 })] },
  ] }), 'b.json', 'b');
  assert.match(renderComparison(buildComparison([scored])), /— control \|/);
});

test('a record with no scored run shows "—" for the false-positive columns, never a fabricated 0', () => {
  // Two all-failed records render the unranked aggregate table (>= 2 readable).
  // No run scored, so Unmatched and Control FP are measurements nobody made:
  // "—", not "0" — the same em-dash the single-record report uses for a
  // precision figure over zero observations.
  const failed = (stamp) => norm(record({ runsPerCase: 1, options: { 'max-seconds': 60 }, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [failedRun()] },
  ] }), stamp + '.json', stamp);
  const out = renderComparison(buildComparison([failed('a'), failed('b')]));
  // recall | unmatched | controlFP | throughput — all four are "—".
  assert.match(out, /— \| — \| — \| — \|/);
  assert.doesNotMatch(out, /\| 0 \|/);
});

test('a markdown-metacharacter model id is escaped in the rendered output', () => {
  const n = norm(record({ runsPerCase: 1, options: {}, results: [
    { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ model: 'evil[x](y)', requestedModel: 'evil[x](y)' })] },
  ] }), 'a.json', 'a');
  const out = renderComparison(buildComparison([n]));
  assert.ok(!out.includes('evil[x](y)'), 'raw metacharacters must not survive');
  assert.match(out, /evil\.x/, 'the neutralised (dotted) form is present');
});

test('a divergent pair still renders both tables, with the ranking withheld', () => {
  const a = norm(baseRecord({}), 'a.json', 'a');
  const b = norm(baseRecord({ cold: true }), 'b.json', 'b');
  const out = renderComparison(buildComparison([a, b]));
  assert.match(out, /Ranking withheld/);
  assert.match(out, /Per-case recall matrix/);
});

// ---- scope discriminator ----

test('isReviewRecord accepts a review record and rejects sweep/task shapes', () => {
  assert.equal(isReviewRecord({ runsPerCase: 1, options: {}, results: [{}] }), true);
  assert.equal(isReviewRecord({ kind: 'task', options: {}, results: [{}] }), false, 'task record has a kind field');
  assert.equal(isReviewRecord({ options: {}, results: [{}] }), false, 'no runsPerCase');
  assert.equal(isReviewRecord({ runsPerCase: 1, options: {}, results: [] }), false, 'empty results');
  assert.equal(isReviewRecord([]), false);
  assert.equal(isReviewRecord(null), false);
});

test('compare() refuses a non-review file at parse, and renders two real records', () => {
  const dir = tempDir('oai-compare-');
  try {
    const good = join(dir, 'good.json');
    const task = join(dir, 'task.json');
    const rec = record({ runsPerCase: 1, options: {}, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun()] }] });
    writeFileSync(good, JSON.stringify(rec));
    writeFileSync(task, JSON.stringify({ kind: 'task', options: {}, results: [] }));

    assert.throws(() => compare([task]), (e) => e instanceof UserError && /not a bench review record/.test(e.message));

    const out = compare([good, good]);
    assert.match(out, /# Cross-run comparison/);
    assert.match(out, /Per-case recall matrix/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compare() rejects an unknown --baseline that is not among the records', () => {
  const dir = tempDir('oai-compare-');
  try {
    const good = join(dir, 'good.json');
    writeFileSync(good, JSON.stringify(record({ runsPerCase: 1, options: {}, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun()] }] })));
    assert.throws(() => compare([good], { baseline: '/nope.json' }), (e) => e instanceof UserError && /baseline/.test(e.message));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- malformed-record hardening (must fail closed to incompatible, never crash) ----

test('duplicate case ids in one record are incompatible, not a silent double-count', () => {
  // aggregate() sums every row while the Set/Map axes collapse the dup to one —
  // the exact silent mis-rank this reader exists to prevent.
  const dup = record({
    runsPerCase: 1,
    results: [
      { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 2 })] },
      { caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ found: 0 })] },
    ],
  });
  const n = norm(dup);
  assert.equal(n.incompatible, true);
  assert.match(n.reason, /duplicate case ids/);
  assert.doesNotThrow(() => buildComparison([n, norm(baseRecord())]));
});

test('a non-primitive case id is incompatible, never a thrown coercion', () => {
  // A hostile object id whose coercion would throw in divergencesOf's `.join(',')`
  // or in labelRecords — both outside normalizeReviewRecord's try/catch.
  const hostileId = { toString: null, valueOf: null };
  const bad = record({ runsPerCase: 1, results: [{ caseDef: caseDef({ id: hostileId, defects: 2 }), runs: [scoredRun()] }] });
  const n = norm(bad, 'bad.json');
  assert.equal(n.incompatible, true);
  assert.match(n.reason, /not a string or number/);
  // The good record still ranks; the bad one never crashes the run.
  assert.doesNotThrow(() => buildComparison([n, norm(baseRecord(), 'good.json')]));
});

test('a hostile non-string model does not crash label construction', () => {
  // reportIdentity returns the reply model verbatim; a corrupted object model
  // whose coercion throws must not take down the whole comparison.
  const hostileModel = { toString: null, valueOf: null };
  const rec = record({ runsPerCase: 1, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [scoredRun({ model: hostileModel })] }] });
  const n = norm(rec, 'h.json', 'hstamp');
  assert.equal(n.incompatible, false);
  let comp;
  assert.doesNotThrow(() => {
    comp = buildComparison([n]);
  });
  assert.equal(comp.records[0].label, 'unknown @ hstamp');
});

test('labels are globally unique even when a (#i) suffix meets a natural base label', () => {
  // stamp is a user-supplied filename (compare.mjs basename), so a file literally
  // named `<model> @ s (#1)` is reachable and would collide with the suffix the
  // duplicate `@ s` pair generates — breaking the comparator's total order and
  // baseline lookup. Two `@ s` records + one `@ s (#1)` record.
  const mk = (path, stamp) => norm(baseRecord(), path, stamp);
  const comp = buildComparison([mk('a.json', 's'), mk('b.json', 's'), mk('c.json', 's (#1)')]);
  const labels = comp.records.map((r) => r.label);
  assert.equal(new Set(labels).size, 3, `labels collided: ${JSON.stringify(labels)}`);
});

test('throughput medians every measurable run — control and unscored-but-generated included', () => {
  // Throughput is a generation-speed property, so a control response and an
  // unscored-but-successfully-generated response are valid samples. Rates chosen
  // so median === 200 ONLY if all three rows count: [100, 200, 900] → 200; drop
  // the control (200) or the unscored (900) and the median is no longer 200.
  const unscored900 = (() => {
    const r = scoredRun({ completion_tokens: 900, generationMs: 1000 });
    delete r.score;
    return r;
  })();
  const rec = record({
    runsPerCase: 1,
    results: [
      { caseDef: caseDef({ id: 'a', defects: 1 }), runs: [scoredRun({ completion_tokens: 100, generationMs: 1000 })] },
      { caseDef: caseDef({ id: 'b', control: true, defects: 0 }), runs: [scoredRun({ completion_tokens: 200, generationMs: 1000 })] },
      { caseDef: caseDef({ id: 'c', defects: 1 }), runs: [unscored900] },
    ],
  });
  const comp = buildComparison([norm(rec)]);
  assert.equal(comp.records[0].aggregate.throughput, 200);
});

// ---- null-recall ranking (control-only ranks by precision; all-failed is withheld) ----

test('a control-only comparison ranks by control-FP rate, not alphabetically', () => {
  // Recall is null by construction (no non-control opportunities), but control
  // false-positive rate IS precision evidence. The record with FEWER false
  // positives must rank first even when its label sorts LAST — proving the
  // controlFPRate tie-break is reached, not bypassed by an early label return.
  const ctrl = (fp, stamp) =>
    norm(
      record({ runsPerCase: 1, results: [{ caseDef: caseDef({ id: 'ctrl', control: true, defects: 0 }), runs: [scoredRun({ found: 0, unmatched: fp })] }] }),
      stamp + '.json',
      stamp,
    );
  const lowFP = ctrl(1, 'zzz'); // fewer FPs, label sorts LAST
  const highFP = ctrl(3, 'aaa'); // more FPs, label sorts FIRST
  const comp = buildComparison([highFP, lowFP]);
  assert.equal(comp.rankable, true, JSON.stringify(comp.divergences));
  assert.equal(comp.ranking[0].stamp, 'zzz'); // fewer FPs wins despite the later label
});

test('two all-failed records are WITHHELD (nothing to rank), not ranked alphabetically', () => {
  // Every run failed → every recall null and no control scored → there is no
  // rankable measurement. Presenting positions 1/2 would be a meaningless order
  // over zero evidence; the ranking is withheld, and NOT under a "not
  // like-for-like" reason (the records ARE comparable).
  // Both ran with the same explicit cap (so the cap axis is known, not a
  // divergence) and both fully timed out — so the withhold is isolated to lack of
  // evidence, not incomparability.
  const failed = (stamp) =>
    norm(
      record({ runsPerCase: 1, options: { 'max-seconds': 60 }, results: [{ caseDef: caseDef({ id: 'c1', defects: 2 }), runs: [failedRun()] }] }),
      stamp + '.json',
      stamp,
    );
  const comp = buildComparison([failed('a'), failed('b')]);
  assert.equal(comp.rankable, false);
  assert.equal(comp.divergences.length, 0); // like-for-like — withheld for lack of evidence, not divergence
  const out = renderComparison(comp);
  assert.match(out, /Ranking withheld — no record produced a scoreable run/);
  assert.doesNotMatch(out, /not like-for-like/);
});
