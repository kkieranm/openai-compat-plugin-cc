// What a named task is *for*: the question, the reply shape, and the duty the
// caller owes the answer.
//
// `/oai:task` is deliberately generic — it carries no opinion about what the
// model is being asked to do — so every advisor-shaped call re-invented its own
// prompt and the three things that make an advisor useful drifted between
// callers. This is the same split `/oai:review` already runs on: `review.mjs`
// owns the question and the reply shape, and the caller's duty is printed with
// every rendering rather than stated once in a command file nobody re-reads.
import { UserError } from './errors.mjs';

/**
 * Terse, negative, and about the *approach* rather than the code.
 *
 * In the house style of `REVIEW_RULES`, and for the same measured reason: a
 * small local model follows a short list of prohibitions far better than a long
 * description of good judgement. The prohibitions are what keep this from
 * collapsing into `/oai:review` — a defect hunt over the same files is a
 * different question with a command of its own.
 */
const ADVISOR_SYSTEM =
  'You are an experienced engineer giving a second opinion on an approach someone is about to take. ' +
  'They will describe what they plan to do, and attach the files it touches. ' +
  'Judge the PLAN, not the code: do not review the files for defects, and do not rewrite anything. ' +
  'Answer in exactly three sections, with these headings and nothing before them: ' +
  'STRONGEST OBJECTION, ASSUMED WITHOUT EVIDENCE, WHAT I WOULD CHECK FIRST. ' +
  'Be specific and name files and functions you were given. ' +
  'Never invent file contents you were not shown. ' +
  'If what you were given is not enough to judge the approach, say so plainly and say what is missing ' +
  '— that is a useful answer, and guessing is not. ' +
  'No praise, no summary of what the code does, no restating the plan back.';

/**
 * The duty the caller owes the answer, and the reason this is a template rather
 * than a prompt.
 *
 * Worded for whoever eventually ACTS, never for the immediate reader: this line
 * is printed by `/oai:result` too, whose `allowed-tools` is `Bash(node:*)` with
 * no `Read`, so telling *its* reader to go and check the code would instruct
 * something that command cannot do. "before anyone acts on it" is true on both
 * paths.
 */
const ADVISOR_DISCIPLINE =
  'This is an unverified second opinion from a small local model, and it saw only the files that were ' +
  'attached. Check each objection against the code before anyone acts on it.';

/**
 * Where a large request stops being one this model can reason over.
 *
 * A HEURISTIC, and named as one wherever it is explained: it is anchored between
 * two runs that differ in far more than size — a 1,680-token single-file request
 * that produced a specific checkable finding, and a 49,378-token whole-tree
 * request that returned nothing at all. It is not a measured threshold, and the
 * caveat it triggers is worded to claim no more than that.
 *
 * Compared with `>`, so exactly at the ceiling does not caveat — the same
 * convention `tests/structure.test.js` uses against its own line budget.
 */
const ADVISOR_CEILING_TOKENS = 8000;

/**
 * The duty owed by a reply whose template this build does not recognise.
 *
 * Says only what remains true without the template in hand: the answer came from
 * a small local model and has not been checked. It deliberately does NOT claim
 * anything about the request's size, which cannot be judged without the ceiling
 * the unknown template would have carried.
 */
const UNKNOWN_TEMPLATE_DISCIPLINE =
  'This job records a task template name this build does not recognise, so this build cannot say which ' +
  'framing was applied or show that template\'s caveats. Treat it as unverified output from a small local ' +
  'model and check it against the code before anyone acts on it.';

export const TEMPLATES = {
  advisor: {
    name: 'advisor',
    system: ADVISOR_SYSTEM,
    discipline: ADVISOR_DISCIPLINE,
    softCeilingTokens: ADVISOR_CEILING_TOKENS,
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * The template a name refers to, or a refusal naming the ones that exist.
 *
 * Refusing beats falling back to no template: a mistyped name that silently ran
 * the generic path would produce an answer in the wrong shape with no indication
 * why, which is the "reported state must describe what will actually happen"
 * defect this repo keeps having to unpick.
 */
export function resolveTemplate(name) {
  if (name === undefined) return null;
  // `Object.hasOwn`, never a bare lookup: `TEMPLATES['toString']` finds
  // `Object.prototype.toString` and is truthy, so `--template toString` was
  // ACCEPTED — and then ran with the DEFAULT system prompt, persisted the name
  // `Object` for `--template constructor`, and printed `undefined` where the
  // discipline line belongs. A closed set has to be closed against the
  // prototype chain, not only against unknown words.
  const template = Object.hasOwn(TEMPLATES, name) ? TEMPLATES[name] : undefined;
  if (!template) {
    throw new UserError(`Unknown --template "${name}".`, {
      hint: `Known templates: ${TEMPLATE_NAMES.join(', ')}.`,
    });
  }
  return template;
}

/**
 * Everything a reader must be told about a templated answer, in one place
 * because two renderings print it.
 *
 * `task-report.mjs` shows a foreground run and `cmd-result.mjs` shows the same
 * run collected later, and REPO_TRAPS instance 16 is this repo printing a caveat
 * on one of two renderings — inside the module built to stop exactly that. One
 * function, so they cannot drift.
 *
 * The size states are THREE, not two. "Above the ceiling" and "below it" are the
 * obvious pair; the third is "the figure was not recorded". Folding that into
 * "below" would render a large request identically to a small one, which is trap
 * instance 14 wearing a new hat.
 *
 * **What can actually reach that third state, stated precisely, because the first
 * version of this comment got it wrong and a review caught it.** NOT "an older
 * persisted row": a row written before templates existed carries no `template`
 * at all, so it returns above without ever reaching the size check. The reachable
 * case is a row whose build persisted the pair differently — a future template
 * that records no estimate, or a partial write. Nothing this build submits can
 * produce it, which is why no round-trip test can either.
 */
export function templateNotes({ name, estimatedTokens } = {}) {
  // No template at all: an ordinary task, which must be byte-identical to what
  // it printed before templates existed.
  if (!name) return [];

  const template = Object.hasOwn(TEMPLATES, name) ? TEMPLATES[name] : undefined;
  // A name this build does not know — usually a row a NEWER build wrote, which
  // `job-view.mjs` deliberately still reads. The size caveat cannot be computed
  // without the template's ceiling, but the duty can still be stated, and
  // stating it generically beats printing nothing: silence here would drop the
  // one line telling a reader the answer is unverified, on exactly the reply
  // whose template this build cannot vouch for.
  //
  // The wording says the row RECORDS a name, never that a template was applied.
  // Those differ: a row could name a template whose framing never reached the
  // model, and asserting otherwise would be a message whose stated precondition
  // differs from what happened — the defect this repo repeats most.
  if (!template) return [UNKNOWN_TEMPLATE_DISCIPLINE];

  const notes = [];

  if (estimatedTokens === undefined || estimatedTokens === null) {
    notes.push(
      'NOTE: the size of this request was not recorded, so this cannot say whether it was large ' +
        'enough to have crowded the answer.',
    );
  } else if (estimatedTokens > template.softCeilingTokens) {
    // Claims only what it can support. It must NOT offer to explain an *empty*
    // answer: `requireAnswer` throws before either rendering reaches these
    // notes, so a caveat naming emptiness would be unreachable in exactly the
    // case it named.
    notes.push(
      `NOTE: this request was large (~${estimatedTokens} tokens against a rough working ceiling of ` +
        `${template.softCeilingTokens} for this template). A thin or shallow answer may mean the model had ` +
        'too much to hold rather than that there was little to say. Attaching fewer files is what fixes that.',
    );
  }

  notes.push(template.discipline);
  return notes;
}
