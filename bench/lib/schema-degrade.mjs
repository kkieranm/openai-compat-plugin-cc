// Whether the benchmark's schema arm actually measured a schema.
//
// Its own module rather than a note inside `caveats.mjs`: every other note in
// that file qualifies a FIGURE in the table. This one qualifies the table's
// TITLE — whether the arm is the thing it says it is — and it prints before
// the rest for that reason.

/**
 * What the SERVER did about the schema, before what the schema MEANS.
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
