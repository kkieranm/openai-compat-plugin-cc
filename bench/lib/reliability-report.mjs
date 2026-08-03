import { attemptRows } from './attempt-rows.mjs';

/**
 * The `## Physical-attempt reliability` section.
 *
 * Its own section, never folded into the recall table and never appended to
 * "Runs that did not complete". That heading means *logical* runs, which is why
 * substitutions are already excluded from it; attempts 1 and 2 of a run answered
 * by attempt 3 do not belong there either, because the run completed. Keeping
 * them apart is what stops a reader mistaking transport reliability for reviewer
 * recall — the two denominators this feature exists to separate.
 *
 * Nor does this belong in `caveats.mjs`. Caveats say what a figure *means*; a
 * reason-code table is a second measurement, and putting it there would turn
 * prose into a results channel and force physical-attempt data into the logical
 * rows.
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
 * transcription is a mirror: its first draft named **eight** of the nine, with
 * a key-set test sitting green beside it, and a reviewer rather than the suite
 * found the missing `outcome`. Rendering the sentence from the list means a
 * field cannot be silently omitted from the prose — only mislabelled, which a
 * human can see.
 *
 * Exported solely so that test can read it. That is a public symbol in a
 * rendering module, accepted deliberately: intentional coupling to the schema
 * beats an unguarded prose mirror of it.
 *
 * Headroom note for whoever adds the next field: this file sits close to the
 * 300-line ratchet, and OAI-35 lands `serverResponded` — which turns the
 * enumeration test red here by design and wants a paragraph of its own. Split
 * at the seam this file already draws (`reasonNotes` describes a `reason`,
 * `outcomeNotes` an `outcome`) rather than raising the ceiling.
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
  ['waitedMs', 'the wait before it'],
  ['prefillMs', 'its prefill timing'],
  ['generationMs', 'its generation timing'],
];

/** The labels as English: "a, b and c". */
function recordList() {
  const labels = RECORD_FIELDS.map(([, label]) => label);
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

function countTable(title, pairs) {
  if (pairs.length === 0) return [];
  return [`${title}`, '', '| | failed attempts |', '| --- | --- |', ...pairs.map(([key, n]) => `| \`${key}\` | ${n} |`), ''];
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
 * `warmEligible`, `waitedMs`, `outcome` and both timings. Its replacement, "the
 * record has no peer-reachability field", read as narrow but is a universal
 * wearing a disguise: it quantifies over the *meaning* of every field that might
 * ever be added, so it can go false via a field named anything at all, and a
 * test pinning one literal name would not notice.
 *
 * **So a paragraph does not assert what the record LACKS. It enumerates what
 * the record HOLDS**, which is a closed list, checkable in one place, and the
 * rule this file already followed everywhere else. The enumeration is not
 * transcribed either — it is rendered from `RECORD_FIELDS`, whose membership is
 * pinned against a closed ledger entry in `tests/bench-reason-notes.test.js`.
 * Adding any field — `serverResponded` from OAI-35 is the next one — turns that
 * test red, and the sentence is re-read rather than left quietly stale.
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
function reasonNotes(sawReason) {
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
      + ' parser error — and some never did, `ENOTFOUND` and `ECONNREFUSED` among them. This table cannot'
      + ` **always** tell you which. An attempt record carries ${recordList()}. Of those, a **measured**`
      + ' timing proves the model was reached — that is the one direction this record settles, and it'
      + ' settles it only for the attempt that carries one. Warm-eligibility turns on an *earlier* request'
      + ' having got that far, so it speaks for that one and not this. Where nothing was measured, the'
      + ' absence is the absence of a measurement, not evidence about what was at the other end, and these'
      + ' rows cannot be told apart.',
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

/**
 * The prose for every outcome and reason code a reader could misread, each gated
 * on having actually occurred in this sweep.
 *
 * Gated, not printed as a standing glossary, because this is a results section:
 * a clean sweep explaining failures that did not happen would be the report
 * asserting more than it measured. And lifted out of `reliabilitySection` at the
 * function size budget — the seam is "what a code means" against "what this
 * sweep counted", which is the same split `caveats.mjs` already draws one level
 * up.
 *
 * The two reason-code paragraphs read `byReason` rather than a dedicated tally
 * because there is no fixed reason schema: `attemptRows` counts whatever code
 * each failed attempt carried, so a code is present here exactly when it has a
 * row in the table below.
 */
function outcomeNotes(stats) {
  const sawReason = (code) => stats.byReason.some(([key]) => key === code);
  const lines = [];
  if (stats.refused > 0) {
    lines.push(
      // "Initiated", never "dispatched" or "sent". `refused` is written by
      // `ledger.begin` when the replacement's ENTRY is minted, which is several
      // frames before anything reaches a socket: `provider.mjs` still has to
      // serialize the body and `http.mjs` to validate the URL, and either can
      // throw. Both earlier drafts read the entry as proof of the wire write —
      // the same claim twice, once per sentence, which is why the closing one
      // had to change with the opening one.
      `${stats.refused} attempt(s) were **refused for their shape**, not dropped — the server rejected a`
      + ' capability (`stream_options`, streaming, or a response schema), triggering a replacement request'
      + ' without it. The original is marked `refused` only once that replacement has its own attempt'
      + ' entry, so one always follows it in the same run. That is negotiation rather than'
      + ' unreliability, so those attempts are counted above but excluded from the failure rate.'
      + ' **It records an initiated replacement, not a guaranteed wire write** — and certainly not a'
      + ' successful one: if the replacement failed in turn, that failure is counted on its own row.',
      '',
    );
  }
  lines.push(...reasonNotes(sawReason));
  if (stats.unresolved > 0) {
    lines.push(`**${stats.unresolved} attempt(s) were never resolved** — a request whose record was left open is a plumbing bug, not a server one.`, '');
  }
  if (stats.warmEligible > 0) {
    lines.push(
      `${stats.warmEligible} attempt(s) were **warm-eligible**: an earlier request in the same run carried a`
      + ' byte-identical prompt, so the server *could* have served their prefill from cache. This is not an'
      + ' observed cache hit — nothing here can see one — and their prefill figures are excluded from the'
      + ' cold timings above rather than being quoted as cold measurements.',
      '',
    );
  }
  return lines;
}

/**
 * What a failed attempt's `prefillMs` does and does not establish.
 *
 * Gated on a failure having occurred — a **count**, never a name test. The
 * paragraphs above are gated by `sawReason`, whose `key === code` is one
 * loosened operator away from printing the `transport` note for a sweep whose
 * only failures were `non-retryable-transport`; nothing here reintroduces that
 * shape. That hazard is no longer only described: OAI-31 pinned it, and
 * `tests/bench-reason-notes.test.js` now fails on exactly that one-token edit.
 *
 * The claim is deliberately narrow, because the tempting one is false. A
 * measured prefill says the attempt crossed the first-model-text boundary, so
 * whatever ended it happened after that point — that is all. It does not say
 * why a later stream died, and a null is the absence of the measurement rather
 * than evidence of any particular cause. Stated this way because the failure
 * class this repo keeps producing is prose that asserts a property of a whole
 * population from examples covering one part of it.
 */
function firstTextNote(stats) {
  if (stats.failed === 0) return [];
  return [
    `The table below splits those ${stats.failed} failed attempt(s) on **whether the model had produced any`
    + ' text yet**, which is'
    + ' what a recorded `prefillMs` means. An attempt with one measured its own prefill, so it reached'
    + ' first model text and whatever ended it happened *after* that boundary — ruling out, for that'
    + ' attempt, any account in which it never got that far. It does **not** say what killed the stream'
    + ' afterwards. An attempt without one is the absence of that measurement — it died before first'
    + ' token, or its failure carried no timings — and absence of the measurement is not evidence of a'
    + ' cause.',
    '',
  ];
}

/** Logical runs, counted the way the recall table counts them. */
function runTotals(results) {
  const runs = results.flatMap(({ runs: caseRuns }) => caseRuns);
  // Substitutions carry `run.error` but COMPLETED — they answered, parsed and
  // were timed; what failed was the attribution, and they have their own
  // section saying so. Counting them here would have this line contradict that
  // one about the same runs.
  return { total: runs.length, incomplete: runs.filter((run) => run.error && run.reason !== 'model-substituted').length };
}

export function reliabilitySection(results) {
  const stats = attemptRows(results);
  // No record at all — a sweep from before this existed. Silence is honest;
  // a row of zeroes would claim a 0% failure rate nobody measured.
  if (!stats) return [];

  const runs = runTotals(results);
  const pct = (n) => `${((n / stats.total) * 100).toFixed(1)}%`;
  const lines = [
    '## Physical-attempt reliability',
    '',
    // Both denominators together, in one breath. Stated apart, a reader carries
    // the first into the second and the whole point is lost.
    `${runs.total} logical run(s): ${runs.total - runs.incomplete} completed, ${runs.incomplete} did not.`,
    `${stats.total} physical attempt(s): ${stats.answered} answered, ${stats.failed} failed (${pct(stats.failed)}).`,
    '',
    'A failed attempt is missing data, not an observed miss: it never enters a recall denominator.'
    + ' A run answered by a later attempt is scored once, and its earlier failures are counted only here.',
    '',
  ];
  lines.push(
    ...outcomeNotes(stats),
    ...countTable('Failures by reason', stats.byReason),
    ...countTable('Failures by case', stats.byCase),
    ...countTable('Failures by requested model', stats.byModel),
    ...firstTextNote(stats),
    ...countTable('Failures by whether first model text arrived', stats.byFirstText),
  );
  return lines;
}
