// The cross-run reproduction reader's computation: identity, grouping, the
// REVIEWED-only denominator, and the fail-closed integrity guard whose positive
// control proves it is not inert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger, envelopeFor } from '../bench/lib/sweep-ledger.mjs';
import { signatureOf, readRuns, groupRuns, reproductionOf } from '../bench/lib/sweep-reproduction.mjs';
import { renderReproduction } from '../bench/lib/sweep-reproduction-report.mjs';
import { reproduce } from '../bench/sweep-reproduction.mjs';

// A ledger in the `readLedger` shape (header + entries + integrity counts), for
// signatureOf and for the run-shaped helpers below.
function ledger({ header = {}, entries = [], gaps = [], discarded = 0 } = {}) {
  return {
    header: { repo: '/r', include: ['scripts'], maxSeconds: 3600, commits: [], ...header },
    entries,
    gaps,
    discarded,
  };
}

const reviewed = (sha, model, outcome = 'findings') => ({ sha, outcome, model });

// A run object in the shape `readRuns` produces, built through the REAL
// signatureOf so the tests exercise it rather than a hand-rolled signature.
function run(stamp, { header, entries = [], gaps = [], discarded = 0 }) {
  const led = ledger({ header, entries, gaps, discarded });
  const byCommit = new Map(entries.map((e) => [e.sha, e.outcome]));
  return { stamp, header: led.header, signature: signatureOf(led), byCommit, leads: [], integrity: { gaps, discarded } };
}

test('observed model is the model that answered, not the requested one', () => {
  const s = signatureOf(ledger({ header: { requestedModel: null }, entries: [reviewed('a', 'qwen', 'clean'), reviewed('b', 'qwen')] }));
  assert.deepEqual(s.hard.observedModel, { state: 'known', value: 'qwen' });
});

test('a run that reviewed nothing has an unknown observed model', () => {
  const s = signatureOf(ledger({ entries: [{ sha: 'a', outcome: 'starved', model: undefined }] }));
  assert.equal(s.hard.observedModel.state, 'unknown');
});

test('two distinct answering models make the observed model unknown', () => {
  const s = signatureOf(ledger({ entries: [reviewed('a', 'qwen'), reviewed('b', 'llama')] }));
  assert.equal(s.hard.observedModel.state, 'unknown');
});

test('a reviewed entry with no model id fails closed to unknown', () => {
  const s = signatureOf(ledger({ entries: [reviewed('a', null, 'clean')] }));
  assert.equal(s.hard.observedModel.state, 'unknown');
});

test('a second answering model on a non-reviewed entry (substituted/truncated) makes identity unknown', () => {
  // Reviewed by qwen, but a truncated answer came from llama — two models answered.
  const truncated = signatureOf(ledger({ entries: [reviewed('a', 'qwen', 'clean'), reviewed('b', 'llama', 'truncated')] }));
  assert.equal(truncated.hard.observedModel.state, 'unknown');
  const substituted = signatureOf(ledger({ entries: [reviewed('a', 'qwen'), reviewed('b', 'llama', 'substituted')] }));
  assert.equal(substituted.hard.observedModel.state, 'unknown');
});

test('a model-LESS non-reviewed entry does not ungroup a single-model run', () => {
  // A parse-failed unreadable carries no model (no report) — not a second answerer.
  const s = signatureOf(ledger({ entries: [reviewed('a', 'qwen'), { sha: 'b', outcome: 'unreadable', model: undefined }] }));
  assert.deepEqual(s.hard.observedModel, { state: 'known', value: 'qwen' });
});

test('a report-bearing unreadable entry from a SECOND model makes identity unknown', () => {
  // An `unreadable` reply whose report parsed (findings not an array) still carries the
  // model that answered it — a different one here, so the run had two answerers. The
  // answerer set is over every model-bearing entry, not only the clean/findings ones,
  // or this concealment slips through (and `unreadable` is not in the missing-id set).
  const s = signatureOf(ledger({ entries: [reviewed('a', 'qwen', 'clean'), { sha: 'b', outcome: 'unreadable', model: 'llama' }] }));
  assert.equal(s.hard.observedModel.state, 'unknown');
});

test('INTEGRITY GUARD + CONTROL: a lost record makes a run ungroupable; the same run intact groups', () => {
  const entries = [reviewed('a', 'qwen'), reviewed('b', 'qwen', 'clean')];
  const other = run('OTHER', { header: {}, entries: [reviewed('a', 'qwen')] });
  // Positive control: a run with zero gaps/discarded IS groupable with a peer.
  const clean = run('CLEAN', { header: {}, entries });
  assert.equal(signatureOf(ledger({ entries })).hard.integrity.state, 'known');
  assert.ok(groupRuns([clean, other]).find((g) => g.groupable && g.runs.some((r) => r.stamp === 'CLEAN')));
  // Guard fires on a gap → ungroupable singleton, even though the model IS provable.
  const gappy = run('GAP', { header: {}, entries, gaps: [{ sha: 'z', why: 'disk' }] });
  assert.equal(gappy.signature.hard.observedModel.state, 'known'); // model still provable...
  assert.equal(gappy.signature.hard.integrity.state, 'unknown'); // ...but integrity is not
  assert.ok(groupRuns([gappy, other]).find((g) => !g.groupable && g.runs[0].stamp === 'GAP'));
  // ...and on a discarded line.
  const torn = run('TORN', { header: {}, entries, discarded: 1 });
  assert.equal(torn.signature.hard.integrity.state, 'unknown');
  assert.ok(groupRuns([torn, other]).find((g) => !g.groupable && g.runs[0].stamp === 'TORN'));
});

test('an unconfirmed reply (modelReported false) fails the run closed — the requested id was echoed', () => {
  // The server did not name its model, so entry.model is the requested id echoed
  // back — no proof that model answered. Two runs must not group on it.
  const echoed = signatureOf(ledger({ entries: [{ ...reviewed('a', 'qwen', 'clean'), modelReported: false }] }));
  assert.equal(echoed.hard.observedModel.state, 'unknown');
  // Control: the same reply with the server CONFIRMING its model is provable.
  const confirmed = signatureOf(ledger({ entries: [{ ...reviewed('a', 'qwen', 'clean'), modelReported: true }] }));
  assert.deepEqual(confirmed.hard.observedModel, { state: 'known', value: 'qwen' });
});

test('an entry claiming a confirmed model but carrying none fails the run closed', () => {
  // modelReported true asserts the server named a model, but the id is missing — a
  // contradictory record. Not writer-producible, but a corrupt ledger could carry it,
  // and the reader fails closed like integrityAxis does on a malformed record.
  const s = signatureOf(ledger({ entries: [
    { ...reviewed('a', 'qwen', 'clean'), modelReported: true },
    { sha: 'b', outcome: 'unreadable', model: null, modelReported: true },
  ] }));
  assert.equal(s.hard.observedModel.state, 'unknown');
});

test('a malformed (non-boolean, non-null) modelReported fails the run closed', () => {
  // A present value outside the clean tri-state — a corrupt "false" string — cannot
  // prove identity and is not the legacy case; fail closed rather than disclose.
  const s = signatureOf(ledger({ entries: [{ ...reviewed('a', 'qwen', 'clean'), modelReported: 'false' }] }));
  assert.equal(s.hard.observedModel.state, 'unknown');
});

test('a present NULL modelReported reads as legacy (groups + discloses), never malformed', () => {
  // sweep-outcome writes `modelReported: report?.modelReported ?? null`, so a record
  // predating the field is a PRESENT null, not absent. It must stay the disclosed legacy
  // case, not be swept into the malformed→ungroupable branch.
  const nulled = run('NULLED', { header: {}, entries: [{ ...reviewed('x', 'qwen'), modelReported: null }] });
  const confirmed = run('CONFIRMED', { header: {}, entries: [{ ...reviewed('x', 'qwen'), modelReported: true }] });
  assert.deepEqual(nulled.signature.hard.observedModel, { state: 'known', value: 'qwen' });
  assert.equal(nulled.signature.provenance, 'unverified');
  const group = groupRuns([nulled, confirmed]).find((g) => g.groupable);
  assert.equal(group.runs.length, 2);
  assert.deepEqual(reproductionOf(group).caveats.find((c) => c.axis === 'model provenance').runs, ['NULLED']);
});

test('a legacy ledger (no modelReported) groups but is disclosed as provenance-unverifiable', () => {
  // Field absent → grouped on bare entry.model, but the reader is told its identity
  // is unproven. Confirmed vs legacy is a per-run marker that never changes the key.
  const legacy = run('LEGACY', { header: {}, entries: [reviewed('x', 'qwen')] });
  const confirmed = run('CONFIRMED', { header: {}, entries: [{ ...reviewed('x', 'qwen'), modelReported: true }] });
  assert.equal(legacy.signature.provenance, 'unverified');
  assert.equal(confirmed.signature.provenance, 'verified');
  const group = groupRuns([legacy, confirmed]).find((g) => g.groupable);
  assert.equal(group.runs.length, 2); // same model id → one group despite differing provenance
  const caveat = reproductionOf(group).caveats.find((c) => c.axis === 'model provenance');
  assert.deepEqual(caveat.runs, ['LEGACY']);
  // A fully-confirmed group draws NO provenance caveat.
  const c2 = run('C2', { header: {}, entries: [{ ...reviewed('x', 'qwen'), modelReported: true }] });
  const allConfirmed = reproductionOf(groupRuns([confirmed, c2]).find((g) => g.groupable));
  assert.equal(allConfirmed.caveats.some((c) => c.axis === 'model provenance'), false);
});

test('an explicit unconfirmed reply (modelReported false) fails closed even carrying no model id', () => {
  // A report-bearing `unreadable` reply the server did not confirm carries no model
  // string, so it is not an answerer — but its explicit `false` is still an unconfirmed
  // answer, checked over EVERY entry. Scoping the check to model-bearing entries would
  // let this run read as verified and group.
  const s = signatureOf(ledger({ entries: [
    { ...reviewed('a', 'qwen', 'clean'), modelReported: true },
    { sha: 'b', outcome: 'unreadable', model: undefined, modelReported: false },
  ] }));
  assert.equal(s.hard.observedModel.state, 'unknown');
});

test('an answer-bearing entry with no model id fails closed, even when it is not a REVIEWED outcome', () => {
  // A truncated reply ran a model but named none — its identity is unprovable, so the
  // run cannot claim one. Distinct from the two-models case: here the id is MISSING.
  const s = signatureOf(ledger({ entries: [reviewed('a', 'qwen', 'clean'), { sha: 'b', outcome: 'truncated', model: null }] }));
  assert.equal(s.hard.observedModel.state, 'unknown');
});

test('INTEGRITY GUARD + CONTROL: a commit recorded twice makes a run ungroupable; unique shas stay intact', () => {
  const other = run('OTHER', { header: {}, entries: [reviewed('a', 'qwen')] });
  // Control: distinct shas → intact, groups with a peer.
  const unique = run('UNIQUE', { header: {}, entries: [reviewed('a', 'qwen'), reviewed('b', 'qwen', 'clean')] });
  assert.equal(unique.signature.hard.integrity.state, 'known');
  assert.ok(groupRuns([unique, other]).find((g) => g.groupable && g.runs.some((r) => r.stamp === 'UNIQUE')));
  // Guard: the same sha twice (contradictory outcomes byCommit would silently collapse) → ungroupable.
  const dup = run('DUP', { header: {}, entries: [reviewed('a', 'qwen', 'findings'), reviewed('a', 'qwen', 'clean')] });
  assert.equal(dup.signature.hard.integrity.state, 'unknown');
  assert.ok(groupRuns([dup, other]).find((g) => !g.groupable && g.runs[0].stamp === 'DUP'));
});

test('a soft axis is known when the header records it, unknown when it does not', () => {
  const withKnob = signatureOf(ledger({ header: { diffOnly: true } }));
  assert.deepEqual(withKnob.soft.diffOnly, { state: 'known', value: true });
  const legacy = signatureOf(ledger({}));
  assert.equal(legacy.soft.diffOnly.state, 'unknown');
});

test('groupRuns groups runs sharing hard axes and isolates an ungroupable run', () => {
  const a = run('A', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen'), reviewed('y', 'qwen', 'clean')] });
  const b = run('B', { header: { diffOnly: false }, entries: [reviewed('x', 'qwen', 'clean')] });
  const lost = run('C', { header: {}, entries: [reviewed('x', 'qwen')], gaps: [{ sha: 'q', why: 'disk' }] });
  const groups = groupRuns([a, b, lost]);
  const groupable = groups.find((g) => g.groupable);
  assert.deepEqual(groupable.runs.map((r) => r.stamp).sort(), ['A', 'B']);
  const singleton = groups.find((g) => !g.groupable);
  assert.deepEqual(singleton.runs.map((r) => r.stamp), ['C']);
});

test('the reproduction denominator counts only REVIEWED runs, never a starved one', () => {
  const a = run('A', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  const b = run('B', { header: { diffOnly: true }, entries: [{ sha: 'x', outcome: 'starved', model: undefined }] });
  // B's observed model is unknown (it reviewed nothing) → ungroupable. So build B as a reviewed run
  // of a DIFFERENT commit so it groups, but starved on the shared sha x.
  const b2 = run('B', { header: { diffOnly: true }, entries: [reviewed('y', 'qwen', 'clean'), { sha: 'x', outcome: 'starved', model: undefined }] });
  const group = groupRuns([a, b2]).find((g) => g.groupable);
  const result = reproductionOf(group);
  const rowX = result.rows.find((r) => r.sha === 'x');
  assert.equal(rowX.n, 1); // only A reviewed x; B starved on it
  assert.equal(rowX.flagged, true); // n < 2, no reproduction claim
});

test('a commit reviewed by two runs with the same finding-state reproduces', () => {
  const a = run('A', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  const b = run('B', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  const group = groupRuns([a, b]).find((g) => g.groupable);
  const rowX = reproductionOf(group).rows.find((r) => r.sha === 'x');
  assert.equal(rowX.n, 2);
  assert.equal(rowX.k, 2);
  assert.equal(rowX.reproduced, true);
});

test('a commit finding-bearing in one run and clean in another does NOT reproduce', () => {
  const a = run('A', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen', 'findings')] });
  const b = run('B', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen', 'clean')] });
  const rowX = reproductionOf(groupRuns([a, b]).find((g) => g.groupable)).rows.find((r) => r.sha === 'x');
  assert.equal(rowX.n, 2);
  assert.equal(rowX.reproduced, false);
});

test('two distinct KNOWN soft-axis values suppress the group and name the axis', () => {
  const a = run('A', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  const b = run('B', { header: { diffOnly: false }, entries: [reviewed('x', 'qwen')] });
  // Same observed model + repo + include + maxSeconds → groupable; diffOnly diverges as a KNOWN pair.
  const group = groupRuns([a, b]).find((g) => g.groupable);
  const result = reproductionOf(group);
  assert.equal(result.suppressed, true);
  assert.equal(result.suppressions[0].axis, 'diffOnly');
});

test('an unknown soft axis discloses a caveat naming the runs, but still compares', () => {
  const a = run('A', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  const b = run('B', { header: {}, entries: [reviewed('x', 'qwen')] }); // legacy: diffOnly unknown
  const group = groupRuns([a, b]).find((g) => g.groupable);
  const result = reproductionOf(group);
  assert.equal(result.suppressed, false);
  const caveat = result.caveats.find((c) => c.axis === 'diffOnly');
  assert.deepEqual(caveat.runs, ['B']);
});

test('readRuns reads real ledgers and refuses one with no usable header', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-repro-'));
  const led = openLedger(dir, 'stamp-a');
  led.header(envelopeFor({ include: ['scripts'], abortAfter: 3, maxSeconds: 3600, diffOnly: false, maxAttempts: 3, provider: 'lmstudio' }, [{ sha: 'a', eligible: true }], 0));
  led.entry({ sha: 'a', outcome: 'findings', findings: [{ summary: 'x' }], model: 'qwen' });
  const [runObj] = readRuns([led.path]);
  assert.equal(runObj.byCommit.get('a'), 'findings');
  assert.deepEqual(runObj.signature.soft.provider, { state: 'known', value: 'lmstudio' });

  const noHeader = openLedger(dir, 'stamp-b');
  noHeader.entry({ sha: 'a', outcome: 'clean', model: 'qwen' });
  assert.throws(() => readRuns([noHeader.path]), /no usable header/);
});

test('leads carry truncated/substituted findings but never enter the rate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-repro-'));
  const led = openLedger(dir, 'stamp-c');
  led.header(envelopeFor({ include: ['scripts'], abortAfter: 3, maxSeconds: 3600, diffOnly: false, maxAttempts: 3 }, [], 0));
  led.entry({ sha: 'a', outcome: 'truncated', findings: [{ summary: 'lead' }], model: 'qwen' });
  led.entry({ sha: 'b', outcome: 'clean', findings: [], model: 'qwen' });
  const [runObj] = readRuns([led.path]);
  assert.deepEqual(runObj.leads.map((l) => l.sha), ['a']);
  // 'a' is truncated → not REVIEWED → not a reproduction row.
  const group = { groupable: true, runs: [runObj, { ...runObj, stamp: 'dup' }] };
  const result = reproductionOf(group);
  assert.equal(result.rows.some((r) => r.sha === 'a'), false);
});

test('a run with no recorded repo or include fails closed to ungroupable', () => {
  const other = run('OTHER', { header: {}, entries: [reviewed('x', 'qwen')] });
  const noRepo = run('NOREPO', { header: { repo: undefined }, entries: [reviewed('x', 'qwen')] });
  assert.equal(noRepo.signature.hard.repo.state, 'unknown');
  assert.ok(groupRuns([noRepo, other]).find((g) => !g.groupable && g.runs[0].stamp === 'NOREPO'));
  const noInclude = run('NOINC', { header: { include: 'scripts' }, entries: [reviewed('x', 'qwen')] });
  assert.equal(noInclude.signature.hard.include.state, 'unknown');
  assert.ok(groupRuns([noInclude, other]).find((g) => !g.groupable && g.runs[0].stamp === 'NOINC'));
});

test('a repeated --include value groups with the deduped set, not as a singleton', () => {
  // `--include scripts --include scripts` records ['scripts','scripts']; it is the
  // same include set as ['scripts'] and must group with it, not split off. Removing
  // the reader-side dedup (Set) makes the two group keys differ and this fails.
  const once = run('ONCE', { header: { include: ['scripts'] }, entries: [reviewed('x', 'qwen')] });
  const twice = run('TWICE', { header: { include: ['scripts', 'scripts'] }, entries: [reviewed('x', 'qwen')] });
  assert.deepEqual(twice.signature.hard.include.value, ['scripts']);
  const groups = groupRuns([once, twice]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupable, true);
  assert.deepEqual(groups[0].runs.map((r) => r.stamp).sort(), ['ONCE', 'TWICE']);
});

test('a named provider vs a null one SUPPRESSES, but two null providers only DISCLOSE', () => {
  const named = run('NAMED', { header: { provider: 'lmstudio' }, entries: [reviewed('x', 'qwen')] });
  const adhoc = run('ADHOC', { header: { provider: null }, entries: [reviewed('x', 'qwen')] });
  const mixed = reproductionOf(groupRuns([named, adhoc]).find((g) => g.groupable));
  assert.equal(mixed.suppressed, true);
  assert.ok(mixed.suppressions.find((s) => s.axis === 'provider'));
  const adhoc2 = run('ADHOC2', { header: { provider: null }, entries: [reviewed('x', 'qwen')] });
  const bothNull = reproductionOf(groupRuns([adhoc, adhoc2]).find((g) => g.groupable));
  assert.equal(bothNull.suppressed, false);
  assert.deepEqual(bothNull.caveats.find((c) => c.axis === 'provider').runs.sort(), ['ADHOC', 'ADHOC2']);
});

test('finding-bearing aggregate counts only the comparable (n>=2) population', () => {
  const a = run('A', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen'), reviewed('y', 'qwen', 'findings')] });
  const b = run('B', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  const result = reproductionOf(groupRuns([a, b]).find((g) => g.groupable));
  // x is finding-bearing at n=2; y is finding-bearing at n=1 (flagged) and must NOT count.
  assert.equal(result.aggregate.findingBearingCommits, 1);
});

test('finding-bearing REPRODUCTION counts only commits every reviewing run found a finding on', () => {
  // x: both runs found a finding (reproduced). y: A found, B clean (finding-bearing, NOT reproduced).
  const a = run('A', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen', 'findings'), reviewed('y', 'qwen', 'findings')] });
  const b = run('B', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen', 'findings'), reviewed('y', 'qwen', 'clean')] });
  const agg = reproductionOf(groupRuns([a, b]).find((g) => g.groupable)).aggregate;
  assert.equal(agg.findingBearingCommits, 2); // x and y both k>0
  assert.equal(agg.findingBearingReproduced, 1); // only x has k === n
  // The overall-unanimity figure would report x reproduced AND nothing about y's disagreement being
  // finding-related — the whole reason the finding-bearing rate is reported separately.
});

test('a malformed sha-less entry makes the run ungroupable, never an undefined row', () => {
  const other = run('OTHER', { header: {}, entries: [reviewed('a', 'qwen')] });
  const malformed = run('BAD', { header: {}, entries: [{ outcome: 'findings', model: 'qwen' }] }); // no sha
  assert.equal(malformed.signature.hard.integrity.state, 'unknown');
  assert.ok(groupRuns([malformed, other]).find((g) => !g.groupable && g.runs[0].stamp === 'BAD'));
});

test('RENDER: a gap sha appears in the per-run gap section, never in a group matrix', () => {
  // The plan's approved coverage bar. A gap makes its run ungroupable, so the lost sha
  // must surface in the integrity section and NEVER be collapsed into a matrix's
  // not-reviewed cell — a settled-but-lost write is a different fact from an unreached
  // commit. Two clean runs form a real matrix beside the gap run so both halves show.
  const a = run('AAA', { header: { diffOnly: true }, entries: [{ ...reviewed('x', 'qwen'), modelReported: true }] });
  const b = run('BBB', { header: { diffOnly: true }, entries: [{ ...reviewed('x', 'qwen'), modelReported: true }] });
  const gap = run('GGG', { header: {}, entries: [{ ...reviewed('m', 'qwen'), modelReported: true }], gaps: [{ sha: 'deadbeefcafe', why: 'ENOSPC disk full' }] });
  const md = renderReproduction([a, b, gap]);
  assert.match(md, /Lost records/);
  assert.match(md, /deadbeefc/); // the short gap sha is named
  // It must not appear inside a matrix table row (a `| … |` line).
  const inMatrixRow = md.split('\n').some((line) => line.startsWith('|') && line.includes('deadbeefc'));
  assert.equal(inMatrixRow, false, 'the gap sha must never be a matrix cell');
});

test('RENDER: a lead row carries the commit subject', () => {
  // The subject is collected onto leads and must reach the reader (plan Phase 3); the
  // sha alone identifies the commit, the subject makes the row human-readable.
  const withLead = run('LEAD', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  withLead.leads = [{ sha: 'abc123def', subject: 'fix the widget', outcome: 'truncated', count: 2 }];
  const peer = run('PEER', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  const md = renderReproduction([withLead, peer]);
  assert.match(md, /fix the widget/);
});

test('RENDER: a legacy (unverified-provenance) group discloses the model-provenance caveat', () => {
  const a = run('AAA', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] }); // no modelReported → legacy
  const b = run('BBB', { header: { diffOnly: true }, entries: [reviewed('x', 'qwen')] });
  const md = renderReproduction([a, b]);
  assert.match(md, /model provenance/);
  assert.match(md, /Reproduction:/); // it still reports a rate — disclosed, not withheld
});

test('the CLI collapses a copied ledger (same startedAt) to one distinct run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-repro-copy-'));
  const env = envelopeFor({ include: ['scripts'], abortAfter: 3, maxSeconds: 3600, diffOnly: false, maxAttempts: 3 }, [], 0);
  const a = openLedger(dir, 'stamp-e1'); a.header(env); a.entry({ sha: 'a', outcome: 'findings', findings: [{ summary: 'x' }], model: 'qwen' });
  const b = openLedger(dir, 'stamp-e2'); b.header(env); b.entry({ sha: 'a', outcome: 'findings', findings: [{ summary: 'x' }], model: 'qwen' });
  assert.throws(() => reproduce([a.path, b.path]), /aliases and copies of one run count as one/);
});

test('the CLI REFUSES two ledgers that claim the same run but differ in content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-repro-clash-'));
  const env = envelopeFor({ include: ['scripts'], abortAfter: 3, maxSeconds: 3600, diffOnly: false, maxAttempts: 3 }, [], 0);
  // Same startedAt (same env) but DIFFERENT content → contradictory, not a copy.
  const a = openLedger(dir, 'stamp-f1'); a.header(env); a.entry({ sha: 'a', outcome: 'findings', findings: [{ summary: 'x' }], model: 'qwen' });
  const b = openLedger(dir, 'stamp-f2'); b.header(env); b.entry({ sha: 'b', outcome: 'clean', findings: [], model: 'qwen' });
  assert.throws(() => reproduce([a.path, b.path]), /claim the same run/);
});

test('the CLI needs at least two distinct ledgers and de-dupes a repeated path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-repro-cli-'));
  const led = openLedger(dir, 'stamp-d');
  led.header(envelopeFor({ include: ['scripts'], abortAfter: 3, maxSeconds: 3600, diffOnly: false, maxAttempts: 3 }, [], 0));
  led.entry({ sha: 'a', outcome: 'findings', findings: [{ summary: 'x' }], model: 'qwen' });
  assert.throws(() => reproduce([led.path]), /at least two distinct ledgers/);
  // The same path twice de-dupes to one run → still "at least two" fails, never a
  // fabricated self-agreement.
  assert.throws(() => reproduce([led.path, led.path]), /at least two distinct ledgers/);
});
