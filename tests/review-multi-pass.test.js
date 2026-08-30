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
import { completionFrames, modelList, reasoningFrames, respondJson, respondStream, reviewScenario as scenario, runCompanion } from './helpers.mjs';

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
  // summary by design. `attempts`/`retried`/`finishReason` are per-pass diagnostics
  // on each passes[] entry: a multi-pass bench record's WHOLE-RUN reliability
  // (bench/lib/attempt-rows.mjs) and truncation (run-buckets.mjs truncatedRuns) read
  // TOP-LEVEL attempts/finishReason, which the merged SUCCESS envelope does not carry
  // — a known gap tracked in the plan's bench-wiring residue and unreachable today
  // (bench cannot forward --passes). The FAILURE path's own top-level attempts is a
  // separate, cheap aggregate (allFailedError). The rest —
  // `raw`/`analysisLength`/`analysisCap`/`estimatedTokens`/`contextNote`/`prefillMs`/
  // `generationMs`/`salvageTrim` — are per-reply diagnostics.
  const PER_PASS_ONLY = new Set([
    'summary', 'finishReason', 'analysisLength', 'analysisCap', 'estimatedTokens',
    'contextNote', 'prefillMs', 'generationMs', 'retried', 'raw', 'salvageTrim', 'attempts',
  ]);
  const missing = Object.keys(single).filter((key) => !(key in merged) && !PER_PASS_ONLY.has(key));
  assert.deepEqual(missing, [], `merged envelope drops consumer key(s): ${missing.join(', ')}`);
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
