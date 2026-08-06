// An ESM resolve hook that makes `node:sqlite` unresolvable, so this machine can
// exercise the runtimes it does not have.
//
// The plugin declares `node: >=18.18` but `node:sqlite` is unflagged only from
// v22.13.0 (v23.4.0 on the 23.x line), and there is no old Node here — so the
// alternative to this hook is asserting nothing and calling the branch untested.
// It simulates *unresolvable*, which is what an old runtime does; it does not
// simulate an old runtime in any other respect, and nothing here should be read
// as evidence that this plugin runs on Node 18.
//
// ONE shape, and it is deliberately NOT an unavailability shape. This hook exists
// only to raise a failure the plugin does not recognise — which must keep its
// cause and must never be relabelled as a stale Node. Genuine unavailability is
// driven by `--no-experimental-sqlite`, a real runtime without the module, which
// needs no hook at all.
//
// Two entries have been deleted from this table, both for the same reason and the
// second only after the first taught the lesson. `ERR_MODULE_NOT_FOUND` went when
// a review proved no runtime can raise it for a `node:` specifier — the guard
// consuming it was justified by a shape this fixture had invented for it.
// `ERR_UNKNOWN_BUILTIN_MODULE` went when an audit found nothing ever selected it:
// every caller passes the env var explicitly, so it survived only as the default
// of a branch nothing took. A fixture that can produce evidence no test asks for
// is where manufactured evidence comes from, so the env var is now REQUIRED
// rather than defaulted.
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
