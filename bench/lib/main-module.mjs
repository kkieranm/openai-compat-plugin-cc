import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `node -e CODE path` and `node -p CODE path` put `path` in `process.argv[1]`
// although Node ran no entry script. Matched as whole tokens: a substring test
// would also catch `--enable-source-maps` or `--preserve-symlinks-main`.
const EVAL_FLAG = /^(?:-e|-p|-pe|--eval|--print)(?:=|$)/;

/**
 * Whether the module at `moduleUrl` is the script Node was asked to run, so a
 * driver runs its `main()` when invoked and stays inert when imported.
 *
 * Both sides are resolved: Node resolves symlinks in `import.meta.url` but not
 * in `process.argv[1]` (on macOS `/tmp` is a link to `/private/tmp`), and under
 * `--preserve-symlinks-main` it is `import.meta.url` that keeps the link. False
 * under `-e`/`-p` whatever `argv[1]` names, judged process-wide (a worker thread
 * inherits it), and false when `argv[1]` is absent or will not resolve (a REPL,
 * piped stdin's `-`, a deleted entry).
 */
export function isMainModule(moduleUrl) {
  if (process.execArgv.some((flag) => EVAL_FLAG.test(flag))) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
