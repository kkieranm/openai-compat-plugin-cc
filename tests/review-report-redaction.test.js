import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorReport } from '../scripts/lib/review-report.mjs';

// `errorReport()`'s return value is what `publishFailure` persists
// into `jobs.db`'s `row.failure`, and later shown to any reader of
// `/oai:result`. `error.endpoint` / `error.responseBody` can be secret-shaped
// (a `baseUrl` credential, or a server's echoed request body) — this pins
// their absence by construction: `errorReport` builds its object from an
// explicit field list, so it cannot copy a field it does not name, no matter
// what the source error carries.

test('errorReport never copies .endpoint, .responseBody, .bodyExcerpt or .finishReason, even when all four are present', () => {
  // All four fields this feature introduced, pinned together — a test that
  // covers only some of them lets a regression on the others ship silently
  // even though the production code (an explicit field list) was
  // already safe.
  const marker = 'SECRET_MARKER';
  const error = Object.assign(new Error('Cannot reach p — connection refused.'), {
    reason: 'non-retryable-transport',
    hint: 'Check the server is running.',
    endpoint: `http://127.0.0.1:1/${marker}/v1`,
    responseBody: `Unexpected endpoint or method. (POST /${marker}/v1/chat/completions)`,
    bodyExcerpt: `<html>${marker}</html>`,
    finishReason: marker,
  });

  const report = errorReport(error);
  const serialized = JSON.stringify(report);

  for (const field of ['endpoint', 'responseBody', 'bodyExcerpt', 'finishReason']) {
    assert.equal(field in report, false, `the report must not carry .${field} at all`);
  }
  assert.doesNotMatch(serialized, new RegExp(marker), 'the marker must not survive anywhere in the persisted shape');
});

test('errorReport still reports the fields it is meant to', () => {
  const error = Object.assign(new Error('a real failure'), { reason: 'transport', hint: 'try again' });
  const report = errorReport(error);

  assert.equal(report.error, true);
  assert.equal(report.reason, 'transport');
  assert.equal(report.message, 'a real failure');
  assert.equal(report.hint, 'try again');
});
