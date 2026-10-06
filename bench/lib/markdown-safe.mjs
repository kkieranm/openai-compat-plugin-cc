// Every untrusted value the sweep report interpolates into Markdown passes through here first. The
// report is model-authored finding prose, server-reported ids, git subjects, operator paths and
// foreign-build ledger values rendered into a Markdown file — a backtick opens a code span or fence, a
// blank line breaks a list, and none of it is this tool's to trust. `safeInline`, `displayReason` and
// `safeBlockquoteLines` neutralise Markdown metacharacters uniformly (dot-replacement). Inside a code
// span only a backtick can end the markup, and a `|` still ends a table cell, so `safeCodeSpan`
// replaces those two alone and a value such as `qwen3_coder` prints as itself.
// The structural tests in `tests/structure.test.js` enforce that EVERY interpolation of untrusted data
// in the sweep render files is a call to one of those four helpers (or a formatting exception that
// test lists), that every value interpolated inside a code span in `bench/` is a `safeCodeSpan` call,
// and that `safeCodeSpan` is called nowhere else — so a new sink cannot be added unwrapped.
//
// NO OPTIONS, deliberately. Each helper takes exactly one argument. A caller's fallback is a Markdown
// literal appended as `safeInline(x) || '(none)'` (checked by the grammar as a whole string literal),
// never an option value — because an option value is a place unsanitised data can ride into the output,
// and a grammar that has to prove an options object safe is a grammar that keeps finding holes.

const MD_METACHARS = /[`*_[\]()<>#|~\\]/g;
const CODE_SPAN_METACHARS = /[`|]/g;
const INLINE_CAP = 1000; // roomy backstop against a runaway reply; an id or path is short, a summary fits
const BLOCKQUOTE_CAP = 2000;
const REASON_CAP = 120; // reason codes; the historical displayReason cap, preserved
const EVIDENCE_CONTINUATION = '\n    > ';

// A string keeps its own text; anything else is JSON, never `String()`, which would turn an object into
// `[object Object]`. The stringify is wrapped because it throws on a circular structure, a BigInt or a
// hostile own `toJSON`, and returns `undefined` for a symbol or function — a throw here would lose the
// whole report over one bad value.
function coerce(value) {
  if (typeof value === 'string') return value;
  let shown;
  try {
    shown = JSON.stringify(value);
  } catch {
    shown = undefined;
  }
  return typeof shown === 'string' ? shown : `(unrenderable ${typeof value})`;
}

function truncate(shown, cap) {
  return shown.length > cap ? `${shown.slice(0, cap)}…` : shown;
}

// One scalar, made safe for a single Markdown line. NEVER recurses: an array element that is itself an
// array or object is coerced (JSON.stringify in coerce's try/catch), not fed back through the array
// branch, so a circular reference cannot loop.
function escapeScalar(value, cap, metachars) {
  return truncate(coerce(value).replace(metachars, '.').replace(/\s+/g, ' '), cap);
}

function inline(value, cap, metachars = MD_METACHARS) {
  if (value === undefined || value === null) return ''; // '' so a caller's trailing `|| 'fallback'` fires
  // The WHOLE branch is guarded, `Array.isArray` included: it throws on a REVOKED proxy, which would
  // otherwise escape before the loop's own guard and lose the report.
  try {
    if (Array.isArray(value)) {
      // Built incrementally and stopped at the cap in BOTH dimensions — rendered length AND element
      // count — so an adversarial array whose elements render empty cannot make an unbounded iterator
      // run away past the length cap.
      let out = '';
      let seen = 0;
      for (const item of value) {
        if (out.length >= cap || seen >= cap) {
          out += '…';
          break;
        }
        seen += 1;
        out += (out ? ', ' : '') + escapeScalar(item, cap, metachars);
      }
      return truncate(out, cap);
    }
    return escapeScalar(value, cap, metachars);
  } catch {
    return '(unrenderable value)';
  }
}

/** One untrusted value, made safe for a single inline Markdown position (code span or prose). */
export function safeInline(value) {
  return inline(value, INLINE_CAP);
}

/**
 * One untrusted value, made safe for the inside of an inline code span.
 *
 * A code span renders everything but a backtick literally, and a `|` would still end the cell when the
 * span sits in a table row (a backslash escape would print literally outside one), so those two are
 * replaced, as `safeInline` replaces them, and whitespace is folded to one space so a line break cannot
 * end the span or the line. The coercion, array handling and length cap are `safeInline`'s. A prose
 * position still needs `safeInline`.
 */
export function safeCodeSpan(value) {
  return inline(value, INLINE_CAP, CODE_SPAN_METACHARS);
}

/**
 * A recorded reason code (or an unrecognised value in its place), made safe for a coverage row.
 *
 * The one comparison this codebase's reasons are NOT a closed vocabulary for: `unrecorded` carries a
 * filesystem error message, unbounded and possibly non-string. Same escaping as `safeInline`, tighter
 * cap.
 */
export function displayReason(value) {
  return inline(value, REASON_CAP);
}

/**
 * A multi-line value (finding evidence), made safe for a Markdown blockquote.
 *
 * Escapes metacharacters per character, then rewrites EVERY line ending — `\n`, `\r`, `\r\n` — to the
 * blockquote continuation, so no line can be left without the `> ` prefix and break out of the quote.
 * The continuation is hardcoded rather than a caller option: it is a fixed layout, and an option is a
 * hole.
 */
export function safeBlockquoteLines(value) {
  if (value === undefined || value === null) return '';
  const shown = truncate(coerce(value).replace(MD_METACHARS, '.'), BLOCKQUOTE_CAP);
  return shown.replace(/\r\n?|\n/g, EVIDENCE_CONTINUATION);
}
