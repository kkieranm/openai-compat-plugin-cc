// What happens when nothing can size the provider's window.
//
// The whole-file rung is then skipped — a request nobody can measure is what
// killed commit 77c1eab97 on a cold process (492,053 prompt chars against a
// 61,696 window, `empty-completion` in 14s) — and the report has to SAY it was
// skipped, because a quiet diff-only review reads exactly like a full one.
//
// The witness for the skip is the fake server's REQUEST LOG, never the report
// text: a report is what the code claims it did, and this file exists to check
// what it did. The absent content is a line that appears only in the whole file
// and never in the diff, so a change that re-attaches the bodies is caught by
// content rather than by a marker a renderer could rename.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chatRequests,
  completion,
  createRepo,
  git,
  modelList,
  respondJson,
  runCompanion,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';

const FINDINGS = JSON.stringify({ analysis: 'a', findings: [], summary: 'No defects found.' });

// Far enough from the edit that no diff context can reach it, so its absence
// from the request means the body was not sent — not merely that the hunk was
// small. Asserting on generic file text would fail spuriously: every changed
// line is inside the diff by construction.
const OUTSIDE_THE_HUNK = 'const farFromAnyHunk = "only-in-the-whole-file";';

/**
 * A repo whose one tracked file has a distinctive line the diff cannot show.
 *
 * Committed first and edited afterwards, which is what puts the marker outside
 * the hunk. Written whole in the first commit and then touched at the end.
 */
async function repoWithDistantMarker() {
  const dir = await createRepo();
  const padding = Array.from({ length: 20 }, (_, index) => `const filler${index} = ${index};`).join('\n');
  writeFileSync(join(dir, 'code.js'), `${OUTSIDE_THE_HUNK}\n${padding}\nexport const tail = 0;\n`);
  await git(['add', 'code.js'], dir);
  await git(['commit', '--quiet', '-m', 'code'], dir);
  writeFileSync(join(dir, 'code.js'), `${OUTSIDE_THE_HUNK}\n${padding}\nexport const tail = 1;\n`);
  return dir;
}

/** A server that answers both the model listing and the review. */
async function reviewServer(body = FINDINGS) {
  return startFakeServer((request, response) => {
    if (request.url.includes('/models')) return respondJson(response, modelList('test-model'));
    return respondJson(response, completion(body));
  });
}

/** A provider with, or without, a window figure. */
function configFor(server, contextLength) {
  const local = { baseUrl: server.baseUrl, defaultModel: 'test-model' };
  if (contextLength) local.contextLength = contextLength;
  return writeConfig({ defaultProvider: 'local', providers: { local } }).path;
}

const sentPrompt = (server) => chatRequests(server)[0].body.messages[1].content;

// The remedy sentence, which the negative controls assert is ABSENT. Checking
// only that the JSON flag is false would leave a render condition mutated to
// fire unconditionally invisible — the flag stays false and the note prints
// anyway. This is the assertion that makes that mutation go red.
const REMEDY = /Set "contextLength" for "local"/;

test('an unsized window withholds the diff-covered bodies, and says so', async () => {
  const dir = await repoWithDistantMarker();
  const server = await reviewServer();
  const configPath = configFor(server, null);

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  const prompt = sentPrompt(server);
  assert.doesNotMatch(prompt, new RegExp(OUTSIDE_THE_HUNK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the body never went: nothing could size the request');
  assert.match(prompt, /--- DIFF ---/, 'the diff still did');
  const report = JSON.parse(result.stdout);
  assert.equal(report.skippedUnsizedWindow, true);
  assert.equal(report.hunksOnly, true, 'and the state the reader already knew about');
});

test('a known window sends the bodies and prints no remedy', async () => {
  // Negative control. The rung ran, so there is nothing to disclose — and a
  // note that fires here would be false about a review that saw everything.
  const dir = await repoWithDistantMarker();
  const server = await reviewServer();
  const configPath = configFor(server, 131_072);

  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  assert.match(sentPrompt(server), new RegExp(OUTSIDE_THE_HUNK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(JSON.parse(json.stdout).skippedUnsizedWindow, false);
  assert.doesNotMatch(text.stdout, REMEDY, 'nothing was withheld, so nothing is disclosed');
});

test('--diff-only under an unsized window is not this case', async () => {
  // Negative control. The bodies were not asked for, so they were not withheld
  // — attributing this to the window would send the reader after a config key
  // that would change nothing.
  const dir = await repoWithDistantMarker();
  const server = await reviewServer();
  const configPath = configFor(server, null);

  const json = await runCompanion(['review', '--diff-only', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review', '--diff-only'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).skippedUnsizedWindow, false);
  assert.doesNotMatch(text.stdout, REMEDY);
});

test('nothing diff-covered to withhold is not this case either', async () => {
  // Negative control. An untracked file appears in no diff and is never
  // droppable, so it goes whole whatever the window is; `changed` is empty and
  // the disclosure would be describing an omission that did not happen.
  const dir = await createRepo();
  writeFileSync(join(dir, 'brand-new.js'), 'export const added = true;\n');
  const server = await reviewServer();
  const configPath = configFor(server, null);

  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(json.status, 0, json.stderr);
  assert.match(sentPrompt(server), /--- FILE: brand-new\.js ---/, 'the only copy of this code still goes');
  assert.equal(JSON.parse(json.stdout).skippedUnsizedWindow, false);
  assert.doesNotMatch(text.stdout, REMEDY);
});

test('the JSON and the text report agree that the bodies were withheld', async () => {
  // The drift this repo keeps producing: a caveat true on one rendering and
  // absent from the next. Two runs of the same scenario, one per view.
  const first = await repoWithDistantMarker();
  const firstServer = await reviewServer();
  const text = await runCompanion(['review'], { configPath: configFor(firstServer, null), cwd: first });
  await firstServer.close();

  const second = await repoWithDistantMarker();
  const secondServer = await reviewServer();
  const json = await runCompanion(['review', '--json'], { configPath: configFor(secondServer, null), cwd: second });
  await secondServer.close();

  assert.equal(JSON.parse(json.stdout).skippedUnsizedWindow, true);
  assert.match(text.stdout, /could not be determined/, 'the cause');
  assert.match(text.stdout, REMEDY, 'and the remedy');
});

test('a reply that could not be parsed still discloses the withheld bodies', async () => {
  // The branch `caveats()` never reaches. A run that skipped the bodies AND
  // came back as prose is the one most likely to be read as "the model had
  // nothing to say", and it is exactly where the note was missing.
  const dir = await repoWithDistantMarker();
  const server = await reviewServer('I had a look and I am not sure.');
  const configPath = configFor(server, null);

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.match(result.stdout, /could not be determined/, 'the cause survives the unparsed path');
  assert.match(result.stdout, REMEDY);
});

// The remedy has to be doable by whoever just read it, and which remedy is right
// is decided by whether a config entry EXISTS — never by what the profile is
// called. Keying it on the name was a real defect: a user may legitimately
// configure a provider named "custom", which is also the name an ad-hoc
// --base-url run gets. Both tests below go through resolveProfile, because the
// fact is set there; a unit test on the note alone cannot catch it being lost.
test('an ad-hoc --base-url run is told to add a provider, not to edit one it lacks', async () => {
  const dir = await repoWithDistantMarker();
  const server = await reviewServer();
  const configPath = configFor(server, null);

  const result = await runCompanion(['review', '--base-url', `${server.baseUrl}/v1`], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /the server given with --base-url/, 'there is no config entry to name');
  assert.match(result.stdout, /Add a provider entry/, 'so the remedy is to create one');
  assert.doesNotMatch(result.stdout, /Set "contextLength" for "custom"/, 'never a key the user does not have');
});

test('a provider legitimately named "custom" gets the config remedy, not the ad-hoc one', async () => {
  // The collision. "custom" is the name an ad-hoc profile is given, and it is
  // also a name a user may choose; only the branch that BUILT the profile knows
  // which happened.
  const dir = await repoWithDistantMarker();
  const server = await reviewServer();
  const { path: configPath } = writeConfig({
    defaultProvider: 'custom',
    providers: { custom: { baseUrl: server.baseUrl, defaultModel: 'test-model' } },
  });

  const result = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Set "contextLength" for "custom" in the config/, 'the entry exists — name it');
  assert.doesNotMatch(result.stdout, /--base-url/, 'this run named a configured provider');
});
