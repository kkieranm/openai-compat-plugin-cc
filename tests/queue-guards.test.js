// Two properties of the background machinery that no behavioural test notices
// when they erode, because both fail in the direction of *working better* until
// the day they take something down.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../scripts/', import.meta.url));

function sourceFiles(dir = ROOT) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.mjs') ? [path] : [];
  });
}

test('nothing in this repo ever signals a process', () => {
  // Cancel is cooperative *because* a pid can be recycled: by the time a row is
  // read, that number may belong to something else entirely. Signal 0 asks; any
  // other signal acts on a process this plugin cannot prove is its own. The
  // erosion this guards against is a later "make cancel stop faster" edit.
  let calls = 0;
  const offenders = [];
  for (const path of sourceFiles()) {
    for (const call of readFileSync(path, 'utf8').matchAll(/process\.kill\([^)]*\)/g)) {
      calls += 1;
      if (!/^process\.kill\([A-Za-z0-9_.]+,\s*0\)$/.test(call[0])) offenders.push(`${path}: ${call[0]}`);
    }
  }

  // Without this the guard passes by finding nothing, which is what a guard
  // looks like right up until someone deletes the thing it was watching.
  assert.ok(calls >= 1, 'the liveness probe has moved: this guard is examining nothing');
  assert.deepEqual(offenders, [], 'a signal other than 0 could land on a recycled pid');
});

test('the detached worker never inherits a descriptor from its parent', () => {
  // `tests/helpers.mjs` resolves a companion run on 'close', which waits for
  // every descriptor the child holds — so a grandchild holding an inherited
  // pipe turns `--background` into a foreground run and hangs the suite until
  // the client timeout. The log file is the whole point.
  const source = readFileSync(join(ROOT, 'lib/job-spawn.mjs'), 'utf8');
  const stdio = source.match(/stdio:\s*\[[^\]]*\]/);

  assert.ok(stdio, 'job-spawn.mjs no longer sets stdio explicitly');
  assert.doesNotMatch(stdio[0], /inherit|pipe/, `the worker must write to its log file, got ${stdio[0]}`);
  assert.match(source, /detached:\s*true/, 'a worker that is not detached dies with the session that submitted it');
});

test('abandonment reads, decides and writes inside ONE immediate transaction', () => {
  // The property is placement, and placement is a fact about the source. No
  // behavioural test in this repo can reach it: `node:sqlite` is synchronous, so
  // nothing can interleave between an outside read and the write within a single
  // process — an implementation that decided on stale bytes would pass every
  // scenario test in `abandon.test.js` and still lose to a worker that resumed
  // from sleep and beat before the write landed.
  //
  // The ROW READ is the member that must not be dropped from this list. A guard
  // naming only the decision and the write still passes an implementation that
  // reads the row outside and closes over it — which leaves the original defect
  // exactly as it was, the stale bytes merely decided on inside a transaction
  // that cannot save them.
  //
  // Scope, stated rather than left to be discovered: this covers
  // `job-abandon.mjs` alone. `cmd-abandon.mjs` performs NO read of its own — it
  // prints the row this transaction returned — so there is nothing there for
  // this guard to miss today. A display read added later would be outside its
  // scope, which is a fact about the guard rather than about the system.
  const raw = readFileSync(join(ROOT, 'lib/job-abandon.mjs'), 'utf8');
  // A declaration is not a call, and `function abandonDecision(` sits at column 0
  // outside every transaction by construction. Blanked rather than special-cased
  // per name, so a future guarded helper defined in this file behaves the same.
  const source = raw.replace(/\bfunction\s+\w+\(/g, 'function DECLARATION(');
  const opened = source.indexOf('inImmediateTransaction(db, () => {');
  assert.ok(opened !== -1, 'the transaction has moved: this guard is examining nothing');
  assert.equal(
    source.indexOf('inImmediateTransaction(db, () => {', opened + 1), -1,
    'a second transaction in this file would make the extent below ambiguous',
  );

  // The extent must END at the callback's closing brace. Slicing to EOF instead
  // counts everything *after* the transaction opens as inside it — so a helper
  // calling `finish` appended below `abandonRow` would read as guarded, which is
  // exactly the escape this test exists to refuse. Found by mutation, not by
  // reasoning: three of four mutations fired against the EOF version and the
  // fourth passed.
  // Brace counting is naive about strings and comments, and the two directions
  // are NOT symmetric — so this says which, rather than claiming it fails closed.
  // A stray `}` in a string or comment SHRINKS the body: guarded calls then read
  // as escaped and the assert fires, which is safe. A stray `{` EXTENDS it past
  // the real close, and an escaped call in that stretch reads as guarded — that
  // one fails OPEN. What makes this sound today is simply that the callback body
  // contains no braces in string or comment context; check that before adding
  // any.
  const from = source.indexOf('{', source.indexOf('() =>', opened));
  let depth = 0;
  let end = -1;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end !== -1, 'the transaction callback never closes: this guard cannot bound what it checks');
  const body = source.slice(from, end);

  // `livenessOf(` is asserted ONE-DIRECTIONALLY, and the asymmetry is forced
  // rather than sloppy: `couldDrain` legitimately calls it from a helper body
  // that is textually outside this callback though it runs inside at runtime, so
  // the total==inside form below is unsatisfiable for it without gutting that
  // helper. What must hold is that the verdict the DECISION uses is minted under
  // the lock — at least one call inside — which is what this asserts.
  assert.ok(
    body.split('livenessOf(').length - 1 >= 1,
    'the liveness the decision uses must be resolved inside the lock, not inherited from before it',
  );

  // **Resolving it is not the property; USING it is.** `abandonDecision` falls
  // back to deriving liveness itself so the pure unit tests stay pure, which
  // makes dropping the argument behaviourally invisible — a mutation that removed
  // it passed all 920 tests. So the guard has to read the call site: the decision
  // taken under this lock must be handed the verdict minted under it, not left to
  // re-derive one. Found by mutation, which is the only reason this line exists.
  const call = body.slice(body.indexOf('abandonDecision('));
  assert.match(
    call.slice(0, call.indexOf(')') + 1),
    /liveness/,
    'the in-lock decision must be passed the liveness resolved in the same transaction',
  );

  // `couldDrain(` is one-directional for the same reason `livenessOf(` is: the
  // recovery path calls it from `handOver`'s body, textually outside this
  // callback though it runs inside at runtime. What must hold is that the
  // drainage snapshot `report()` calls "At that moment" is taken under the lock —
  // at least one call inside — not that every call site sits in the callback.
  assert.ok(
    body.split('couldDrain(').length - 1 >= 1,
    'the drainage snapshot must be taken inside the lock, or "At that moment" names no moment',
  );

  // `handOver(` joins the set — the recovery path, which decides AND writes under
  // this same lock. It is the call site rather than `reconcile(` because the
  // reconcile itself sits in that helper's body, textually outside this callback
  // though it runs inside at runtime; pinning the call site is what stops a future
  // edit hoisting recovery back out into the pre-transaction sweep this feature
  // deleted, with the guard staying green throughout.
  // `Date.now()` is counted total==inside for the same reason the reads are: a
  // clock sampled before the lock is a clock up to `busy_timeout` stale by the
  // time anything reads it, and reverting the sample to a signature default is
  // behaviourally invisible — no test can deterministically wedge lock
  // acquisition, so nothing else would notice.
  const guarded = ['jobById(', 'abandonDecision(', 'finish(', 'handOver(', 'Date.now()'];
  const escaped = [];
  for (const call of guarded) {
    // Counted rather than located, so a second call site added outside later is
    // caught as well as the first one moved out.
    const total = source.split(call).length - 1;
    const inside = body.split(call).length - 1;
    assert.ok(total >= 1, `${call} has been renamed: this guard is examining nothing`);
    if (inside !== total) escaped.push(`${call} appears ${total - inside}x outside the transaction`);
  }
  assert.deepEqual(escaped, [], 'a row read or decided outside the lock can be invalidated before the write');

  // And `reconcile` may be reached only through that one guarded call site.
  // EXACTLY ONE occurrence of `reconcile(` is expected — the call inside
  // `handOver`. The import does not count: it reads `reconcile.mjs'`, which has
  // no paren. Do not "correct" this number upward to include it; a second match
  // means a second route into recovery, which is the shape this feature spent a
  // whole review pass removing.
  assert.equal(
    source.split('reconcile(').length - 1, 1,
    'recovery must have exactly one call site, reached from inside the transaction',
  );
});
