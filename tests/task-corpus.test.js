// The task corpus, and the guard that makes a prose-scored case admissible.
//
// The review corpus has an anchor-liveness test: every anchor must be real code.
// A prose-scored corpus structurally cannot have that — there is no quoted line
// to check. Its replacement is the executable witness, and the load-bearing test
// here is the one that RUNS each witness against both trees. A case whose
// witness does not separate them is not evidence, however good its prose.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { ARMS, attachmentArgs, loadTaskCases } from '../bench/lib/task-corpus.mjs';
import { tempDir } from './helpers.mjs';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;

async function witnessExit(caseDef, tree) {
  try {
    await run(process.execPath, [join(caseDef.dir, caseDef.witness), join(caseDef.dir, tree)]);
    return 0;
  } catch (error) {
    return error.code ?? 1;
  }
}

test('the corpus loads and every case declares both framing arms', async () => {
  const cases = loadTaskCases(ROOT);
  assert.ok(cases.length >= 1, 'the corpus is empty');
  for (const caseDef of cases) {
    for (const arm of ARMS) {
      assert.ok(caseDef.prompts[arm]?.trim(), `${caseDef.id} is missing its ${arm} prompt`);
    }
  }
});

test('EVERY witness fails against before/ and passes against after/', async () => {
  // The whole corpus's licence to be called evidence. A witness that passes on
  // before/ is describing a defect that is not there; one that fails on after/
  // is describing something the fix did not address. Either way the case cannot
  // score an answer about it.
  for (const caseDef of loadTaskCases(ROOT)) {
    assert.equal(await witnessExit(caseDef, 'before'), 1, `${caseDef.id}: witness must FAIL on before/`);
    assert.equal(await witnessExit(caseDef, 'after'), 0, `${caseDef.id}: witness must PASS on after/`);
  }
});

test('no prompt contains a marker it will be scored on', async () => {
  // Enforced at load, asserted here too: the loader's refusal is the mechanism,
  // and this proves the mechanism is armed against the real corpus rather than
  // only against a fixture.
  for (const caseDef of loadTaskCases(ROOT)) {
    for (const arm of ARMS) {
      const prompt = caseDef.prompts[arm].toLowerCase();
      for (const claim of caseDef.claims) {
        for (const marker of claim.any) {
          assert.ok(!prompt.includes(marker.toLowerCase()), `${caseDef.id}/${arm} leaks "${marker}"`);
        }
      }
    }
  }
});

test('a case attaches only files that exist in before/, by absolute path', async () => {
  for (const caseDef of loadTaskCases(ROOT)) {
    const args = attachmentArgs(caseDef);
    assert.equal(args.length, caseDef.files.length * 2);
    for (let i = 0; i < args.length; i += 2) {
      assert.equal(args[i], '--file');
      assert.ok(args[i + 1].startsWith('/'), 'attachments are absolute so cwd cannot change what is sent');
    }
  }
});

test('the loader refuses a case missing an arm, a witness or a fixture tree', async () => {
  // Driven against the real loader with a scratch corpus, so the refusals are
  // observed rather than asserted from reading.
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const base = tempDir('oai-taskcorpus-');
  const dir = join(base, 'bench/task-cases/broken');
  mkdirSync(dir, { recursive: true });

  const good = {
    id: 'broken', label: 'x', template: 'advisor', files: ['a.mjs'], witness: 'w.mjs',
    prompts: { neutral: 'n', pointed: 'p' }, claims: [{ id: 'c', any: ['zzz'] }],
  };
  const write = (patch) => writeFileSync(join(dir, 'case.json'), JSON.stringify({ ...good, ...patch }));

  write({ prompts: { neutral: 'n' } });
  assert.throws(() => loadTaskCases(base), /needs a non-empty "pointed" prompt/);

  write({});
  assert.throws(() => loadTaskCases(base), /needs a before\/ tree/);

  mkdirSync(join(dir, 'before'), { recursive: true });
  mkdirSync(join(dir, 'after'), { recursive: true });
  writeFileSync(join(dir, 'before/a.mjs'), '');
  assert.throws(() => loadTaskCases(base), /witness w.mjs does not exist/);

  writeFileSync(join(dir, 'w.mjs'), '');
  assert.deepEqual(loadTaskCases(base).map((c) => c.id), ['broken'], 'a complete case loads');

  // And the leakage guard fires on a prompt that hands over its own marker.
  write({ prompts: { neutral: 'mentions zzz', pointed: 'p' } });
  assert.throws(() => loadTaskCases(base), /leaks|contains the marker/);
});
