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

// Confirmed defect class: `mkdtempSync` called across the suite with no
// cleanup leaked temp dirs, and three files each hand-rolled their own
// independent cleanup copy that could drift from the other two. `tempDir` in
// tests/helpers.mjs is now the single place a scratch dir is created and
// tracked for cleanup — a bare `mkdtempSync` call anywhere else in tests/ is
// the same defect reappearing.
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

// Confirmed twice — scripts/oai-companion.mjs (commit 31c98d7) and
// bench/review-sweep.mjs (OAI-198) — so promoted to a guard: process.exit() tears
// the process down before queued stdio writes drain, truncating a large stdout
// or stderr payload at the pipe buffer. process.exitCode plus a natural return
// lets Node drain first. Scoped to this repo's actual CLI entrypoints rather than banned
// repo-wide: scripts/lib/job-heartbeat.mjs has a deliberate process.exit(0) whose
// side effect (closing the model socket to stop generation server-side) is the
// point, and bench/task-cases/prototype-lookup/witness.mjs is corpus data, not
// production CLI surface.
const CLI_ENTRYPOINTS = [
  'scripts/oai-companion.mjs', // the one file always run directly; no self-invocation guard needed
  'bench/run.mjs', // process.argv[1] self-invocation guard
  'bench/review-sweep.mjs', // process.argv[1] self-invocation guard
  'bench/recover-sweep.mjs', // process.argv[1] self-invocation guard
  'bench/task-run.mjs', // process.argv[1] self-invocation guard
  'bench/ttl-challenge.mjs', // process.argv[1] self-invocation guard
  'bench/compare.mjs', // process.argv[1] self-invocation guard
  'bench/sweep-reproduction.mjs', // process.argv[1] self-invocation guard
];
test('CLI entrypoints use process.exitCode, never process.exit()', () => {
  // Comments are stripped first: this defect class's own explanatory comments
  // (including the one above this test, and scripts/oai-companion.mjs's own)
  // inherently mention the banned call by name.
  const offenders = [];
  for (const rel of CLI_ENTRYPOINTS) {
    const file = join(ROOT, rel);
    if (/\bprocess\.exit\s*\(/.test(withoutComments(readFileSync(file, 'utf8')))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'use process.exitCode instead — see .claude/REPO_TRAPS.md');
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
 * Proved by mutation: moving
 * `capBudgets` below `ledger.begin` in `postWithDegrade` left all 370 tests
 * green while reopening the exact defect this guards against on the capability-rung
 * path — a refusal reclassified as benign negotiation for a replacement that was
 * never dispatched, plus a phantom entry for it.
 *
 * The class, which is what earns a guard: **an ordering that carries an
 * invariant, pinned by nothing**. Two statements swap and the invariant is gone.
 * The suite no longer stays green when they do — `failure-shape.test.js` and
 * `cap-ordering.test.js` both go red — so this guard does not stand IN PLACE of
 * behavioural cover, though it once claimed to. It localizes the
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

/** Every occurrence, because "exactly one" is the assertion this guard needs. */
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
  const degrade = functionBody('scripts/lib/chat.mjs', /^export async function postWithDegrade\b/);
  const post = functionBody('scripts/lib/chat.mjs', /^async function postChat\b/);

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
  const body = functionBody('scripts/lib/http.mjs', /^export async function\* bodyStream\b/);

  assert.match(
    body,
    /transportError\(error, url, \{ delivered: true \}\)/,
    'bodyStream must pass `delivered: true`: past headers a failure is a dropped delivery and is ' +
      'retryable regardless of `error.code`, which Node does not promise to attach.',
  );
});

// Confirmed FOUR times: a UserError message
// built at the HTTP response boundary interpolated something the SERVER
// controls — profile.baseUrl, a redirect Location header, an echoed response
// body, a JSON.parse error quoting the input, a raw content-encoding header —
// each one independently discovered because
// nothing forced the next call site to remember the others. `.message` is what
// `errorReport()` persists into `jobs.db` and what an uncaught worker error
// prints to its own job log, so this graduates from a reviewer's prompt to a
// guard per this file's own header rule.
//
// DENYLIST, not allowlist: the four confirmed variable names (plus the
// destination fields themselves, in case one is ever read back into a
// message) are what this guard can prove wrong. It cannot prove a NEW
// interpolation is safe — that judgement still belongs to a reviewer — so a
// legitimate new interpolation is added to SAFE_MESSAGE_EXPRESSIONS by hand,
// a conscious decision, never silently passed.
//
// Known limitation, stated rather than hidden: this only sees a template
// literal passed DIRECTLY to `new UserError(` or `reword(` — a message built
// in an intermediate variable (`http-errors.mjs`'s `budgetMessages`) is
// unscanned. Its interpolations (`host`, `seconds`, `received`) are local
// config/counters, not server response content, which is why that gap was
// accepted rather than closed.
const RESPONSE_BOUNDARY_FILES = [
  'scripts/lib/http.mjs',
  'scripts/lib/http-errors.mjs',
  'scripts/lib/provider.mjs',
  'scripts/lib/body.mjs',
  'scripts/lib/sse.mjs',
  // Not transport-layer, but the same server-payload risk: `finish_reason`
  // (completion.mjs's applyFrame/applyCompletion) is read off the server's
  // JSON with no validation, and both files construct a UserError from it —
  // missed by earlier sweeps that stayed inside the transport layer.
  'scripts/lib/completion.mjs',
  'scripts/lib/client.mjs',
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

// The one reviewed-safe exception: transportError's Node/OS-level syscall
// message (ECONNREFUSED, EAI_AGAIN, …), never server response content.
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
      'If this is a new, genuinely safe interpolation, add it to SAFE_MESSAGE_EXPRESSIONS by hand ' +
      '(OAI-185). Scoped to RESPONSE_BOUNDARY_FILES only — not a repo-wide guarantee; ' +
      'scripts/lib/model-selection.mjs / delegate.mjs carry a related, lower-severity, deferred gap ' +
      '(a server-reported model id can reach a UserError message, but only pre-submission, never on ' +
      'the background persistence path this feature protects — OAI-185 residue).',
  );
});

// Nothing
// proved the DETECTOR itself still catches the exact historical leaks it was
// written from — a rename in TAINTED_SUBSTRINGS or a bug in
// messageTemplates()/interpolations() could silently stop catching them, and
// the guard above would report "clean" for the wrong reason. The first version
// of this block was not what it claimed: fixtures
// had been simplified (the body.mjs / sse.mjs snippets dropped their `.hint`
// clause entirely, which is a SECOND, independent leak in the same call the
// `.message` clause does not cover) and each fixture asserted only "at least
// one offender found," which cannot catch one expression masking a second,
// missed one in the same call. These are the pre-fix snippets, verbatim —
// never executed, just fed through the
// same detector the guard above uses — each paired with EVERY expression it
// must individually flag.
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

test('the detector itself still catches every historical leak this ladder found — EVERY expected expression, not just one', () => {
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
      'or interpolations() regressed silently (OAI-185).',
  );
});

// ---------------------------------------------------------------------------
// The sweep report interpolates untrusted text — model finding prose, server ids,
// git subjects, operator paths, foreign-build ledger values — into Markdown across
// three files that compose one artifact. Every such interpolation must be a
// markdown-safe wrapper call (`safeInline`/`safeBlockquoteLines`/`displayReason`),
// or a reviewed FORMATTING exception. A new sink added unwrapped fails this test
// (OAI-213). This is default-deny: the rule is not a list of known-bad fields (which
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
    'explanation',          // fixed prose (WHY table via Object.hasOwn, or starvedExplanation)
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
// above, not consolidated with it: `withoutComments` also feeds the OAI-185 credential
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

// The anchored, NO-OPTIONS grammar: an interpolation is accepted iff it is exactly one
// balanced wrapper call (single argument — no top-level comma, so a two-arg options
// call is rejected outright), optionally `.slice(<int>, <int>)`, and/or a trailing
// `|| '<string literal>'` (one quote-delimited run, no interior quote or concatenation).
// The argument is ALWAYS passed through the sanitiser, so concat inside it is safe;
// concat/spread/shorthand/indirect option injection cannot be written into this shape.
const SWEEP_WRAPPERS = /^(safeInline|safeBlockquoteLines|displayReason)\s*\(/;
function sweepArgHasTopLevelComma(argText) {
  let depth = 0;
  for (const c of argText) {
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) return true;
  }
  return false;
}
function sweepInterpolationAccepted(expr) {
  const t = expr.trim();
  const m = SWEEP_WRAPPERS.exec(t);
  if (!m) return false;
  const open = m[0].length - 1; // index of the wrapper's '('
  let depth = 1;
  let j = open + 1;
  for (; j < t.length && depth > 0; j++) {
    if (t[j] === '(') depth++;
    else if (t[j] === ')') depth--;
  }
  if (depth !== 0) return false; // unbalanced
  if (sweepArgHasTopLevelComma(t.slice(open + 1, j - 1))) return false; // exactly one argument
  let rest = t.slice(j).trim();
  const sliceMatch = /^\.slice\(\s*\d+\s*,\s*\d+\s*\)/.exec(rest);
  if (sliceMatch) rest = rest.slice(sliceMatch[0].length).trim();
  if (rest === '') return true;
  // optional trailing || '<string literal>' — a whole single quote-delimited run
  return /^\|\|\s*'[^'\\]*'$/.test(rest) || /^\|\|\s*"[^"\\]*"$/.test(rest);
}

test('every untrusted interpolation in the sweep render files is markdown-safe-wrapped or an exception (OAI-213)', () => {
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
    'an untrusted value reaches the sweep report unescaped — wrap it in safeInline/safeBlockquoteLines ' +
      '(fallback via a trailing `|| \'literal\'`); add a file-bound SWEEP_SAFE_EXPRESSIONS entry ONLY for ' +
      'intentional Markdown/layout that is provably safe (OAI-213).',
  );
});

// Positive control: the grammar and the walker must actually fire. Proven against the
// pre-fix files (56 offenders); here pinned so a broken grammar/walker fails rather
// than passing vacuously.
test('the sweep interpolation grammar rejects unsafe shapes and accepts the wrapped ones (OAI-213 positive control)', () => {
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
  ];
  const mustAccept = [
    'safeInline(entry.model)',
    "safeInline(entry.model) || 'unknown'",
    'safeInline(entry.sha).slice(0, 9)',
    'safeBlockquoteLines(finding.evidence)',
    "safeInline(where) || '(no location given)'",
    'safeInline(record.include)',
    'displayReason(reason)',
  ];
  const wrongly = [];
  for (const e of mustReject) if (sweepInterpolationAccepted(e)) wrongly.push(`accepted unsafe: ${e}`);
  for (const e of mustAccept) if (!sweepInterpolationAccepted(e)) wrongly.push(`rejected safe: ${e}`);
  assert.deepEqual(wrongly, [], 'the sweep interpolation grammar mis-classified a control case (OAI-213).');
});

test('sweepStripComments preserves interpolations in strings/templates and drops only real comments (OAI-213)', () => {
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
