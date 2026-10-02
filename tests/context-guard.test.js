// The size estimate itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContextBudget, CONSERVATIVE_NOTE, estimateTokens, typicalTokens } from '../plugins/oai/scripts/lib/context-guard.mjs';
import { prepareRequest } from '../plugins/oai/scripts/lib/delegate.mjs';
import { buildMessages, DEFAULT_SYSTEM_PROMPT } from '../plugins/oai/scripts/lib/prompt.mjs';

test('the estimate assumes code density, not prose density', () => {
  // Measured live against LM Studio on two real diffs: 3.61 and 3.48
  // chars/token. At 4 the guard admitted input the server then rejected, which
  // is the one failure it exists to prevent.
  assert.equal(estimateTokens('x'.repeat(3400)), 1000);
  assert.ok(estimateTokens('x'.repeat(50_000)) >= 14_000, 'a 50 KB diff counted 13.9k tokens on the server');
});

test('the estimate never claims more room than the server gives', () => {
  // Erring high is safe (a needless refusal, loudly explained); erring low
  // sends a request the server rejects.
  const observed = [
    { chars: 50_022, serverTokens: 13_889 },
    { chars: 156_376, serverTokens: 44_997 },
  ];
  for (const { chars, serverTokens } of observed) {
    assert.ok(
      estimateTokens('x'.repeat(chars)) >= serverTokens,
      `${chars} chars measured ${serverTokens} tokens; the estimate must not fall below that`,
    );
  }
});

test('an input that fits is reported with what it used', () => {
  const budget = checkContextBudget({
    estimatedTokens: 100,
    contextLength: 8192,
    reserveTokens: 1024,
    providerName: 'local',
    model: 'm',
  });
  assert.equal(budget.checked, true);
  assert.match(budget.note, /100 of 7.2k usable tokens/);
});

test('an unknown window disarms the check rather than guessing', () => {
  const budget = checkContextBudget({ estimatedTokens: 100, contextLength: undefined, providerName: 'local', model: 'm' });
  assert.equal(budget.checked, false);
  assert.match(budget.note, /Context window unknown/);
});

// Rates measured against LM Studio (prompt_tokens, qwen3.5-9b and gemma-4-12b-it)
// on runs of random code points from each range, and for common Chinese on
// random draws from ~500 frequent characters; `tokensPerCodePoint` is the
// higher of the two tokenizers. The strings below are generated, so these tests
// pin the estimate against the rates, not against a tokenizer's count of these
// exact strings.
const MEASURED_SCRIPTS = [
  { name: 'common Chinese', text: '的一是不了人我在有他这中大来上国个到说们'.repeat(150), tokensPerCodePoint: 0.986 },
  { name: 'distinct CJK', from: 0x4e00, to: 0x9fff, tokensPerCodePoint: 1.867 },
  { name: 'CJK Extension A', from: 0x3400, to: 0x4dbf, tokensPerCodePoint: 2.977 },
  { name: 'CJK Extension B (astral)', from: 0x20000, to: 0x2a6df, tokensPerCodePoint: 4.0 },
  { name: 'kana', from: 0x3041, to: 0x30ff, tokensPerCodePoint: 1.093 },
  { name: 'Hangul syllables', from: 0xac00, to: 0xd7a3, tokensPerCodePoint: 2.68 },
  { name: 'emoji', from: 0x1f300, to: 0x1f5ff, tokensPerCodePoint: 2.897 },
  { name: 'Cyrillic', from: 0x0410, to: 0x044f, tokensPerCodePoint: 0.896 },
  { name: 'Devanagari', from: 0x0905, to: 0x0939, tokensPerCodePoint: 1.139 },
];

function spread(from, to, count) {
  return Array.from({ length: count }, (_, i) => String.fromCodePoint(from + ((i * 7919) % (to - from)))).join('');
}

test('non-Latin text is never estimated below the measured per-code-point rates', () => {
  for (const script of MEASURED_SCRIPTS) {
    const text = script.text ?? spread(script.from, script.to, 3000);
    const codePoints = [...text].length;
    const floor = Math.ceil(codePoints * script.tokensPerCodePoint);
    assert.ok(estimateTokens(text) >= floor, `${script.name}: ${codePoints} code points cost up to ${floor} tokens`);
  }
});

test('200k CJK characters are refused against a 154k window', () => {
  // At 3.4 chars/token this would estimate ~58.9k and be admitted; the server
  // spends more than the whole window on it.
  const text = spread(0x4e00, 0x9fff, 200_308);
  assert.throws(
    () => checkContextBudget({ estimatedTokens: estimateTokens(text), contextLength: 154_624, providerName: 'local', model: 'm' }),
    (error) => error.reason === 'oversize',
  );
});

test('mixed input charges each part on its own terms', () => {
  const code = 'const total = items.reduce((sum, item) => sum + item.price, 0);\n'.repeat(50);
  const comment = '// 合计所有商品的价格\n';
  assert.equal(estimateTokens(code), Math.ceil(code.length / 3.4));
  assert.ok(estimateTokens(code + comment) >= estimateTokens(code) + [...'合计所有商品的价格'].length * 3);
});

test('a lone surrogate is charged three bytes', () => {
  // Buffer.byteLength counts a lone surrogate as U+FFFD, three bytes.
  assert.equal(estimateTokens('\udc00'), 3);
});

test('characters that normalisation expands are charged their expanded size', () => {
  // A tokenizer that applies NFC spends 3 tokens on each U+0344 (2 bytes raw,
  // 4 after NFC); NFKC turns U+FDFA (3 bytes) into 18 characters, 30 bytes of
  // Arabic letters plus 3 spaces.
  assert.ok(estimateTokens('\u0344'.repeat(3000)) >= 9000);
  assert.ok(estimateTokens('\ufdfa'.repeat(100)) >= 3000);
  // NFKC also shrinks fullwidth letters to ASCII; the larger forms still count.
  assert.equal(estimateTokens('\uff21'.repeat(100)), 300);
  // Decomposed Hangul is larger raw (three 3-byte jamo) than composed (one
  // 3-byte syllable), so the raw form counts too.
  assert.equal(estimateTokens('\uac01'.normalize('NFD').repeat(100)), 900);
  // Mixed, NFC is the largest form: it expands U+0344 and keeps the fullwidth
  // letter that NFKC would shrink.
  assert.equal(estimateTokens('\u0344\uff21'.repeat(1000)), 7000);
});

test('composition between neighbouring characters is charged', () => {
  // é + U+0323 normalises to U+1EB9 + U+0301: 5 bytes, not the 4 of each
  // character normalised alone.
  assert.equal(estimateTokens('\u00e9\u0323'.repeat(1000)), 5000);
  // d + U+0307 composes to U+1E0B, turning a cheap ASCII letter into 3 bytes.
  assert.equal(estimateTokens('d\u0307'.repeat(2)), 6);
  // Halfwidth voiced marks are not marks until NFKD makes them U+3099/U+309A,
  // after which the dot below composes with the e ahead of them.
  assert.equal(estimateTokens('\u00e9\uff9e\u0323'), 8);
  assert.equal(estimateTokens('\u00e9\uff9f\u0323'), 8);
  // Kirat Rai composes two letters; the raw bytes still bound it.
  assert.ok(estimateTokens('\u{16D63}\u{16D67}') >= 8);
});

test('a long run of combining marks is sized in linear time', () => {
  // Whole-string normalisation of this is quadratic: ~8 s per normal form at
  // 160k characters, where the cluster charge takes tens of milliseconds.
  const text = '\u0315\u0300'.repeat(100_000);
  const started = performance.now();
  const estimate = estimateTokens(text);
  assert.ok(performance.now() - started < 5000, 'estimate took too long');
  assert.ok(estimate >= Buffer.byteLength(text, 'utf8'));
  // A run too long to normalise is charged its decomposed size: U+0344 is
  // 2 bytes raw and 4 decomposed.
  assert.ok(estimateTokens('\u0344'.repeat(40)) >= 160);
  // U+1E9B is 3 bytes raw and in NFKD, 4 in NFD.
  assert.ok(estimateTokens(`\u1e9b${'\u0323'.repeat(40)}`) >= 84);
  // U+0F77 has only a compatibility decomposition: 3 bytes raw, 9 in NFKD.
  assert.ok(estimateTokens('\u0f77'.repeat(40)) >= 360);
  // U+2126 OHM SIGN decomposes to U+03A9: 3 bytes raw, 2 decomposed.
  assert.ok(estimateTokens(`\u2126${'\u0300'.repeat(40)}`) >= 83);
});

test('Latin-1 letters are charged their two bytes', () => {
  assert.equal(estimateTokens('\u00e9'.repeat(100)), 200);
});

function refusal(prompt) {
  try {
    prepareRequest({ profile: { name: 'local' }, prompt, files: [], model: 'm', contextLength: 8192, maxTokens: 1024 });
  } catch (error) {
    return error;
  }
  assert.fail('expected an oversize refusal');
}

test('a refusal that only the conservative charge caused says so', () => {
  // 5,000 CJK characters: ~15k by the estimate, ~5k at one token each, against
  // a 7.2k budget.
  const error = refusal('中'.repeat(5000));
  assert.equal(error.reason, 'oversize');
  assert.ok(error.message.includes(CONSERVATIVE_NOTE), error.message);
});

test('non-ASCII input too large even at one token per character carries no conservative note', () => {
  const error = refusal('中'.repeat(8000));
  assert.equal(error.reason, 'oversize');
  assert.ok(!error.message.includes(CONSERVATIVE_NOTE), error.message);
});

test('the conservative note weighs ASCII at the code ratio and counts characters, not code units', () => {
  // Mixed: ~11.9k by the estimate, ~6k at one token per non-ASCII character.
  assert.ok(refusal(`${'x'.repeat(10_000)}${'中'.repeat(3000)}`).message.includes(CONSERVATIVE_NOTE));
  // Astral: 4,000 characters are 8,000 UTF-16 units.
  assert.ok(refusal('\u{20000}'.repeat(4000)).message.includes(CONSERVATIVE_NOTE));
});

test('the conservative note measures the whole request, system prompt included', () => {
  // A prompt that fits the budget at one token per character on its own, and
  // does not once the system prompt is counted with it.
  const budget = 8192 - 1024;
  const joined = (prompt) => buildMessages({ system: DEFAULT_SYSTEM_PROMPT, prompt, files: [] }).map((m) => m.content).join('\n');
  const prompt = '中'.repeat(budget - typicalTokens(joined('')) + 1);
  assert.ok(typicalTokens(prompt) <= budget);
  assert.ok(typicalTokens(joined(prompt)) > budget);
  assert.ok(!refusal(prompt).message.includes(CONSERVATIVE_NOTE));
});

test('the conservative note does not claim the input fits', () => {
  assert.match(CONSERVATIVE_NOTE, /may be lower/);
  assert.match(CONSERVATIVE_NOTE, /cannot be known/);
});

test('one stray non-ASCII character in oversized ASCII input carries no conservative note', () => {
  const error = refusal(`${'x'.repeat(40_000)} \u2014`);
  assert.equal(error.reason, 'oversize');
  assert.ok(!error.message.includes(CONSERVATIVE_NOTE), error.message);
});

test('a refusal of ASCII input carries no conservative note', () => {
  const error = refusal('x'.repeat(40_000));
  assert.equal(error.reason, 'oversize');
  assert.ok(!error.message.includes(CONSERVATIVE_NOTE), error.message);
});
