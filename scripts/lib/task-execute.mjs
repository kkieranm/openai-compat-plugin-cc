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
import { artifactFor } from './task-artifact.mjs';
import { NO_RATE_NOTE, estimateNote, estimateRun } from './eta.mjs';
import { readFileBlocks, readStdin } from './prompt.mjs';
import { attachRunContext, buildRunContext } from './run-context.mjs';
import { resolveTemplate } from './task-template.mjs';

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
 * The template this run uses, and the one pair of flags that cannot both apply.
 *
 * `--system` replaces the default system prompt wholesale and a template
 * supplies its own, so the two write one slot with nothing to arbitrate between
 * them. Refused rather than resolved by precedence: a silent winner means the
 * model was framed one way while the command line says another, which is this
 * repo's most-repeated defect — a reported state that does not describe what
 * will actually happen. A composition rule can be added later; changing a silent
 * winner afterwards could not.
 */
function templateFor(options) {
  if (options.template !== undefined && options.system !== undefined) {
    throw new UserError('--template and --system cannot be used together.', {
      hint: 'A template supplies its own system prompt. Drop --system, or drop --template and write the framing yourself.',
    });
  }
  return resolveTemplate(options.template);
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
function taskRequest({ profile, model, messages, numeric, sampling, ledger }) {
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
    // The validated vendor sampling params, applied to the body by
    // `chatCompletion` under their own wire names.
    sampling,
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
export async function prepareTask({ spec, options, inlinePrompt, terminated, sampling }) {
  const numeric = parseNumericOptions(options);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  if (profile.credentialWithheld) {
    process.stderr.write(
      `Note: "${profile.name}" has a credential, but --base-url points at a different endpoint, so it was not sent.\n`,
    );
  }
  const template = templateFor(options);
  const prompt = resolvePrompt(spec, options, inlinePrompt, terminated);
  const files = readFileBlocks(options.file);
  const { model, contextLength, contextSource, detectedWindow } = await resolveTarget(profile, options);
  // The server config this run resolved. Built once the target
  // resolves and carried on `prep` so `executeTask` can attach it to a later
  // throw and echo it on the outcome; the oversize refusal `prepareRequest` can
  // raise below is the post-resolution failure this function's own catch covers.
  const runContext = buildRunContext({ contextLength, contextSource, detectedWindow }, { sampling, temperature: numeric.temperature });

  try {
    const { messages, estimatedTokens, budget } = prepareRequest({
      profile,
      prompt,
      files,
      model,
      contextLength,
      maxTokens: numeric.maxTokens,
      // The whole skeleton goes here and nothing is wrapped around the user's
      // prompt. `requestTextOf` recovers "what this job was asked to do" from the
      // tail of the user message, and `/oai:status` shows its first line — so a
      // template prefixed to the prompt would replace the user's own request in
      // that summary with boilerplate identical on every templated job.
      system: template ? template.system : options.system,
    });

    return {
      numeric, profile, prompt, files, model, contextLength, messages, estimatedTokens, budget,
      // Carried onto `prep` so it reaches both the request (foreground) and
      // `persistRequest` (background), and the report echo.
      sampling,
      // The run context, carried onto `prep` for the outcome echo and the
      // attach at `executeTask`'s and `taskFlow`'s later throw sites. A background
      // submission ignores it (decision F): the worker records the fields null.
      runContext,
      // The NAME, not the resolved template: this is what crosses into persisted
      // state, and a queued job must not snapshot prose that the build reading it
      // back may have changed.
      template: template?.name,
    };
  } catch (error) {
    throw attachRunContext(error, runContext);
  }
}

/**
 * One run, start to finish. Everything above, and then the call.
 *
 * The seam matters beyond tidiness: `--background` needs exactly the first half
 * — the same profile, the same probe, the same window check, the same built
 * `messages` — and must then stop and persist rather than dispatch. Sharing the
 * preparation is what makes a backgrounded job provably the same request the
 * foreground one would have sent, instead of a second implementation that
 * resembles it.
 */
export async function executeTask(args) {
  const prep = await prepareTask(args);
  const { numeric, profile, files, model, messages, estimatedTokens, budget, template, sampling, runContext } = prep;

  // The WHOLE body after `prepareTask` returns, under one catch: a transport or
  // stream-watchdog failure from `chatCompletion`, or any outcome-assembly throw,
  // reaches `runTask` (sampling only) otherwise, so its `--json` failure envelope
  // would record null run context. `prepareTask`'s own throws carry its own
  // catch, so its call sitting outside this try is correct, not a gap.
  try {
    process.stderr.write(`Contacting ${profile.name} (${model}) with ${files.length} file(s), ~${estimatedTokens} tokens...\n`);

    // Before the wait, because that is the only moment it can change a decision:
    // prefill is silent and can be minutes, and the choice between waiting and
    // `--background` has to be made now. Nothing is printed when the provider
    // carries no measured rates — an invented figure would be worse than silence,
    // since the whole value of this line is that a reader can act on it.
    // Says which of the two it is. Silence would leave a reader unable to tell an
    // unmeasured provider from a run nobody thought to estimate — and NO_RATE_NOTE
    // exists precisely so every caller says that the same way.
    const estimate = estimateRun({ estimatedTokens, maxTokens: numeric.maxTokens, profile });
    process.stderr.write(`${estimate ? estimateNote(estimate) : NO_RATE_NOTE}\n`);

    const ledger = createLedger();
    const startedAt = Date.now();
    const request = taskRequest({ profile, model, messages, numeric, sampling, ledger });
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
      // Carried explicitly because this is a NEW object, not the prep: the notes a
      // template owes its reader are rendered from here, and a field left out is a
      // foreground run that silently prints none of them while the background path
      // prints them all.
      template,
      // What we sent, echoed on the success envelope by `jsonTaskReport`.
      sampling,
      // The run context, carried onto the outcome so `taskFlow`'s report-stage
      // catch can attach it and `jsonTaskReport` can echo it.
      runContext,
      // Computed HERE, beside every other fact about the run, so it survives onto a
      // persisted outcome and reaches `/oai:result`. The worker computes its own for
      // the same reason.
      artifact: artifactFor({ template, answer: result.content ?? '', cwd: process.cwd() }),
      durationMs: Date.now() - startedAt,
      ledger,
    };
  } catch (error) {
    throw attachRunContext(error, runContext);
  }
}
