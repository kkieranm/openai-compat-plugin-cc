/**
 * A liveness signal for a run that would otherwise sit silent for minutes.
 *
 * **Timer-driven, not delta-driven**, and that is the whole design. A heartbeat
 * fired by arriving tokens is silent during exactly the window that makes people
 * ask whether it has hung: prefill, where nothing arrives by definition and a
 * measured 52k-token prompt took 393.7s to its first token. It would also be
 * silent for the entire run against a server that ignores `stream: true`. A
 * `setInterval` reports whatever is true at the time, so both are covered.
 *
 * Everything goes to stderr. stdout is the answer, and `--json` must stay
 * exactly one JSON object — the benchmark parses it wholesale.
 */

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * Run something with a heartbeat, stopping it however that something ends.
 *
 * Shared so the two commands cannot drift on the `finally`: an interval left
 * running keeps printing over whatever comes next, and a failure is exactly when
 * a stray progress line is most confusing.
 */
export async function withProgress(run) {
  const progress = startProgress();
  try {
    return await run((answer) => progress.update(answer));
  } finally {
    progress.stop();
  }
}

/**
 * Generation rate, measured from the **first token** rather than the request.
 *
 * Measuring from the request folds prefill into the divisor, and prefill dwarfs
 * generation on a large prompt: a live run with a 42,043-token prompt reported
 * "~4.6 tok/s" for a model actually producing ~14.5, because 295 of its 444
 * seconds were spent before a single token existed. A figure labelled tok/s that
 * is not tok/s is the defect class this whole feature exists to remove.
 */
function rate(deltas, generatingMs) {
  if (!generatingMs || generatingMs <= 0 || deltas === 0) return null;
  return (deltas / (generatingMs / 1000)).toFixed(1);
}

function line(state, elapsedMs, now) {
  const seconds = Math.round(elapsedMs / 1000);
  if (state.chars === 0) return `  ${state.phase.padEnd(9)}  ${seconds}s\n`;
  const speed = rate(state.deltas, state.firstTokenAt ? now - state.firstTokenAt : 0);
  const size = `${state.chars.toLocaleString('en-US')} chars`;
  return `  ${state.phase.padEnd(9)}  ${size.padStart(14)}  ${String(seconds).padStart(4)}s${speed ? `  ~${speed} tok/s` : ''}\n`;
}

/**
 * Starts ticking immediately and stays quiet until the first interval elapses,
 * so a fast run — and every test, whose fake server answers instantly — prints
 * nothing at all.
 *
 * `stop()` must be called on every path, including failure. `unref()` keeps the
 * timer from holding the process open, but an un-stopped interval would keep
 * printing across a degrade retry and into whatever ran next.
 */
export function startProgress({
  intervalMs = DEFAULT_INTERVAL_MS,
  write = (text) => process.stderr.write(text),
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const state = { phase: 'prefill', chars: 0, deltas: 0, firstTokenAt: null };

  const timer = setInterval(() => write(line(state, now() - startedAt, now())), intervalMs);
  timer.unref?.();

  return {
    /** Fed the accumulator, so the label names the channel actually in use. */
    update(answer) {
      const chars = answer.content.length + answer.reasoning.length;
      if (chars === 0) return;
      // Stamped once: the boundary between prefill and generation is the only
      // point from which a rate means anything.
      state.firstTokenAt ??= now();
      // Naming the channel is not decoration: under a schema the whole reply
      // arrives in `reasoning`, and "reasoning, 11,860 chars" is what tells a
      // reader the model is working rather than repeating itself.
      state.phase = answer.content.length > 0 ? 'answering' : 'reasoning';
      state.chars = chars;
      state.deltas = answer.deltas;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
