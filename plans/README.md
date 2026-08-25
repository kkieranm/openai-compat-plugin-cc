# `plans/` — what a file here is, and what it is not

A plan in this directory is the durable copy of a harness plan-mode plan, made as the **first action
after `ExitPlanMode`** and amended only here afterwards. The `/feature` workflow's plan step owns the
lifecycle; this file records what the artifacts mean so a cold session can tell them apart.

**A plan is a consuming copy: it keeps no history.** Amendments overwrite. That is deliberate — the
plan is the current spec, not a log — and it is why the approval archives below matter.

## Naming

`<item-id>-<slug>.md`, lower-kebab, e.g. `oai-64-status-must-show-the-blocker-that-is-starving-you.md`.
One item may have more than one plan when a design was withdrawn and replaced
(`oai-61-node-sqlite-capability-gate.md` and `oai-61-narrowed-capability-gate.md` are the same item's
first and second designs). **Never overwrite a superseded plan** — the withdrawn one is evidence about
why the replacement exists.

## Provenance line

Head a plan with `provenance: harness slug <final-slug>`, naming the plan-mode plan it was copied
from. **A plan with no provenance line never entered plan mode**, and that is a fact about its
authority, not a formatting omission.

## The three states a file here can be in

| State | How you recognise it | What it authorises |
| --- | --- | --- |
| **Approved** | `provenance:` line, and a sibling `<name>.approved/` directory | Building. |
| **Withdrawn** | Superseded by another plan for the same item; the tracker says which | Nothing. Read-only evidence. |
| **`unattended-draft`** | Opens with `STATE: unattended-draft — NOT harness approved`, and has **no** `provenance:` line | **Nothing.** Input to a later plan-mode session. |

### `unattended-draft` — the one that is easy to misread

Written when an unattended run reached an item needing a plan. `adr/045` forbids such a run entering
plan mode, because `ExitPlanMode` prompts a user who has left. So the run drafts the plan, challenges
it with Codex as **pre-review**, records the verdicts, and blocks the item `blocked-on-plan`.

**A Codex `APPROVE` on a draft is preparation, never authorisation.** On resumption the attended
session enters plan mode for real, uses the draft as *input*, and re-runs the plan gate against
whatever version it then produces. Treating a draft as a plan would make a later session believe the
plan step done and start coding — which is the specific failure the state line exists to prevent.

Three such drafts were written on 2026-08-08 (OAI-64, OAI-66, OAI-67). Each carries its full
round-by-round verdict table, including the rounds that found defects.

## Approval archives — `<name>.approved/`

Written **by the gate, not by hand**: `check-plan-gate.sh --approved` verifies the reply's `DIGEST:`
against the plan's own bytes and writes
`<name>.approved/<episode>-round-<N>-<threaded|blind>.md`, first line
`ARCHIVE — not the current spec; the live plan is the file beside it.`.

**An archive exists if and only if that round's approval crossed the gate.** A dissent writes nothing.
One file per approving round, because a pre-build and a mid-build episode each approve and one file
cannot hold both; the gate refuses to overwrite. **Never edit one afterwards.**

Since the plan itself keeps no history, the archive is the only O(1) record of what a verdict attached
to.

**An `unattended-draft` has no archive even when Codex approved it, and that absence is deliberate**
— the approval did not cross the step-3 gate, and writing an archive would let a later session read
the gate as closed. Each such draft says so in its own pre-review section rather than leaving the
absence to be read as an oversight.

## Other files here

`stage-2-ladder-ledger.md` and `stage-2-open-questions.md` are not plans — they are working records
kept beside them. Anything that is not `<item-id>-<slug>.md` is not governed by the states above.
