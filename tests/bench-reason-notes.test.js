import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptRows } from '../bench/lib/attempt-rows.mjs';
import { createLedger } from '../scripts/lib/attempt-ledger.mjs';
import { REASON_PARAGRAPHS, RECORD_FIELDS } from '../bench/lib/reason-notes.mjs';
import { renderReport } from '../bench/lib/report.mjs';
import { CASE, failedAttempt } from './bench-report-fixtures.mjs';

// `Failures by reason` is a bare count table, and several of its codes are ones
// a reader will misread in exactly the direction the attempt record exists to
// prevent: `shape-rejected` sits among the delivery failures and is a client
// stop; `transport` is a retryability verdict rather than a count of server
// misbehaviour; and `non-retryable-transport` says only that a retry was not
// attempted — not that the peer was reached. `ENOTFOUND` carries that reason
// and reaches nothing.
//
// `ECONNREFUSED` must not be paired with `ENOTFOUND` as a code that "reached
// nothing": `ENOTFOUND` provably contacted nothing, while a refused connection
// is an active refusal whose origin — the host, a middlebox, or the local
// stack itself — the code alone does not identify. Reachability varies across
// these codes and the table does not settle it, while a separate and narrower
// question — was an HTTP RESPONSE obtained — is settled, by `serverResponded`.
//
// This suite asks whether the prose explaining a reason code claims only what
// the record holds, and which paragraphs the gating prints at all — distinct
// from `bench-reliability.test.js`, which asks whether every request is
// accounted for. Each guard below carries the mutation that proves it is not
// passing for the wrong reason.

/** One outright-failed run whose single attempt died with `reason`. */
const deadRunWith = (reason) => ({
  diffOnly: false, error: 'boom', reason, requestedModel: 'm', attempts: [failedAttempt(reason)],
});

const renderWith = (reason) => renderReport([{ caseDef: CASE, runs: [deadRunWith(reason)] }], {
  runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
});

/** One paragraph out of the report, so a negative assertion names the prose it judges. */
function paragraphAbout(markdown, code) {
  const found = markdown.split('\n').find((line) => line.startsWith(`\`${code}\` below`));
  assert.ok(found, `no paragraph rendered for \`${code}\``);
  return found;
}

test('shape-rejected is explained as the terminal twin of refused, not as a dropped request', () => {
  const markdown = renderWith('shape-rejected');
  // Scoped to the paragraph. The document-wide version of this passed on the
  // COUNT-TABLE row `| \`shape-rejected\` | 1 |` — proved by gutting the whole
  // paragraph and watching it stay green — so it asserted the failure was
  // counted, never that it was explained.
  const para = paragraphAbout(markdown, 'shape-rejected');
  assert.match(para, /terminal twin of the `refused` outcome/);
  assert.match(para, /nothing replaced it/, 'the whole point: no replacement was ever dispatched');
  assert.match(para, /not a server dropping requests/);
});

test('non-retryable-transport claims a retry decision, never that a peer was or was not reached', () => {
  // Scoped to the paragraph, not the whole report. The sibling `shape-rejected`
  // paragraph legitimately says "never reached the wire" about the CLIENT's own
  // outbound request, so a report-wide negative here fails on innocent prose and
  // names this paragraph for it.
  const markdown = renderWith('non-retryable-transport');
  const para = paragraphAbout(markdown, 'non-retryable-transport');
  assert.match(para, /before any response was obtained/);
  // The gate, from the direction with teeth. `transport` is a SUBSTRING of this
  // code, so `sawReason`'s `key === code` is one loosened operator from printing
  // the `transport` paragraph here — asserting "a further attempt could
  // plausibly survive" about a code that by definition was never retried. Proved
  // by mutation: `key.includes(code)` left all 404 tests green. The sibling that
  // looks like it covers this asserts only the reverse containment, which stays
  // true under exactly that edit.
  assert.doesNotMatch(markdown, /^`transport` below/m);
  // The claim that was WRONG and had to be withdrawn: `ENOTFOUND` and
  // `ECONNREFUSED` are outside the transient whitelist, so they carry this
  // reason — and reachability is not uniform across the codes that do. Saying
  // "not a reachability finding" of the whole code asserted a fact that is false
  // of part of it.
  assert.doesNotMatch(para, /not a reachability finding/);
  // Both still NAMED — `ENOTFOUND` as the contacted-nothing case,
  // `ECONNREFUSED` as the origin-unknown one. A regex asserting only presence
  // cannot see which role each plays, so it is the paragraph's own clauses that
  // carry that, and this pair only stops the exceptions being generalised away
  // entirely.
  assert.match(para, /ENOTFOUND/, 'the exceptions must be named, not generalised away');
  assert.match(para, /ECONNREFUSED/);
  // The withdrawn draft attributed the refusal's reset to the destination host,
  // which neither POSIX nor the wire licenses — a local REJECT rule synthesizes
  // the same errno with nothing ever sent.
  assert.doesNotMatch(para, /host itself answering/);
  // Full-span on purpose: a pin ending at "middlebox" let the local-stack
  // clause — the half that licenses the whole hedge — be deleted unnoticed.
  assert.match(para, /whose origin — the host, a middlebox in front of it, or the local stack itself — the code alone does not identify/);
  // The scope qualifier, bound for the same reason: without it the enumeration
  // reads as a claim about every record the report can render, and a legacy
  // record from an older build can lack a field.
  assert.match(para, /An attempt record this build writes carries/);
  // The enumeration itself, pinned label by label from the export — membership
  // in the prose, not the join's formatting, which gets ordinary review. One
  // label is vacuous here: `serverResponded`'s reappears in the closing
  // sentence, so its containment alone cannot prove the enumeration prints —
  // the other nine carry that.
  for (const [, label] of RECORD_FIELDS) {
    assert.ok(para.includes(label), `the record enumeration lost "${label}"`);
  }
  // The two axes, kept apart. Removing the response clause would leave the report
  // rendering a `serverResponded` column the prose never accounts for; removing
  // the hedge would claim a reachability finding this record still cannot make.
  assert.match(para, /whether an HTTP response was obtained/);
  assert.match(para, /cannot \*\*always\*\* tell you which/);
  assert.doesNotMatch(para, /was unreachable|unreachable host|server was down|could not reach/);
});

test('the transport disclaimer prints for a transport-only sweep, which is when it is needed', () => {
  // The defect this locks out: the disclaimer used to live inside the
  // `non-retryable-transport` block, so a sweep of pre-response EAI_AGAIN or
  // ECONNRESET — every one of them tagged `transport` — printed a bare row with
  // nothing anywhere forbidding the server-blame reading.
  const para = paragraphAbout(renderWith('transport'), 'transport');
  // One branch, not an alternation over the emphasis. The pair it replaced
  // passed whether or not the `**` was there, so it pinned nothing about the
  // thing its two branches disagreed on.
  assert.match(para, /\*\*not\*\* a count of server misbehaviour/);
  assert.match(para, /EAI_AGAIN/);
  assert.doesNotMatch(para, /non-retryable-transport/, 'it must stand on its own code, not a neighbour\'s');
});

// Three drafts of this paragraph tried to tell the reader where the underlying
// error code could be found, and review refuted all three. The last is why the
// promise is gone rather than reworded: whether a dead run's message names the
// code depends entirely on the error, and the paragraph's own examples are the
// ones where it does not.
//
// BOTH failures in ONE document, on purpose. This replaced a parametrised pair
// whose comment claimed it "proves the difference" and which proved nothing —
// every assertion was against static prose gated on a reason code, so neither
// fixture was read, and turning both to junk left the suite green. A pair is
// evidence only when its halves assert DIFFERENT things, so each gets its own
// witness below.
test('the non-retryable-transport paragraph promises nothing about the cause', () => {
  const syscall = deadRunWith('non-retryable-transport');
  syscall.error = 'Request to localhost:1234 failed: connect EHOSTUNREACH 10.0.0.1:1234';
  // The real TLS wording, per tests/transport-classification.test.js — code
  // CERT_HAS_EXPIRED, message "certificate has expired", which names no code.
  const tls = deadRunWith('non-retryable-transport');
  tls.error = 'Request to localhost:1234 failed: certificate has expired';
  const markdown = renderReport([{ caseDef: CASE, runs: [syscall, tls] }], {
    runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
  });

  const para = paragraphAbout(markdown, 'non-retryable-transport');
  assert.doesNotMatch(para, /not carried in this report/, 'refuted draft 2');
  assert.doesNotMatch(para, /names the underlying code|read `?\.code/, 'refuted drafts 1 and 3');
  // It may enumerate what the record holds, and that is all. The enumeration
  // itself is pinned against a real ledger entry by the tripwire below.
  assert.match(para, /a \*\*measured\*\* timing proves the model was reached/);
  // No UNIQUENESS claim. A draft said 'only one of those bears on' the
  // question, naming the prefill — false, because a measured generation timing
  // proves the model was reached just as well. The claim is about DIRECTION:
  // the record settles reachability positively, never negatively.
  assert.doesNotMatch(para, /only one of those/);
  assert.match(para, /the one direction this record settles/);
  // The ASYMMETRY clause, pinned on its own. A regex matching only the sentence
  // around it would survive deletion of this qualifier — which is finding (4)
  // of this very item regenerating at its own fix site. The clause exists
  // because a flat "none of these fields tells you" contradicted `firstTextNote`
  // in the same document, which says a measured prefill proves the model was
  // reached — and contradicted the very next clause of its own sentence.
  assert.match(para, /the absence is the absence of a measurement/);
  // The prior-attempt caveat, pinned on its own: `warmEligible` DOES bear on
  // whether the endpoint was ever reached, just not by this attempt, and a
  // sentence saying 'only one field bears on it' without this clause was the
  // last overclaim a reviewer had to remove.
  assert.match(para, /speaks for that one and not this/);
  // And the hedge itself. "cannot **always** tell you which" is the difference
  // between a true sentence and the categorical one two drafts shipped; a regex
  // that ignored it would pass on either.
  assert.match(para, /cannot \*\*always\*\* tell you which/);
  // Where the two fixtures finally differ. The listing prints each dead run's
  // stderr verbatim, so the syscall message carries its code and the TLS one
  // carries none — the asymmetry that made "the listing usually names it"
  // false. The TLS message is asserted PRESENT as well as its code ABSENT: a
  // bare negative also passes if that run vanishes from the listing.
  assert.match(markdown, /^## Logical runs that did not complete$/m);
  assert.match(markdown, /EHOSTUNREACH/);
  assert.match(markdown, /certificate has expired/);
  assert.doesNotMatch(markdown, /CERT_HAS_EXPIRED/);
});

test('the paragraph enumerates a closed record, and this is the list it enumerates', () => {
  // The paragraph says what an attempt record HOLDS, so what is pinned here is
  // the whole list — not the absence of one field. An earlier draft asserted
  // `Object.hasOwn(entry, 'serverResponded') === false` against prose claiming
  // "no peer-reachability field", and the two could drift apart in both
  // directions: a field named anything else falsifies the prose while that
  // assertion stays green, and `serverResponded` is not peer-reachability
  // anyway — a TLS rejection reaches a peer and obtains no response.
  //
  // Pinning the full key set couples this to every ledger addition ON PURPOSE.
  // A new field is exactly when a human must re-read the sentence, and the
  // record shape is deliberately stable so other runs can be differenced against it.
  //
  // What this does NOT do: check the LABELS. Membership is mechanised because
  // membership is what drifted — the first draft transcribed eight of the nine
  // fields that existed at the time
  // with this test green, and a reviewer found the missing `outcome`. The
  // reader-facing wording in `RECORD_FIELDS` is ordinary prose and gets
  // ordinary review.
  //
  // Read AFTER `fail()` closes the entry, never off the freshly minted one —
  // `fail()` is where the entry copies its flag across, so a check against the
  // constructor's shape alone would miss a field added there.
  const ledger = createLedger();
  const handle = ledger.begin({
    body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    cause: { answerAttempt: 1, degrade: null },
  });
  handle.fail({ reason: 'non-retryable-transport', serverResponded: true }, {});
  const [entry] = ledger.entries();

  assert.equal(entry.outcome, 'failed');
  assert.equal(entry.reason, 'non-retryable-transport');
  // Against RECORD_FIELDS, not a second transcription of the same ten names —
  // a literal list here would be one more mirror to drift. BOTH sides sorted,
  // so reordering the labels for readability cannot fail a test about nothing.
  assert.deepEqual(
    Object.keys(entry).sort(),
    RECORD_FIELDS.map(([field]) => field).sort(),
    'the ledger gained or lost a field — give it a reader label in `RECORD_FIELDS`, then re-read the paragraph',
  );
});

test('every way an entry can close leaves the same ten fields, so the paragraph describes them all', () => {
  // The test above drives ONE path. The paragraph speaks for every row in the
  // table, so a closing path with a different key set would have it describing
  // entries it never saw. That cannot happen — `newEntry` creates all ten up
  // front and the closers only ASSIGN to them — but "cannot happen by
  // construction" is a claim, and this repo has been wrong three times about
  // what needs no test.
  //
  // JSON round-tripped, because that is the form the report is rendered from:
  // it also pins that `markRefused` stays non-enumerable and never appears as
  // an ELEVENTH field.
  const expected = RECORD_FIELDS.map(([field]) => field).sort();
  const body = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
  const cause = { answerAttempt: 1, degrade: null };

  const ledger = createLedger();
  ledger.begin({ body, cause }).settle({ prefillMs: 12, generationMs: 34 });
  ledger.begin({ body, cause }).fail({ reason: 'transport' }, { prefillMs: 7 });
  // The refusal path: `refuse` closes it, and the NEXT `begin` reclassifies it.
  ledger.begin({ body, cause }).refuse({ reason: null });
  ledger.begin({ body, cause }).fail({ reason: 'shape-rejected' }, {});

  const serialized = JSON.parse(JSON.stringify(ledger.entries()));
  assert.equal(serialized.length, 4);
  for (const [n, entry] of serialized.entries()) {
    assert.deepEqual(Object.keys(entry).sort(), expected, `entry ${n + 1} closed with a different shape`);
  }
  // And the paths really were different, or the loop above proves nothing.
  assert.deepEqual(serialized.map((e) => e.outcome), ['answered', 'failed', 'refused', 'failed']);

  // The ENVELOPE the report actually walks, not just the ledger's own array.
  // `attemptRows` reads `run.report.attempts` (and `run.attempts` on the failure
  // path), so the ten fields have to survive into THAT shape — the paragraph
  // describes the rows a reader sees, which arrive this way and no other.
  const stats = attemptRows([{ caseDef: CASE, runs: [
    { diffOnly: false, report: { parsed: true, findings: [], attempts: serialized.slice(0, 2) } },
    { diffOnly: false, error: 'boom', reason: 'transport', attempts: serialized.slice(2) },
  ] }]);
  assert.equal(stats.total, 4, 'every entry reached the reader through one envelope or the other');
});

test('the shape-rejected paragraph follows the refused one it calls itself the twin of', () => {
  // The combination the gates make easy to
  // get wrong: the paragraph names `refused` because both are gated, so ORDER is
  // what makes the pair readable rather than a forward reference to prose that
  // may not print at all.
  const refused = {
    index: 1, cause: { answerAttempt: 1, degrade: null }, warmEligible: false, waitedMs: 0,
    outcome: 'refused', reason: null, prefillMs: null, generationMs: null,
  };
  const run = deadRunWith('shape-rejected');
  run.attempts = [refused, failedAttempt('shape-rejected')];
  const markdown = renderReport([{ caseDef: CASE, runs: [run] }], {
    runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false,
  });

  const refusedAt = markdown.indexOf('refused for their shape');
  const twinAt = markdown.indexOf('terminal twin of the `refused` outcome');
  assert.ok(refusedAt > -1 && twinAt > -1, 'both paragraphs print');
  assert.ok(refusedAt < twinAt, 'the twin reference must point BACKWARDS at printed prose');
});

test('token-reserve-cutoff is explained as a client-side cutoff, never a server symptom', () => {
  const markdown = renderWith('token-reserve-cutoff');
  const para = paragraphAbout(markdown, 'token-reserve-cutoff');
  assert.match(para, /\*\*client-side\*\* cutoff, not a server symptom/);
  assert.match(para, /never retried/);
  // The withdrawn claim: a displayed cutoff row can belong to a salvage-RESCUED
  // run (the failed original's row survives beside the winning follow-up), so
  // the paragraph may not assert every row is one nothing recovered.
  assert.doesNotMatch(para, /neither attempt could recover/);
  assert.match(para, /may have been answered by a follow-up/);
  // Conditional on purpose: a follow-up grown past the context window is
  // refused before any request is sent, so no row exists for it.
  assert.match(para, /actually sent appears as its own row/);
  // The watchdog preserves the answer reserve by a conservative character
  // estimate — it does not run the pool dry, and the paragraph may not say so.
  assert.match(para, /conservative character threshold intended to preserve the answer reserve/);
});

test('reasoning-only is explained as a client classification, never a transport failure', () => {
  const para = paragraphAbout(renderWith('reasoning-only'), 'reasoning-only');
  assert.match(para, /never a transport failure and never a server drop/);
  assert.match(para, /no non-whitespace answer content but non-whitespace reasoning/);
  assert.match(para, /original request.*or a losing salvage follow-up/);
});

test('token-exhaustion rows are salvage follow-ups, split from the run-level code of the same name', () => {
  const para = paragraphAbout(renderWith('token-exhaustion'), 'token-exhaustion');
  assert.match(para, /salvage follow-up that spent its whole budget/);
  // The split that stops a reader conflating the two: the run-level code's
  // answering attempt keeps `answered`, so it never lands in this table.
  assert.match(para, /row stays `answered`/);
  // The withdrawn attribution: a salvage follow-up accepted on partial
  // truncated content can itself be the answered attempt a run-level
  // token-exhaustion describes, so the paragraph may not pin the run-level
  // code on the original request.
  assert.doesNotMatch(para, /original request's own exhaustion/);
});

test('empty-answer is explained as positively identified, never unclassified', () => {
  const para = paragraphAbout(renderWith('empty-answer'), 'empty-answer');
  assert.match(para, /positively identified empty answer/);
  assert.match(para, /no non-whitespace answer content/);
  assert.match(para, /never an unclassified failure and never a server drop/);
});

test('a sweep explains only the codes it actually saw — a results section, not a glossary', () => {
  assert.match(renderWith('transport'), /\| `transport` \| 1 \|/, 'the failure itself is still counted');
  // Derived from the export, never hand-enumerated: a code added to
  // REASON_PARAGRAPHS is auto-covered here, the same mechanised-membership
  // coupling RECORD_FIELDS carries. The absence check matches a prefix of the
  // entry's own resolved prose — not the `` `code` below `` opener convention,
  // which a differently-phrased future paragraph would silently escape — by
  // string containment, never a RegExp built from prose bytes, which carry
  // `**` and other metacharacters. Exact equality on the rendered code, since
  // `transport` is a substring of `non-retryable-transport`. Every code takes
  // a turn as the sole one observed — a gate that leaks only under some other
  // seed would escape a single-seed check — and the observed code's own
  // paragraph is asserted present first, so the absences cannot pass vacuously
  // on a report that dropped the whole section.
  for (const [observed] of REASON_PARAGRAPHS) {
    const markdown = renderWith(observed);
    paragraphAbout(markdown, observed);
    for (const [code, prose] of REASON_PARAGRAPHS) {
      if (code === observed) continue;
      const prefix = (typeof prose === 'function' ? prose() : prose).slice(0, 60);
      assert.ok(
        !markdown.includes(prefix),
        `\`${code}\` paragraph must not print when only \`${observed}\` was seen`,
      );
    }
  }
});

test('the paragraph table pairs each prose with its own code, exactly once', () => {
  const codes = REASON_PARAGRAPHS.map(([code]) => code);
  assert.strictEqual(new Set(codes).size, codes.length, 'a duplicated code would double-print its paragraph');
  // The table makes the gate the entry's own code by construction, but nothing
  // structural stops prose being paired with the wrong code — this asserts the
  // one pairing property that is mechanisable (each paragraph names its own
  // code); which prose sits under which code beyond that is what the per-code
  // content tests above pin.
  for (const [code, prose] of REASON_PARAGRAPHS) {
    const text = typeof prose === 'function' ? prose() : prose;
    assert.ok(text.includes(`\`${code}\``), `the \`${code}\` entry's prose never names its own code`);
  }
});

test('a sweep with several reason codes renders every matching paragraph, not just the first', () => {
  // The single-reason fixtures above cannot see a loop that stops early — a
  // `break` after the first match keeps all of them green — and a first-and-last
  // pair cannot see one that suppresses an intervening match once output
  // exists. Every code at once, every paragraph asserted, closes both.
  const markdown = renderReport(
    [{ caseDef: CASE, runs: REASON_PARAGRAPHS.map(([code]) => deadRunWith(code)) }],
    { runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false, cold: false },
  );
  for (const [code] of REASON_PARAGRAPHS) paragraphAbout(markdown, code);
});
