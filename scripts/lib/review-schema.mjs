// The review reply's shape, and how big each part of it may be.
//
// Split from `structured.mjs` — which owns the *dialect* (how to ask for JSON
// and how to get it back out) — because sizing the reply is a separate concern
// with its own arithmetic, and because the two together cross the file budget.
//
// The sizing is the point of this module. A ceiling here is not decoration: a
// grammar enforces `maxLength` as a hard cut at exactly the limit with
// `finish_reason: stop`, so a reply that hits one is complete, valid JSON that
// merely stopped thinking mid-sentence.
import { CHARS_PER_TOKEN } from './context-guard.mjs';

/**
 * The most findings one reply may carry.
 *
 * Exported because `renderFindings` has to say so when a list arrives at exactly
 * this length: unlike the string caps, which only ever trim reasoning, this one
 * can drop a defect the model actually found. Shared rather than copied so the
 * schema and the warning cannot disagree about where the edge is.
 */
export const MAX_FINDINGS = 20;

/**
 * How many findings the reply *budget* leaves room for — not how many the schema
 * permits, which stays `MAX_FINDINGS`.
 *
 * These were the same number until 2026-07-28, and holding room for twenty is
 * what crowded out the reasoning: on five of six benchmark cases the reserve was
 * ~55,700 characters while `analysis` was allowed 28,000, because ~24,500 was
 * held back for a reply shape that has never occurred. The most findings any
 * recorded reply has carried is six.
 *
 * **This is a chosen allowance, not a measured one.** Every observation behind
 * it was taken *under* the old cap, and more reasoning room may itself produce
 * more findings — so "six, plus headroom" is a bet about a distribution this
 * change is about to move, and it should be revisited against post-change data
 * rather than treated as settled. What it buys: a reply that does carry many
 * long findings on a tight window overruns `max_tokens` and fails loudly,
 * which is the trade taken deliberately.
 */
export const BUDGETED_FINDINGS = 8;

const FILE_CHARS = 200;
const SUMMARY_CHARS = 300;
const EVIDENCE_CHARS = 600;
const REPLY_SUMMARY_CHARS = 1_500;

// Per finding: the three capped strings, plus `line`, `severity`, the property
// names and JSON punctuation. Approximate on purpose — see RESERVED_CHARS.
const FINDING_CHARS = FILE_CHARS + SUMMARY_CHARS + EVIDENCE_CHARS + 100;

/**
 * The characters set aside for everything in the reply that is not `analysis`.
 *
 * **An estimate, and never a bound — the distinction matters enough to state.**
 * `maxLength` caps a *decoded* string, not its JSON serialization, so escaping
 * expands it; `line` is an integer with no bounded textual width; and
 * `CHARS_PER_TOKEN` was calibrated on input code and diffs, which is not
 * evidence about output prose on an arbitrary tokenizer. A guarantee here would
 * need `MAX_FINDINGS` lowered to `BUDGETED_FINDINGS` or the full twenty
 * reserved, and neither is the trade taken.
 *
 * So nothing in this repo claims the envelope fits. It is strictly better than
 * the flat constant it replaces, which fitted nothing at all and silently
 * over-committed a shrunken reserve; that is the whole claim.
 */
export const RESERVED_CHARS = BUDGETED_FINDINGS * FINDING_CHARS + REPLY_SUMMARY_CHARS + 200;

/**
 * The most reasoning any single review may do, whatever the window allows.
 *
 * A wall-clock bound, not an arithmetic one: 74,000 characters is roughly 21,765
 * tokens, which is ~6-9 minutes of generation on the MoE and ~28 minutes on a
 * dense 27B at the rates measured on 2026-07-28. Above this the reserve would
 * still permit more and a review would stop being worth waiting for.
 */
export const ANALYSIS_CEILING = 74_000;

/**
 * A defensive backstop, and deliberately **not** reachable by a real review.
 *
 * An earlier comment here called this "where reasoning becomes a formality",
 * which — with nothing preventing a review from landing on it — would have
 * described the code shipping exactly that: because the reserve shrinks as the
 * input grows, the largest and most complex diffs would have drawn the *least*
 * reasoning, and a review at the floor still returns valid JSON, so it would
 * have degraded quietly rather than failing. Caught by an adversarial review of
 * this design, and it was a fair hit.
 *
 * What keeps it unreachable is `REVIEW_MIN_TOKENS` (4,096) sitting above
 * `MIN_REVIEW_RESERVE_TOKENS` (3,912): the shrink stops at the former, so the
 * smallest cap a real review can be handed is ~2,626 characters, not 2,000. The
 * relationship is load-bearing and is pinned by a test — lower the reply floor
 * below the schema's minimum and the starved regime opens up again.
 *
 * Even 2,626 is a *shallow* review rather than a broken one, and it is reached
 * only when the input sits within ~4k tokens of the whole window, by which point
 * the ladder has already shed whole files for the diff alone. When the cap does
 * bind there, `analysisCut` says so — the review is labelled, not silently thin.
 */
export const ANALYSIS_FLOOR = 2_000;

/**
 * The smallest reply budget that can carry the floor plus the allowance.
 *
 * `reserveFor` hands back an explicit `--max-tokens` verbatim and
 * `prepareRequest` never raises it, so without this guard `--max-tokens 1000`
 * buys a 1,000-token reply carrying a 2,000-character analysis floor and an
 * 11,300-character allowance — over-committed before a byte is generated, while
 * the schema advertises otherwise.
 */
export const MIN_REVIEW_RESERVE_TOKENS = Math.ceil((ANALYSIS_FLOOR + RESERVED_CHARS) / CHARS_PER_TOKEN);

/**
 * How much room the reasoning field gets, given the reply budget actually
 * granted for this request.
 *
 * The reserve is not a constant: `prepareRequest` shrinks it toward
 * `REVIEW_MIN_TOKENS` when a large input needs the window, and it is the shrunk
 * value that goes on the wire as `max_tokens`. A fixed cap therefore agreed with
 * the reserve only by coincidence — on a 47k-token diff the schema's envelope
 * exceeded the budget actually sent.
 */
export function analysisCapFor(reserveTokens) {
  const chars = Math.floor(reserveTokens * CHARS_PER_TOKEN) - RESERVED_CHARS;
  return Math.min(ANALYSIS_CEILING, Math.max(ANALYSIS_FLOOR, chars));
}

// Strict schemas allow no optional properties — every key must be listed in
// `required`, so an absent value is expressed as a null type, not omission.
//
// Ceilings belong on output, floors on thinking, and the two are not
// interchangeable: `maxItems` on a *reasoning* array with no `minItems` hands
// the model a zero-cost exit, and it takes it (measured: `analysis: []` in six
// tokens). That is why `analysis` is a bounded string and not a bounded list.
export function reviewSchemaFor(reserveTokens) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['analysis', 'findings', 'summary'],
    properties: {
      // First, and load-bearing. A grammar constrains generation from the very
      // first token, so a schema that opens with `findings` forces the model to
      // commit to defects before it has read anything — measured on one 135-line
      // file, that produced 112 output tokens and one vague non-defect. The same
      // model, same prompt, with this field ahead of the findings, produced a
      // path-by-path analysis and found a real credential-stripping bug.
      // Reasoning space is not decoration here; removing it is what made the
      // reviewer useless.
      analysis: { type: 'string', maxLength: analysisCapFor(reserveTokens) },
      findings: {
        type: 'array',
        maxItems: MAX_FINDINGS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['file', 'line', 'severity', 'summary', 'evidence'],
          properties: {
            file: { type: 'string', maxLength: FILE_CHARS },
            line: { type: ['integer', 'null'] },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            summary: { type: 'string', maxLength: SUMMARY_CHARS },
            // Much roomier than the summary: this is meant to be a quoted line
            // of source, and one truncated mid-token is not checkable against
            // the code. 400 was the first guess and it cut a real finding on the
            // first diff tried — the model writes prose here rather than a bare
            // line, a known limit of requiring a field versus making it useful.
            // Sized to clear that.
            evidence: { type: 'string', maxLength: EVIDENCE_CHARS },
          },
        },
      },
      // Listed after findings so the model writes its conclusion having already
      // committed to the evidence, and has somewhere to say "nothing found"
      // rather than inventing a finding to fill an empty array.
      summary: { type: 'string', maxLength: REPLY_SUMMARY_CHARS },
    },
  };
}

/**
 * The schema at its widest — the *shape*, for identity checks, and the longest
 * instruction text this module can produce.
 *
 * Never send this with a request whose reserve was not checked against it. Its
 * one operational use is sizing: an instruction built from this is the longest
 * possible, so the reserve it leaves is a lower bound on what any real
 * instruction leaves, and a cap derived from that can only under-state the room
 * available. That is what breaks the degraded path's circularity — the
 * instruction's length depends on the cap, which depends on the reserve, which
 * depends on the instruction — without an iteration whose convergence nothing
 * would check.
 */
export const REVIEW_SCHEMA = reviewSchemaFor(Number.MAX_SAFE_INTEGER);
