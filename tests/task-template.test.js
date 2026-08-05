// Task templates: the named question, the reply shape, and the caveats printed
// with the answer.
//
// A separate file rather than lines in `tests/task.test.js`, which sits one line
// under the size ratchet's ceiling. The seam is real either way: that file tests
// what a task *run* does, and this one tests what a *template* adds to it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatRequests, completion, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { insertSynthetic, queueScenario, waitForState } from './job-helpers.mjs';
import { requestTextOf } from '../scripts/lib/prompt.mjs';
import { TEMPLATES } from '../scripts/lib/task-template.mjs';

const ADVISOR = TEMPLATES.advisor;

/** A server that answers one chat request, so a whole run can be observed. */
async function serverAnswering(text) {
  return startFakeServer((request, response) => {
    if (request.url.includes('/chat/completions')) return respondJson(response, completion(text));
    if (request.url.includes('/models')) return respondJson(response, { data: [{ id: 'small' }] });
    return respondJson(response, {}, 404);
  });
}

// `contextLength` is a parameter because the template's soft ceiling (8000) and
// the window are different limits that must be separable: a request meant to
// exceed the CEILING has to still fit the WINDOW, or the size check refuses it
// first and the caveat under test is never reached.
async function runTask(server, args, { contextLength = 8192 } = {}) {
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: `http://127.0.0.1:${server.port}/v1`, defaultModel: 'small', contextLength } },
  });
  return runCompanion(['task', ...args], { configPath: path });
}

test('--template advisor frames the SYSTEM message and leaves the request text untouched', async () => {
  // Through the real CLI on purpose. Asserting `buildMessages` directly would
  // pass even if `prepareTask` stopped using the system slot, which is exactly
  // the mutation this invariant exists to catch — the check has to be able to
  // fail for the reason it claims to guard.
  const server = await serverAnswering('STRONGEST OBJECTION: it will not work.');
  try {
    const result = await runTask(server, ['--template', 'advisor', 'I plan to move the queue check into the caller']);
    assert.equal(result.status, 0, result.stderr);

    const [sent] = chatRequests(server).map((request) => request.body);
    assert.equal(sent.messages[0].role, 'system');
    assert.match(sent.messages[0].content, /STRONGEST OBJECTION, ASSUMED WITHOUT EVIDENCE, WHAT I WOULD CHECK FIRST/);

    // The user message is the request and nothing else. `/oai:status` renders
    // `requestTextOf` of this, so a skeleton prefixed here would replace what
    // the user asked with boilerplate identical on every templated job.
    assert.equal(sent.messages[1].content, 'I plan to move the queue check into the caller');
    assert.equal(requestTextOf(sent.messages[1].content), 'I plan to move the queue check into the caller');
  } finally {
    await server.close();
  }
});

test('the skeleton stays out of the user message even when files are attached', async () => {
  const server = await serverAnswering('STRONGEST OBJECTION: none.');
  try {
    const result = await runTask(server, [
      '--template', 'advisor', '--file', 'scripts/lib/errors.mjs', 'I plan to delete UserError',
    ]);
    assert.equal(result.status, 0, result.stderr);

    const [sent] = chatRequests(server).map((request) => request.body);
    // The tail after the last file block is what `/oai:status` shows.
    assert.equal(requestTextOf(sent.messages[1].content), 'I plan to delete UserError');
    assert.doesNotMatch(sent.messages[1].content, /STRONGEST OBJECTION/);
  } finally {
    await server.close();
  }
});

test('a large templated foreground run prints the size caveat too', async () => {
  // `estimatedTokens` is as load-bearing on the outcome as `template` is: the
  // caveat is computed from it, and `executeTask` builds a FRESH object, so a
  // field dropped there is a caveat that silently never fires. The sibling
  // `template` field had a test; this one did not.
  const server = await serverAnswering('STRONGEST OBJECTION: too much at once.');
  const dir = mkdtempSync(join(tmpdir(), 'oai-big-'));
  const file = join(dir, 'big.txt');
  // Comfortably past the 8000-token ceiling at ~3.4 chars/token.
  writeFileSync(file, 'x'.repeat(40000));
  try {
    const result = await runTask(
      server,
      ['--template', 'advisor', '--file', file, 'I plan to rewrite this'],
      { contextLength: 65536 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /NOTE: this request was large/);
    assert.match(result.stdout, new RegExp(`ceiling of ${TEMPLATES.advisor.softCeilingTokens}`));
    assert.match(result.stdout, /unverified second opinion/);
  } finally {
    await server.close();
  }
});

test('a templated foreground run actually prints the discipline line', async () => {
  // The propagation `executeTask` needs: it builds a NEW outcome object, so a
  // template left out of it renders no notes at all while the background path
  // renders them. A unit test of the notes builder cannot see that.
  const server = await serverAnswering('STRONGEST OBJECTION: the lock is load-bearing.');
  try {
    const result = await runTask(server, ['--template', 'advisor', 'I plan to drop the lock']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /unverified second opinion from a small local model/);
    assert.match(result.stdout, /Check each objection against the code before anyone acts on it/);
  } finally {
    await server.close();
  }
});

test('an ordinary task prints no template notes at all', async () => {
  const server = await serverAnswering('It defines UserError.');
  try {
    const result = await runTask(server, ['what does this define?']);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /unverified second opinion/);
    assert.doesNotMatch(result.stdout, /NOTE: this request was large/);
  } finally {
    await server.close();
  }
});

test('/oai:result carries the same discipline line the foreground rendering does', async () => {
  // Instance 16 in `.claude/REPO_TRAPS.md`: a second rendering of one run that
  // drops a caveat the first carried — which this repo produced *inside* the
  // module written to prevent it. Driven through a real background job and a
  // real worker process, so what is asserted is what a reader actually sees.
  const scenario = await queueScenario();
  try {
    const submit = await scenario.submit(['--template', 'advisor']);
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();
    await waitForState(scenario.state, id, ['completed', 'failed']);

    const result = await scenario.run(['result', id]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /unverified second opinion from a small local model/);
    assert.match(result.stdout, /Check each objection against the code before anyone acts on it/);
  } finally {
    await scenario.server.close();
  }
});

test('/oai:result renders the SIZE caveat from the frozen request, not just the discipline line', async () => {
  // The distinguishing assertion this suite lacked. `/oai:result` reads
  // `job.request.estimatedTokens` across a JSON round trip and a process
  // boundary, and the existing test submitted a small prompt — so pointing that
  // read at a field that does not exist left all 560 tests green. The size caveat
  // is the half that can only come from the persisted request.
  // Seeded rather than submitted: a request that exceeds the template's 8000
  // ceiling cannot also fit an 8k window, so driving this through a real
  // submission would be refused by the size guard before it ever persisted.
  // What is under test is the READ of the frozen request, which a seeded row
  // exercises exactly.
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'bigtmpl1',
      state: 'completed',
      request: { messages: [{ role: 'user', content: 'a plan' }], template: 'advisor', estimatedTokens: 12000 },
      outcome: { content: 'STRONGEST OBJECTION: none.', model: 'test-model', durationMs: 10 },
    });

    const result = await scenario.run(['result', 'bigtmpl1']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /NOTE: this request was large/);
    assert.match(result.stdout, new RegExp(`ceiling of ${ADVISOR.softCeilingTokens}`));
    // And it must NOT claim the size went unrecorded — that is the note a wrong
    // field read produces, and it is a lie about a figure the row actually holds.
    assert.doesNotMatch(result.stdout, /size of this request was not recorded/);
  } finally {
    await scenario.server.close();
  }
});

test('an untemplated background job prints no notes on collection either', async () => {
  const scenario = await queueScenario();
  try {
    const submit = await scenario.submit();
    const id = submit.stdout.trim();
    await waitForState(scenario.state, id, ['completed', 'failed']);

    const result = await scenario.run(['result', id]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /unverified second opinion/);
  } finally {
    await scenario.server.close();
  }
});

test('--template and --system refuse together, naming both flags', async () => {
  const server = await serverAnswering('unused');
  try {
    const result = await runTask(server, ['--template', 'advisor', '--system', 'be terse', 'a plan']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--template and --system cannot be used together/);
  } finally {
    await server.close();
  }
});

test('an unknown template names the ones that exist', async () => {
  const server = await serverAnswering('unused');
  try {
    const result = await runTask(server, ['--template', 'advisorr', 'a plan']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown --template "advisorr"/);
    assert.match(result.stderr, /Known templates: advisor/);
  } finally {
    await server.close();
  }
});
