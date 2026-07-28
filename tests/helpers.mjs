import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const COMPANION = new URL('../scripts/oai-companion.mjs', import.meta.url).pathname;

/**
 * An in-process OpenAI-compatible server. `handler(request, response)` decides
 * each reply; every request is recorded so tests can assert on what was sent.
 */
export async function startFakeServer(handler) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const record = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: body ? JSON.parse(body) : null,
      };
      requests.push(record);
      handler(record, response);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Reply helpers for the common shapes. */
export function respondJson(response, payload, status = 200) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body);
}

export function modelList(...ids) {
  return { object: 'list', data: ids.map((id) => ({ id, object: 'model' })) };
}

export function completion(content, extra = {}) {
  return {
    id: 'chatcmpl-test',
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    ...extra,
  };
}

/**
 * A completion whose text arrived in the reasoning channel with `content`
 * empty — what every schema-constrained reply from a reasoning model looks
 * like (ADR 003).
 */
export function reasoningCompletion(reasoning, extra = {}) {
  return {
    id: 'chatcmpl-test',
    model: 'test-model',
    choices: [
      { index: 0, message: { role: 'assistant', content: '', reasoning_content: reasoning }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    ...extra,
  };
}

/**
 * Reply as an SSE stream, one frame per element, then close.
 *
 * Deliberately the same shape as respondJson, so a suite moves between the
 * streaming path and the JSON degrade by changing one call. `done: false`
 * reproduces a server that closes without ever sending [DONE].
 */
export function respondStream(response, frames, { done = true } = {}) {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
  for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`);
  if (done) response.write('data: [DONE]\n\n');
  response.end();
}

/** One `chat.completion.chunk`, the frame every streaming server sends. */
export function deltaFrame(delta, extra = {}) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: null }],
    ...extra,
  };
}

/**
 * The frames a streaming server sends for `completion(content)` — same model,
 * same finish_reason, same usage figures, so a suite that switches to
 * respondStream keeps its footer assertions untouched.
 *
 * The text is split across two frames on purpose: one frame per completion
 * leaves the accumulator's join untested, and a delta whose leading space was
 * trimmed is invisible unless a word boundary lands on the seam. The opening
 * frame carries `content: null`, which is what a real server sends and what
 * must not count as "saw this channel".
 */
export function completionFrames(text, { channel = 'content', usage = true, finishReason = 'stop' } = {}) {
  const key = channel === 'reasoning' ? 'reasoning_content' : 'content';
  const seam = Math.ceil(text.length / 2);
  return [
    deltaFrame({ role: 'assistant', content: null }),
    deltaFrame({ [key]: text.slice(0, seam) }),
    deltaFrame({ [key]: text.slice(seam) }),
    { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
    // What `stream_options: { include_usage: true }` buys, and the shape that
    // breaks any accumulator indexing choices[0]: `choices` is empty here, and
    // finish_reason arrived on the frame before it.
    ...(usage
      ? [
          {
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            model: 'test-model',
            choices: [],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
          },
        ]
      : []),
  ];
}

/**
 * The streaming twin of reasoningCompletion: the whole reply in the reasoning
 * channel with `content` never appearing in any delta (ADR 003).
 */
export function reasoningFrames(reasoning, options = {}) {
  return completionFrames(reasoning, { ...options, channel: 'reasoning' });
}

/**
 * Async, for the same reason runCompanion is: sync spawn deadlocks the suite.
 * Resolves the command's stdout, so a test can assert on what git *said* and
 * not merely that it exited zero — callers that only sequence commands ignore
 * the value.
 */
export function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
      else resolve(stdout);
    });
  });
}

/** A throwaway repository with one commit, so HEAD exists. */
export async function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-repo-'));
  await git(['init', '--quiet', '--initial-branch=main'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  await git(['add', 'seed.txt'], dir);
  await git(['commit', '--quiet', '-m', 'seed'], dir);
  return dir;
}

/** A port that is guaranteed to refuse connections. */
export async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Write a throwaway config and return its path. */
export function writeConfig(config) {
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-test-'));
  const path = join(dir, 'providers.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  return { dir, path };
}

/**
 * Must be async: the fake server shares this process, so a synchronous spawn
 * would block the event loop and deadlock against the child's own request.
 * stdin is /dev/null so the companion never blocks waiting for piped input.
 */
export function runCompanion(args, { configPath, env = {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COMPANION, ...args], {
      cwd,
      env: { ...process.env, OAI_PLUGIN_CONFIG: configPath, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * A repo with one uncommitted edit and a config that needs no probing — the
 * starting point for every `/oai:review` end-to-end test. Shared so the review
 * suites cannot drift apart on what "a reviewable repo" means.
 */
export async function reviewScenario(handler, { contextLength = 8192, seed = 'seed\nedited\n' } = {}) {
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), seed);
  const server = await startFakeServer(handler);
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength } },
  });
  return { dir, server, configPath: path };
}

/**
 * The `analysis` ceiling the request actually carried.
 *
 * Read off the wire rather than imported, because the cap is derived per run
 * from the reply budget granted — so a test that imported a constant would pass
 * whenever the two happened to agree, which is precisely the coincidence the
 * derivation removes. A reply built to this length is cut by definition.
 */
export function sentAnalysisCap(record) {
  return record.body?.response_format?.json_schema?.schema?.properties?.analysis?.maxLength ?? null;
}

/** The chat requests a fake server received, in order. */
export function chatRequests(server) {
  return server.requests.filter((request) => request.url.includes('/chat/completions'));
}
