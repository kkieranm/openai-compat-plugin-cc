// Whether the benchmark's schema arm actually measured a schema (OAI-135 item 4).
//
// Its own module rather than a fifth note inside `caveats.mjs`, which the size
// ratchet refused. The refusal was right and the first two attempts at it were
// not: both trimmed load-bearing comments elsewhere in that file to buy lines,
// and every one of those records a claim someone made and had to retract. A
// budget is a prompt to find the seam, not a licence to delete the evidence.
//
// The seam is real. Every other note in `caveats.mjs` qualifies a FIGURE in the
// table. This one qualifies the table's TITLE — whether the arm is the thing it
// says it is — and it prints before the rest for that reason.

/**
 * What the SERVER did about the schema, before what the schema MEANS (OAI-135).
 *
 * The note below describes a trade between two failure classes, and that is
 * worth nothing if the arm never sent a schema. It could not previously say so:
 * it was gated on the flag the operator passed, not on `degraded` — the pair
 * `cmd-review.mjs` documents as separating "fell back after a refusal" from
 * "never wanted a schema". Silent when nothing degraded, loudest when everything
 * did, because that reading invalidates the arm rather than qualifying it.
 */
export function degradedNote(degraded, reported) {
  if (degraded === 0) return [];
  const all = degraded === reported;
  return [
    `**${all ? 'THIS ARM DID NOT MEASURE A SCHEMA.' : 'This arm only partly measured a schema.'}** `
    + `\`--structured-output\` was requested, but the server refused \`response_format\` and the run fell `
    + `back to the unconstrained path on **${degraded} of ${reported}** answered run(s)`
    + `${all
      ? ' — every one of them. The figures below are an unconstrained run wearing a schema label, so '
        + 'reading them against an unconstrained arm compares one measurement with itself.'
      : '. The rows below therefore mix both paths, and a per-case difference may be the path rather '
        + 'than the model.'}`,
  ];
}
