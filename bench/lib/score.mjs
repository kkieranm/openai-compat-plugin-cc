// Scoring one review run against a case's catalogued defects.
//
// The whole benchmark rests on this file agreeing with a human about what
// "found it" means, so the rule is deliberately narrow and stated once: a
// finding matches a defect when it names the right file AND either quotes the
// offending code or points inside its line range. Nothing here reads a
// finding's prose — matching on summary text would be matching on paraphrase,
// which is the thing this scorer is not able to judge.

/**
 * Path segments, right-comparable. Split on either separator and drop "." so
 * "./lib/x.mjs" and "lib/x.mjs" are the same path.
 */
function segments(path) {
  return String(path ?? '')
    .split(/[\\/]+/)
    .filter((segment) => segment !== '' && segment !== '.');
}

/**
 * Suffix match on whole segments. A model asked about `scripts/lib/config.mjs`
 * routinely answers "config.mjs" or "lib/config.mjs", and refusing those would
 * score a correct finding as a miss. Comparing segments rather than raw string
 * ends is what keeps `myconfig.mjs` from matching `config.mjs` — `endsWith`
 * would accept it, and the run would credit a defect nobody found.
 */
function fileMatches(findingFile, defectFile) {
  const a = segments(findingFile);
  const b = segments(defectFile);
  const depth = Math.min(a.length, b.length);
  if (depth === 0) return false;
  for (let i = 1; i <= depth; i += 1) {
    if (a[a.length - i] !== b[b.length - i]) return false;
  }
  return true;
}

/** Whitespace-insensitive, because reflowed or re-indented quotes are still quotes. */
function collapse(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The finding quotes the defect's line. A null anchor means the defect *is*
 * missing code — there is no offending line to quote — so this test can never
 * pass for one, and only the range applies. Returning false for an anchor that
 * collapses to nothing matters for the same reason: `includes('')` is true of
 * every string, which would credit every finding in the file.
 */
function anchorHit(finding, defect) {
  const anchor = collapse(defect.anchor);
  if (!anchor) return false;
  return collapse(finding.evidence).includes(anchor);
}

/** The finding points inside the defect. `finding.line` may legitimately be null. */
function rangeHit(finding, defect) {
  const { line } = finding;
  if (typeof line !== 'number' || !Number.isFinite(line)) return false;
  const [start, end] = Array.isArray(defect.lines) ? defect.lines : [];
  if (typeof start !== 'number' || typeof end !== 'number') return false;
  return line >= start && line <= end;
}

/**
 * One run, scored.
 *
 * Findings are not consumed: a single finding may satisfy more than one defect,
 * and a defect may be satisfied by more than one finding. That is a known
 * inflation risk where two defects sit on the same line, since one finding
 * would credit both — the corpus avoids co-locating defects for exactly this
 * reason, which is a property of the corpus and not something this code checks.
 *
 * Where both tests hold for a defect, `via` records 'anchor': quoted evidence
 * proves the model read the line, where a line number inside a five-line range
 * may be proximity. The split is reported so recall can be read both ways.
 */
export function scoreRun(findings, defects) {
  const credited = new Set();
  const matched = [];
  const byDefect = [];

  for (const defect of defects) {
    let best = null;
    for (const finding of findings) {
      if (!fileMatches(finding.file, defect.file)) continue;
      const via = anchorHit(finding, defect) ? 'anchor' : rangeHit(finding, defect) ? 'range' : null;
      if (!via) continue;
      // Every finding that satisfied the defect is credited, not only the one
      // reported below: a range-matching finding alongside an anchored one has
      // still matched under the rule above, and listing it as unmatched would
      // describe a correct finding as an extra one.
      credited.add(finding);
      if (!best || (best.via === 'range' && via === 'anchor')) best = { via, finding };
    }
    if (best) matched.push({ id: defect.id, via: best.via, finding: best.finding });
    byDefect.push({ id: defect.id, found: Boolean(best), via: best ? best.via : null });
  }

  return {
    matched,
    // Carried whole, and named for what is known about them: this scorer
    // recognises only the defects the corpus catalogued, and only by quoted
    // text or line range. A real defect the corpus never listed, and a correct
    // catch phrased in the model's own words, both land here. Reading this list
    // as noise would be reading the scorer's blind spot as the model's error.
    unmatched: findings.filter((finding) => !credited.has(finding)),
    byDefect,
  };
}

/** Recall, split by how each defect was recognised. */
export function recall(byDefect) {
  const found = byDefect.filter((entry) => entry.found);
  return {
    total: byDefect.length,
    found: found.length,
    anchored: found.filter((entry) => entry.via === 'anchor').length,
    ranged: found.filter((entry) => entry.via === 'range').length,
  };
}
