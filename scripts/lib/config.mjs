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
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path === '' ? '/v1' : path}`;
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
  return {
    name,
    baseUrl: normalizeBaseUrl(rawProfile.baseUrl),
    defaultModel: rawProfile.defaultModel,
    contextLength: rawProfile.contextLength,
    timeoutSeconds: rawProfile.timeoutSeconds,
    apiKey: resolveApiKey(rawProfile, name),
  };
}

/** Pick one provider: an explicit --base-url wins, then --provider, then the default. */
export function resolveProfile(config, { provider, baseUrl } = {}) {
  if (baseUrl) {
    return buildProfile(provider || 'custom', { ...(provider ? config.providers[provider] : {}), baseUrl });
  }
  const name = provider || config.defaultProvider;
  if (!name) {
    throw new UserError('No provider given and the config has no "defaultProvider".', {
      hint: `Pass --provider, or set defaultProvider in ${configPath()}`,
    });
  }
  const rawProfile = config.providers[name];
  if (!rawProfile) {
    const known = Object.keys(config.providers).join(', ') || '(none)';
    throw new UserError(`Unknown provider "${name}". Configured: ${known}.`, {
      hint: `Add it to ${configPath()}, or pass --base-url for a one-off endpoint.`,
    });
  }
  return buildProfile(name, rawProfile);
}
