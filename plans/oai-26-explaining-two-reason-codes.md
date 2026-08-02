# OAI-26 — Explain `shape-rejected` and `non-retryable-transport` in the reliability report

> **Correction, 2026-08-02 — two instructions in this plan were refuted during review and did not
> ship. Recorded here rather than edited away, because the plan is the record of what was believed.**
>
> 1. **"`non-retryable-transport` must NOT be called a reachability finding"** (Design decisions, and
>    Phase 1 step 4) — inherited verbatim from the tracker item, and **false for part of the class**.
>    `ENOTFOUND` and `ECONNREFUSED` are deliberately excluded from `TRANSIENT_CONNECT_CODES`, so they
>    carry this reason and reached no peer at all. The shipped paragraph says the code records a
>    *retry decision* and does not establish whether a peer was reached, naming both directions.
> 2. **Anything telling the reader where the underlying error code can be found.** Three drafts tried
>    — "read `.code`" (refuted at the plan gate), "the code is not carried in this report" (refuted by
>    the pass-1 wide review), "the listing below usually names the underlying code" (refuted by the
>    pass-2 adversarial and wide reviews). The last is decisive: a TLS rejection's message is the
>    words "certificate has expired" and contains no `CERT_HAS_EXPIRED`, so the sentence was false for
>    exactly the examples the paragraph itself cites. The shipped paragraph claims only what the
>    attempt record holds.
>
> The plan-challenge history further down (Phase 2's note about a broad `/reachab/` negative) is left
> as written: it records what was decided at that round, not what shipped.

## Context

`bench/lib/reliability-report.mjs` renders the `## Physical-attempt reliability` section. It writes a
gated explanatory paragraph for each outcome a reader could misread — `refused`, `unresolved`,
`warmEligible` — and then prints `Failures by reason` as a **raw count table with no prose at all**.

Two reason codes in that table are exactly the ones that need a paragraph, and both are landing in
front of a reader for the first time in OAI-19's write-up:

- **`shape-rejected`** (OAI-23) — the terminal twin of the benign `refused` outcome the report
  explains two paragraphs earlier. A reader seeing `shape-rejected: 3` has nothing telling them
  those attempts died on a refusal whose replacement was never dispatched, rather than on a server
  dropping requests. That conflation is the precise thing the attempt record exists to prevent.
- **`non-retryable-transport`** (OAI-22) — sits among the delivery failures and is not one.

Prose only. No schema change, no new counting.

## Probe results (all verified, Codex agreed — 2026-08-01)

1. **TRUE** — `byReason` (`bench/lib/attempt-rows.mjs:68`) tallies *every* entry with
   `outcome === 'failed'` and `countTable` renders every key, so both codes already appear. There is
   no fixed reason schema. Nothing to add to the counting path.
2. **TRUE** — an entry reads `refused` only once `begin` has pushed the replacement's own entry
   (`attempt-ledger.mjs:118-124` → `refusal.settle()` → `markRefused`). So for every `refused`
   attempt there is a later entry in the same ledger; if the replacement is refused before `begin`,
   the original stays `failed` with `shape-rejected`. The backlog's "guaranteed rather than merely
   intended" holds.
3. **TRUE, with a precision that must reach the prose** — `non-retryable-transport` requires
   `delivered === false` **AND** a code absent from `TRANSIENT_CONNECT_CODES`
   (`http-errors.mjs:135`). "Failed before any response" alone is not the condition. Codex also noted
   `state.settled` doubles as the promise-settlement latch (`http.mjs:266`), so it is not purely a
   headers-arrived flag — the prose must not lean on that variable's name.
4. **TRUE** — `transport` is *not* exclusively a server-side/mid-body failure: `EAI_AGAIN` and a
   pre-response `ECONNRESET` are tagged `transport` and carried no response at all. So the new
   paragraph must not imply the neighbouring `transport` rows are all the server's doing.

## Design decisions (settled with Codex, no user input needed)

- **A separate paragraph per code**, not one covering both. The shared property ("sits among the
  delivery failures, is not one") is real, but the corrective each makes is different — one
  disambiguates from `refused`, the other blocks a reachability/blame inference — and a combined
  paragraph reads badly whenever only one code is present. It also matches the file's existing
  one-paragraph-per-outcome style.
- **Gated on that reason actually appearing in `stats.byReason`**, matching `refused`/`unresolved`/
  `warmEligible`, which are all gated on a count. This is a results section, not a standing
  taxonomy glossary: a clean sweep must not discuss failures that did not occur.
- **`non-retryable-transport` must NOT be called a reachability finding.** TLS certificate
  rejections, protocol and parser errors all reached a peer. The name records a *decision* — this
  client did not recognise the error code as transient, so it did not retry — and the underlying
  code itself is **not carried in this report**, which the paragraph says rather than papering
  over. (Corrected after round 2 of the plan challenge caught this bullet still pointing at
  `.code`, contradicting Phase 1 step 4.)

## Budget constraint

`reliabilitySection` spans **49 lines against the 60-line function budget** in
`tests/structure.test.js`. Two paragraphs are ~18 lines, so a helper must be extracted. The file
itself is 82 lines against the 300-line default — file size is not the constraint here (this differs
from OAI-30's note, which is about `tests/structure.test.js`).

Extraction must respect the **orphaned-doc-comment guard** in `tests/structure.test.js`: inserting a
new `/** */` block immediately above an existing one is exactly the shape that test forbids.

## Plan

### Phase 1 — extract the gated prose, add the two paragraphs

`bench/lib/reliability-report.mjs`:

1. Add a helper `outcomeNotes(stats)` returning the gated paragraph lines. Move the existing
   `refused` / `unresolved` / `warmEligible` blocks into it verbatim except for the edit in (2), and
   have `reliabilitySection` splice its result. This keeps both functions well under 60 lines and is
   the seam Codex recommended.
2. **Tighten the existing `refused` paragraph**: "the plugin sent a replacement request without it"
   → say that the record can only *read* `refused` once the replacement's own attempt entry exists,
   so a replacement always appears below it in the same run. That is what makes it readable beside
   `shape-rejected`. Keep the existing "it says a replacement was sent, not that the replacement
   succeeded" sentence — probe (2) does not upgrade that.
3. Add the `shape-rejected` paragraph, gated on the code appearing in `stats.byReason`: those
   attempts died on a rejected request shape whose replacement was **never** dispatched — the
   terminal twin of `refused` above — so they are counted as failures, and they are *not* a server
   dropping requests.
4. Add the `non-retryable-transport` paragraph, gated the same way: the request failed **before any
   response was obtained**, carrying a code this client does not recognise as transient (or no code
   at all), so it was not retried. State explicitly that this is not a reachability finding, and
   that the `transport` rows beside it are not all server-side either — `EAI_AGAIN` and a
   pre-response `ECONNRESET` are `transport` and carried no response.
   **Word that last part generically** — "the separate `transport` reason does not imply a
   server-side failure either", not "the `transport` rows beside it". Raised as a non-blocking
   caution by the approving round of the plan challenge, and it names a real case: a sweep whose
   only failures are `non-retryable-transport` has no `transport` row for the prose to point at.
   **Do not tell the reader to "read `.code`".** Verified after the plan challenge raised it: the
   ledger entry records `outcome`, `reason`, `promptChars`, `warmEligible`, `waitedMs` and timings —
   **no error code** — and `attemptRows` aggregates only the reason, so this report has no `.code`
   to inspect. Where a *whole run* failed, `report.mjs:178-185` prints its stderr under `## Logical
   runs that did not complete` and the transport message usually names the code; an attempt a later
   one recovered has no such text anywhere. So the paragraph states that gap in one clause — the
   code itself is not carried here — rather than pointing at a field that does not exist.

Both gates read `stats.byReason` (an array of `[key, count]` pairs), via one small predicate rather
than two open-coded `.some(...)` calls.

### Phase 2 — tests

`tests/bench-reliability.test.js`, following the existing `renderReport`-and-match style
(`tests/bench-reliability.test.js:101-121`):

- A sweep with a `shape-rejected` failed attempt renders the paragraph, and it names the fact that
  no replacement was dispatched.
- A sweep with a `non-retryable-transport` failed attempt renders that paragraph. Two assertions,
  and the split matters — raised by the plan challenge, which caught that the paragraph must itself
  contain the phrase "not a reachability finding", so a broad `/reachab/` negative would reject the
  correct text. So: `assert.match` that the negated disclaimer is present, and `assert.doesNotMatch`
  on the **positive inference only** — wording such as `server was unreachable` / `could not reach`
  / `did not reach`. Mirrors the existing `doesNotMatch(/cache hit observed/)` test, which is
  likewise pinned to the wrong claim rather than to the topic.
- A sweep whose only failure is `transport` renders **neither** paragraph — the gate.

## Verification

- `npm test` (green baseline today: 392 pass).
- Repo `verify` skill.
- Mutation check on the key invariant — the gate. Flip one paragraph's condition to unconditional
  (or invert it), prove the mutation landed with `mutation-landed.py`, confirm the
  gate test goes red, restore, re-run green, prove the restore by `diff`.
- Eyeball the rendered markdown from a stub sweep to confirm the two new paragraphs read correctly
  beside the `refused` one.

## Not in scope

- No change to `attempt-rows.mjs`, the schema, or any counting. Probe (1) settles that.
- OAI-24 and OAI-19 remain separate items; this only makes the table readable before OAI-19 quotes
  it.
