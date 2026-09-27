import { UserError } from './errors.mjs';

// Deliberately crude: a real tokenizer differs per model, and this guard exists
// to catch "you sent 40k into a 4k window", not to be exact at the margin.
//
// But it must err toward refusing, never toward admitting input the server then
// rejects — that is the failure this guard exists to prevent. Measured against
// LM Studio on two real diffs: 50 KB counted 13,889 tokens (3.61 chars/token)
// and 156 KB counted 44,997 (3.48). Code and diffs pack denser than the prose 4
// assumed, so a review — which only ever sends code — was systematically
// over-estimating how much would fit.
//
// Set *below* the densest measurement rather than at it: at 3.5 the estimate
// still fell 300 tokens short of the second sample, and "close enough" is the
// wrong target for a number whose only job is to stay on the safe side.
export const CHARS_PER_TOKEN = 3.4;

// Headroom left for the model's reply, since the window covers prompt + completion.
export const DEFAULT_RESERVE_TOKENS = 1024;

// The ratio above holds for ASCII only. Outside it tokenizers diverge widely
// (measured on two: ~1 token per common Chinese character, up to ~1.9 for a run
// of distinct ones, ~3 for rare CJK, up to ~4 for astral code points). Non-ASCII
// is charged its UTF-8 byte length, which no measured sample exceeded: a
// byte-level or byte-fallback tokenizer spends at most one token per byte of the
// text it tokenizes. That over-counts ordinary CJK prose about threefold — a
// loud refusal the user can act on, where an under-count is a request the server
// rejects.
//
// Some tokenizers normalise first, and NFC/NFKC can expand text several-fold
// (U+FDFA is 3 bytes raw, 33 after NFKC), so each cluster is charged the largest
// of its raw, NFC and NFKC forms. Normalising the whole text instead is
// quadratic on long runs of combining marks, and normalising each code point
// alone misses composition between them (é + U+0323 becomes U+1EB9 + U+0301,
// 5 bytes rather than 4).
export function estimateTokens(text) {
  let ascii = 0;
  let nonAsciiBytes = 0;
  let cluster = '';
  const flush = () => {
    if (cluster.length === 1 && cluster.charCodeAt(0) < 0x80) ascii++;
    else if (cluster) {
      const cost = clusterCost(cluster);
      ascii += cost.ascii;
      nonAsciiBytes += cost.bytes;
    }
    cluster = '';
  };
  for (const char of text) {
    if (char.charCodeAt(0) < 0x80 || !joinsCluster(char)) flush();
    cluster += char;
  }
  flush();
  return Math.ceil(ascii / CHARS_PER_TOKEN + nonAsciiBytes);
}

// A cluster is a code point plus everything after it that normalisation could
// reorder or compose into it: any code point whose raw, NFD or NFKD form starts
// with a mark or a Hangul conjoining jamo. The decompositions matter because
// normalisation decomposes first — halfwidth U+FF9E is not a mark but becomes
// U+3099, which is. Kirat Rai composes two non-marks (U+16D63 + U+16D67),
// which crosses a cluster boundary, but composition never lengthens the UTF-8,
// so missing one only over-counts.
const JOINING = /^[\p{M}\u1160-\u11FF\uD7B0-\uD7FF]/u;
const joinsCache = new Map();

function joinsCluster(char) {
  let joins = joinsCache.get(char);
  if (joins === undefined) {
    joins = JOINING.test(char) || JOINING.test(char.normalize('NFD')) || JOINING.test(char.normalize('NFKD'));
    joinsCache.set(char, joins);
  }
  return joins;
}

// Past this length a cluster is a pathological mark run, and normalising it is
// what goes quadratic.
const MAX_NORMALISED_CLUSTER = 32;
const CLUSTER_CACHE_LIMIT = 65_536;
const clusterCache = new Map();

function clusterCost(cluster) {
  let cost = clusterCache.get(cluster);
  if (cost) return cost;
  if (cluster.length > MAX_NORMALISED_CLUSTER) return longClusterCost(cluster);
  for (const form of [cluster, cluster.normalize('NFC'), cluster.normalize('NFKC')]) {
    const candidate = formCost(form);
    if (!cost || candidate.ascii / CHARS_PER_TOKEN + candidate.bytes > cost.ascii / CHARS_PER_TOKEN + cost.bytes) {
      cost = candidate;
    }
  }
  if (clusterCache.size < CLUSTER_CACHE_LIMIT) clusterCache.set(cluster, cost);
  return cost;
}

function formCost(form) {
  let ascii = 0;
  for (let i = 0; i < form.length; i++) {
    if (form.charCodeAt(i) < 0x80) ascii++;
  }
  return { ascii, bytes: Buffer.byteLength(form, 'utf8') - ascii };
}

// Decomposition is per code point, reordering keeps length, and composition
// never lengthens the UTF-8, so the largest of each code point's raw, NFD and
// NFKD forms, every byte at a full token, bounds any form of the run.
function longClusterCost(cluster) {
  let bytes = 0;
  for (const char of cluster) {
    bytes += Math.max(
      Buffer.byteLength(char, 'utf8'),
      Buffer.byteLength(char.normalize('NFD'), 'utf8'),
      Buffer.byteLength(char.normalize('NFKD'), 'utf8'),
    );
  }
  return { ascii: 0, bytes };
}

// About one token per non-ASCII character, what common Chinese measured. Used
// only to tell a user the conservative charge may be what refused them, never to
// admit input: Hangul, rare CJK and emoji measured up to 2.7, 4 (astral CJK)
// and 2.9 per character.
export function typicalTokens(text) {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 0x80) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / CHARS_PER_TOKEN + nonAscii);
}

export const CONSERVATIVE_NOTE =
  "Non-ASCII text is counted conservatively, so the real count may be lower than this figure; it cannot be known without the model's tokenizer.";

export function formatTokens(count) {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/**
 * Refuse loudly when the input cannot fit the window. Returns a note describing
 * what was (or could not be) checked; never truncates silently.
 */
export function checkContextBudget({
  estimatedTokens,
  contextLength,
  reserveTokens,
  providerName,
  model,
  oversizeHint,
  typicalTokens: typical,
}) {
  // An explicit --max-tokens is the reply length actually requested, so it
  // replaces the guess in both directions: a bigger reply needs more headroom,
  // a deliberately small one frees the window up for more input.
  const reserve = reserveTokens ?? DEFAULT_RESERVE_TOKENS;

  if (!contextLength) {
    return {
      checked: false,
      note: `Context window unknown for ${model} — set "contextLength" for provider "${providerName}" in the config to enable the size check.`,
    };
  }

  // Otherwise the budget goes negative and the refusal blames the input size,
  // which no amount of trimming can fix.
  if (reserve >= contextLength) {
    throw new UserError(
      `The requested reply length (${formatTokens(reserve)} tokens) does not fit ${model}'s ${formatTokens(contextLength)} window on "${providerName}".`,
      { hint: 'Lower --max-tokens, or raise the model context length in the server and the provider config.' },
    );
  }

  const budget = contextLength - reserve;
  if (estimatedTokens > budget) {
    throw new UserError(
      `Input is roughly ${formatTokens(estimatedTokens)} tokens but ${model} on "${providerName}" has a ${formatTokens(contextLength)} window ` +
        `(${formatTokens(budget)} usable after reserving ${formatTokens(reserve)} for the reply).` +
        (typical !== undefined && typical <= budget ? ` ${CONSERVATIVE_NOTE}` : ''),
      {
        // The caller knows what its input actually is. A review's input is a
        // diff chosen by --base/--commit, so "send fewer files" is advice for a
        // command the user did not run.
        hint:
          oversizeHint ??
          'Send fewer or smaller files, shorten the prompt, or raise the model context length in the server and config.',
        // The one refusal that sending less input can fix, so the one a caller
        // may retry smaller. The reserve refusal above is deliberately untagged.
        reason: 'oversize',
      },
    );
  }

  return {
    checked: true,
    note: `~${formatTokens(estimatedTokens)} of ${formatTokens(budget)} usable tokens.`,
  };
}
