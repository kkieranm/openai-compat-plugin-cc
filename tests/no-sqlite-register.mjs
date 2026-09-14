// Registers `no-sqlite-hook.mjs` for a child process: `node --import <this>`.
//
// Two files rather than one because the hook is evaluated on the loader thread,
// where calling `register` again would be registering it from inside itself.
import { register } from 'node:module';

register('./no-sqlite-hook.mjs', import.meta.url);
