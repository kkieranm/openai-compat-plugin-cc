# Parked

Items whose *framing* was disproved, not merely deprioritised. Each carries a **reopening bar**: what
would have to be observed for it to become live again. IDs here are still stable and global, and
`BACKLOG.md`'s absorbed-ID table points at this file.

- **OAI-44** — Decide whether a *confirmation-capable* server-state instrument is worth building.
  **Parked 2026-08-05 by the backlog sweep.** It was already marked "Parked, not closed" in its own
  text and sitting in the live ordered list anyway; the sweep moved it to where that word means
  something. Filed 2026-08-04 by OAI-34, which withdrew its own confirming verdict during
  the plan gate — see [ADR 013](adr/013-observing-the-server.md)'s amendment. The reason is structural
  rather than a gap in effort: proving an unload happened after expiry requires observing the model
  still resident **after** expiry, and a mechanism that fires **at** expiry never leaves that
  observation behind. Four designs were tried and each failed on a different axis (clock origin;
  bracket width, where present-at-119s/absent-at-121s straddles a 120s expiry; a calibration-derived
  bound on the spawn-to-receipt offset, invalid because `prefillMs` starts before the HTTP request and
  the driver's `Date.now()` is not the monotonic clock attempts are timed on; and gating on the
  exposure margin, which is post-treatment — the hypothesised eviction truncates the very measurement
  used to decide whether the episode was exposed).
  So this is not "try harder with sampling". The two designs that could actually earn a confirmation:
  **(a) matched controls** — randomised challenge TTLs with long-TTL controls, requiring unload timing
  to *move with* the assigned TTL, which makes TTL the manipulated variable instead of resting on one
  coincidence at 120s; ADR 013 costed the corpus-wide version at 3–4h on the MoE and 9–12h on the
  dense, but a single-case version is much cheaper and was never costed. **(b) server-side telemetry**
  — if LM Studio ever exposes an unload *reason* or a lifecycle event, the whole problem collapses to
  reading it. Check that first; it is a five-minute question and it decides whether (a) is worth
  hours.
  **A second thing any confirming design must fix, recorded here so it is not rediscovered:** the
  sampler's `in-flight` phase means *the child process is alive*, not *the HTTP request is open*. An
  absence seen after the request already failed but before the companion exits falls inside that
  window. That is ADR 013's own "an unload after the request had already failed" disqualifier, and it
  is harmless today only because nothing is attributed. It becomes load-bearing the moment anything is.
  **The precondition on this item is now discharged, and it landed on the side that argues against
  building anything.** It said: do not start before OAI-34 has run, because if three episodes survive
  a 120s TTL against a 335s prefill then the deterministic form is refuted and the appetite for
  confirming a mechanism that just failed to appear should be re-examined rather than assumed. **That
  is exactly what happened on 2026-08-04** — 3/3 survived, 336s of prefill, continuously resident,
  216s of slack at the narrowest. So the honest default for this item is now **"no"**, and it needs a
  positive reason to move rather than merely an unanswered question. What would supply one: a drop
  recurring on the MoE, or on a case this run did not cover, since the refutation is dense-27B/
  `scaffold`/120s only.
  **One finding from that run bears directly on design (b), and shortens it.** The residency
  endpoint reports **`lastUsedTime: null` for the entire time it is serving a request** (`status`
  went `processingPrompt` for 168 consecutive samples per episode, then `generating`). So the field
  ADR 013 nominated as activity evidence is not populated in flight, and `activityObserved` came back
  `null` in all three episodes. Any telemetry-based design must therefore find a *different* signal
  than `lms ps`'s activity fields — checking whether one exists is still the five-minute question to
  ask first, but it should not be asked of that field.

  ### Reopening bar

  **A drop recurring on the MoE, or on a case the 2026-08-04 run did not cover.** The refutation that
  parks this item is dense-27B / `scaffold` / 120s only, at N=3 with a ~63% one-sided upper bound on
  the failure rate — so it does not cover the MoE, where 27/72 of the original drops were also seen.
  Either observation restores a live mechanism to confirm and makes this item worth costing again.
  **The cheap check comes first and is not gated by any of that:** if LM Studio ever exposes an unload
  *reason* or a lifecycle event, design (b) collapses to reading it, and that is a five-minute
  question. Asking it does not require reopening this item; getting a yes does.
