import { parseCommandLine } from './args.mjs';
import { buildProfile, loadConfig, normalizeBaseUrl } from './config.mjs';
import { describeProvider } from './delegate.mjs';
import { UserError } from './errors.mjs';
import { effectiveWindow } from './model-info.mjs';
import { transportDetail } from './provider.mjs';
import { renderSetupReport } from './render.mjs';

/**
 * The most this report will ever show for a baseUrl that failed to build a
 * profile — never the raw string, which may carry a query-embedded credential.
 * `normalizeBaseUrl` is what the success path already uses to
 * split that query out before display; run it here too rather than falling
 * back to the untouched value. If the raw string isn't even a valid URL —
 * plausibly why `buildProfile` itself threw — there is nothing safe to show.
 */
function fallbackBaseUrl(rawProfile) {
  try {
    return normalizeBaseUrl(rawProfile?.baseUrl).baseUrl;
  } catch {
    return rawProfile?.baseUrl ? '(unparseable baseUrl)' : '(no baseUrl)';
  }
}

/**
 * setup is a report: one unusable profile must become a row with an error, not
 * abort the whole command. Profile construction can itself throw (bad baseUrl,
 * unset apiKeyEnv), so it happens inside the guard too.
 *
 * Exported for testing only — `runSetup` is the one real caller.
 */
export async function probeProvider(name, rawProfile) {
  let profile;
  try {
    profile = buildProfile(name, rawProfile);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    // `built: false` — nothing about this profile's credential was resolved, so
    // the report must not claim its key is missing.
    return { profile: { name, baseUrl: fallbackBaseUrl(rawProfile) }, rawProfile, models: [], error, built: false };
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
      // `/oai:setup` is unambiguously interactive — the operator's own
      // terminal, echoing their own config back to them — so it composes the
      // structured error fields into the message itself, the same as
      // `oai-companion.mjs`'s top-level catch does for every other command.
      const detail = transportDetail(error);
      const listUnavailable = detail ? `${error.message} (${detail})` : error.message;
      return { profile, rawProfile, built: true, models: [], described: null, listUnavailable };
    }
    return { profile, rawProfile, built: true, models: [], error };
  }
}

/** Never emit apiKey — only whether one is configured. */
function jsonRow({ profile, rawProfile, models, error, described, listUnavailable }) {
  // Derived from the same resolver the text report uses; computing it
  // separately is how the two views come to disagree about the same run.
  const resolved = effectiveWindow(profile, described);
  // No `transportDetail` composition on `error` (unlike `listUnavailable`
  // below): every error stored in this field is pre-response, carrying only
  // `.endpoint` — always `profile.baseUrl`, already reported on the `baseUrl`
  // field below. A `serverResponded` failure with real body detail always
  // takes the `listUnavailable` branch instead, which `listUnavailable` below
  // surfaces — `reachable` stays `true` in that case, since the server
  // genuinely answered.
  return {
    name: profile.name,
    baseUrl: profile.baseUrl,
    reachable: !error,
    error: error ? error.message : null,
    listUnavailable: listUnavailable ?? null,
    models,
    defaultModel: profile.defaultModel ?? null,
    contextLength: profile.contextLength ?? null,
    contextWindow: resolved.window ?? null,
    contextSource: resolved.source ?? null,
    detectedWindow: resolved.detected ?? null,
    // The model a task would use, or why it could not pick one — from the same
    // planner the text report and the task path use. The reason travels beside
    // it: the text report says the id was chosen because the server reports it
    // loaded, and a caveat true on one rendering may not be absent from the next.
    selectedModel: resolved.modelId ?? null,
    selectedModelReason: resolved.because ?? null,
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
