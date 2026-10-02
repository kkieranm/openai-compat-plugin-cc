// A whole-document reply whose entire payload is an inline empty `findings: []`
// declaration plus prose — the YAML spelling of the empty-findings mapping that
// `json-scan.mjs` `extractJson` already accepts when it is written as JSON
// (`{"findings": []}`). A model that reviews a diff and finds nothing sometimes
// answers this way instead of in JSON, and with no bracketed candidate anywhere
// (the only `[]` is inside `findings: []`, which reads as embedded scalar text)
// neither `extractJson` nor `findings-yaml.mjs` `findingsInYaml` — whose grammar
// is a block LIST of `- ` items, not an inline empty one — can see it.
//
// Read as a clean review (`{ findings: [] }`), never a real finding: this file
// only ever returns an empty list, so it cannot invent a finding the model did
// not write. Whole-document only, and last-resort by construction — see
// `structured.mjs` `findingsIn`, which consults it only once both other readers
// have declined.
//
// Same never-throw contract as `extractJson` and `findingsInYaml`: a pathological
// reply yields `null`, never an exception out of the caller's parse.

// An inline empty findings declaration, and nothing else, on the line.
const EMPTY_DECLARATION = /^findings:\s*\[\s*\]\s*$/;
// A second `findings:` KEY declaration below the opener — a bracket-free real-findings
// decoy (a decoy carrying brackets is caught by the bracket guard in the function
// instead). Caught by SPELLING: a plain `findings:` or a paired-quote `"findings":` /
// `'findings':` key (the backreference forbids a mismatched pair), at any indentation
// and tolerating `findings :` spacing. Case-sensitive on purpose: `Findings:` /
// `FINDINGS:` is a distinct key no reader here treats as findings, and a common prose
// heading a case-insensitive scan would wrongly reject.
//
// What stays accepted-clean residue is a bracket-free real finding this key-scan cannot
// reach without over-rejecting: a CASE variant of the key; a form set apart by POSITION
// or WRAPPER — a Markdown blockquote (`> findings:`) or a compact sequence item
// (`- findings:`); and a real findings list expressed as a bracket-free `- ` block under
// some OTHER key. Each is uncatchable without an NLP-grade parser, and each is model
// output rather than adversarial input.
const FINDINGS_KEY = /^\s*(?:findings|(["'])findings\1)\s*:/;

/**
 * `{ findings: [] }` when `text` is a whole-document reply that opens with an inline
 * empty `findings: []` and carries NO recoverable finding below it; `null` otherwise.
 *
 * Three conditions must all hold to read clean, each closing a way the reply could be
 * hiding a real finding: (1) the first line — after the whole document is trimmed — is
 * exactly the inline empty declaration; (2) no later line is a second `findings:` KEY
 * (a bracket-free decoy); (3) no `[`/`{` appears past the opener — any bracket there is
 * material `extractJson` was meant to read and, since control only reaches this acceptor
 * once `extractJson` returned null, could NOT read (blinded, malformed, truncated, or a
 * rejected shape), so its content is unknown and the reply is left loudly unreadable
 * rather than silently clean. The trim in (1) means an indented opener is still read;
 * this is deliberately NOT a column-0 check. What remains disclosed residue is a
 * bracket-free real finding written as pure prose — see the key-scan note above.
 */
export function emptyFindingsDocument(text) {
  try {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const lines = trimmed.split('\n');
    // Checked first, and cheap: a reply that does not open with an inline empty
    // findings declaration is declined here, before the scans below.
    if (!EMPTY_DECLARATION.test(lines[0])) return null;
    if (lines.some((line, i) => i > 0 && FINDINGS_KEY.test(line))) return null;
    // A bracket anywhere past the opener is a candidate `extractJson` is meant to
    // read. If control reached here, `extractJson` already returned null for this
    // reply, so any `[`/`{` below is bracketed material it could NOT read —
    // blinded by an unbalanced quote, malformed, truncated, or a shape its acceptor
    // rejected — whose content is unknown. A reply that declared `findings: []` yet
    // carries such material is contradictory: left loudly unreadable, never read as
    // a silent clean review. This confines the acceptor to the bracket-free prose it
    // was built for, at a disclosed cost — a genuinely clean review that merely
    // quotes a bracket in prose also goes loud (the fail-closed direction).
    if (/[[{]/.test(lines.slice(1).join('\n'))) return null;

    return { findings: [] };
  } catch {
    return null;
  }
}
