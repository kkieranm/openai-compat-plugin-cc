// `/oai:task --json`: one run as one object, and the refusals it must keep.
//
// The envelope exists so a harness can drive the real command instead of parsing
// its prose — `bench/run.mjs` states why for the review side: a harness that
// reimplemented the request would measure a reimplementation and report the
// number as the command's. These tests pin the two things that make the envelope
// trustworthy rather than merely present: that every caveat the text rendering
// carries is in it, and that a run with nothing to say still fails.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completion, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { templateNotes } from '../scripts/lib/task-template.mjs';

async function serverAnswering(text, { status = 200 } = {}) {
  return startFakeServer((request, response) => {
    if (request.url.includes('/chat/completions')) {
      if (status !== 200) return respondJson(response, { error: { message: 'the model is on fire' } }, status);
      return respondJson(response, completion(text));
    }
    if (request.url.includes('/models')) return respondJson(response, { data: [{ id: 'small' }] });
    return respondJson(response, {}, 404);
  });
}

async function runTask(server, args, { contextLength = 8192 } = {}) {
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: `http://127.0.0.1:${server.port}/v1`, defaultModel: 'small', contextLength } },
  });
  return runCompanion(['task', ...args], { configPath: path });
}

test('--json emits one parseable object carrying the run identity and the answer', async () => {
  const server = await serverAnswering('the answer');
  try {
    const result = await runTask(server, ['--json', 'a question']);
    assert.equal(result.status, 0, result.stderr);

    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.content, 'the answer');
    assert.equal(envelope.provider, 'local');
    // Both halves of the model fact, for the reason the review envelope gives:
    // a server can answer from a build nobody asked for.
    assert.equal(envelope.requestedModel, 'small');
    assert.ok('model' in envelope);
    assert.equal(typeof envelope.durationMs, 'number');
    assert.ok('finishReason' in envelope && 'usage' in envelope);
    // The observed reasoning witness the review envelope also carries. This
    // reply reports no reasoning_tokens, so it is `unknown` — but present, and
    // the same `{ state, tokens }` shape.
    assert.deepEqual(envelope.reasoning, { state: 'unknown', tokens: null });
  } finally {
    await server.close();
  }
});

test('the envelope carries the SAME template notes the text rendering prints', async () => {
  // Instance 16 on a new path. The text rendering prints the template's caveats
  // under the footer; an envelope without them would hand a harness a crowded
  // advisor reply with no indication it was crowded — and a harness is the
  // reader least able to notice.
  const server = await serverAnswering('STRONGEST OBJECTION: none.');
  try {
    const result = await runTask(server, ['--json', '--template', 'advisor', 'a plan']);
    assert.equal(result.status, 0, result.stderr);

    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.template, 'advisor');
    assert.deepEqual(envelope.notes, templateNotes({ name: 'advisor', estimatedTokens: envelope.estimatedTokens }));
    assert.ok(envelope.notes.length >= 1, 'a templated run always owes its reader the discipline line');
    assert.match(envelope.notes.at(-1), /unverified second opinion/);
  } finally {
    await server.close();
  }
});

test('notes is an ARRAY, so no delimiter inside a note can forge an entry', async () => {
  const server = await serverAnswering('answer');
  try {
    const result = await runTask(server, ['--json', '--template', 'advisor', 'a plan']);
    const envelope = JSON.parse(result.stdout);
    assert.ok(Array.isArray(envelope.notes));
    // An untemplated run carries none, and must not carry an empty string.
    const plain = JSON.parse((await runTask(server, ['--json', 'a question'])).stdout);
    assert.deepEqual(plain.notes, []);
    assert.equal(plain.template, null);
  } finally {
    await server.close();
  }
});

test('the size figures say whether the guard was armed, not just a bare number', async () => {
  const server = await serverAnswering('answer');
  try {
    const checked = JSON.parse((await runTask(server, ['--json', 'a question'])).stdout);
    assert.equal(checked.contextChecked, true);
    assert.equal(checked.contextNote, null);
    assert.equal(typeof checked.estimatedTokens, 'number');

    // With no configured window the guard never runs, and a reader must be able
    // to tell that from a number that was checked and passed.
    const { path } = writeConfig({
      defaultProvider: 'local',
      providers: { local: { baseUrl: `http://127.0.0.1:${server.port}/v1`, defaultModel: 'small' } },
    });
    const unarmed = JSON.parse((await runCompanion(['task', '--json', 'q'], { configPath: path })).stdout);
    assert.equal(unarmed.contextChecked, false);
    assert.match(unarmed.contextNote, /Context window unknown/);
  } finally {
    await server.close();
  }
});

test('an empty answer is REFUSED under --json, never returned as empty content', async () => {
  // The rule `/oai:result` states: "no output, exit 0" is indistinguishable from
  // a model that had nothing to say. An envelope makes that worse, not better —
  // `content: ""` looks like a successful run to anything counting rows.
  const server = await serverAnswering('');
  try {
    const result = await runTask(server, ['--json', 'a question']);
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    assert.ok(!('content' in envelope), 'a refused run has no answer to report');
    assert.match(result.stderr, /\S/, 'the prose failure path is unchanged');
  } finally {
    await server.close();
  }
});

test('a failed run is machine-readable too, and still exits nonzero', async () => {
  // Without this, --json is JSON on success and prose on failure, which is the
  // half-contract a harness cannot consume — and a run that dies is the run
  // carrying the most evidence.
  const server = await serverAnswering('unused', { status: 500 });
  try {
    const result = await runTask(server, ['--json', '--max-attempts', '1', 'a question']);
    assert.notEqual(result.status, 0);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    assert.equal(typeof envelope.message, 'string');
    assert.ok('reason' in envelope && 'attempts' in envelope && 'requestedModel' in envelope);
    // The task failure path reuses the shared review errorReport, so it carries
    // the reasoning witness too — `unknown`, since no throw site sets `error.usage`.
    assert.deepEqual(envelope.reasoning, { state: 'unknown', tokens: null });
  } finally {
    await server.close();
  }
});

test('a server naming no model is RECORDED as not having named one', async () => {
  // A fallback to the requested id would make `model === requestedModel` read as
  // "checked, they matched" where nothing was determined — and a benchmark
  // attributes runs to models, so that is a number credited to the wrong build.
  const server = await startFakeServer((request, response) => {
    if (request.url.includes('/chat/completions')) {
      return respondJson(response, { choices: [{ message: { content: 'an answer' }, finish_reason: 'stop' }] });
    }
    if (request.url.includes('/models')) return respondJson(response, { data: [{ id: 'small' }] });
    return respondJson(response, {}, 404);
  });
  try {
    const silent = JSON.parse((await runTask(server, ['--json', 'q'])).stdout);
    // `model` still echoes the requested id — `completion.mjs` collapses them on
    // purpose, so a substitution nothing observed cannot be reported. What must
    // NOT happen is that collapse being invisible.
    assert.equal(silent.model, 'small');
    assert.equal(silent.requestedModel, 'small');
    assert.equal(silent.modelReported, false, 'the server named nothing, and the record must say so');
  } finally {
    await server.close();
  }
});

test('a server that DOES name a model is distinguishable from one that stays silent', async () => {
  // The other half: without this, `modelReported: false` could be hard-coded and
  // the test above would still pass.
  const server = await serverAnswering('an answer');
  try {
    const named = JSON.parse((await runTask(server, ['--json', 'q'])).stdout);
    assert.equal(named.modelReported, true);
    assert.equal(named.model, 'test-model');
  } finally {
    await server.close();
  }
});

test('a PRE-REQUEST failure is JSON too, not prose', async () => {
  // The failures a harness is likeliest to cause are the earliest ones. An
  // unknown template never reaches the server, and a mistyped flag never reaches
  // the parser's caller.
  const server = await serverAnswering('unused');
  try {
    const unknown = await runTask(server, ['--json', '--template', 'nope', 'q']);
    assert.equal(unknown.status, 1);
    assert.equal(JSON.parse(unknown.stdout).error, true);

    const conflict = await runTask(server, ['--json', '--template', 'advisor', '--system', 's', 'q']);
    assert.equal(conflict.status, 1);
    assert.match(JSON.parse(conflict.stdout).message, /--template and --system/);

    // A flag the parser rejects outright — thrown before any option object exists.
    const bogus = await runTask(server, ['--json', '--nonsense', 'x', 'q']);
    assert.equal(bogus.status, 1);
    assert.equal(JSON.parse(bogus.stdout).error, true);
  } finally {
    await server.close();
  }
});

test('retry state is read from attempts, not duplicated beside it', async () => {
  const server = await serverAnswering('an answer');
  try {
    const envelope = JSON.parse((await runTask(server, ['--json', 'q'])).stdout);
    assert.ok(!('retried' in envelope), 'a second source for a fact attempts already holds');
    assert.ok(Array.isArray(envelope.attempts));
  } finally {
    await server.close();
  }
});

test('an ordinary run without --json is byte-for-byte what it always was', async () => {
  const server = await serverAnswering('the answer');
  try {
    const result = await runTask(server, ['a question']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^the answer/);
    assert.doesNotMatch(result.stdout, /^\{/, 'the human path never emits an envelope');
    assert.match(result.stdout, /provider: local/);
  } finally {
    await server.close();
  }
});
