import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export class ProfileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileError';
  }
}

const MANIFEST = 'writing-profile.json';
const HOUSE_STYLE = 'house-style.json';

/** Skill roots that harnesses read. Does not include the plugin's own bundled skills. */
export function defaultRoots() {
  const home = homedir();
  return [
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills'),
    join(home, '.config', 'opencode', 'skills'),
  ];
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const asStringArray = (value, field) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ProfileError(`profile manifest: "${field}" must be an array of strings`);
  }
  return value;
};

/**
 * Read and validate a profile manifest from a directory.
 * Throws ProfileError naming the offending field.
 */
export function readManifest(dir) {
  const manifestPath = join(dir, MANIFEST);
  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    throw new ProfileError(`profile manifest not found: ${manifestPath}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ProfileError(`profile manifest is not valid JSON: ${manifestPath} (${err.message})`);
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ProfileError(`profile manifest must be a JSON object: ${manifestPath}`);
  }
  if (data.kind !== 'voice') {
    throw new ProfileError(`profile manifest: "kind" must be "voice", got ${JSON.stringify(data.kind)}`);
  }
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    throw new ProfileError('profile manifest: "name" must be a non-empty string');
  }
  if (typeof data.houseStyle !== 'string' || data.houseStyle.trim() === '') {
    throw new ProfileError('profile manifest: "houseStyle" must be a non-empty string');
  }

  // The Agent Plugins containment rule: a package path must stay inside the package.
  const base = resolve(dir);
  const houseStylePath = resolve(base, data.houseStyle);
  if (houseStylePath !== base && !houseStylePath.startsWith(base + sep)) {
    throw new ProfileError(
      `profile manifest: "houseStyle" escapes the profile directory (${data.houseStyle})`,
    );
  }

  return {
    kind: 'voice',
    name: data.name,
    version: typeof data.version === 'string' ? data.version : '0.0.0',
    languages: asStringArray(data.languages, 'languages'),
    houseStyle: data.houseStyle,
    arabicStages: asStringArray(data.arabicStages, 'arabicStages'),
    requiredSkills: asStringArray(data.requiredSkills, 'requiredSkills'),
  };
}

const scanTier = (roots, tier) => {
  const found = [];
  for (const root of roots) {
    if (!root || !isDir(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = join(root, entry.name);
      if (!existsSync(join(dir, MANIFEST))) continue;
      const manifest = readManifest(dir);
      found.push({ dir, manifest, tier });
    }
  }
  return found.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
};

/**
 * Resolve the active profile.
 * Tiers, in order: a project override, an installed profile, the bundled default.
 * Ambiguity is reported only among candidates in the SAME tier.
 */
export async function resolveProfile({ cwd = process.cwd(), roots = defaultRoots(), pluginRoot = null } = {}) {
  const shape = (candidate, resolvedBy, candidates, ambiguous) => ({
    dir: candidate.dir,
    manifest: candidate.manifest,
    houseStylePath: resolve(candidate.dir, candidate.manifest.houseStyle),
    resolvedBy,
    candidates: candidates.map((c) => c.dir),
    ambiguous,
  });

  const project = join(cwd, MANIFEST);
  if (existsSync(project)) {
    const candidate = { dir: resolve(cwd), manifest: readManifest(cwd) };
    return shape(candidate, 'project', [candidate], false);
  }

  const installed = scanTier(roots, 'installed');
  if (installed.length > 0) {
    return shape(installed[0], 'installed', installed, installed.length > 1);
  }

  const bundledRoots = pluginRoot ? [join(pluginRoot, 'skills')] : [];
  const bundled = scanTier(bundledRoots, 'bundled');
  if (bundled.length > 0) {
    return shape(bundled[0], 'bundled', bundled, bundled.length > 1);
  }

  throw new ProfileError('no voice profile found: no project override, no installed profile, no bundled default');
}

export { HOUSE_STYLE };
