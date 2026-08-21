// Structural invariants: the tracker's own index.
//
// `BACKLOG.md` and CLAUDE.md both claim item bodies are asserted against each other by the sweep's
// close-out, "so the two cannot drift apart silently". Until this file existed there was no such
// script anywhere in the repo — the claim was the reason nobody looked, which is this repo's "a
// check that reports success may be one that cannot fail" class applied to its own tracker.
//
// The tier-ranking index and the absorbed-ID redirect table were retired. This file used to also
// assert the tier index's shape (no id indexed twice, the index covers the live set exactly) and
// the absorbed-ID table's shape (every redirect resolves to a live body). The tier checks have no
// replacement — there is no more priority-ranking pass over `BACKLOG.md`. The absorbed-table check
// DOES have one, below ("every stub bullet's target resolves in the same tracker"): a merged item
// now gets a one-line stub bullet (`- **OAI-n** — Absorbed into OAI-m; see that item.`) wherever the
// item it merged into lives. The duplicate/ordering checks below see a stub's OWN id, the same as
// any other bullet, but NOT its target — a stub whose target was mistyped or renamed would pass
// every other check here silently, which is exactly what the old absorbed-table test existed to
// catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (name) => readFileSync(ROOT + name, 'utf8');

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

/** Stub bullets only: `- **OAI-n** — Absorbed into OAI-m...`. Maps stub id -> target id. */
const stubTargets = (text) =>
  new Map([...text.matchAll(/^- \*\*(OAI-\d+)\*\* — Absorbed into (OAI-\d+)/gm)].map((m) => [m[1], m[2]]));

const BACKLOG = read('BACKLOG.md');
const DONE = read('BACKLOG_DONE.md');
const PARKED = read('BACKLOG_PARKED.md');
const BODIES = bodyIds(BACKLOG);

test('no id appears twice among the live bodies', () => {
  // Its own assertion, because NOTHING ELSE HERE CAN SEE A DUPLICATE BODY — mutation-proved: every
  // other body-side check funnels through `new Set(BODIES)`, and the ascending-order comparison is
  // strictly less-than, so equal adjacent ids are not an ordering break. Duplicating a body left all
  // other assertions green. CLAUDE.md requires every id to resolve to exactly ONE live
  // heading, and until this line nothing enforced the "one" half.
  const seen = new Set();
  const repeated = [];
  for (const id of BODIES) {
    if (seen.has(id) && !repeated.includes(id)) repeated.push(id);
    seen.add(id);
  }
  assert.deepEqual(repeated, [], `more than one live body for: ${repeated.join(', ')}`);
});

test('item bodies are in ascending id order', () => {
  const breaks = [];
  for (let i = 1; i < BODIES.length; i++) {
    if (num(BODIES[i]) < num(BODIES[i - 1])) breaks.push(`${BODIES[i - 1]} -> ${BODIES[i]}`);
  }
  assert.deepEqual(breaks, [], `bodies out of ascending order at: ${breaks.join(', ')}`);
});

test('no id is both live and closed out', () => {
  // The drift this catches from the other side: an item moved to DONE or PARKED whose
  // BACKLOG.md body was left behind reads as live to a reader of BACKLOG.md alone.
  const done = closedIds(DONE);
  const parked = closedIds(PARKED);
  const live = new Set(BODIES);
  const both = [...live].filter((id) => done.has(id) || parked.has(id));
  assert.deepEqual(both, [], `live in BACKLOG.md and also closed out: ${both.join(', ')}`);
});

test("every stub bullet's target resolves in the same tracker, and never to another stub", () => {
  // A stub's own id is checked like any other bullet by the two tests above; this is the ONLY
  // check that looks at what a stub POINTS AT. Scoped to "the same tracker" because a stub always
  // lives wherever its target lives (a live target gets its stub in BACKLOG.md, a done target in
  // BACKLOG_DONE.md, a parked target in BACKLOG_PARKED.md) — a stub whose target is in a different
  // file is itself a defect, not just an unresolved one.
  const files = [
    ['BACKLOG.md', BACKLOG, new Set(BODIES)],
    ['BACKLOG_DONE.md', DONE, closedIds(DONE)],
    ['BACKLOG_PARKED.md', PARKED, closedIds(PARKED)],
  ];
  const bad = [];
  for (const [name, text, idsInFile] of files) {
    const stubs = stubTargets(text);
    for (const [from, to] of stubs) {
      if (!idsInFile.has(to)) bad.push(`${name}: ${from} -> ${to} (not a real entry there)`);
      else if (stubs.has(to)) bad.push(`${name}: ${from} -> ${to}, but ${to} is itself a stub (chain)`);
    }
  }
  assert.deepEqual(bad, [], `stub target problems: ${bad.join('; ')}`);
});
