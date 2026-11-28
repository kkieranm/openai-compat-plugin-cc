// The one definition of what a finding looks like in tests.
//
// Several test files need it, and byte-identical copies are the shape that
// drifts silently: edit one and nothing goes red. So it is shared rather than
// mirrored.
export const FINDING = { file: 'a.js', line: 3, severity: 'high', summary: 'boom', evidence: 'x()' };

export const payload = (findings = [FINDING], summary = 'one defect') =>
  JSON.stringify({ analysis: 'checked each path', findings, summary });
