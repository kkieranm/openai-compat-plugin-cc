// Is the process a job row names still there?
//
// The only place in this repo that asks anything about another process, and it
// asks with signal 0 — a probe that delivers nothing. Cancel is cooperative for
// exactly this reason: a pid can be recycled between the moment it is recorded
// and the moment it is read, so a real signal could land on something that has
// nothing to do with this plugin. `tests/queue-guards.test.js` guards that no
// source file ever passes a signal other than 0.

/**
 * How long a job may sit with no worker registered before it is treated as one
 * whose worker never started.
 *
 * It bounds exactly one window, and is now read by two callers — this file's
 * verdict, and `/oai:abandon`'s grace refusal, which counts the remainder down
 * for the operator. The row is committed and the child is spawned
 * in two steps, and a submitter that dies between them leaves a row nothing will
 * ever pick up. **No AUTOMATIC path abandons a worker that HAS registered,
 * however long it waits**, which is what lets an indefinite `--max-wait` coexist
 * with a two-minute grace. The one thing that can is `/oai:abandon`, an explicit
 * operator command; nothing here reaches it.
 */
export const STARTUP_GRACE_MS = 120_000;

/**
 * How long a live process may go without saying anything before a reader calls
 * it `stalled`.
 *
 * Twelve missed beats at `job-heartbeat.mjs`'s interval. Generous on purpose:
 * the beat is a timer, and a worker deep in a model call still fires it — even
 * during prefill, which produces no bytes for minutes but leaves the event loop
 * idle. A gap this wide therefore means the process is not running its loop at
 * all: suspended, or wedged.
 *
 * **`stalled` is never terminal and never a verdict about the job.** The pid
 * decides death; the beat only corroborates. Reading a stale beat as death would
 * deadlock cancellation, since a worker's last act before exiting is to beat.
 *
 * **Narrowed, not reversed, when `/oai:abandon` landed.** The beat still causes
 * no state transition on its own and no automatic path consults it. What it now
 * does is gate the REFUSAL of an explicit operator request: `job-abandon.mjs`
 * will not terminalize a row whose beat is fresh unless the operator passes
 * `--force`. Evidence an assertion is checked against, never an assertion.
 *
 * It may not be promoted further, and the reason is mechanical rather than
 * cautious: a process asleep, `SIGSTOP`ped, or blocked in a synchronous call
 * does not run its timer, and machine sleep advances the wall clock without
 * running it either — so a live worker mid-answer looks exactly like a dead one.
 * Machine sleep is also when pids get recycled, so the two cases arrive
 * together.
 */
export const STALE_BEAT_MS = 60_000;

/**
 * Has this row gone quiet for longer than a live worker ever should?
 *
 * Read by two callers that disagree about what silence means, deliberately.
 * `/oai:status` shows `stalled` and treats an unparseable beat as NOT stale — a
 * job in its first moments has no beat yet, and flagging every one of those
 * would make the label worthless. `job-abandon.mjs` fails closed on the same
 * input instead, because there the question is whether to destroy a row.
 * One predicate, two policies; the policies live at the callers.
 */
export function beatIsStale(row, nowMs) {
  const last = Date.parse(row.last_beat_at ?? '');
  if (!Number.isFinite(last)) return false;
  return nowMs - last > STALE_BEAT_MS;
}

/**
 * What the OS will say about a pid: `live`, `gone`, or `unreadable`.
 *
 * **Three facts, not two, and collapsing them was OAI-162.** `EPERM` means the
 * process exists and belongs to someone else, which is still alive — reading it
 * as dead would let one user's plugin terminalize another's running job. Only
 * `ESRCH` means gone. Everything else is an absence of evidence: a value that is
 * not a pid at all, and an errno this build does not interpret. Reporting either
 * as death auto-terminalizes a row on nothing.
 *
 * **The shape check runs BEFORE the probe, and that order is load-bearing** —
 * `kill(0, 0)` signals the whole process group and `kill(-1, 0)` every process
 * the user may signal, so both SUCCEED and would read as `live`. It catches
 * `-1`, `0`, `1.5` and `'garbage'`, none of which ever reaches `process.kill`.
 *
 * **What the catch-all actually catches, measured rather than assumed.** For
 * signal 0 the OS gives only `EPERM` and `ESRCH`, so its whole reachable
 * population is a POSITIVE INTEGER outside the range Node will accept as a pid —
 * anything from `2 ** 31` up — which Node's own argument validator rejects
 * **before any syscall is made**. So no message downstream may say a probe was
 * attempted and came back inconclusive: nothing was asked. What is true of every
 * value that lands here is only that this build could not read it as a pid, and a
 * genuinely uninterpretable errno would be indistinguishable from that if one
 * ever occurred.
 *
 * **That rejection is a `TypeError` carrying `code: 'ERR_INVALID_ARG_TYPE'` — a
 * NODE error code, not a POSIX errno.** Written out because the obvious guard for
 * "an error we do not interpret" is `if (!error.code)`, which would be false here
 * and would send every such value down the `EPERM`/`ESRCH` comparisons instead.
 * The arms below test for the two errnos by name for exactly that reason.
 */
export function pidLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unreadable';
  try {
    process.kill(pid, 0);
    return 'live';
  } catch (error) {
    if (error?.code === 'EPERM') return 'live';
    if (error?.code === 'ESRCH') return 'gone';
    return 'unreadable';
  }
}

/**
 * Alive, as far as the OS will say.
 *
 * A projection of `pidLiveness` kept because two test helpers ask exactly this
 * yes/no question of a real pid. It answers `false` for `gone` and `unreadable`
 * alike, so it must not be used where the difference decides anything — which is
 * the mistake it existed as for its whole life before OAI-162.
 */
export function isAlive(pid) {
  return pidLiveness(pid) === 'live';
}

/**
 * Whichever pid the row's state makes relevant: a queued job is held by its
 * waiter, a running one by its worker.
 *
 * Asking about the wrong one is how a queued worker's death became unobservable
 * in an earlier design — and an unobservable death is an uncancellable job.
 */
export function relevantPid(row) {
  if (row.state === 'queued') return row.waiter_pid ?? null;
  if (row.state === 'running') return row.worker_pid ?? null;
  return null;
}

/**
 * Was a pid recorded for this row at all — as opposed to readable?
 *
 * The question that separates the two queued `malformed` shapes, and it is asked
 * at three sites in three files — `cmd-abandon.mjs`, `job-render.mjs`, and
 * `livenessOf` below — so it is defined once rather than written three ways.
 * **`livenessOf`'s use of it is a pure identity substitution that no mutation can
 * prove**: `relevantPid` has already normalised `undefined` to `null` there, so
 * the two forms cannot disagree and nothing would go red if this one were wrong.
 * A consistency edit, and saying so is cheaper than implying a verification that
 * did not happen. Lives beside `relevantPid` because that is what feeds it.
 *
 * **`!== null`, never truthiness.** A recorded `0` is a pid that cannot be read,
 * not a pid that is absent, and `if (pid)` files it under the wrong one — which
 * is OAI-162's own defect wearing a different hat. Takes the VALUE, so a caller
 * reading a raw column passes the column and a caller holding a view passes
 * `view.pid`; `relevantPid` has already normalised `undefined` to `null` for the
 * ones that go through it.
 */
export function pidWasRecorded(pid) {
  return pid !== null && pid !== undefined;
}

/**
 * What the row's owner is doing: `live`, `dead`, `starting`, `never-started` or
 * `malformed`.
 *
 * `malformed` covers three shapes this build cannot produce and will not guess
 * at: a `running` row with no pid (state and pid are written in one statement
 * here, so it is legacy or corrupt), a timestamp that will not parse, and — since
 * OAI-162 — a pid that IS recorded and cannot be read as one. All are surfaced
 * rather than reconciled: failing closed costs a stuck queue the user is told
 * about, where guessing costs someone's live run.
 *
 * **The third shape is PERMANENT where the timestamp one is transient, and no
 * caller may treat them alike.** `registerWaiter` carries `AND waiter_pid IS
 * NULL`, so a queued row whose timestamps will not parse can still have a late
 * worker attach to it and become `live`, while a queued row holding an unreadable
 * `waiter_pid` can take no NEW registration and is never collected either.
 * `/oai:abandon --force` is what writes it off. **That is not the same as the only
 * thing that can END it**, and no message may say so: `finish` is keyed on `seq`
 * and state, never on the pid, so a worker that registered before the column was
 * corrupted can still time out or cancel its own row. It cannot PUBLISH one —
 * `claimJob`'s `AND waiter_pid = ?` can never match the corrupted value, so no
 * path in this build takes such a queued row to `running`. What is proved is that
 * no AUTOMATIC path collects it. Where a message DOES distinguish the two queued shapes — the
 * status note and `/oai:abandon`'s refusal, not the stored failure record, which
 * says one thing for every malformed row — it branches on whether a pid was
 * RECORDED, a `pid !== null` test and never truthiness, because a recorded `0` is
 * a pid that cannot be read rather than an absent one.
 *
 * **What they block is not the same, and saying "both block the queue" was
 * wrong.** Neither blocks a caller that never reaches the scans: `job-queue.mjs`
 * `decide` returns `cancelled` first. Of the callers that do reach them, the
 * RUNNING shape blocks every one — the running loop rejects any row that is not
 * provably dead, before queue order is consulted. The QUEUED shape blocks only
 * the callers behind it, and only while it is the first row `scanQueued` does
 * not skip: with an ordinary head at seq 1, this shape at seq 2 and a caller at
 * seq 3, the scan stops at seq 1 and never looks at seq 2 at all.
 */
export function livenessOf(row, nowMs) {
  const pid = relevantPid(row);
  if (pidWasRecorded(pid)) {
    const verdict = pidLiveness(pid);
    if (verdict === 'live') return 'live';
    if (verdict === 'gone') return 'dead';
    return 'malformed';
  }
  if (row.state === 'running') return 'malformed';

  // Queued, and no worker has ever registered. `spawned_at` when the child was
  // seen to exist, `created_at` when the submitter died before spawning at all.
  const since = Date.parse(row.spawned_at ?? row.created_at);
  if (!Number.isFinite(since)) return 'malformed';
  return nowMs - since < STARTUP_GRACE_MS ? 'starting' : 'never-started';
}
