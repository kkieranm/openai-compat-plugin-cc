import { parseCommandLine } from './args.mjs';
import { buildProfile, loadConfig } from './config.mjs';
import { describeProvider } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { effectiveWindow } from './model-info.mjs';
import { renderSetupReport } from './render.mjs';

/**
 * setup is a report: one unusable profile must become a row with an error, not
 * abort the whole command. Profile construction can itself throw (bad baseUrl,
 * unset apiKeyEnv), so it happens inside the guard too.
 */
async function probeProvider(name, rawProfile) {
  let profile;
  try {
    profile = buildProfile(name, rawProfile);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    // `built: false` — nothing about this profile's credential was resolved, so
    // the report must not claim its key is missing.
    return { profile: { name, baseUrl: rawProfile?.baseUrl ?? '(no baseUrl)' }, rawProfile, models: [], error, built: false };
  }

  try {
    const described = await describeProvider(profile);
    return { profile, rawProfile, built: true, models: described.models.map((model) => model.id), described };
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    // A server that answers but does not serve /v1/models is up, and a task
    // with a configured model still runs against it. Reporting that as
    // unreachable would tell the user to restart a server that is working.
    if (error.serverResponded) {
      return { profile, rawProfile, built: true, models: [], described: null, listUnavailable: error.message };
    }
    return { profile, rawProfile, built: true, models: [], error };
  }
}

/** Never emit apiKey — only whether one is configured. */
function jsonRow({ profile, rawProfile, models, error, described }) {
  // Derived from the same resolver the text report uses; computing it
  // separately is how the two views come to disagree about the same run.
  const resolved = effectiveWindow(profile, described);
  return {
    name: profile.name,
    baseUrl: profile.baseUrl,
    reachable: !error,
    error: error ? error.message : null,
    models,
    defaultModel: profile.defaultModel ?? null,
    contextLength: profile.contextLength ?? null,
    contextWindow: resolved.window ?? null,
    contextSource: resolved.source ?? null,
    detectedWindow: resolved.detected ?? null,
    // The model a task would use, or why it could not pick one — from the same
    // planner the text report and the task path use.
    selectedModel: resolved.modelId ?? null,
    cannotDelegate: resolved.problem?.message ?? null,
    hasApiKey: Boolean(profile.apiKey),
    apiKeyEnv: rawProfile?.apiKeyEnv ?? null,
  };
}

// Exported for the same reason as TASK_SPEC and REVIEW_SPEC: a test proves
// every flag here is documented in `commands/setup.md`.
export const SETUP_SPEC = { booleanFlags: ['json'] };

export async function runSetup(argv) {
  const { options } = parseCommandLine(argv, SETUP_SPEC);
  const { path, config, created } = loadConfig();
  const results = await Promise.all(
    Object.entries(config.providers).map(([name, rawProfile]) => probeProvider(name, rawProfile)),
  );

  if (options.json) {
    const providers = results.map(jsonRow);
    process.stdout.write(
      `${JSON.stringify({ configPath: path, created, defaultProvider: config.defaultProvider, providers }, null, 2)}\n`,
    );
    return;
  }

  process.stdout.write(`${renderSetupReport({ configPath: path, created, results, defaultProvider: config.defaultProvider })}\n`);
}
