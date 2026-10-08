import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateProfile } from '../skills/writing-flow/scripts/generate.mjs';
import { readManifest } from '../skills/writing-flow/scripts/profile.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'wf-'));

const SOURCE = `---
name: someone-voice
description: how someone writes
---

# Voice

## Persona
- First person, reporting honestly.
- Numbers do the selling.

## Pipeline
0. Run \`purple-cow-content\` for the angle.
1. Draft in this voice.
2. Run \`fasaha\` for Arabic pieces.

Exit \`0\` clean, \`1\` violation.

\`\`\`powershell
powershell -NoProfile -File "$env:USERPROFILE\\scripts\\write-gate.ps1"
\`\`\`

## Tone
- No calls to action.
`;

const writeSource = (dir, text = SOURCE) => {
  const file = join(dir, 'SOURCE.md');
  writeFileSync(file, text);
  return file;
};

const fileIn = (r, suffix) => r.files.find((f) => f.path.endsWith(suffix));

test('previews every file without writing anything', async () => {
  const root = scratch();
  const out = join(root, 'myvoice');
  const r = await generateProfile({ source: writeSource(root), name: 'myvoice', outDir: out });
  assert.equal(r.dryRun, true);
  for (const suffix of ['SKILL.md', 'writing-profile.json', 'house-style.json', 'voice-card.md']) {
    assert.ok(fileIn(r, suffix), `missing ${suffix}`);
  }
  assert.equal(existsSync(out), false, 'a preview must create nothing');
});

test('reports every line it would drop as pipeline, with a reason', async () => {
  const r = await generateProfile({ source: writeSource(scratch()), name: 'myvoice', outDir: scratch() });
  assert.ok(r.excluded.length > 0);
  assert.ok(r.excluded.every((e) => typeof e.line === 'number' && typeof e.why === 'string' && e.why));
  const dropped = r.excluded.map((e) => e.text).join('\n');
  assert.match(dropped, /purple-cow-content/);
  assert.match(dropped, /write-gate\.ps1/);
});

test('keeps the voice prose and drops the source frontmatter', async () => {
  const r = await generateProfile({ source: writeSource(scratch()), name: 'myvoice', outDir: scratch() });
  const skill = fileIn(r, 'SKILL.md').content;
  assert.match(skill, /First person, reporting honestly/);
  assert.match(skill, /No calls to action/);
  assert.ok(!skill.includes('someone-voice'), 'the source frontmatter must not survive');
});

test('includeAll keeps every line', async () => {
  const r = await generateProfile({ source: writeSource(scratch()), name: 'myvoice', outDir: scratch(), includeAll: true });
  assert.deepEqual(r.excluded, []);
  assert.match(fileIn(r, 'SKILL.md').content, /purple-cow-content/);
});

test('refuses to write without confirm', async () => {
  const root = scratch();
  const out = join(root, 'myvoice');
  await assert.rejects(
    () => generateProfile({ source: writeSource(root), name: 'myvoice', outDir: out, dryRun: false }),
    /confirm/,
  );
  assert.equal(existsSync(out), false);
});

test('writes a profile the engine accepts', async () => {
  const root = scratch();
  const out = join(root, 'myvoice');
  await generateProfile({ source: writeSource(root), name: 'myvoice', outDir: out, dryRun: false, confirm: true });
  const manifest = readManifest(out);
  assert.equal(manifest.name, 'myvoice');
  assert.equal(manifest.kind, 'voice');
  assert.equal(manifest.houseStyle, './house-style.json');
  assert.ok(existsSync(join(out, 'SKILL.md')));
  assert.ok(existsSync(join(out, 'voice-card.md')));
});

test('carries a house style found beside the source', async () => {
  const root = scratch();
  writeFileSync(join(root, 'house-style.json'), JSON.stringify({ name: 'from source', mechanics: { quotes: 'straight' } }));
  const r = await generateProfile({ source: writeSource(root), name: 'myvoice', outDir: join(root, 'myvoice') });
  assert.equal(JSON.parse(fileIn(r, 'house-style.json').content).name, 'from source');
});

test('falls back to a neutral house style when the source has none', async () => {
  const r = await generateProfile({ source: writeSource(scratch()), name: 'myvoice', outDir: scratch() });
  const house = JSON.parse(fileIn(r, 'house-style.json').content);
  assert.ok(house.mechanics);
  assert.equal(typeof house.name, 'string');
});

test('adds frontmatter when the source has none', async () => {
  const root = scratch();
  const file = join(root, 'PLAIN.md');
  writeFileSync(file, '# Voice\n\nWrite plainly.\n');
  const r = await generateProfile({ source: file, name: 'plain', outDir: join(root, 'plain') });
  const skill = fileIn(r, 'SKILL.md').content;
  assert.match(skill, /^---\nname: plain\n/);
  assert.match(skill, /\ndescription: /);
});

test('reads SKILL.md when handed a directory', async () => {
  const root = scratch();
  writeFileSync(join(root, 'SKILL.md'), '# Voice\n\nQuiet and factual.\n');
  const r = await generateProfile({ source: root, name: 'quiet', outDir: join(root, 'out') });
  assert.match(fileIn(r, 'SKILL.md').content, /Quiet and factual/);
});

test('rejects a source it cannot read and a name that is not a safe directory', async () => {
  const root = scratch();
  await assert.rejects(() => generateProfile({ source: join(root, 'nope.md'), name: 'x', outDir: join(root, 'o') }), /source/i);
  await assert.rejects(
    () => generateProfile({ source: writeSource(root), name: '../escape', outDir: join(root, 'o') }),
    /name/i,
  );
});
