// What a task answer DEMONSTRATED, decided before any numbers arrive.
//
// Pure and I/O-free on purpose, the way `ttl-verdict.mjs` is: the reading of a
// result is fixed and unit-tested first, so a sweep cannot be interpreted to
// taste afterwards.
//
// **This scorer does not read prose in the sense the review scorer refuses to.**
// `bench/lib/score.mjs` says "Nothing here reads a finding's prose" and means it
// matches structure — a quoted anchor, a line range. A task answer has no
// structure to match, so this matches DECLARED MARKERS instead: strings a case
// author committed to in advance, grouped by what naming them demonstrates.
// That is weaker than an anchor and the difference is stated rather than hidden:
// see `MARKER_LIMITS` below, which the report is required to print.

/**
 * What a marker match does and does not establish, in one place because every
 * consumer must say it.
 *
 * Written as data rather than prose in a report so that a reader of the record
 * gets it too, and so it cannot drift between the two.
 */
export const MARKER_LIMITS = [
  'A marker match shows the answer NAMED something, never that it understood it. Vocabulary is ' +
    'evidence, not comprehension.',
  'A miss is not proof of absence: an answer that describes a claim in words the case did not ' +
    'anticipate scores as a miss. This scorer therefore UNDERCOUNTS, in the same direction as the ' +
    'review scorer\'s anchor matching and for the same reason.',
  'A claim profile is not the Stage 2 gate. The gate asks whether Claude verifying an artifact costs ' +
    'less than Claude doing the work, which is an economic comparison this scorer does not make.',
];

/** Whitespace-collapsed and case-folded, so a reflowed reply still matches. */
function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ');
}

/**
 * One claim against one answer.
 *
 * `any` is a disjunction: naming the mechanism as "prototype chain" or as
 * "inherited property" are the same demonstration, and a case that listed only
 * one spelling would measure phrasing. `contradictions` are markers that
 * AFFIRMATIVELY show the answer got it wrong, which is a different outcome from
 * silence and must not collapse into it — ADR 016's zsh result named the right
 * expression and the wrong mechanism, and a scorer that reported that as a plain
 * miss would lose the most informative thing about it.
 */
function scoreClaim(answer, claim) {
  const text = normalize(answer);
  const hit = claim.any.some((marker) => text.includes(normalize(marker)));
  // A contradiction outranks everything, so it must be the harder match, not the
  // easier one. A bare substring scored a correct, fully-hedged answer as
  // `contradicted` — below a miss — merely for containing the phrase inside an
  // unrelated clause. Requiring a word boundary on both sides does not make this
  // semantic, and it is not claimed to be: it makes an accidental hit rarer,
  // and MARKER_LIMITS already says what marker matching is worth.
  const contradicted = (claim.contradictions ?? []).some((marker) => bounded(text, normalize(marker)));
  return { id: claim.id, hit, contradicted };
}

/** `marker` present with a non-word character (or an edge) on each side. */
function bounded(text, marker) {
  if (!marker) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(marker, from);
    if (at === -1) return false;
    const before = at === 0 ? ' ' : text[at - 1];
    const after = at + marker.length >= text.length ? ' ' : text[at + marker.length];
    if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
    from = at + 1;
  }
}

/**
 * Every claim, plus the profile the set of them adds up to.
 *
 * The vector is kept beside the profile rather than replaced by it: "site hit,
 * mechanism contradicted, remedy hit" is the finding, and `partial` is only a
 * label for it. A record that stored the label alone could not be re-read when
 * the marker set changes.
 */
export function scoreAnswer(answer, claims) {
  const byClaim = claims.map((claim) => scoreClaim(answer, claim));
  return { byClaim, profile: profileOf(byClaim) };
}

/**
 * `exact` — every claim named and none contradicted.
 * `contradicted` — at least one claim affirmatively wrong. Ranked BELOW a plain
 *   miss deliberately: an answer that asserts the wrong mechanism costs a reader
 *   more than one that says nothing, because it has to be disproved.
 * `partial` — some claims named, none contradicted.
 * `missed` — nothing named.
 */
export function profileOf(byClaim) {
  if (byClaim.length === 0) return 'missed';
  if (byClaim.some((claim) => claim.contradicted)) return 'contradicted';
  const hits = byClaim.filter((claim) => claim.hit).length;
  if (hits === byClaim.length) return 'exact';
  return hits === 0 ? 'missed' : 'partial';
}

export const PROFILES = ['exact', 'partial', 'missed', 'contradicted'];

/**
 * Tally profiles across runs, and refuse to hide an arm that never ran.
 *
 * `incomplete` is the framing guard ADR 016 earns: framing was the dominant
 * variable, so a sweep that ran only the favourable arm must say so rather than
 * present a number that reads as framing-independent. Never averaged across
 * arms for the same reason.
 */
export function tallyArm(runs) {
  const counts = Object.fromEntries(PROFILES.map((profile) => [profile, 0]));
  let scored = 0;
  for (const run of runs) {
    if (!run.score) continue;
    counts[run.score.profile] += 1;
    scored += 1;
  }
  return { counts, scored, failed: runs.length - scored };
}
