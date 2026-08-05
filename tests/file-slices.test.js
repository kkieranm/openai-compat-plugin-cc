// Attaching part of a file, and the warning that makes it safe to.
//
// The whole risk of a slice is the model concluding that something is undefined
// when it is defined ten lines above the cut. `review.mjs` names this exactly:
// telling a model it has a whole file it does not have is "the very defect this
// argument exists to remove". So the tests that matter here are the ones about
// what the request SAYS, not about the slicing arithmetic.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMessages, parseFileArg, readFileBlocks, requestTextOf } from '../scripts/lib/prompt.mjs';

function fileWith(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'oai-slice-'));
  const path = join(dir, 'a.txt');
  writeFileSync(path, lines.join('\n'));
  return path;
}

const TEN = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);

test('a plain path is not a slice, and a colon elsewhere is not either', async () => {
  assert.deepEqual(parseFileArg('src/a.mjs'), { path: 'src/a.mjs', slice: null });
  assert.deepEqual(parseFileArg('C:/x/a.mjs'), { path: 'C:/x/a.mjs', slice: null });
  // A bare `:N` is not a range. Guessing an end is how one slice silently
  // becomes a different one.
  assert.deepEqual(parseFileArg('a.mjs:12'), { path: 'a.mjs:12', slice: null });
});

test('a range is parsed, and a backwards or zero range is refused', async () => {
  assert.deepEqual(parseFileArg('a.mjs:3-9'), { path: 'a.mjs', slice: { start: 3, end: 9 } });
  assert.throws(() => parseFileArg('a.mjs:9-3'), /ends before it starts/);
  assert.throws(() => parseFileArg('a.mjs:0-3'), /line numbers start at 1/);
});

test('a slice carries exactly the requested lines', async () => {
  const [block] = readFileBlocks([`${fileWith(TEN)}:3-5`]);
  assert.equal(block.content, 'line3\nline4\nline5');
  assert.deepEqual(block.slice, { start: 3, end: 5, of: 10 });
});

test('an end past the last line is CLAMPED, not refused', async () => {
  // "40 to the end" is an ordinary thing to mean, and refusing it would make the
  // caller count lines to ask about a file they are looking at.
  const [block] = readFileBlocks([`${fileWith(TEN)}:8-999`]);
  assert.equal(block.content, 'line8\nline9\nline10');
  assert.equal(block.slice.end, 10);
});

test('a start past the end of the file IS refused, naming the real length', async () => {
  assert.throws(() => readFileBlocks([`${fileWith(TEN)}:50-60`]), /the file has 10 lines/);
});

test('the block header states the range, so the fact travels with the content', async () => {
  const files = readFileBlocks([`${fileWith(TEN)}:3-5`]);
  const [, user] = buildMessages({ prompt: 'what is here?', files });
  assert.match(user.content, /--- FILE: .*a\.txt \(lines 3-5 of 10\) ---/);
});

test('a sliced request WARNS the model not to call things undefined', async () => {
  // The load-bearing assertion of this file.
  const files = readFileBlocks([`${fileWith(TEN)}:3-5`]);
  const [, user] = buildMessages({ prompt: 'what is here?', files });
  assert.match(user.content, /PARTIAL/);
  assert.match(user.content, /do not report an identifier as undefined, unimported or missing/);
});

test('a whole-file request is unchanged — no header suffix, no note', async () => {
  const files = readFileBlocks([fileWith(TEN)]);
  const [, user] = buildMessages({ prompt: 'what is here?', files });
  assert.doesNotMatch(user.content, /PARTIAL/);
  assert.doesNotMatch(user.content, /\(lines /);
  assert.match(user.content, /--- FILE: .*a\.txt ---/);
});

test('slicing does not break what /oai:status shows as the request', async () => {
  // `requestTextOf` finds the tail after the last `\n--- END FILE: `, and the
  // status line renders its first line. The slice note sits between the blocks
  // and the prompt, so it must not become what the job "was asked to do".
  const files = readFileBlocks([`${fileWith(TEN)}:3-5`, fileWith(TEN)]);
  const [, user] = buildMessages({ prompt: 'the real request', files });
  assert.equal(requestTextOf(user.content).split('\n').pop(), 'the real request');
});
