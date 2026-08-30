// Multi-pass review: N independent passes of the same request, unioned into one
// report with an agreement count per finding. A single pass is a lottery — one
// 135-line file with two known defects produced 1 real defect, 3 false
// positives, 2 empty results and 1 budget failure across five identical runs.
// Independent passes are the lever, and agreement across them is the closest
// thing to a free verifier.
//
// This module is PURE: it merges pass outcomes and builds the two renderings as
// a string and an object. The one place that writes to stdout is
// `review-report.mjs`'s `reportPasses`, keeping the repo's seam — `review.mjs`
// and this file build strings/objects, `review-report.mjs` writes them.
import { UserError } from './errors.mjs';
import { substitution } from './model-identity.mjs';
import { SEVERITY_ORDER, renderFindings } from './review.mjs';
import { unparsedReply } from './review-unparsed.mjs';

// A pass OUTCOME as the loop in `cmd-review.mjs` records it:
//   { ok: true, parsed, result, budget, estimatedTokens, hunksOnly, skipped,
//     salvaged, salvageTrim, structured, durationMs, ledger }
//   { ok: false, error, ledger }               (the request threw)
// A pass is READABLE when it did not throw AND `parseFindings` returned a
// findings object (an EMPTY `{findings: []}` is readable — the model looked and
// found nothing, an observed no-finding vote). A NON-OBSERVATION is a pass that
// threw, or whose reply `parseFindings` could not read (`parsed === null`).
export function isReadable(pass) {
  return Boolean(pass.ok && pass.parsed);
}

export function partitionPasses(passes) {
  const readable = [];
  const nonObs = [];
  for (const pass of passes) (isReadable(pass) ? readable : nonObs).push(pass);
  return { readable, nonObs };
}

// Why a non-observation is one, plus the raw reply prose when there is one worth
// keeping. The reason is preserved rather than flattened to a generic
// "unreadable", because a token-exhausted pass (the dominant overnight failure
// mode) reads loudly in the single-pass path and must not go quiet here. A thrown
// pass carries the transport/deadline reason on its error and no reply. A
// `parsed === null` pass is classified by `unparsedReply`, which THROWS for
// token-exhaustion and reasoning-only (carrying `.reason`, no readable reply) and
// RETURNS the prose for a genuinely shape-unreadable reply — kept as `raw`, the
// evidence that diagnoses a parser-gap coverage loss (OAI-49/OAI-228) and would
// otherwise be lost per pass.
export function passReason(pass, unparsedContext) {
  if (!pass.ok) return { reason: pass.error?.reason ?? 'errored', raw: null };
  try {
    const raw = unparsedReply(pass.result, unparsedContext);
    return { reason: 'unreadable', raw };
  } catch (error) {
    return { reason: error?.reason ?? 'unreadable', raw: null };
  }
}

// Highest severity wins on a merge; `SEVERITY_ORDER` is most-severe-first, so the
// smallest index is the most severe. An unrecognised value (never produced by
// `normalizeFinding`, which defaults to 'medium') sorts as least severe rather
// than throwing.
function mostSevere(severities) {
  const rank = (s) => {
    const i = SEVERITY_ORDER.indexOf(s);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...severities].sort((a, b) => rank(a) - rank(b))[0];
}

// Dedup key = file + EXACT line. Deviates from the item's literal
// "file+line+claim": a local model paraphrases claims, so keying on the summary
// would UNDERCOUNT agreement — the very signal this feature produces. So the
// merge is by LOCATION: two findings at one file+line are one entry, and K
// counts the passes that flagged that LOCATION, not that proved one shared
// defect. Their distinct summaries are retained in `summaries[]` so a reader can
// tell whether the passes described the same thing or two different ones at that
// line. The key is the JSON of `[file, line]` rather than a joined string, so no
// separator character has to be assumed absent from a path — two distinct
// (file, line) pairs always serialise distinctly and no pair collides.
function locationKey(finding) {
  return JSON.stringify([finding.file, finding.line]);
}

/**
 * Union the readable passes into one findings list with an agreement count.
 *
 * Agreement K counts READABLE PASSES that flagged the key's LOCATION, never raw
 * findings, so one pass double-reporting a line cannot inflate it (`passes` is a
 * Set of pass indices). A `line === null` finding is kept UNMERGED (its own
 * entry, agreement 1): with no location to anchor on, keying it on file+summary
 * would reintroduce the paraphrase problem for exactly the subset that has no
 * line.
 *
 * K is a LOCATION-agreement count, bounded in BOTH directions and neither is a
 * defect-identity claim: it UNDER-counts true agreement (an off-by-a-line or
 * paraphrased duplicate does not merge, so true location agreement is >= K), and
 * it can OVER-state defect agreement (two DIFFERENT defects at one line count as
 * K=2 for that location though neither corroborated the other). `summaries[]`
 * carries more than one entry exactly when that happened, which is what the
 * report surfaces so K is never read as proof the passes found the same defect.
 * Each merged finding carries the denominator `readablePasses` (S) beside
 * `agreement` (K) so a consumer never has to recover S from elsewhere.
 */
export function mergePasses(readable) {
  const S = readable.length;
  const keyed = new Map();
  const singles = [];
  readable.forEach((pass, index) => {
    for (const finding of pass.parsed.findings) {
      if (finding.line === null || finding.line === undefined) {
        singles.push({
          file: finding.file,
          line: finding.line ?? null,
          severity: finding.severity,
          summary: finding.summary,
          summaries: [finding.summary],
          evidence: finding.evidence ?? '',
          agreement: 1,
          readablePasses: S,
          // The lens that produced this single, BY VALUE off the pass — a null-line
          // finding never enters the keyed Set, so an index-based scheme could not
          // attribute it at all. Empty on the plain `--passes` path (lens null).
          lenses: pass.lens ? [pass.lens] : [],
        });
        continue;
      }
      const key = locationKey(finding);
      let entry = keyed.get(key);
      if (!entry) {
        entry = { file: finding.file, line: finding.line, summaries: [], severities: [], evidences: [], passes: new Set(), lenses: [] };
        keyed.set(key, entry);
      }
      // K counts passes, not findings: `passes` is a Set of pass INDICES, so a
      // pass that names the same line twice adds its one index once — one vote
      // however many times it names the line.
      entry.passes.add(index);
      // Lens provenance BY VALUE (`pass.lens`), never by `index`: `reportPasses`
      // compacts to the readable passes before calling this, so `index` is a
      // position in that compacted array — a failed middle pass shifts it and an
      // index→lens map would mis-attribute. Deduped, order-preserving; empty on the
      // plain `--passes` path where every `pass.lens` is null.
      if (pass.lens && !entry.lenses.includes(pass.lens)) entry.lenses.push(pass.lens);
      if (finding.summary && !entry.summaries.includes(finding.summary)) entry.summaries.push(finding.summary);
      entry.severities.push(finding.severity);
      if (finding.evidence && !entry.evidences.includes(finding.evidence)) entry.evidences.push(finding.evidence);
    }
  });
  const merged = [...keyed.values()].map((entry) => ({
    file: entry.file,
    line: entry.line,
    severity: mostSevere(entry.severities),
    // A canonical `summary` beside `summaries[]`: the text report and the
    // benchmark's anchor matching both read `summary`, while `summaries[]` shows
    // every distinct phrasing the passes used.
    summary: entry.summaries[0] ?? '',
    summaries: entry.summaries,
    evidence: entry.evidences[0] ?? '',
    agreement: entry.passes.size,
    readablePasses: S,
    lenses: entry.lenses,
  }));
  return { findings: [...merged, ...singles], readablePasses: S };
}

/**
 * The union is only a measurement of one model if every readable pass was served
 * the same, CONFIRMED model. Two fail-closed guards, in order:
 *
 *   - Confirmation: `result.model` falls back to the requested id when the
 *     server did not name what it served (`modelReported === false`), so two
 *     passes can both echo the requested id and `substitution()` see no
 *     mismatch though nothing was confirmed. An unconfirmed served model is not
 *     agreement.
 *   - Agreement: given confirmation, a substitution (served !== requested) or a
 *     served model that differs across passes fails closed — stricter than the
 *     single-pass path, which only NOTICES a substitution. Over-suppression on
 *     the safe side: a silently mixed-model union is the thing this rules out.
 *
 * Returns the `UserError` to throw, or `null` when every readable pass agrees.
 * The ids ride on `.servedModels`, never inside `.message` (the discipline that
 * keeps a server-controlled value out of a persisted error string).
 */
export function servedModelFailure(readable) {
  for (const pass of readable) {
    if (pass.result.modelReported !== true) {
      return new UserError(
        'A review pass did not confirm which model answered, so a multi-pass union cannot prove the ' +
          'passes measured one model.',
        {
          reason: 'unconfirmed-served-model',
          hint: 'The server returned a completion without naming the model it served. Multi-pass review ' +
            'requires a server that reports the served model; run a single pass, or use a server that does.',
        },
      );
    }
    const swap = substitution(pass.result.requestedModel, pass.result.model);
    if (swap) {
      const error = new UserError(
        'A review pass was answered by a substituted model, so a multi-pass union would mix models.',
        {
          reason: 'served-model-disagreement',
          hint: 'The server answered with a different model than requested. Results belong to the model ' +
            'that ran; run a single pass to see it, or load the requested model.',
        },
      );
      error.servedModels = { requested: swap.requested, served: swap.served };
      return error;
    }
  }
  const served = [...new Set(readable.map((pass) => pass.result.model))];
  if (served.length > 1) {
    const error = new UserError(
      'Two review passes were served different models, so a multi-pass union would mix models.',
      {
        reason: 'served-model-disagreement',
        hint: 'The passes did not all run on the same model. Run a single pass, or pin one model for the run.',
      },
    );
    error.servedModels = { served };
    return error;
  }
  return null;
}

// Every pass's attempt records, in order — the mixed-failure evidence a caller
// reads to tell a repeated identical failure from a mix of modes. Shared by
// `allFailedError` and `runMultiPass`'s served-model refusal so both post-hoc
// failures carry the whole run's requests, not one pass's; callers apply the
// `if (length)` guard so an empty aggregate leaves `attempts` null (nothing
// determined), never `[]` (an observed empty set).
export function aggregateAttempts(passes) {
  return passes.flatMap((pass) => (pass.ledger ? pass.ledger.entries() : []));
}

/**
 * Every pass was a non-observation (all threw or were unreadable). Rendering
 * `findings: []` at exit 0 would be a false clean review, so the run fails
 * closed through the ordinary failure envelope. The attempt records of EVERY
 * pass ride the error so `errorReport`'s `attempts` reads the whole run's
 * requests rather than `null` (the OAI-116 regression) or one pass's alone.
 *
 * The reason is the FIRST failure IN PASS ORDER — `passes[0]`, since every pass
 * here is a non-observation — never `find(!ok)`, which would skip a leading
 * parse-null starvation to report a later thrown transport death and misclassify
 * the run for `bench/lib/sweep-outcome.mjs` (which reads `reason` for `starved` /
 * `serverUnwell` / the `RETRYABLE` set). A parse-null first pass is reclassified
 * by re-running `unparsedReply`, which THROWS the fully-formed
 * token-exhaustion/reasoning-only error — its `reason`, `hint`, and `usage`
 * carrier (which `errorReport`'s reasoning witness reads) all intact — or RETURNS
 * prose for a shape-unreadable reply, the only case that takes the whole-run
 * `all-passes-unreadable` claim. Disclosed trade-off: a leading unreadable-prose
 * pass thus masks a later thrown pass's reason in the top-level headline; the
 * evidence survives in `attempts`.
 */
export function allFailedError(passes, profile) {
  const attemptRecords = aggregateAttempts(passes);
  const first = passes[0];
  let error;
  if (!first.ok) {
    error = first.error;
  } else {
    try {
      unparsedReply(first.result, { structured: first.structured, profile, ledger: first.ledger });
      error = new UserError(
        `All ${passes.length} review passes returned a reply that could not be read as findings; nothing has been checked.`,
        { reason: 'all-passes-unreadable' },
      );
    } catch (classified) {
      error = classified;
      // `requireAnswer`'s reasoning-only/empty-answer refusals (reached THROUGH
      // `unparsedReply`) set no `reason`, so without this the terminal envelope's
      // `reason` reads null for exactly those first-pass shapes; a token-exhausted
      // first pass arrives with its own `reason` and is left untouched. `== null`
      // (not a bare falsy check) so an empty-string reason — which no current
      // producer emits — could never be silently overwritten. Scoped to the catch
      // branch alone: applied after the whole if/else it would also stamp a
      // reason-less THROWN first pass (`first.error`), which is an errored pass, not
      // an unreadable reply — its null reason is the honest "nothing determined".
      if (error.reason == null) error.reason = 'all-passes-unreadable';
    }
  }
  // Explicit assignment, not `withLedger` (which fills `attemptRecords` only when
  // undefined): a rethrown classified error already carries its own pass's
  // records, and we deliberately replace that one-pass view with the whole-run
  // superset.
  if (attemptRecords.length) error.attemptRecords = attemptRecords;
  return error;
}

/**
 * The caveat fields for the union, fail-closed. Every caveat is the OR across
 * readable passes — so a union in which ANY pass was truncated, salvaged, saw
 * only hunks, or skipped the unsized-window rung reads with that caveat, never as
 * a clean complete review — while `contextChecked` is the AND (checked only if
 * every pass checked). `dropped` sums, `unreadable` is the shared target's. The
 * per-pass originals stay in `passes[]`, so nothing is concealed; this is only
 * the top-level summary a reader who does not open `passes[]` still sees.
 * `degraded` is the same fail-closed OR: a union in which any readable pass ran
 * degraded (a requested `--structured-output` that fell back) is degraded, so a
 * bench degradation axis reading the merged record never mistakes it for clean.
 */
export function caveatUnion(readableReports, { unreadable }) {
  return {
    salvaged: readableReports.some((report) => report.salvaged),
    analysisCut: readableReports.some((report) => report.analysisCut === true),
    atCap: readableReports.some((report) => report.atCap === true),
    hunksOnly: readableReports.some((report) => report.hunksOnly),
    skippedUnsizedWindow: readableReports.some((report) => report.skippedUnsizedWindow),
    degraded: readableReports.some((report) => report.degraded),
    dropped: readableReports.reduce((sum, report) => sum + (report.dropped ?? 0), 0),
    unreadable,
  };
}

export function contextCheckedAll(readableReports) {
  return readableReports.every((report) => report.contextChecked);
}

// Wall clock over ALL passes, not just readable ones: passes run sequentially, so
// a failed pass still consumed time (a ten-minute timeout before a one-minute
// readable pass is an eleven-minute run). Null if any pass lacks a finite
// duration rather than counting it zero — the partial-sum-as-total the usage sum
// also refuses. Distinct from `usage`, which sums readable passes only: a
// non-observation's tokens — a thrown pass's or a parse-null pass's, both of which
// can carry a `usage` (surfaced in its `passes[]` entry) — are deliberately
// excluded from the top-level sum, so the two aggregate over different populations
// by design.
export function totalDuration(passes) {
  return passes.every((pass) => Number.isFinite(pass.durationMs))
    ? passes.reduce((sum, pass) => sum + pass.durationMs, 0)
    : null;
}

// One line per pass: index, wall clock, and either the finding count (readable)
// or the failure reason (non-observation). `passSummaries` is built by
// `reportPasses`, in pass order, so indices are preserved. `servedNote` discloses
// a non-observation pass that ran on a different model — the disclosure the
// single-pass `substitutionNotice` used to carry, now that the multi-pass loop
// drops it; the model id itself rides the JSON `passes[]` entry, so the text
// stays generic and prints no server-controlled value.
function formatPassLine({ index, lens, durationMs, findings, reason, servedNote }) {
  const secs = Number.isFinite(durationMs) ? `${(durationMs / 1000).toFixed(1)}s` : 'unknown time';
  const state = reason
    ? `${reason}${servedNote ? ` — ${servedNote}` : ''}`
    : `${findings} finding(s)`;
  // The lens (when a lens run) names which focus this pass ran, so a failed pass is
  // diagnosable from the text; omitted on the plain `--passes` path (lens null).
  const focus = lens ? ` [${lens}]` : '';
  return `  pass ${index + 1}${focus}: ${secs} · ${state}`;
}

/**
 * The text report: reuse `renderFindings` so the caveats and the "unverified
 * claims" disclaimer come for free, feeding it a merged parsed object whose
 * caveat flags are the fail-closed OR across readable passes. Every annotation
 * rides a DISPLAY-ONLY copy of the finding — never the stored `summary`, which
 * the JSON and the benchmark read.
 *
 * A merged finding with more than one distinct summary is where the location key
 * may have joined DIFFERENT defects at one line, so it is marked `— summaries
 * differ` and EVERY distinct summary is shown, indented under the canonical one
 * (`renderFinding` prints `summary` on one 8-space line, so the extras ride their
 * own `\n        ` continuation lines). K is thus never read as proof the passes
 * found the same defect.
 */
export function passesText(merged, { passCount, passSummaries, caveatFlags, label, profile, model, strategy = 'passes', lenses = [] }) {
  // On the lens path a finding is tagged with the LENS(es) that flagged it, not an
  // agreement count: across deliberately disjoint focuses K is coverage, not
  // confidence, and "flagged by: security" makes that self-evident where a bare
  // count invites the confidence misread. The plain `--passes` path is unchanged —
  // K there IS a decorrelation signal (repeated samples of one prompt), and its
  // "LOWER BOUND on true agreement" paragraph stays exactly as written.
  const lensPath = strategy === 'lenses';
  const annotated = merged.findings.map((finding) => {
    const divergent = finding.summaries.length > 1;
    const tag = lensPath
      ? `[flagged by: ${finding.lenses.join(', ') || 'unknown'}${divergent ? ' — summaries differ' : ''}]`
      : `[${finding.agreement}/${merged.readablePasses} passes${divergent ? ' — summaries differ' : ''}]`;
    const extras = divergent ? finding.summaries.slice(1).map((s) => `\n        · ${s}`).join('') : '';
    return { ...finding, summary: `${finding.summary} ${tag}${extras}` };
  });
  const openingLine = lensPath
    ? `Lens review across ${lenses.join(', ')}: ${merged.readablePasses} of ${passCount} lens passes readable.`
    : `Multi-pass review: ${merged.readablePasses} of ${passCount} passes readable.`;
  const explanation = lensPath
    ? 'Each finding is tagged with the lens(es) that flagged it. A lens run reports COVERAGE across ' +
      'focuses, not confidence: a finding flagged by only one lens is a blind spot that lens was ' +
      'looking for, not a low-confidence result, so being flagged by fewer lenses is not a demotion. ' +
      'Where the summaries differ, different lenses reported different defects at one line — the ' +
      'differing summaries are shown.'
    : 'The agreement count is how many passes flagged that LOCATION: a LOWER BOUND on true agreement ' +
      '(paraphrased or off-by-a-line duplicates do not merge), and where the summaries differ it may ' +
      'join DIFFERENT defects reported at one line — the differing summaries are shown so it is never ' +
      'read as proof the passes found the same defect.';
  const header = [openingLine, passSummaries.map(formatPassLine).join('\n'), explanation]
    .filter(Boolean)
    .join('\n');
  const body = renderFindings(
    { findings: annotated, ...caveatFlags },
    { label, profile, model },
  );
  return `${header}\n\n${body}`;
}

/**
 * The `--json` report: ONE merged object (the benchmark reads a single
 * `JSON.parse(stdout)`), additive over the single-pass shape. `findings[]` is
 * the union (each carrying `agreement`, `readablePasses`, `summaries[]`);
 * `passes[]` preserves each pass's own record; the top-level `requestedModel` /
 * `model` pair is the confirmed shared model (the run failed closed before here
 * if the passes disagreed), so a consumer's substitution check stays meaningful.
 * Caveat fields are the fail-closed OR across readable passes; `contextChecked`
 * is the AND. Per-pass originals stay in `passes[]`, so nothing is concealed.
 * `parsed: true` is hard-coded and honest — `reportPasses`'s precondition
 * guarantees at least one readable pass, so the union always carries real parses,
 * and a scoring consumer that gates on `report.parsed` (the single-pass shape's
 * own field) reads the merged record the same way.
 */
// A merged finding without its `agreement`/`readablePasses` pair — the lens-path
// projection. Everything else (file, line, severity, summary, summaries, evidence,
// lenses) is kept. A fresh object, so the shared merged finding is untouched.
function withoutAgreement(finding) {
  const { agreement, readablePasses, ...rest } = finding;
  return rest;
}

export function passesEnvelope(merged, { label, provider, requestedModel, model, modelReported, perPassReports, usage, reasoning, sampling, contextWindow, contextSource, detectedWindow, serverConfig, durationMs, attempts, finishReason, caveatFlags, contextChecked, strategy = 'passes', lenses = [] }) {
  return {
    kind: 'multi-pass-review',
    label,
    provider,
    parsed: true,
    // What varied across the passes: 'passes' (N plain passes of one prompt) or
    // 'lenses' (one pass per named lens). On the lens path `lenses` is the ordered
    // run list; each merged finding carries the lens(es) that flagged it in its own
    // `lenses[]`. A comparison reads `strategy` to refuse ranking a lens record
    // against a plain-passes one.
    strategy,
    lenses,
    passes: perPassReports,
    passCount: perPassReports.length,
    readablePasses: merged.readablePasses,
    requestedModel,
    model,
    modelReported,
    // On the lens path each finding's per-finding `agreement`/`readablePasses` are
    // OMITTED: duplicate lenses are refused, so `agreement === lenses.length` for
    // every finding, making the pair redundant with `lenses[]` while wearing a
    // confidence-shaped name a diverse-focus run must not invite a reader to rank
    // on. `lenses[]` is the sole per-finding signal there. The plain `--passes`
    // path is byte-unchanged. `mergePasses` stays strategy-neutral (it still
    // computes both); the omission is here, at the one seam that knows the strategy.
    findings: strategy === 'lenses' ? merged.findings.map(withoutAgreement) : merged.findings,
    ...caveatFlags,
    contextChecked,
    usage,
    // Shared across every pass (one target, one request shape) and carried at the
    // top level so a `--json` reader of the union gets the same facts the
    // single-pass `jsonReport` carries — otherwise the merged envelope is a LESS
    // honest object than its own per-pass records, which each hold these. Each
    // `?? null` mirrors `jsonReport`'s posture. `reasoning` is a witness over the
    // SUM across readable passes, not one reply: a mixed run (one pass reasoned,
    // one did not) reads `reasoning-observed` with the total, and a token-exhausted
    // pass's reasoning burn is invisible here (the sum's population is readable
    // passes only, matching `usage`) — `passes[]` is where that per-pass division
    // stays visible.
    reasoning,
    sampling: sampling ?? null,
    contextWindow: contextWindow ?? null,
    contextSource: contextSource ?? null,
    detectedWindow: detectedWindow ?? null,
    serverConfig: serverConfig ?? null,
    durationMs,
    // Bench-consumed, additive-equivalent to the single-pass `jsonReport`'s own
    // top-level pair. `attempts` is the whole-run reliability aggregate over ALL
    // passes (`bench/lib/attempt-rows.mjs` everyAttempt), null when nothing was
    // recorded. `finishReason` is the union's truncation signal
    // (`bench/lib/run-buckets.mjs` truncatedRuns): `'length'` iff ANY pass carrying
    // a result finished `'length'`, else `null` — a UNION CLASSIFICATION, never a
    // synthesized `'stop'`. Both are computed in `reportPasses`; see there for the
    // population rationale (all-passes vs the parse-null/thrown split).
    attempts,
    finishReason,
  };
}
