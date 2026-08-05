// What a worker is allowed to send, decided when the job is submitted.
//
// The credential itself is never stored. What is stored is the *authorization
// decision* — which is a different thing, and the difference is the whole point.
import { loadConfig, resolveProfile } from './config.mjs';
import { UserError } from './errors.mjs';

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Turn a resolved profile into a policy a worker can act on later.
 *
 * `mode: 'none'` covers both an open server and the case where `resolveProfile`
 * deliberately withheld a credential because `--base-url` moved the request to
 * another origin. It also covers a bare `--base-url`, whose synthetic `custom`
 * profile will not be in `providers.json` when the worker looks — recording
 * `mode: 'profile'` there would turn a perfectly valid invocation into a
 * failure.
 */
export function authPolicyFor(profile) {
  if (!profile.apiKey) return { mode: 'none' };
  return { mode: 'profile', profile: profile.name, authorizedOrigin: originOf(profile.baseUrl) };
}

/**
 * The credential to use now, or a refusal — never a silent fallback either way.
 *
 * **Three origins must agree, and comparing only two proves nothing.** The
 * persisted `authorizedOrigin` and the persisted transport both came from
 * submission, so checking one against the other is tautological: it passes by
 * construction. The term carrying information is the *current* config. If the
 * named profile has since been pointed at a different host and given a new key,
 * a two-way check would happily load that new key and send it to the old
 * endpoint this job still targets.
 */
export function resolveCredential(auth, transport) {
  if (!auth || auth.mode === 'none') return undefined;

  const target = originOf(transport?.baseUrl);
  if (auth.authorizedOrigin !== target) {
    throw new UserError(
      `credential-unavailable: this job was authorised for ${auth.authorizedOrigin} but targets ${target}.`,
    );
  }

  let current;
  try {
    current = resolveProfile(loadConfig().config, { provider: auth.profile });
  } catch (error) {
    throw new UserError(`credential-unavailable: provider "${auth.profile}" is no longer configured (${error.message}).`);
  }

  if (originOf(current.baseUrl) !== auth.authorizedOrigin) {
    throw new UserError(
      `credential-unavailable: provider "${auth.profile}" now points at ${originOf(current.baseUrl)}, not the ${auth.authorizedOrigin} this job was authorised for.`,
    );
  }
  if (!current.apiKey) {
    throw new UserError(`credential-unavailable: provider "${auth.profile}" no longer supplies a credential.`);
  }
  return current.apiKey;
}
