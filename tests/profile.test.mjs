import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { resolveProfile, readManifest, defaultRoots } from '../skills/writing-flow/scripts/profile.mjs';

const quiet = () => mkdtempSync(join(tmpdir(), 'wf-'));

const makeProfile = (dir, name, manifest = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'writing-profile.json'), JSON.stringify({
    kind: 'voice',
    name,
    version: '1.0.0',
    languages: ['en'],
    houseStyle: './house-style.json',
    arabicStages: [],
    requiredSkills: [],
    ...manifest,
  }));
  writeFileSync(join(dir, 'house-style.json'), '{}');
  return dir;
};

test('prefers a project override over an installed profile', async () => {
  const root = quiet();
  makeProfile(join(root, 'project'), 'project-voice');
  makeProfile(join(root, 'installed'), 'installed-voice');
  const r = await resolveProfile({ cwd: join(root, 'project'), roots: [root] });
  assert.equal(r.resolvedBy, 'project');
  assert.equal(r.manifest.name, 'project-voice');
  assert.equal(r.ambiguous, false);
});

test('resolves an installed profile and its house style path', async () => {
  const root = quiet();
  const dir = makeProfile(join(root, 'mine'), 'mine');
  const r = await resolveProfile({ cwd: root, roots: [root] });
  assert.equal(r.resolvedBy, 'installed');
  assert.equal(r.houseStylePath, join(dir, 'house-style.json'));
});

test('falls back to the bundled profile when nothing is installed', async () => {
  const root = quiet();
  makeProfile(join(root, 'skills', 'voice-default'), 'default');
  const r = await resolveProfile({ cwd: root, roots: [], pluginRoot: root });
  assert.equal(r.resolvedBy, 'bundled');
  assert.equal(r.manifest.name, 'default');
});

test('a bundled profile does not make an installed one ambiguous', async () => {
  const root = quiet();
  makeProfile(join(root, 'skills', 'voice-default'), 'default');
  makeProfile(join(root, 'mine'), 'mine');
  const r = await resolveProfile({ cwd: root, roots: [root], pluginRoot: root });
  assert.equal(r.resolvedBy, 'installed');
  assert.equal(r.ambiguous, false);
});

test('reports ambiguity rather than silently picking one', async () => {
  const root = quiet();
  makeProfile(join(root, 'a'), 'alpha');
  makeProfile(join(root, 'b'), 'beta');
  const r = await resolveProfile({ cwd: root, roots: [root] });
  assert.equal(r.ambiguous, true);
  assert.equal(r.candidates.length, 2);
});

test('the packaged default never makes a real profile ambiguous', async () => {
  const root = quiet();
  makeProfile(join(root, 'voice-default'), 'default', { isDefault: true });
  makeProfile(join(root, 'mine'), 'mine');
  const r = await resolveProfile({ cwd: root, roots: [root] });
  assert.equal(r.resolvedBy, 'installed');
  assert.equal(r.manifest.name, 'mine');
  assert.equal(r.ambiguous, false);
});

test('a manifest belonging to another tool is skipped, not fatal', async () => {
  const root = quiet();
  makeProfile(join(root, 'mine'), 'mine');
  mkdirSync(join(root, 'other-tool'), { recursive: true });
  writeFileSync(join(root, 'other-tool', 'writing-profile.json'), '{"kind":"not-a-voice"}');
  mkdirSync(join(root, 'half-written'), { recursive: true });
  writeFileSync(join(root, 'half-written', 'writing-profile.json'), '{ not json');
  const r = await resolveProfile({ cwd: root, roots: [root] });
  assert.equal(r.manifest.name, 'mine');
  assert.equal(r.warnings.length, 2);
});

test('readManifest throws naming the missing field', () => {
  const dir = quiet();
  writeFileSync(join(dir, 'writing-profile.json'), '{"kind":"voice"}');
  assert.throws(() => readManifest(dir), /name/);
});

test('readManifest rejects a house style path that escapes the profile', () => {
  const dir = quiet();
  writeFileSync(join(dir, 'writing-profile.json'), JSON.stringify({
    kind: 'voice',
    name: 'x',
    version: '1.0.0',
    languages: ['en'],
    houseStyle: '../../etc/passwd',
    arabicStages: [],
    requiredSkills: [],
  }));
  assert.throws(() => readManifest(dir), /houseStyle/);
});

test('defaultRoots returns absolute paths', () => {
  const roots = defaultRoots();
  assert.ok(roots.length >= 3);
  assert.ok(roots.every((r) => isAbsolute(r)));
});
