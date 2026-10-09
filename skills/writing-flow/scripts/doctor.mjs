import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, resolveProfile, ProfileError } from './profile.mjs';
import { resolveToolPaths } from './resolve-paths.mjs';
import { checkCard, checkDrift } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = resolve(HERE, '..', '..', '..');

const describeDrift = (entry) => `drift: ${entry.reason} at ${entry.path}`;

/** The `version:` field of a SKILL.md frontmatter block, or null when it has none. */
const frontmatterVersion = (text) => {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;
  const line = block[1].match(/^version:\s*["']?([^"'\r\n]+?)["']?\s*$/m);
  return line ? line[1] : null;
};

/** Problems inside one profile directory: its voice card and its declared version. */
const checkProfileFiles = (dir, manifestVersion) => {
  const problems = [];
  const card = checkCard({ profileDir: dir });
  if (card) {
    problems.push(`stale card: ${card.path} no longer matches SKILL.md (run: node render.mjs card ${dir} --write)`);
  }
  const skill = join(dir, 'SKILL.md');
  if (existsSync(skill)) {
    const declared = frontmatterVersion(readFileSync(skill, 'utf8'));
    if (declared && declared !== manifestVersion) {
      problems.push(`version mismatch: SKILL.md says ${declared}, writing-profile.json says ${manifestVersion}`);
    }
  }
  return problems;
};

/**
 * Report, in one call, everything a person needs to explain their writing setup:
 * the effective profile, where it came from, which tools resolved, and whether any
 * rendered copy has diverged from the store.
 */
export async function runDoctor({ cwd = process.cwd(), pluginRoot = DEFAULT_PLUGIN_ROOT, roots = null, store = null, toolPaths = null } = {}) {
  const problems = [];
  let profile = null;
  let ambiguity = [];

  try {
    if (store) {
      const dir = resolve(store);
      const manifest = readManifest(dir);
      profile = { name: manifest.name, version: manifest.version, dir, resolvedBy: 'store' };
    } else {
      const r = await resolveProfile({ cwd, pluginRoot, roots: roots ?? undefined });
      profile = { name: r.manifest.name, version: r.manifest.version, dir: r.dir, resolvedBy: r.resolvedBy };
      if (r.ambiguous) {
        ambiguity = r.candidates;
        problems.push(`ambiguous: ${r.candidates.length} profiles installed at the same tier: ${r.candidates.join(', ')}`);
      }
    }
  } catch (err) {
    if (err instanceof ProfileError) problems.push(`profile: ${err.message}`);
    else throw err;
  }

  if (profile) problems.push(...checkProfileFiles(profile.dir, profile.version));

  const tools = toolPaths ?? (await resolveToolPaths({ cwd, pluginRoot, roots: roots ?? null }));
  const missing = [...(tools.missing ?? [])];
  for (const skill of missing) {
    problems.push(`missing skill: ${skill} is not installed in any known skill root`);
  }
  if (!tools.python) {
    problems.push('python not found on PATH: the provenance gate cannot run');
  }

  const searchRoots = roots ?? tools.roots ?? [];
  const rendered = profile
    ? searchRoots.filter((root) => {
        const target = resolve(join(root, basename(profile.dir)));
        // Only a directory that is itself a profile counts as a rendered copy. A same-named
        // directory carrying no manifest is stale or unrelated, not drift.
        return (
          existsSync(target) &&
          existsSync(join(target, 'writing-profile.json')) &&
          target !== resolve(profile.dir)
        );
      })
    : [];

  let drift = [];
  if (profile && rendered.length > 0) {
    const report = await checkDrift({ profileDir: profile.dir, roots: rendered });
    drift = report.drift;
    for (const entry of drift) problems.push(describeDrift(entry));
  }

  return {
    ok: problems.length === 0,
    profile,
    ambiguity,
    missing,
    python: tools.python,
    gate4: tools.gate4,
    gate5: tools.gate5,
    roots: searchRoots,
    rendered,
    drift,
    problems,
  };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]).endsWith('doctor.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  const report = await runDoctor({ store: flag('--store') });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const p = report.profile;
    process.stdout.write(`profile : ${p ? `${p.name} ${p.version} (${p.resolvedBy}) at ${p.dir}` : 'none'}\n`);
    process.stdout.write(`gate4   : ${report.gate4 ? report.gate4.path : 'MISSING'}\n`);
    process.stdout.write(`gate5   : ${report.gate5 ? report.gate5.path : 'MISSING'}\n`);
    process.stdout.write(`python  : ${report.python ?? 'MISSING'}\n`);
    process.stdout.write(`rendered: ${report.rendered.length === 0 ? 'nowhere' : report.rendered.join(', ')}\n`);
    for (const problem of report.problems) process.stdout.write(`problem : ${problem}\n`);
    process.stdout.write(report.ok ? 'doctor: OK\n' : 'doctor: PROBLEMS\n');
  }
  process.exit(report.ok ? 0 : 1);
}
