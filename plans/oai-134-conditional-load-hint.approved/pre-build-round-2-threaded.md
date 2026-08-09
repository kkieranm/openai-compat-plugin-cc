ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug expressive-coalescing-quokka

# OAI-134 — stop promising on-demand loading the server may refuse

## Context

`scripts/lib/model-selection.mjs` tells the operator, in two places and
unconditionally, to *"pass `--model <id>` to have it loaded on demand"*. The
docstring twelve lines above those hints names **"status output promising
something the real path then refuses"** as this repo's most-repeated defect
class. The hints beneath it are an instance of it.

The item was filed as something else. OAI-134 originally said the plugin *sizes*
an unloaded model by `max_context_length`; that mechanism was **refuted** today,
independently by this session and a Codex consult — `client.mjs:40` builds the
only completion body and carries no `ttl`/`context_length`/load parameter,
`/chat/completions` is the only POST, the model endpoints are GET probes, and no
`lms` subprocess exists. The plugin has no channel through which to size a load.
The tracker entry already carries that correction.

Two further changes were proposed and are **deliberately not in this plan**,
because evidence refuted them after the item was filed:

- **A pre-emptive "model is not loaded" warning.** Verified live today: oMLX
  0.5.7 JIT-loads successfully (`loaded_count` 0 → 1 inside a 7s prefill), so
  *not loaded* is its **normal successful path** and the warning would fire on a
  run that works. That is a warning firing when provably wrong, which this repo
  rejects explicitly (`bench/lib/caveats.mjs`, the `unresolved` caveat gated on
  `unresolved` rather than `cut` for exactly this reason).
- **Synthesising a better failure message.** Reproduced live: LM Studio already
  returns *"Model loading was stopped due to insufficient system resources…
  requires approximately 44.87 GB… you can adjust the model loading
  guardrails"*, surfaced verbatim by the plugin. It names cause and remedy better
  than anything this repo would write.

What survives is narrow and real: **LM Studio does attempt the load and may
refuse it; oMLX does it successfully. So the hint is an overpromise, not a lie,
and the honest wording is conditional.**

## Change

**`scripts/lib/model-selection.mjs`** — two hint strings only. No control flow,
no new branch, no new field.

- `:158` — `'Load a chat model in the server, or pass --model <id> to have it loaded on demand.'`
- `:185` — `'Load one in the server, or name one of those with --model <id> to have it loaded on demand.'`

Both become **provider-neutral**: `--model <id>` *requests* the model, and any
on-demand loading is **controlled by the server**. Keep each to one sentence —
these are hints printed under an error, and length competes with the error itself.

**Not "the server will try"** (round 1, Codex). That was this plan's first draft
and it is the same defect one level down: two servers were observed attempting a
load, which supports no claim about servers in general — another may reject an
unloaded or unknown id without attempting anything. Replacing an overpromise with
a weaker overpromise is not a fix. The wording must assert nothing about what any
server does; it must say only that the decision is the server's.

**`README.md`** (model-precedence paragraph, ~:71) — one or two sentences: `--model`
selects which model is requested; it does not configure how the server loads it.
Then the two behaviours **as dated observations, explicitly not as an exhaustive
account**: LM Studio (2026-08-09) attempts the load, sizes it by its own settings
and may refuse for memory; oMLX 0.5.7 loads on demand successfully. A reader whose
server is neither must not read this as a promise about theirs.

**Explicitly NOT changed:**

- `model-selection.mjs:215` — a comment explaining why an assumption was
  *dropped*. Already correctly hedged; editing correct prose is churn.
- `render.mjs:73` — the positive `because === 'loaded'` branch in setup. Adding a
  negative counterpart is a new executable branch needing its own tests, and the
  user scoped it out.
- `delegate.mjs` `resolveTarget` — where a pre-emptive warning would have gone.
  Refuted above.

## Verification

1. `npm test` — expect green. No test pins either hint string (`grep -rn "loaded
   on demand" tests/` returns nothing), so this should be a no-op for the suite;
   **if something does go red, that is a finding, not a rebase**.
2. Run the repo `verify` skill, steps 1–2 at minimum. Steps 3–4 need a live
   server; both LM Studio (:1234) and oMLX (:8000) are up in this session, so run
   them.
3. **Exercise the changed path for real, not just the string.** The `:185` hint
   fires when a provider offers chat models and none is loaded. With LM Studio's
   models unloaded, `node scripts/oai-companion.mjs task --provider lmstudio "hi"`
   with no `defaultModel` reaches it. Quote the observed output.
4. **Mutation check:** this is prose inside executable code with no invariant a
   single edit can break — no comparison to flip, no field to drop, no branch to
   invert. Per the verify step's third outcome, **say so and skip**; do not
   manufacture one. The honest check is (3): the hint must actually print.

## Entry tier for review

Expected **light** under `adr/026`: non-executable prose only (two string
literals and a README paragraph), well under 80 lines, two files, and it touches
no CLAUDE.md, ADR, config, test or vendor-contract file. Confirm against the real
diff before the review step rather than assuming — if an ADR turns out to be
warranted, the tier becomes full.

No ADR is planned. The decision worth recording is *why the warning was rejected*,
and its home is the OAI-134 tracker entry, which already holds the refuted
premise and the rejected options — written at the residue step, outside the
reviewed artifact.
