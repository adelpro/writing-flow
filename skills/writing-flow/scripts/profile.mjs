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
    // The packaged fallback marks itself, so installing a real profile never competes with it.
    isDefault: data.isDefault === true,
  };
}

const scanTier = (roots, tier, skipped = []) => {
  const found = [];
  for (const root of roots) {
    if (!root || !isDir(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = join(root, entry.name);
      if (!existsSync(join(dir, MANIFEST))) continue;
      try {
        found.push({ dir, manifest: readManifest(dir), tier });
      } catch (err) {
        // A manifest belonging to another tool, or half-written, must not poison resolution.
        skipped.push({ dir, reason: err.message });
      }
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
  const skipped = [];
  const shape = (candidate, resolvedBy, candidates, ambiguous) => ({
    dir: candidate.dir,
    manifest: candidate.manifest,
    houseStylePath: resolve(candidate.dir, candidate.manifest.houseStyle),
    resolvedBy,
    candidates: candidates.map((c) => c.dir),
    ambiguous,
    warnings: skipped,
  });

  const project = join(cwd, MANIFEST);
  if (existsSync(project)) {
    const candidate = { dir: resolve(cwd), manifest: readManifest(cwd) };
    return shape(candidate, 'project', [candidate], false);
  }

  // A profile that marks itself as the packaged default never competes with a real one, and
  // never counts towards ambiguity. Without this, copying the default into a harness root
  // would make every genuine profile look ambiguous.
  const installedAll = scanTier(roots, 'installed', skipped);
  const installed = installedAll.filter((c) => !c.manifest.isDefault);
  if (installed.length > 0) {
    return shape(installed[0], 'installed', installed, installed.length > 1);
  }

  const bundledRoots = pluginRoot ? [join(pluginRoot, 'skills')] : [];
  const bundledAll = scanTier(bundledRoots, 'bundled', skipped);
  const bundled = bundledAll.filter((c) => !c.manifest.isDefault);
  if (bundled.length > 0) {
    return shape(bundled[0], 'bundled', bundled, bundled.length > 1);
  }

  const fallback = bundledAll[0] ?? installedAll[0] ?? null;
  if (fallback) return shape(fallback, 'bundled', [fallback], false);

  throw new ProfileError('no voice profile found: no project override, no installed profile, no bundled default');
}

export { HOUSE_STYLE };

const PREFERENCES = 'learned-preferences.json';

/**
 * Read what a profile has learned. Absence and damage both mean "nothing learned yet" —
 * a corrupted notes file must never stop someone writing.
 */
export function readPreferences(dir) {
  const file = join(dir, PREFERENCES);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.text === 'string') : [];
  } catch {
    return [];
  }
}
