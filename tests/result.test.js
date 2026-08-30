// `/oai:result`: the answer, or a straight account of why there isn't one.
//
// The rule under every case here is the one `requireAnswer` enforces on the
// foreground path: nothing exits 0 with no output. "No answer, success" and "an
// answer that happened to be empty" are indistinguishable to a caller, and this
// command is read by a caller far more often than by a person.
import assert from 'node:assert/strict';
import test from 'node:test';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, waitForState } from './job-helpers.mjs';
import { RENDER_CONSUMED_FIELDS } from '../scripts/lib/cmd-result.mjs';
import { tempDir } from './helpers.mjs';

const workspace = (tag) => tempDir(`oai-res-${tag}-`);
const HOSTILE = { toString: null, valueOf: null };

test('a completed job hands back its answer and footer, from another directory', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const submit = await scenario.submit([], { cwd: workspace('a') });
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();
    await waitForState(scenario.state, id, ['completed', 'failed']);

    const result = await scenario.run(['result', id], { cwd: workspace('b') });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^ok/);
    // The same footer builder the foreground path uses, so a figure shown after
    // `/oai:task` cannot quietly go missing after `/oai:result`.
    assert.match(result.stdout, /provider: fake/);
    assert.match(result.stdout, /model: test-model/);
  } finally {
    await scenario.server.close();
  }
});

test('a job that has not finished is refused, naming the state', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario({ delayMs: 2000 });
  try {
    const submit = await scenario.submit();
    const id = submit.stdout.trim();
    await waitForState(scenario.state, id, ['running']);

    const result = await scenario.run(['result', id]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Job ${id} is running`));
    assert.match(result.stderr, /\/oai:status/);
    assert.equal(result.stdout, '', 'a job with no answer must produce no output at all');

    await waitForState(scenario.state, id, ['completed', 'failed']);
  } finally {
    await scenario.server.close();
  }
});

test('a failed job reports what went wrong and where its log is', { skip: NEEDS_SQLITE }, async () => {
  // Driven through a server that refuses, so the envelope under test is the one
  // the worker actually wrote rather than a fixture asserting on itself.
  const scenario = await queueScenario({ failChats: true });
  try {
    const submit = await scenario.submit(['--max-attempts', '1']);
    const id = submit.stdout.trim();
    const row = await waitForState(scenario.state, id, ['failed', 'completed']);
    assert.equal(row.state, 'failed', 'a 500 from the server is not a completed job');

    const result = await scenario.run(['result', id]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Job ${id} failed`));
    assert.match(result.stderr, new RegExp(`logs/${row.seq}\\.log`));
    assert.equal(result.stdout, '');
  } finally {
    await scenario.server.close();
  }
});

test('a job that completed with nothing to say is refused rather than printed as success', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hollow',
      state: 'completed',
      outcome: { content: '   ', model: 'test-model', requestedModel: 'test-model' },
    });

    const result = await scenario.run(['result', 'hollow']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /recorded no answer/);
    assert.equal(result.stdout, '');
  } finally {
    await scenario.server.close();
  }
});

test('an outcome from a build that renamed "content" is refused as unrecognised, not as no answer', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'foreign',
      state: 'completed',
      // No `content` key at all — the shape a newer build's renamed field
      // would leave behind, distinct from this build's own "blank content"
      // case covered by the "hollow" test above.
      outcome: { model: 'test-model', requestedModel: 'test-model' },
    });

    const result = await scenario.run(['result', 'foreign']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.doesNotMatch(result.stderr, /recorded no answer/);
    assert.equal(result.stdout, '');
  } finally {
    await scenario.server.close();
  }
});

test("a recognised outcome missing model/durationMs never prints NaN or the literal string 'undefined'", { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'partial',
      state: 'completed',
      outcome: { content: 'a real answer' },
    });

    const result = await scenario.run(['result', 'partial']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /a real answer/);
    assert.match(result.stdout, /model: unknown/);
    assert.doesNotMatch(result.stdout, /NaN/);
    assert.doesNotMatch(result.stdout, /undefined/);
  } finally {
    await scenario.server.close();
  }
});

test('an object-valued model that cannot be coerced to a string is refused, not crashed', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-model',
      state: 'completed',
      // A future build's `model` reshaped to a non-primitive: `substitution`'s
      // template-literal interpolation would throw on this exact shape
      // (`toString`/`valueOf` both non-callable) before the shape guard, so
      // this proves the guard runs first.
      outcome: { content: 'ok', requestedModel: 'x', model: { toString: null, valueOf: null } },
    });

    const result = await scenario.run(['result', 'hostile-model']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('an object-valued requestedModel is refused the same way, with an otherwise-normal model', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-requested',
      state: 'completed',
      // `model` alone is fine, but `substitution`'s interpolation of `swap.requested`
      // crashes on this shape exactly as it does for a hostile `model` — proving the
      // `requestedModel` guard is independently load-bearing, not redundant with `model`'s.
      outcome: { content: 'ok', model: 'test-model', requestedModel: { toString: null, valueOf: null } },
    });

    const result = await scenario.run(['result', 'hostile-requested']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('an object-valued finishReason is refused rather than crashing while rendering the footer', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-finish',
      state: 'completed',
      outcome: { content: 'ok', model: 'test-model', finishReason: { toString: null, valueOf: null } },
    });

    const result = await scenario.run(['result', 'hostile-finish']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('a hostile artifact.detail is refused up front, never reaching artifactNote mid-write', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-artifact',
      state: 'completed',
      // artifactNote() interpolates `detail` on every branch but 'applies' — this
      // would otherwise throw AFTER the answer and footer were already written.
      outcome: { content: 'ok', model: 'test-model', artifact: { state: 'rejected', detail: { toString: null, valueOf: null } } },
    });

    const result = await scenario.run(['result', 'hostile-artifact']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('a hostile transport.name is refused up front, never reaching the provider interpolation', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-transport',
      state: 'completed',
      // `transport` is the same kind of foreign-writable JSON blob as `outcome`
      // (job-record.mjs's JSON_COLUMNS) — its `.name` reaches an unguarded
      // `` `provider: ${providerName}` `` template literal in render.mjs.
      transport: JSON.stringify({ name: { toString: null, valueOf: null } }),
      outcome: { content: 'ok', model: 'test-model' },
    });

    const result = await scenario.run(['result', 'hostile-transport']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('an array-valued artifact is refused rather than printing the literal string "undefined"', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'array-artifact',
      state: 'completed',
      // `typeof [] === 'object'` passes a naive object check; `.detail` on an
      // array reads `undefined`, which `artifactNote`'s default branch would
      // otherwise print verbatim as the literal string "undefined".
      outcome: { content: 'ok', model: 'test-model', artifact: [] },
    });

    const result = await scenario.run(['result', 'array-artifact']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('a plain-object artifact with no recognized state is refused, not defaulted to "absent"', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'no-state-artifact',
      state: 'completed',
      // `{}` has no `.state` at all — `ARTIFACT_STATES.includes(undefined)` is
      // false, so this must be refused rather than silently falling through to
      // artifactNote's default branch and printing "undefined" as before.
      outcome: { content: 'ok', model: 'test-model', artifact: {} },
    });

    const result = await scenario.run(['result', 'no-state-artifact']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('an unrecognized state with an otherwise-valid detail string is still refused', { skip: NEEDS_SQLITE }, async () => {
  // Isolates the state-enum check from the detail check: a valid `detail`
  // string alone would satisfy the non-`applies` detail requirement, so this
  // can only be caught by `ARTIFACT_STATES.includes(value.state)` itself.
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'unrecognized-state-artifact',
      state: 'completed',
      outcome: { content: 'ok', model: 'test-model', artifact: { state: 'bogus-state', detail: 'a real string' } },
    });

    const result = await scenario.run(['result', 'unrecognized-state-artifact']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('a recognized artifact state with no detail at all is refused, not printed as "undefined"', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'no-detail-artifact',
      state: 'completed',
      // `state: 'rejected'` is recognized, but artifactNote unconditionally
      // interpolates `detail` for every state except 'applies' — an absent
      // `detail` here would print the literal string "undefined", the same
      // failure a hostile object would produce.
      outcome: { content: 'ok', model: 'test-model', artifact: { state: 'rejected' } },
    });

    const result = await scenario.run(['result', 'no-detail-artifact']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('an applies-state artifact needs no detail at all — the one state that never reads it', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'applies-artifact',
      state: 'completed',
      outcome: { content: 'ok', model: 'test-model', artifact: { state: 'applies' } },
    });

    const result = await scenario.run(['result', 'applies-artifact']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /applies cleanly/);
  } finally {
    await scenario.server.close();
  }
});

test('a transport missing .name entirely renders "provider: unknown", never the literal "undefined"', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'no-provider-name',
      state: 'completed',
      // A missing name is absence, not hostility — this must still succeed,
      // unlike the hostile-transport case above.
      transport: JSON.stringify({}),
      outcome: { content: 'ok', model: 'test-model' },
    });

    const result = await scenario.run(['result', 'no-provider-name']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /provider: unknown/);
    assert.doesNotMatch(result.stdout, /provider: undefined/);
  } finally {
    await scenario.server.close();
  }
});

test('a hostile job.request.template is refused up front, never reaching Object.hasOwn', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-template',
      state: 'completed',
      // Object.hasOwn(TEMPLATES, name) invokes ToPropertyKey -> ToPrimitive on
      // a hostile `name`, which throws for a non-callable toString/valueOf.
      request: { messages: [{ role: 'user', content: 'synthetic' }], template: HOSTILE },
      outcome: { content: 'ok', model: 'test-model' },
    });

    const result = await scenario.run(['result', 'hostile-template']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('a hostile job.request.estimatedTokens is refused up front, never reaching the > comparison', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-estimated-tokens',
      state: 'completed',
      // `estimatedTokens > template.softCeilingTokens` invokes ToPrimitive on
      // a hostile value via `>`, which throws the same way Object.hasOwn does.
      request: { messages: [{ role: 'user', content: 'synthetic' }], template: 'advisor', estimatedTokens: HOSTILE },
      outcome: { content: 'ok', model: 'test-model' },
    });

    const result = await scenario.run(['result', 'hostile-estimated-tokens']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('every RENDER_CONSUMED_FIELDS entry is actually enforced, not merely claimed', { skip: NEEDS_SQLITE }, async () => {
  // Not two hand-maintained lists compared against each other (a prior design
  // a review round correctly rejected as circular) — this constructs, for
  // every entry the table claims to cover, a synthetic row whose ONLY defect
  // is a hostile value at that exact path, and proves it is actually refused.
  // What this proves: every entry the table currently claims is enforced. It
  // does NOT prove the table is complete — a field consumed by a future
  // change without a matching entry would still slip past, exactly as the
  // three prior review rounds' findings did before each was added here.
  const BUILDERS = {
    'outcome.model': () => ({ outcome: { content: 'ok', model: HOSTILE } }),
    'outcome.requestedModel': () => ({ outcome: { content: 'ok', model: 'test-model', requestedModel: HOSTILE } }),
    'outcome.finishReason': () => ({ outcome: { content: 'ok', model: 'test-model', finishReason: HOSTILE } }),
    'outcome.artifact': () => ({ outcome: { content: 'ok', model: 'test-model', artifact: HOSTILE } }),
    'request.contextNote': () => ({
      outcome: { content: 'ok', model: 'test-model' },
      request: { messages: [{ role: 'user', content: 'synthetic' }], contextNote: HOSTILE },
    }),
    'request.template': () => ({
      outcome: { content: 'ok', model: 'test-model' },
      request: { messages: [{ role: 'user', content: 'synthetic' }], template: HOSTILE },
    }),
    'request.estimatedTokens': () => ({
      outcome: { content: 'ok', model: 'test-model' },
      request: { messages: [{ role: 'user', content: 'synthetic' }], template: 'advisor', estimatedTokens: HOSTILE },
    }),
    'transport.name': () => ({
      outcome: { content: 'ok', model: 'test-model' },
      transport: JSON.stringify({ name: HOSTILE }),
    }),
  };

  const coveredPaths = RENDER_CONSUMED_FIELDS.map((entry) => entry.path);
  assert.deepEqual(
    [...coveredPaths].sort(),
    Object.keys(BUILDERS).sort(),
    'this test\'s BUILDERS map must name exactly the fields RENDER_CONSUMED_FIELDS claims to cover',
  );

  for (const path of coveredPaths) {
    const scenario = await queueScenario();
    try {
      const id = `struct-${path.replace(/\./g, '-')}`;
      insertSynthetic(scenario.state, { id, state: 'completed', ...BUILDERS[path]() });

      const result = await scenario.run(['result', id]);
      assert.equal(result.status, 1, `${path}: expected refusal`);
      assert.match(result.stderr, /not a shape this build understands/, path);
      assert.equal(result.stdout, '', `${path}: a refusal must never leak partial output`);
    } finally {
      await scenario.server.close();
    }
  }
});

test('a hostile persisted contextNote is refused up front, never reaching the footer join', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-context-note',
      state: 'completed',
      // render.mjs's `lines.join('\n')` coerces every element, including this
      // one — the same hazard as the other outcome fields, one hop further in.
      request: { messages: [{ role: 'user', content: 'synthetic' }], contextChecked: false, contextNote: { toString: null, valueOf: null } },
      outcome: { content: 'ok', model: 'test-model' },
    });

    const result = await scenario.run(['result', 'hostile-context-note']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a shape this build understands/);
    assert.equal(result.stdout, '', 'a refusal must never leak partial output');
  } finally {
    await scenario.server.close();
  }
});

test('a non-numeric completion_tokens alone (prompt_tokens normal) is also omitted, not crashed', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-completion',
      state: 'completed',
      outcome: {
        content: 'ok',
        model: 'test-model',
        usage: { prompt_tokens: 10, completion_tokens: { toString: null, valueOf: null } },
      },
    });

    const result = await scenario.run(['result', 'hostile-completion']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok/);
    assert.match(result.stdout, /tokens: 10 in \/ \? out/);
  } finally {
    await scenario.server.close();
  }
});

test('a non-numeric usage field is omitted from the footer rather than crashing after the answer is written', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hostile-usage',
      state: 'completed',
      outcome: { content: 'ok', model: 'test-model', usage: { prompt_tokens: { toString: null, valueOf: null } } },
    });

    const result = await scenario.run(['result', 'hostile-usage']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok/);
    assert.doesNotMatch(result.stdout, /tokens:/);
  } finally {
    await scenario.server.close();
  }
});

test('a persisted context-unknown note reaches /oai:result exactly as the foreground path would show it', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'unchecked',
      state: 'completed',
      request: {
        messages: [{ role: 'user', content: 'synthetic' }],
        contextChecked: false,
        contextNote: 'Context window unknown for test-model — set "contextLength" for provider "fake" in the config to enable the size check.',
      },
      outcome: { content: 'ok', model: 'test-model', requestedModel: 'test-model', durationMs: 10 },
    });

    const result = await scenario.run(['result', 'unchecked']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Context window unknown for test-model/);
  } finally {
    await scenario.server.close();
  }
});

test('an id nobody has, and no id at all, are both refused', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const missing = await scenario.run(['result', 'nosuchid']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No job with id "nosuchid"/);

    const bare = await scenario.run(['result']);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /needs a job id/);
  } finally {
    await scenario.server.close();
  }
});
