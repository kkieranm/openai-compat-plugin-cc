// Asking an OpenAI-compatible server for JSON, and reading what comes back as
// findings. This is the one module that encodes structured-output dialect.
// Pulling JSON out of prose is NOT dialect and lives in `json-scan.mjs`.
import { extractJson } from './json-scan.mjs';
import { findingsShaped } from './findings-candidate.mjs';
import { findingsInYaml } from './findings-yaml.mjs';
import { emptyFindingsDocument } from './findings-empty.mjs';
import { MAX_FINDINGS } from './review-schema.mjs';

const SEVERITIES = new Set(['high', 'medium', 'low']);

export function responseFormatFor(schema, name = 'review') {
  return { type: 'json_schema', json_schema: { name, strict: true, schema } };
}

/**
 * Did the server reject the *request shape* rather than the request?
 *
 * Tested on the response, never the provider name. LM Studio
 * answers `'response_format.type' must be 'json_schema' or 'text'`; other
 * servers word it differently but all name the field they refused.
 */
export function isFormatRejection(error) {
  if (error?.status !== 400 && error?.status !== 422) return false;
  return /response_format|json_schema|response format/i.test(error.responseBody ?? '');
}

/**
 * The same schema with `findings` ahead of `analysis`, for the path with no
 * grammar behind it.
 *
 * The ordering in `reviewSchemaFor` is deliberate and measured, and it is
 * measured *under a grammar*: generation is constrained from the first token
 * there, so the model has no scratchpad and `analysis` has to be one — opening
 * with `findings` made it commit to defects before reading anything, and the
 * reviewer got worse.
 *
 * None of that holds without a grammar. The model reasons in its own channel
 * first — `reasoning_content`, measured at 38,956 characters on a 100-line file
 * — so asking it to reason again in `analysis` is asking twice, and the second
 * ask has nothing bounding it. Measured: it spends the entire token budget on
 * `analysis` and never reaches the findings at all. So on this path
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

  // Guarded before coercion, not after: an object with own toString/valueOf set
  // to null survives a JSON round trip and throws out of a bare String()/Number()
  // rather than producing NaN or "[object Object]" — which used to crash the
  // whole reply's parse for one malformed finding.
  const severity = (typeof raw.severity === 'string' ? raw.severity : '').toLowerCase();
  const line = Number(typeof raw.line === 'string' || typeof raw.line === 'number' ? raw.line : NaN);
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
    // pass, which turns a loud failure into a confident wrong answer.
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
    // one worth recording.
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
 * re-finding.
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
  // The channel list IS the guarantee, written where a reader can see it
  // rather than inferred from a ternary further down. Without a schema there
  // is exactly one channel to read, and `reasoning` is not in the list at all —
  // so no later change to the parsing below can accidentally reach it.
  const channels = structured ? [content, reasoning] : [content];

  // Tried in order, and the FIRST that yields a usable payload wins. It used to
  // be chosen before the parse — `content` unless it was blank — so under a
  // schema one stray character in `content` buried a perfectly good payload in
  // `reasoning` and the user was told the model returned the wrong shape. The
  // blank-content case is not special here; a blank channel simply fails to
  // parse like any other.
  for (const channel of channels) {
    if (!channel?.trim()) continue;
    const attempt = findingsIn(channel, { structured, schema });
    if (attempt.kind === 'findings') return attempt.report;
    // A channel that ANSWERED and cannot be read ends the search. Letting it
    // fall through was a defect this repo introduced fixing another one: an
    // all-dropped `content` payload is not an absent channel, and treating the
    // two alike let a conforming primary answer be replaced by whatever sat in
    // `reasoning` — which under a server that ignored the schema is a draft.
    if (attempt.kind === 'unreadable') return null;
  }
  return null;
}

// Three outcomes, named. The whole of that defect was two of them sharing one
// `null`: "nothing here, try the next channel" and "this channel answered and
// the answer is unreadable" are opposite instructions to the caller.
const NO_PAYLOAD = { kind: 'none' };
const UNREADABLE = { kind: 'unreadable' };

/** One channel's text, read as findings. */
function findingsIn(text, { structured, schema }) {
  // Tried first, and ONLY on the unconstrained path — a structured request has
  // a schema-conforming JSON payload as its whole promise, and letting a
  // whole-document YAML reading pre-empt it would be a bug: the two grammars
  // are not disjoint in general (a
  // YAML value can carry an embedded balanced bracket run as ordinary scalar
  // text), so racing them on the structured path can silently prefer the wrong
  // one. Unconstrained, there is no schema to lose to, and a reply that is
  // whole-document YAML-shaped never had a bracketed candidate `extractJson`
  // was going to legitimately find in the first place — see findings-yaml.mjs.
  const yaml = structured ? null : findingsInYaml(text);

  // What this module will accept as a candidate, handed to the scanner so the
  // scanner never learns what a finding is. It is also what stops a bracketed
  // expression in a quoted source line outranking the real payload. Skipped
  // entirely once the YAML acceptor above already matched the whole document —
  // there is nothing left in `text` for it to legitimately win.
  const parsed = yaml ? null : extractJson(text, findingsShaped);
  // Last resort: the YAML spelling of an empty-findings mapping, which neither
  // reader above can see (see findings-empty.mjs). Gated on `structured` alone,
  // like `yaml` — a structured request must answer under its schema, never here.
  // Its precedence lives in ONE place, its position last in the chain below: it
  // is USED only when `yaml` and `parsed` both declined. Deliberately NOT also
  // guarded on `parsed` — one expression of that precedence, not two that could
  // drift. Computed even when `parsed` won (then discarded by the `??`
  // short-circuit): the cost is one line-1 regex whenever the opener does not
  // match, since the anchor declines it before the line scan; only a reply that
  // opens with an empty declaration AND is out-competed by `parsed` pays the full
  // line scan before being discarded.
  const emptyDoc = structured ? null : emptyFindingsDocument(text);
  // A bare top-level array is the SAME REPLY as `{findings: [...]}`, and asked
  // in prose a model emits one about as readily as the other. It used to be
  // discarded — not on the `typeof` test, which arrays pass, but on
  // `parsed.findings` being undefined. Wrapped HERE, before anything downstream
  // reads it, so the two spellings cannot diverge rather than merely agreeing
  // about accept/reject.
  const shaped = yaml ?? (Array.isArray(parsed) ? { findings: parsed } : parsed) ?? emptyDoc;
  if (!shaped || typeof shaped !== 'object' || !Array.isArray(shaped.findings)) return NO_PAYLOAD;

  // Under a schema, conformance is the whole proof. A server that accepts
  // `response_format` without enforcing it would otherwise let a scratchpad
  // draft — the first `{...}` in the reasoning text — be shipped as findings,
  // which is exactly what reading that channel is supposed to rule out. It is
  // also what keeps the fallback above from becoming a scratchpad channel.
  // Without a schema nothing was promised, so repair what is repairable.
  // (`yaml` is always null here when `structured` is true — the gate above —
  // so this only ever judges an `extractJson` candidate.)
  if (structured && !matchesSchema(shaped, schema)) return NO_PAYLOAD;

  const normalized = shaped.findings.map(normalizeFinding);
  const kept = normalized.filter(Boolean);
  // A list the model filled with things that are not findings is NOT a clean
  // review, and reporting it as one inverts the `null` versus `[]` distinction
  // that matters here. `[]` means the model looked and found nothing; a
  // non-empty list none of whose entries survives
  // normalization means it answered and we cannot read the answer, which is what
  // `null` means. Applied to both spellings, so accepting bare arrays did not
  // widen the set of replies that reach the false-clean.
  //
  // Reported as UNREADABLE rather than as an empty channel, so the search stops
  // here: this channel answered. `review-report.mjs` then prints every non-empty
  // channel, labelled, so the unusable findings themselves reach the reader —
  // which is more than a tally of them, and is the claim that used to be made
  // and was false whenever the rejected text sat in the channel the renderer
  // did not pick.
  if (shaped.findings.length > 0 && kept.length === 0) return UNREADABLE;

  return {
    kind: 'findings',
    report: {
      findings: kept,
      dropped: normalized.filter((finding) => !finding).length,
      ...capDiagnostics(shaped, { structured, schema }),
      summary: typeof shaped.summary === 'string' ? shaped.summary.trim() : '',
    },
  };
}
