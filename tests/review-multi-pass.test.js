// `/oai:review --passes N` end to end against the fake server: the byte-identity
// of the single-pass path, the union with its agreement count, the empty-pass
// denominator, and the two fail-closed refusals (all-unreadable, and a served
// model the server never confirmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeFor } from '../bench/lib/outcome.mjs';
import { scoreRun } from '../bench/lib/score.mjs';
import { passEnvelope, sumUsage } from '../scripts/lib/review-report.mjs';
import { caveatUnion } from '../scripts/lib/review-passes.mjs';
import { truncatedRuns } from '../bench/lib/run-buckets.mjs';
import { attemptRows } from '../bench/lib/attempt-rows.mjs';
import { LENSES } from '../scripts/lib/review.mjs';
import { completionFrames, modelList, reasoningFrames, respondJson, respondStream, reviewScenario as scenario, runCompanion, scriptOf } from './helpers.mjs';

const clean = JSON.stringify({
  analysis: 'read each changed file in full',
  findings: [{ file: 'seed.txt', line: 2, severity: 'high', summary: 'a defect', evidence: 'edited' }],
  summary: 'One defect found.',
});

const streams = (body, options) => (request, response) => respondStream(response, completionFrames(body, options));

// Volatile between two runs of the same command: wall-clock durations and the
// derived rate. Masking them is what lets a byte-identity assertion pin the
// rendering path rather than the stopwatch.
const stripTiming = (text) => text.replace(/\d+\.\d+s/g, '<t>').replace(/[\d.]+ tok\/s/g, '<r>');

test('--passes 1 is byte-identical to the single-pass path (modulo timing)', async () => {
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const plain = await runCompanion(['review'], { configPath, cwd: dir });
  const onePass = await runCompanion(['review', '--passes', '1'], { configPath, cwd: dir });
  await server.close();

  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(onePass.status, 0, onePass.stderr);
  assert.equal(stripTiming(onePass.stdout), stripTiming(plain.stdout));
});

test('--passes 1 --json takes the single-pass envelope, not the multi-pass one', async () => {
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '1', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, undefined, 'a single pass must not carry the multi-pass kind');
  assert.equal(report.parsed, true);
});

test('--passes 3 unions the passes and counts agreement 3/3', async () => {
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '3', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, 'multi-pass-review');
  assert.equal(report.passCount, 3);
  assert.equal(report.readablePasses, 3);
  assert.equal(report.passes.length, 3);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].agreement, 3);
  assert.equal(report.findings[0].readablePasses, 3);
  // The confirmed shared model rides the top level so a bench substitution check
  // stays meaningful; the caveats are present and clean.
  assert.equal(report.model, 'test-model');
  assert.equal(report.salvaged, false);
  assert.equal(report.analysisCut, false);
  // PC2-5: a top-level parsed:true so a scoring consumer gates it like a
  // single-pass record.
  assert.equal(report.parsed, true);
});

test('the text report annotates each finding with its agreement count', async () => {
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '2'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[2\/2 passes\]/);
  assert.match(result.stdout, /2 of 2 passes readable/);
});

test('an empty pass stays in the denominator, lowering agreement not the count', async () => {
  // The server answers the first request with a finding and the rest empty, so
  // the union is 1 finding at agreement 1 of 3 readable passes — the empty
  // passes are votes that found nothing, never dropped.
  let seen = 0;
  const handler = (request, response) => {
    if (!request.url.endsWith('/chat/completions')) return respondJson(response, modelList('test-model'));
    seen += 1;
    const body = seen === 1 ? clean : JSON.stringify({ findings: [], summary: 'nothing found' });
    return respondStream(response, completionFrames(body));
  };
  const { dir, server, configPath } = await scenario(handler, { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '3', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readablePasses, 3);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].agreement, 1);
});

test('all passes unreadable fails closed, never a clean review at exit 0', async () => {
  // Prose with no findings shape — parseFindings cannot read it, so every pass
  // is a non-observation. Rendering findings:[] here would be a false clean.
  const { dir, server, configPath } = await scenario(streams('I looked and everything seems fine to me.'), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.notEqual(report.kind, 'multi-pass-review');
  assert.match(result.stderr, /could not be read|not.*findings|unread/i);
  // F2/P-c: the error envelope's attempts is non-null and spans BOTH passes — the
  // OAI-116 field is populated, and the mixed-failure evidence is not one pass's
  // alone. (Each pass makes one physical request → one attempt record.)
  assert.ok(Array.isArray(report.attempts), 'the --json error envelope carries attempts');
  assert.equal(report.attempts.length, 2, 'attempts span every pass, not just the first');
});

test('a non-observation pass keeps its metadata in passes[] without being counted readable', async () => {
  // Pass 1 readable, pass 2 an unreadable prose reply. The run succeeds on pass 1;
  // pass 2's passes[] entry stays ok:false (so the caveat union never ingests it
  // as clean) yet preserves its durationMs, attempts, served model, and raw reply.
  let seen = 0;
  const handler = (request, response) => {
    if (!request.url.endsWith('/chat/completions')) return respondJson(response, modelList('test-model'));
    seen += 1;
    return seen === 1
      ? respondStream(response, completionFrames(clean))
      : respondStream(response, completionFrames('I read it and it looks fine, no issues.'));
  };
  const { dir, server, configPath } = await scenario(handler, { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readablePasses, 1);
  const nonObs = report.passes.find((p) => p.ok === false);
  assert.ok(nonObs, 'the unreadable pass is present in passes[]');
  assert.equal(typeof nonObs.durationMs, 'number');
  assert.ok(Array.isArray(nonObs.attempts) && nonObs.attempts.length >= 1, 'its attempts are preserved');
  assert.equal(nonObs.model, 'test-model', 'its served model is preserved');
  assert.equal(typeof nonObs.raw, 'string', 'the raw unreadable reply is kept for diagnosis');
  // (The top-level durationMs-sums-all-passes rule is pinned by totalDuration's
  // unit test, where the failed pass's duration is nonzero and observable; the
  // fake server's near-zero timings cannot distinguish it here.)
});

test('a --passes 3 record scores through the real bench path (not just fields present)', async () => {
  // The acceptance bar is empirical: `outcomeFor` reads two fields directly then
  // carries the report opaquely, so "requestedModel/model present" does not prove
  // the benchmark can score it. This runs the merged envelope through the actual
  // `outcomeFor` + `scoreRun` the bench uses.
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '3', '--json'], { configPath, cwd: dir });
  await server.close();

  const { report, error } = outcomeFor(result.stdout, false);
  assert.equal(error, undefined, 'the merged envelope is not read as a model substitution');
  const scored = scoreRun(report.findings, [{ id: 'D1', file: 'seed.txt', anchor: 'edited', lines: [1, 3] }]);
  assert.equal(scored.matched.length, 1, 'the unioned finding anchor-matches the catalogued defect');
  assert.equal(scored.matched[0].via, 'anchor');
});

test('the merged --json envelope carries every single-pass top-level key a consumer reads', async () => {
  // Graduation test for the recurring class "the merged envelope drops a jsonReport
  // field a consumer reads" (plan-gate → caveats; Pass 2 → parsed; Pass 3 →
  // usage-reasoning, run-context, degraded). Default-deny: every top-level key of a
  // real single-pass --json report must appear in the merged --passes envelope OR
  // sit in the explicit PER_PASS_ONLY allowlist below. SCOPE: this samples a CLEAN
  // run, so it default-denies every UNCONDITIONALLY-emitted top-level key (which is
  // all of jsonReport's today — its body is one object literal, `parseFields` and
  // `runTimings` return fixed key sets, and the only conditional key,
  // `usage.completion_tokens_details`, is nested, not top-level). A future field
  // emitted ONLY on a failure/salvage path would not appear in this clean sample and
  // so would escape the deny — whoever adds a conditionally-emitted top-level field
  // OWES this test a fixture that exercises it, or a conscious PER_PASS_ONLY entry.
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const single = JSON.parse((await runCompanion(['review', '--json'], { configPath, cwd: dir })).stdout);
  const merged = JSON.parse((await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir })).stdout);
  await server.close();

  // Genuinely per-pass or per-reply facts a union does not carry at top level; each
  // rides every entry of passes[] instead. `summary` — mergePasses has no union
  // summary by design. `attempts` and `finishReason` are NO LONGER here: the merged
  // SUCCESS envelope carries both at top level (attempts = the whole-run aggregate
  // over all passes; finishReason = the union truncation signal), because a
  // multi-pass bench record's WHOLE-RUN reliability (bench/lib/attempt-rows.mjs
  // everyAttempt) and truncation (run-buckets.mjs truncatedRuns) read TOP-LEVEL
  // report.attempts/report.finishReason — reachable now that bench forwards
  // --passes. `retried` STAYS per-pass-only: no bench/ code reads report.retried
  // (single-pass retried is a per-pass request-count derivation). The rest —
  // `raw`/`analysisLength`/`analysisCap`/`estimatedTokens`/`contextNote`/`prefillMs`/
  // `generationMs`/`salvageTrim` — are per-reply diagnostics.
  const PER_PASS_ONLY = new Set([
    'summary', 'analysisLength', 'analysisCap', 'estimatedTokens',
    'contextNote', 'prefillMs', 'generationMs', 'retried', 'raw', 'salvageTrim',
  ]);
  const missing = Object.keys(single).filter((key) => !(key in merged) && !PER_PASS_ONLY.has(key));
  assert.deepEqual(missing, [], `merged envelope drops consumer key(s): ${missing.join(', ')}`);
});

test('the merged SUCCESS envelope carries a whole-run attempts aggregate the bench reliability reader consumes', async () => {
  // The OAI-9 bench-wiring residue, landing with OAI-11's --passes forwarding: a
  // multi-pass success record's whole-run reliability reads TOP-LEVEL
  // `report.attempts` (bench/lib/attempt-rows.mjs everyAttempt). Aggregate over ALL
  // passes, so two clean passes contribute two answered attempts. Mutation: dropping
  // the aggregate (or scoping it to one pass) reds `report.attempts.length` and the
  // consumer's `total`.
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(report.finishReason, null, 'two clean stop passes are not truncated');
  assert.ok(Array.isArray(report.attempts), 'attempts is a top-level array on the merged success envelope');
  assert.equal(report.attempts.length, 2, 'one answered attempt per pass, aggregated over both');
  assert.ok(report.attempts.every((a) => a.outcome === 'answered'));
  // The bench consumer reads it end to end: two answered attempts, none failed.
  const rows = attemptRows([{ caseDef: { id: 'seed' }, runs: [{ report }] }]);
  assert.equal(rows.total, 2);
  assert.equal(rows.answered, 2);
  assert.equal(rows.failed, 0);
  // And it is not truncated for the bench truncation reader.
  assert.deepEqual(truncatedRuns([{ report }]), []);
});

test('a PARSE-NULL truncated pass flips the union finishReason — over every result-bearing pass, not just readable', async () => {
  // The round-7 correction (found by codex-adversarial): the union truncation signal
  // ranges over EVERY pass carrying a `result`, not the readable subset. A parse-null
  // pass (a reply arrived that parseFindings could not read) is a non-observation
  // EXCLUDED from `readable`, yet still carries its `finishReason` — and
  // token-exhaustion (finish_reason 'length') is a leading cause of unreadability. So
  // a run with one clean readable pass and one parse-null 'length' pass is truncated,
  // and reading `readable` only would blind the signal on exactly the truncated pass.
  //
  // Mutation proof: change reportPasses's `passes.some(...)` to `readable.some(...)`
  // and this reds — the truncated pass is not in `readable`, so finishReason reads
  // null and the bench misclassifies the record as scored rather than truncated.
  let seen = 0;
  const handler = (request, response) => {
    if (!request.url.endsWith('/chat/completions')) return respondJson(response, modelList('test-model'));
    seen += 1;
    // Pass 1: a clean, parseable reply that finished normally (readable).
    // Pass 2: prose with no findings shape at all, cut off mid-reply (parse-null,
    // finish_reason 'length') — ok:true, result set, parsed null.
    if (seen === 1) return respondStream(response, completionFrames(clean, { finishReason: 'stop' }));
    return respondStream(response, completionFrames('ran out of tokens before I could write the', { finishReason: 'length' }));
  };
  const { dir, server, configPath } = await scenario(handler, { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, 'multi-pass-review');
  assert.equal(report.readablePasses, 1, 'the truncated parse-null pass is NOT readable');
  assert.equal(report.finishReason, 'length', 'a result-bearing parse-null length pass flips the union');
  // The bench truncation reader now classifies the whole multi-pass record as
  // truncated off the top-level signal — the consumer proof.
  assert.equal(truncatedRuns([{ report }]).length, 1);
});

test('the merged usage preserves reasoning_tokens and the top-level reasoning witness reads it', async () => {
  // Mutation proof for sumUsage's completion_tokens_details branch: two passes each
  // reporting 40 reasoning tokens sum to 80 on the merged usage, and the top-level
  // `reasoning` witness — which reads THIS merged usage — classifies observed.
  // Dropping the detail from the sum reds the count and reads `reasoning` unknown.
  const { dir, server, configPath } = await scenario(streams(clean, { reasoningTokens: 40 }), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(report.usage.completion_tokens_details.reasoning_tokens, 80);
  assert.equal(report.reasoning.state, 'reasoning-observed');
  assert.equal(report.reasoning.tokens, 80);
});

test('sumUsage rejects a negative base token count, nulling the whole usage', () => {
  // Mutation proof for the base-gate `>= 0`: a negative prompt_tokens is corruption,
  // not a measurement, so the whole top-level usage nulls (fail-closed) rather than
  // summing a corrupt total. Reverting `>= 0` lets it sum through, reding this.
  // Array-of-passes signature: sumUsage reads `pass.result.usage`.
  assert.equal(sumUsage([{ result: { usage: { prompt_tokens: -1, completion_tokens: 7, total_tokens: 18 } } }]), null);
  // Positive control: a legitimate all-zero usage still sums — guards against a
  // later "hardening" to `> 0`, which would wrongly null a real zero-token reply.
  assert.deepEqual(
    sumUsage([{ result: { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } } }]),
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  );
});

test('a parse-null pass discloses salvaged/salvageTrim/degraded on its entry; caveatUnion never ORs a non-observation in', () => {
  // Mutation proof for F4: a salvaged/degraded parse-null pass (a reply arrived,
  // unparseable) carries salvaged/salvageTrim/degraded on its OWN passes[] entry,
  // so "nothing is concealed" holds for it. Reverting any of the three branch lines
  // reds its assert. `salvageTrim` round-trips as-is: a realistic trimmed shape,
  // where applied:true implies retained < original (the all-equal shape is the
  // untrimmed applied:false case).
  const nonObs = passEnvelope(
    { ok: true, parsed: null, structured: false, salvaged: true, salvageTrim: { applied: true, originalChars: 8000, retainedChars: 6000 }, result: { content: 'unreadable prose', reasoning: '', finishReason: 'stop' }, ledger: { entries: () => [] } },
    1,
    { profile: { name: 'lmstudio' }, model: 'test-model', structuredOutput: true },
  );
  assert.equal(nonObs.ok, false);
  assert.equal(nonObs.salvaged, true, 'the entry discloses it was salvaged');
  assert.deepEqual(nonObs.salvageTrim, { applied: true, originalChars: 8000, retainedChars: 6000 }, 'salvageTrim round-trips onto the entry');
  assert.equal(nonObs.degraded, true, 'and that it degraded (structuredOutput requested, not structured)');
  // A pass with no salvageTrim defaults to null (the `?? null`), never undefined —
  // pins the coalesce, which a truthy fixture alone would leave inert.
  const noTrim = passEnvelope(
    { ok: true, parsed: null, structured: true, salvaged: false, result: { content: 'prose', reasoning: '', finishReason: 'stop' }, ledger: { entries: () => [] } },
    2,
    { profile: { name: 'lmstudio' }, model: 'test-model', structuredOutput: false },
  );
  assert.equal(noTrim.salvageTrim, null, 'absent salvageTrim reads null, never undefined');
  assert.equal(noTrim.degraded, false, 'structuredOutput false → not degraded');

  // caveatUnion is readable-only: GIVEN reportPasses' `ok !== false` filtered list,
  // a non-observation's salvaged/degraded never reach the top-level OR. This pins
  // caveatUnion's own semantics, NOT that reportPasses filters — caveatUnion's flags
  // are ORs plus a non-negative `dropped` sum, so an unfiltered list could only ADD
  // caveats (over-caveat), never conceal; the REAL reportPasses filter is exercised
  // end-to-end by the salvage-e2e test below. `readableClean` has no `ok` key,
  // matching a real jsonReport (it stays in via `undefined !== false`).
  const readableClean = { salvaged: false, degraded: false };
  const flags = caveatUnion([readableClean, nonObs].filter((r) => r.ok !== false), { unreadable: false });
  assert.equal(flags.salvaged, false, 'a non-observation never contributes to the top-level salvaged OR');
  assert.equal(flags.degraded, false, 'nor to the degraded OR');
});

test('a salvaged-but-unparseable pass discloses salvaged in passes[] but never flips the top-level caveat (real reportPasses filter)', async () => {
  // The real-filter e2e the unit test above cannot give: pass 1 is readable-clean;
  // pass 2 streams reasoning-only (unconstrained throws) → salvage fires → the
  // salvage reply is bracket-free prose no acceptor can read → salvage physically
  // succeeds, so pass 2 lands {ok:true, parsed:null, salvaged:true}. Exactly THREE
  // chat requests (pass 1, pass 2 original, one salvage follow-up — no untrimmed
  // fallback at this reasoning length). Runs the REAL reportPasses `ok !== false`
  // filter, so removing it (ORing the salvaged non-obs into the top level) reds the
  // final assert. Request count is asserted post-hoc, never gated in the handler,
  // so a stray 4th request reds rather than hanging.
  const REASONING = 'still reasoning about this pass in great detail. '.repeat(20); // ~980 chars: > SALVAGE_MIN (500), < trim threshold (6000)
  let seen = 0;
  const handler = (record, response) => {
    if (!record.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
    seen += 1;
    if (seen === 1) return respondStream(response, completionFrames(clean));
    if (seen === 2) return respondStream(response, reasoningFrames(REASONING));
    // The salvage follow-up: prose no bracket/YAML/empty acceptor can read as findings.
    return respondStream(response, completionFrames('could not conclude anything definite from the analysis of this change'));
  };
  const { dir, server, configPath } = await scenario(handler, { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(chatRequests.length, 3, 'pass 1 + pass 2 original + one salvage follow-up');
  assert.equal(report.readablePasses, 1);
  const salvaged = report.passes.find((p) => p.ok === false);
  assert.ok(salvaged, 'the salvaged non-observation is present in passes[]');
  assert.equal(salvaged.salvaged, true, 'its entry discloses the salvage');
  assert.equal(salvaged.salvageTrim.applied, false, 'untrimmed at this reasoning length');
  assert.equal(salvaged.salvageTrim.originalChars, salvaged.salvageTrim.retainedChars, 'no trim → retained equals original');
  assert.equal(report.salvaged, false, 'the real readable-only filter keeps the non-observation out of the top-level OR');
});

test('passEnvelope surfaces a thrown pass\'s usage from either error carrier', () => {
  // Mutation proof for the thrown-pass usage branch: a pass whose REQUEST threw
  // (the dominant stream-drop failure mode) may carry the reply's usage on
  // error.answer.usage (a reply-envelope failure) or error.usage (no envelope) —
  // the same two disjoint carriers errorReport reads. Reverting the branch leaves
  // a thrown pass with usage:undefined / reasoning unread in passes[].
  const context = { profile: { name: 'lmstudio' }, model: 'test-model' };
  const ledger = { entries: () => [{ id: 'a1' }] };
  const viaAnswer = passEnvelope(
    { ok: false, error: Object.assign(new Error('stream drop'), { answer: { usage: { completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 12 } } } }), ledger },
    1, context,
  );
  assert.equal(viaAnswer.ok, false);
  assert.equal(viaAnswer.usage.completion_tokens, 50);
  assert.equal(viaAnswer.reasoning.state, 'reasoning-observed');
  assert.equal(viaAnswer.reasoning.tokens, 12);

  const viaError = passEnvelope(
    { ok: false, error: Object.assign(new Error('exhausted'), { usage: { completion_tokens: 30 } }), ledger },
    2, context,
  );
  assert.equal(viaError.usage.completion_tokens, 30);
  // No completion_tokens_details on this carrier, so the witness reads unknown.
  assert.equal(viaError.reasoning.state, 'unknown');
});

test('a served model the server never confirmed fails closed', async () => {
  // completionFrames with model:null — the reply names no model, so
  // result.modelReported is false and agreement was never confirmed.
  const { dir, server, configPath } = await scenario(streams(clean, { model: null }), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--passes', '2', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reason, 'unconfirmed-served-model');
  // PC2-2: the served-model refusal carries the completed passes' attempts, like
  // every other post-hoc failure — not attempts:null.
  assert.ok(Array.isArray(report.attempts) && report.attempts.length >= 1, 'the served-model failure carries its passes\' attempts');
});

// ---------------------------------------------------------------------------
// LENSES (OAI-11): one pass per named lens, tagged by lens, the lens riding the
// prompt tail so the passes share a cached prefix.

test('--lens correctness,security runs one pass per lens and tags findings by lens', async () => {
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--lens', 'correctness,security', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, 'multi-pass-review');
  assert.equal(report.strategy, 'lenses');
  assert.deepEqual(report.lenses, ['correctness', 'security']);
  assert.equal(report.passCount, 2);
  assert.deepEqual(report.passes.map((pass) => pass.lens), ['correctness', 'security']);
  // Both passes flag the one seed defect at seed.txt:2, so it is flagged by both lenses.
  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.findings[0].lenses, ['correctness', 'security']);
});

test('--lens and --passes together are refused loudly, before any request', async () => {
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--lens', 'security', '--passes', '2'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--lens and --passes cannot be combined/);
  assert.equal(server.requests.filter((r) => r.url.includes('chat/completions')).length, 0, 'refused before any model request');
});

test('an unknown lens is refused, naming the valid set', async () => {
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  const result = await runCompanion(['review', '--lens', 'bogus'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown --lens "bogus"/);
  assert.match(result.stderr, /correctness/);
});

test('the lens directive reaches the sent user message on the unconstrained AND structured paths', async () => {
  // The two paths where a suffix-smuggled lens would have been dropped
  // (`unconstrainedLadder` overwrites `suffix` on both). The dedicated `lens` param
  // rides the tail on both, after the diff and any schema instruction.
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  await runCompanion(['review', '--lens', 'security'], { configPath, cwd: dir });
  await runCompanion(['review', '--lens', 'security', '--structured-output'], { configPath, cwd: dir });
  await server.close();

  const chats = server.requests.filter((r) => r.url.includes('chat/completions'));
  assert.ok(chats.length >= 2, 'both runs sent a chat completion');
  for (const chat of chats) {
    const user = chat.body.messages.at(-1).content;
    assert.ok(user.includes(LENSES.security), 'the lens directive is present in the user message');
    assert.ok(user.trimEnd().endsWith(LENSES.security), 'the lens rides the tail, after the diff and any schema suffix');
  }
});

test('the lens directive reaches the structured schema-rejection FALLBACK request (path c)', async () => {
  // The third prompt path §2 names: a server that rejects response_format forces
  // the structured request to fall back to unconstrained, which reuses the same
  // closed-over ladder — so the fallback must still carry the lens. The earlier
  // test covers (a) unconstrained and (b) structured success; this covers (c).
  const { dir, server, configPath } = await scenario(
    scriptOf([
      (response) => respondJson(response, { error: { message: 'response_format is not supported' } }, 400),
      (response) => respondStream(response, completionFrames(clean)),
    ]),
    { contextLength: 131_072 },
  );
  const result = await runCompanion(['review', '--lens', 'security', '--structured-output', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const chats = server.requests.filter((r) => r.url.includes('chat/completions'));
  const fallback = chats.find((chat) => !chat.body.response_format);
  assert.ok(fallback, 'a fallback request without response_format was sent');
  assert.ok(fallback.body.messages.at(-1).content.includes(LENSES.security), 'the fallback request carries the lens directive');
});

test('the passes of one lens run share a byte-identical prefix up to the lens tail (cache invariant)', async () => {
  // The mechanical proof of the warm-pass economics claim: only the trailing lens
  // directive differs between two lens passes; system prompt, diff and schema
  // suffix are byte-identical, so the server's prefix cache is not busted.
  const { dir, server, configPath } = await scenario(streams(clean), { contextLength: 131_072 });
  await runCompanion(['review', '--lens', 'correctness,security', '--json'], { configPath, cwd: dir });
  await server.close();

  const chats = server.requests.filter((r) => r.url.includes('chat/completions'));
  assert.equal(chats.length, 2);
  const [u0, u1] = chats.map((chat) => chat.body.messages.at(-1).content);
  assert.equal(chats[0].body.messages[0].content, chats[1].body.messages[0].content, 'system prompt is lens-invariant');
  assert.ok(u0.endsWith(LENSES.correctness));
  assert.ok(u1.endsWith(LENSES.security));
  assert.equal(
    u0.slice(0, -LENSES.correctness.length),
    u1.slice(0, -LENSES.security.length),
    'everything before the lens tail is byte-identical across the two passes',
  );
});
