// What one finished review means — the whole of the sweep's honesty, in one place.
//
// Extracted from `review-sweep.mjs` when reading the envelope's caveat fields
// pushed that file toward its size budget. The seam is real rather than
// arithmetic: this module decides what a reply MEANS, the harness decides what
// to do next.
//
// The premise it defends: a review that starved for tokens and a review that
// genuinely found nothing are both an empty findings list. Anything that reads
// only `findings` will call both of them clean, and a night that measured almost
// nothing then reads as a night that found almost nothing.
//
// **The CLI already says which it was — in fields, not prose.** `analysisCut`
// is the caveat meaning the model never finished looking; `atCap` means the
// findings list was cut at the ceiling; `hunksOnly` means the whole files did not
// fit and only the diff was reviewed; `dropped` counts findings the model DID
// emit that normalization discarded. `review-report.mjs` states the rule these
// serve — "a fact changing what the reader should believe cannot live on one
// path alone". Reading `findings` and none of them is how the first version of
// this file reported a truncated analysis as `clean`.
import { COMPLETION_SHAPES, NON_RETRYABLE_TRANSPORT, TRANSPORT } from '../../scripts/lib/failure-shape.mjs';
import { outcomeFor, reasonFrom, requestedModelFrom } from './outcome.mjs';

/** Outcomes that mean a model actually read the commit and reported on it. */
export const REVIEWED = new Set(['findings', 'clean']);

/**
 * How much of a child's stdout to keep in the machine record.
 *
 * The record exists to hold the raw `--json` per commit, so it is kept rather
 * than summarised — but a pathological reply must not make the artifact
 * unopenable. Truncation is RECORDED (`rawTruncated`) rather than silent,
 * because a record that quietly shortens its own evidence is the same defect
 * class as a report that quietly shortens its own coverage.
 */
export const MAX_RAW = 256_000;

/**
 * Reasons that mean the SERVER is unwell, for the fail-fast counter.
 *
 * Three groups, and the boundary is "would another commit fare any better":
 *
 * 1. `TRANSPORT` / `NON_RETRYABLE_TRANSPORT` — the connection itself.
 * 2. `COMPLETION_SHAPES` — `empty-completion`, `stream-unfinished`,
 *    `blank-completion`. **This group is the load-bearing one on this hardware**:
 *    ADR 012 and OAI-20 measure it as the dominant failure at 27 of 72 runs, and
 *    omitting it meant the guard could not fire on the exact outage it was
 *    written for.
 * 3. Any `*-timeout`. There is no constant to import — `http-errors.mjs` mints
 *    these as `` `${budget}-timeout` `` — so this matches the idiom already used
 *    at `provider.mjs`, which tests the suffix.
 *
 * **Deliberately NOT here:** `token-exhaustion`, which is the model's budget
 * rather than the server's health — three large commits in a row must not read
 * as an outage — and input refusals such as `oversize`, which another commit may
 * well survive.
 */
export function serverUnwell(reason) {
  if (!reason) return false;
  if (reason === TRANSPORT || reason === NON_RETRYABLE_TRANSPORT) return true;
  if (COMPLETION_SHAPES.has(reason)) return true;
  return reason.endsWith('-timeout');
}

function raw(stdout) {
  const text = String(stdout ?? '');
  if (text.length <= MAX_RAW) return { raw: text, rawTruncated: false };
  return { raw: text.slice(0, MAX_RAW), rawTruncated: true };
}

/**
 * A failure envelope, or `null` when this is not one.
 *
 * `reasonFrom` gates on `error === true` and never throws, so it is safe on
 * anything; it is asked before `outcomeFor`, which does a bare `JSON.parse`.
 */
function failure(stdout, status) {
  const reason = reasonFrom(stdout);
  if (reason === null && !String(stdout ?? '').includes('"error"')) return null;
  return {
    outcome: reason === 'token-exhaustion' ? 'starved' : 'failed',
    reason,
    model: requestedModelFrom(stdout),
    status,
  };
}

/**
 * A completed report's verdict, reading every field that changes what a reader
 * should believe.
 *
 * `analysisCut` outranks the findings list: a truncated analysis did not finish
 * looking, so whatever it managed to say is not a review of the commit. `atCap`
 * and `dropped` do NOT demote it — findings were produced and are worth reading —
 * but both ride along so the report can say the list is incomplete.
 */
function reported(report) {
  const findings = report?.findings;
  const caveats = {
    model: report?.model ?? null,
    analysisCut: report?.analysisCut ?? null,
    atCap: report?.atCap ?? null,
    hunksOnly: report?.hunksOnly ?? null,
    dropped: report?.dropped ?? null,
  };
  // `null` is "could not be read" and `[]` is "read, nothing found" — the
  // distinction ADR 003 exists to protect.
  if (!Array.isArray(findings)) return { outcome: 'unreadable', ...caveats };
  if (report?.analysisCut) return { outcome: 'truncated', findings, ...caveats };
  return { outcome: findings.length > 0 ? 'findings' : 'clean', findings, ...caveats };
}

/**
 * What one finished child means. The ORDER is load-bearing, not stylistic.
 *
 * `outcomeFor` does a bare `JSON.parse` and throws on anything malformed, so
 * unparseable output is classified and returned before it can reach it. Both
 * helpers take RAW STDOUT and parse it themselves — handing either a parsed
 * object returns null and silently loses every reason.
 */
export function classify({ status, stdout, stderr, code }) {
  const kept = raw(stdout);
  // The harness's own capture ceiling, not the child dying. `execFileSync`
  // throws ENOBUFS with `status: null`, which an earlier version turned into 1
  // and then reported as "the review process died without recording an outcome".
  if (code === 'ENOBUFS') return { outcome: 'output-too-large', stderr, ...kept };
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ''));
  } catch {
    return { outcome: status === 0 ? 'unreadable' : 'crashed', stderr, ...kept };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { outcome: status === 0 ? 'unreadable' : 'crashed', stderr, ...kept };
  }
  const failed = parsed.error === true ? failure(stdout, status) : null;
  if (failed) return { ...failed, stderr, ...kept };
  const settled = outcomeFor(stdout, false);
  if (settled.reason === 'model-substituted') {
    return { outcome: 'substituted', reason: settled.reason, model: settled.report?.model, ...kept };
  }
  return { ...reported(settled.report), ...kept };
}
