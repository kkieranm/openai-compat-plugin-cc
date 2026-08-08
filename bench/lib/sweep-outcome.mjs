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
 * 3. `deadline-timeout` and `idle-timeout` ONLY — a run that got going and then
 *    stopped producing.
 *
 * **The suffix match this used to do was too wide, and it inverted the rule.**
 * `http-errors.mjs` mints these as `` `${budget}-timeout` ``, so the suffix also
 * caught `first-byte-timeout` — which that file documents as what a LARGE PROMPT
 * looks like while the server ingests it, advising a bigger timeout rather than
 * reporting a dead server. Three big commits in a row would then have aborted a
 * perfectly healthy sweep and marked the rest `skipped-abort`: the exact harm
 * that excluding starvation was meant to avoid, reintroduced by the fix for it.
 *
 * **Deliberately NOT here:** `token-exhaustion` and `first-byte-timeout`, which
 * are what a big input does rather than what a broken server does; input
 * refusals such as `oversize`, which another commit may well survive; and
 * `output-too-large`, which is THIS HARNESS's own capture ceiling — ADR 021 calls
 * it a sweep defect rather than a review failure, and counting it as an outage
 * would have the sweep diagnose the server for its own limit.
 */
const UNWELL_TIMEOUTS = new Set(['deadline-timeout', 'idle-timeout']);

export function serverUnwell(reason) {
  if (typeof reason !== 'string' || !reason) return false;
  if (reason === TRANSPORT || reason === NON_RETRYABLE_TRANSPORT) return true;
  if (COMPLETION_SHAPES.has(reason)) return true;
  return UNWELL_TIMEOUTS.has(reason);
}

/**
 * Bound one captured stream, and say so when it was cut.
 *
 * Applied to `stderr` as well as `stdout`, which the first version missed: the
 * child capture allows 64MB per stream, so a night of verbose failures wrote
 * gigabytes into the record while `rawTruncated` stayed `false` because stdout
 * happened to be small. A record that quietly shortens its own evidence is the
 * same defect as a report that quietly shortens its own coverage.
 */
function bound(text) {
  const s = String(text ?? '');
  return s.length <= MAX_RAW ? { text: s, cut: false } : { text: s.slice(0, MAX_RAW), cut: true };
}

function captured(stdout, stderr) {
  const out = bound(stdout);
  const err = bound(stderr);
  return {
    raw: out.text,
    rawTruncated: out.cut,
    stderr: err.text,
    stderrTruncated: err.cut,
  };
}

/**
 * A reason that is safe to compare, or `null`.
 *
 * The envelope is a document from another process, so `reason` can be any JSON
 * value — and a non-string one used to throw out of `serverUnwell` and take the
 * whole sweep with it, erasing every commit that had not yet been reached. A
 * shape the harness cannot interpret is recorded as no reason rather than
 * trusted, which is the same rule the rest of this module keeps.
 */
function usableReason(stdout) {
  const reason = reasonFrom(stdout);
  return typeof reason === 'string' ? reason : null;
}

/**
 * What a failure envelope says.
 *
 * `reasonFrom` gates on `error === true` and never throws, so it is safe on
 * anything; it is asked before `outcomeFor`, which does a bare `JSON.parse`.
 *
 * **`requestedModel` is deliberately NOT carried as `model`.** `errorReport`
 * emits that field precisely because a failed run produced no report — it is the
 * model that was ASKED, and nothing answered. Carrying it as `model` made the
 * report say "answered by X" about a model that never replied, which is the
 * requested-versus-served conflation `adr/011` exists to stop this plugin
 * making. It is kept under its own name so the record kkeeps the fact without
 * the renderer being able to mistake it.
 */
function failure(stdout, status) {
  const reason = usableReason(stdout);
  return {
    outcome: reason === 'token-exhaustion' ? 'starved' : 'failed',
    reason,
    requestedModel: requestedModelFrom(stdout),
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
export function classify({ status, stdout, stderr, code, signal }) {
  // `signal` rides along on every branch: a child killed by a signal with no
  // stderr and no envelope is otherwise indistinguishable from an ordinary
  // crash, which defeats the diagnostic contract the rest of this adds.
  const kept = { ...captured(stdout, stderr), signal: signal ?? null };
  // The harness's own capture ceiling, not the child dying. `execFileSync`
  // throws ENOBUFS with `status: null`, which an earlier version turned into 1
  // and then reported as "the review process died without recording an outcome".
  if (code === 'ENOBUFS') return { outcome: 'output-too-large', ...kept };
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ''));
  } catch {
    return { outcome: status === 0 ? 'unreadable' : 'crashed', ...kept };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { outcome: status === 0 ? 'unreadable' : 'crashed', ...kept };
  }
  if (parsed.error === true) return { ...failure(stdout, status), ...kept };
  const settled = outcomeFor(stdout, false);
  if (settled.reason === 'model-substituted') {
    return { outcome: 'substituted', reason: settled.reason, model: settled.report?.model, ...kept };
  }
  return { ...reported(settled.report), ...kept };
}
