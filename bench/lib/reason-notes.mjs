/**
 * The REASON codes a reader could misread, and the closed list of record
 * fields their prose is allowed to enumerate.
 *
 * `outcomeNotes` in `reliability-report.mjs` describes an `outcome`; these
 * describe a `reason`.
 */

/**
 * Every field an attempt entry carries, paired with how the paragraph below
 * names it to a reader.
 *
 * **Hand-authored and schema-pinned. What is GENERATED is the prose**, which is
 * rendered from this list rather than transcribing it — and keeping those two
 * words apart matters, because an earlier draft of this comment called the
 * constant itself generated in the same breath as admitting its field column is
 * typed by hand. Nothing stops that column being wrong except
 * `tests/bench-reason-notes.test.js`, which asserts these keys ARE a closed
 * ledger entry's keys. The reader labels are ordinary prose and get ordinary
 * review; only membership is mechanised, because membership is what drifted.
 *
 * It exists because the sentence below used to transcribe this list, and a
 * transcription is a mirror: a hand-written prose list can drift from the
 * schema while a key-set test sitting green beside it notices nothing, because
 * that test only checks membership, not the prose. Rendering the sentence from
 * the list means a field cannot be silently omitted from the prose — only
 * mislabelled, which a human can see.
 *
 * Exported solely so that test can read it. That is a public symbol in a
 * rendering module, accepted deliberately: intentional coupling to the schema
 * beats an unguarded prose mirror of it.
 */
export const RECORD_FIELDS = [
  ['index', 'its index'],
  ['cause', 'why it was initiated'],
  ['outcome', 'its outcome'],
  ['reason', 'its reason code'],
  // "in characters", said out loud: this layer has no tokenizer, so a token
  // figure would be an estimate and the field is a character count.
  ['promptChars', 'the prompt\'s size in characters'],
  ['warmEligible', 'its warm-eligibility'],
  // "an HTTP response", never "a peer" or "a server". The field is true when
  // headers arrived and false when none did, which is a claim about what was
  // SERVED — not about how far the packets got. `ECONNREFUSED` draws an active
  // refusal whose origin the code alone does not identify, and records false; a
  // TLS rejection reaches a peer outright and records false too.
  // Labelling it "whether a peer answered" would put a reachability finding into
  // the one paragraph whose subject is that no such finding is available.
  ['serverResponded', 'whether an HTTP response was obtained'],
  ['waitedMs', 'the wait before it'],
  ['prefillMs', 'its prefill timing'],
  ['generationMs', 'its generation timing'],
];

/** The labels as English: "a, b and c". */
function recordList() {
  const labels = RECORD_FIELDS.map(([, label]) => label);
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/**
 * The REASON codes a reader could misread, each gated on its own code.
 *
 * Split from the outcome paragraphs — `outcomeNotes`, now in
 * `reliability-report.mjs` — at the function size budget, along the line the
 * report already draws: those describe an `outcome` field, these describe a
 * `reason`, and only the second kind has a row in the table.
 *
 * Every paragraph is gated on the code it is ABOUT. Stated because the first
 * draft got it wrong in a way three reviewers had to find: the `transport`
 * disclaimer sat inside the `non-retryable-transport` block, so a sweep whose
 * only failures were `transport` — the shape LM Studio actually produces —
 * printed a bare row with the one sentence forbidding the server-blame reading
 * nowhere in the document.
 *
 * And a paragraph that speaks about the record says what it HOLDS, never where
 * else in the report a cause might be found. Three drafts tried the latter — "read `.code`", then
 * "the code is not carried in this report", then "the listing below usually
 * names it" — and review refuted all three, the last one decisively: a TLS
 * rejection's message is the words "certificate has expired" and contains no
 * `CERT_HAS_EXPIRED` anywhere, so the sentence was false for exactly the
 * examples the paragraph itself cites.
 *
 * Two further drafts failed the other way, and the rule they produced is the one
 * stated here. "The reason code is all an attempt record carries" was simply
 * false — `newEntry` also records `index`, `cause`, `promptChars`,
 * `warmEligible`, `waitedMs`, `serverResponded`, `outcome` and both timings. Its
 * replacement, "the record has no peer-reachability field", read as narrow but is
 * a universal wearing a disguise: it quantifies over the *meaning* of every field
 * that might ever be added, so it can go false via a field named anything at all,
 * and a test pinning one literal name would not notice. That draft would now be
 * doubly wrong: `serverResponded` is a *response* field rather than a
 * reachability one, so it neither satisfies the claim nor refutes it, and no
 * literal-name test could have told the difference.
 *
 * **So a paragraph does not assert what the record LACKS. The one that makes
 * record claims — `non-retryable-transport`'s, the only entry that needs to —
 * enumerates what the record HOLDS**, which is a closed list, checkable in one
 * place, and the rule this file already followed everywhere else. The enumeration is not
 * transcribed either — it is rendered from `RECORD_FIELDS`, whose membership is
 * pinned against a closed ledger entry in `tests/bench-reason-notes.test.js`.
 * Adding any field turns that test red, and the sentence is re-read rather than
 * left quietly stale.
 *
 * One thing this paragraph may NOT do, learned at the cost of two drafts: claim
 * that no attempt carrying this code measured a prefill. `http-errors.mjs`
 * gives the code only to an undelivered failure, but "undelivered" is a
 * call-site judgement about which phase raised the error, not a proof that no
 * bytes ever arrived — its own comment says that path *usually* has no
 * response. So the prose states the ASYMMETRY, which needs no population claim:
 * a measured prefill proves the model was reached, and a missing one is the
 * absence of a measurement, exactly as `firstTextNote` in
 * `reliability-report.mjs` already says.
 *
 * Scope stated, because this file is not the only prose about attempts:
 * `firstTextNote` in `reliability-report.mjs` claims from an attempt's timings,
 * which the record does also carry.
 *
 * Membership and gating are one table: the gate cannot drift from membership,
 * because an entry's code IS its gate. That is the whole of what the table
 * guarantees by construction — pairing the right prose with that code is not
 * structural, and is carried instead by the test suite, which asserts each
 * entry's prose names its own code and pins each paragraph's content per code.
 * The suite also reads this export to derive its glossary coverage from each
 * entry's own prose bytes — the same deliberate test coupling `RECORD_FIELDS`
 * above documents. An entry's prose is a string, or a thunk where it
 * interpolates a rendered value at call time.
 */
export const REASON_PARAGRAPHS = [
  ['shape-rejected',
    // Names `refused` rather than saying "that outcome": the refused paragraph
    // is itself gated, so on a sweep with no refusals there is no antecedent
    // for a pronoun to point at.
    '`shape-rejected` below is the terminal twin of the `refused` outcome, and the reason the two must'
    + ' never be read as synonyms: the server rejected the request\'s shape and **nothing replaced it** —'
    + ' the fallback never reached the wire, so no later attempt carries the same work. These are'
    + ' counted as failures, and they are not a server dropping requests. A `shape-rejected` row says'
    + ' the client stopped, not that the server went quiet.'],
  ['non-retryable-transport', () =>
    '`non-retryable-transport` below is a failure that arrived **before any response was obtained**,'
    + ' carrying an error code this client does not recognise as transient — or no code at all — so it'
    + ' was not retried. It records that retry decision, and in particular it does **not** say whether'
    + ' a peer was reached: some of these did reach a peer — a TLS certificate rejection, and a'
    + ' protocol or a parser error, each needing peer bytes to fire — while `ENOTFOUND` resolved no'
    + ' address and contacted nothing at all, and `ECONNREFUSED` is an active refusal whose origin —'
    + ' the host, a middlebox in front of it, or the local stack itself — the code alone does not'
    + ' identify. This table cannot'
    + ` **always** tell you which. An attempt record this build writes carries ${recordList()}. Of`
    + ' those, a **measured**'
    + ' timing proves the model was reached — that is the one direction this record settles, and it'
    + ' settles it only for the attempt that carries one. Warm-eligibility turns on an *earlier* request'
    + ' having got that far, so it speaks for that one and not this. Where nothing was measured, the'
    + ' absence is the absence of a measurement, not evidence about what was at the other end, and these'
    + ' rows cannot be told apart **on that axis**. They can be told apart on a narrower one: the last'
    + ' table below splits every failure on whether an HTTP response was obtained, which is what'
    + ' `serverResponded` records and is a strictly weaker question than how far the packets got.'],
  ['transport',
    '`transport` below is a failure a further attempt could plausibly survive, and it is **not** a count'
    + ' of server misbehaviour. It covers a connection closing mid-body — the shape it was named for —'
    + ' but also pre-response failures whose code says to try again: `EAI_AGAIN` is a resolver\'s own'
    + ' "ask again", and a pre-response `ECONNRESET` carried no response at all. The axis is'
    + ' retryability, never blame.'],
  ['token-reserve-cutoff',
    '`token-reserve-cutoff` below is a **client-side** cutoff, not a server symptom: the model was'
    + ' actively generating reasoning and spending the request\'s own `max_tokens` pool on it, so the'
    + ' watchdog disposed the stream at a conservative character threshold intended to preserve the'
    + ' answer reserve, with no answer yet written. It is unrelated to `*-timeout` reasons and the cut'
    + ' attempt is never retried as-is — instead a follow-up "conclude from what you have" salvage'
    + ' attempt (`trySalvage`, up to two tries: trimmed, then untrimmed) is attempted afterwards, and'
    + ' each follow-up actually sent appears as its own row. A row carrying this reason says this'
    + ' attempt was cut off, nothing more: the run it belongs to may have been answered by a follow-up,'
    + ' the follow-up may itself have failed, or none may have been sent at all — a follow-up grown'
    + ' past the context window is refused before the wire.'],
  ['reasoning-only',
    '`reasoning-only` below is a reply that finished cleanly with no non-whitespace answer content but'
    + ' non-whitespace reasoning — classified by this client after a successful request, streamed or'
    + ' not, so it is never a transport failure and never a server drop. The row can be an original'
    + ' request, whose run a salvage follow-up may then have rescued, or a losing salvage follow-up'
    + ' itself.'],
  ['token-exhaustion',
    '`token-exhaustion` below is an attempt that hit its token limit with no non-whitespace answer'
    + ' content. As a row in this table it is a salvage follow-up that spent its whole budget without'
    + ' concluding; a run-level failure of the same name is an **answered** attempt\'s own exhaustion,'
    + ' classified after the fact once its reply proved unusable — that attempt\'s row stays `answered`'
    + ' because the transport interaction succeeded.'],
  ['empty-answer',
    '`empty-answer` below is a salvage follow-up whose reply contained no non-whitespace answer'
    + ' content — a positively identified empty answer, never an unclassified failure and never a'
    + ' server drop.'],
];

export function reasonNotes(sawReason) {
  const lines = [];
  for (const [code, prose] of REASON_PARAGRAPHS) {
    if (sawReason(code)) lines.push(typeof prose === 'function' ? prose() : prose, '');
  }
  return lines;
}
