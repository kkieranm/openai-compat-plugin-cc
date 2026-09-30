// An ESM resolve hook that makes `node:sqlite` unresolvable.
//
// ONE shape, and it is deliberately NOT an unavailability shape. This hook exists
// only to raise a failure the plugin does not recognise — which must keep its
// cause and must never be relabelled as a stale Node. Genuine unavailability is
// driven by `--no-experimental-sqlite`, a real runtime without the module, which
// needs no hook at all.
//
// A fixture that can produce evidence no test asks for is where manufactured
// evidence comes from, so the env var is REQUIRED rather than defaulted.
const SHAPES = {
  ERR_INVALID_MODULE_SPECIFIER: 'a fault this plugin has no opinion about',
};

export async function resolve(specifier, context, next) {
  if (specifier === 'node:sqlite' || specifier === 'sqlite') {
    const code = process.env.OAI_TEST_SQLITE_FAILURE;
    const message = SHAPES[code];
    if (!message) throw new Error(`test hook: unknown or unset failure shape "${code}"`);
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  return next(specifier, context);
}
