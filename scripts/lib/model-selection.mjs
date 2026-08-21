/**
 * Which model a task will use, and why.
 *
 * Split out of `model-info.mjs` so the two questions stay separable: that module
 * knows vendor dialects and context windows, this one is THE authority on
 * selection. The dependency runs one way only — `model-info.mjs` imports this,
 * never the reverse — because a selection policy that can reach back into the
 * probing code is free to grow a second, dialect-aware answer to "which model",
 * which is the exact duplication this file exists to prevent.
 */

export const MAX_LISTED_MODELS = 12;

/**
 * A capped, comma-joined id list.
 *
 * Exported because `render.mjs` had re-written it verbatim — same slice, same
 * join, same `, +N more` tail — while importing `MAX_LISTED_MODELS` from here.
 * Sharing the cap and copying the formatting is the worse of the two options: it
 * looks shared, so nothing flags the half that is not. One definition or one
 * guard, and this one is cheap enough to be a definition.
 */
export function listModelIds(ids) {
  const shown = ids.slice(0, MAX_LISTED_MODELS);
  const extra = ids.length - shown.length;
  return `${shown.join(', ')}${extra > 0 ? `, +${extra} more` : ''}`;
}

/**
 * Whether an unlisted id would be refused here at all.
 *
 * Exported to `autoSelect`'s hint rather than re-tested there, because the hint
 * DESCRIBES this rule: with no catalogue, "pass --model <id> to request one" is
 * worth saying; with one, the same sentence sends the operator into a refusal.
 * Two copies of the condition is how the advice and the behaviour come to
 * disagree, which is what happened.
 */
function refusesUnlisted(described) {
  return described?.models?.length > 0 && (described?.catalogueIds?.length ?? 0) > 0;
}

/**
 * Refuse a named model the provider does not serve, before the run is spent.
 *
 * Measured against LM Studio: a request naming a model it does not have answers
 * HTTP 200 with a normal completion from whatever IS loaded, reporting that
 * model's id. A wrong id therefore costs a full run and leaves a record that
 * looks clean — the same substitution `model-identity.mjs` names after the
 * fact, caught here before anything is sent.
 *
 * Only against a catalogue whose semantics are known. A bare `/v1/models` list
 * may be aliases, routed names or permission-filtered, so absence there is not
 * evidence. That is the shape-not-name rule applied to the catalogue instead
 * of the window.
 *
 * The gate is a published catalogue, NOT merely a recognised dialect, and the
 * difference is a real server: llama.cpp's `/props` and TGI's `/info` are
 * recognised dialects — `source` is set — that publish no per-model list at
 * all, so `described.models` falls back to the bare `/v1/models` ids. Those
 * servers also ignore the requested model name entirely. Gating on `source`
 * would have refused `defaultModel: "qwen3"` against a llama.cpp server listing
 * `models/qwen3-8b-Q4_K_M.gguf`, breaking a setup that works today, in the name
 * of a catalogue nobody published.
 *
 * Membership is tested against BOTH lists, and that is the whole point of the
 * paragraph above. `merge` keys `described.models` on the /v1/models ids, so a
 * model the dialect enumerated — even one it reports `loaded` — is missing from
 * it whenever /v1/models is the narrower list. Gating on the dialect having
 * published a catalogue while checking membership in the other endpoint's list
 * refused exactly the model the server was holding in memory. Found by the lean
 * review and reproduced end to end: absence from ONE list is not evidence, so
 * only absence from both refuses.
 *
 * Exact ids, never `matchKey`: `merge()` has already rewritten every record to
 * the `/v1/models` spelling the chat endpoint accepts, so there is nothing left
 * to normalise, and a loose match would admit a `@quant` id that names a
 * genuinely different model to load.
 */
function unservedProblem(id, described) {
  if (!refusesUnlisted(described)) return undefined;
  const catalogueIds = described.catalogueIds;

  const served = new Set([...described.models.map((model) => model.id), ...catalogueIds]);
  if (served.has(id)) return undefined;

  // What is OFFERED to the reader is narrower than what counts as served: an
  // embedder is genuinely served, so naming it here would be a remedy that
  // fails. Following it lands on the very next branch of `planSelection` —
  // "Configured defaultModel … is an embedding model and cannot answer a chat
  // request" — so the refusal would have handed out an id the same function then
  // rejects. Membership stays wide (an embedder is not "not served", and it gets
  // its own specific message); only the suggestion is filtered.
  const embedders = new Set(
    described.models.filter((model) => model.type === 'embeddings').map((model) => model.id),
  );
  const offered = [...served].filter((servedId) => !embedders.has(servedId));
  return {
    problem: {
      // Not "Provider does not serve …": `selectModel` prefixes every problem
      // with `Provider "<name>": `, so that phrasing stuttered in the one place
      // a user actually reads it.
      message: offered.length > 0
        ? `Model "${id}" is not served here. Available: ${listModelIds(offered)}.`
        : `Model "${id}" is not served here, and no model here can answer a chat request.`,
      hint: offered.length > 0
        ? 'Name one of those instead, or download the model in the server first.'
        : 'Download a chat model in the server first.',
    },
  };
}

/**
 * Whether the catalogue's `state` can be believed for EVERY candidate.
 *
 * Both halves are load-bearing. `readLmStudio` writes `state: entry.state`
 * unconditionally, so the property exists even when the value is undefined —
 * testing `'state' in model` would call a stateless response observable and
 * then report "none is loaded". Partial coverage is no safer: a candidate whose
 * state is unknown might be the loaded one, so a 0-loaded or 1-loaded conclusion
 * drawn over an incomplete set asserts something nobody measured.
 *
 * `exactMatch` is the second half. The loose `matchKey` join is conservative for
 * the embeddings denylist — a loose hit can only ADD an exclusion — but here it
 * would become a routing decision: a `/v1/models` offering `qwen@4bit` while the
 * dialect reports `qwen` as loaded would select and send `qwen@4bit`, an id no
 * evidence said was resident. Same data, two trust levels.
 *
 * A non-empty string is the whole test. No list of vendor state values, for the
 * same reason as every other field here: shape, not vocabulary.
 * `'loaded'` is simply the one value that selects.
 */
function statesUsable(candidates) {
  return candidates.every((model) => typeof model.state === 'string' && model.state !== '' && model.exactMatch === true);
}

/**
 * The model to use when nothing named one, or why none can be picked.
 *
 * "No model can answer a chat request" and "several can, none is resident" are
 * different facts and get different messages. Conflating them is this repo's
 * signature defect class — output that reads as something the run did not
 * establish — and the remediation differs too: one needs a download, the other
 * needs a load.
 *
 * NEITHER HINT PROMISES THE LOAD. Both used to end "to have it loaded
 * on demand" — an outcome this plugin does not control and cannot predict, and
 * one that observably differs between servers. So neither hint predicts an
 * outcome: the no-candidates hint says nothing about outcomes at all, and the
 * none-loaded hint names only the decider. Naming an outcome SET is the same
 * defect one notch weaker — "to do or refuse" excludes the third thing a server
 * does, which is to answer from whatever else it has loaded, and `model-identity.mjs`
 * `substitution()` is the only mechanism that catches that, after the fact.
 * NOT `unservedProblem` above: this branch fires when the candidates ARE served
 * and merely unloaded, so `served.has(id)` is true and it returns undefined. It
 * sees an id the server does not have; known-but-not-loaded is the case it
 * cannot see, and the case these hints are about.
 * This was an instance of the very class this docstring warns about, sitting
 * in its own remedy. The dated per-server observations live in README.md, once.
 */
function autoSelect(described) {
  const candidates = chatCandidates(described);
  if (candidates.length === 0) {
    return {
      problem: {
        message: 'This provider offers no model that can answer a chat request.',
        // The remedy depends on whether a named id would itself be refused, so
        // it is read off `refusesUnlisted` rather than stated once and hoped for.
        // With no catalogue, naming an id is worth suggesting. With one, the same
        // sentence walks the operator into `unservedProblem` — the tool
        // instructing the user into its own refusal.
        hint: refusesUnlisted(described)
          ? 'Download a chat model in the server — every id it lists is an embedding model.'
          // No trailing clause here, unlike the none-loaded hint below: this
          // branch fires when the server offers no chat model at all, where
          // "an id it has not loaded" would presuppose it knows the id.
          : 'Load a chat model in the server, or pass --model <id> to request one.',
      },
    };
  }
  if (candidates.length === 1) return { modelId: candidates[0].id };

  const nameOne = 'Pass --model <id>, or set "defaultModel" for this provider in the config.';
  if (!statesUsable(candidates)) {
    return {
      problem: {
        message: `This provider offers ${candidates.length} models: ${listModelIds(candidates.map((model) => model.id))}.`,
        hint: nameOne,
      },
    };
  }

  const loaded = candidates.filter((model) => model.state === 'loaded');
  if (loaded.length === 1) return { modelId: loaded[0].id, because: 'loaded' };
  if (loaded.length === 0) {
    return {
      problem: {
        // Names them. The `candidates.length > 1` message this branch replaced
        // always carried the list, and dropping it made the refusal tell the
        // operator to pass an id it never showed — recoverable only by running a
        // second command. It is also the only branch here that withheld it.
        message: `This provider offers ${candidates.length} chat models, but none of them is loaded: `
          + `${listModelIds(candidates.map((model) => model.id))}.`,
        hint: 'Load one in the server, or name one of those with --model <id> to request it — what a '
          + 'server does with an id it has not loaded is its own decision.',
      },
    };
  }
  // Not folded into "cannot happen": nothing measured says a server may hold
  // only one model resident, so the ambiguous case names the loaded ones and
  // asks, rather than picking the first and calling it the loaded one.
  return {
    problem: {
      message: `This provider has ${loaded.length} models loaded: ${listModelIds(loaded.map((model) => model.id))}.`,
      hint: nameOne,
    },
  };
}

/**
 * THE authority on which model a task will use — or why it cannot pick one.
 *
 * Every other view of that decision must call this rather than re-deriving it.
 * Three separate implementations of "what will happen" (selection, the readiness
 * marker, the window report) is what produced this repo's most-repeated defect
 * class: status output promising something the real path then refuses.
 */
export function planSelection({ defaultModel } = {}, explicitModel, described) {
  if (explicitModel) return unservedProblem(explicitModel, described) ?? { modelId: explicitModel };

  if (defaultModel) {
    // Trusted only where the catalogue cannot contradict it: a server that
    // publishes no list, or one whose dialect went unrecognised. This used to be
    // unconditional trust, reasoning that an unlisted model may be downloaded
    // but not loaded and will be loaded on demand — but LM Studio lists a
    // downloaded model as `not-loaded`, so it IS in the list, and an id missing
    // from a recognised catalogue is not loadable on demand. It is an id the
    // server would answer with whatever else it has loaded.
    const unserved = unservedProblem(defaultModel, described);
    if (unserved) return unserved;

    // Listed and called an embedder is a real conflict, and reachable only once
    // the id is known to be served — the two branches cannot both fire.
    const known = described?.models?.find((model) => model.id === defaultModel);
    if (known?.type === 'embeddings') {
      return {
        problem: {
          message: `Configured defaultModel "${defaultModel}" is an embedding model and cannot answer a chat request.`,
          hint: 'Point defaultModel at a chat model, or pass --model <id>.',
        },
      };
    }
    return { modelId: defaultModel };
  }

  return autoSelect(described ?? { models: [] });
}

/**
 * Models eligible for automatic selection: everything the server did not call an
 * embedder.
 *
 * `described.models` only, so a model the dialect enumerated but `/v1/models`
 * omits can be REQUESTED by name yet is never picked automatically. Deliberate,
 * and the same asymmetry `planSelection` already runs on: a named model is the
 * caller's instruction and outranks our inference, while an automatic choice is
 * one we have to justify. Declining to consider a model means refusing and
 * saying why, which is the conservative direction; admitting it would mean
 * routing to an id only one of two endpoints ever mentioned. Raised as a
 * possible inconsistency; it is the rule, stated.
 */
export function chatCandidates(described) {
  // A denylist, not an allowlist: the loaded chat model on the verification
  // machine reports type "vlm", and future types must keep working.
  return described.models.filter((model) => model.type !== 'embeddings');
}
