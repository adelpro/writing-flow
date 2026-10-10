import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probePython, resolveToolPaths, writePathsJson } from '../skills/writing-flow/scripts/resolve-paths.mjs';

const scratch = (prefix = 'wf-') => mkdtempSync(join(tmpdir(), prefix));

test('a python that cannot be found is reported as missing, with a cause', () => {
  const r = probePython(['definitely-not-a-python-binary-xyz']);
  assert.equal(r.path, null);
  assert.match(r.problem, /not found on PATH/);
});

const fakeTool = (root, skill, script) => {
  mkdirSync(join(root, skill, 'scripts'), { recursive: true });
  const path = join(root, skill, 'scripts', script);
  writeFileSync(path, '//');
  return path;
};

test('finds a tool under a root whose path contains spaces', async () => {
  const root = scratch('root with spaces ');
  const expected = fakeTool(root, 'avoid-ai-writing', 'check-style.js');
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root, roots: [root] });
  assert.equal(p.gate4.source, 'search');
  assert.equal(p.gate4.path, expected);
});

test('finds the provenance tool too', async () => {
  const root = scratch();
  const expected = fakeTool(root, 'remove-ai-marks', 'inspect_text.py');
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root, roots: [root] });
  assert.equal(p.gate5.source, 'search');
  assert.equal(p.gate5.path, expected);
});

test('reports a missing tool by name', async () => {
  const root = scratch();
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root, roots: [] });
  assert.equal(p.gate4, null);
  assert.ok(p.missing.includes('avoid-ai-writing'));
  assert.ok(p.missing.includes('remove-ai-marks'));
});

test('prefers paths.json over searching', async () => {
  const root = scratch();
  const elsewhere = scratch('other ');
  const recorded = fakeTool(elsewhere, 'avoid-ai-writing', 'check-style.js');
  writeFileSync(join(root, 'paths.json'), JSON.stringify({
    node: null,
    python: null,
    missing: [],
    gate4: { path: recorded, source: 'search' },
    gate5: null,
  }));
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root, roots: [root] });
  assert.equal(p.gate4.source, 'paths.json');
  assert.equal(p.gate4.path, recorded);
});

test('ignores a paths.json entry whose file is gone and searches instead', async () => {
  const root = scratch();
  const real = fakeTool(root, 'avoid-ai-writing', 'check-style.js');
  writeFileSync(join(root, 'paths.json'), JSON.stringify({
    node: null,
    python: null,
    missing: [],
    gate4: { path: join(root, 'gone', 'check-style.js'), source: 'search' },
    gate5: null,
  }));
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root, roots: [root] });
  assert.equal(p.gate4.path, real);
  assert.equal(p.gate4.source, 'search');
});

test('writePathsJson round-trips what resolveToolPaths reported', async () => {
  const root = scratch();
  const real = fakeTool(root, 'avoid-ai-writing', 'check-style.js');
  await writePathsJson(join(root, 'paths.json'), {
    node: 'node',
    python: null,
    missing: ['remove-ai-marks'],
    gate4: { path: real, source: 'search' },
    gate5: null,
  });
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root, roots: [] });
  assert.equal(p.gate4.path, real);
  assert.equal(p.gate4.source, 'paths.json');
  assert.ok(p.missing.includes('remove-ai-marks'));
});
