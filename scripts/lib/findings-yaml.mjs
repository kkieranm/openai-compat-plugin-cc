// Reading a whole reply as a YAML-ish findings list, when it never contained a
// balanced bracket for `json-scan.mjs` to find at all.
//
// Deliberately not a YAML parser: it accepts a reply only when the ENTIRE
// trimmed text is a top-level `findings:` key followed by a `- `-prefixed list
// of flat-mapping items, plus an optional trailing `summary:` scalar — and
// rejects everything else outright, never partially. That whole-document-only
// posture is what avoids the decoy-vs-real-payload ranking problem
// `json-scan.mjs`'s own comments document as hard-won for the bracketed case:
// there is no ranking to do when only one shape can ever match.
//
// Never throws — same contract as `extractJson`. That is load-bearing, not
// incidental: `tests/structure.test.js`'s `RESPONSE_BOUNDARY_FILES` list is
// enumerated over files that construct a `UserError` from server content, and
// this module, like `json-scan.mjs`, is correctly absent from it because it
// never does.

const MAX_ITEMS = 200;
const MAX_FIELDS_PER_ITEM = 20;

const KEY = '[A-Za-z_][A-Za-z0-9_]*';
const ITEM_START = new RegExp(`^(\\s*)-\\s+(${KEY}):\\s*(.*)$`);
const FIELD = new RegExp(`^(${KEY}):\\s*(.*)$`);

// Review-ladder finding (pass 1, codex-adversarial + codex-plain, converging
// independently, plus '#' at the terminal verdict point, codex-adversarial
// again): a value beginning with any of these is a YAML construct this narrow
// acceptor does not implement — a flow collection, a quoted scalar (whose
// escapes it cannot decode), an anchor, an alias, a tag, a block scalar, or a
// comment — and reading it as a bare, literal scalar would silently
// misattribute a finding (e.g. a quoted filename kept with its quote
// characters intact, or "# comment" kept as if it were the actual summary)
// rather than cleanly rejecting the document. Disqualifying, not merely
// un-parsed. Leading only, same posture as the leading-bracket rule: a `#`
// appearing later in ordinary scalar text is not a comment marker in this
// acceptor's grammar (there is no evidence a model-written reply puts one
// there), so it is not disqualifying — matching how an embedded `{` is
// accepted while a leading one is not.
const DISQUALIFYING_LEADING_CHARS = new Set(['[', '{', '"', "'", '&', '*', '!', '|', '>', '#']);

function isDisqualifyingScalar(value) {
  const trimmed = value.trim();
  return trimmed.length > 0 && DISQUALIFYING_LEADING_CHARS.has(trimmed[0]);
}

function addField(item, key, rawValue) {
  // Review-ladder finding (pass 1, codex-adversarial + codex-plain, converging
  // independently): a repeated key used to overwrite the earlier value silently
  // AND bypass MAX_FIELDS_PER_ITEM (which counted distinct keys, not field
  // lines) — a document with an ambiguous, repeated mapping is disqualifying
  // content, not a last-write-wins update.
  // Review-ladder finding (pass 1, agent-closer): `__proto__` is a key this
  // plain-object container cannot store faithfully — assigning a string to it
  // is a silent no-op, never an own property — so it must be disqualifying
  // content, same as any other key/value this acceptor cannot read faithfully.
  // Left as an explicit check rather than `Object.create(null)`: the tests
  // compare parsed output with `assert.deepEqual`, which checks prototypes.
  if (key === '__proto__') return false;
  if (Object.hasOwn(item, key)) return false;
  if (isDisqualifyingScalar(rawValue)) return false;
  if (Object.keys(item).length >= MAX_FIELDS_PER_ITEM) return false;
  item[key] = rawValue.trim();
  return true;
}

/**
 * Read the ENTIRE trimmed `text` as a whole-document `findings:` list.
 * Returns `{ findings: [...], summary?: string }` on a match, `null` on
 * anything else — never throws.
 */
export function findingsInYaml(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = trimmed.split('\n');
  if (lines[0].trim() !== 'findings:') return null;

  const findings = [];
  let item = null;
  let listIndent = null;
  let fieldIndent = null;
  let summary;
  let index = 1;

  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    // Only blank lines may follow the trailing top-level `summary:` scalar —
    // it closes the document, per the grammar.
    if (summary !== undefined) return null;

    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch[1];

    // A new list item, but ONLY at the list's own established indent — a `- `
    // line at any other indent is not a sibling item, it is a nested list
    // (deeper than the current item's own indent) or malformed content, and
    // both are a flat reject, handled by falling through below.
    const start = listIndent === null || indent === listIndent ? ITEM_START.exec(line) : null;
    if (start) {
      const [, , key, rawValue] = start;
      if (item) {
        if (findings.length >= MAX_ITEMS) return null;
        findings.push(item);
      }
      item = {};
      listIndent = indent;
      fieldIndent = null;
      if (!addField(item, key, rawValue)) return null;
      continue;
    }

    // A continuation must textually EXTEND the item's own indent, not merely be
    // longer — review-ladder finding (pass 1, codex-plain): comparing by length
    // alone let a tab-indented or otherwise unrelated-prefix line pass as a
    // continuation of a space-indented item, which is not a consistent single
    // indentation scheme at all.
    if (item && indent.length > listIndent.length && indent.startsWith(listIndent)) {
      if (fieldIndent === null) fieldIndent = indent;
      if (indent !== fieldIndent) return null;
      const field = FIELD.exec(line.slice(indent.length));
      if (!field) return null;
      const [, key, rawValue] = field;
      if (!addField(item, key, rawValue)) return null;
      continue;
    }

    // Not a continuation of the current item — either the trailing top-level
    // `summary:` scalar, or disqualifying content. Whichever it is, the item
    // list is closed here.
    if (item) {
      if (findings.length >= MAX_ITEMS) return null;
      findings.push(item);
      item = null;
    }

    const trailing = /^summary:\s*(.*)$/.exec(line);
    if (trailing && summary === undefined) {
      // Same disqualifying-scalar rule as any other value — a top-level summary
      // this acceptor cannot read faithfully is disqualifying content, not a
      // shorthand. Review-ladder finding (pass 1, fork-opener + acceptance-audit):
      // this branch used to take the raw remainder with no gate at all.
      if (isDisqualifyingScalar(trailing[1])) return null;
      summary = trailing[1].trim();
      continue;
    }

    // Anything else, anywhere, disqualifies the whole document.
    return null;
  }

  if (item) {
    if (findings.length >= MAX_ITEMS) return null;
    findings.push(item);
  }
  if (findings.length === 0) return null;

  return summary === undefined ? { findings } : { findings, summary };
}
