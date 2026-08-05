// What one `/oai:task` run *is*: which provider answers, which model, what text
// and files it is asked about, and the budgets the answer runs under.
//
// Split from cmd-task.mjs, which is now only the command line, on the same seam
// `/oai:review` already uses. This one RETURNS the finished run instead of
// printing it, so `task-report.mjs` is the only place a task becomes stdout and
// a second rendering can be added there without this file learning there is
// more than one.
import { readFileSync } from 'node:fs';
import { assertNoFlagsInPrompt } from './args.mjs';
import { createLedger } from './attempt-ledger.mjs';
import { chatCompletion } from './client.mjs';
import { loadConfig, resolveProfile } from './config.mjs';
import { parseNumericOptions, prepareRequest, resolveIdle, resolveMax, resolveRetryDelay, resolveTarget, resolveTimeout } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { withProgress } from './progress.mjs';
import { readFileBlocks, readStdin } from './prompt.mjs';

/**
 * Which of the three ways of giving a request is the request.
 *
 * Takes the flag spec rather than importing it: the spec is the command's own
 * surface and stays exported from `cmd-task.mjs`, where `tests/plugin.test.js`
 * reads it against `commands/task.md`, and importing it back from here would
 * make the pair circular for one array of strings.
 */
function resolvePrompt(spec, options, inlinePrompt, terminated) {
  const inline = inlinePrompt.trim();

  if (options['prompt-file']) {
    // Silently preferring one over the other loses half the request.
    if (inline) {
      throw new UserError(`--prompt-file was given alongside request text ("${inline.slice(0, 60)}").`, {
        hint: 'Pass one or the other, so it is unambiguous which text is the request.',
      });
    }
    try {
      return readFileSync(options['prompt-file'], 'utf8').trim();
    } catch (error) {
      throw new UserError(`Could not read --prompt-file ${options['prompt-file']}: ${error.message}`);
    }
  }

  if (inline) {
    // After an explicit `--` the flag region is closed by the user's own
    // instruction, so a flag-looking word is plainly part of the request.
    if (!terminated) assertNoFlagsInPrompt(inline, spec);
    return inline;
  }
  const piped = process.stdin.isTTY ? '' : readStdin().trim();
  if (piped) return piped;
  throw new UserError('No prompt given.', {
    hint: 'Pass the request as text, or use --prompt-file <path> for multi-line prompts.',
  });
}

/**
 * The request, assembled on the way into the call and nowhere earlier.
 *
 * Lifted out of `executeTask` at the function size budget, and the seam is the
 * clock: `expiresAt` is an instant, not a duration, so every statement between
 * minting it and dispatching is time the caller's cap has already spent.
 * Resolving the target probes the server — building this beside that lookup
 * would quietly bill a cold `/v1/models` round trip to the answer's budget.
 */
function taskRequest({ profile, model, messages, numeric, ledger }) {
  const { maxTokens, temperature, timeoutSeconds, maxSeconds, maxAttempts } = numeric;
  const maxMs = resolveMax(profile, maxSeconds);
  return {
    model,
    messages,
    timeoutMs: resolveTimeout(profile, timeoutSeconds),
    idleMs: resolveIdle(profile),
    retryDelayMs: resolveRetryDelay(profile),
    // One instant for the whole answer, minted at the last moment before the
    // call: chat.mjs's capability ladder can retry this request, and a
    // duration would give each retry the whole cap over again.
    expiresAt: maxMs === undefined ? undefined : performance.now() + maxMs,
    maxMs,
    temperature,
    maxTokens,
    maxAttempts,
    // One ledger for the whole command, so every physical request this answer
    // costs lands in one record with continuous indexes.
    ledger,
  };
}

/**
 * One run, start to finish, as an object a renderer can read.
 *
 * The refusals stay in the order they were written in: the numeric flags are
 * validated before anything is loaded, and the prompt is resolved only once the
 * profile exists. That order is behaviour — with a broken config, the piped
 * form of this command exits on the config rather than blocking on a stdin that
 * will never be read.
 *
 * stderr is not the seam this file avoids: progress and the credential note are
 * facts about a run in flight, and belong to whoever is running it. stdout is,
 * because that is the rendering.
 */
export async function executeTask({ spec, options, inlinePrompt, terminated }) {
  const numeric = parseNumericOptions(options);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  if (profile.credentialWithheld) {
    process.stderr.write(
      `Note: "${profile.name}" has a credential, but --base-url points at a different host, so it was not sent.\n`,
    );
  }
  const prompt = resolvePrompt(spec, options, inlinePrompt, terminated);
  const files = readFileBlocks(options.file);
  const { model, contextLength } = await resolveTarget(profile, options);

  const { messages, estimatedTokens, budget } = prepareRequest({
    profile,
    prompt,
    files,
    model,
    contextLength,
    maxTokens: numeric.maxTokens,
    system: options.system,
  });

  process.stderr.write(`Contacting ${profile.name} (${model}) with ${files.length} file(s), ~${estimatedTokens} tokens...\n`);

  const ledger = createLedger();
  const startedAt = Date.now();
  const request = taskRequest({ profile, model, messages, numeric, ledger });
  const result = await withProgress((onProgress) => chatCompletion(profile, { ...request, onProgress }));

  return {
    result,
    profile,
    // What was ASKED for, beside the reply that says what answered. The footer
    // prefers the served id; a renderer that has only that one names nothing
    // when a reply carries no model, which is the fallback `review-report.mjs`
    // spells `result.model || model`.
    model,
    budget,
    estimatedTokens,
    durationMs: Date.now() - startedAt,
    ledger,
  };
}
