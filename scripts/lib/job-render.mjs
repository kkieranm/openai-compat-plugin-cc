// Jobs as text. Pure string-building — nothing here reads a process, opens a
// database or writes to stdout, which is the same split `render.mjs` keeps and
// for the same reason: a renderer that also decides things cannot be tested by
// handing it a row.
import { beatIsStale, pidWasRecorded } from './job-liveness.mjs';
import { isKnownVersion } from './job-record.mjs';
import { logPathFor } from './job-store.mjs';
import { requestTextOf } from './prompt.mjs';

const EXCERPT = 64;

/**
 * How far away a timestamp is, in either direction.
 *
 * The direction is not decoration. A job's deadline is the one field here that
 * is normally in the *future*, and clamping the difference at zero rendered
 * every healthy run's cap as "0s ago" — which reads as expired, on exactly the
 * row where expiry is the question being asked.
 */
export function relativeAge(iso, nowMs = Date.now()) {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return '?';
  const delta = nowMs - at;
  const seconds = Math.round(Math.abs(delta) / 1000);
  const magnitude = () => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86_400)}d`;
  };
  return delta < 0 ? `in ${magnitude()}` : `${magnitude()} ago`;
}

/**
 * What the job was asked to do, as one line.
 *
 * From `request.messages` rather than a stored summary: that array is the
 * canonical snapshot, so this can never describe something other than what the
 * model was actually sent. A payload this build cannot read decodes to `null`,
 * hence the guards.
 */
export function excerptOf(row) {
  const messages = row.request?.messages;
  if (!Array.isArray(messages)) return '(unreadable request)';
  const last = [...messages].reverse().find((message) => message?.role === 'user');
  // Past the attachments, which `buildMessages` puts *first*: without this the
  // line describing what a job was asked to do read `--- FILE: … ---` for every
  // job that attached one.
  const text = requestTextOf(last?.content).split('\n')[0];
  if (!text) return '(no prompt text)';
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text;
}

/**
 * What a row this build cannot interpret is told.
 *
 * Split by STATE first, because a queued row is not running and — unlike the
 * running shape — holds the line only when it is the first row the queue's scan
 * does not skip, which one row cannot know about itself; saying "it blocks the
 * queue" there would be a relational claim made by a function with no caller to
 * be relational about.
 *
 * Then split by whether a pid was RECORDED, because since OAI-162 the two queued
 * shapes no longer have the same future. `registerWaiter` carries `AND waiter_pid
 * IS NULL`, so a row with unparseable timestamps and no pid can still have a
 * worker attach and start running, while one already holding a value that cannot
 * be read as a pid can take no NEW registration — so the reassuring sentence is
 * false for it. It says nothing about a worker that registered BEFORE the value
 * was corrupted: that one may be alive and beating, and `claimJob`'s `AND
 * waiter_pid = ?` is what stops even it reaching `running`. `!== null`, not
 * truthiness: a recorded `0` is a pid that cannot be read, not an absent one.
 *
 * **No command is named here.** `remedyFor` is the one place this file advises an
 * action, and it is gated on two conditions a note has no access to: whether the
 * database is writable, and whether the row's schema version is one this build
 * understands. Naming `/oai:abandon --force` from here would advertise it on rows
 * the command refuses outright.
 */
function malformedNote(view) {
  const recorded = pidWasRecorded(view.pid);
  // **A row a newer plugin wrote says so, whatever else is wrong with it.** It
  // used to: such a row reached `displayOf`'s `dead`/`never-started` arm, whose
  // note names its schema. Since OAI-162 an unreadable pid resolves `malformed`
  // FIRST, which took that arm — and with it the one fact an operator could act
  // on, because `/oai:abandon` refuses an unknown version above its malformed
  // rung and no flag lifts it.
  //
  // **It names the schema and stops there.** An earlier revision went on to
  // promise that "a build that understands that row schema" could clear it —
  // but `schema_version` is an INTEGER column in a non-STRICT table, so the same
  // foreign writer that put a non-pid in `worker_pid` can put a non-number here,
  // and then no build satisfies that advice. The number is the fact; what to do
  // with it is not, and this clause must not grow one.
  const foreign = isKnownVersion(view) ? '' : ` Its row schema is`
    + ` ${JSON.stringify(view.schema_version)}, which this build does not understand, so it will`
    + ' neither collect nor write off this row.';
  if (view.state === 'queued') {
    return (recorded
      ? 'malformed: queued, and the value recorded for its waiter cannot be read as a pid.'
        + ' No NEW worker can register against it while that value stays unreadable, and ordinary'
        + ' recovery does not collect it.'
      : 'malformed: queued with a timestamp this build cannot read.'
        + ' While it stays in this shape, this build will neither start it nor collect it.') + foreign;
  }
  return (recorded
    ? 'malformed: running, and the value recorded for its worker cannot be read as a pid.'
      + ' It blocks the queue and this build will not guess at it.'
    : 'malformed: running with no worker pid recorded. It blocks the queue and this build will not guess at it.')
    + foreign;
}

/**
 * The one line a row earns beyond its summary, or `null`.
 *
 * Only states that call for an action say anything. A running job that is simply
 * running does not need explaining, and a note under every row is a note nobody
 * reads.
 */
function noteFor(view, nowMs) {
  if (view.display === 'malformed') return malformedNote(view);
  if (view.display === 'overdue') {
    return `past its own ${Math.round((view.deadline - Date.parse(view.started_at)) / 1000)}s cap, and pid ${view.pid} is still alive.`;
  }
  if (view.display === 'stalled') {
    // A stalled worker is the one case where a cancellation goes unheard, and
    // saying so here is the difference between "wait a moment" and "deal with
    // this by hand".
    const unheard = view.cancel_requested_at ? ' It will not see the cancellation asked for, either.' : '';
    return `pid ${view.pid} is alive but has not beaten since ${relativeAge(view.last_beat_at, nowMs)}.${unheard}`;
  }
  if (view.display === 'cancelling') {
    // **The second half is CONDITIONAL, and saying "reads cancelled once its
    // worker has exited" made it a promise this build cannot keep (OAI-66).** An
    // exit alone no longer decides the verdict: the worker must also leave the
    // acknowledgement beside its log, and a worker that crashed — or whose
    // acknowledgement would not write — exits and reads `failed` /
    // `cancel-unconfirmed` instead. Reading the old sentence, someone who then saw
    // `failed` would think the plugin had lost their cancellation.
    return `cancellation asked for ${relativeAge(view.cancel_requested_at, nowMs)}; it stops at its next check-in.`
      + ' It reads cancelled if the worker confirms that is why it stopped, and cancel-unconfirmed if it dies'
      + ' without saying so.';
  }
  if (view.display === 'dead' || view.display === 'never-started') {
    return `written by a newer plugin (row schema ${view.schema_version}), so this build will not touch it.`;
  }
  if (view.display === 'failed') return view.failure?.message ?? 'failed with no message recorded.';
  return null;
}

function summaryLine(view, nowMs) {
  return `${view.id}  ${view.display.padEnd(13)} ${relativeAge(view.created_at, nowMs).padEnd(8)} ${excerptOf(view)}`;
}

/**
 * Why a row belonging to somewhere else is on this screen at all.
 *
 * **The only relational statement this file makes**, and it is printed for one
 * row: the one `blockingSeqFor` identified. Not "takes its turn first" — a
 * pathological head may never take a turn at all, and holds the line until a
 * human deals with it. "Must clear" is true of both.
 */
const BLOCKING = 'must clear before this workspace\'s queued job can proceed.';

/**
 * The way out, named only where taking it would actually work.
 *
 * FOUR conditions, and three are not properties of the row: the row's owner is
 * `live` (a `starting` or `malformed` or dead blocker is refused or handed to
 * recovery, so naming the plain form would advertise a refusal); the beat is stale
 * (else `/oai:abandon` refuses without `--force`), the row's schema version is
 * one this build knows (else it refuses with `--force` too), and the database is
 * writable (else every write refuses). `/oai:status` will happily read a
 * database a newer plugin wrote — pointing at a command that cannot run there
 * would be advice the reader can only discover is wrong by taking it.
 *
 * The `live` condition subsumes an argument this docblock used to make at
 * length: that `starting` needed no condition because it cannot co-occur with a
 * stale beat (true — `registerWaiter` writes `waiter_pid` and `last_beat_at` in
 * one `UPDATE`, so a pid-less row has never beaten). That reasoning held for
 * `starting` and missed `malformed`, which CAN carry a stale parseable beat.
 * Requiring `live` covers both without depending on which write is atomic.
 */
function remedyFor(view, readOnly, nowMs) {
  // `live` subsumes the `starting` case the paragraph above used to reason about
  // separately, and closes the one it missed: a MALFORMED blocker — a running row
  // with no pid but a stale, parseable beat — passed every condition here while
  // `/oai:abandon` refuses it without `--force`. A malformed blocker is now told
  // nothing, deliberately: this line names the command only where the plain form
  // works, and advertising the destructive flag is not this display's job.
  if (view.liveness !== 'live') return null;
  if (readOnly || !isKnownVersion(view) || !beatIsStale(view, nowMs)) return null;
  return `it has stopped checking in — /oai:abandon ${view.id} writes the row off (nothing is signalled).`;
}

/** The list a bare `/oai:status` prints. */
export function renderList({ shown, elsewhere, blockingSeq = null }, { cwd, all, readOnly = false, nowMs = Date.now() }) {
  if (shown.length === 0) {
    const scope = all ? '' : ` in ${cwd}`;
    const rest = elsewhere > 0 ? ` (${elsewhere} elsewhere — pass --all to see them)` : '';
    return `No background jobs${scope}.${rest}`;
  }

  const scope = all ? 'everywhere' : cwd;
  const rest = elsewhere > 0 ? ` (${elsewhere} more elsewhere — pass --all)` : '';
  const lines = [`${shown.length} background job${shown.length === 1 ? '' : 's'}, ${scope}${rest}\n`];
  for (const view of shown) {
    lines.push(summaryLine(view, nowMs));
    // `--all` normally drops the workspace line — the header already says the
    // listing is machine-wide, so a directory under each row is noise there —
    // but the MARKED row keeps it either way: a line saying
    // this job is holding yours up, with no directory to go and look in, names a
    // cause the reader cannot act on. Written as one condition rather than a
    // second push inside the marker branch, so both paths print these two lines
    // in the same order.
    if (view.workspace !== cwd && (!all || view.seq === blockingSeq)) lines.push(`  ${view.workspace}`);
    // Before the row's own note: this answers "why am I being shown this", which
    // is the question a reader has first about a row from another directory.
    if (view.seq === blockingSeq) {
      lines.push(`  ! ${BLOCKING}`);
      const remedy = remedyFor(view, readOnly, nowMs);
      if (remedy) lines.push(`  ! ${remedy}`);
    }
    const note = noteFor(view, nowMs);
    if (note) lines.push(`  ! ${note}`);
  }
  return lines.join('\n');
}

function stamp(iso, nowMs) {
  return iso ? `${iso} (${relativeAge(iso, nowMs)})` : '—';
}

function workerField(view, nowMs) {
  if (view.pid === null) return view.state === 'queued' ? 'no worker registered yet' : '—';
  const beat = view.last_beat_at ? `, last beat ${relativeAge(view.last_beat_at, nowMs)}` : '';
  return `pid ${view.pid} (${view.liveness})${beat}`;
}

function fields(view, nowMs) {
  return [
    ['submitted', stamp(view.created_at, nowMs)],
    ['workspace', view.workspace],
    ['provider', `${view.transport?.name ?? '?'} → ${view.transport?.baseUrl ?? '?'}`],
    ['model', view.model ?? '(whatever the server chooses)'],
    ['started', stamp(view.started_at, nowMs)],
    ['deadline', view.deadline === null ? 'none' : stamp(new Date(view.deadline).toISOString(), nowMs)],
    ['finished', stamp(view.completed_at, nowMs)],
    ['worker', workerField(view, nowMs)],
    ['attachments', (view.attachments ?? []).map((file) => `${file.path} (${file.bytes} B)`).join(', ') || 'none'],
    ['log', logPathFor(view.seq)],
    ['request', excerptOf(view)],
  ];
}

/** One job in full — what `/oai:status <id>` prints. */
export function renderDetail(view, { nowMs = Date.now() } = {}) {
  const width = 12;
  const lines = [`job ${view.id}  ${view.display}`];
  for (const [label, value] of fields(view, nowMs)) lines.push(`  ${label.padEnd(width)}${value}`);
  const note = noteFor(view, nowMs);
  if (note) lines.push(`\n! ${note}`);
  if (view.unreadable?.length) {
    lines.push(`\n! this build could not parse: ${view.unreadable.join(', ')}. The lifecycle columns above are still sound.`);
  }
  return lines.join('\n');
}
