// Asking an OpenAI-compatible server for JSON, and getting it back out again.
// This is the one module that encodes structured-output dialect: see ADR 003.

/**
 * The most findings one reply may carry.
 *
 * Exported because `renderFindings` has to say so when a list arrives at exactly
 * this length: unlike the string caps, which only ever trim reasoning, this one
 * can drop a defect the model actually found. Shared rather than copied so the
 * schema and the warning cannot disagree about where the edge is.
 */
export const MAX_FINDINGS = 20;

// Strict schemas allow no optional properties — every key must be listed in
// `required`, so an absent value is expressed as a null type, not omission.
//
// Every string and array also carries a ceiling. A grammar enforces these, so
// they are a hard backstop against the failure that wastes a whole pass: one
// measured run generated all 16,384 tokens it was allowed and returned nothing
// parseable at all. They are sized above every successful run observed, so a
// healthy pass never reaches them — see ADR 004.
//
// Ceilings belong on output, floors on thinking, and the two are not
// interchangeable: `maxItems` on a *reasoning* array with no `minItems` hands
// the model a zero-cost exit, and it takes it (measured: `analysis: []` in six
// tokens). That is why `analysis` is a bounded string and not a bounded list.
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['analysis', 'findings', 'summary'],
  properties: {
    // First, and load-bearing. A grammar constrains generation from the very
    // first token, so a schema that opens with `findings` forces the model to
    // commit to defects before it has read anything — measured on one 135-line
    // file, that produced 112 output tokens and one vague non-defect. The same
    // model, same prompt, with this field ahead of the findings, produced a
    // path-by-path analysis and found a real credential-stripping bug. Reasoning
    // space is not decoration here; removing it is what made the reviewer
    // useless (ADR 003).
    // ~7.8k tokens at the measured output density of 3.61 chars/token. 24,000
    // was the first guess and it bound on a real run — cut mid-sentence while
    // describing a defect, after which the model reported none at all. The cap
    // must sit above the verbose-but-productive range, not inside it; what is
    // left below is only the pathological one. See ADR 004 for what this does
    // and does not buy.
    analysis: { type: 'string', maxLength: 28_000 },
    findings: {
      type: 'array',
      maxItems: MAX_FINDINGS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'severity', 'summary', 'evidence'],
        properties: {
          file: { type: 'string', maxLength: 200 },
          line: { type: ['integer', 'null'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          summary: { type: 'string', maxLength: 300 },
          // Much roomier than the summary: this is meant to be a quoted line of
          // source, and one truncated mid-token is not checkable against the
          // code. 400 was the first guess and it cut a real finding on the first
          // diff tried — the model writes prose here rather than a bare line,
          // which ADR 003 already records as a known limit of requiring a field
          // versus making it useful. Sized to clear that, not to permit it.
          evidence: { type: 'string', maxLength: 600 },
        },
      },
    },
    // Listed after findings so the model writes its conclusion having already
    // committed to the evidence, and has somewhere to say "nothing found"
    // rather than inventing a finding to fill an empty array.
    summary: { type: 'string', maxLength: 1500 },
  },
};

const SEVERITIES = new Set(['high', 'medium', 'low']);

export function responseFormatFor(schema, name = 'review') {
  return { type: 'json_schema', json_schema: { name, strict: true, schema } };
}

/**
 * Did the server reject the *request shape* rather than the request?
 *
 * Tested on the response, never the provider name — the ADR 002 rule. LM Studio
 * answers `'response_format.type' must be 'json_schema' or 'text'`; other
 * servers word it differently but all name the field they refused.
 */
export function isFormatRejection(error) {
  if (error?.status !== 400 && error?.status !== 422) return false;
  return /response_format|json_schema|response format/i.test(error.message ?? '');
}

/** The fallback instruction, rendered from the schema so it cannot drift from it. */
export function schemaInstruction(schema) {
  return (
    'Reply with JSON only — no prose, no markdown fence — matching this JSON Schema exactly:\n' +
    `${JSON.stringify(schema)}`
  );
}

const FENCE = /```(?:json)?\s*\n([\s\S]*?)```/;

/**
 * Find the balanced object starting at or after `from`. String-aware, so a brace
 * inside a quoted value (`"summary": "the } case"`) does not close it early.
 */
function balancedObject(text, from = 0) {
  const start = text.indexOf('{', from);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return { json: text.slice(start, index + 1), start };
    }
  }
  return null;
}

/**
 * Parse JSON out of a reply that may be bare, fenced, or wrapped in prose.
 *
 * Every balanced object is tried, not just the first. The system prompt orders
 * the model to quote the offending source line, so a degraded reply routinely
 * opens with code — and anchoring on the first `{` meant a quoted `if (x) { … }`
 * swallowed the anchor and a perfectly good findings object was thrown away,
 * with the user told the *model* returned the wrong shape. That is this repo's
 * most-repeated defect class, reported against ourselves.
 */
export function extractJson(text) {
  for (const candidate of [text.trim(), text.match(FENCE)?.[1]]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape; an unparseable candidate is expected here.
    }
  }

  let from = 0;
  for (;;) {
    const found = balancedObject(text, from);
    if (!found) return null;
    try {
      return JSON.parse(found.json);
    } catch {
      // Not it — resume the scan past this object's opening brace, so a nested
      // or adjacent object later in the reply still gets its turn.
      from = found.start + 1;
    }
  }
}

/**
 * Does a value actually satisfy the schema we asked for?
 *
 * Driven by the schema object rather than a hand-written mirror of it, so the
 * check cannot drift from the schema the request declared.
 *
 * `maxLength` and `maxItems` are deliberately **not** checked here, and that is
 * a decision rather than an omission. This function exists to prove a reply is
 * the grammar-constrained payload and not a scratchpad draft, and identity is
 * settled by `type`, `required`, `additionalProperties` and `enum`. The size
 * caps are instructions to the generator, not claims about the payload — so a
 * server that accepted the schema and ignored a cap would have its perfectly
 * good findings thrown away for being wordy. Pinned by a test.
 */
export function matchesSchema(value, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) return types.includes('null');

  if (types.includes('object')) {
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    const properties = schema.properties ?? {};
    // `in` walks the prototype chain, so a draft object carrying a key named
    // `constructor`, `toString` or `__proto__` passed the extras check as
    // conformant — and conformance is the whole proof that this text is the
    // grammar-constrained payload rather than a scratchpad draft.
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) {
      return false;
    }
    return Object.entries(properties).every(
      ([key, child]) => !Object.hasOwn(value, key) || matchesSchema(value[key], child),
    );
  }
  if (types.includes('array')) {
    return Array.isArray(value) && value.every((item) => matchesSchema(item, schema.items));
  }
  if (types.includes('string')) {
    return typeof value === 'string' && (!schema.enum || schema.enum.includes(value));
  }
  if (types.includes('integer')) return Number.isInteger(value);
  return true;
}

function normalizeFinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const file = typeof raw.file === 'string' ? raw.file.trim() : '';
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  // A finding that names neither a place nor a problem cannot be verified, and
  // an unverifiable finding is worse than no finding.
  if (!file || !summary) return null;

  const severity = String(raw.severity ?? '').toLowerCase();
  const line = Number(raw.line);
  return {
    file,
    line: Number.isInteger(line) && line > 0 ? line : null,
    severity: SEVERITIES.has(severity) ? severity : 'medium',
    summary,
    evidence: typeof raw.evidence === 'string' ? raw.evidence.trim() : '',
  };
}

/**
 * The findings in a reply, or null if it does not carry any.
 *
 * The reasoning channel is read **only** under a schema: there, generation is
 * grammar-constrained from the first token, so any channel carrying output
 * carries the constrained payload — and parsing it against the schema is what
 * proves that. Without a schema the same text is the model's scratchpad, and
 * presenting scratchpad as an answer is the defect class this repo keeps
 * re-finding (ADR 003).
 */
export function parseFindings({ content, reasoning }, { structured = false, schema = REVIEW_SCHEMA } = {}) {
  const text = structured && !content.trim() ? reasoning : content;
  if (!text?.trim()) return null;

  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.findings)) return null;

  // Under a schema, conformance is the whole proof. A server that accepts
  // `response_format` without enforcing it would otherwise let a scratchpad
  // draft — the first `{...}` in the reasoning text — be shipped as findings,
  // which is exactly what reading that channel is supposed to rule out.
  // Without a schema nothing was promised, so repair what is repairable.
  if (structured && !matchesSchema(parsed, schema)) return null;

  const normalized = parsed.findings.map(normalizeFinding);
  return {
    findings: normalized.filter(Boolean),
    dropped: normalized.filter((finding) => !finding).length,
    // Measured against what the model emitted, not what survived normalizing:
    // the grammar capped the raw list, so that is where the cut happened.
    //
    // Only under a schema. On the degraded path no grammar was applied, so a
    // reply with this many findings was not cut at all, and warning that it
    // might have been would describe a truncation that cannot have happened.
    // Exactly the cap, not merely at-or-above it. A grammar-enforcing server can
    // never exceed it, so the two are identical there; where they differ — a
    // server that took the schema and ignored `maxItems`, the same case that
    // keeps `matchesSchema` out of the size business — a longer list proves
    // nothing was cut, and warning about a cut that did not happen is the defect
    // this warning exists to prevent, inverted.
    atCap: structured && parsed.findings.length === MAX_FINDINGS,
    // The same test for the reasoning field, and it matters more. A cut
    // `analysis` used to be impossible: the run hit `max_tokens` and raised a
    // loud "ran out of tokens". Bounding it made that reply *valid* — complete
    // JSON, `finish_reason: stop`, and usually an empty findings list — so the
    // user is shown "No defects reported" and a normal footer for a review that
    // was guillotined mid-sentence. Indistinguishable from a genuinely clean
    // pass, which turns a loud failure into a confident wrong answer. ADR 004
    // recorded this behaviour and mistook it for an acceptable trade.
    analysisCut: structured && typeof parsed.analysis === 'string'
      && parsed.analysis.length === schema.properties?.analysis?.maxLength,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
  };
}
