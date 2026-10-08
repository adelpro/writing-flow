import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderVoiceCard } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..', '..', '..');

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Lines that belong to the pipeline rather than to a voice. The split is reported, never
 * applied silently: losing a voice to a bad heuristic is worse than reading a list.
 */
const PIPELINE_MARKERS = [
  { re: /\b(purple-cow-content|avoid-ai-writing|remove-ai-marks|fasaha)\b/, why: 'names a pipeline skill' },
  { re: /\bpipeline\b|\bbounded loop\b|\bstage order\b|\bvoice re-check\b/i, why: 'describes the pipeline or its loop' },
  { re: /exit\s+`?0`?[^\n]*clean/i, why: 'states the gate exit contract' },
  { re: /\bwrite-gate\b|\bgate\.mjs\b|\bgate4\b|\bgate5\b/i, why: 'references the gate' },
  { re: /avoid-ai-writing|remove-ai-marks/i, why: 'references a gate tool' },
];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

const neutralHouseStyle = () => {
  const bundled = join(PLUGIN_ROOT, 'skills', 'voice-default', 'house-style.json');
  if (existsSync(bundled)) {
    try {
      return JSON.parse(readFileSync(bundled, 'utf8'));
    } catch {
      // fall through to the inline default
    }
  }
  return {
    name: 'Neutral house style',
    genre: 'General professional prose',
    register: ['Plain professional prose. Concrete nouns and active verbs. No hype, no calls to action.'],
    mechanics: { quotes: 'straight', latinAbbrev: 'parentheses', serialComma: true },
  };
};

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Read a source file, or SKILL.md inside a source directory. */
const readSource = (source) => {
  const target = resolve(source);
  if (!existsSync(target)) throw new Error(`source not found: ${target}`);
  const file = isDir(target) ? join(target, 'SKILL.md') : target;
  if (!existsSync(file)) throw new Error(`source has no SKILL.md: ${target}`);
  return { file, dir: dirname(file), text: readFileSync(file, 'utf8') };
};

const stripFrontmatter = (text) => {
  const match = FRONTMATTER.exec(text);
  if (!match) return { body: text, description: null, dropped: null };
  const description = /^description:\s*(.+)$/m.exec(match[1])?.[1]?.replace(/^["']|["']$/g, '') ?? null;
  return { body: text.slice(match[0].length), description, dropped: match[0] };
};

/**
 * Separate voice prose from pipeline instruction.
 * A fenced block is dropped whole, including its fences.
 */
const splitVoice = (body, includeAll) => {
  if (includeAll) return { kept: body.split(/\r?\n/), excluded: [] };
  const kept = [];
  const excluded = [];
  let inFence = false;

  body.split(/\r?\n/).forEach((line, index) => {
    const isFence = /^\s*```/.test(line);
    if (inFence) {
      excluded.push({ line: index + 1, text: line, why: 'inside a code block' });
      if (isFence) inFence = false;
      return;
    }
    if (isFence) {
      inFence = true;
      excluded.push({ line: index + 1, text: line, why: 'opens a code block' });
      return;
    }
    const marker = PIPELINE_MARKERS.find((m) => m.re.test(line));
    if (marker) excluded.push({ line: index + 1, text: line, why: marker.why });
    else kept.push(line);
  });

  return { kept, excluded };
};

const tidy = (lines) => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

const buildFiles = ({ name, voice, description, houseStyle }) => {
  const manifest = {
    kind: 'voice',
    name,
    version: '1.0.0',
    languages: ['en', 'ar-MSA'],
    houseStyle: './house-style.json',
    arabicStages: ['fasaha', 'voice-recheck'],
    requiredSkills: ['purple-cow-content', 'fasaha', 'avoid-ai-writing', 'remove-ai-marks'],
  };
  const skill = `---\nname: ${name}\ndescription: ${description}\n---\n\n${voice}\n`;
  return { manifest, skill, houseStyle, frontmatter: { name, description } };
};

/**
 * Generate a profile from existing writing, in the standard format the engine reads.
 *
 * Preview by default. Applying requires an explicit `confirm`, because the split between
 * voice and pipeline instruction is a judgement the caller must review first.
 */
export async function generateProfile({
  source,
  name,
  outDir = null,
  description = null,
  dryRun = true,
  confirm = false,
  includeAll = false,
} = {}) {
  if (!source) throw new Error('generate: a source path is required');
  if (!name) throw new Error('generate: a profile name is required');
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`generate: name "${name}" is not usable as a profile directory name`);
  }
  if (!dryRun && confirm !== true) {
    throw new Error('generate: refusing to write without confirm: true — review the preview and the excluded lines first');
  }

  const { file, dir, text } = readSource(source);
  const { body, description: sourceDescription } = stripFrontmatter(text);
  const { kept, excluded } = splitVoice(body, includeAll);

  const voice = tidy(kept);
  if (!voice) throw new Error(`generate: the source produced no voice prose: ${file}`);

  const houseStylePath = join(dir, 'house-style.json');
  const houseStyle = existsSync(houseStylePath) ? JSON.parse(readFileSync(houseStylePath, 'utf8')) : neutralHouseStyle();

  const effectiveDescription =
    description ?? sourceDescription ?? `Writing voice profile "${name}". Use when writing in this person's voice.`;

  const built = buildFiles({ name, voice, description: effectiveDescription, houseStyle });
  const target = resolve(outDir ?? join(process.cwd(), name));
  const files = [
    { path: join(target, 'SKILL.md'), content: built.skill },
    { path: join(target, 'writing-profile.json'), content: `${JSON.stringify(built.manifest, null, 2)}\n` },
    { path: join(target, 'house-style.json'), content: `${JSON.stringify(houseStyle, null, 2)}\n` },
    { path: join(target, 'voice-card.md'), content: `${renderVoiceCard(built.manifest, built.skill, houseStyle)}\n` },
  ];

  if (!dryRun) {
    for (const item of files) {
      mkdirSync(dirname(item.path), { recursive: true });
      writeFileSync(item.path, item.content, 'utf8');
    }
  }

  return {
    source: file,
    name,
    dryRun,
    written: dryRun ? [] : files.map((f) => f.path),
    files,
    excluded,
    warnings: excluded.length > 0 && !includeAll
      ? [`${excluded.length} line(s) look like pipeline instruction and were left out. Review "excluded", then apply with confirm: true, or pass includeAll to keep them.`]
      : [],
  };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]).endsWith('generate.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const flag = (option) => {
    const index = argv.indexOf(option);
    return index === -1 ? null : argv[index + 1];
  };
  const apply = argv.includes('--apply');
  try {
    const report = await generateProfile({
      source: argv.find((a) => !a.startsWith('--')),
      name: flag('--name'),
      outDir: flag('--out'),
      dryRun: !apply,
      confirm: apply,
      includeAll: argv.includes('--include-all'),
    });
    for (const item of report.files) process.stdout.write(`${apply ? 'wrote' : 'would write'} ${item.path}\n`);
    for (const item of report.excluded) process.stdout.write(`  dropped L${item.line} (${item.why}): ${item.text.trim()}\n`);
    for (const warning of report.warnings) process.stdout.write(`warning: ${warning}\n`);
  } catch (err) {
    process.stdout.write(`generate: ERROR ${err.message}\n`);
    process.exit(2);
  }
}
