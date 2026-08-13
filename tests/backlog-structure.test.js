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
// THE INVARIANT CHANGED ON 2026-08-08 and this guard encodes the CURRENT
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
  // PER TIER, and only the CONTIGUOUS LEADING run of entry-shaped bold after each tier heading.
  //
  // Shape alone is not enough, and that was mutation-proved: with a global shape test, deleting an id
  // from tier 12c's entry list and leaving a bare `**OAI-133**` inside an ordinary sentence left the
  // guard GREEN — prose silently satisfied the index requirement, so the priority view could lose an
  // item with nothing going red. This is the ambiguity CLAUDE.md documents as a convention humans must
  // remember ("refer to items in other tiers without bold"); a convention a human must remember is
  // precisely what a guard is for.
  //
  // Position is what disambiguates: entries lead the tier, prose follows. Once a bold run containing
  // WORDS appears, the tier's entry list is over and every later bold id is prose.
  //
  // The leading run is a SEQUENCE, not one bold: tier 1 writes `**OAI-62, OAI-67**` while tiers 11 and
  // 12c write `**OAI-106**, **OAI-105**`. Both are accepted deliberately — requiring a single form
  // would force a rewrite of BACKLOG.md, which is a format migration nobody asked for.
  // Split on the WHOLE bold heading. Splitting on just `**Tier ` leaves the heading's closing `**` in
  // the chunk, so the first "bold run" found is the whitespace between heading and entries — which
  // fails the shape test and ends the entry list before it starts. That mistake reported 89 live
  // items as unindexed rather than passing quietly, which is the failure direction to prefer.
  for (const tier of tiers.split(/\*\*Tier [^*]*\*\*/).slice(1)) {
    // Consume bold runs from the START of the chunk, accepting ONLY commas and whitespace between
    // them. The first time anything else intervenes, the entry list is over.
    //
    // TESTING THE RUN'S SHAPE IS NOT ENOUGH AND THAT WAS MUTATION-PROVED TWICE. A bare `**OAI-133**`
    // sitting in an ordinary sentence has exactly the shape of an entry, so a shape-only rule counts
    // it and the guard stays green while the id has been dropped from its tier. Position is the only
    // thing that separates them, so position is what this reads.
    // AND THE RUN MUST END IN A PERIOD. Position alone was still not enough, and an adversarial
    // re-review found the hole after this file shipped: de-index OAI-133 and open the following
    // SENTENCE with it — `**OAI-135**, **OAI-133** is discussed here.` — and the leading run swallows
    // the prose subject, because a bold id starting a sentence is shape-identical to a trailing entry
    // and position cannot separate them either.
    //
    // Every tier in BACKLOG.md terminates its entry list with `**.` — checked across all twelve. So
    // the terminator is what disambiguates. A tier whose leading run is NOT period-terminated parses
    // as having NO entry list, and every id in it reports unindexed: a LOUD failure on an unrecognised
    // format, which is the direction a guard should fail in. The alternative was the explicit tier
    // grammar this repo declined twice as a format migration nobody asked for.
    const entries = /^(?:\s*\*\*(OAI-\d+(?:\s*,\s*OAI-\d+)*,?)\*\*\s*,?)+\./.exec(tier);
    if (entries) for (const id of entries[0].match(/OAI-\d+/g)) ids.push(id);
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

test('no id appears twice among the live bodies', () => {
  // Its own assertion, because NOTHING ELSE HERE CAN SEE A DUPLICATE BODY — mutation-proved: every
  // other body-side check funnels through `new Set(BODIES)`, and the ascending-order comparison is
  // strictly less-than, so equal adjacent ids are not an ordering break. Duplicating a body left all
  // five original assertions green. CLAUDE.md requires every id to resolve to exactly ONE live
  // heading, and until this line nothing enforced the "one" half.
  const seen = new Set();
  const repeated = [];
  for (const id of BODIES) {
    if (seen.has(id) && !repeated.includes(id)) repeated.push(id);
    seen.add(id);
  }
  assert.deepEqual(repeated, [], `more than one live body for: ${repeated.join(', ')}`);
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

test('item bodies are in ascending id order', () => {
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
  // unknowable from the files (ids are cited by plans and prose too), and a guard
  // that guesses its own domain is the class this file exists to remove. The
  // absorbed-ID table is checked for shape only.
  const table = BACKLOG.split('Absorbed IDs')[1] ?? '';
  const rows = [...table.matchAll(/^\|\s*\*\*(OAI-\d+)\*\*\s*\|\s*\*\*(OAI-\d+)\*\*\s*\|/gm)];
  const live = new Set(BODIES);
  const unresolved = rows.filter(([, , to]) => !live.has(to)).map(([, from, to]) => `${from} -> ${to}`);
  assert.deepEqual(unresolved, [], `absorbed id redirects to something not live: ${unresolved.join(', ')}`);
});
