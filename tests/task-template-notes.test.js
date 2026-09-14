// The template builders themselves: what `templateNotes` says, what
// `resolveTemplate` refuses, and what `persistRequest` writes.
//
// Split from `tests/task-template.test.js` at the size ratchet. The seam is the
// one that file already had: it drives the CLI and a real worker, and these are
// pure functions with no server, no process and no database — so they belong
// apart rather than being the tail of an integration suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { persistRequest } from '../scripts/lib/job-request.mjs';
import { TEMPLATES, resolveTemplate, templateNotes } from '../scripts/lib/task-template.mjs';

const ADVISOR = TEMPLATES.advisor;

test('the size caveat fires above the ceiling and not at it', async () => {
  const ceiling = ADVISOR.softCeilingTokens;
  const over = templateNotes({ name: 'advisor', estimatedTokens: ceiling + 1 });
  const at = templateNotes({ name: 'advisor', estimatedTokens: ceiling });

  assert.match(over[0], /this request was large/);
  assert.ok(!at.some((note) => /this request was large/.test(note)), 'exactly at the ceiling must not caveat');
  // The duty is owed either way — it is not a consequence of being large.
  assert.match(over.at(-1), /unverified second opinion/);
  assert.match(at.at(-1), /unverified second opinion/);
});

test('a MISSING size is distinguishable from a small one, not folded into it', async () => {
  // An older persisted row with no recorded estimate must not render
  // identically to a request known to be small, or a large run reads as a
  // considered one.
  const unknown = templateNotes({ name: 'advisor' });
  const small = templateNotes({ name: 'advisor', estimatedTokens: 100 });

  assert.match(unknown[0], /size of this request was not recorded/);
  assert.notDeepEqual(unknown, small);
  assert.equal(small.length, 1, 'a small request earns only the discipline line');
});

test('the size caveat never offers to explain an EMPTY answer', async () => {
  // It could not: `requireAnswer` throws in both renderings before any note is
  // written, so a caveat naming emptiness would be unreachable in exactly the
  // case it named. Guarded because the wording is the whole defect.
  const note = templateNotes({ name: 'advisor', estimatedTokens: ADVISOR.softCeilingTokens + 5000 })[0];
  assert.doesNotMatch(note, /empty/i);
  assert.match(note, /thin or shallow/);
});

test('an unknown template name still states the duty, rather than silently dropping it', async () => {
  // REVERSED DELIBERATELY. This asserted `[]` until a wide review pointed out
  // what that means: a row written by a NEWER build — which `job-view.mjs` goes
  // out of its way to keep readable — would render with no caveat at all, losing
  // the one line saying the answer is unverified on exactly the reply whose
  // template this build cannot vouch for. Silence is the wrong answer; a caveat
  // that claims less is the right one.
  const notes = templateNotes({ name: 'from-a-newer-build', estimatedTokens: 99999 });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /records a task template name this build does not recognise/);
  assert.match(notes[0], /unverified output from a small local model/);
  // It must NOT claim anything about size: without the unknown template's
  // ceiling there is nothing to compare 99999 against.
  assert.doesNotMatch(notes[0], /ceiling/);
});

test('no template name at all still yields nothing', async () => {
  // The other half, and the one that keeps an ordinary task unchanged.
  assert.deepEqual(templateNotes({}), []);
  assert.deepEqual(templateNotes(), []);
  assert.deepEqual(templateNotes({ estimatedTokens: 99999 }), []);
});

test('a prototype-inherited name is not a template', async () => {
  // `TEMPLATES['toString']` finds Object.prototype.toString and is truthy, so a
  // bare lookup ACCEPTED `--template toString` — then ran with the DEFAULT system
  // prompt, persisted the name `Object` for `--template constructor`, and printed
  // `undefined` where the discipline line belongs: a loud failure turned into a
  // valid-looking wrong answer.
  for (const name of ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty']) {
    assert.throws(() => resolveTemplate(name), /Unknown --template/, `${name} must be refused`);
    const notes = templateNotes({ name, estimatedTokens: 100 });
    assert.ok(!notes.includes(undefined), `${name} must not render an undefined note`);
    assert.match(notes[0], /records a task template name this build does not recognise/);
  }
});

test('an untemplated job persists NEITHER template nor estimatedTokens', async () => {
  // The claim "an ordinary task's DTO is unchanged" is only true if these are
  // gated together: `estimatedTokens` is always in hand, so spreading it
  // unconditionally would change every background task ever submitted.
  const dto = persistRequest({
    profile: { name: 'local' },
    numeric: {},
    messages: [{ role: 'user', content: 'hi' }],
    estimatedTokens: 4242,
    budget: { checked: true, note: null },
  });
  assert.ok(!('template' in dto), 'no template was selected, so none is stored');
  assert.ok(!('estimatedTokens' in dto), 'the estimate is stored only to render a template caveat');
});

test('a templated job persists the NAME and the estimate it was measured at', async () => {
  const dto = persistRequest({
    profile: { name: 'local' },
    numeric: {},
    messages: [{ role: 'user', content: 'hi' }],
    template: 'advisor',
    estimatedTokens: 4242,
    budget: { checked: true, note: null },
  });
  assert.equal(dto.template, 'advisor', 'the stable name, never the resolved registry object');
  assert.equal(typeof dto.template, 'string');
  assert.equal(dto.estimatedTokens, 4242);
});

test('persistRequest carries the budget check onto the DTO, unconditionally', async () => {
  const unchecked = persistRequest({
    profile: { name: 'local' },
    numeric: {},
    messages: [{ role: 'user', content: 'hi' }],
    budget: { checked: false, note: 'Context window unknown for x — set "contextLength" for provider "local".' },
  });
  assert.equal(unchecked.contextChecked, false);
  assert.equal(unchecked.contextNote, 'Context window unknown for x — set "contextLength" for provider "local".');

  const checked = persistRequest({
    profile: { name: 'local' },
    numeric: {},
    messages: [{ role: 'user', content: 'hi' }],
    budget: { checked: true, note: '~1.0k of 44.4k usable tokens.' },
  });
  assert.equal(checked.contextChecked, true);
  assert.equal(checked.contextNote, null, 'a checked run has nothing to warn about, regardless of what budget.note holds');
});
