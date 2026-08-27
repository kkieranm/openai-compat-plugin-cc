// A model that WAS named, and whether the provider is allowed to contradict it.
//
// Split from `model-selection.test.js` at the size ratchet, and the seam is the
// one the source already draws: that file asks which model an unnamed selection
// lands on (`autoSelect`), this one asks when a named model is refused before
// the run is spent (`unservedProblem`) — and, just as importantly, when it must
// not be. The refusal gates on the dialect having published a catalogue, not on
// a dialect merely being recognised, so a recognised
// dialect that publishes no per-model list still takes the name on trust.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatRequests, completion, modelList, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

test('a defaultModel absent from a recognised catalogue is refused before anything is sent', async () => {
  // LM Studio answers a request naming a model it does not have with a normal
  // completion from whatever IS loaded, so the wrong id costs a whole run and
  // leaves a record that looks clean. The point is not spending it.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [
          { id: 'chat-a', type: 'llm', state: 'loaded', max_context_length: 8192, loaded_context_length: 4096 },
          { id: 'chat-b', type: 'llm', state: 'not-loaded', max_context_length: 8192 },
        ],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('chat-a', 'chat-b'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('answered'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'ghost' } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Model "ghost" is not served here\. Available: chat-a, chat-b/);
  // The prefix `resolveTarget` adds, checked once so the two halves cannot drift
  // into "Provider "local": Provider does not serve …".
  assert.match(result.stderr, /Provider "local": Model "ghost"/);
  assert.equal(chatRequests(server).length, 0, 'the refusal is worth nothing if the run was spent anyway');
});

test('a server that serves no model list still takes defaultModel on trust', async () => {
  // No `contextLength`, so the probe genuinely runs and comes back empty —
  // absence from a list nobody published is not evidence, and this server
  // answers chat requests perfectly well.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('worked'));
    return respondJson(response, { error: 'no such endpoint' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'm' } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chatRequests(server)[0].body.model, 'm');
});

test('a recognised dialect that publishes no catalogue does not make its ids a whitelist', async () => {
  // llama.cpp's /props is a recognised dialect carrying a server-wide window,
  // and it enumerates nothing — the ids come from the bare /v1/models list, and
  // the server ignores the requested model name entirely. Gating the refusal on
  // a dialect being recognised, rather than on it publishing a per-model list,
  // would break this setup, which works today.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) return respondJson(response, { error: 'not found' }, 404);
    if (path.endsWith('/props')) return respondJson(response, { default_generation_settings: { n_ctx: 4096 } });
    if (path.endsWith('/models')) return respondJson(response, modelList('models/qwen3-8b-Q4_K_M.gguf'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('worked'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'qwen3' } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chatRequests(server)[0].body.model, 'qwen3');
});

test('an id only /v1/models lists is still served, not refused', async () => {
  // The two endpoints can disagree about how many models exist, and absence
  // from ONE of them is not evidence. This is the direction where /v1/models is
  // the wider list: the dialect adds detail to ids, it does not veto them, and
  // refusing here would reject a model the server itself advertises.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'chat-a', type: 'llm', state: 'loaded', max_context_length: 8192, loaded_context_length: 4096 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('chat-a', 'chat-b'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('answered'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'chat-b' } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chatRequests(server)[0].body.model, 'chat-b');
});

test('an id only the dialect lists is served too — even loaded, it was being refused', async () => {
  // The mirror of the test above, and a defect the lean review CONFIRMED by
  // reproducing it end to end. `merge` keys `described.models` on the
  // /v1/models ids, so a model the dialect enumerated is absent from it
  // whenever /v1/models is the narrower list — filtered, aliased or
  // permission-scoped, all of which are expected. The refusal gated
  // on "the dialect published a catalogue" while testing membership in the
  // OTHER endpoint's list, and so refused `chat-b` here: the one model the
  // server actually had resident in memory and would have answered instantly.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [
          { id: 'chat-a', type: 'llm', state: 'not-loaded', max_context_length: 8192 },
          { id: 'chat-b', type: 'llm', state: 'loaded', max_context_length: 8192, loaded_context_length: 4096 },
        ],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('chat-a'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('answered'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'chat-b' } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(chatRequests(server)[0].body.model, 'chat-b');
});

test('a model on neither list is still refused, and both lists are offered', async () => {
  // Widening membership to the union must not disarm the refusal itself. And
  // the "Available:" list has to name everything that would be accepted, or it
  // sends the user to pick from a shorter list than the check applies.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'chat-b', type: 'llm', state: 'loaded', max_context_length: 8192, loaded_context_length: 4096 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('chat-a'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('answered'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'ghost' } },
  });

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Model "ghost" is not served here\. Available: chat-a, chat-b/);
  assert.equal(chatRequests(server).length, 0);
});

test('a fully configured profile is checked too, so setup and task cannot disagree', async () => {
  // The compromise this replaced, and why it had to go. `resolveTarget` used to
  // consult the server only for what the config left unanswered, so a profile
  // setting both `defaultModel` and `contextLength` never fetched a catalogue and
  // the up-front check could not fire — while `/oai:setup` probes
  // unconditionally and therefore DID refuse. Setup printed "reachable, but
  // /oai:task cannot run here" and "No provider can take a task right now" about
  // a task that ran perfectly well.
  //
  // That is this repo's most-repeated defect class with its sign flipped, and
  // calling one planner does not cure it when the two callers hand it different
  // evidence. Confirmed by the built-in review, reproduced end to end.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    // A real dialect catalogue, because that is what arms the refusal at all —
    // a bare /v1/models list is not evidence of absence.
    if (path.endsWith('/api/v0/models')) {
      return respondJson(response, {
        data: [{ id: 'other', type: 'llm', state: 'loaded', max_context_length: 8192, loaded_context_length: 4096 }],
      });
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('other'));
    if (path.endsWith('/chat/completions')) return respondJson(response, completion('worked'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'not-served', contextLength: 8192 } },
  });

  const task = await runCompanion(['task', 'hello'], { configPath: path });
  const setup = await runCompanion(['setup'], { configPath: path });
  await server.close();

  assert.equal(task.status, 1, 'the task must refuse whatever setup says it will do');
  assert.match(task.stderr, /Model "not-served" is not served here\. Available: other/);
  assert.equal(chatRequests(server).length, 0);
  // The invariant, asserted as one statement rather than two hopes.
  assert.match(setup.stdout, /cannot run here: Model "not-served" is not served here/);
});
