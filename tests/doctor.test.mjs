import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor } from '../skills/writing-flow/scripts/doctor.mjs';
import { renderProfile } from '../skills/writing-flow/scripts/render.mjs';

const STORE = 'skills/voice-default';
const scratch = () => mkdtempSync(join(tmpdir(), 'wf-'));

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

test('flags a rendered copy that no longer matches the store', async () => {
  const root = scratch();
  await renderProfile({ profileDir: STORE, targetRoot: root, mode: 'copy', dryRun: false });
  const file = join(root, 'voice-default', 'SKILL.md');
  writeFileSync(file, readFileSync(file, 'utf8') + '\nhand edit\n');
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [root], store: STORE });
  assert.ok(d.drift.length >= 1);
  assert.ok(d.problems.some((p) => /drift/i.test(p)));
});
