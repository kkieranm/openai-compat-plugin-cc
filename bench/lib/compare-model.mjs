// Read N benchmark records together and decide what may be compared.
//
// `bench/` writes one record per invocation and nothing consumes more than one,
// so every cross-run ranking was assembled by hand — and the hand-assembly is
// where the errors were: a lens read as whole-file when the record said hunks, a
// tally mixing per-finding and per-cluster units, a worst-performer drawn from
// the wrong run. This module reads the records' own already-correct numbers
// (via `caseRows`, never a re-tally) and refuses to RANK records that are not
// like-for-like, because ranking incomparable records is how those errors happen.
//
// Pure: no I/O, no markdown. The split is `compare.mjs` reads files and
// `compare-report.mjs` renders; this decides what the comparison IS.
import { caseRows, lensLabel } from './case-rows.mjs';
import { scoredRuns } from './run-buckets.mjs';
import { reasoningWitness } from '../../scripts/lib/reasoning-witness.mjs';
import { reportIdentity } from './record.mjs';

// A review record is `{ runsPerCase, options, warmed, results }` — never a sweep
// or task record. A task record is `{ kind: 'task', options, ...sweep }`, so it
// carries a top-level `kind` and no numeric `runsPerCase`; both facts exclude it.
// The scope guard is here (not just in the CLI) so any caller shares one rule.
export function isReviewRecord(record) {
  return (
    !!record &&
    typeof record === 'object' &&
    !Array.isArray(record) &&
    !('kind' in record) &&
    typeof record.runsPerCase === 'number' &&
    !!record.options &&
    typeof record.options === 'object' &&
    Array.isArray(record.results) &&
    record.results.length > 0
  );
}

const median = (values) => {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Every own key of the parsed caseDef, key-order-normalised but ARRAY ORDER
// PRESERVED — `caseDef.files` is emitted to the review command in array order,
// so a reordered `files` is a materially different input and must NOT share a
// signature; sorting nested arrays would have hidden exactly that. Records for
// one case id come from the same corpus manifest, so their `defects` arrays are
// already in identical order — a reorder is then read as a definition change,
// fail-closed. Serialising the WHOLE object rather than a field list is
// deliberate: an enumerated subset is exactly what once dropped `control`.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const known = (value) => ({ state: 'known', value });
const unknown = (reason) => ({ state: 'unknown', reason });

// A numeric value flag: absence is a definite "default" (compared as null); a
// finite number, or a non-empty numeric string, compares numerically. The string
// grammar is the writer's own — `Number()` + `Number.isFinite`, per
// `scripts/lib/parse-number.mjs` — so every form the CLI persists ("1", "1.0",
// ".5", "1e2", "+5") reads as a known number and two records made with the same
// option are not falsely divergent. The `typeof` gate stays load-bearing: it
// runs FIRST so a hostile array/object/boolean is UNKNOWN rather than coerced
// (`Number([])` is 0), and `Number()` then only ever sees a primitive string, so
// no `valueOf`/`toString` is invoked. An empty/whitespace string is UNKNOWN
// (fail-closed: the writer would read it as 0, we do not equate two blanks); the
// reason is a bounded `typeof` label, never a stack-blowing `JSON.stringify`.
function numericAxis(raw) {
  if (raw === undefined || raw === null) return known(null);
  if (typeof raw === 'number') return Number.isFinite(raw) ? known(raw) : unknown('non-finite number');
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const n = Number(trimmed);
    return trimmed !== '' && Number.isFinite(n) ? known(n) : unknown('non-numeric string value');
  }
  return unknown(`non-numeric option value (${typeof raw})`);
}

// The wall-clock cap is CONFIG, never the outcome count `row.capped` (which is
// how many runs hit a deadline). Three states: an explicit value compares; an
// absent value with a capped run means a cap existed at an unknown value; an
// absent value with no capped run means no CLI cap was set (a provider-side cap
// still cannot be disproven, disclosed in the report rather than here).
function capAxis(options, rows) {
  const raw = options['max-seconds'];
  if (raw !== undefined && raw !== null) return numericAxis(raw);
  const anyCapped = rows.some((row) => row.capped > 0);
  return anyCapped ? unknown('a cap was in force (capped runs) but --max-seconds was not recorded') : known(null);
}

// The comparability axes, sourced from the exact keys the writer persists (raw
// `options` + top-level `runsPerCase`) — the same set `renderReport` threads as
// "must be tellable apart". Booleans coerce with `Boolean` (absence = false, as
// the writer reads them); values coerce numerically; the cap is three-state.
function scalarAxes(record, rows) {
  const o = record.options;
  return {
    'diff-only': known(Boolean(o['diff-only'])),
    cold: known(Boolean(o.cold)),
    'warm-up': known(Boolean(o['warm-up'])),
    'structured-output': known(Boolean(o['structured-output'])),
    // Effective degradation is judged PER CASE in `divergencesOf`, not here: a
    // record-level `some(degraded)` boolean equates two records that degraded on
    // DIFFERENT cases, the exact miscomparison the axis exists to catch.
    timeout: numericAxis(o.timeout),
    'max-tokens': numericAxis(o['max-tokens']),
    temperature: numericAxis(o.temperature),
    'max-attempts': numericAxis(o['max-attempts']),
    // `/oai:review --passes`: a multi-pass record's findings are a deduplicated
    // union across N passes, not one pass's output, so ranking it against a
    // single-pass record would compare unlike things. An ABSENT `passes` is the
    // byte-identical single-pass code path (`--passes 1` is `cmd-review.mjs`'s own
    // no-op branch), and every legacy record predates the flag and was single-pass —
    // so `?? 1` normalises both to `known(1)`, comparing EQUAL to an explicit
    // `--passes 1` and diverging only from a genuine `--passes 2+`. Normalising
    // absent to 1 is TRUE of those records, not a papered-over confound.
    passes: numericAxis(o.passes ?? 1),
    'max-seconds': capAxis(o, rows),
    'runs-per-case': known(record.runsPerCase),
  };
}

// The lens a run reviewed at for COMPARABILITY: `lensLabel`'s own label when it
// can be PROVEN, or null (unknown) otherwise. Delegating the label to `lensLabel`
// (rather than recomputing rung@window) is load-bearing: the matrix DISPLAYS
// `row.lens` (built by `lensLabel`) while ranking GATES on this, so a second copy
// of the format could make the report show one label and suppress on another.
// A non-diff run must carry `hunksOnly`, `skippedUnsizedWindow`, AND
// `contextWindow` as present keys. `contextWindow` presence matters because it
// entered the writer (OAI-217, 2026-08-27) LATER than the other lens fields and
// is written `?? null` — so under the current writer the key is always present
// (null iff genuinely unsized, which is a proven state), while a middle-era
// record carries `hunksOnly`/`skippedUnsizedWindow` but no `contextWindow` and
// its `lensLabel` reads `@unsized` even when the window was actually sized. That
// record cannot prove its depth, so its lens is unknown — requiring the KEY (not
// a finite value) suppresses exactly those ambiguous records without touching a
// current-writer unsized run, whose key is present as null.
function lensLabelStrict(run) {
  if (typeof run.diffOnly !== 'boolean') return null;
  if (run.diffOnly) return lensLabel(run);
  const report = run.report;
  if (!report || !('hunksOnly' in report) || !('skippedUnsizedWindow' in report) || !('contextWindow' in report)) {
    return null;
  }
  return lensLabel(run);
}

// Per case: the set of strict lens labels, or unknown if any SCORED run's lens
// cannot be proven. Over `scoredRuns` — the runs that produced recall — not
// `measurable`: comparability must be judged over the same population the ranked
// measurement is, or a truncated (measurable, non-scored) run can make two records'
// lens sets equal while their scored runs' depths differ, concealing a real
// difference. A scored run with no report (the defensive-reader shape) yields a
// null strict label → unknown, caught by the `lensUnknown` arm; and an empty known
// set therefore means `scored === 0`, which the coverage axis owns.
function lensByCase(results) {
  const map = new Map();
  for (const { caseDef, runs } of results) {
    const labels = new Set();
    let isUnknown = false;
    for (const run of scoredRuns(runs)) {
      const label = lensLabelStrict(run);
      if (label === null) {
        isUnknown = true;
        break;
      }
      labels.add(label);
    }
    map.set(
      caseDef.id,
      isUnknown
        ? unknown('a run lacks a field needed to prove its lens (diffOnly, hunksOnly/skippedUnsizedWindow, or contextWindow)')
        : known([...labels].sort()),
    );
  }
  return map;
}

// Per case: the deduped, sort-canonicalised set of observed reasoning states over
// the SCORED runs — the comparability counterpart to the displayed `row.reasoning`
// (which stays over `measurable` in `case-rows.mjs`). Derived here, not read off the
// row, precisely so the comparison uses the scored population while the display keeps
// the wider one. `run.report?.usage` is optional-chained: a scored run with no report
// classifies as `unknown` (no usage to witness) rather than throwing — so an empty set
// means `scored === 0` (coverage's job), never a scored-but-unwitnessed record.
function reasoningByCase(results) {
  const map = new Map();
  for (const { caseDef, runs } of results) {
    const states = new Set(scoredRuns(runs).map((run) => reasoningWitness(run.report?.usage).state));
    map.set(caseDef.id, [...states].sort());
  }
  return map;
}

/**
 * Normalise one record into the facts a comparison reads, or mark it
 * incompatible. Never throws: a month-old corpus must not crash the run, so a
 * record whose nested shape `caseRows` cannot read becomes `{ incompatible }`.
 */
export function normalizeReviewRecord(entry) {
  const { path, stamp, record } = entry;
  const base = { path, stamp };
  // Only the minimum `caseRows` iterates. Per-run shape is deliberately NOT
  // checked: a clean-but-unreadable run carries neither `score` nor `error`, and
  // demanding one would reject a valid record. `caseRows`'s own guards + the
  // try/catch below cover the rest.
  if (
    !record ||
    !Array.isArray(record.results) ||
    record.results.length === 0 ||
    record.results.some((r) => !r || typeof r.caseDef !== 'object' || !r.caseDef || !Array.isArray(r.runs))
  ) {
    return { ...base, incompatible: true, reason: 'not a readable review record (missing results/caseDef/runs)' };
  }
  // Every case id must be a usable primitive. It keys `caseSig`/`caseIds` and is
  // string-coerced OUTSIDE the try/catch below — in `divergencesOf`'s `.join(',')`
  // and `case "${id}"` messages, and in the rendered matrix — so a non-primitive id
  // (a hostile object whose `toString` throws) would crash the whole run at one of
  // those sites rather than marking THIS record incompatible. `typeof` never
  // invokes `toString`, so the check is safe.
  const ids = record.results.map((r) => r.caseDef.id);
  if (ids.some((id) => typeof id !== 'string' && typeof id !== 'number')) {
    return { ...base, incompatible: true, reason: 'a case id is not a string or number' };
  }
  // Duplicate case ids double-count in `aggregate` (which sums every row) while
  // the Set/Map axes collapse them to one — a SILENT mis-rank, the exact failure
  // this reader exists to prevent. A well-formed record has one row per case.
  if (new Set(ids).size !== ids.length) {
    return { ...base, incompatible: true, reason: 'duplicate case ids in one record' };
  }
  // The WHOLE derivation is guarded, not just `caseRows`: `canonicalJson`
  // recurses, `reportIdentity`/`scalarAxes`/`lensByCase` all dereference nested
  // record fields, and any of them throwing on a pathological record (a deeply
  // nested `caseDef`, a hostile `options`) must mark THIS record incompatible,
  // never crash the whole invocation — the "Never throws" promise above.
  try {
    const rows = caseRows(record.results, { cold: Boolean(record.options?.cold) });
    const caseSig = new Map();
    for (const { caseDef } of record.results) caseSig.set(caseDef.id, canonicalJson(caseDef));
    return {
      ...base,
      incompatible: false,
      identity: reportIdentity(record.results, record.options),
      runsPerCase: record.runsPerCase,
      rows,
      axes: scalarAxes(record, rows),
      caseIds: new Set(record.results.map((r) => r.caseDef.id)),
      caseSig,
      lens: lensByCase(record.results),
      reasoningScored: reasoningByCase(record.results),
    };
  } catch (error) {
    return { ...base, incompatible: true, reason: `this record could not be read: ${error.message}` };
  }
}

// `<model> @ <stamp>`, made GLOBALLY unique: a repeated base gets a `(#i)`
// suffix, extended until the whole set is distinct (see the block comment below
// for why a single suffix is not enough).
function labelRecords(normalized) {
  // `identity.model` is the server-reported reply model — a string in bench's own
  // output, but a corrupted record could carry a non-string whose `toString`
  // throws when interpolated (both `String()` and a template invoke it), crashing
  // the run here, outside `normalizeReviewRecord`'s guard. `typeof`-gate it.
  const modelOf = (n) =>
    n.incompatible ? '(unreadable)' : typeof n.identity.model === 'string' ? n.identity.model : 'unknown';
  const base = normalized.map((n) => `${modelOf(n)} @ ${n.stamp}`);
  const counts = new Map();
  for (const label of base) counts.set(label, (counts.get(label) ?? 0) + 1);
  // Labels must be GLOBALLY unique: a `(#i)` collision suffix could otherwise
  // equal another entry's natural base label — `stamp` is a user-supplied
  // filename (compare.mjs's basename), so a file literally named
  // `<model> @ <stamp> (#1).json` is reachable — which would break the ranking
  // comparator's label tiebreak (two distinct records comparing equal, an invalid
  // total order) and make baseline lookup match the wrong record. Give a repeated
  // base its `(#i)`, then extend the suffix until the whole set is distinct.
  const seen = new Set();
  return base.map((label, i) => {
    let out = counts.get(label) === 1 ? label : `${label} (#${i + 1})`;
    let k = i + 1;
    while (seen.has(out)) {
      k += 1;
      out = `${label} (#${k})`;
    }
    seen.add(out);
    return out;
  });
}

function aggregate(rows) {
  const nonControl = rows.filter((row) => !row.control);
  const control = rows.filter((row) => row.control);
  const opportunities = nonControl.reduce((t, row) => t + row.opportunities, 0);
  const found = nonControl.reduce((t, row) => t + row.found, 0);
  const unmatched = nonControl.reduce((t, row) => t + row.unmatched, 0);
  const controlFP = control.reduce((t, row) => t + row.unmatched, 0);
  // Scored-run counts, so the false-positive tie-breakers can be RATES. recall
  // is already a rate (per opportunity), but raw `unmatched`/`controlFP` totals
  // scale with how many runs SUCCEEDED — so a record that failed more runs has a
  // smaller total and would unfairly rank ahead of a more reliable one. The
  // per-scored-run rate removes that (Pass 2).
  const scoredRunCount = nonControl.reduce((t, row) => t + row.scored, 0);
  const controlScored = control.reduce((t, row) => t + row.scored, 0);
  const throughput = median(rows.flatMap((row) => row.rate?.values ?? []));
  return {
    opportunities,
    found,
    unmatched,
    controlFP,
    scoredRuns: scoredRunCount,
    controlScored,
    unmatchedRate: scoredRunCount > 0 ? unmatched / scoredRunCount : 0,
    controlFPRate: controlScored > 0 ? controlFP / controlScored : 0,
    recall: opportunities > 0 ? found / opportunities : null,
    throughput,
  };
}

// A case's effective structured-output state as a class INSENSITIVE to failure
// counts (which are outcome, not config): `none` (no answered run degraded),
// `all` (every answered run degraded), `partial` (some did). A case with no
// answered run (`reported` 0) is `none` here — its coverage mismatch is the
// coverage axis's to catch, not this one's.
function degradationClass(row) {
  if (!row || !row.reported || row.degraded === 0) return 'none';
  return row.degraded >= row.reported ? 'all' : 'partial';
}

// Why the compatible records cannot be ranked, one entry per divergent axis.
// Empty ⇒ rankable. A scalar axis diverges if any record is unknown, or the
// known values disagree; the per-case axes (case definition, coverage,
// effective degradation, lens, reasoning) diverge on the first offending case.
function divergencesOf(compatible) {
  const out = [];
  if (compatible.length < 2) return out; // nothing to rank against; handled by the caller
  const [first, ...rest] = compatible;

  const sig = (axis) => (axis.state === 'known' ? JSON.stringify(axis.value) : `unknown:${axis.reason}`);
  for (const name of Object.keys(first.axes)) {
    const states = compatible.map((n) => n.axes[name]);
    const unknownRec = states.find((s) => s.state === 'unknown');
    if (unknownRec) {
      out.push({ axis: name, detail: unknownRec.reason });
      continue;
    }
    const first0 = sig(states[0]);
    if (states.some((s) => sig(s) !== first0)) out.push({ axis: name, detail: 'values differ across records' });
  }

  const firstIds = [...first.caseIds].sort().join(',');
  if (rest.some((n) => [...n.caseIds].sort().join(',') !== firstIds)) {
    out.push({ axis: 'case set', detail: 'records cover different cases' });
  } else {
    const rowsById = compatible.map((n) => new Map(n.rows.map((row) => [row.id, row])));
    for (const id of first.caseIds) {
      if (rest.some((n) => n.caseSig.get(id) !== first.caseSig.get(id))) {
        out.push({ axis: 'case definition', detail: `case "${id}" is defined differently across records (a reordered defects/files array counts)` });
        break;
      }
    }
    // Coverage: a case scored in one record but not another (all its runs failed)
    // gives the two aggregates different denominators — they cover different
    // ground and cannot be ranked. This owns the scored-presence mismatch; because
    // the lens and reasoning axes below derive their sets over the SAME scored
    // population, an empty set there means exactly `scored === 0`, which is this
    // axis's case, so neither needs an empty-set arm of its own.
    for (const id of first.caseIds) {
      const scored = rowsById.map((m) => (m.get(id)?.scored ?? 0) > 0);
      if (scored.some((s) => s !== scored[0])) {
        out.push({ axis: 'coverage', detail: `case "${id}" was scored in some records but failed in others` });
        break;
      }
    }
    // Effective degradation, PER CASE: two records that fell back from the schema
    // on different cases did not run under the same constraint.
    for (const id of first.caseIds) {
      const classes = rowsById.map((m) => degradationClass(m.get(id)));
      if (classes.some((c) => c !== classes[0])) {
        out.push({ axis: 'structured-output-effective', detail: `case "${id}" degraded differently across records` });
        break;
      }
    }
    // Lens: among the records that scored the case, a depth difference or an
    // unprovable lens. `n.lens` is derived over the SCORED runs (see `lensByCase`),
    // so an empty known set means `scored === 0` (coverage's case above), and a
    // scored run that cannot prove its depth is the `unknown` state the first arm
    // catches — no separate empty-set arm is needed.
    for (const id of first.caseIds) {
      const lenses = compatible.map((n) => n.lens.get(id)).filter(Boolean);
      const lensUnknown = lenses.find((l) => l.state === 'unknown');
      if (lensUnknown) {
        out.push({ axis: 'lens', detail: `case "${id}": ${lensUnknown.reason}` });
        break;
      }
      const observed = lenses.filter((l) => l.value.length > 0).map((l) => JSON.stringify(l.value));
      if (observed.length >= 2 && observed.some((s) => s !== observed[0])) {
        out.push({ axis: 'lens', detail: `case "${id}" reviewed at different depths` });
        break;
      }
    }
    // Reasoning: the observed thinking-channel state the SCORED runs ran under — a
    // server-controlled input (`enable_thinking`, unreachable over the wire, OAI-221),
    // the same class as lens. Compared over `n.reasoningScored` (the scored-run set),
    // NOT the displayed `row.reasoning` (which spans `measurable` runs): a truncated
    // run's reasoning state would otherwise inflate the set and could conceal a real
    // scored-run difference. Fail-closed Option A: among records that scored the case
    // (a non-empty set — an empty one means `scored === 0`, coverage's job), a
    // differing set suppresses, INCLUDING known-vs-unknown; two records both witnessing
    // only `unknown` agree and rank through (suppressing that would make every provider
    // that omits the reasoning detail unrankable). A scored run with no report classifies
    // `unknown`, so it suppresses against a known state and ranks through only against
    // another unknown. `n.reasoningScored` is sorted at derivation, so a bare
    // `JSON.stringify` is canonical.
    for (const id of first.caseIds) {
      const observed = compatible
        .map((n) => n.reasoningScored.get(id))
        .filter((r) => r && r.length > 0)
        .map((r) => JSON.stringify(r));
      if (observed.length >= 2 && observed.some((s) => s !== observed[0])) {
        out.push({ axis: 'reasoning', detail: `case "${id}" reviewed under different reasoning states` });
        break;
      }
    }
  }
  return out;
}

/**
 * Build the whole comparison model the renderer formats. `baseline` is a record
 * PATH; deltas render only for exactly two records or an explicitly named
 * baseline, since a delta against an ambiguous baseline for N>2 misleads.
 */
export function buildComparison(normalized, { baseline = null } = {}) {
  const labels = labelRecords(normalized);
  const records = normalized.map((n, i) => ({
    label: labels[i],
    path: n.path,
    stamp: n.stamp,
    incompatible: n.incompatible,
    ...(n.incompatible
      ? { reason: n.reason }
      : { identity: n.identity, runsPerCase: n.runsPerCase, rows: n.rows, aggregate: aggregate(n.rows) }),
  }));

  const readable = records.filter((r) => !r.incompatible);
  const compatible = normalized.filter((n) => !n.incompatible);
  const divergences = divergencesOf(compatible);
  // A set can be like-for-like (no divergences) yet have NOTHING to rank: every
  // run failed, so every recall is null and no control case scored. Ranking it
  // would present a meaningless alphabetical order 1/2 over zero evidence. Require
  // at least one record to carry a rankable measurement — a non-null recall, or a
  // scored control case (whose false-positive rate is real precision evidence).
  const hasEvidence = readable.some((r) => r.aggregate.recall !== null || r.aggregate.controlScored > 0);
  const rankable = compatible.length >= 2 && divergences.length === 0 && hasEvidence;

  const caseUnion = [...new Set(compatible.flatMap((n) => [...n.caseIds]))].sort();

  // The ordered record objects when rankable — the renderer reads `.label` and
  // `.aggregate` off them directly rather than re-joining by label string.
  const ranking = rankable
    ? [...readable].sort((a, b) => {
        const ar = a.aggregate.recall;
        const br = b.aggregate.recall;
        // The final tie-break is the LABEL, three-way, so the comparator is
        // antisymmetric — `stamp` alone returned 1 for BOTH (a,b) and (b,a) when
        // two entries shared a stamp (the same file passed twice), an invalid
        // comparator whose result is engine-dependent. Label is `<model> @ <stamp>`
        // with a `(#i)` suffix on collision, so it is a total, deterministic order.
        const byLabel = a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
        // Recall orders the ranking, but a WHOLE rankable set can be null-recall —
        // a control-only comparison (recall is null by construction when there are
        // no non-control opportunities). Compare recall only while at least one
        // side has it: a MIX (one null, one not) is unreachable in a rankable set
        // anyway, since the coverage axis forces the records to agree per-case on
        // which runs scored, so either every record has a non-null recall or none
        // does. When none does, fall through to the rate tie-breaks so a
        // control-only comparison orders by `controlFPRate` (fewer false positives
        // first) rather than alphabetically. Those rates are like-for-like for the
        // same coverage reason: `controlScored`-presence is uniform across the set,
        // so no record's default-0 rate (absence misread as perfect precision)
        // sits beside a real one — which is why no evidence-presence pre-order is
        // needed here (it would be inert and untestable through this path).
        if (ar !== null || br !== null) {
          if (ar === null) return 1; // a lone all-failed record sorts last (unreachable in a rankable set)
          if (br === null) return -1;
          if (br !== ar) return br - ar; // recall desc
        }
        // Tie-breakers are per-scored-run RATES, not raw totals — see aggregate().
        if (a.aggregate.unmatchedRate !== b.aggregate.unmatchedRate) return a.aggregate.unmatchedRate - b.aggregate.unmatchedRate;
        if (a.aggregate.controlFPRate !== b.aggregate.controlFPRate) return a.aggregate.controlFPRate - b.aggregate.controlFPRate;
        return byLabel;
      })
    : null;

  // Deltas only where a baseline is unambiguous.
  let baselineLabel = null;
  if (baseline) {
    baselineLabel = readable.find((r) => r.path === baseline)?.label ?? null;
  } else if (normalized.length === 2 && readable.length === 2) {
    // Gate on the INPUT count, not just the readable count: three inputs with
    // one incompatible must NOT silently auto-pick a baseline the N>2 rule
    // forbids. Both conditions, so two inputs with one unreadable emits no Δ
    // preamble over an empty Δ column either.
    baselineLabel = readable[0].label;
  }

  return { records, compatibleCount: compatible.length, rankable, ranking, divergences, caseUnion, baselineLabel };
}
