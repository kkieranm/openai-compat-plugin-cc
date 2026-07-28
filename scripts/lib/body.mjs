import { UserError } from './errors.mjs';

/**
 * Reading a response body. Separate from `http.mjs` (which makes the request)
 * and from `sse.mjs` (which frames an event stream), because the size ratchet
 * in tests/structure.test.js is a design instrument, not an obstacle: one
 * module per question — send it, read it, frame it.
 */

/**
 * The whole body as text.
 *
 * `limit` stops early and releases the socket, which matters on the error path:
 * the non-2xx handler quotes the first 400 characters, and a server answering a
 * failure with an endless body would otherwise be its own hang — the exact
 * shape of bug this feature exists to remove.
 */
export async function readText(response, { limit } = {}) {
  let text = '';
  for await (const chunk of response.stream) {
    text += chunk;
    if (limit !== undefined && text.length >= limit) {
      response.dispose();
      return text.slice(0, limit);
    }
  }
  return text;
}

/** The whole body, parsed. `what` names the source so a failure says whose. */
export async function readJson(response, what, { maxChars } = {}) {
  const text = await readText(response, maxChars ? { limit: maxChars + 1 } : {});
  if (maxChars && text.length > maxChars) {
    const failure = new UserError(`${what} sent more than ${maxChars} characters without completing a JSON document.`, {
      hint: 'The reply is not a completion; check what is actually listening on that port.',
    });
    failure.reason = 'protocol';
    failure.serverResponded = true;
    throw failure;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    // Quoting the reply is what identifies a proxy login page or an HTML error
    // in the path; "invalid JSON" alone sends the reader to the wrong server.
    const failure = new UserError(`${what} returned a non-JSON response: ${error.message}`, {
      hint: `The reply began: ${text.trim().slice(0, 200) || '(empty)'}`,
    });
    failure.reason = 'bad-json';
    failure.serverResponded = true;
    throw failure;
  }
}
