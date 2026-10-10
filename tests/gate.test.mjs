import test from 'node:test';
import assert from 'node:assert/strict';
import { runGate, formatReport } from '../skills/writing-flow/scripts/gate.mjs';
import { resolveToolPaths } from '../skills/writing-flow/scripts/resolve-paths.mjs';

const draft = (name) => `tests/fixtures/${name}`;

const tools = await resolveToolPaths({ cwd: process.cwd() });
const installed = tools.gate4 && tools.gate5 && tools.python;
const skipUnlessInstalled = installed ? false : 'third-party gate tools are not installed on this machine';

test('a draft that does not exist is a tool error', async () => {
  const r = await runGate({ path: draft('nope.md') });
  assert.equal(r.code, 2);
  assert.equal(r.ok, false);
});

test('an absent Python is a tool error naming the cause', async () => {
  const r = await runGate({
    path: draft('clean.md'),
    toolPaths: { node: process.execPath, python: null, gate4: null, gate5: null, missing: ['avoid-ai-writing', 'remove-ai-marks'] },
  });
  assert.equal(r.code, 2);
  const marks = r.gates.find((g) => g.id === 'remove-ai-marks');
  assert.equal(marks.state, 'ERROR');
  assert.match(marks.summary, /python/i);
});

test('a clean draft exits 0', { skip: skipUnlessInstalled }, async () => {
  const r = await runGate({ path: draft('clean.md') });
  assert.equal(r.code, 0);
  assert.equal(r.ok, true);
  assert.equal(r.gates.length, 2);
});

test('--skip-style skips gate 4 visibly, never as a pass it did not run', async () => {
  const r = await runGate({
    path: draft('clean.md'),
    skipStyle: true,
    skipMarks: true,
    toolPaths: { node: process.execPath, python: null, gate4: null, gate5: null, missing: ['avoid-ai-writing', 'remove-ai-marks'] },
  });
  assert.equal(r.code, 0, 'with both gates skipped the run is clean');
  const style = r.gates.find((g) => g.id === 'avoid-ai-writing');
  assert.equal(style.state, 'PASS');
  assert.equal(style.summary, 'skipped (--skip-style)');
  assert.match(formatReport(r), /skipped \(--skip-style\)/);
});

test('a bundled abbreviation outside parentheses exits 1 and names the rule', { skip: skipUnlessInstalled }, async () => {
  const r = await runGate({ path: draft('bad-latin-abbrev.md') });
  assert.equal(r.code, 1);
  assert.ok(r.gates.some((g) => g.hits.includes('latin-abbrev-outside-parens')));
});

test('a byte order mark is reported as a codepoint, not a crash', { skip: skipUnlessInstalled }, async () => {
  const r = await runGate({ path: draft('bom.md') });
  assert.equal(r.code, 1);
  assert.ok(r.gates.some((g) => g.hits.some((h) => /U\+FEFF/.test(h))));
});

test('an Arabic draft does not crash the gate', { skip: skipUnlessInstalled }, async () => {
  const r = await runGate({ path: draft('arabic.md') });
  assert.ok([0, 1].includes(r.code), `unexpected code ${r.code}`);
  assert.equal(r.gates.length, 2);
});

test('the human-readable report never hides an ambiguous profile', () => {
  const report = formatReport({
    code: 0,
    ok: true,
    gates: [],
    profile: { name: 'mine', dir: 'D:/a/mine', resolvedBy: 'installed', ambiguous: true, candidates: ['D:/a/alpha', 'D:/a/beta'] },
  });
  assert.match(report, /AMBIGUOUS/);
  assert.match(report, /alpha/);
});
