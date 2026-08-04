// Asking an OpenAI-compatible server for JSON, and getting it back out again.
// This is the one module that encodes structured-output dialect: see ADR 003.

import { MAX_FINDINGS } from './review-schema.mjs';

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

/**
 * The same schema with `findings` ahead of `analysis`, for the path with no
 * grammar behind it.
 *
 * The ordering in `reviewSchemaFor` is deliberate and measured, and it is
 * measured *under a grammar*: generation is constrained from the first token
 * there, so the model has no scratchpad and `analysis` has to be one — opening
 * with `findings` made it commit to defects before reading anything, and the
 * reviewer got worse (ADR 003).
 *
 * None of that holds without a grammar. The model reasons in its own channel
 * first — `reasoning_content`, measured at 38,956 characters on a 100-line file
 * — so asking it to reason again in `analysis` is asking twice, and the second
 * ask has nothing bounding it. Measured 2026-08-04: it spends the entire token
 * budget on `analysis` and never reaches the findings at all. So on this path
 * the answer goes first, and a reply that runs out of room still carries it.
 *
 * Derived from the schema rather than written out, for the same reason
 * `schemaInstruction` is: an instruction that can drift from the shape the
 * parser expects is a shape nobody is checking.
 */
export function findingsFirst(schema) {
  const { analysis, findings, ...rest } = schema.properties;
  return {
    ...schema,
    required: ['findings', 'analysis', 'summary'],
    properties: { findings, analysis, ...rest },
  };
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
 * What the caps did to this reply — every one of these is a claim about
 * *truncation*, and every one is therefore gated on a grammar having been in
 * force. Kept together because they share that gate, and because they are the
 * only part of a parsed reply that describes the request rather than the answer.
 */
function capDiagnostics(parsed, { structured, schema }) {
  const cap = structured ? schema.properties?.analysis?.maxLength ?? null : null;
  const analysis = typeof parsed.analysis === 'string' ? parsed.analysis : null;
  return {
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
    analysisCut: structured && analysis !== null && analysis.length === cap,
    // The flag says a run was guillotined; these say how close every other run
    // came. A ceiling can only be sized from the distribution it truncates, and
    // recording only the boolean left that distribution unobservable: 17 of 41
    // recorded runs were cut with no way to tell whether the survivors cleared
    // the cap by a hair or by a mile. `completion_tokens` is not a substitute —
    // it bundles the reasoning with the findings payload, and on measured runs
    // the orderings cross (an uncut run at 7,576 sits above a cut one at 7,367).
    analysisLength: analysis === null ? null : analysis.length,
    // Only under a schema, for the same reason `analysisCut` is. On the degraded
    // rung the caps are prose in the prompt with no grammar behind them, so
    // reporting one would name a ceiling that was never enforced — and a reader
    // comparing `analysisLength` against it would be comparing against fiction.
    // It is no longer a constant either: the cap is derived per run from the
    // reply budget granted, so the number that bounded *this* reply is the only
    // one worth recording. See ADR 008.
    analysisCap: cap,
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
export function parseFindings({ content, reasoning }, { structured = false, schema = null } = {}) {
  // Not a default, because a default is exactly the bug. `analysisCut` compares
  // the reply against the cap the *request* carried, and that cap is now derived
  // per run — so a caller that fell back to some other schema would compare
  // against a number never sent, and report `analysisCut: false` for a run that
  // was guillotined. A guard describing itself as armed while disarmed is this
  // repo's signature class, so the omission has to be loud. Deleting the default
  // alone would not do it: JavaScript would simply pass `undefined` onward.
  if (structured && !schema) {
    throw new TypeError('parseFindings needs the exact schema the request sent when structured');
  }
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
    ...capDiagnostics(parsed, { structured, schema }),
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
  };
}
