// Pulling a checkable artifact out of a reply, and checking it.
//
// Only the `patch` template has one. Every other template is judged by whether a
// reader found it useful, which is a human verdict the benchmark approximates
// with declared markers; a diff is judged by whether it applies, which `git`
// settles without reading a word. That asymmetry is the reason this module
// exists and the reason it is small: it is not a general "artifact system", it
// is the one case where a machine can check the answer.
import { execFileSync } from 'node:child_process';

/** A model that cannot make the change is told to say so; this is that word. */
export const IMPOSSIBLE = 'IMPOSSIBLE';

/**
 * The diff inside a reply, or null.
 *
 * Tolerant of the two things a small model does anyway despite being told not
 * to: a code fence around the diff, and a sentence before it. Tolerated rather
 * than refused because the artifact is checked immediately afterwards — if the
 * extraction is wrong, `git apply --check` says so, which is a better guard than
 * a stricter parser would be.
 *
 * Deliberately NOT a general parse of the reply. The reply stays canonical and
 * is always shown; this only decides what to hand `git`.
 */
export function extractDiff(content) {
  const text = String(content ?? '');
  if (new RegExp(`^\\s*${IMPOSSIBLE}\\b`).test(text)) return null;

  const fenced = text.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/^(diff --git |--- )/m);
  if (start === -1) return null;
  const diff = body.slice(start).trimEnd();
  // A diff with no hunk header is not a diff, whatever it looks like.
  return /^@@ /m.test(diff) ? `${diff}\n` : null;
}

/**
 * Does it apply? — the whole point of this module.
 *
 * `--check` only, never an apply: a benchmark and a `/oai:task` run must both be
 * able to ask this question without touching the working tree. Reported as three
 * states rather than a boolean, because "there was no diff to check" is not the
 * same as "the diff did not apply", and collapsing them would let a template
 * that produced prose read as a template that produced a broken patch.
 */
export function checkDiff(diff, { cwd }) {
  if (!diff) return { state: 'absent', detail: 'the reply contained no unified diff' };
  try {
    execFileSync('git', ['apply', '--check', '-'], { cwd, input: diff, stdio: ['pipe', 'ignore', 'pipe'] });
    return { state: 'applies', detail: null };
  } catch (error) {
    // A tool that could not RUN is not a patch that does not apply. Reporting a
    // missing `git` or a non-repository cwd as `rejected` would be a verdict
    // about the diff that nothing actually reached.
    if (error.code === 'ENOENT' || error.code === 'EACCES') {
      return { state: 'unavailable', detail: `could not run git: ${error.code}` };
    }
    const stderr = String(error.stderr ?? '').trim();
    if (/not a git repository/i.test(stderr)) {
      return { state: 'unavailable', detail: 'not inside a git repository, so nothing could be checked' };
    }
    return { state: 'rejected', detail: stderr.split('\n')[0] || 'git apply --check refused it' };
  }
}

/**
 * What a reader must be told about a patch, and it is not "this is correct".
 *
 * `applies` is the strongest claim available here and it is a weak one: a diff
 * that applies cleanly can still do the wrong thing. Saying so beside the good
 * news is the difference between a check and a false assurance — this repo's
 * instance 14 is a guard that turned a loud failure into a valid-looking result.
 */
export function artifactNote({ state, detail }) {
  if (state === 'applies') return 'PATCH: applies cleanly to the working tree. That it applies is not evidence it is right.';
  if (state === 'rejected') return `PATCH: does NOT apply — ${detail}. The reply is shown in full below; nothing was changed.`;
  if (state === 'unavailable') return `PATCH: NOT CHECKED — ${detail}. This is not a verdict about the patch.`;
  return `PATCH: no diff found — ${detail}. Nothing was checked and nothing was changed.`;
}

