import { readFileSync } from 'node:fs';
import { assertNoFlagsInPrompt, parseCommandLine } from './args.mjs';
import { chatCompletion, requireAnswer } from './client.mjs';
import { loadConfig, resolveProfile } from './config.mjs';
import { parseNumericOptions, prepareRequest, resolveTarget, resolveTimeout } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { readFileBlocks, readStdin } from './prompt.mjs';
import { renderTaskFooter } from './render.mjs';

export const TASK_SPEC = {
  valueFlags: ['provider', 'base-url', 'model', 'prompt-file', 'system', 'timeout', 'max-tokens', 'temperature'],
  repeatableFlags: ['file'],
};

function resolvePrompt(options, inlinePrompt, terminated) {
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
    if (!terminated) assertNoFlagsInPrompt(inline, TASK_SPEC);
    return inline;
  }
  const piped = process.stdin.isTTY ? '' : readStdin().trim();
  if (piped) return piped;
  throw new UserError('No prompt given.', {
    hint: 'Pass the request as text, or use --prompt-file <path> for multi-line prompts.',
  });
}

export async function runTask(argv) {
  const { options, prompt: inlinePrompt, terminated } = parseCommandLine(argv, TASK_SPEC);
  const { maxTokens, temperature, timeoutSeconds } = parseNumericOptions(options);

  const { config } = loadConfig();
  const profile = resolveProfile(config, { provider: options.provider, baseUrl: options['base-url'] });
  if (profile.credentialWithheld) {
    process.stderr.write(
      `Note: "${profile.name}" has a credential, but --base-url points at a different host, so it was not sent.\n`,
    );
  }
  const prompt = resolvePrompt(options, inlinePrompt, terminated);
  const files = readFileBlocks(options.file);
  const { model, contextLength } = await resolveTarget(profile, options);

  const { messages, estimatedTokens, budget } = prepareRequest({
    profile,
    prompt,
    files,
    model,
    contextLength,
    maxTokens,
    system: options.system,
  });

  // Non-streaming against a slow local model looks like a hang without this.
  process.stderr.write(`Contacting ${profile.name} (${model}) with ${files.length} file(s), ~${estimatedTokens} tokens...\n`);

  const startedAt = Date.now();
  const result = await chatCompletion(profile, {
    model,
    messages,
    timeoutMs: resolveTimeout(profile, timeoutSeconds),
    temperature,
    maxTokens,
  });

  // Fails loudly rather than printing nothing: an empty answer with a footer
  // reads as a successful run that had nothing to say.
  process.stdout.write(requireAnswer(result, profile).trim());
  process.stdout.write(
    `${renderTaskFooter({
      providerName: profile.name,
      model: result.model,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      contextNote: budget.checked ? null : budget.note,
      finishReason: result.finishReason,
    })}\n`,
  );
}
