import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { UserError } from './errors.mjs';
import { MAX_BUDGET_SECONDS } from './http-budgets.mjs';

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

/** Keys measured in something other than seconds, so the timer ceiling cannot apply. */
const NON_DURATION_KEYS = new Set(['contextLength']);

/** Measured throughput, which is a positive number rather than a whole one. */
const RATE_KEYS = new Set(['prefillTokensPerSecond', 'generationTokensPerSecond']);

// A dangling symlink at `path` makes `readFileSync` see ENOENT (the TARGET
// doesn't exist) and `writeFileSync(..., {flag: 'wx'})` see EEXIST (the LINK
// itself does) on every attempt — an unbounded recurse would spin forever.
// Concurrent create/unlink churn can also cost more than one retry. Bounded
// rather than infinite; exhausting it is reported, not crashed into a raw
// stack-overflow RangeError.
const MAX_CREATE_RACE_ATTEMPTS = 3;

/** Read the config, seeding it with defaults the first time. */
export function loadConfig() {
  return loadConfigAttempt(0);
}

function loadConfigAttempt(attempt) {
  const path = configPath();
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (attempt >= MAX_CREATE_RACE_ATTEMPTS) {
      throw new UserError(`Could not create ${path}: something is there but cannot be read.`, {
        hint: 'Check what is at that path — a broken symlink, or a permissions problem — and remove or fix it.',
      });
    }
    mkdirSync(dirname(path), { recursive: true });
    // A profile may carry an inline `apiKey` (`apiKeyEnv` is preferred, but
    // `apiKey` is a supported fallback) — this file can hold a secret from the
    // moment it exists, so `mode` is passed at creation rather than left to a
    // later repair (OAI-72(a), the same posture `job-store.mjs` gives `jobs.db`).
    // `flag: 'wx'` rather than the default `'w'`: the ENOENT above only proves
    // the file didn't exist at the READ a moment ago — a concurrent creator in
    // the gap between that check and this write would otherwise have its file
    // silently truncated here while keeping whatever mode IT gave the file,
    // which defeats the 0600 this call exists to guarantee. On that race,
    // `EEXIST` means someone else won it; re-enter (bounded, see above) to
    // read what they wrote and let the repair below fix its mode.
    try {
      writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    } catch (raceError) {
      if (raceError.code === 'EEXIST') return loadConfigAttempt(attempt + 1);
      throw raceError;
    }
    return { path, config: structuredClone(DEFAULT_CONFIG), created: true };
  }

  // Unconditional, immediately after a successful read and before validating
  // its CONTENT — a file left loose by an older build (or widened by anything
  // else) would otherwise stay that way for as long as it happens to be
  // invalid JSON or the wrong shape, the same lesson OAI-65(b) drew for
  // `jobs.db`'s containing directory. The file's mode is a property of the
  // file, not of whether its content currently parses. Only `ENOSYS`
  // ("chmod not implemented") and `EINVAL` (the mode argument itself refused
  // as meaningless) are what a genuinely mode-less filesystem actually
  // returns, so only those two are swallowed — everything else (`EPERM`,
  // `EACCES`, `EROFS`, `EIO`, ...) is a real, mode-capable filesystem that
  // refused or failed the repair, and continuing to read a possibly-secret-
  // bearing file through a mode we could not verify would defeat the whole
  // point of this repair, so those fail loud.
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    if (error.code !== 'ENOSYS' && error.code !== 'EINVAL') {
      throw new UserError(`Could not set the required 0600 permissions on ${path} (${error.code}).`, {
        hint: 'Fix its ownership or permissions by hand, or delete it to have the defaults written back.',
      });
    }
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    // Never interpolate the parse error's own message (OAI-72(b), same
    // discipline as `normalizeBaseUrl`'s throws below): V8's SyntaxError
    // routinely quotes a slice of the surrounding raw text, not just a
    // position — `JSON.parse('{"apiKey": sk-SECRET}')` throws a message
    // containing `sk-SECRE`. A syntax slip near a hand-edited secret would
    // otherwise echo a fragment of it into this UserError.
    throw new UserError(`Config at ${path} is not valid JSON.`, {
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
    // Checked HERE, at load, not in `resolveApiKey` (OAI-183) — `resolveProfile` deletes
    // `apiKeyEnv` from the raw profile before `buildProfile` runs on the cross-endpoint
    // `--base-url` branch, so a check placed in `resolveApiKey` would never see it on that
    // path. Keyed on PRESENCE (`in`), not truthiness: an empty string is falsy and a
    // truthiness-gated check would silently accept it. `process.env[profile.apiKeyEnv]`
    // coerces its subscript, so a non-string name resolves *some* env var rather than
    // failing to resolve one — refusing the shape here is what stops that from ever tagging
    // a job with a name that is not a name. This runs on every command, since `loadConfig`
    // does, not only submission — a profile with `apiKeyEnv: ""` beside an inline `apiKey`
    // worked today by falling through to the inline key, and now refuses everywhere; an
    // empty `apiKeyEnv` is almost certainly a typo, and failing loud on it is the point.
    if ('apiKeyEnv' in profile && (typeof profile.apiKeyEnv !== 'string' || !profile.apiKeyEnv)) {
      throw new UserError(
        `Provider "${name}" in ${path} has "apiKeyEnv": ${JSON.stringify(profile.apiKeyEnv)} — expected a non-empty string.`,
      );
    }
    // "8k" would sail through every comparison in the size guard as NaN,
    // leaving it reporting an armed check that in fact tests nothing.
    for (const key of [
      'contextLength', 'timeoutSeconds', 'idleSeconds', 'maxSeconds', 'retrySeconds',
      'prefillTokensPerSecond', 'generationTokensPerSecond',
    ]) {
      const value = profile[key];
      // `retrySeconds` is the one budget where 0 is a *setting*, not a mistake:
      // it means "retry immediately", which is a coherent choice for a server
      // that does not need time to recover — and it is what the test suite uses
      // so a retry path costs no wall clock. Every other key here is a duration
      // or a size where 0 would disarm the thing it configures.
      // A measured throughput is essentially never a whole number, and
      // `eta.mjs` accepts any finite positive rate — validating it as an integer
      // refused exactly the values the feature exists to record.
      if (RATE_KEYS.has(key)) {
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
          throw new UserError(
            `Provider "${name}" in ${path} has "${key}": ${JSON.stringify(value)} — expected a positive number of tokens per second.`,
          );
        }
        continue;
      }
      const floor = key === 'retrySeconds' ? 0 : 1;
      if (value !== undefined && (!Number.isInteger(value) || value < floor)) {
        throw new UserError(
          `Provider "${name}" in ${path} has "${key}": ${JSON.stringify(value)} — expected a ${floor === 0 ? 'whole number of seconds, zero or more' : 'positive whole number'}.`,
        );
      }
      // A budget above what setTimeout can express is clamped by Node to 1ms —
      // so an enormous number here would arm an *immediate* timeout, which is
      // the opposite of what anyone writing it meant. Same ceiling the flags use.
      //
      // Only DURATIONS have this ceiling. A size and a rate are not times, and
      // refusing one of them for being "above what a timer can express" would be
      // a refusal whose stated reason is not the condition tested — the defect
      // class this repo repeats most.
      if (!NON_DURATION_KEYS.has(key) && value > MAX_BUDGET_SECONDS) {
        throw new UserError(
          `Provider "${name}" in ${path} has "${key}": ${value} — above the ${MAX_BUDGET_SECONDS}s a timer can express.`,
        );
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
    // Never interpolate `raw` into a thrown message (OAI-72(b)) — this
    // function's whole job is validating a value the caller does not yet
    // trust, so it is exactly the wrong place to echo that value back
    // un-redacted. A malformed baseUrl reaches here carrying a query-string
    // secret or embedded userinfo just as often as it reaches here at all,
    // and this function has no way to know which. Structural, not a scrub:
    // OAI-63 tried scrubbing a wrapped message like this and was defeated
    // four times by a narrower shape each round; nothing raw is quoted here,
    // so there is nothing to scrub and nothing to bypass.
    throw new UserError('The configured baseUrl is not a valid URL.', { hint });
  }
  // "localhost:1234" parses as a URL with scheme "localhost:" and a null
  // origin, which would silently build nonsense request URLs.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserError('The configured baseUrl is not a valid http(s) URL.', { hint });
  }
  // Credentials in the URL would be dropped when we rebuild it below, and a
  // silently unauthenticated request is worse than a refusal.
  if (url.username || url.password) {
    throw new UserError('The configured baseUrl embeds credentials in the URL, which this plugin does not forward.', {
      hint: 'Put the key in the profile\'s "apiKeyEnv" (preferred) or "apiKey" instead.',
    });
  }
  const path = url.pathname.replace(/\/+$/, '');
  // The query is kept separate because request paths are appended to baseUrl;
  // folding it in would produce ".../v1?api-version=2024/models".
  return { baseUrl: `${url.origin}${path === '' ? '/v1' : path}`, query: url.search };
}

/**
 * Whether two base URLs name the same request target — not merely the same
 * origin (OAI-63(c)). A credential belongs to the endpoint it was configured
 * for, and on a path-multiplexed gateway (LiteLLM, Azure APIM, Cloudflare AI
 * Gateway) two different tenants share an origin and differ only in path or
 * query — `same.example/tenant-a` and `same.example/tenant-b` are the same
 * origin and different secrets. Normalizes both sides through
 * `normalizeBaseUrl` before comparing, the same canonicalization every
 * profile's own `baseUrl` already goes through, so a trailing slash or an
 * implicit `/v1` cannot make two equal endpoints compare unequal.
 */
function sameEndpoint(a, b) {
  try {
    const na = normalizeBaseUrl(a);
    const nb = normalizeBaseUrl(b);
    return na.baseUrl === nb.baseUrl && na.query === nb.query;
  } catch {
    return false;
  }
}

/**
 * Resolve the API key without ever returning it to display code — and say which SOURCE
 * supplied it (OAI-183). `resolveCredential` needs this to tell a legitimate key rotation
 * (a new value behind the same source) from an `apiKeyEnv` repoint or an env/inline
 * transition (a different source entirely) — the value alone cannot distinguish them, and
 * the credential itself is deliberately never persisted (see job-auth.mjs).
 *
 * `resolveApiKey` has exactly ONE caller (`buildProfile`, directly below) and `authPolicyFor`'s
 * only profile source is `resolveProfile` → `buildProfile` — that is what makes "a resolved
 * key implies a source tag" hold, and what makes job-auth.mjs's fail-closed refusal
 * unreachable for a legitimately submitted row. A future second caller of `resolveApiKey`
 * that does not carry `credentialSource` through would quietly break that invariant.
 */
function resolveApiKey(profile, name) {
  if (profile.apiKeyEnv) {
    const key = process.env[profile.apiKeyEnv];
    if (!key) {
      throw new UserError(`Provider "${name}" sets apiKeyEnv "${profile.apiKeyEnv}" but that variable is empty.`);
    }
    return { apiKey: key, credentialSource: { kind: 'env', name: profile.apiKeyEnv } };
  }
  if (profile.apiKey) {
    return { apiKey: profile.apiKey, credentialSource: { kind: 'inline' } };
  }
  return { apiKey: undefined, credentialSource: undefined };
}

export function buildProfile(name, rawProfile) {
  const { baseUrl, query } = normalizeBaseUrl(rawProfile.baseUrl);
  const { apiKey, credentialSource } = resolveApiKey(rawProfile, name);
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
    maxSeconds: rawProfile.maxSeconds,
    retrySeconds: rawProfile.retrySeconds,
    // Measured throughput, used only to estimate a wait before one is spent.
    // Rates rather than a hardcoded model class, because ADR 001 makes providers
    // configuration and nothing here may know which server is slow. Absent means
    // no estimate is offered at all — see `eta.mjs`, which refuses to invent one.
    prefillTokensPerSecond: rawProfile.prefillTokensPerSecond,
    generationTokensPerSecond: rawProfile.generationTokensPerSecond,
    apiKey,
    credentialSource,
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
/**
 * The name a profile gets when `--base-url` named no provider.
 *
 * Exported because a second module has to RECOGNISE it: a remedy that says
 * `set "contextLength" for "custom"` points at a config entry that does not
 * exist, so `review.mjs` must tell this case apart and say something the user
 * can actually do. A bare string compared in two files is the same fact stored
 * twice, which is the defect that produced it.
 */
export const AD_HOC_PROFILE_NAME = 'custom';

export function resolveProfile(config, { provider, baseUrl } = {}) {
  // A named provider must exist even when --base-url overrides its endpoint.
  // Skipping this check let a typo yield an empty profile, which silently threw
  // away contextLength and disarmed the oversized-input guard.
  const named = provider ? requireProvider(config, provider) : undefined;

  if (baseUrl) {
    const overridden = { ...named, baseUrl };
    // A credential belongs to the ENDPOINT it was configured for, not merely
    // its origin (OAI-63(c)) — a same-origin, different-path override on a
    // path-multiplexed gateway is a different tenant, not the same one with a
    // longer URL.
    const crossEndpoint = named && !sameEndpoint(named.baseUrl, baseUrl);
    if (crossEndpoint) {
      delete overridden.apiKey;
      delete overridden.apiKeyEnv;
    }
    const profile = buildProfile(provider ?? AD_HOC_PROFILE_NAME, overridden);
    // Set HERE because this is the only branch that KNOWS it: a profile built at the
    // bottom of this function came from a config entry, and one built here did not.
    // Read by `review.mjs`, whose remedy would otherwise send the user to a config key
    // that does not exist. Comparing `name` against the constant instead was a real
    // defect — a user may legitimately configure a provider CALLED "custom", which
    // reaches the branch below and never touches it.
    profile.adHoc = true;
    profile.credentialWithheld = Boolean(crossEndpoint && (named.apiKey || named.apiKeyEnv));
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
