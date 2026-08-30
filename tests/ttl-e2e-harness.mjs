import { spawn } from 'node:child_process';
import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { completionFrames, respondStream, startFakeServer, tempDir, writeConfig } from './helpers.mjs';

/**
 * Scaffolding for the end-to-end harness: a stub `lms`, the repo's fake
 * server, a temp out-dir, and an async launch of the real driver.
 *
 * Split from the test file at the 300-line ratchet, and the seam matches
 * `helpers.mjs`: fixtures here, assertions there. Not a `.test.js` name, so the
 * runner does not treat it as a suite.
 *
 * Reading cannot substitute for executing a module whose job is to decide
 * something, so this harness actually runs the driver rather than just
 * inspecting its code.
 *
 * So: a stub `lms`, the repo's fake server, sub-second TTLs, a temp out-dir, and
 * assertions on the manifest the driver actually wrote.
 *
 * THE OUTER SPAWN MUST BE ASYNC. The fake server shares this process, so a
 * synchronous launch of the driver would block the event loop the server answers
 * on and deadlock until the client timeout — the repo's standing footgun, which
 * once cost a 204-second suite. The driver's OWN `execFileSync` calls to the stub
 * are fine: they block a child's event loop, not this one.
 */

const ROOT = new URL('..', import.meta.url).pathname;
const DRIVER = join(ROOT, 'bench', 'ttl-challenge.mjs');
const STUB = join(ROOT, 'tests', 'ttl-stub-lms.mjs');
chmodSync(STUB, 0o755);

const FINDINGS = JSON.stringify({
  analysis: 'walked each changed hunk',
  findings: [{ file: 'a.md', line: 1, severity: 'low', summary: 'a nit', evidence: 'x' }],
  summary: 'one nit',
});

// The challenge TTL is 200ms, so the exposure bar is 300ms and a first token at
// ~500ms clears it. Sub-second because the suite runs this on every commit; the
// shipped protocol is 120s against a ~335s prefill, and `protocol.canonical`
// records that these runs are not that.
//
// Episodes default to ONE. Every scenario below asserts on a single episode's
// classification; only the refutation test needs a sweep, because "all of them
// survived" is a statement about a set. Scenario COVERAGE is never traded for
// wall clock — timings and episode counts are.
const CHALLENGE_TTL_S = 0.2;
const PREFILL_MS = 500;

/**
 * A handler that answers the probes, then delays before streaming a reply.
 *
 * `failFromCall` starts failing at the Nth CHAT request, defaulting to never.
 * Calibration is call 1 and the challenge episodes follow, so failing from call 2
 * is how a scenario gets a cleared calibration and failing challenges. The first
 * run of this harness got that wrong — a handler that failed every request failed
 * the calibration too, and the sweep was (correctly) disqualified before a single
 * challenge episode ran.
 *
 * `replyDelayMs`/`replyDelayFromCall` change the reply delay from a given call, on
 * the same call-2-is-the-first-challenge convention as `failFromCall`. It exists
 * for the `no-exposure` verdict, which cannot be reached with one fixed delay:
 * calibration must CLEAR the exposure bar (prefill > challengeTtlMs × margin) to
 * license the sweep, while a `no-exposure` challenge episode must NOT clear the
 * SAME bar — so the calibration reply must be slow and the challenge reply fast.
 */
function delayedReply(delayMs, {
  failFromCall = Infinity, destroyFromCall = Infinity, replyDelayMs = null, replyDelayFromCall = Infinity,
} = {}) {
  let chatCalls = 0;
  return (request, response) => {
    if (!request.url.includes('/chat/completions')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ error: 'not found' }));
    }
    chatCalls += 1;
    // Destroyed BEFORE any headers, so no response was ever obtained — distinct
    // from a reply the client judged unusable, which is what `failFromCall` does.
    // Via the RESPONSE: `startFakeServer` hands the handler a reconstructed
    // request object (it buffers the body first), so `request.socket` is
    // undefined and reaching for it hangs the client until its 60s timeout.
    if (chatCalls >= destroyFromCall) return response.destroy();
    const shouldFail = chatCalls >= failFromCall;
    const thisDelay = replyDelayMs != null && chatCalls >= replyDelayFromCall ? replyDelayMs : delayMs;
    setTimeout(() => {
      // An empty completion — the shape that dominated the July failures, and one
      // the client judges unusable AFTER a response was obtained.
      if (shouldFail) respondStream(response, completionFrames('', { finishReason: 'unknown' }));
      else respondStream(response, completionFrames(FINDINGS));
    }, thisDelay);
    return undefined;
  };
}

function modelsHandler(inner) {
  return (request, response) => {
    if (request.url.endsWith('/models') && !request.url.includes('chat')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ data: [{ id: 'test-model', object: 'model' }] }));
    }
    return inner(request, response);
  };
}

/** Run the real driver to completion. Async spawn — see the header. */
function runDriver(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DRIVER, ...args], {
      cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * Stand up a stub `lms`, a fake server and a temp out-dir, then run the driver.
 *
 * `--out-dir` is not a convenience: a self-test writing into `bench/results/`
 * would recreate the junk-record incident the driver's own guard test exists to
 * prevent, and the junk would match the glob the done-condition reads.
 */
async function runScenario(scenario, {
  episodes = 1, failFromCall = Infinity, destroyFromCall = Infinity,
  replyDelayMs = null, replyDelayFromCall = Infinity, extraArgs = [],
} = {}) {
  const work = tempDir('ttl-e2e-');
  const scenarioPath = join(work, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify({ model: 'test-model', ...scenario }));
  const server = await startFakeServer(modelsHandler(delayedReply(PREFILL_MS, {
    failFromCall, destroyFromCall, replyDelayMs, replyDelayFromCall,
  })));
  const { path: configPath } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192 } },
  });
  const result = await runDriver([
    '--lms', STUB, '--model', 'test-model', '--case', 'docs-only', '--provider', 'local',
    '--provider-config', configPath, '--challenge-ttl', String(CHALLENGE_TTL_S),
    '--calibration-ttl', '60', '--episodes', String(episodes), '--sample-every-ms', '100',
    '--out-dir', work, '--timeout', '60', ...extraArgs,
  ], { TTL_STUB_SCENARIO: scenarioPath, TTL_STUB_STATE: join(work, 'state.json') });
  await server.close();
  const written = readdirSync(work).filter((name) => name.startsWith('ttl-challenge-'));
  const manifest = written.length ? JSON.parse(readFileSync(join(work, written[0]), 'utf8')) : null;
  return { result, manifest, written };
}


export { runScenario, runDriver, CHALLENGE_TTL_S, PREFILL_MS };
