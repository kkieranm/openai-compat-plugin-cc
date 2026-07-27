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

/** Async, for the same reason runCompanion is: sync spawn deadlocks the suite. */
export function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
      else resolve();
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
