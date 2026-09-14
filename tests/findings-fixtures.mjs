// The one definition of what a finding looks like in tests.
//
// It was copied into a second test file when the size budget forced a split,
// and byte-identical copies are the shape that drifts silently: edit one and
// nothing goes red. Shared instead of mirrored — the repo's "generate, don't
// mirror" rule at the scale it actually bit.
export const FINDING = { file: 'a.js', line: 3, severity: 'high', summary: 'boom', evidence: 'x()' };

export const payload = (findings = [FINDING], summary = 'one defect') =>
  JSON.stringify({ analysis: 'checked each path', findings, summary });
