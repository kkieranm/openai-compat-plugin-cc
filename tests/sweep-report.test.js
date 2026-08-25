// The morning artifact is the whole product of a sweep, and three of its
// defects were invisible to every classifier test: the classifier held the right
// data and the renderer dropped it on the floor.
//
// So these test the RENDERED TEXT. The rule under test is one sentence — what is
// rendered is decided by what an entry CARRIES, never by what its outcome is
// called — and each test below is one way keying on the outcome went wrong.
//
// WHAT THESE ASSERTIONS DO NOT ESTABLISH. Most match substrings of rendered
// output, so they pin WHICH sentence a row rendered and whether a forbidden
// phrase is absent; the totality test also reads the source tables directly.
// None can tell whether a sentence is TRUE of the row it describes; a false
// sentence here is caught by review, not by this file. So the truth of
// rendered prose is checked by a reader, and the
// sentences are kept to directly observed facts to shrink what a reader has to
// check; treating a green run as evidence that the report is honest is the
// mistake this note exists to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STARVED_WHY, renderSweep, writeSweep } from '../bench/lib/sweep-report.mjs';
// Read from where it is DEFINED, never copied: the totality test below is a
// consumer of the classifier's own list, so relocating that list changes an
// import path here and nothing else.
import { STARVED_REASONS } from '../bench/lib/sweep-outcome.mjs';

const base = {
  startedAt: '2026-08-08T23:00:00.000Z',
  endedAt: '2026-08-09T06:00:00.000Z',
  stoppedBecause: 'every enumerated commit was settled',
  requestedModel: 'qwen/qwen3.6-27b',
  maxSeconds: 900,
  include: ['scripts'],
};

const render = (...entries) => renderSweep({ ...base, enumerated: entries.length, entries });

const commit = (extra) => ({ sha: 'abc1234def', subject: 'a commit', ...extra });

test('a truncated review still shows the findings it managed to produce', () => {
  const out = render(commit({
    outcome: 'truncated',
    analysisCut: true,
    model: 'qwen/qwen3.6-27b',
    findings: [{ file: 'a.mjs', line: 3, summary: 'a real lead', severity: 'high' }],
  }));
  assert.match(out, /a real lead/, 'a lead the model produced must not vanish from the artifact');
  // …but it must not read as a completed review of the commit.
  assert.match(out, /truncated/);
});

// A salvaged review must never read as an ordinary complete one — asserted at the artifact
// level, in the Findings section itself, since that is the ONE place a
// reader scanning for real coverage would otherwise mistake it for a normal
// finding.
test('a salvaged review carries its findings but is visibly flagged, never silent', () => {
  const out = render(commit({
    outcome: 'findings',
    salvaged: true,
    model: 'qwen/qwen3.6-27b',
    findings: [{ file: 'a.mjs', line: 3, summary: 'concluded from partial reasoning', severity: 'low' }],
  }));
  assert.match(out, /concluded from partial reasoning/, 'a lead recovered by salvage must not vanish from the artifact');
  assert.match(out, /SALVAGED/);
});

test('a clean review that only saw the diff says so, though it never reaches coverage', () => {
  const out = render(commit({ outcome: 'clean', hunksOnly: true, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /reviewed only as hunks/);
  // It is a completed review, so it belongs with the reviewed commits rather
  // than in coverage — but it must not pass silently as a full one.
  assert.match(out, /Reviewed, nothing reported/);
});

test('an unsized-window review says WHY, and never re-asserts a measurement', () => {
  // The two notes are separate on purpose. `hunksOnly` is the state and is
  // equally true of `--diff-only`; this is the cause, and it carries a remedy a
  // reader can act on. A single merged sentence would have to guess at one.
  const out = render(commit({
    outcome: 'clean', hunksOnly: true, skippedUnsizedWindow: true, model: 'qwen/qwen3.6-27b', findings: [],
  }));
  assert.match(out, /reviewed only as hunks/, 'the state');
  assert.match(out, /context window could not be determined/, 'and the cause');
  assert.match(out, /contextLength/, 'and the remedy');
  // The forbidden claim, not merely the required ones. Without this the test stays
  // green if the renderer re-appends "did not fit the window" — a MEASUREMENT nobody
  // took, and the precise error the state/cause split exists to prevent.
  assert.doesNotMatch(out, /did not fit/, 'nothing measured this window');
});

test('the state note is scoped to diff-covered files, not to the whole request', () => {
  // It said "only the diff was reviewed" flatly, which is FALSE for a mixed target:
  // collectTarget can pair diff-covered tracked files with untracked or --file bodies that
  // are sent WHOLE and are never droppable.
  const out = render(commit({ outcome: 'clean', hunksOnly: true, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /diff-covered changed files were reviewed only as hunks/);
  assert.match(out, /may still have been sent whole/, 'the pinned files are not covered by this note');
});

test('a diff-only review with no cause recorded does not invent one', () => {
  // `--diff-only`, or any older record predating the field. Attributing this to
  // an unsizeable window sends the reader after a config key that would change
  // nothing — the failure mode the state/cause split exists to prevent.
  const out = render(commit({ outcome: 'clean', hunksOnly: true, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /reviewed only as hunks/);
  assert.doesNotMatch(out, /context window could not be determined/);
  assert.doesNotMatch(out, /contextLength/);
});

test('the report-wide caveat never claims every commit was seen whole', () => {
  // It covers every entry, so it has to be true of the worst one. It said "its
  // changed files in full" flatly, which is false for any diff-only row in the
  // same file — and this section is what a reader weeks later believes.
  const out = render(commit({ outcome: 'clean', hunksOnly: true, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /Commit-local leads/);
  assert.doesNotMatch(out, /its changed files in full/);
});

test('a clean review whose findings were all discarded says how many', () => {
  const out = render(commit({ outcome: 'clean', dropped: 3, model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /3 finding\(s\) the model emitted were discarded/);
});

// The requested-model conflation, one layer up. `requestedModel` exists on a
// failure envelope precisely BECAUSE nothing answered.
test('a failed row never claims a model answered it', () => {
  const out = render(commit({ outcome: 'failed', reason: 'transport', requestedModel: 'qwen/qwen3.6-27b' }));
  assert.doesNotMatch(out, /answered by/, 'nothing answered a failed review');
  assert.match(out, /transport/, 'but the reason it failed must still be shown');
});

test('a completed review does report which model answered it', () => {
  const out = render(commit({ outcome: 'clean', model: 'qwen/qwen3.6-27b', findings: [] }));
  assert.match(out, /answered by/);
});

// The control for the two above: same renderer, same section, opposite data.
// Without it, "never claims a model answered" would also pass against a renderer
// that had simply stopped printing models altogether.
test('coverage rows distinguish failures by their reason, not a generic sentence', () => {
  const out = render(
    commit({ sha: 'aaa1111', outcome: 'failed', reason: 'bad-json' }),
    commit({ sha: 'bbb2222', outcome: 'failed', reason: 'deadline-timeout' }),
  );
  assert.match(out, /bad-json/);
  assert.match(out, /deadline-timeout/);
});

test('the enumerated count comes from the enumeration, not from what got recorded', () => {
  const out = renderSweep({ ...base, enumerated: 40, entries: [commit({ outcome: 'clean', findings: [] })] });
  assert.match(out, /\*\*Enumerated\*\* 40 commits/);
});

// COUNTS, not presence. Its predecessor asserted `assert.match(out, /sha/)`,
// which one occurrence and ten both satisfy — so it had failure power on absence
// and NONE on duplication, the exact half its name advertised. A positive control
// rendered a sha twice and it stayed green.
//
// The fixture matters as much as the assertion: it must contain a NON-REVIEWED
// entry that carries findings, which is the only shape that can be disposed of
// twice. The old fixture could not produce one, so swapping match for a count
// would still not have caught it.
test('every commit is disposed of exactly once', () => {
  const out = render(
    commit({ sha: 'aaa1111', outcome: 'findings', model: 'm', findings: [{ file: 'a', summary: 's' }] }),
    commit({ sha: 'bbb2222', outcome: 'starved', reason: 'token-exhaustion' }),
    commit({ sha: 'ccc3333', outcome: 'skipped-no-code' }),
    commit({ sha: 'ddd4444', outcome: 'clean', model: 'm', findings: [] }),
    // The shape that broke it: not reviewed, yet carrying real leads.
    commit({ sha: 'eee5555', outcome: 'truncated', analysisCut: true, model: 'm', findings: [{ file: 'b', summary: 'lead' }] }),
    commit({ sha: 'fff6666', outcome: 'substituted', model: 'other', findings: [{ file: 'c', summary: 'lead' }] }),
  );
  for (const sha of ['aaa1111', 'bbb2222', 'ccc3333', 'ddd4444', 'eee5555', 'fff6666']) {
    const seen = out.split(sha.slice(0, 9)).length - 1;
    assert.equal(seen, 1, `${sha} was disposed of ${seen} times, not once`);
  }
});

// …and the leads a disqualified review produced still reach the reader, with the
// same detail a completed review's would. Losing them is the failure mode.
test('a disqualified review still shows what it reported, in full', () => {
  const out = render(commit({
    outcome: 'substituted',
    model: 'other-model',
    hunksOnly: true,
    findings: [{ file: 'a.mjs', line: 7, severity: 'high', summary: 'a real lead', evidence: 'the line' }],
  }));
  assert.match(out, /a real lead/);
  assert.match(out, /a\.mjs:7/);
  assert.match(out, /high/);
  assert.match(out, /the line/);
  assert.match(out, /other-model/);
  assert.match(out, /reviewed only as hunks/);
  assert.match(out, /leads only/);
});

test('an empty findings section warns rather than reading as a clean night', () => {
  const out = render(commit({ outcome: 'starved', reason: 'token-exhaustion' }));
  assert.match(out, /Read the coverage section before concluding anything/);
});

// The false-diagnosis this guards against: `starved` now covers a reason that
// never ran out of tokens at all — a `reasoning-only` failure is a stream that
// ended CLEANLY. Sharing token-exhaustion's "ran out of tokens... budget was
// gone" prose for it would tell the reader something that didn't happen.
test('a starved reasoning-only commit is NOT described as having run out of tokens', () => {
  const out = render(commit({ outcome: 'starved', reason: 'reasoning-only' }));
  assert.doesNotMatch(out, /ran out of tokens/);
  assert.doesNotMatch(out, /budget was gone/);
  assert.match(out, /never wrote an answer/);
  assert.match(out, /stream ended cleanly/);
});

// The control: token-exhaustion's own prose must survive this change unchanged.
test('a starved token-exhaustion commit still says it ran out of tokens', () => {
  const out = render(commit({ outcome: 'starved', reason: 'token-exhaustion' }));
  assert.match(out, /ran out of tokens/);
});

// Same false diagnosis, second reason: the watchdog fires at a threshold chosen
// to trip BEFORE the pool is spent, precisely so an answer reserve survives for
// the salvage follow-up. Telling the reader the budget was gone describes the
// failure the cutoff exists to prevent.
test('a starved token-reserve-cutoff commit is NOT described as having run out of tokens', () => {
  const out = render(commit({ outcome: 'starved', reason: 'token-reserve-cutoff' }));
  assert.doesNotMatch(out, /ran out of tokens/);
  assert.doesNotMatch(out, /budget was gone/);
  assert.match(out, /stopped the stream at the reasoning cutoff/);
  assert.match(out, /had not written an answer/);
});

// A starved reason must render prose written for itself, never prose written
// for a different reason: the three differ on whether the token budget was
// actually spent, so sharing a sentence tells the reader something that did not
// happen.
test('every starved reason renders prose of its own', () => {
  assert.ok(STARVED_REASONS.size > 0, 'STARVED_REASONS is empty — the loop below would assert nothing');
  for (const reason of STARVED_REASONS) {
    // Asserted against the TABLE's own value, read before the renderer's
    // guard can substitute for it. A blank or non-string entry is the case
    // this catches, and checking only the rendered output could not: the
    // guard would quietly replace it with the unrecognised sentence and an
    // absence-only assertion would pass.
    const prose = STARVED_WHY[reason];
    assert.equal(typeof prose, 'string', `starved reason ${reason} has no string prose`);
    assert.notEqual(prose.trim(), '', `starved reason ${reason} has blank prose`);
    const out = render(commit({ outcome: 'starved', reason }));
    assert.ok(out.includes(prose), `starved reason ${reason} does not render its own prose`);
  }
  // The other direction. An orphan key is reachable, not hypothetical: a
  // foreign-build ledger can carry a starved row naming a reason this build
  // dropped from the set, and `Object.hasOwn` would then serve stale prose
  // instead of saying it does not recognise the reason.
  for (const key of Object.keys(STARVED_WHY)) {
    assert.ok(STARVED_REASONS.has(key), `STARVED_WHY has prose for ${key}, which is not a starved reason`);
  }
});

// The fail-open regression control. Before the table was made total, an
// unrecognised starved reason inherited token-exhaustion's "ran out of tokens"
// — asserting something that did not happen. Reporting less is this section's
// standing failure mode; reporting something false is worse.
test('an unrecognised starved reason reads as unrecognised, never as having run out of tokens', () => {
  const out = render(commit({ outcome: 'starved', reason: 'some-future-reason' }));
  assert.match(out, /no explanation is defined/);
  assert.doesNotMatch(out, /ran out of tokens/);
  assert.doesNotMatch(out, /budget was gone/);
});

// A reason naming an Object.prototype key must not reach for the prototype's
// value. Two independent guards produce this — the `Object.hasOwn` lookup and
// the value-shape check — so the assertion is on the OUTPUT rather than on
// which of them did the work; either alone would pass it.
test('a starved reason that names an Object.prototype key does not select a function', () => {
  const out = render(commit({ outcome: 'starved', reason: 'toString' }));
  assert.match(out, /no explanation is defined/);
});

// A ledger written by another build can carry a starved row with no usable
// reason at all — `readLedger` validates no shapes and `mergeManifest` passes
// a recovered entry through verbatim.
// Whitespace and the empty string route here with null and undefined: none is
// a code a reader could look up, and the sentence says "no non-blank reason
// code" rather than "nothing was recorded", which whitespace would falsify.
test('every value that is not a usable reason code routes to the no-usable-code sentence', () => {
  for (const reason of [undefined, null, '', '   ']) {
    const out = render(commit({ outcome: 'starved', reason }));
    assert.match(out, /NO USABLE REASON CODE/, `${JSON.stringify(reason)} did not route to the no-usable-code sentence`);
    assert.doesNotMatch(out, /UNUSABLE REASON CODE —/, `${JSON.stringify(reason)} was treated as malformed`);
  }
});

test('a starved row with no reason says so, and promises no code', () => {
  const out = render(commit({ outcome: 'starved', reason: undefined }));
  assert.match(out, /NO USABLE REASON CODE/);
  assert.doesNotMatch(out, /no explanation is defined/);
  assert.doesNotMatch(out, /ran out of tokens/);
});

// The sentences must scope their ignorance to the reason CODE. The row already
// says `starved`, which is itself a why — it separates starvation from crashed,
// truncated, unreadable and the skipped outcomes — so a sentence denying that
// anything is known about why contradicts the line printing it. Pinned
// negatively because a sentence can go false while every string a test matches
// on stays correct.
test('no starved sentence denies knowing what the row itself states', () => {
  for (const reason of [...STARVED_REASONS, 'some-future-reason', undefined, { code: 42 }]) {
    const out = render(commit({ outcome: 'starved', reason }));
    assert.doesNotMatch(out, /nothing is known/, `reason ${String(reason)} denies knowing anything`);
    assert.doesNotMatch(out, /is all that is known/, `reason ${String(reason)} claims to be all that is known`);
  }
});

// The same route can carry a reason that is not a string. That value is still
// something the record knows, so it is rendered rather than discarded — by the
// shared suffix, exactly once, never also inside the sentence.
test('a starved row whose reason is not a string renders the value exactly once', () => {
  const out = render(commit({ outcome: 'starved', reason: { code: 42 } }));
  assert.match(out, /UNUSABLE REASON/);
  assert.doesNotMatch(out, /object Object/);
  assert.doesNotMatch(out, /NO USABLE REASON CODE/);
  assert.equal(out.match(/\{"code":42\}/g)?.length, 1, 'the recorded value must render exactly once');
});

// The regression this suffix exists to fix, and it is NOT a starved row. A
// non-string reason on any other outcome used to print nothing at all: the
// predicate said "not a usable code" and the row dropped the only evidence it
// had. Same unvalidated-ledger route as the starved case.
test('a non-starved row keeps a malformed reason instead of dropping it', () => {
  const out = render(commit({ outcome: 'failed', reason: { kind: 'timeout' } }));
  assert.match(out, /the review failed/);
  assert.match(out, /\{"kind":"timeout"\}/);
  assert.doesNotMatch(out, /object Object/);
});

// The suffix's arms must match the sentence's. A whitespace reason is not a
// usable code, so the row says so — and must not then print the blank value
// beside that sentence.
test('a whitespace reason prints no code beside the sentence saying there is none', () => {
  const out = render(commit({ outcome: 'starved', reason: '   ' }));
  assert.match(out, /NO USABLE REASON CODE/);
  assert.doesNotMatch(out, /recorded reason:/);
  assert.doesNotMatch(out, /\(`\s*`\)/);
});

// A malformed reason is unvalidated ledger content arriving by the same route,
// so it must not be able to break the row it renders into or run off the page.
test('a malformed reason is bounded and cannot break out of its row', () => {
  const long = render(commit({ outcome: 'starved', reason: { note: 'x'.repeat(400) } }));
  assert.match(long, /…/);
  assert.ok(long.split('\n').every((line) => line.length < 400), 'a row ran past its bound');
  const ticked = render(commit({ outcome: 'starved', reason: { note: '`code`' } }));
  assert.match(ticked, /UNUSABLE REASON/);
  assert.doesNotMatch(ticked, /`code`/);
});

// The value is untrusted ledger content landing in a Markdown list item. A
// backtick strip alone is not Markdown-safe: emphasis, links and images all
// alter the report without one.
test('a malformed reason cannot inject Markdown into the report', () => {
  const out = render(commit({
    outcome: 'starved',
    reason: { note: '**forged** [link](http://x) ![img](y) <b>t</b> # h' },
  }));
  assert.match(out, /UNUSABLE REASON/);
  for (const metachar of ['**', '[', ']', '(', ')', '<', '>', '#']) {
    assert.ok(!out.includes(`forged${metachar}`) && !out.includes(`${metachar}forged`), 'emphasis survived');
  }
  assert.doesNotMatch(out, /\[link\]/);
  assert.doesNotMatch(out, /!\[img\]/);
  assert.doesNotMatch(out, /<b>/);
});

// The trust boundary the string arm was assumed not to have. `unrecorded`'s
// reason is `gap.why`, which `sweep-ledger.mjs` sets to the text of a
// filesystem error, so a "reason" reaching this row can be arbitrary and
// unbounded — a backtick in it closes the code span and corrupts the row.
test('a raw error message carried as a reason cannot corrupt or overrun its row', () => {
  const out = render(commit({
    outcome: 'unrecorded',
    reason: `write EACCES, open \`/x/y\` ${'and on '.repeat(40)}`,
  }));
  assert.match(out, /unrecorded/);
  assert.doesNotMatch(out, /`\/x\/y`/, 'a backtick in the message must not survive into the code span');
  const row = out.split('\n').find((line) => line.includes('unrecorded'));
  assert.ok(row.length < 320, `the row ran to ${row.length} chars`);
});

// The control for the test above: an ordinary minted code must survive the same
// path byte-identical. Every reason this codebase mints is lowercase kebab
// ASCII, so normalising them is a no-op — if it ever stops being one, this goes
// red rather than a code quietly rendering mangled.
test('a legitimate reason code renders unchanged through the same path', () => {
  for (const code of ['token-reserve-cutoff', 'non-retryable-transport', 'bad-json', 'model-substituted']) {
    const out = render(commit({ outcome: 'failed', reason: code }));
    assert.match(out, new RegExp(`\\(\`${code}\`\\)`), `${code} did not render verbatim`);
  }
});

// stringify throws on a circular structure, and the whole morning report would
// be lost with it. Losing one row's detail is the acceptable failure here;
// losing the artifact is not.
test('a reason that cannot be stringified still renders a row', () => {
  const circular = { self: null };
  circular.self = circular;
  const out = render(commit({ outcome: 'starved', reason: circular }));
  assert.match(out, /UNUSABLE REASON/);
  assert.match(out, /unrenderable object/);
});

// The window this run walked. Without it the artifact cannot say what it
// enumerated FROM, so two benchmark arms cannot be shown to have reviewed the
// same commits — which is the whole purpose of pinning.
test('the report names the revision it enumerated from', () => {
  const out = renderSweep({ ...base, from: 'abc123def456', enumerated: 1, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.match(out, /Enumerated from.*abc123def456/);
});

// A short arm must not read as a completed one.
test('a run that found fewer commits than asked for says so', () => {
  const short = renderSweep({ ...base, from: 'abc', requestedCommits: 10, eligible: 6, enumerated: 6, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.match(short, /only 6 of the 10 requested commits were eligible/);

  const full = renderSweep({ ...base, from: 'abc', requestedCommits: 10, eligible: 10, enumerated: 10, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.doesNotMatch(full, /requested commits were eligible/, 'a complete run must not carry the warning');
});

// F1: one attribution per commit, not two. The old tests asserted the string was
// PRESENT, which one occurrence and two both satisfy.
test('a coverage row carrying findings names the answering model exactly once', () => {
  const out = render(commit({
    outcome: 'substituted', model: 'other-model',
    findings: [{ file: 'a.mjs', line: 7, summary: 'a lead' }],
  }));
  assert.equal(out.split('other-model').length - 1, 1, 'the model was named more than once for one commit');
});

// L1: the sentence must name WHICH cause applied. A pinned start makes "the
// history simply ran out" routine, and blaming the scan limit sends a reader to
// tune a knob that was never the constraint.
test('a shortfall names the cause the record supports', () => {
  const ranOut = renderSweep({ ...base, from: 'abc', requestedCommits: 10, eligible: 5, scanLimit: 200, walked: 12, enumerated: 12, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.match(ranOut, /only 12 commits are reachable from that revision/);
  assert.doesNotMatch(ranOut, /scan-limit/, 'the scan limit was never approached');

  const hitLimit = renderSweep({ ...base, from: 'abc', requestedCommits: 40, eligible: 5, scanLimit: 12, walked: 12, enumerated: 12, entries: [commit({ outcome: 'clean', model: 'm', findings: [] })] });
  assert.match(hitLimit, /scan-limit.*12/);
});

// L3: analysisCut is rendered from the ENTRY, so an overridden verdict cannot
// erase it. A substituted model whose analysis was also cut used to lose it.
test('a substituted entry whose analysis was cut still says so', () => {
  const out = render(commit({
    outcome: 'substituted', model: 'other', analysisCut: true,
    findings: [{ file: 'a.mjs', summary: 'a lead' }],
  }));
  assert.match(out, /cut off before the model finished looking/);
});

test('the JSON record is private, because it is the only artifact holding raw output', () => {
  // `classify` keeps up to MAX_RAW of each review's stdout AND stderr, and only
  // this file carries them. The ledger beside it is created 0o600 for exactly
  // that material, so a world-readable record made the ledger's privacy
  // decorative. The rendered .md is deliberately NOT included: it emits neither
  // stream, which is what scopes this fix.
  const dir = mkdtempSync(join(tmpdir(), 'sweep-report-mode-'));
  const { reportPath, recordPath } = writeSweep(dir, 'stamp', {
    startedAt: '2026-08-13T09:00:00.000Z',
    endedAt: '2026-08-13T10:00:00.000Z',
    stoppedBecause: 'every enumerated commit was settled',
    include: ['scripts'],
    enumerated: 1,
    entries: [{ sha: 'a', subject: 's', outcome: 'clean' }],
  });
  assert.equal(statSync(recordPath).mode & 0o777, 0o600);
  // The report's own mode is left to the umask, and stating that here keeps the
  // asymmetry deliberate rather than looking like an oversight.
  assert.notEqual(statSync(reportPath).mode & 0o777, 0o600);
});
