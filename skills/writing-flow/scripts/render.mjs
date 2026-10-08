import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readManifest } from './profile.mjs';

const CARD = 'voice-card.md';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const isDir = (p) => {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Read the profile's own house-style.json, tolerating absence or damage. */
const readHouseStyle = (profileDir, manifest) => {
  const path = resolve(profileDir, manifest.houseStyle);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
};

/** Strip YAML frontmatter: the card is a paste-anywhere document, not a skill. */
const stripFrontmatter = (text) => String(text).replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '').trim();

/**
 * Render a self-contained, portable card for a profile: the artifact that works in clients
 * with neither MCP nor Agent Plugins support.
 */
export function renderVoiceCard(manifest, voiceText, houseStyle = {}) {
  const mechanics = houseStyle.mechanics ?? {};
  const register = houseStyle.register ?? [];
  const lines = [
    `# Voice Card — ${manifest.name}`,
    '',
    `Version ${manifest.version} · Languages: ${(manifest.languages ?? []).join(', ') || 'unspecified'}`,
    '',
    'Self-contained. Paste this into any chat or custom agent when it should write on this',
    "profile's behalf.",
    '',
    '## Voice',
    '',
    stripFrontmatter(voiceText),
    '',
  ];
  if (register.length > 0) {
    lines.push('## House style', '', ...register.map((r) => `- ${r}`), '');
  }
  const mechanical = Object.entries(mechanics);
  if (mechanical.length > 0) {
    lines.push('## Mechanics', '', ...mechanical.map(([k, v]) => `- ${k}: ${v}`), '');
  }
  lines.push(
    '## Scope',
    '',
    'Mechanics are all this card checks. It cannot tell you whether a draft sounds like the',
    'voice above.',
    '',
  );
  return lines.join('\n');
}

const sourceFiles = (profileDir) => {
  const names = readdirSync(profileDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  if (!names.includes(CARD)) names.push(CARD);
  return names.sort();
};

const contentFor = (profileDir, manifest, file, voiceText) => {
  if (file !== CARD) return readFileSync(join(profileDir, file));
  const card = renderVoiceCard(manifest, voiceText, readHouseStyle(profileDir, manifest));
  return Buffer.from(card, 'utf8');
};

/**
 * Render a profile from the store into a harness skill root.
 * Defaults to a dry run: the caller must opt in to writing.
 */
export async function renderProfile({ profileDir, targetRoot, mode = 'junction', dryRun = true, force = false } = {}) {
  if (!existsSync(join(profileDir, 'SKILL.md'))) {
    throw new Error(`render: profile has no SKILL.md: ${profileDir}`);
  }
  const manifest = readManifest(profileDir);
  const source = resolve(profileDir);
  const target = join(targetRoot, basename(source));
  const voiceText = readFileSync(join(source, 'SKILL.md'), 'utf8');
  const writes = [];

  if (mode === 'junction') {
    const exists = existsSync(target);
    if (exists && isDir(target) && !isLink(target) && !dryRun && !force) {
      throw new Error(`render: ${target} exists as a real directory; pass force to replace it`);
    }
    const action = !exists ? 'create' : isLink(target) ? 'unchanged' : 'update';
    writes.push({ path: target, action, hash: sha256(Buffer.from(source)) });
    if (!dryRun && action !== 'unchanged') {
      mkdirSync(targetRoot, { recursive: true });
      if (exists) rmSync(target, { recursive: true, force: true });
      symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return { target, ok: true, mode, writes, voiceCard: join(target, CARD) };
  }

  for (const file of sourceFiles(source)) {
    const content = contentFor(source, manifest, file, voiceText);
    const dest = join(target, file);
    const hash = sha256(content);
    const action = !existsSync(dest) ? 'create' : sha256(readFileSync(dest)) === hash ? 'unchanged' : 'update';
    writes.push({ path: dest, action, hash });
    if (!dryRun && action !== 'unchanged') {
      mkdirSync(target, { recursive: true });
      writeFileSync(dest, content);
    }
  }
  return { target, ok: true, mode, writes, voiceCard: join(target, CARD) };
}

/** Compare the store against every rendered copy and report divergence. */
export async function checkDrift({ profileDir, roots = [] } = {}) {
  const manifest = readManifest(profileDir);
  const source = resolve(profileDir);
  const voiceText = existsSync(join(source, 'SKILL.md')) ? readFileSync(join(source, 'SKILL.md'), 'utf8') : '';
  const drift = [];

  for (const root of roots) {
    const target = join(root, basename(source));
    if (!existsSync(target)) {
      drift.push({ root, path: target, reason: 'missing' });
      continue;
    }
    for (const file of sourceFiles(source)) {
      const dest = join(target, file);
      if (!existsSync(dest)) {
        drift.push({ root, path: dest, reason: 'missing-file' });
        continue;
      }
      const expected = sha256(contentFor(source, manifest, file, voiceText));
      if (sha256(readFileSync(dest)) !== expected) {
        drift.push({ root, path: dest, reason: 'content-differs' });
      }
    }
  }
  return { ok: drift.length === 0, drift };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]).endsWith('render.mjs');
if (invokedDirectly) {
  const [command, dir, ...rest] = process.argv.slice(2);
  if (command === 'card' && dir) {
    const manifest = readManifest(dir);
    const voice = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const card = renderVoiceCard(manifest, voice, readHouseStyle(dir, manifest));
    if (rest.includes('--write')) {
      writeFileSync(join(dir, CARD), card, 'utf8');
      console.log(`wrote ${join(dir, CARD)}`);
    } else {
      process.stdout.write(card);
    }
  } else {
    console.error('usage: node render.mjs card <profileDir> [--write]');
    process.exit(2);
  }
}
