// Structural invariants: the tracker's own index (OAI-104).
//
// `BACKLOG.md` and CLAUDE.md both claim the tier list is asserted against the item
// bodies by the sweep's close-out, "so the two cannot drift apart silently". Until
// this file existed there was no such script anywhere in the repo — the claim was
// the reason nobody looked, which is this repo's "a check that reports success may
// be one that cannot fail" class applied to its own tracker.
//
// It caught real drift the day it was written: tier 12 still listed six IDs closed
// the previous day, OAI-131 and OAI-106 were each indexed under two tiers, and one
// body (OAI-123) sat out of ID order behind OAI-134.
//
// THE INVARIANT CHANGED ON 2026-08-08 (adr/025) and this guard encodes the CURRENT
// one, not the pre-migration "index sequence equals heading sequence": the tier list
// is the PRIORITY view, the bodies sit in ascending ID order, and a re-order rewrites
// only the index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (name) => readFileSync(ROOT + name, 'utf8');

/**
 * The tier index's ENTRIES, distinguished from prose that merely names an item.
 *
 * Both are bold — CLAUDE.md notes the collision ("a single bolded **OAI-n** inside
 * the tier prose parses as a tier entry"). The discriminator is that an entry run
 * contains NOTHING BUT ids, commas and whitespace, where prose contains words:
 *
 *     **OAI-62, OAI-67, OAI-66**            -> entries
 *     **OAI-62 leads by position only**     -> prose
 *
 * Validated against the real file when written: 99 entry references across 12 tiers,
 * and every one of the 24 bold runs it classifies as prose is a sentence.
 */
export function indexEntries(backlog) {
  const tiers = backlog.split('<!-- tiers -->')[1]?.split('<!-- /tiers -->')[0];
  assert.ok(tiers, 'BACKLOG.md has no <!-- tiers -->...<!-- /tiers --> section');
  const ids = [];
  for (const [, run] of tiers.matchAll(/\*\*([^*]+)\*\*/g)) {
    const t = run.trim();
    if (/^OAI-\d+(\s*,\s*OAI-\d+)*,?$/.test(t)) ids.push(...t.match(/OAI-\d+/g));
  }
  return ids;
}

/** Live item bodies, in file order. A body is a top-level `- **OAI-n**` list item. */
export function bodyIds(backlog) {
  return [...backlog.matchAll(/^- \*\*(OAI-\d+)\*\*/gm)].map((m) => m[1]);
}

/**
 * Every id CLOSED OUT by a tracker (done or parked) — heading-shaped items only.
 *
 * Matching any bolded id here instead reports five live items as closed: a done
 * entry's prose legitimately names live work ("leaves for **OAI-11**", "OAI-84 was
 * not a sequencing dependency"). Measured when this guard was written, and the
 * reason the shape is pinned to the same `- **OAI-n**` heading `bodyIds` uses.
 */
const closedIds = (text) => new Set([...text.matchAll(/^- \*\*(OAI-\d+)\*\*/gm)].map((m) => m[1]));

const num = (id) => Number(id.slice(4));

const BACKLOG = read('BACKLOG.md');
const INDEX = indexEntries(BACKLOG);
const BODIES = bodyIds(BACKLOG);

test('no id is listed twice in the tier index', () => {
  const seen = new Set();
  const repeated = [];
  for (const id of INDEX) {
    if (seen.has(id) && !repeated.includes(id)) repeated.push(id);
    seen.add(id);
  }
  assert.deepEqual(repeated, [], `indexed under more than one tier: ${repeated.join(', ')}`);
});

test('the tier index covers the live set exactly', () => {
  const index = new Set(INDEX);
  const bodies = new Set(BODIES);
  // Reported as two separate lists because the two failures have different fixes:
  // an indexed id with no body is usually one closed and not de-indexed, while a
  // body with no index entry is an item filed without being prioritised.
  const indexedNotLive = [...index].filter((id) => !bodies.has(id));
  const liveNotIndexed = [...bodies].filter((id) => !index.has(id));
  assert.deepEqual(indexedNotLive, [], `in the tier index with no live body: ${indexedNotLive.join(', ')}`);
  assert.deepEqual(liveNotIndexed, [], `live body missing from the tier index: ${liveNotIndexed.join(', ')}`);
});

test('item bodies are in ascending id order (adr/025)', () => {
  const breaks = [];
  for (let i = 1; i < BODIES.length; i++) {
    if (num(BODIES[i]) < num(BODIES[i - 1])) breaks.push(`${BODIES[i - 1]} -> ${BODIES[i]}`);
  }
  assert.deepEqual(breaks, [], `bodies out of ascending order at: ${breaks.join(', ')}`);
});

test('no id is both live and closed out', () => {
  // The drift this catches from the other side: an item moved to DONE whose tier
  // entry stayed behind reads as live to a reader of the index alone.
  const done = closedIds(read('BACKLOG_DONE.md'));
  const parked = closedIds(read('BACKLOG_PARKED.md'));
  const live = new Set(BODIES);
  const both = [...live].filter((id) => done.has(id) || parked.has(id));
  assert.deepEqual(both, [], `live in BACKLOG.md and also closed out: ${both.join(', ')}`);
});

test('every id in the tier index resolves to a live body', () => {
  // Deliberately NOT "every id ever issued resolves somewhere": that set is
  // unknowable from the files (ids are cited by ADRs and plans too), and a guard
  // that guesses its own domain is the class this file exists to remove. The
  // absorbed-ID table is checked for shape only.
  const table = BACKLOG.split('Absorbed IDs')[1] ?? '';
  const rows = [...table.matchAll(/^\|\s*\*\*(OAI-\d+)\*\*\s*\|\s*\*\*(OAI-\d+)\*\*\s*\|/gm)];
  const live = new Set(BODIES);
  const unresolved = rows.filter(([, , to]) => !live.has(to)).map(([, from, to]) => `${from} -> ${to}`);
  assert.deepEqual(unresolved, [], `absorbed id redirects to something not live: ${unresolved.join(', ')}`);
});
