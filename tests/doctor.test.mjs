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

test('reports all six stages and what each needs', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: STORE, home: scratch(), smoke: false });
  assert.deepEqual(d.stages.map((s) => s.n), [0, 1, 2, 3, 4, 5]);
  assert.ok(d.stages.every((s) => typeof s.name === 'string' && 'status' in s && 'detail' in s));
  assert.ok(d.stages.some((s) => s.status !== 'ok'), 'a root with nothing installed cannot run every stage');
  assert.ok(d.problems.some((p) => /pipeline stage/.test(p)));
});

test('flags a skill that resolves twice inside one root, and names the fix', async () => {
  const root = scratch();
  for (const rel of ['writing-flow', join('nested', 'writing-flow')]) {
    mkdirSync(join(root, rel), { recursive: true });
    writeFileSync(join(root, rel, 'SKILL.md'), '---\nname: writing-flow\n---\n\nBody.\n');
  }
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [root], store: STORE, home: scratch(), smoke: false });
  assert.ok(d.problems.some((p) => /ambiguous skill: 2 copies of writing-flow/.test(p)), JSON.stringify(d.problems, null, 2));
  assert.ok(d.problems.some((p) => /delete all but one/.test(p)));
  assert.equal(d.skills.find((s) => s.skill === 'writing-flow').status, 'ambiguous');
});

test('does not treat the working directory as a skill root, however deep the copies go', async () => {
  // A project tree can carry vendored skill copies at any depth. Scanning the cwd for them reports
  // ambiguity in a root no harness loads, and buries the collisions that do matter.
  const cwd = scratch();
  const root = scratch();
  for (const [dir, file] of [
    [join(cwd, 'wf-a', 'writing-flow'), 'SKILL.md'],
    [join(cwd, 'wf-b', 'writing-flow'), 'SKILL.md'],
    [join(root, 'writing-flow'), 'SKILL.md'],
  ]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), '---\nname: writing-flow\n---\n\nBody.\n');
  }
  const d = await runDoctor({ cwd, pluginRoot: '.', roots: [cwd, root], store: STORE, home: scratch(), smoke: false });
  assert.equal(
    d.skills.find((s) => s.skill === 'writing-flow').status,
    'ok',
    JSON.stringify(d.problems, null, 2),
  );
});

test('one copy per root is not ambiguous, however many roots hold one', async () => {
  const a = scratch();
  const b = scratch();
  for (const root of [a, b]) {
    mkdirSync(join(root, 'writing-flow'), { recursive: true });
    writeFileSync(join(root, 'writing-flow', 'SKILL.md'), '---\nname: writing-flow\n---\n\nBody.\n');
  }
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [a, b], store: STORE, home: scratch(), smoke: false });
  assert.equal(d.skills.find((s) => s.skill === 'writing-flow').status, 'ok');
  assert.ok(!d.problems.some((p) => /ambiguous skill: .*writing-flow/.test(p)));
});

test('mcp is not-applicable when the machine has no ~/.hermes', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: STORE, home: scratch(), smoke: false });
  assert.equal(d.mcp.status, 'not-applicable');
});

test('mcp reports a missing registration with the command that fixes it', async () => {
  const home = scratch();
  mkdirSync(join(home, '.hermes'), { recursive: true });
  writeFileSync(join(home, '.hermes', 'config.yaml'), 'mcp_servers:\n  other:\n    command: node\n');
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: STORE, home, smoke: false });
  assert.equal(d.mcp.status, 'missing');
  assert.ok(/hermes mcp add writing-flow/.test(d.mcp.detail), d.mcp.detail);
  assert.equal(d.ok, false);
});

test('smoke exercises the real gate scripts, and skips rather than fails without them', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: STORE, smoke: true });
  if (!d.gate4 || !d.gate5) {
    assert.equal(d.smoke.status, 'skipped');
    assert.ok(d.warnings.some((w) => /not exercised/.test(w)));
    return;
  }
  assert.equal(d.smoke.status, 'ok', JSON.stringify(d.smoke));
  assert.deepEqual(d.smoke.exits, { bad: 1, good: 0 });
});

test('flags a SKILL.md version that differs from the manifest', async () => {
  const dir = profileCopy();
  const manifest = readManifest(dir);
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: voice\nversion: 9.9.9\n---\n\nVoice text.\n`);
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: dir });
  assert.ok(d.problems.some((p) => /version mismatch: SKILL\.md says 9\.9\.9/.test(p)), manifest.version);
});

test('warns about SKILL.md lines that generate_profile would drop, without failing the check', async () => {
  const dir = profileCopy();
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: voice\n---\n\nI write plainly about tools.\n\nRun the `remove-ai-marks` skill on every finished piece.\n',
  );
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [], store: dir });
  assert.ok(d.warnings.some((w) => /would be dropped by generate_profile/.test(w)));
  assert.ok(!d.problems.some((p) => /dropped/.test(p)));
});
