// Structural invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MAX_BUDGET_SECONDS } from '../plugins/oai/scripts/lib/http-budgets.mjs';
import { BENCH_NUMERIC_BOUNDS, NUMERIC_BOUNDS } from '../plugins/oai/scripts/lib/numeric-bounds.mjs';
import { MIN_REVIEW_RESERVE_TOKENS } from '../plugins/oai/scripts/lib/review-schema.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

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

// Extracting a function means inserting one above an existing declaration, and
// the new function can land *between* a docblock and the function that docblock
// described — leaving the old comment attached to unrelated code and its
// subject with none.
//
// Two consecutive `/**` blocks with nothing between them is the exact shape, and
// nothing else in this repo produces it.
test('no doc comment is orphaned from the thing it documents', () => {
  const offenders = [];
  for (const dir of ['plugins/oai/scripts', 'bench']) {
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

// spawnSync blocks this process's event loop, so the in-process fake server can
// never answer and the suite hangs until the client timeout instead of failing.
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

// A tracker id or decision-record number names a document this repository does
// not contain, so it points a reader at nothing. This guard reads the
// working-tree content of the paths git's index lists, so a local untracked
// file can neither pass nor fail this; a listed path deleted from the working
// tree is skipped, and any other unreadable path (a submodule among them) fails
// the test. The historical fixtures under bench/cases/ keep theirs by design,
// and .claude/REPO_TRAPS.md, a dated defect log, is excluded.
test('no tracked file cites a tracker id or a decision-record number', async () => {
  const git = (...args) => promisify(execFile)('git', args, { cwd: ROOT, maxBuffer: 16e6 });
  let listing, deleted;
  try {
    [{ stdout: listing }, { stdout: deleted }] = await Promise.all([
      git('ls-files', '-z'),
      git('ls-files', '-z', '--deleted'),
    ]);
  } catch (error) {
    assert.fail(`this guard needs a git checkout to list tracked files: ${error.message}`);
  }
  const files = listing.split('\0').filter(Boolean);
  assert.ok(files.includes('tests/structure.test.js'), 'git ls-files did not list this repository\'s own files');
  const gone = new Set(deleted.split('\0').filter(Boolean));
  const offenders = [];
  for (const file of files) {
    if (file.startsWith('bench/cases/') || file === '.claude/REPO_TRAPS.md') continue;
    let text;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch (error) {
      // git also lists a path as deleted when it merely could not stat it, so
      // its word alone never excuses a read that failed for another reason.
      if (error.code === 'ENOENT' && gone.has(file)) continue;
      assert.fail(`cannot read tracked file ${file}: ${error.message}`);
    }
    if (/\bOAI-\d+|\badr\/\d+|\bADR[- ]?\d+/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'drop the id; keep what the code does');
});

// A URL's pathname is percent-encoded, so a path taken from
// `new URL(…, import.meta.url).pathname` names a directory that does not exist
// once the checkout path holds a space, `#` or `%`. `fileURLToPath` decodes it.
test('no path is derived from import.meta.url through .pathname', () => {
  const offenders = [];
  for (const file of sourceFiles(ROOT)) {
    if (/import\.meta\.url\s*\)\s*\.pathname/.test(withoutComments(readFileSync(file, 'utf8')))) {
      offenders.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], 'use fileURLToPath(new URL(…, import.meta.url))');
});

// Defect class: `mkdtempSync` called across the suite with no cleanup leaked
// temp dirs, and three files each hand-rolled their own independent cleanup
// copy that could drift from the other two. `tempDir` in tests/helpers.mjs is
// now the single place a scratch dir is created and tracked for cleanup — a
// bare `mkdtempSync` call anywhere else in tests/ is the same defect
// reappearing.
test('no test creates a temp dir except through tests/helpers.mjs\'s tempDir', () => {
  const ALLOWED = ['tests/helpers.mjs'];
  const offenders = [];
  for (const file of sourceFiles(join(ROOT, 'tests'))) {
    const rel = relative(ROOT, file);
    if (ALLOWED.includes(rel)) continue;
    if (/\bmkdtempSync\s*\(/.test(readFileSync(file, 'utf8'))) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], 'use the shared tempDir helper (tests/helpers.mjs) instead of a bare mkdtempSync');
});

// The global fetch is undici, and undici applies its own headersTimeout and
// bodyTimeout — 300s each, configurable by nothing at the call site. A
// configured `timeoutSeconds: 1800` was therefore decoration, and 14 of 18
// benchmark runs died at the 300s wall while the config advertised half an hour.
// The defect is an invisible default, so the call site is what this forbids;
// plugins/oai/scripts/lib/http.mjs owns the request on node:http and makes every budget an
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
  assert.deepEqual(offenders, [], 'use send() from plugins/oai/scripts/lib/http.mjs, which requires an explicit budget');
});

// process.exit() tears the process down before queued stdio writes drain, truncating
// a large stdout or stderr payload at the pipe buffer. process.exitCode plus a natural return
// lets Node drain first. Scoped to this repo's actual CLI entrypoints rather than banned
// repo-wide: plugins/oai/scripts/lib/job-heartbeat.mjs has a deliberate process.exit(0) whose
// side effect (closing the model socket to stop generation server-side) is the
// point, and bench/task-cases/prototype-lookup/witness.mjs is corpus data, not
// production CLI surface.
const CLI_ENTRYPOINTS = [
  'plugins/oai/scripts/oai-companion.mjs', // the one file always run directly; no self-invocation guard needed
  'bench/run.mjs',
  'bench/review-sweep.mjs',
  'bench/recover-sweep.mjs',
  'bench/task-run.mjs',
  'bench/ttl-challenge.mjs',
  'bench/compare.mjs',
  'bench/sweep-reproduction.mjs',
];
test('CLI entrypoints use process.exitCode, never process.exit()', () => {
  // Comments are stripped first: this defect class's own explanatory comments
  // (including the one above this test, and plugins/oai/scripts/oai-companion.mjs's own)
  // inherently mention the banned call by name.
  const offenders = [];
  for (const rel of CLI_ENTRYPOINTS) {
    const file = join(ROOT, rel);
    if (/\bprocess\.exit\s*\(/.test(withoutComments(readFileSync(file, 'utf8')))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'use process.exitCode instead — see .claude/REPO_TRAPS.md');
});

// A driver that compares the raw `process.argv[1]` with its own path does nothing
// when invoked through a symlink: Node resolves the link in `import.meta.url` and
// not in `argv[1]`. Every bench driver guards `main` with the shared
// `isMainModule`, which resolves both, and names `main` nowhere outside that guard
// but its definition.
//
// Keyed on the identifier `main`: a driver must define `function main(`, so an
// entry under another name is loud rather than unchecked. A text scan, not a
// parser: brace depth is counted over comment-stripped source, so a brace or a
// comment marker inside a string can mislead it (a block left open is reported
// rather than trusted); an IIFE named `main` passes as a definition; and "the
// guard calls main" means a `main(` token appears in its block.
const GUARD = 'if (isMainModule(import.meta.url)) {';
function mainGuardProblems(source) {
  const code = withoutComments(source);
  const problems = [];
  if (!code.includes("import { isMainModule } from './lib/main-module.mjs'")) problems.push('no shared-helper import');
  if (/process\.argv\[1\]/.test(code)) problems.push('reads process.argv[1]');
  if (!/\bfunction main\(/.test(code)) problems.push('no function main(');
  const at = code.indexOf(GUARD);
  if (at === -1) return [...problems, 'no isMainModule guard'];
  let depth = 0;
  let end = -1;
  for (let i = at + GUARD.length - 1; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end === -1) return [...problems, 'guard block never closes'];
  if (!/\bmain\s*\(/.test(code.slice(at, end + 1))) problems.push('guard never calls main');
  const outside = code.slice(0, at) + code.slice(end + 1);
  const stray = outside.replace(/\bfunction main\(/g, '').match(/\bmain\b(?!-module)/g);
  if (stray) problems.push('main named outside the guard');
  return problems;
}

test('every bench driver runs main only under the shared isMainModule guard', () => {
  const drivers = readdirSync(join(ROOT, 'bench')).filter((name) => name.endsWith('.mjs')).map((name) => `bench/${name}`);
  assert.ok(drivers.length > 0, 'no bench drivers found');
  assert.deepEqual(drivers.filter((rel) => !CLI_ENTRYPOINTS.includes(rel)), [], 'a bench driver missing from CLI_ENTRYPOINTS is checked by nothing here');
  const offenders = drivers
    .map((rel) => [rel, mainGuardProblems(readFileSync(join(ROOT, rel), 'utf8'))])
    .filter(([, problems]) => problems.length > 0);
  assert.deepEqual(offenders, []);
});

test('the main-guard check rejects each listed escape form', () => {
  const head = "import { isMainModule } from './lib/main-module.mjs';\nasync function main() {}\n";
  const guarded = `${head}${GUARD}\n  main().catch((error) => {\n    process.exitCode = 1;\n  });\n}\n`;
  assert.deepEqual(mainGuardProblems(guarded), [], 'negative control: a correctly guarded driver');
  for (const escape of ['main();', 'await main();', 'void main();', 'export default main();', '  main();', 'main?.();', 'main ();', 'setImmediate(main);', 'const go = main;']) {
    assert.deepEqual(mainGuardProblems(`${guarded}${escape}\n`), ['main named outside the guard'], escape);
  }
  assert.deepEqual(mainGuardProblems(`${head}${GUARD}\n  main(\`\${'{'}\`);\nmain();\n`), ['guard block never closes']);
  assert.deepEqual(mainGuardProblems(head), ['no isMainModule guard']);
  assert.deepEqual(mainGuardProblems(`${head}${GUARD}\n}\n`), ['guard never calls main']);
  assert.deepEqual(mainGuardProblems(guarded.replace('async function main() {}', '')), ['no function main(']);
  assert.deepEqual(mainGuardProblems(guarded.replace("import { isMainModule } from './lib/main-module.mjs';", '')), ['no shared-helper import']);
  assert.deepEqual(mainGuardProblems(`${guarded}process.argv[1];\n`), ['reads process.argv[1]']);
});

// Defect class: `node --test` with no path walks the whole repo, so the
// benchmark corpus — historical source kept deliberately as data — was
// discovered and its 2026-vintage tests were run against today's tree, failing
// on imports that no longer exist. The scope in the npm script is what stops
// that, and it reads as redundant until someone removes it.
test('the test runner is scoped, so corpus snapshots are not discovered as tests', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /tests\//, 'an unscoped `node --test` would run bench/cases snapshots');
});

/**
 * Moving `capBudgets` below `ledger.begin` in `postWithDegrade` reopens the
 * defect this guards against on the capability-rung path — a refusal
 * reclassified as benign negotiation for a replacement that was never
 * dispatched, plus a phantom entry for it.
 *
 * The class, which is what earns a guard: **an ordering that carries an
 * invariant, pinned by nothing**. Two statements swap and the invariant is
 * gone. The suite goes red when they do — `failure-shape.test.js` and
 * `cap-ordering.test.js` both fail — so this guard does not stand IN PLACE of
 * behavioural cover. It localizes the contract to the two statements carrying
 * it, naming the rule where it lives.
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

/** Every occurrence, because "exactly one" is the assertion this guard needs. */
function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('the wall-clock cap is checked before a ledger entry is minted, not after', () => {
  const body = functionBody('plugins/oai/scripts/lib/chat.mjs', /^export async function postWithDegrade\b/);

  const cap = body.indexOf('capBudgets(');
  const begin = body.indexOf('.begin(');
  assert.ok(cap >= 0, 'postWithDegrade no longer calls capBudgets — was it renamed? Update this guard.');
  assert.ok(begin >= 0, 'postWithDegrade no longer calls ledger.begin — was it renamed? Update this guard.');
  assert.ok(
    cap < begin,
    'capBudgets must run BEFORE ledger.begin: an entry minted first files a request that never went ' +
      'on the wire as a physical attempt, and settles a pending refusal that nothing replaced.',
  );
});

/**
 * The reason the ordering guard above is no longer sufficient on its
 * own: it proves *a* cap check precedes the ledger entry, not that the checked
 * budget is the one the transport actually gets. While `postChat` re-evaluated
 * the cap on its own side, both statements could be true and a cap falling due
 * between them still minted an entry for a request that was never sent.
 *
 * Same class as the guard above, and behaviourally covered too:
 * `cap-ordering.test.js` drives an expiry into that window with a controlled
 * clock, and fails if `postChat` recomputes. This pins where the rule lives.
 */
test('the cap is evaluated exactly once per dispatch, and that evaluation is what the transport gets', () => {
  const degrade = functionBody('plugins/oai/scripts/lib/chat.mjs', /^export async function postWithDegrade\b/);
  const post = functionBody('plugins/oai/scripts/lib/chat.mjs', /^async function postChat\b/);

  assert.equal(
    occurrences(degrade, 'capBudgets('),
    1,
    'postWithDegrade must evaluate the cap ONCE: two evaluations can disagree, and the gap between ' +
      'them is where a phantom ledger entry is minted.',
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
    'postChat must NOT re-evaluate the cap — that second call IS the defect this guards against.',
  );
  // Proves the absence assertion above is not vacuous: an assert-absence over a
  // wrongly-bounded body would pass on an empty string. `postChat` genuinely
  // contains the request it is being checked around.
  assert.match(post, /request\(profile, '\/chat\/completions'/, 'postChat body not bounded correctly — fix this guard.');
});

/**
 * The one call-site argument in the transport that decides retryability.
 *
 * `bodyStream`'s catch only ever runs past headers, so its failures are dropped
 * *deliveries* and must stay retryable whether or not Node attached a `code`.
 * Measured on Node 26.3: a socket cut mid-body arrives as `Error: aborted`
 * carrying `ECONNRESET`, which the transient whitelist happens to accept — so
 * deleting `{ delivered: true }` leaves the retry verdict unchanged today
 * (the whitelist alone still classifies it retryable) and wrong on a Node that
 * hands over the same error bare, which the comment at that catch records
 * having already seen once. `serverResponded` is a separate story: `delivered`
 * sets it unconditionally, so the deletion changes that field today, visibly,
 * caught by `tests/transport-classification.test.js`'s
 * `'a server that sent headers is not reported as one that never answered'`.
 * No real server on Node 26.3 can be driven into
 * dropping the code — `tests/transport-classification.test.js`'s
 * `'the catch below classifies a code-less delivery failure as retryable'`
 * drives `bodyStream` directly with a stub iterable to pin that behaviourally;
 * this structural check is the second, independent guard on the same call-site
 * argument, kept because a passing behavioural test elsewhere doesn't prove
 * this line still reads `{ delivered: true }`.
 */
test('the body-stream catch classifies its failures as delivered, whatever code Node attached', () => {
  const body = functionBody('plugins/oai/scripts/lib/http.mjs', /^export async function\* bodyStream\b/);

  assert.match(
    body,
    /transportError\(error, url, \{ delivered: true \}\)/,
    'bodyStream must pass `delivered: true`: past headers a failure is a dropped delivery and is ' +
      'retryable regardless of `error.code`, which Node does not promise to attach.',
  );
});

// A UserError message built at the HTTP response boundary must not interpolate
// something the SERVER controls — profile.baseUrl, a redirect Location header,
// an echoed response body, a JSON.parse error quoting the input, a raw
// content-encoding header. `.message` is what `errorReport()` persists into
// `jobs.db` and what an uncaught worker error prints to its own job log.
//
// DENYLIST, not allowlist: the substrings in TAINTED_SUBSTRINGS below — the
// offending variable names and the destination fields themselves, in case one
// is ever read back into a message — are what this guard can prove wrong. An
// interpolation matching none of them passes unchecked; SAFE_MESSAGE_EXPRESSIONS
// exempts an expression a listed substring would otherwise flag.
//
// Known limitation, stated rather than hidden: this only sees a template
// literal passed DIRECTLY to `new UserError(` or `reword(` — a message built
// in an intermediate variable (`http-errors.mjs`'s `budgetMessages`) is
// unscanned. Its interpolations (`host`, `seconds`, `received`) are local
// config/counters, not server response content, which is why that gap was
// accepted rather than closed.
const RESPONSE_BOUNDARY_FILES = [
  'plugins/oai/scripts/lib/http.mjs',
  'plugins/oai/scripts/lib/http-errors.mjs',
  'plugins/oai/scripts/lib/provider.mjs',
  'plugins/oai/scripts/lib/body.mjs',
  'plugins/oai/scripts/lib/sse.mjs',
  // Builds a UserError from an error frame the server streamed (the refusal
  // text goes on `.responseBody`), so it sits at the same boundary.
  'plugins/oai/scripts/lib/stream-collect.mjs',
  // Not transport-layer, but the same server-payload risk: `finish_reason`
  // (completion.mjs's applyFrame/applyCompletion) is read off the server's
  // JSON with no validation, and both files construct a UserError from it —
  // missed by earlier sweeps that stayed inside the transport layer.
  'plugins/oai/scripts/lib/completion.mjs',
  'plugins/oai/scripts/lib/client.mjs',
];

const TAINTED_SUBSTRINGS = [
  'baseurl', 'encoding', 'location', 'detail', 'payload', 'statustext',
  'bodyexcerpt', 'responsebody', 'excerpt', '.headers', 'finishreason',
  'finish_reason',
  // `message` generically: the original body.mjs leak (`${error.message}`,
  // JSON.parse's own error quoting a fragment of server input) is caught
  // only by this general rule, not by any of the specific field names above
  // — the fixture for it once slipped past
  // every named substring. `SAFE_MESSAGE_EXPRESSIONS` below is checked
  // FIRST, so the one legitimate exception is still excluded.
  'message',
  // `text`: body.mjs's original leak also quoted the response body itself in
  // .hint (`The reply began: ${text.trim()...}`), a second, independent
  // interpolation in the SAME historical call the `message` rule above does
  // not reach.
  'text',
];

// The deliberate exceptions: transportError's Node/OS-level syscall message
// (ECONNREFUSED, EAI_AGAIN, …), never server response content, and the static
// hint below.
const SAFE_MESSAGE_EXPRESSIONS = new Set([
  'cause.message ?? error.message',
  // provider.mjs's ECONNREFUSED hint: a static lookup table plus a hardcoded
  // fallback sentence, not server data — flagged only because that sentence's
  // own English text happens to contain the word "baseUrl".
  "START_HINTS[profile.name] ?? 'Check the server is running and the baseUrl in the config is right.'",
]);

/** Every `${...}` inside `text`, matching nested backticks (one deep is enough here). */
function interpolations(text) {
  const found = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$' || text[i + 1] !== '{') continue;
    let depth = 1;
    let j = i + 2;
    let expr = '';
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
      expr += text[j];
      j++;
    }
    found.push(expr);
    i = j;
  }
  return found;
}

/**
 * Every candidate expression inside a `new UserError(` / `reword(` call in
 * `text`: `${...}` interpolations inside its backtick-quoted argument(s),
 * PLUS a bare (non-template, non-string-literal) `hint:` value — the exact
 * shape `sse.mjs`'s original leak used (`hint: error.message`, no
 * backticks at all), which no `${...}` scan can ever see. The fixture test
 * below had once been quietly rewritten to use a templated hint, which is
 * not what the real historical bug looked like.
 */
function messageTemplates(text) {
  const candidates = [];
  const callSite = /(?:new UserError|reword)\(/g;
  let match = callSite.exec(text);
  while (match !== null) {
    // Scan forward from the call for every backtick-delimited literal up to
    // the call's closing paren — a redirect/non-redirect ternary (provider.mjs)
    // puts two template literals inside one call.
    let depth = 1;
    let k = match.index + match[0].length;
    let region = '';
    while (k < text.length && depth > 0) {
      if (text[k] === '(') depth++;
      else if (text[k] === ')') depth--;
      if (depth > 0) region += text[k];
      k++;
    }
    const backtick = /`([^`]*)`/g;
    let inner = backtick.exec(region);
    while (inner !== null) {
      candidates.push(inner[1]);
      inner = backtick.exec(region);
    }
    // A bare hint value: `hint:`'s value, up to the next comma or closing
    // brace, EXCLUDING a leading backtick/quote — a string or template
    // literal is not a variable reference (checked in JS, not the regex:
    // `\s*` backtracking around a character-class exclusion silently
    // defeats it, since the engine can retreat to a zero-width match and
    // let the excluded character satisfy a DIFFERENT, earlier position —
    // measured here, not assumed).
    const bareHint = /hint\s*:\s*([^,}]*)/g;
    let hintMatch = bareHint.exec(region);
    while (hintMatch !== null) {
      const value = hintMatch[1].trim();
      if (!/^[`'"]/.test(value)) candidates.push(`\${${value}}`);
      hintMatch = bareHint.exec(region);
    }
    callSite.lastIndex = k;
    match = callSite.exec(text);
  }
  return candidates;
}

/** Every offending `${...}` found in `source`, as `label: ${expr}` strings. */
function taintedInterpolations(source, label) {
  const offenders = [];
  for (const template of messageTemplates(source)) {
    for (const expr of interpolations(template)) {
      const trimmed = expr.trim();
      if (SAFE_MESSAGE_EXPRESSIONS.has(trimmed)) continue;
      const lower = trimmed.toLowerCase();
      if (TAINTED_SUBSTRINGS.some((word) => lower.includes(word))) {
        offenders.push(`${label}: \${${trimmed}}`);
      }
    }
  }
  return offenders;
}

test('no server-controlled value reaches a UserError message at the response boundary', () => {
  const offenders = RESPONSE_BOUNDARY_FILES.flatMap((relPath) =>
    taintedInterpolations(withoutComments(readFileSync(join(ROOT, relPath), 'utf8')), relPath),
  );
  assert.deepEqual(
    offenders,
    [],
    'a server-controlled value must travel on error.endpoint / .responseBody / .bodyExcerpt / ' +
      '.finishReason, never inside .message — all are read unconditionally by errorReport() ' +
      "(-> jobs.db) and by oai-companion.mjs's top-level catch (-> a background worker's job log). " +
      'If this is a new, genuinely safe interpolation, add it to SAFE_MESSAGE_EXPRESSIONS by hand. ' +
      'Scoped to RESPONSE_BOUNDARY_FILES only — not a repo-wide guarantee; ' +
      'plugins/oai/scripts/lib/model-selection.mjs / delegate.mjs carry a related, lower-severity gap ' +
      '(a server-reported model id can reach a UserError message, but only pre-submission, never on ' +
      'the background persistence path this guard protects).',
  );
});

// Proves the DETECTOR itself still catches the historical leaks it was
// written from — a rename in TAINTED_SUBSTRINGS or a bug in
// messageTemplates()/interpolations() could silently stop catching them, and
// the guard above would report "clean" for the wrong reason. Each fixture
// asserts EVERY expected expression, not "at least one offender found", which
// cannot catch one expression masking a second, missed one in the same call —
// the body.mjs / sse.mjs snippets keep their `.hint` clause, a SECOND,
// independent leak the `.message` clause does not cover. These are the pre-fix
// snippets — never executed, just fed through the same detector the
// guard above uses — each paired with EVERY expression it must individually flag.
const HISTORICAL_LEAKS = [
  ['describeFailure ECONNREFUSED (original)',
    'reword(error, `Cannot reach ${profile.name} at ${profile.baseUrl} — connection refused.`, { ' +
      "hint: START_HINTS[profile.name] ?? 'Check the server is running and the baseUrl in the config is right.' });",
    ['profile.baseUrl']],
  ['describeFailure ENOTFOUND (original)',
    'reword(error, `Cannot resolve the host in ${profile.baseUrl} (provider "${profile.name}").`)',
    ['profile.baseUrl']],
  ['describeFailure generic fallback (original)',
    'reword(error, `Request to ${profile.name} at ${profile.baseUrl} failed: ${error?.message ?? error}' +
      "${code ? ` (${code})` : ''}`)",
    ['profile.baseUrl', 'error?.message ?? error']],
  // A backtick nested a second level deep, inside this ternary's own
  // sub-template, is beyond what messageTemplates()'s non-nesting-aware
  // backtick scan can parse (stated, not hidden — see its own comment) — so
  // this fixture keeps the real two-templates-joined-by-`+` structure but
  // flattens the innermost ternary's sub-template to a `+` concatenation,
  // which the detector CAN see, rather than silently mis-testing a shape it
  // cannot actually parse.
  ['assertOk non-redirect body echo (original, innermost nesting flattened — see comment above)',
    'new UserError(`${profile.name} returned HTTP ${response.status}' +
      "${response.statusText ? ' ' + response.statusText : ''} for ${path}` + " +
      "`${detail.trim() ? ': ' + detail.trim() : ''}`)",
    ["response.statusText ? ' ' + response.statusText : ''", "detail.trim() ? ': ' + detail.trim() : ''"]],
  ['assertOk redirect Location (original)',
    "new UserError(`${profile.name} redirected ${path} (HTTP ${response.status}) to " +
      "${response.headers.location ?? 'an unnamed location'}.`, " +
      "{ hint: 'Point baseUrl at the final URL — redirects are deliberately not followed.' })",
    ["response.headers.location ?? 'an unnamed location'"]],
  ['body.mjs readJson (original, message AND hint both leak independently)',
    'new UserError(`${what} returned a non-JSON response: ${error.message}`, { ' +
      "hint: `The reply began: ${text.trim().slice(0, 200) || '(empty)'}` })",
    ['error.message', "text.trim().slice(0, 200) || '(empty)'"]],
  ['sse.mjs readSse (original, message AND a BARE non-template hint both leak independently)',
    'new UserError(`${what} sent an event that is not JSON: ${payload.slice(0, 200)}`, { hint: error.message })',
    ['payload.slice(0, 200)', 'error.message']],
  ['http-errors.mjs assertDecodable (original)',
    'new UserError(`${url.host} sent a ${encoding}-compressed response, which this client cannot decode.`)',
    ['encoding']],
  ['completion.mjs refuseUnusable (original)',
    'new UserError(`${profile.name} returned a completion with no message content ' +
      "(finish_reason: ${answer.finishReason ?? 'unknown'}).`)",
    ["answer.finishReason ?? 'unknown'"]],
  ['client.mjs requireAnswer (original)',
    "new UserError(`${profile.name} returned an empty answer (finish_reason: ${result.finishReason ?? 'unknown'}).`)",
    ["result.finishReason ?? 'unknown'"]],
];

test('the detector itself still catches every historical leak it was written from — EVERY expected expression, not just one', () => {
  const missed = [];
  for (const [name, snippet, expectedExprs] of HISTORICAL_LEAKS) {
    const found = new Set(taintedInterpolations(snippet, 'fixture').map((o) => o.replace(/^fixture: \$\{(.*)\}$/, '$1')));
    for (const expected of expectedExprs) {
      if (!found.has(expected)) missed.push(`${name}: expected \${${expected}} to be flagged, was not`);
    }
  }
  assert.deepEqual(
    missed,
    [],
    'a historical leak expression no longer trips the detector — TAINTED_SUBSTRINGS, messageTemplates() ' +
      'or interpolations() regressed silently.',
  );
});

// ---------------------------------------------------------------------------
// The sweep report interpolates untrusted text — model finding prose, server ids,
// git subjects, operator paths, foreign-build ledger values — into Markdown across
// three files that compose one artifact. Every such interpolation must be a
// markdown-safe wrapper call (`safeInline`/`safeBlockquoteLines`/`displayReason`),
// or an allowlisted FORMATTING exception. A new sink added unwrapped fails this
// test. This is default-deny: the rule is not a list of known-bad fields (which
// fails open on the next field added) but a positive whitelist of the ONLY safe
// interpolation SHAPE, so a value reaching render under any name is caught.
const SWEEP_RENDER_FILES = [
  'bench/lib/sweep-report.mjs',
  'bench/lib/sweep-health.mjs',
  'bench/lib/sweep-notes.mjs',
  'bench/lib/compare-report.mjs',
  'bench/lib/sweep-reproduction-report.mjs',
  // markdown-safe.mjs itself is NOT scanned — its interpolations ARE the sanitiser.
];

// Formatting / intentional-Markdown / non-report-content interpolations, per file and
// exact expression (file-bound: the same text in another file is not auto-accepted).
// NONE is untrusted data — each emits deliberate markup, or is a helper whose own
// interpolations are themselves in the scanned surface and independently wrapped.
// KNOWN WEAK EDGE: the bare-identifier entries (severity, evidence, line, note, explanation,
// why, cause) are trusted by NAME — their safety lives in a nearby assignment the grammar
// cannot bind to. A future rebinding of one of those locals to an untrusted value would pass
// silently. All are safe today (constructions visible in-file); re-verify on any change to them.
const SWEEP_SAFE_EXPRESSIONS = {
  'bench/lib/sweep-report.mjs': new Set([
    'subjectLine(entry)',   // helper: a code span, sha/subject wrapped inside it
    'answeredBy(entry)',    // helper: entry.model wrapped inside it
    'reasonSuffix(entry.reason)', // helper: displayReason inside it
    'shortfall(record)',    // helper: its own interpolations wrapped
    'tally(record.entries)',// helper: its own interpolations wrapped
    'severity',             // built with intentional ** and a wrapped finding.severity
    'evidence',             // built with intentional > and safeBlockquoteLines
    'line',                 // a built finding line (its parts wrapped)
    'note',                 // an incompleteness() sentence — fixed prose / wrapped in sweep-notes
    'explanation',          // fixed prose — explanationFor: WHY table via Object.hasOwn, starvedExplanation, or failedExplanation
    'why',                  // explanation + reasonSuffix, both safe
    'cause',                // fixed prose composed from wrapped scanLimit/walked
    'indent',               // layout whitespace — MUST NOT be wrapped (safeInline flattens it)
    'stamp',                // a filename, not report content
    'renderSweep(record)',  // the composed report string
    'JSON.stringify(record, null, 2)', // the private JSON record, not report markdown
  ]),
  'bench/lib/sweep-health.mjs': new Set([
    "outages.map(outageLabel).join(', ')", // composition of the wrapped outageLabel
  ]),
  'bench/lib/sweep-notes.mjs': new Set([]),
  // compare-report.mjs wraps every interpolation in safeInline/displayReason and
  // composes its table rows by concatenating already-wrapped cells (no ${…}), so
  // it needs no formatting exceptions — but the entry must exist, or the test's
  // `SWEEP_SAFE_EXPRESSIONS[rel].has(...)` throws on undefined.
  'bench/lib/compare-report.mjs': new Set([]),
  // sweep-reproduction-report.mjs emits every untrusted scalar through a safeInline/
  // displayReason ${…} interpolation (scanned here); the one residual is the matrix
  // column header (run stamps via runs.map, wrapped but no ${…}) — no formatting
  // exception, so the set is empty — but the entry must exist, or the `.has(...)` throws.
  'bench/lib/sweep-reproduction-report.mjs': new Set([]),
};

// String-aware comment stripping — a deliberate fork of the shared `withoutComments`
// above, not consolidated with it: `withoutComments` also feeds the credential
// leak detector, whose historical-leak inputs are pinned by their own test, so making the
// shared stripper string-aware would change that detector's blast radius.
//
// A single whole-source scan, so it is correct where a naive stripper is a false NEGATIVE (a sink
// hidden from the guard): `//` or `/* */` INSIDE a string/template is preserved (a report template can
// legitimately hold a `https://` URL or `/* */` text before a `${sink}`), and string state carries
// across lines so a `//` on a multi-line template's continuation line is not mistaken for a comment.
// REAL comments — `//` to end of line, `/* */` across lines, both outside any string — are removed, so
// a `${…}` example inside a doc comment does not become a false POSITIVE.
function sweepStripComments(source) {
  let out = '';
  let quote = null; // the ', " or ` currently open, or null
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 1; continue; } // an escaped char cannot close the string
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '/') { // line comment — skip to end of line
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') { // block comment — skip to the closing */
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1; // the loop's own i++ consumes the final '/'
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    out += c;
  }
  return out;
}

// The anchored, NO-OPTIONS grammar — an exact allowlist, not a classifier. An interpolation is
// accepted iff it is exactly one of `W(ARG)`, `W(ARG).slice(0, 9)` (safeCodeSpan only) or
// `W(ARG) || '<literal>'` (single-quoted, no interior quote, backslash, backtick or `|`), where W is a
// listed wrapper and ARG is made only of identifiers, `.`, `?.`, balanced parentheses, `?`, `:`, `-`,
// the literal `', '`, whitespace, and commas inside any parenthesis nested within the call's own (a
// comma directly inside the call's own would be a second, options argument). ARG admits no other
// quote literal and no backtick, `/`, `"`, `+`, `[` or `{`, so no string, template, regex or comment
// can hold a parenthesis: the parentheses counted are the call's own, and the wrapper call provably
// spans the interpolation up to one of the listed suffixes.
const SWEEP_WRAPPERS = /^(safeInline|safeCodeSpan|safeBlockquoteLines|displayReason)\s*\(/;
const SWEEP_ARG_TOKEN = /\s+|[A-Za-z_$][\w$]*|\?\.|', '|[.?:\-(),]/y;
function sweepInterpolationAccepted(expr, wrappers = SWEEP_WRAPPERS) {
  const t = expr.trim();
  const head = wrappers.exec(t);
  if (!head) return false;
  const wrapper = head[0].replace(/\s*\($/, '');
  let depth = 1;
  let j = head[0].length;
  while (depth > 0) {
    SWEEP_ARG_TOKEN.lastIndex = j;
    const token = SWEEP_ARG_TOKEN.exec(t);
    if (!token) return false;
    if (token[0] === '(') depth += 1;
    else if (token[0] === ')') depth -= 1;
    else if (token[0] === ',' && depth === 1) return false; // a second argument
    j += token[0].length;
  }
  if (t.slice(head[0].length, j - 1).trim() === '') return false;
  const rest = t.slice(j).trim();
  if (rest === '') return true;
  if (rest === '.slice(0, 9)') return wrapper === 'safeCodeSpan';
  return /^\|\|\s*'[^'\\`|]*'$/.test(rest);
}

test('every untrusted interpolation in the sweep render files is markdown-safe-wrapped or an exception', () => {
  const offenders = [];
  for (const rel of SWEEP_RENDER_FILES) {
    const allowed = SWEEP_SAFE_EXPRESSIONS[rel];
    const source = sweepStripComments(readFileSync(join(ROOT, rel), 'utf8'));
    for (const expr of interpolations(source)) {
      const t = expr.trim();
      if (allowed.has(t)) continue;
      if (sweepInterpolationAccepted(t)) continue;
      offenders.push(`${rel}: \${${t}}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'an untrusted value reaches the sweep report unescaped — wrap it in safeInline/safeBlockquoteLines, or ' +
      'safeCodeSpan inside a code span (fallback via a trailing `|| \'literal\'`); add a file-bound ' +
      'SWEEP_SAFE_EXPRESSIONS entry ONLY for intentional Markdown/layout that is provably safe.',
  );
});

// Positive control: the grammar must actually fire, pinned here so a broken
// grammar fails rather than passing vacuously.
test('the sweep interpolation grammar rejects unsafe shapes and accepts the wrapped ones (positive control)', () => {
  const mustReject = [
    'entry.model',
    "abortAfter ?? '(not recorded)'",
    'safeInline(entry.model) + entry.provider',
    'slice',
    'obj[entry.key]',
    "cond ? `${entry.model}` : ''",
    'safeInline(x, { whenAbsent: entry.model })',
    'safeInline(x, { continuation: entry.model })',
    "safeInline(x) || entry.model",
    "safeInline(x) || 'a' + 'b'",
    "safeInline(x) || '' + entry.y",
    'record.newlyAddedField',
    // Parentheses inside a quote, template, regex or comment, around a value outside the wrapper call.
    "safeCodeSpan('(') + row.id + (')')",
    'safeCodeSpan(`(`) + row.id + (`)`)',
    'safeCodeSpan(/[(]/.source) + row.id + (/[)]/.source)',
    'safeCodeSpan(a /* ( */) + row.id + (/* ) */ b)',
    // Outside the exact allowlist.
    'safeInline(entry.sha).slice(0, 9)',
    "safeCodeSpan(entry.sha).slice(0, 9) || 'x'",
    'safeCodeSpan(entry.sha).slice(0, 12)',
    'safeInline(x) || "unknown"',
    'safeInline()',
    'safeInline(a, b)',
    'safeInline(a + b)',
    'safeInline(a[b])',
    'safeInline({ a })',
    "safeInline(f('a'))",
    'safeInline("a")',
    'safeInline(a / b)',
    // A fallback literal holding a backtick or `|`, which opens a code span or ends a table cell.
    "safeInline(x) || 'a|b'",
    "safeCodeSpan(x) || '`'",
  ];
  const mustAccept = [
    'safeInline(entry.model)',
    'safeCodeSpan(entry.model)',
    "safeInline(entry.model) || 'unknown'",
    'safeCodeSpan(entry.sha).slice(0, 9)',
    'safeBlockquoteLines(finding.evidence)',
    "safeInline(where) || '(no location given)'",
    'safeInline(record.include)',
    'displayReason(reason)',
    'safeInline(String(run.integrity.discarded))',
    "safeInline(s.values.join(', '))",
    'safeInline(enumerated - reviewed)',
    "safeCodeSpan(hasFile ? finding.file : finding.line) || '(no location given)'",
    'safeCodeSpan(run.report?.model)',
    'safeInline(axisValue(run.signature.hard.maxSeconds))',
  ];
  const wrongly = [];
  for (const e of mustReject) if (sweepInterpolationAccepted(e)) wrongly.push(`accepted unsafe: ${e}`);
  for (const e of mustAccept) if (!sweepInterpolationAccepted(e)) wrongly.push(`rejected safe: ${e}`);
  assert.deepEqual(wrongly, [], 'the sweep interpolation grammar mis-classified a control case.');
});

test('sweepStripComments preserves interpolations in strings/templates and drops only real comments', () => {
  // False NEGATIVE cases — an interpolation that must survive stripping, or the guard misses a sink:
  // a `//` inside a string before it.
  assert.deepEqual(interpolations(sweepStripComments('x(`- see https://example.com ${entry.model}`);')), ['entry.model']);
  // a `/* */` inside a TEMPLATE (not a comment) before it.
  assert.deepEqual(interpolations(sweepStripComments('x(`/* note */ ${entry.model}`);')), ['entry.model']);
  // a `//` on a multi-line template's continuation line.
  assert.deepEqual(interpolations(sweepStripComments('x(`line one // not a comment\n${entry.model}`);')), ['entry.model']);
  // False POSITIVE cases — a real comment's example interpolation must be removed:
  assert.deepEqual(interpolations(sweepStripComments('const x = 1; // ${entry.model} in a comment')), []);
  assert.deepEqual(interpolations(sweepStripComments('/* ${entry.model} in a\n block comment */ const y = 2;')), []);
});

// ---------------------------------------------------------------------------
// Inside an inline code span Markdown renders everything literally except a backtick (and a `|`
// still ends a table cell), so a value there needs `safeCodeSpan` (backtick and `|` neutralised,
// whitespace folded) — never `safeInline`, whose dot-replacement would print `qwen3_coder` as
// `qwen3.coder`, and never nothing, which lets a backtick end the span. Every `${…}` inside a code
// span in a bench file must be exactly one `safeCodeSpan(…)` call in the grammar above (optionally
// `.slice(0, 9)` or `|| 'literal'`). A code-span delimiter is a backtick in a string or template
// literal as the literal decodes it — raw in a quoted string, or escaped as \` in either; a hex or
// unicode escape of one (\x60, \u0060, \u{60}) is decoded as a backtick and also refused outright.
// A span left open at the end of its literal is refused, since concatenation could carry a value
// into it. Only single-backtick delimiters are recognised, so a run of two or more decoded backticks
// is refused rather than read as two empty spans around a value. A backtick after an odd run of
// decoded backslashes is refused where it would open a span: Markdown prints it as a literal
// backtick, so what follows sits in prose. Before a closing delimiter a backslash is span content and
// is accepted. Inside an open span the literal text may hold no `|` (GFM splits the table cell
// before any span forms) and no line break, and the only escapes accepted there are `\\` and `\``.
// `safeCodeSpan` is refused everywhere except at the head of such an interpolation (or as a plain
// import specifier, below): in prose it leaves `_`, `*` and `[` live. A markdown-safe wrapper name
// (`safeCodeSpan`, `safeInline`, `displayReason`, `safeBlockquoteLines`) is accepted only as a call or
// as a plain specifier of an `import {…} from '…'` clause whose module specifier resolves, against
// the scanned file, to bench/lib/markdown-safe.mjs; a comment inside the braces is ignored unless it
// holds a `}`, which ends the clause early (the import is then refused). Refused:
// an `as` with a wrapper name on either side, a wrapper imported from any other module, the name
// written directly after `function`, and, outside such a clause, the name anywhere it is not followed
// by `(` — which covers a variable declaration, a parameter, a destructured binding and a bare reference.
//
// The scan is a guard against an accidentally unescaped value, not against contrived source. It does
// not see a delimiter built at runtime (`String.fromCharCode(96)` and the like), a regex literal the
// lexer misreads and so desynchronises on, or a backslash supplied from outside the literal (a
// preceding `${…}`, a `\x5c` or `\u005c` escape, `String.raw`). Nor does it see a value placed into a
// literal by runtime string construction — `replace`/`replaceAll`, `split`/`join`, a format helper —
// the same class as a delimiter built at runtime — nor an import whose comment text fakes the end of
// the clause, or a unicode-escaped identifier or string name in one. The rendering tests — values
// printed verbatim, table column counts — are the behavioural backstop for those.
const CODE_SPAN_WRAPPER = /^safeCodeSpan\s*\(/;
const CODE_SPAN_HELPER = 'safeCodeSpan';
const MARKDOWN_SAFE_WRAPPERS = new Set(['safeCodeSpan', 'safeInline', 'displayReason', 'safeBlockquoteLines']);
// Every bench driver and library file: a file that emits no code span contributes nothing, so a
// new renderer is covered without being listed. markdown-safe.mjs is the sanitiser itself.
const CODE_SPAN_SCAN_FILES = [
  ...readdirSync(join(ROOT, 'bench')).filter((name) => name.endsWith('.mjs')).map((name) => `bench/${name}`),
  ...readdirSync(join(ROOT, 'bench/lib')).filter((name) => name.endsWith('.mjs')).map((name) => `bench/lib/${name}`),
].filter((rel) => rel !== 'bench/lib/markdown-safe.mjs');

// A `/` in code position opens a regex literal when the previous significant character cannot end
// an operand. Skipping regex bodies keeps a quote or backtick inside one from desynchronising the scan.
const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

// A backtick written as an escape in a string or template literal: `\``, `\x60`, `\u0060` or `\u{60}`.
const BACKTICK_ESCAPE = /\\(?:`|x60|u0060|u\{0*60\})/y;

/**
 * Every `${…}` in `source` that sits inside a Markdown code span, every one outside, and every
 * literal that leaves a code span open, uses a multi-backtick or backslash-escaped opening delimiter,
 * or that the scan could not close, or whose span text holds a `|`, a line break or an escape other
 * than `\\` or `\`` — plus every use of `safeCodeSpan` that is not the head of an in-span
 * interpolation, and every wrapper name used other than as a call or a plain import specifier from
 * markdown-safe.mjs. `rel` is the scanned file's repo-relative path, against which an import's module
 * specifier is resolved.
 */
function codeSpanInterpolations(source, rel = 'bench/lib/control.mjs') {
  const inSpan = [];
  const outside = [];
  const problems = [];
  let i = 0;
  const n = source.length;
  let last = '';
  const lineAt = (index) => source.slice(0, index).split('\n').length;

  // The escape at `at` when it decodes to a backtick, or null; a hex or unicode form is refused.
  function escapedBacktick(at, kind) {
    BACKTICK_ESCAPE.lastIndex = at;
    const escape = BACKTICK_ESCAPE.exec(source);
    if (escape && escape[0] !== '\\`') problems.push(`line ${lineAt(at)}: a hex or unicode backtick escape in a ${kind}`);
    return escape;
  }

  function quoted(quote) {
    const start = i;
    let j = i + 1;
    let backticks = 0;
    let previous = false; // the last decoded character was a backtick
    let backslashes = 0; // decoded backslashes immediately before the current character
    while (j < n && source[j] !== quote) {
      if (source[j] === '\n') { problems.push(`line ${lineAt(start)}: unterminated string`); break; }
      const spanOpen = backticks % 2 === 1;
      if (spanOpen && (source[j] === '|' || source[j] === '\r')) {
        problems.push(`line ${lineAt(start)}: a \`|\` or line break inside a code span in a quoted string`);
      }
      let width = 1;
      let backtick = source[j] === '`';
      let backslash = false;
      if (source[j] === '\\') {
        const escape = escapedBacktick(j, 'quoted string');
        width = escape ? escape[0].length : 2;
        backtick = escape !== null;
        backslash = source[j + 1] === '\\';
        if (spanOpen && !backtick && !backslash) {
          problems.push(`line ${lineAt(start)}: an escape other than \\\\ or \\\` inside a code span in a quoted string`);
        }
      }
      if (backtick) {
        if (backticks % 2 === 0 && backslashes % 2 === 1) {
          problems.push(`line ${lineAt(start)}: a backslash-escaped backtick as an opening code-span delimiter in a quoted string`);
        }
        backticks += 1;
        if (previous) problems.push(`line ${lineAt(start)}: a multi-backtick code-span delimiter in a quoted string`);
      }
      previous = backtick;
      backslashes = backslash ? backslashes + 1 : 0;
      j += width;
    }
    if (backticks % 2 === 1) problems.push(`line ${lineAt(start)}: a code span crosses the end of a quoted string`);
    i = j + 1;
  }

  function regex() {
    let inClass = false;
    i += 1;
    while (i < n) {
      const c = source[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') return;
      if (inClass) { if (c === ']') inClass = false; } else if (c === '[') inClass = true; else if (c === '/') { i += 1; break; }
      i += 1;
    }
    while (i < n && /[a-z]/i.test(source[i])) i += 1;
  }

  // Code until the `}` closing the current `${`, or to the end of the source at top level.
  // `spanHead`: this is an interpolation inside a code span, whose head may be `safeCodeSpan`.
  function code(topLevel, spanHead = false) {
    let depth = 0;
    const start = i;
    last = '';
    while (i < n) {
      const c = source[i];
      const next = source[i + 1];
      if (c === '/' && next === '/') { while (i < n && source[i] !== '\n') i += 1; continue; }
      if (c === '/' && next === '*') { const end = source.indexOf('*/', i + 2); i = end === -1 ? n : end + 2; continue; }
      if (c === "'" || c === '"') { quoted(c); last = 'x'; continue; }
      if (c === '`') { i += 1; template(); last = 'x'; continue; }
      if (c === '/' && (REGEX_PRECEDERS.has(last) || /\breturn$/.test(source.slice(Math.max(0, i - 8), i).trimEnd()))) { regex(); last = 'x'; continue; }
      if (/[A-Za-z_$]/.test(c) && !/[\w$]/.test(source[i - 1] ?? '')) {
        let j = i;
        while (j < n && /[\w$]/.test(source[j])) j += 1;
        const word = source.slice(i, j);
        const importClause =
          word === 'import' && topLevel && depth === 0 ? /^(import\s*\{([^}]*)\}\s*from\s*)(['"])([^'"\n]*)\3/.exec(source.slice(i)) : null;
        if (importClause) {
          const [, head, specifiers, , module] = importClause;
          const fromMarkdownSafe =
            /^\.\.?\//.test(module) && posix.normalize(posix.join(posix.dirname(rel), module)) === 'bench/lib/markdown-safe.mjs';
          // A comment inside the braces would otherwise join the specifier beside it and hide its name.
          // A block comment becomes a space, so `a/**/as/**/b` still reads as a rename.
          const uncommented = specifiers.replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*/g, (token) =>
            token[0] === '/' ? ' ' : token,
          );
          for (const specifier of uncommented.split(',').map((part) => part.trim()).filter(Boolean)) {
            const names = specifier.split(/\s+as\s+/).map((name) => name.replace(/^['"]|['"]$/g, ''));
            if (names.length > 1) {
              const wrapper = names.find((name) => MARKDOWN_SAFE_WRAPPERS.has(name));
              if (wrapper) problems.push(`line ${lineAt(i)}: an import renamed onto or from ${wrapper}`);
            } else if (MARKDOWN_SAFE_WRAPPERS.has(names[0]) && !fromMarkdownSafe) {
              problems.push(`line ${lineAt(i)}: ${names[0]} imported from ${module}, not bench/lib/markdown-safe.mjs`);
            }
          }
          j = i + head.length;
        } else if (word === CODE_SPAN_HELPER && !(spanHead && source.slice(start, i).trim() === '')) {
          problems.push(`line ${lineAt(i)}: safeCodeSpan used outside the head of a code-span interpolation`);
        } else if (
          MARKDOWN_SAFE_WRAPPERS.has(word) &&
          (!/^\s*\(/.test(source.slice(j)) || /\bfunction\s*\*?\s*$/.test(source.slice(Math.max(0, i - 16), i)))
        ) {
          problems.push(`line ${lineAt(i)}: ${word} used other than as a call or a plain import specifier`);
        }
        i = j;
        last = 'x';
        continue;
      }
      if (c === '{') depth += 1;
      if (c === '}') {
        if (depth === 0 && !topLevel) { const expr = source.slice(start, i); i += 1; return expr; }
        depth -= 1;
      }
      if (!/\s/.test(c)) last = /[\w$)\].]/.test(c) ? 'x' : c;
      i += 1;
    }
    if (!topLevel) problems.push('an interpolation never closes');
    return source.slice(start, i);
  }

  function template() {
    const start = i;
    let open = false;
    let previous = false; // the last decoded character was a backtick
    let backslashes = 0; // decoded backslashes immediately before the current character
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        const escape = escapedBacktick(i, 'template literal');
        if (escape) {
          if (!open && backslashes % 2 === 1) {
            problems.push(`line ${lineAt(i)}: a backslash-escaped backtick as an opening code-span delimiter in a template literal`);
          }
          if (previous) problems.push(`line ${lineAt(i)}: a multi-backtick code-span delimiter in a template literal`);
          open = !open;
          previous = true;
          backslashes = 0;
          i += escape[0].length;
        } else {
          if (open && source[i + 1] !== '\\') {
            problems.push(`line ${lineAt(i)}: an escape other than \\\\ or \\\` inside a code span in a template literal`);
          }
          previous = false;
          backslashes = source[i + 1] === '\\' ? backslashes + 1 : 0;
          i += 2;
        }
        continue;
      }
      previous = false;
      backslashes = 0;
      if (open && (c === '|' || c === '\n' || c === '\r')) {
        problems.push(`line ${lineAt(i)}: a \`|\` or line break inside a code span in a template literal`);
      }
      if (c === '`') {
        i += 1;
        if (open) problems.push(`line ${lineAt(start)}: a code span crosses the end of a template literal`);
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        const spanOpen = open;
        i += 2;
        const expr = code(false, spanOpen).trim();
        (spanOpen ? inSpan : outside).push(expr);
        continue;
      }
      i += 1;
    }
    problems.push(`line ${lineAt(start)}: unterminated template literal`);
  }

  code(true);
  return { inSpan, outside, problems };
}

test('every value interpolated inside a Markdown code span in bench/ is escaped with safeCodeSpan', () => {
  const offenders = [];
  for (const rel of CODE_SPAN_SCAN_FILES) {
    const { inSpan, problems } = codeSpanInterpolations(readFileSync(join(ROOT, rel), 'utf8'), rel);
    for (const problem of problems) offenders.push(`${rel}: ${problem}`);
    for (const expr of inSpan) {
      if (!sweepInterpolationAccepted(expr, CODE_SPAN_WRAPPER)) offenders.push(`${rel}: \`\${${expr}}\``);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a value inside a code span is not escaped for one — wrap it as `${safeCodeSpan(x)}` (fallback via a ' +
      "trailing `|| 'literal'`); safeInline would dot its `_`, `*` and `[`, and no escape lets a backtick end the span.",
  );
});

test('the code-span scan reaches every bench renderer that emits a code span', () => {
  const sites = (rel) => codeSpanInterpolations(readFileSync(join(ROOT, rel), 'utf8'), rel).inSpan.length;
  for (const rel of SWEEP_RENDER_FILES) assert.ok(CODE_SPAN_SCAN_FILES.includes(rel), `${rel} is not scanned`);
  for (const rel of [
    'bench/lib/report.mjs',
    'bench/lib/caveats.mjs',
    'bench/lib/reliability-report.mjs',
    'bench/lib/compare-report.mjs',
    'bench/lib/sweep-report.mjs',
    'bench/lib/sweep-health.mjs',
    'bench/lib/sweep-reproduction-report.mjs',
    'bench/task-run.mjs',
  ]) {
    assert.ok(CODE_SPAN_SCAN_FILES.includes(rel), `${rel} is not scanned`);
    assert.ok(sites(rel) > 0, `${rel}: the scan found no code-span interpolation in a file known to emit one`);
  }
});

// Positive control: the scan and its grammar must fire, so a broken scanner fails here rather
// than passing the enforcing test vacuously.
test('the code-span scan flags unescaped and prose-escaped values and accepts safeCodeSpan (positive control)', () => {
  // A control is a source scanned as a default bench/lib file, or a `[rel, source]` pair.
  const flagged = (control) => {
    const [rel, source] = Array.isArray(control) ? control : [undefined, control];
    const { inSpan, problems } = codeSpanInterpolations(source, rel);
    return [...problems, ...inSpan.filter((expr) => !sweepInterpolationAccepted(expr, CODE_SPAN_WRAPPER))];
  };
  const mustFlag = [
    'x(`- \\`${entry.model}\\``);',
    'x(`- \\`${safeInline(entry.model)}\\``);',
    'x(`- \\`${displayReason(reason)}\\``);',
    "x(`\\`${safeCodeSpan(a) || b}\\``);",
    'x(`${rows.map((row) => `\\`${row.id}\\``).join(", ")}`);',
    "x('- `' + entry.model + '`');",
    'x(`- \\`open ${safeCodeSpan(a)}` + entry.model + "`");',
    'const re = /[`\'"]/g; x(`\\`${entry.model}\\``);',
    'function f() { return /`/.test(a) ? `\\`${entry.model}\\`` : ""; }',
    // safeCodeSpan anywhere but the head of an in-span interpolation.
    'x(`- ${safeCodeSpan(entry.model)} in prose`);',
    "x('- ' + safeCodeSpan(entry.model));",
    'const where = safeCodeSpan(a); x(`- \\`${where}\\``);',
    'x(`- ${list.map(safeCodeSpan).join(", ")}`);',
    "x(`\\`${b || safeCodeSpan(a)}\\``);",
    "x(`\\`${safeCodeSpan(list.map((part) => safeCodeSpan(part)).join(':'))}\\``);",
    // A multi-backtick delimiter, in a template and in a quoted string.
    'x(`| \\`\\`${row.id}\\`\\` |`);',
    "x('``' + row.id + '``');",
    // An escaped backtick in a quoted string is a delimiter too, alone or beside another.
    "x('\\`\\`' + row.id + '\\`\\`');",
    "x('\\``' + row.id + '`\\`');",
    // A hex or unicode backtick escape, balanced around a wrapped value or not.
    "x('\\x60' + row.id + '\\x60');",
    'x(`\\x60${safeCodeSpan(a)}\\x60`);',
    "x('\\u0060' + row.id + '\\u{60}');",
    // Parentheses inside a quote, template, regex or comment, closing the wrapper call early.
    "x(`\\`${safeCodeSpan('(') + row.id + (')')}\\``);",
    'x(`\\`${safeCodeSpan(`(`) + row.id + (`)`)}\\``);',
    'x(`\\`${safeCodeSpan(/[(]/.source) + row.id + (/[)]/.source)}\\``);',
    'x(`\\`${safeCodeSpan(a /* ( */) + row.id + (/* ) */ b)}\\``);',
    // A backslash-escaped backtick as the opening delimiter: Markdown prints it, leaving the value in prose.
    'x(`\\\\\\`${safeCodeSpan(x)}\\\\\\``);',
    "x('\\\\`a`');",
    // A fallback literal holding a `|`, which ends a table cell.
    "x(`| \\`${safeCodeSpan(a) || 'a|b'}\\` |`);",
    // A wrapper name bound to something else: an `as` rename, a declaration or a parameter.
    "import { identity as safeCodeSpan } from './ident.mjs';\nx(`\\`${safeCodeSpan(a)}\\``);",
    "import { identity as safeInline } from './x.mjs';\nx(`- ${safeInline(a)}`);",
    'const safeInline = (x) => x; x(`- ${safeInline(a)}`);',
    'function displayReason(r) { return r; }',
    'const f = (safeBlockquoteLines) => safeBlockquoteLines(a);',
    "export { identity as safeInline } from './x.mjs';",
    "import * as safeInline from './x.mjs';",
    // A wrapper renamed away from its own name, or imported from anywhere but markdown-safe.mjs.
    "import { safeCodeSpan as code } from './markdown-safe.mjs';\nx(`- ${code(m)} in prose`);",
    "import { safeInline } from './ident.mjs';\nx(`- ${safeInline(a)}`);",
    "import { safeInline } from './x/markdown-safe.mjs';\nx(`- ${safeInline(a)}`);",
    "import { safeInline } from 'markdown-safe.mjs';\nx(`- ${safeInline(a)}`);",
    ['bench/task-run.mjs', "import { safeInline } from './markdown-safe.mjs';\nx(`- ${safeInline(a)}`);"],
    // A comment inside an import's braces, beside a wrapper imported from elsewhere or renamed.
    "import {\n  // escapes prose\n  safeInline,\n} from './ident.mjs';\nx(`- ${safeInline(a)}`);",
    "import {\n  identity as safeInline // c\n} from './ident.mjs';\nx(`- ${safeInline(a)}`);",
    "import { safeInline /* c */ } from './ident.mjs';\nx(`- ${safeInline(a)}`);",
    "import {\n  // span escaper\n  safeCodeSpan as code,\n} from './markdown-safe.mjs';\nx(`- ${code(m)} in prose`);",
    "import { safeCodeSpan/**/as/**/code } from './markdown-safe.mjs';\nx(`- ${code(m)} in prose`);",
    // A quoted specifier holding `//` is a string, not a comment.
    "import { \"x//y\" as safeInline } from './x.mjs';\nx(`- ${safeInline(a)}`);",
    // A `|` in span text ends the table cell (GFM splits the cell first, so no span forms); a line
    // break ends the table row, and is refused everywhere for simplicity.
    'x(`| \\`Model | ${safeCodeSpan(row.id)}\\` |`);',
    "x('a `b|c` d');",
    'x(`\\`a\nb\\``);',
    // An escape other than \\ or \` in span text, in a template and in a quoted string.
    'x(`\\`a\\nb\\``);',
    'x(`\\`a\\|b\\``);',
    'x(`\\`a\\x7cb\\``);',
    'x(`\\`a\\u000ab\\``);',
    "x('`a\\nb`');",
    "x('`a\\|b`');",
    "x('`a\\x7cb`');",
    "x('`a\\u000ab`');",
  ];
  const mustPass = [
    'x(`- \\`${safeCodeSpan(entry.model)}\\``);',
    "x(`- \\`${safeCodeSpan(entry.model) || '(none)'}\\` and ${safeInline(entry.subject)}`);",
    'x(`\\`${safeCodeSpan(entry.sha).slice(0, 9)}\\``);',
    'x(`- ${entry.model} outside any span`);',
    "x('a `literal` span ' + n);",
    '// a comment: `\\`${entry.model}\\``\nx(1);',
    'const half = total / 2; x(`\\`${safeCodeSpan(half)}\\``);',
    'const re = /[\'"`]/g; x(`\\`${safeCodeSpan(a)}\\``);',
    "import { safeCodeSpan, safeInline } from './markdown-safe.mjs';\nx(`\\`${safeCodeSpan(a)}\\``);",
    "import {\n  safeCodeSpan,\n} from './markdown-safe.mjs';\nx(`\\`${safeCodeSpan(a)}:${safeCodeSpan(b)}\\``);",
    // A backslash before a closing delimiter is span content, not an escape.
    'x(`\\`${safeCodeSpan(a)}\\\\\\``);',
    "import { safeInline } from \"./markdown-safe.mjs\";\nx(`- ${safeInline(a)}`);",
    "import { safeCodeSpan, safeInline } from './markdown-safe.mjs'; // see https://example.com//x\nx(`- ${safeInline(a)}`);",
    "import {\n  // span escaper\n  safeCodeSpan, /* prose */ safeInline,\n} from './markdown-safe.mjs';\nx(`\\`${safeCodeSpan(a)}\\` ${safeInline(b)}`);",
    ['bench/task-run.mjs', "import { safeCodeSpan, safeInline } from './lib/markdown-safe.mjs';\nx(`\\`${safeCodeSpan(a)}\\``);"],
    // A `|` or an escape outside a span is not span text.
    'x(`| \\`${safeCodeSpan(a)}\\` |\\n`);',
  ];
  const wrongly = [];
  for (const source of mustFlag) if (flagged(source).length === 0) wrongly.push(`not flagged: ${source}`);
  for (const source of mustPass) if (flagged(source).length > 0) wrongly.push(`flagged: ${source} — ${flagged(source)}`);
  assert.deepEqual(wrongly, [], 'the code-span scan mis-classified a control case.');
});

// The same scan over real renderers with one site mutated in memory: a double-backtick span around a
// raw value, a safeCodeSpan call moved out of its span into prose, and a span built from escaped
// backticks in quoted strings. Each mutant must change the source (or the control proves nothing)
// and must be flagged.
test('the code-span scan flags a double-backtick, prose-position or escaped-quote-span mutant of a real renderer (negative control)', () => {
  const mutants = [
    ['bench/lib/report.mjs', '| \\`${safeCodeSpan(row.id)}\\`', '| \\`\\`${row.id}\\`\\`'],
    ['bench/lib/sweep-report.mjs', '*(answered by \\`${safeCodeSpan(entry.model)}\\`)*', '*(answered by ${safeCodeSpan(entry.model)})*'],
    ['bench/lib/caveats.mjs', '**\\`--temperature ${safeCodeSpan(temperature)}\\` was on**', '**--temperature ${safeCodeSpan(temperature)} was on**'],
    // The span written as escaped backticks in quoted strings, around a raw value.
    ['bench/lib/report.mjs', "`| \\`${safeCodeSpan(row.id)}\\`${row.dropped ? ` +${row.dropped} unlisted` : ''} | ", "'| \\`' + row.id + '\\` |' + ` "],
  ];
  for (const [rel, from, to] of mutants) {
    const source = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(source.includes(from), `${rel}: the site to mutate is gone — update this control`);
    const { inSpan, problems } = codeSpanInterpolations(source.replace(from, to), rel);
    const flagged = [...problems, ...inSpan.filter((expr) => !sweepInterpolationAccepted(expr, CODE_SPAN_WRAPPER))];
    assert.ok(flagged.length > 0, `${rel}: the mutant ${to} was not flagged`);
  }
});

// ---------------------------------------------------------------------------
// A non-sampling numeric flag's domain is written once, in `numeric-bounds.mjs`. The commands' parse, the bench's
// up-front check and the comparison's reading of a recorded value each read that table, so none of
// them can widen or narrow a flag the others still enforce.
const NUMERIC_BOUND_READERS = ['plugins/oai/scripts/lib/delegate.mjs', 'bench/run.mjs', 'bench/lib/compare-model.mjs'];

test('every non-sampling numeric flag bound is read from the one table in numeric-bounds.mjs, never written out', () => {
  const offenders = [];
  for (const rel of NUMERIC_BOUND_READERS) {
    const source = sweepStripComments(readFileSync(join(ROOT, rel), 'utf8'));
    for (const match of source.matchAll(/\b(min|max|integer)\s*:/g)) {
      offenders.push(`${rel}: line ${source.slice(0, match.index).split('\n').length}: ${match[0]}`);
    }
    if (!/\b(BENCH_)?NUMERIC_BOUNDS\b/.test(source)) offenders.push(`${rel}: does not read the bounds table`);
  }
  assert.deepEqual(offenders, [], 'a numeric bound is written out at a validator — read it from numeric-bounds.mjs instead');
});

test('the bounds table holds the domains the commands and the bench document', () => {
  assert.deepEqual({ ...NUMERIC_BOUNDS.temperature }, { min: 0, max: 2 });
  assert.deepEqual({ ...NUMERIC_BOUNDS.timeout }, { min: 1, max: MAX_BUDGET_SECONDS });
  assert.deepEqual({ ...NUMERIC_BOUNDS['max-seconds'] }, { min: 1, max: MAX_BUDGET_SECONDS });
  assert.deepEqual({ ...NUMERIC_BOUNDS['max-tokens'] }, { integer: true, min: 1 });
  assert.deepEqual({ ...BENCH_NUMERIC_BOUNDS['max-tokens'] }, { integer: true, min: MIN_REVIEW_RESERVE_TOKENS });
  for (const flag of Object.keys(NUMERIC_BOUNDS).filter((key) => key !== 'max-tokens')) {
    assert.equal(BENCH_NUMERIC_BOUNDS[flag], NUMERIC_BOUNDS[flag], `${flag}: the bench's bound is the commands' own`);
  }
});
