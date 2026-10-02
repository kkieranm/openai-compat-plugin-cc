// The verbatim reply, for the paths that could not read findings out of it.
//
// Lifted out of `review-report.mjs` at the size ratchet, and the seam is a real
// one: this decides whether a run is REPORTABLE AT ALL and what text stands in
// for findings, while the module it left renders runs that are. Both the text
// report and `--json` call it, which is why it was already factored out into a
// single function there — this only gives that function its own file.
import { withLedger } from './attempt-ledger.mjs';
import { requireAnswer } from './client.mjs';
import { UserError } from './errors.mjs';

/**
 * The verbatim reply, for the paths that could not read findings out of it —
 * and the two refusals that have to fire before anything is shown.
 *
 * Shared by the text report and `--json` rather than copied into each. These
 * are decisions about whether the run is reportable at all, so a second copy
 * would be free to disagree, and this repo keeps relearning that fixing the
 * branch in front of you leaves the adjacent one wrong.
 */
export function unparsedReply(result, { structured, profile, ledger }) {
  // A reply we cut off mid-object is a token-budget problem, not a shape
  // problem. Showing the fragment and calling it a bad shape blames the model
  // for damage we did, and hides the one flag that fixes it.
  if (result.finishReason === 'length') {
    // The old hint said "raise --max-tokens" and stopped there, which is now
    // sometimes advice that cannot work: below the wall-clock ceiling every
    // extra token widens `analysis`, not the findings tail, so a reply overrun
    // by its ninth long finding fails again at a larger budget — and on a big
    // input `prepareRequest` may shrink the raised value straight back to the
    // window's leftovers. Reviewing less is the lever that moves both.
    //
    // Wrapped with `withLedger`: this is a POST-HOC classification of
    // an otherwise-successful transport interaction — the ledger already holds
    // a closed, populated entry for it — so the failure this throws must carry
    // that record rather than leave `errorReport()`'s `attempts` field null,
    // which left the dominant overnight-sweep failure mode unmeasurable.
    const failure = new UserError(`${profile.name} ran out of tokens before it finished writing its findings.`, {
      // Tagged so a caller can tell "the budget ran out" from "the server broke"
      // WITHOUT matching this sentence. `bench/lib/outcome.mjs` reads `reason`
      // off the `--json` envelope and states the rule its own header keeps —
      // never regex a cause out of prose — and an overnight sweep that cannot
      // separate a starved run from a failed one reports a night that measured
      // nothing as a night that found nothing.
      reason: 'token-exhaustion',
      hint:
        'Review a smaller target — a single commit with --commit, or specific files with --file. '
        + 'Raising --max-tokens helps only when the window has room to spare: past that it buys more '
        + 'reasoning rather than more room for the findings themselves.',
    });
    // The reply's usage carried onto the error so `errorReport`'s reasoning
    // witness can observe it: this is the failure mode it most wants to see — the
    // model spent its whole budget reasoning, and `result.usage` here reports how
    // much. Read only as a validated number by `reasoningWitness`, never
    // serialized raw, so it cannot reach the persisted envelope as a foreign shape.
    failure.usage = result.usage;
    throw withLedger(failure, ledger);
  }

  // Under a schema the reasoning channel carries the constrained output, so it
  // is legitimate to show; without one it is only the model's scratchpad.
  // Either way an empty reply falls through to requireAnswer, which refuses —
  // returning an empty "verbatim" block would report a run that produced
  // nothing as one that merely said something odd.
  //
  // BOTH are shown, labelled, when both carry something. Preferring `content`
  // was a silent choice about which text the reader gets to see, and it picked
  // wrong in exactly the case the parser exists to refuse: stray prose in
  // `content` with the rejected findings payload in `reasoning` printed the
  // prose and dropped the payload — on the human path and, through the same
  // helper, in `--json`'s `raw`. A claim that refusing preserves the evidence is
  // only true if the evidence is what gets printed.
  if (structured) {
    const content = result.content.trim();
    const reasoning = result.reasoning.trim();
    if (content && reasoning) return `[content]\n${content}\n\n[reasoning]\n${reasoning}`;
    if (content || reasoning) return content || reasoning;
  }
  // Narrowly wrapped — only around this one call, not the whole
  // function body, so a programming error elsewhere in here is never
  // misreported as a ledger-carrying attempt failure.
  try {
    return requireAnswer(result, profile).trim();
  } catch (error) {
    throw withLedger(error, ledger);
  }
}
