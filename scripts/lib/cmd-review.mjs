import { assertNoFlagsInPrompt, parseCommandLine } from './args.mjs';
import { chatCompletion, requireAnswer } from './client.mjs';
import { loadConfig, resolveProfile } from './config.mjs';
import { parseNumericOptions, prepareRequest, resolveTarget, resolveTimeout } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { collectTarget } from './git-diff.mjs';
import { renderTaskFooter } from './render.mjs';
import { buildReviewPrompt, renderFindings, REVIEW_SYSTEM_PROMPT } from './review.mjs';
import { isFormatRejection, parseFindings, responseFormatFor, REVIEW_SCHEMA, schemaInstruction } from './structured.mjs';

const REVIEW_SPEC = {
  valueFlags: ['provider', 'base-url', 'model', 'base', 'commit', 'timeout', 'max-tokens', 'temperature'],
  booleanFlags: ['staged'],
  repeatableFlags: ['file'],
};

/**
 * Measured: five findings on a real 50 KB diff cost 724 completion tokens. This
 * leaves room for roughly 25 while still reserving under 8% of a 58k window.
 * It is deliberately not DEFAULT_RESERVE_TOKENS (1024) — a review that runs out
 * of tokens mid-JSON returns nothing usable (ADR 003).
 */
export const REVIEW_MAX_TOKENS = 4096;

/**
 * Ask for findings, degrading if the server will not take a schema.
 *
 * The retry is near-free: an unsupported `response_format` is a request
 * validation error, returned before any generation happens.
 */
async function requestFindings(profile, plan) {
  const { model, timeoutMs, temperature, reserve, contextLength, target, instructions } = plan;
  const prompt = buildReviewPrompt({ label: target.label, diff: target.diff, instructions });
  const shared = { profile, files: target.files, model, contextLength, maxTokens: reserve, system: REVIEW_SYSTEM_PROMPT };
  const send = { model, timeoutMs, temperature, maxTokens: reserve };

  const first = prepareRequest({ ...shared, prompt });
  try {
    const result = await chatCompletion(profile, {
      ...send,
      messages: first.messages,
      responseFormat: responseFormatFor(REVIEW_SCHEMA),
    });
    return { result, structured: true, ...first };
  } catch (error) {
    if (!isFormatRejection(error)) throw error;
    // Said out loud: a silent retry would hide a schema this plugin got wrong
    // just as well as it hides a server that cannot take one.
    process.stderr.write(`${profile.name} rejected response_format (${error.message}). Retrying without it.\n`);

    // The instruction has to fit the window too, so the guard runs again.
    const second = prepareRequest({ ...shared, prompt: `${prompt}\n\n${schemaInstruction(REVIEW_SCHEMA)}` });
    const result = await chatCompletion(profile, { ...send, messages: second.messages });
    return { result, structured: false, ...second };
  }
}

function reportFindings(parsed, { result, structured, profile, model, target }) {
  if (parsed) {
    process.stdout.write(renderFindings(parsed, { label: target.label, provider: profile.name, model }));
    return;
  }
  // A reply we cut off mid-object is a token-budget problem, not a shape
  // problem. Showing the fragment and calling it a bad shape blames the model
  // for damage we did, and hides the one flag that fixes it.
  if (result.finishReason === 'length') {
    throw new UserError(`${profile.name} ran out of tokens before it finished writing its findings.`, {
      hint: `Raise --max-tokens above the current ${REVIEW_MAX_TOKENS}, or review a smaller target.`,
    });
  }

  // Nothing parseable. Under a schema the reasoning channel carries the
  // constrained output, so it is legitimate to show; without one it is only the
  // model's scratchpad. Either way an empty reply falls through to
  // requireAnswer, which refuses — printing an empty "verbatim" block would
  // report a run that produced nothing as one that merely said something odd.
  const constrained = structured ? result.content.trim() || result.reasoning.trim() : '';
  const text = constrained || requireAnswer(result, profile).trim();
  process.stdout.write(
    `The model did not return findings in the requested shape. Its reply, verbatim:\n\n${text}\n\n` +
      'Nothing here has been checked against the code.',
  );
}

export async function runReview(argv) {
  const { options, prompt: instructions, terminated } = parseCommandLine(argv, REVIEW_SPEC);
  if (instructions && !terminated) assertNoFlagsInPrompt(instructions, REVIEW_SPEC);
  const { maxTokens, temperature, timeoutSeconds } = parseNumericOptions(options);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  if (profile.credentialWithheld) {
    process.stderr.write(
      `Note: "${profile.name}" has a credential, but --base-url points at a different host, so it was not sent.\n`,
    );
  }

  const target = await collectTarget(options);
  const { model, contextLength } = await resolveTarget(profile, options);
  const reserve = maxTokens ?? REVIEW_MAX_TOKENS;

  const startedAt = Date.now();
  process.stderr.write(`Reviewing ${target.label} with ${model} on ${profile.name}...\n`);

  const { result, structured, budget, estimatedTokens } = await requestFindings(profile, {
    model,
    contextLength,
    target,
    instructions,
    reserve,
    temperature,
    timeoutMs: resolveTimeout(profile, timeoutSeconds),
  });

  reportFindings(parseFindings(result, { structured }), { result, structured, profile, model, target });
  process.stdout.write(
    `${renderTaskFooter({
      providerName: profile.name,
      model: result.model,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      contextNote: budget.checked ? `~${estimatedTokens} tokens sent.` : budget.note,
      finishReason: result.finishReason,
    })}\n`,
  );
}
