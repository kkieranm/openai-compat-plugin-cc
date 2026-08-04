import { homedir } from 'node:os';
import { join } from 'node:path';
import { REVIEW_MIN_TOKENS } from '../../scripts/lib/review-request.mjs';

/**
 * The protocol the TTL challenge runs under, and the only place a default lives.
 *
 * Injectable so the end-to-end harness can drive the real entry point with
 * sub-second TTLs and a stub `lms`. Overrides arrive by ARGV, never by
 * environment: a stray shell variable must not be able to alter a 45-minute run
 * on the user's hardware.
 */
export const DEFAULTS = Object.freeze({
  lms: join(homedir(), '.lmstudio', 'bin', 'lms'),
  model: 'qwen/qwen3.6-27b',
  case: 'scaffold',
  provider: 'lmstudio',
  challengeTtlSeconds: 120,
  calibrationTtlSeconds: 14_400,
  episodes: 3,
  sampleEveryMs: 2_000,
  timeoutSeconds: 1_800,
  // The reply is thrown away — the outcome is decided during prefill — so this
  // skips `scaffold`'s ~680s of dense generation. IMPORTED, never a literal: a
  // review REFUSES a budget below this floor rather than sending it, so a
  // hand-picked number below it fails every episode BEFORE dispatch. The first
  // draft picked 2,048; the only run it ever produced died in ~1s per episode
  // against a floor of 3,912 and still wrote a verdict about the server.
  maxTokens: REVIEW_MIN_TOKENS,
  outDir: null,
  providerConfig: null,
});

/** Parameters whose change means the run is no longer the shipped experiment. */
const EXPERIMENTAL = ['lms', 'model', 'case', 'provider', 'challengeTtlSeconds',
  'calibrationTtlSeconds', 'episodes', 'sampleEveryMs', 'timeoutSeconds', 'maxTokens',
  'providerConfig'];

const FLAGS = {
  '--lms': ['lms', String],
  '--model': ['model', String],
  '--case': ['case', String],
  '--provider': ['provider', String],
  '--provider-config': ['providerConfig', String],
  '--challenge-ttl': ['challengeTtlSeconds', Number],
  '--calibration-ttl': ['calibrationTtlSeconds', Number],
  '--episodes': ['episodes', Number],
  '--sample-every-ms': ['sampleEveryMs', Number],
  '--timeout': ['timeoutSeconds', Number],
  '--max-tokens': ['maxTokens', Number],
  '--out-dir': ['outDir', String],
};

const POSITIVE_NUMBER = ['challengeTtlSeconds', 'calibrationTtlSeconds', 'sampleEveryMs',
  'timeoutSeconds', 'maxTokens'];

/**
 * Resolve the effective protocol from argv.
 *
 * An unknown flag is a hard error rather than something swallowed into a prompt:
 * a typo on a 45-minute run must not silently produce the default protocol under
 * a name the operator thought meant something else.
 */
export function resolveConfig(argv) {
  const config = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const spec = FLAGS[argv[i]];
    if (!spec) throw new Error(`unknown flag: ${argv[i]}`);
    const [key, cast] = spec;
    const raw = argv[i + 1];
    if (raw === undefined) throw new Error(`${argv[i]} needs a value`);
    config[key] = cast(raw);
    i += 1;
  }
  // `--episodes` must be a positive integer, which is what makes an empty episode
  // list unreachable — and with it the `no-episodes` verdict the withdrawn draft
  // could return but no outcome table ever listed.
  if (!Number.isInteger(config.episodes) || config.episodes < 1) {
    throw new Error(`--episodes must be a positive integer, got ${config.episodes}`);
  }
  for (const key of POSITIVE_NUMBER) {
    if (!(config[key] > 0)) throw new Error(`${key} must be > 0, got ${config[key]}`);
  }
  return config;
}

/**
 * Is this the shipped experiment, or something else wearing its filename?
 *
 * `--out-dir` alone does NOT clear it — writing the record elsewhere does not
 * change what was measured. Everything else does. The done-condition for OAI-34
 * reads this field, because "a file matching the glob exists" was already
 * satisfied by a junk record from a draft that never dispatched a request.
 */
export function isCanonical(config) {
  return EXPERIMENTAL.every((key) => config[key] === DEFAULTS[key]);
}
