// Read N sweep ledgers together and compute a PER-COMMIT REPRODUCTION RATE across
// runs — the number that decides whether any sweep A/B means anything, since a
// single run's per-commit output is unstable enough that a large fraction of
// finding-bearing commits do not reproduce on identical inputs. Nothing else in
// `bench/` reads more than one sweep at a time, so before this every cross-run
// claim was assembled by hand.
//
// **The reproduction denominator is REVIEWED runs only.** A commit that starved,
// failed, crashed, was skipped, or whose write was lost was NOT reviewed in that
// run — it is a non-observation, not a non-reproduction, and counting it as one
// would understate agreement exactly the way a naive rate does. So `n` (the
// denominator) counts only runs whose outcome the model actually produced
// (`findings`/`clean`), and `k` (the numerator) the finding-bearing ones.
//
// **Identity across runs is the commit SHA and the run's OBSERVED model** — the
// id `entry.model` names, but only where the server CONFIRMED it (`modelReported`):
// a reply that did not confirm is the requested id echoed back (completion.mjs), no
// proof that model answered, so it fails the run closed. A run is ungroupable rather
// than joined on an identity it cannot prove when any hard axis is unprovable — an
// unconfirmed or missing model, two models answering, a run that reviewed nothing,
// or a lost record (a gap, a discarded line, or a commit recorded twice — the
// separate `integrity` axis). A record written before `modelReported` existed is
// grouped on its bare `entry.model` but DISCLOSED as provenance-unverifiable, the
// same legacy policy the soft axes take for a knob a ledger predates.
//
// This module computes; `sweep-reproduction-report.mjs` renders. It is a stateless
// reader: the ledgers on disk ARE the history, consumed rather than replaced.
import { basename } from 'node:path';
import { readLedger, ledgerStampFrom } from './sweep-ledger.mjs';
import { REVIEWED } from './sweep-outcome.mjs';
import { UserError } from '../../scripts/lib/errors.mjs';

// The two shapes an axis value takes, mirroring `compare-model.mjs`'s own
// known/unknown machinery: a proven value that two runs can be equated on, or an
// unknown that fails closed. `unknown` carries WHY, which the report discloses.
const known = (value) => ({ state: 'known', value });
const unknown = (reason) => ({ state: 'unknown', reason });

// A findings-bearing lead that is NOT a clean review: a truncated or substituted
// reply can still carry real leads, but it is a non-observation for the rate, so
// it is surfaced separately rather than counted.
const LEAD_OUTCOMES = new Set(['truncated', 'substituted']);

// The outcomes in which a model actually ANSWERED — a clean/findings review, or a
// truncated/substituted reply that still ran one. A failed/starved entry is NOT
// here: `sweep-outcome.mjs`'s `failure()` writes no `model`, so it can neither widen
// the answerer set nor trip the identity checks below.
const ANSWER_BEARING = new Set([...REVIEWED, ...LEAD_OUTCOMES]);

// The soft axes, one list feeding both the signature and the divergence check, so
// a knob recorded in the header cannot be silently dropped from the suppression
// test — a new confound would then compare without a caveat.
export const SOFT_AXES = ['diffOnly', 'maxAttempts', 'provider'];

// The run's stamp, read out of the ledger filename the sweep chose, so a run's
// label sorts beside its own artifacts. A path that is not a sweep ledger name
// falls back to the basename rather than throwing — the label is cosmetic.
export function stampFromPath(path) {
  return ledgerStampFrom(path) ?? basename(path);
}

// A single soft axis, known iff the header actually carries the key. A ledger
// written before the envelope grew simply omits it, which reads as `unknown`
// (disclosed) rather than as a false `known(undefined)` that could equate two
// runs on a value neither recorded. A recorded `null` provider (no `--provider`
// profile, or a `--base-url` override that makes any profile label meaningless)
// stays `known(null)`: it is a distinct value for the divergence test (a named
// profile vs `null` must still suppress), while `softVerdicts` separately
// discloses it, since such a run's endpoint is not identifiable.
function softAxis(header, key) {
  return key in header ? known(header[key]) : unknown('not recorded before the envelope grew');
}

// Whether a soft-axis value identifies the run's configuration. `unknown` never
// does; a recorded `null` (no `--provider` profile / ad-hoc endpoint) does not
// either, so both draw a disclosure — separately from the divergence test, where
// `null` is a real value that suppresses against a named profile.
const unverifiable = (axis) => axis.state === 'unknown' || (axis.state === 'known' && axis.value === null);

/**
 * The observed model over a run's answering entries, or `unknown` with the reason it
 * could not be pinned. Fail-closed in every branch: a run with no provable single
 * model identity must not group. Integrity is a SEPARATE axis (below), so this
 * reasons only about the identity of what did answer.
 */
function observedModel(entries) {
  const reviewed = entries.filter((entry) => REVIEWED.has(entry.outcome));
  if (reviewed.length === 0) return unknown('the run reviewed no commit');
  // The outcomes that PROMISE a model answered — a clean/findings review, or a
  // truncated/substituted reply that still ran one — checked for a MISSING id, since
  // there the id should be present. An `unreadable` reply is deliberately not here:
  // it made no parseable report, so a missing id on it is not a hole (a real run
  // reviewed by qwen with one unreadable-and-model-less commit must still group).
  const answerBearing = entries.filter((entry) => ANSWER_BEARING.has(entry.outcome));
  if (answerBearing.some((entry) => typeof entry.model !== 'string' || entry.model === '')) {
    return unknown('an answer-bearing entry carries no model id');
  }
  // `modelReported` must be a clean tri-state, checked over EVERY entry (a report-bearing
  // `unreadable` carries it too, and is the one report outcome outside the missing-id set
  // above, so scoping this narrower would let it slip through):
  //   absent / null  → LEGACY (a record predating the field; `sweep-outcome.mjs` writes
  //                    `?? null`, so a legacy record is a PRESENT null, not undefined) —
  //                    the run groups on its bare `entry.model` and is disclosed.
  //   false          → the server did not confirm; the requested id was echoed back, no
  //                    proof that model answered — fail the run closed.
  //   true           → confirmed, and MUST name a model; a `true` with no id is
  //                    contradictory (claims a named model, carries none) — fail closed.
  //   anything else  → a malformed record; fail closed, the same posture `integrityAxis`
  //                    takes for a malformed entry.
  for (const entry of entries) {
    const confirmed = entry.modelReported;
    if (confirmed === undefined || confirmed === null) continue;
    if (confirmed === false) return unknown('a reply did not confirm its model — the requested id was echoed');
    if (confirmed !== true) return unknown('an entry has a malformed model-confirmation flag');
    if (typeof entry.model !== 'string' || entry.model === '') {
      return unknown('an entry claims a confirmed model but carries none');
    }
  }
  // Every entry that DID name a model, whatever its outcome — a report-bearing
  // `unreadable` also carries the model that answered it, so a second one there is a
  // second answerer. Sound over all outcomes because `failure()` writes no `model`,
  // so a failed/starved entry can never appear here.
  const modelBearing = entries.filter((entry) => typeof entry.model === 'string' && entry.model !== '');
  // A run answered by two distinct models cannot prove a single identity.
  const answerers = new Set(modelBearing.map((entry) => entry.model));
  if (answerers.size !== 1) return unknown('more than one model answered');
  return known([...answerers][0]);
}

/**
 * Whether every answering reply CONFIRMED its model, or some record predates the
 * `modelReported` field. A run with an unconfirmed reply (`=== false`) never reaches
 * a comparable group — `observedModel` already made it ungroupable — so this only
 * distinguishes a fully-proven run from a legacy one grouped on its bare `entry.model`
 * and disclosed. `unverified` is any MODEL-BEARING entry not positively confirmed —
 * the same set `observedModel` reads its identity from, so the disclosure covers
 * exactly the entries whose model the group was equated on.
 */
function modelProvenance(entries) {
  const modelBearing = entries.filter((entry) => typeof entry.model === 'string' && entry.model !== '');
  return modelBearing.every((entry) => entry.modelReported === true) ? 'verified' : 'unverified';
}

/**
 * Whether the run's records are all present. A lost record — a gap, or a discarded
 * line — means `byCommit` is incomplete AND the surviving entries cannot be proven
 * to be the run's complete model set; either alone makes the run ungroupable, which
 * is why integrity is its own hard axis rather than folded into `observedModel`
 * (where a future header-recorded model id could make it provable and silently drop
 * this guard, letting an incomplete run group with undercounted observations).
 */
function integrityAxis({ gaps, discarded, entries }) {
  if (gaps.length > 0 || discarded > 0) {
    return unknown('a record was lost (a gap or discarded line), so the run is incomplete');
  }
  // A parseable entry with no commit id is a malformed record `readLedger` admits
  // (it gates on `entry` truthiness, not shape): its outcome cannot be attributed
  // to a commit, so the run's observation set is not trustworthy — fail closed
  // rather than let it group looking intact while an outcome floats unattached.
  if (entries.some((entry) => typeof entry.sha !== 'string' || entry.sha === '')) {
    return unknown('an entry carries no commit id, so the run is malformed');
  }
  // Two entries for one commit contradict each other — `byCommit` would silently
  // keep the last, concealing the other outcome (a findings/clean pair would read
  // as unanimous agreement with whichever wrote last). A single sweep reviews each
  // commit once, so a duplicate is a corrupt run, not a valid one: fail closed. All
  // shas are non-empty strings here — the guard above returned otherwise.
  const shas = entries.map((entry) => entry.sha);
  if (new Set(shas).size !== shas.length) {
    return unknown('a commit appears more than once, so its outcomes contradict');
  }
  return known('intact');
}

/**
 * The comparability signature of one ledger. Hard axes must be known and equal for
 * two runs to be comparable; soft axes shape the disclosed caveats. Takes the raw
 * `readLedger` output because observed model and the integrity axes need the full
 * entries and gap/discarded counts, not the reduced `byCommit` map.
 */
export function signatureOf(ledger) {
  const { header, entries } = ledger;
  // Deduped, not just sorted: `--include scripts --include scripts` records
  // `['scripts','scripts']`, and two runs that requested the same include set with
  // different repetition are one group, not two singletons. Reader-side
  // normalization; the envelope stays raw.
  const include = Array.isArray(header.include) ? [...new Set(header.include)].sort() : [];
  return {
    hard: {
      repo: typeof header.repo === 'string' ? known(header.repo) : unknown('no repo recorded'),
      include: Array.isArray(header.include) ? known(include) : unknown('no include set recorded'),
      maxSeconds: Number.isFinite(header.maxSeconds) ? known(header.maxSeconds) : unknown('no window recorded'),
      observedModel: observedModel(entries),
      integrity: integrityAxis(ledger),
    },
    soft: Object.fromEntries(SOFT_AXES.map((key) => [key, softAxis(header, key)])),
    // Not a hard axis (it never changes the group key) and not soft (it never
    // suppresses): a legacy run and a confirmed run on the same model id are the
    // same group, the legacy one merely disclosed. So it rides beside the axes as
    // its own per-run marker, read in `reproductionOf` into a disclosure caveat.
    provenance: modelProvenance(entries),
  };
}

/**
 * Read every ledger into the per-run shape the rest of the module consumes.
 * `byCommit` retains EVERY entry's outcome, not just the REVIEWED ones — the
 * denominator filter lives in `reproductionOf` so a commit reviewed in one run and
 * starved in another is present, and so the filter is a single point a mutation
 * can flip. Refuses a file `readLedger` could not read a header from.
 */
export function readRuns(paths) {
  return paths.map((path) => {
    const ledger = readLedger(path);
    if (ledger.header === null) {
      throw new UserError(`Not a readable sweep ledger (no usable header): "${path}".`);
    }
    // A commit-id-bearing entry only: a malformed sha-less entry (which
    // `integrityAxis` catches to make the whole run ungroupable) must never key
    // `byCommit`/`leads` under `undefined`, where two of them would collapse onto
    // one row.
    const identified = ledger.entries.filter((entry) => typeof entry.sha === 'string' && entry.sha !== '');
    const byCommit = new Map();
    for (const entry of identified) byCommit.set(entry.sha, entry.outcome);
    const leads = identified
      .filter((entry) => LEAD_OUTCOMES.has(entry.outcome) && Array.isArray(entry.findings) && entry.findings.length > 0)
      .map((entry) => ({ sha: entry.sha, subject: entry.subject, outcome: entry.outcome, count: entry.findings.length }));
    return {
      path,
      stamp: stampFromPath(path),
      header: ledger.header,
      signature: signatureOf(ledger),
      byCommit,
      leads,
      integrity: { gaps: ledger.gaps, discarded: ledger.discarded },
    };
  });
}

// Only ever called on a known axis — `groupRuns` diverts any run with an unknown
// hard axis before a key is built — so the value alone is the identity.
const sig = (axis) => JSON.stringify(axis.value);

/**
 * Group runs by their hard axes. A run whose hard axes are all known and equal to
 * another's shares its group; a run with ANY unknown hard axis (in practice, an
 * unprovable observed model) is ungroupable and kept as its own singleton so its
 * integrity and gaps still render. Every run is placed exactly once.
 */
export function groupRuns(runs) {
  const groups = [];
  const byKey = new Map();
  for (const run of runs) {
    const hard = run.signature.hard;
    const ungroupable = Object.values(hard).find((axis) => axis.state === 'unknown');
    if (ungroupable) {
      groups.push({ groupable: false, reason: ungroupable.reason, runs: [run] });
      continue;
    }
    const key = Object.keys(hard).sort().map((name) => `${name}=${sig(hard[name])}`).join('');
    let group = byKey.get(key);
    if (!group) {
      group = { groupable: true, runs: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.runs.push(run);
  }
  return groups;
}

// The soft-axis verdict over a comparable group: a real divergence (>=2 distinct
// known values, `null` counting as one) suppresses and names the axis; otherwise
// any run whose value does not identify its configuration (unknown, or a recorded
// `null`) compares but discloses, naming those runs; all-known-and-identifying is
// silent.
function softVerdicts(runs) {
  const caveats = [];
  const suppressions = [];
  for (const axis of SOFT_AXES) {
    const states = runs.map((run) => ({ stamp: run.stamp, axis: run.signature.soft[axis] }));
    const knownValues = new Set(states.filter((s) => s.axis.state === 'known').map((s) => JSON.stringify(s.axis.value)));
    if (knownValues.size >= 2) {
      suppressions.push({ axis, values: [...knownValues] });
      continue;
    }
    const disclosed = states.filter((s) => unverifiable(s.axis)).map((s) => s.stamp);
    if (disclosed.length > 0) caveats.push({ axis, runs: disclosed });
  }
  return { caveats, suppressions };
}

/**
 * The per-commit reproduction of one comparable group. Returns a suppression when a
 * soft axis carries two distinct known values (a real confound made visible), else
 * the rows, aggregate, per-run totals and disclosed caveats. `n` counts only runs
 * that REVIEWED the sha; a sha reviewed by no run in the group produces no row.
 */
export function reproductionOf(group) {
  const { runs } = group;
  const soft = softVerdicts(runs);
  if (soft.suppressions.length > 0) {
    return { suppressed: true, suppressions: soft.suppressions, runs };
  }

  const shas = new Set();
  for (const run of runs) for (const sha of run.byCommit.keys()) shas.add(sha);

  const rows = [];
  for (const sha of shas) {
    const reviewed = runs.filter((run) => REVIEWED.has(run.byCommit.get(sha)));
    const n = reviewed.length;
    if (n === 0) continue; // reviewed by nobody in this group — not a reproduction row
    const k = reviewed.filter((run) => run.byCommit.get(sha) === 'findings').length;
    const cells = runs.map((run) => ({ stamp: run.stamp, outcome: run.byCommit.get(sha) ?? null }));
    rows.push({ sha, n, k, reproduced: n >= 2 && (k === 0 || k === n), flagged: n < 2, cells });
  }

  // Every aggregate figure is over the comparable (n>=2) population, so the report
  // sentence's numbers share one denominator — a finding-bearing commit reviewed by
  // only one run is an n=1 flagged matrix row, never folded into a rate.
  const comparable = rows.filter((row) => row.n >= 2);
  const findingBearing = comparable.filter((row) => row.k > 0);
  const aggregate = {
    comparableCommits: comparable.length,
    unanimous: comparable.filter((row) => row.reproduced).length,
    findingBearingCommits: findingBearing.length,
    // The N-run consensus analogue of OAI-141's per-reference reproduction rate: of
    // the comparable (n>=2) commits any reviewing run found a finding on, how many
    // did EVERY reviewing run find one on. Overall unanimity is dominated by commits
    // all runs agreed were clean and hides this, the tool's whole point. It is a
    // DIFFERENT statistic from OAI-141's own directional figure ("12 of run A's 17")
    // — a symmetric consensus, not a per-reference rate — so read the two as separate
    // measures, never one as the other's degradation; the matrix's per-run cells
    // carry any directional figure a reader wants.
    findingBearingReproduced: findingBearing.filter((row) => row.k === row.n).length,
  };
  const perRun = runs.map((run) => {
    let reviewedCount = 0;
    let findingBearingCount = 0;
    for (const outcome of run.byCommit.values()) {
      if (!REVIEWED.has(outcome)) continue;
      reviewedCount += 1;
      if (outcome === 'findings') findingBearingCount += 1;
    }
    return { stamp: run.stamp, reviewedCount, findingBearingCount };
  });

  // Provenance is a disclosure, never a suppression: a run grouped on a model id no
  // server confirmed (a pre-`modelReported` ledger) is compared, but the reader is
  // told its identity is unproven — the same posture the soft axes take for a knob a
  // ledger predates. Appended to the soft-axis caveats under its own axis label.
  const legacy = runs.filter((run) => run.signature.provenance === 'unverified').map((run) => run.stamp);
  const caveats = legacy.length > 0 ? [...soft.caveats, { axis: 'model provenance', runs: legacy }] : soft.caveats;

  return { suppressed: false, rows, aggregate, perRun, caveats, runs };
}
