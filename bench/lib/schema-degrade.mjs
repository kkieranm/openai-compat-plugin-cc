// Whether the benchmark's schema arm kept its schema in force.
//
// Its own module rather than a note inside `caveats.mjs`: every other note in
// that file qualifies a FIGURE in the table. This one qualifies the table's
// TITLE — whether the arm is the thing it says it is — and it prints before
// the rest for that reason.

/**
 * Whether the schema was in force for the answers, before what the schema MEANS.
 *
 * The note below describes a trade between two failure classes, and that is
 * worth nothing if the schema was not in force for the answers. This note is
 * gated on `degraded` as well as on the flag the operator passed — together
 * they draw the distinction `cmd-review.mjs` documents as separating "asked
 * for a schema and got an unstructured reply" from "never wanted a schema". Silent when nothing degraded, loudest when every answered
 * run did.
 */
export function degradedNote(degraded, reported) {
  if (degraded === 0) return [];
  const all = degraded === reported;
  return [
    `**${all ? 'NO ANSWERED RUN IN THIS ARM KEPT THE SCHEMA IN FORCE THROUGHOUT.' : 'Some answered runs in this arm did not keep the schema in force throughout.'}** `
    + `\`--structured-output\` was requested, but in **${degraded} of ${reported}** answered run(s) at least one `
    + `answer was produced without it: the server refused \`response_format\`, or a salvage follow-up, which `
    + `never sends \`response_format\`, produced the answer`
    + `${all
      ? ' — every one of them. These figures therefore do not isolate what keeping the schema in force '
        + 'changes.'
      : '. The rows below therefore mix both paths, and a per-case difference may be the path rather '
        + 'than the model.'}`,
  ];
}
