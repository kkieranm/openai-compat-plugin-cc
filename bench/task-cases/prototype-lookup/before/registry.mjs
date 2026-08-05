// The named task templates this build knows, and how a name resolves to one.
import { UserError } from './errors.mjs';

const TEMPLATES = {
  advisor: {
    name: 'advisor',
    system: 'You are an experienced engineer giving a second opinion on an approach.',
    discipline: 'Unverified output from a small local model. Check it before acting.',
    softCeilingTokens: 8000,
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

export function resolveTemplate(name) {
  if (name === undefined) return null;
  const template = TEMPLATES[name];
  if (!template) {
    throw new UserError(`Unknown --template "${name}".`, {
      hint: `Known templates: ${TEMPLATE_NAMES.join(', ')}.`,
    });
  }
  return template;
}
