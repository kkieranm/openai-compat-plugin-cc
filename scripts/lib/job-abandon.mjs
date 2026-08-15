// Writing off a row whose worker this build cannot prove is gone.
//
// Liveness here is `process.kill(pid, 0)`, which proves a pid NUMBER is in use
// and never whose. A recycled pid therefore reads `live` for as long as the
// unrelated process lives, `job-reconcile.mjs` never terminalizes it, and the
// row blocks the queue for an unbounded time. Nothing signals anything — that
// restraint is absolute and `tests/queue-guards.test.js` enforces it — so the
// only recovery available is to write off the ROW, and only an operator may ask.
//
// **This is the one path that clears a live row, and it costs the queue's
// mutual-exclusion guarantee.** `job-queue.mjs` and `job-heartbeat.mjs` say why
// that guarantee exists; both now name this exception. The stale-beat
// precondition is what makes taking it defensible: a beat is the only evidence
// this design can offer that no model call is in flight, which is why `--force`
// is a separate act rather than a default.
import { beatIsStale, livenessOf, relevantPid } from './job-liveness.mjs';
import { couldDrain } from './job-drain.mjs';
import { inImmediateTransaction } from './job-queue.mjs';
import { reconcile } from './job-reconcile.mjs';
import { OPERATOR_ABANDONED, finish, isKnownVersion, jobById } from './job-record.mjs';
import { errorReport } from './review-report.mjs';

/**
 * The states this command may write off, as a WHITELIST.
 *
 * Not "everything non-terminal": an unrecognised state must be refused here
 * rather than reaching `finish`, whose `WHERE state IN ('queued','running')`
 * would match nothing and return a `false` indistinguishable from losing a race.
 * A refusal names its reason; a lost CAS cannot.
 */
const ABANDONABLE = new Set(['queued', 'running']);

/**
 * The terminal shapes ORDINARY RECOVERY writes, as opposed to the ones a worker,
 * a submitter or this command writes.
 *
 * Recognised by state AND reason, because neither alone is enough: `failed` is
 * four-way ambiguous (a model failure, a launch that could not be confirmed, an
 * earlier abandonment, or recovery), and `cancelled` carries no failure payload
 * at all — `job-reconcile.mjs` is its only writer anywhere.
 *
 * **This is a PROVENANCE test, not a taxonomy of epistemically similar failures**
 * — which is why `worker-launch-unconfirmed` is deliberately absent. It is a
 * sibling of `worker-never-started` in what it establishes about registration,
 * but the SUBMITTER writes it, and the exit-0 message this set unlocks says the
 * row was "settled by ordinary recovery". Admitting it would make that sentence
 * misattribute who wrote the verdict.
 *
 * An earlier version of this comment argued the case was unreachable — that such
 * a row "cannot race an abandon". The race argument is true and is not the
 * reason: an operator can abandon such a row at any later time, and does get the
 * ordinary refusal. That is correct, and it is correct for the reason above.
 */
const RECONCILER_FAILURE_REASONS = new Set(['worker-died', 'cancel-unconfirmed', 'worker-never-started']);

function recoveryOwned(row) {
  if (row.state === 'cancelled') return true;
  // Fails CLOSED on an unreadable payload: `decode` nulls a `failure` that will
  // not parse, and inferring "recovery already handled this" from bytes we could
  // not read is the fabrication class this module has been bitten by twice.
  return row.state === 'failed' && RECONCILER_FAILURE_REASONS.has(row.failure?.reason);
}

/**
 * May this row be written off, and on what grounds — a pure question about a row
 * AND the liveness already resolved for it.
 *
 * **Liveness is an argument, not something this function derives.** It used to
 * probe nothing at all: the only `livenessOf` call sat in the `starting` branch,
 * gated on there being no pid to probe, so every ordinary row was authorised on
 * beat staleness alone while the stored failure claimed a probe had answered.
 * The probe that justified that claim ran in another module, before the lock, and
 * a caller invoking `abandonRow` directly never ran it at all. Passing the
 * verdict in makes the evidence and the decision the same fact — the pattern
 * `reconcile` already uses.
 *
 * The order is deliberate. The refusals no flag can lift come FIRST, so that no
 * amount of operator insistence reaches them — `gone` above them all, then: `unknown-version`
 * (a row a newer plugin wrote is never mutated by this build — `job-reconcile.mjs`
 * refuses the same thing and `finish` carries no schema predicate of its own, so
 * the guard lives here or the invariant has a hole exactly this command wide),
 * `not-abandonable` (terminal immutability belongs to the database, not to
 * policy), `starting`, and `dead`.
 *
 * **`starting` must sit AHEAD of the beat rungs.** A queued row inside
 * `STARTUP_GRACE_MS` with no waiter registered has no beat *yet*; its worker is
 * about to register. Letting `--force` write that off would spend the grace on
 * the one case it exists to protect.
 *
 * **`dead` is a refusal rather than an authorisation**, and that is the point of
 * resolving liveness here: a row whose pid is gone is ordinary reconciliation's
 * work, and recording `operator-abandoned` over it would attribute a death to an
 * operator who merely asked. `abandonRow` turns this one into a recovery.
 *
 * **`malformed` is liftable, deliberately.** A `running` row with no pid, or a
 * queued one whose timestamps will not parse, is a shape this build will not
 * guess at — but refusing it outright would leave a corrupt row wedging the queue
 * with no operator escape at all, which is the whole defect this command exists
 * to remove. So it is refused by default and `--force` lifts it, and the stored
 * message must not claim a probe that could not run.
 *
 * `no-beat` fails CLOSED, which is the opposite of what `beatIsStale` does with
 * the same input. Note what it now covers: `registerWaiter` and `claimJob` each
 * write a pid and a beat in ONE statement and `finish` never nulls a beat, so a
 * row with a live pid and no beat at all cannot be produced by this build — the
 * reachable case is a beat that will not PARSE, which is why the refusal claims
 * no knowledge rather than an absence of check-ins.
 */
export function abandonDecision(row, nowMs, { override = false, liveness } = {}) {
  if (!row) return { allowed: false, reason: 'gone' };
  if (!isKnownVersion(row)) return { allowed: false, reason: 'unknown-version' };
  if (!ABANDONABLE.has(row.state)) return { allowed: false, reason: 'not-abandonable' };

  // Falls back to deriving it so the pure unit tests stay pure. `abandonRow`
  // always passes it, and the structural guard is what holds that: a verdict
  // minted outside the lock is the defect this argument exists to remove.
  const state = liveness ?? livenessOf(row, nowMs);

  if (state === 'starting') return { allowed: false, reason: 'starting' };
  // Both shapes `reconcile` owns, refused for the same reason: this command may
  // not record an operator's verdict over a row ordinary recovery will settle
  // correctly on its own. `never-started` is here rather than falling to the beat
  // rungs because it has no beat by construction, so it would otherwise read as
  // `no-beat` and be liftable — writing `operator-abandoned` over a submission
  // that simply never spawned.
  if (state === 'dead' || state === 'never-started') return { allowed: false, reason: 'dead' };
  if (state === 'malformed') {
    return override ? { allowed: true, reason: 'forced-malformed' } : { allowed: false, reason: 'malformed' };
  }

  if (!Number.isFinite(Date.parse(row.last_beat_at ?? ''))) {
    return override ? { allowed: true, reason: 'forced' } : { allowed: false, reason: 'no-beat' };
  }
  if (!beatIsStale(row, nowMs)) {
    return override ? { allowed: true, reason: 'forced' } : { allowed: false, reason: 'beating' };
  }
  return { allowed: true, reason: 'stale' };
}

/**
 * What the row says afterwards.
 *
 * `failed`, never `cancelled`: OAI-66 established that a stop nobody confirmed
 * must not read as a tidy cancellation, and this stop is confirmed by less than
 * any of those — the process was never even asked. The reason names the ROW's
 * fate rather than the worker's, because the worker's is exactly what is unknown.
 */
function abandonFailure(row, liveness) {
  const running = row.state === 'running';
  // **The pid goes in the MESSAGE because the write destroys the column** —
  // `finish` sets `worker_pid = NULL` — and it is recorded as EVIDENCE, never as
  // an instruction. This whole command exists because a recorded pid cannot be
  // proved to still belong to its job; telling the operator to go and stop that
  // number would hand them the exact mistake the plugin refuses to make itself.
  // So the message says which pid was recorded and that it may since be
  // something else, and stops there.
  const pid = relevantPid(row);
  // Two arms, keyed on what the transaction actually resolved. The probe wording
  // is only available when a probe happened: a `malformed` row forced through has
  // no pid to probe, or timestamps that cannot be read, and claiming otherwise
  // put a false sentence in the permanent record for a supported recovery.
  const observed = liveness === 'malformed'
    ? `Job ${row.id} was written off by an operator. Its pid or timestamps could not be read, so no`
      + ' liveness judgement was possible for it at all.'
    : `Job ${row.id} was written off by an operator while the pid recorded for its`
      + ` ${running ? 'worker' : 'waiter'} (${pid ?? 'unknown'}) answered a liveness probe taken`
      + ' during the decision.';
  return errorReport({
    // The constant, not the literal: `job-retention.mjs` keys its exemption on
    // this exact value, and a rename that touched only one side would quietly
    // resume deleting the rows that exemption protects.
    reason: OPERATOR_ABANDONED,
    message: `${observed} Nothing was signalled, so this says what happened to the ROW and nothing`
      + ' about the process.',
    // The hint branches with the message. Batch 3 split the message and left this
    // shared — so a malformed row's permanent record said no judgement was
    // possible AND that a pid was recorded as evidence a probe answered, in the
    // same envelope.
    hint: liveness === 'malformed'
      ? 'Anything it printed is in the job log. No pid or timestamps could be read for this row, so'
        + ' there is no probe result and no pid to attribute — the record says only that an operator'
        + ' wrote it off.'
      : 'Anything it printed is in the job log. A pid here is recorded as evidence, not as a target:'
        + ' this build cannot prove it still belongs to this job, and it may since have been reused by'
        + ' something unrelated. The probe answered during the decision and proves nothing about now.',
  });
}

/**
 * This row is ordinary recovery's, not ours — hand it over, under the lock.
 *
 * Safe here and unsafe inside `decide`: `reconcile` writes plain UPDATEs, and the
 * one filesystem read on its path (`cancelAckMatches`) is contractually
 * non-throwing — the same synchronous I/O `decide` already accepts while holding
 * this lock. A throw would roll back and exit the OPERATOR's command, never a
 * waiting worker's.
 */
function handOver(db, row, { nowMs, at, liveness }) {
  const recovered = reconcile(db, row, { nowMs, at, liveness });
  if (!recovered) {
    // Same treatment as the sibling CAS miss, for the same reason: both
    // terminalize predicates match a state this transaction just read under the
    // lock, so a miss means the invariant stopped holding. Inventing a cause —
    // the previous `?? 'worker-died'` — asserted a death for a row that may never
    // have had a worker at all.
    throw new Error(`abandon invariant broken: reconcile wrote nothing for ${row.id} under the lock`);
  }
  // Keyed on the LIVENESS, not `decision.reason`, which collapses both shapes into
  // `dead`. Only one of them ever had a process: `never-started` means no worker
  // ever REGISTERED — not that nothing was spawned, since a child can die between
  // spawn and registration.
  return {
    outcome: 'recovered',
    recoveryKind: liveness === 'never-started' ? 'never-started' : 'dead',
    reason: recovered,
    state: row.state,
    // Reported here too, and the omission it replaces was justified circularly:
    // "there is no such computation on this path, so the claim would be unearned"
    // — adding the computation earns it. A recovered row was a blocker just as an
    // abandoned one was, and `reconcile` has already written it terminal inside
    // this same transaction, so it drops out of both scans exactly as the
    // abandoned row does.
    couldDrain: couldDrain(db, nowMs),
    row,
  };
}

/**
 * Resolve, decide and write — all four inside ONE `BEGIN IMMEDIATE`.
 *
 * **The read and the liveness probe are as load-bearing as the write.** `beat`
 * refreshes `last_beat_at` on any non-terminal row and `finish` compares only
 * state, so a decision made on bytes read before the lock is one a worker
 * resuming from sleep can invalidate with nothing noticing. And a liveness
 * verdict taken before the lock — in another module, as the command used to —
 * is a fact about a moment that has passed by the time the row is written, while
 * the stored message claims it as evidence. Both are minted here now, and
 * `tests/queue-guards.test.js` enforces the placement structurally rather than
 * trusting this comment.
 *
 * **A `dead` pid returns a RECOVERY, not an abandonment.** Ordinary
 * reconciliation owns that row: recording `operator-abandoned` over a worker that
 * had simply died would attribute a death to the operator who asked about it, and
 * would overwrite a `cancelled` / `cancel-unconfirmed` verdict that a pending
 * cancellation had earned. The reason travels as a VALUE rather than a literal so
 * the refusal-vocabulary pin keeps describing refusals only.
 *
 * The returned `state` is the row's state as this transaction FOUND it, not the
 * `failed` it wrote — the caller needs the former to say what abandoning it
 * meant, and only this transaction ever saw it authoritatively.
 */
export function abandonRow(db, id, { override = false, at }) {
  return inImmediateTransaction(db, () => {
    // **Sampled HERE, and the placement is the fix.** A default parameter is
    // evaluated at call time — before `BEGIN IMMEDIATE`, which can block for the
    // store's whole `busy_timeout` (10s). Every judgement below reads a clock, so
    // a pre-lock sample judges a beat that went stale, or a successor that
    // expired, as they were ten seconds ago. ONE sample, not one per rung: the
    // hazard is entirely in acquiring the lock, everything after is synchronous
    // and lock-held, and two clocks behind one "At that moment" would be worse.
    // `tryAcquire` mints one per transaction for both of `decide`'s rungs.
    const nowMs = Date.now();
    const row = jobById(db, id);
    const liveness = row ? livenessOf(row, nowMs) : null;
    const decision = abandonDecision(row, nowMs, { override, liveness });

    // Idempotence, and it is what stops a CONCURRENT reconcile reproducing the
    // exit-1 refusal this command was once fixed for. Placed after the decision
    // so it inherits the `unknown-version` rung's ordering: a newer plugin's
    // failure payload is never interpreted, only refused.
    if (!decision.allowed && decision.reason === 'not-abandonable' && recoveryOwned(row)) {
      return { outcome: 'already-recovered', reason: row.failure?.reason ?? row.state, state: row.state, row };
    }

    if (!decision.allowed && decision.reason === 'dead') return handOver(db, row, { nowMs, at, liveness });
    if (!decision.allowed) {
      return { outcome: 'refused', reason: decision.reason, state: row?.state ?? null, row };
    }

    const found = row.state;
    if (!finish(db, row.seq, { state: 'failed', failure: abandonFailure(row, liveness), at })) {
      // Unreachable under this lock: the whitelist is exactly `finish`'s `WHERE`
      // set and nothing can move the row between the read and the write. It
      // throws rather than reporting, because the only way to arrive here is that
      // the invariant stopped holding — and a command that reported `abandoned`
      // over a write which did not land would be worse than one that stopped.
      // Nothing has been written, so the rollback costs nothing.
      throw new Error(`abandon invariant broken: ${id} passed the decision and finish() matched no row`);
    }
    return {
      outcome: 'abandoned',
      reason: decision.reason,
      state: found,
      couldDrain: couldDrain(db, nowMs),
      row,
    };
  });
}
