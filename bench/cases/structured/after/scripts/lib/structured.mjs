// Asking an OpenAI-compatible server for JSON, and getting it back out again.
// This is the one module that encodes structured-output dialect: see ADR 003.

// Strict schemas allow no optional properties — every key must be listed in
// `required`, so an absent value is expressed as a null type, not omission.
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'summary'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'severity', 'summary', 'evidence'],
        properties: {
          file: { type: 'string' },
          line: { type: ['integer', 'null'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          summary: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    // Listed after findings so the model writes its conclusion having already
    // committed to the evidence, and has somewhere to say "nothing found"
    // rather than inventing a finding to fill an empty array.
    summary: { type: 'string' },
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
 * Find the first balanced object in a string. String-aware, so a brace inside a
 * quoted value (`"summary": "the } case"`) does not close the object early.
 */
function balancedObject(text) {
  const start = text.indexOf('{');
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
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/** Parse JSON out of a reply that may be bare, fenced, or wrapped in prose. */
export function extractJson(text) {
  const candidates = [text.trim(), text.match(FENCE)?.[1], balancedObject(text)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape; an unparseable candidate is expected here.
    }
  }
  return null;
}

/**
 * Does a value actually satisfy the schema we asked for?
 *
 * Driven by the schema object rather than a hand-written mirror of it, so the
 * check cannot drift from the schema the request declared.
 */
export function matchesSchema(value, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) return types.includes('null');

  if (types.includes('object')) {
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    const properties = schema.properties ?? {};
    if ((schema.required ?? []).some((key) => !(key in value))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in properties))) return false;
    return Object.entries(properties).every(([key, child]) => !(key in value) || matchesSchema(value[key], child));
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
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
  };
}
