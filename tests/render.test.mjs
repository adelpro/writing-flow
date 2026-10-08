import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDrift, renderProfile, renderVoiceCard } from '../skills/writing-flow/scripts/render.mjs';

const PROFILE = 'skills/voice-default';
const scratch = () => mkdtempSync(join(tmpdir(), 'wf-'));

test('a dry run reports writes and changes nothing', async () => {
  const target = scratch();
  const r = await renderProfile({ profileDir: PROFILE, targetRoot: target });
  assert.equal(r.ok, true);
  assert.ok(r.writes.some((w) => w.action === 'create'));
  assert.equal(existsSync(join(target, 'voice-default')), false);
});

test('a second real render changes nothing', async () => {
  const target = scratch();
  await renderProfile({ profileDir: PROFILE, targetRoot: target, mode: 'copy', dryRun: false });
  const r = await renderProfile({ profileDir: PROFILE, targetRoot: target, mode: 'copy', dryRun: false });
  assert.ok(r.writes.length > 0);
  assert.ok(r.writes.every((w) => w.action === 'unchanged'), JSON.stringify(r.writes));
});

test('a missing copy is reported as drift', async () => {
  const d = await checkDrift({ profileDir: PROFILE, roots: [scratch()] });
  assert.equal(d.ok, false);
  assert.equal(d.drift[0].reason, 'missing');
});

test('a hand-edited copy is reported as drift', async () => {
  const target = scratch();
  await renderProfile({ profileDir: PROFILE, targetRoot: target, mode: 'copy', dryRun: false });
  const file = join(target, 'voice-default', 'SKILL.md');
  writeFileSync(file, readFileSync(file, 'utf8') + '\nhand edit\n');
  const d = await checkDrift({ profileDir: PROFILE, roots: [target] });
  assert.equal(d.ok, false);
  assert.equal(d.drift[0].reason, 'content-differs');
});

test('the voice card is self-contained', () => {
  const card = renderVoiceCard(
    { name: 'x', version: '1.0.0', languages: ['en'], houseStyle: './house-style.json', arabicStages: [], requiredSkills: [] },
    'VOICE',
  );
  assert.match(card, /VOICE/);
  assert.ok(!card.includes('${'), 'no unresolved placeholders');
});

test('the voice card strips skill frontmatter and does not repeat the register', () => {
  const card = renderVoiceCard(
    { name: 'x', version: '1.0.0', languages: ['en'], houseStyle: './house-style.json', arabicStages: [], requiredSkills: [] },
    '---\nname: x\ndescription: a skill\n---\n\n# Voice\n\nWrite plainly.\n',
    { register: ['Plain professional prose.'] },
  );
  assert.ok(!card.includes('name: x'), 'frontmatter must not leak into the card');
  assert.ok(!card.includes('description: a skill'));
  assert.equal(card.match(/^## Register$/gm), null);
});

test('the committed default voice card matches what the generator produces', async () => {
  const { readFileSync } = await import('node:fs');
  const card = renderVoiceCard(
    JSON.parse(readFileSync('skills/voice-default/writing-profile.json', 'utf8')),
    readFileSync('skills/voice-default/SKILL.md', 'utf8'),
    JSON.parse(readFileSync('skills/voice-default/house-style.json', 'utf8')),
  );
  assert.equal(readFileSync('skills/voice-default/voice-card.md', 'utf8'), card);
});
