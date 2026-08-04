/**
 * The three REASON codes a reader could misread, and the closed list of record
 * fields their prose is allowed to enumerate.
 *
 * Split out of `reliability-report.mjs` in OAI-35, at the 300-line ratchet, along
 * the seam that file already drew in a comment: `outcomeNotes` there describes an
 * `outcome`, and these describe a `reason`. The split was prescribed rather than
 * improvised — the note sat above `RECORD_FIELDS` telling whoever added the tenth
 * field to do exactly this instead of raising the ceiling.
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
 * transcription is a mirror: its first draft named **eight** of the nine fields
 * there were at the time, with a key-set test sitting green beside it, and a
 * reviewer rather than the suite found the missing `outcome`. (Ten now — OAI-35
 * added one, and the mechanism below is what made that addition loud rather than
 * silent.) Rendering the sentence from the list means a
 * field cannot be silently omitted from the prose — only mislabelled, which a
 * human can see.
 *
 * Exported solely so that test can read it. That is a public symbol in a
 * rendering module, accepted deliberately: intentional coupling to the schema
 * beats an unguarded prose mirror of it.
 *
 * Headroom note for whoever adds the field after this one: the prediction above
 * came true — OAI-35 added `serverResponded`, the enumeration test went red on
 * exactly the edit below, and the split it prescribed is the file you are reading.
 * The same rule applies again. Split at a seam the code already draws rather than
 * raising the ceiling; there is no allowlist entry to reach for, and adding one
 * would also silently drop this file's 60-line per-function budget.
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
  // SERVED — not about how far the packets got. `ECONNREFUSED` reaches a host and
  // records false; a TLS rejection reaches a peer outright and records false too.
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
 * The three REASON codes a reader could misread, each gated on its own code.
 *
 * Split from the outcome paragraphs below at the function size budget, and the
 * seam is the one the report already draws: those describe an `outcome` field,
 * these describe a `reason`, and only the second kind has a row in the table.
 *
 * Every paragraph is gated on the code it is ABOUT. Stated because the first
 * draft got it wrong in a way three reviewers had to find: the `transport`
 * disclaimer sat inside the `non-retryable-transport` block, so a sweep whose
 * only failures were `transport` — the shape LM Studio actually produces —
 * printed a bare row with the one sentence forbidding the server-blame reading
 * nowhere in the document.
 *
 * And each paragraph says what the RECORD holds, never where else in the report
 * a cause might be found. Three drafts tried the latter — "read `.code`", then
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
 * **So a paragraph does not assert what the record LACKS. It enumerates what
 * the record HOLDS**, which is a closed list, checkable in one place, and the
 * rule this file already followed everywhere else. The enumeration is not
 * transcribed either — it is rendered from `RECORD_FIELDS`, whose membership is
 * pinned against a closed ledger entry in `tests/bench-reason-notes.test.js`.
 * Adding any field turns that test red, and the sentence is re-read rather than
 * left quietly stale. That is no longer a prediction: OAI-35 added
 * `serverResponded`, the test failed on exactly that edit with the message it was
 * written to print, and the paragraph below gained its axis clause as a result.
 *
 * One thing this paragraph may NOT do, learned at the cost of two drafts: claim
 * that no attempt carrying this code measured a prefill. `http-errors.mjs`
 * gives the code only to an undelivered failure, but "undelivered" is a
 * call-site judgement about which phase raised the error, not a proof that no
 * bytes ever arrived — its own comment says that path *usually* has no
 * response. So the prose states the ASYMMETRY, which needs no population claim:
 * a measured prefill proves the model was reached, and a missing one is the
 * absence of a measurement, exactly as `firstTextNote` below already says.
 *
 * Scope stated, because it is no longer the whole file: `firstTextNote` below
 * claims from an attempt's timings, which the record does also carry.
 */
export function reasonNotes(sawReason) {
  const lines = [];
  if (sawReason('shape-rejected')) {
    lines.push(
      // Names `refused` rather than saying "that outcome": the paragraph above
      // is itself gated, so on a sweep with no refusals there is no antecedent
      // for a pronoun to point at.
      '`shape-rejected` below is the terminal twin of the `refused` outcome, and the reason the two must'
      + ' never be read as synonyms: the server rejected the request\'s shape and **nothing replaced it** —'
      + ' the fallback never reached the wire, so no later attempt carries the same work. These are'
      + ' counted as failures, and they are not a server dropping requests. A `shape-rejected` row says'
      + ' the client stopped, not that the server went quiet.',
      '',
    );
  }
  if (sawReason('non-retryable-transport')) {
    lines.push(
      '`non-retryable-transport` below is a failure that arrived **before any response was obtained**,'
      + ' carrying an error code this client does not recognise as transient — or no code at all — so it'
      + ' was not retried. It records that retry decision, and in particular it does **not** say whether'
      + ' a peer was reached: some of these did reach one — a TLS certificate rejection, a protocol or a'
      + ' parser error, and `ECONNREFUSED`, whose reset is the host itself answering — while `ENOTFOUND`'
      + ' resolved no address and contacted nothing at all. This table cannot'
      + ` **always** tell you which. An attempt record carries ${recordList()}. Of those, a **measured**`
      + ' timing proves the model was reached — that is the one direction this record settles, and it'
      + ' settles it only for the attempt that carries one. Warm-eligibility turns on an *earlier* request'
      + ' having got that far, so it speaks for that one and not this. Where nothing was measured, the'
      + ' absence is the absence of a measurement, not evidence about what was at the other end, and these'
      + ' rows cannot be told apart **on that axis**. They can be told apart on a narrower one: the last'
      + ' table below splits every failure on whether an HTTP response was obtained, which is what'
      + ' `serverResponded` records and is a strictly weaker question than how far the packets got.',
      '',
    );
  }
  if (sawReason('transport')) {
    lines.push(
      '`transport` below is a failure a further attempt could plausibly survive, and it is **not** a count'
      + ' of server misbehaviour. It covers a connection closing mid-body — the shape it was named for —'
      + ' but also pre-response failures whose code says to try again: `EAI_AGAIN` is a resolver\'s own'
      + ' "ask again", and a pre-response `ECONNRESET` carried no response at all. The axis is'
      + ' retryability, never blame.',
      '',
    );
  }
  return lines;
}
