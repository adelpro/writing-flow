import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor } from '../skills/writing-flow/scripts/doctor.mjs';
import { renderProfile, renderVoiceCard } from '../skills/writing-flow/scripts/render.mjs';
import { readManifest } from '../skills/writing-flow/scripts/profile.mjs';

const STORE = 'skills/voice-default';
const scratch = () => mkdtempSync(join(tmpdir(), 'wf-'));
const profileCopy = () => {
  const dir = join(scratch(), 'voice');
  cpSync(STORE, dir, { recursive: true });
  return dir;
};

test('reports the effective profile and how it was resolved', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [] });
  assert.ok(d.profile, 'doctor must always name a profile');
  assert.ok(['project', 'installed', 'bundled'].includes(d.profile.resolvedBy));
});

test('reports problems for every missing required skill', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [] });
  assert.ok(d.missing.length >= 1);
  assert.ok(d.problems.some((p) => /avoid-ai-writing/.test(p)));
  assert.equal(d.ok, false);
});

test('treats a root with no copy as not rendered, not as drift', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [scratch()] });
  assert.deepEqual(d.rendered, []);
  assert.deepEqual(d.drift, []);
});

test('names the roots where the profile is rendered', async () => {
  const root = scratch();
  await renderProfile({ profileDir: STORE, targetRoot: root, mode: 'copy', dryRun: false });
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [root], store: STORE });
  assert.deepEqual(d.rendered, [root]);
  assert.deepEqual(d.drift, []);
});

test('does not count the store itself as a rendered copy', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: ['skills'], store: STORE });
  assert.deepEqual(d.rendered, []);
});

test('a same-named directory with no manifest is not a rendered copy', async () => {
  const root = scratch();
  // A stale or unrelated directory that merely shares the profile's name.
  mkdirSync(join(root, 'voice-default'), { recursive: true });
  writeFileSync(join(root, 'voice-default', 'SKILL.md'), 'not a profile');
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [root], store: STORE });
  assert.deepEqual(d.rendered, []);
  assert.deepEqual(d.drift, []);
});

test('flags a rendered copy that no longer matches the store', async () => {
  const root = scratch();
  await renderProfile({ profileDir: STORE, targetRoot: root, mode: 'copy', dryRun: false });
  const file = join(root, 'voice-default', 'SKILL.md');
  writeFileSync(file, readFileSync(file, 'utf8') + '\nhand edit\n');
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [root], store: STORE });
  assert.ok(d.drift.length >= 1);
  assert.ok(d.problems.some((p) => /drift/i.test(p)));
});

test('flags a voice card that no longer matches its SKILL.md', async () => {
  const dir = profileCopy();
  writeFileSync(join(dir, 'voice-card.md'), 'an old card');
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: dir });
  assert.ok(d.problems.some((p) => /stale card/.test(p)));
  assert.equal(d.ok, false);
});

test('accepts a voice card regenerated from its SKILL.md', async () => {
  const dir = profileCopy();
  const card = renderVoiceCard(
    readManifest(dir),
    readFileSync(join(dir, 'SKILL.md'), 'utf8'),
    JSON.parse(readFileSync(join(dir, 'house-style.json'), 'utf8')),
  );
  writeFileSync(join(dir, 'voice-card.md'), card);
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: dir });
  assert.ok(!d.problems.some((p) => /stale card/.test(p)));
});

test('flags a SKILL.md version that differs from the manifest', async () => {
  const dir = profileCopy();
  const manifest = readManifest(dir);
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: voice\nversion: 9.9.9\n---\n\nVoice text.\n`);
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: dir });
  assert.ok(d.problems.some((p) => /version mismatch: SKILL\.md says 9\.9\.9/.test(p)), manifest.version);
});
