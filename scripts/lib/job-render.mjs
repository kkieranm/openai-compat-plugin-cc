// Jobs as text. Pure string-building — nothing here reads a process, opens a
// database or writes to stdout, which is the same split `render.mjs` keeps and
// for the same reason: a renderer that also decides things cannot be tested by
// handing it a row.
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
 * The one line a row earns beyond its summary, or `null`.
 *
 * Only states that call for an action say anything. A running job that is simply
 * running does not need explaining, and a note under every row is a note nobody
 * reads.
 */
function noteFor(view, nowMs) {
  if (view.display === 'malformed') {
    // Split by state, because `displayOf` reaches `malformed` from two shapes and
    // the old single sentence described one of them. A malformed QUEUED row is
    // not running, and — unlike the running shape — it holds the line only when
    // it is the first row the queue's scan does not skip, which one row cannot
    // know about itself. Saying "it blocks the queue" here would be a relational
    // claim made by a function that has no caller to be relational about.
    if (view.state === 'queued') {
      return 'malformed: queued with a timestamp this build cannot read.'
        + ' While it stays in this shape, this build will neither start it nor collect it.';
    }
    return 'malformed: running with no worker pid recorded. It blocks the queue and this build will not guess at it.';
  }
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

/** The list a bare `/oai:status` prints. */
export function renderList({ shown, elsewhere, blockingSeq = null }, { cwd, all, nowMs = Date.now() }) {
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
    if (view.seq === blockingSeq) lines.push(`  ! ${BLOCKING}`);
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
