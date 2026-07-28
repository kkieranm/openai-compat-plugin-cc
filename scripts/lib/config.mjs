import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { UserError } from './errors.mjs';

// Seeded on first run. These ports are the documented defaults for each server
// but are NOT verified facts — `setup` prints the config path so they can be
// corrected when a server listens elsewhere.
export const DEFAULT_CONFIG = {
  defaultProvider: 'lmstudio',
  providers: {
    lmstudio: { baseUrl: 'http://localhost:1234/v1' },
    omlx: { baseUrl: 'http://localhost:8000/v1' },
    unsloth: { baseUrl: 'http://localhost:8888/v1' },
  },
};

// Presentation-only remediation text, keyed by the seeded profile names.
// Nothing in the request path branches on provider identity.
export const START_HINTS = {
  lmstudio: 'Start LM Studio, then Developer > Start Server (or `lms server start`).',
  omlx: 'Start the oMLX server (menu bar app, or `omlx serve`).',
  unsloth: 'Start Unsloth Studio and enable its OpenAI-compatible endpoint.',
};

export function configPath() {
  if (process.env.OAI_PLUGIN_CONFIG) return process.env.OAI_PLUGIN_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'oai-plugin', 'providers.json');
}

/** Read the config, seeding it with defaults the first time. */
export function loadConfig() {
  const path = configPath();
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    return { path, config: structuredClone(DEFAULT_CONFIG), created: true };
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new UserError(`Config at ${path} is not valid JSON: ${error.message}`, {
      hint: 'Fix the file, or delete it to have the defaults written back.',
    });
  }
  validateConfig(config, path);
  return { path, config, created: false };
}

function validateConfig(config, path) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new UserError(`Config at ${path} must be a JSON object.`);
  }
  const { providers } = config;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new UserError(`Config at ${path} needs a "providers" object.`);
  }
  for (const [name, profile] of Object.entries(providers)) {
    if (!profile || typeof profile.baseUrl !== 'string' || !profile.baseUrl) {
      throw new UserError(`Provider "${name}" in ${path} needs a "baseUrl" string.`);
    }
    // "8k" would sail through every comparison in the size guard as NaN,
    // leaving it reporting an armed check that in fact tests nothing.
    for (const key of ['contextLength', 'timeoutSeconds', 'idleSeconds']) {
      const value = profile[key];
      if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
        throw new UserError(`Provider "${name}" in ${path} has "${key}": ${JSON.stringify(value)} — expected a positive whole number.`);
      }
    }
  }
}

/**
 * Turn a raw base URL into one we can append `/models` to. A URL with no path
 * gets `/v1`, since that is where OpenAI-compatible servers mount by default.
 */
export function normalizeBaseUrl(raw) {
  const hint = 'Expected something like http://localhost:1234/v1';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UserError(`"${raw}" is not a valid URL.`, { hint });
  }
  // "localhost:1234" parses as a URL with scheme "localhost:" and a null
  // origin, which would silently build nonsense request URLs.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserError(`"${raw}" is not a valid http(s) URL.`, { hint });
  }
  // Credentials in the URL would be dropped when we rebuild it below, and a
  // silently unauthenticated request is worse than a refusal.
  if (url.username || url.password) {
    throw new UserError(`"${raw}" embeds credentials in the URL, which this plugin does not forward.`, {
      hint: 'Put the key in the profile\'s "apiKeyEnv" (preferred) or "apiKey" instead.',
    });
  }
  const path = url.pathname.replace(/\/+$/, '');
  // The query is kept separate because request paths are appended to baseUrl;
  // folding it in would produce ".../v1?api-version=2024/models".
  return { baseUrl: `${url.origin}${path === '' ? '/v1' : path}`, query: url.search };
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Resolve the API key without ever returning it to display code. */
function resolveApiKey(profile, name) {
  if (profile.apiKeyEnv) {
    const key = process.env[profile.apiKeyEnv];
    if (!key) {
      throw new UserError(`Provider "${name}" sets apiKeyEnv "${profile.apiKeyEnv}" but that variable is empty.`);
    }
    return key;
  }
  return profile.apiKey || undefined;
}

export function buildProfile(name, rawProfile) {
  const { baseUrl, query } = normalizeBaseUrl(rawProfile.baseUrl);
  return {
    name,
    baseUrl,
    query,
    defaultModel: rawProfile.defaultModel,
    contextLength: rawProfile.contextLength,
    timeoutSeconds: rawProfile.timeoutSeconds,
    // This list is a whitelist, so a key added to validation and forgotten here
    // validates fine and then does nothing — a configured value the code never
    // reads is the same defect as one it reports as armed.
    idleSeconds: rawProfile.idleSeconds,
    apiKey: resolveApiKey(rawProfile, name),
  };
}

function requireProvider(config, name) {
  const rawProfile = config.providers[name];
  if (rawProfile) return rawProfile;
  const known = Object.keys(config.providers).join(', ') || '(none)';
  throw new UserError(`Unknown provider "${name}". Configured: ${known}.`, {
    hint: `Add it to ${configPath()}, or pass --base-url on its own for a one-off endpoint.`,
  });
}

/** Pick one provider: an explicit --base-url wins, then --provider, then the default. */
export function resolveProfile(config, { provider, baseUrl } = {}) {
  // A named provider must exist even when --base-url overrides its endpoint.
  // Skipping this check let a typo yield an empty profile, which silently threw
  // away contextLength and disarmed the oversized-input guard.
  const named = provider ? requireProvider(config, provider) : undefined;

  if (baseUrl) {
    const overridden = { ...named, baseUrl };
    // A credential belongs to the host it was configured for. Pointing
    // --base-url somewhere else must not send that host's key to a new one.
    const crossOrigin = named && !sameOrigin(named.baseUrl, baseUrl);
    if (crossOrigin) {
      delete overridden.apiKey;
      delete overridden.apiKeyEnv;
    }
    const profile = buildProfile(provider ?? 'custom', overridden);
    profile.credentialWithheld = Boolean(crossOrigin && (named.apiKey || named.apiKeyEnv));
    return profile;
  }

  const name = provider || config.defaultProvider;
  if (!name) {
    throw new UserError('No provider given and the config has no "defaultProvider".', {
      hint: `Pass --provider, or set defaultProvider in ${configPath()}`,
    });
  }
  return buildProfile(name, named ?? requireProvider(config, name));
}
