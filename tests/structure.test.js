// Structural invariants.
// A recurring defect class graduates from reviewer prompts to a test here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude']);
// Skipped by path rather than by bare name, which would skip any directory
// called `cases` anywhere in the tree. The benchmark corpus is data, not
// source: historical blobs kept byte-identical *because* they contain known
// defects, and running today's guards over them would measure 2026's commits.
const SKIP_PATHS = new Set(['bench/cases']);
const SOURCE_EXT = /\.(js|mjs|cjs|ts|jsx|tsx|sh)$/;

/**
 * Source with comments blanked out, for guards that forbid a *call*.
 *
 * Known limitation, stated rather than hidden: this is a regex, so a `//` inside
 * a string literal or a regex literal is treated as a comment. That can only
 * make a guard miss an offender in an oddly-written line, never invent one — and
 * the alternative, matching prose, produces false failures that get silenced.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_PATHS.has(relative(ROOT, p))) yield* sourceFiles(p);
    } else if (SOURCE_EXT.test(name)) yield p;
  }
}

// Confirmed twice, so promoted from a reviewer's prompt to a guard. Extracting
// a function means inserting one above an existing declaration, and twice now
// the new function has landed *between* a docblock
// and the function that docblock described — leaving the old comment attached to
// unrelated code and its subject with none. It reads as harmless placement and
// is not: the orphaned block in `review-report.mjs` ended "Exported for the
// tests that pin those fields", which was then false of the private helper it
// had come to sit above.
//
// Two consecutive `/**` blocks with nothing between them is the exact shape, and
// nothing else in this repo produces it.
test('no doc comment is orphaned from the thing it documents', () => {
  const offenders = [];
  for (const dir of ['scripts', 'bench']) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let closedAt = -1;
      // Only once a function has been declared. Before that, a floating block is
      // a module header — this repo writes them in both `/** */` and `//` form —
      // which documents the file and is attached to nothing on purpose. Scoping
      // by position rather than by content is what keeps the guard from calling
      // the convention a defect.
      let seenFunction = false;
      lines.forEach((line, index) => {
        const text = line.trim();
        if (text === '*/') closedAt = index;
        // A second block opening with only blank lines since the last one
        // closed: whatever the first block described, it is not the next
        // declaration any more.
        if (seenFunction && text.startsWith('/**') && closedAt >= 0) {
          if (lines.slice(closedAt + 1, index).every((between) => between.trim() === '')) {
            offenders.push(`${relative(ROOT, file)}:${closedAt + 1}: doc comment is followed by another, not by a declaration`);
          }
        }
        if (/^(export\s+)?(async\s+)?function\s/.test(text)) seenFunction = true;
        if (text !== '*/' && text !== '') closedAt = -1;
      });
    }
  }
  assert.deepEqual(offenders, []);
});

// Confirmed defect class, promoted from a review note to a guard: spawnSync
// blocks this process's event loop, so the in-process fake server can never
// answer and the suite hangs until the client timeout instead of failing.
test('tests never spawn a child synchronously', () => {
  const offenders = [];
  for (const file of sourceFiles(join(ROOT, 'tests'))) {
    // Match a call, not a mention, so this guard does not flag itself.
    if (/\b(spawnSync|execSync|execFileSync)\s*\(/.test(readFileSync(file, 'utf8'))) {
      offenders.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], 'use the async runCompanion helper instead');
});

// Confirmed defect class, promoted from "a reviewer should catch it" to a guard.
// The global fetch is undici, and undici applies its own headersTimeout and
// bodyTimeout — 300s each, configurable by nothing at the call site. A
// configured `timeoutSeconds: 1800` was therefore decoration, and 14 of 18
// benchmark runs died at the 300s wall while the config advertised half an hour.
// The defect is an invisible default, so the call site is what this forbids;
// scripts/lib/http.mjs owns the request on node:http and makes every budget an
// argument. There are no exemptions: http.mjs itself has no reason to call fetch.
test('nothing calls the global fetch — every request goes through http.mjs', () => {
  // Comments are stripped first, because the modules that replaced fetch have to
  // be able to *say* "fetch()" while explaining why they exist — and a guard
  // that forbids naming the thing it forbids would be edited away rather than
  // obeyed. Markdown is outside SOURCE_EXT, so prose is unaffected, and
  // bench/cases is already excluded via SKIP_PATHS: the frozen corpus holds
  // copies of the old client, byte-identical precisely because they contain
  // this defect.
  const offenders = [];
  for (const file of sourceFiles(ROOT)) {
    if (/\bfetch\s*\(/.test(withoutComments(readFileSync(file, 'utf8')))) offenders.push(relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], 'use send() from scripts/lib/http.mjs, which requires an explicit budget');
});

// Confirmed defect class, promoted from "I noticed it" to a guard: `node --test`
// with no path walks the whole repo, so the benchmark corpus — historical source
// kept deliberately as data — was discovered and its 2026-vintage tests were run
// against today's tree, failing on imports that no longer exist. The scope in the
// npm script is what stops that, and it reads as redundant until someone removes it.
test('the test runner is scoped, so corpus snapshots are not discovered as tests', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /tests\//, 'an unscoped `node --test` would run bench/cases snapshots');
});

/**
 * Confirmed by the OAI-23 wide review, which proved it by mutation: moving
 * `capBudgets` below `ledger.begin` in `postWithDegrade` left all 370 tests
 * green while reopening the exact defect OAI-23 closed on the capability-rung
 * path — a refusal reclassified as benign negotiation for a replacement that was
 * never dispatched, plus a phantom entry for it.
 *
 * The class, which is what earns a guard: **an ordering that carries an
 * invariant, pinned by nothing**. Two statements swap and the invariant is gone.
 * The suite no longer stays green when they do — `failure-shape.test.js` and
 * `cap-ordering.test.js` both go red — so this guard does not stand IN PLACE of
 * behavioural cover, as it once claimed to; OAI-25 refuted that. It localizes the
 * contract to the two statements carrying it, naming the rule where it lives.
 *
 * Comments are stripped first: both tokens now appear in the prose that explains
 * this very ordering, and a guard matching those would pass vacuously. Absence of
 * either token FAILS rather than silently passing, so a rename breaks the test
 * instead of disabling it.
 */
/** The comment-stripped body of a top-level function, for the guards below. */
function functionBody(relativePath, declaration) {
  const source = withoutComments(readFileSync(join(ROOT, relativePath), 'utf8')).split('\n');
  const start = source.findIndex((line) => declaration.test(line));
  assert.ok(start >= 0, `${declaration} not found in ${relativePath} — was it renamed? Update this guard, do not delete it.`);
  const end = source.indexOf('}', start);
  assert.ok(end > start, `could not find the end of ${declaration} in ${relativePath}`);
  return source.slice(start, end).join('\n');
}

/** Every occurrence, because "exactly one" is the assertion OAI-22 needs. */
function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('the wall-clock cap is checked before a ledger entry is minted, not after', () => {
  const body = functionBody('scripts/lib/chat.mjs', /^export async function postWithDegrade\b/);

  const cap = body.indexOf('capBudgets(');
  const begin = body.indexOf('.begin(');
  assert.ok(cap >= 0, 'postWithDegrade no longer calls capBudgets — was it renamed? Update this guard.');
  assert.ok(begin >= 0, 'postWithDegrade no longer calls ledger.begin — was it renamed? Update this guard.');
  assert.ok(
    cap < begin,
    'capBudgets must run BEFORE ledger.begin: an entry minted first files a request that never went ' +
      'on the wire as a physical attempt, and settles a pending refusal that nothing replaced (OAI-23).',
  );
});

/**
 * OAI-22, and the reason the ordering guard above is no longer sufficient on its
 * own: it proves *a* cap check precedes the ledger entry, not that the checked
 * budget is the one the transport actually gets. While `postChat` re-evaluated
 * the cap on its own side, both statements could be true and a cap falling due
 * between them still minted an entry for a request that was never sent.
 *
 * Same class as the guard above, and behaviourally covered too since OAI-25:
 * `cap-ordering.test.js` drives an expiry into that window with a controlled
 * clock, and fails if `postChat` recomputes. This pins where the rule lives.
 */
test('the cap is evaluated exactly once per dispatch, and that evaluation is what the transport gets', () => {
  const degrade = functionBody('scripts/lib/chat.mjs', /^export async function postWithDegrade\b/);
  const post = functionBody('scripts/lib/chat.mjs', /^async function postChat\b/);

  assert.equal(
    occurrences(degrade, 'capBudgets('),
    1,
    'postWithDegrade must evaluate the cap ONCE: two evaluations can disagree, and the gap between ' +
      'them is where a phantom ledger entry is minted (OAI-22).',
  );
  const bound = /const (\w+) = capBudgets\(/.exec(degrade);
  assert.ok(bound, 'the cap evaluation must be BOUND to a name — an unbound call cannot be passed to postChat.');
  assert.ok(
    degrade.indexOf(`const ${bound[1]} = capBudgets(`) < degrade.indexOf('.begin('),
    'the binding must precede ledger.begin, or the entry is minted against an unchecked cap.',
  );
  assert.match(
    degrade,
    new RegExp(`postChat\\([^)]*\\b${bound[1]}\\b`),
    `postChat must receive ${bound[1]}: computing the budget and then not using it is the defect wearing a disguise.`,
  );
  assert.equal(
    occurrences(post, 'capBudgets('),
    0,
    'postChat must NOT re-evaluate the cap — that second call IS the OAI-22 defect.',
  );
  // Proves the absence assertion above is not vacuous: an assert-absence over a
  // wrongly-bounded body would pass on an empty string. `postChat` genuinely
  // contains the request it is being checked around.
  assert.match(post, /request\(profile, '\/chat\/completions'/, 'postChat body not bounded correctly — fix this guard.');
});

/**
 * The one call-site argument in the transport that decides retryability, and
 * nothing behavioural can pin it.
 *
 * `bodyStream`'s catch only ever runs past headers, so its failures are dropped
 * *deliveries* and must stay retryable whether or not Node attached a `code`.
 * Measured on Node 26.3: a socket cut mid-body arrives as `Error: aborted`
 * carrying `ECONNRESET`, which the transient whitelist happens to accept — so
 * deleting `{ delivered: true }` changes nothing today and everything on a Node
 * that hands over the same error bare, which the comment at that catch records
 * having already seen once. A test cannot make Node drop the code on demand;
 * this can.
 */
test('the body-stream catch classifies its failures as delivered, whatever code Node attached', () => {
  const body = functionBody('scripts/lib/http.mjs', /^async function\* bodyStream\b/);

  assert.match(
    body,
    /transportError\(error, url, \{ delivered: true \}\)/,
    'bodyStream must pass `delivered: true`: past headers a failure is a dropped delivery and is ' +
      'retryable regardless of `error.code`, which Node does not promise to attach (OAI-22).',
  );
});
