import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, resolveProfile, ProfileError } from './profile.mjs';
import { resolveToolPaths } from './resolve-paths.mjs';
import { checkCard, checkDrift } from './render.mjs';
import { isEntryPoint } from './entry.mjs';
import { generateProfile } from './generate.mjs';

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

/**
 * Problems and warnings inside one profile directory: its voice card, its declared version,
 * and lines of its SKILL.md that generate_profile would drop as pipeline instruction.
 */
const checkProfileFiles = async (dir, manifestVersion, manifestName) => {
  const problems = [];
  const warnings = [];
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
    const preview = await generateProfile({ source: skill, name: manifestName });
    if (preview.excluded.length > 0) {
      warnings.push(`${preview.excluded.length} line(s) of SKILL.md would be dropped by generate_profile as pipeline instruction (run the generator preview to review them)`);
    }
  }
  return { problems, warnings };
};

/**
 * The six pipeline stages and what each needs. Stage 3 re-uses what stage 1 reads: the Arabic pass
 * rewrites, so a voice re-check follows it, and neither can run without a profile.
 */
export const STAGES = [
  { n: 0, name: 'angle', skill: 'purple-cow-content' },
  { n: 1, name: 'draft in the active voice', profile: true },
  { n: 2, name: 'Arabic pass (fasaha)', skill: 'fasaha', arabicOnly: true },
  { n: 3, name: 'voice re-check', profile: true, arabicOnly: true },
  { n: 4, name: 'AI-ism audit (avoid-ai-writing)', skill: 'avoid-ai-writing', script: ['scripts', 'check-style.js'] },
  { n: 5, name: 'provenance strip (remove-ai-marks)', skill: 'remove-ai-marks', script: ['scripts', 'inspect_text.py'] },
];

/** Skills sit at a root or one category deep, so two levels finds both shapes. */
const SKILL_DEPTH = 2;

/** Every directory carrying a SKILL.md, named as the harness will name it. */
const findSkillDirs = (root) => {
  const found = [];
  const walk = (dir, depth) => {
    if (!existsSync(dir)) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const child = join(dir, entry.name);
      if (existsSync(join(child, 'SKILL.md'))) found.push({ name: entry.name, dir: child });
      if (depth > 1) walk(child, depth - 1);
    }
  };
  walk(root, SKILL_DEPTH);
  return found;
};

/**
 * Where each required skill resolves, and whether its name is ambiguous.
 *
 * Ambiguity is per root, never across them: each harness reads its own root, and the installer
 * deliberately puts a copy in several. Two copies inside ONE root is the failure — the harness
 * indexes by name, so it cannot choose, and the error presents as "skill not found".
 * Missing gate skills are reported by `resolveToolPaths` instead, and skipped here to avoid
 * saying the same thing twice.
 */
const checkSkills = (roots, required, alreadyReported = new Set()) => {
  const perRoot = new Map();
  for (const root of roots) {
    const bucket = new Map();
    for (const { name, dir } of findSkillDirs(root)) {
      if (!bucket.has(name)) bucket.set(name, []);
      const dirs = bucket.get(name);
      const resolved = resolve(dir);
      if (!dirs.includes(resolved)) dirs.push(resolved);
    }
    perRoot.set(resolve(root), bucket);
  }

  const skills = [];
  const problems = [];
  for (const skill of required) {
    const copies = [...perRoot.entries()]
      .map(([root, bucket]) => ({ root, dirs: bucket.get(skill) ?? [] }))
      .filter((entry) => entry.dirs.length > 0);

    const clash = copies.filter((entry) => entry.dirs.length > 1);
    for (const entry of clash) {
      problems.push(
        `ambiguous skill: ${entry.dirs.length} copies of ${skill} under ${entry.root} (${entry.dirs.join(', ')}) — a harness reading that root indexes by name and cannot load it; delete all but one`,
      );
    }

    const usable = copies.find((entry) => entry.dirs.length === 1);
    if (usable) {
      skills.push({ skill, status: 'ok', dir: usable.dirs[0], root: usable.root, clash: clash.map((entry) => entry.root) });
    } else if (copies.length === 0) {
      skills.push({ skill, status: 'missing', dir: null, root: null, clash: [] });
      if (!alreadyReported.has(skill)) {
        problems.push(`missing skill: ${skill} is not installed in any known skill root — stage(s) needing it cannot run`);
      }
    } else {
      skills.push({ skill, status: 'ambiguous', dir: clash[0]?.dirs[0] ?? null, root: clash[0]?.root ?? null, clash: clash.map((entry) => entry.root) });
    }
  }
  return { skills, problems };
};

/** Whether each of the six stages has what it needs, so a half-installed pipeline is visible. */
const checkStages = ({ profile, skills }) => {
  const byName = new Map(skills.map((entry) => [entry.skill, entry]));
  const stages = STAGES.map((stage) => {
    if (stage.profile) {
      const ok = Boolean(profile && existsSync(join(profile.dir, 'SKILL.md')));
      return { ...stage, status: ok ? 'ok' : 'missing', detail: profile?.dir ?? 'no profile resolved' };
    }
    const entry = byName.get(stage.skill);
    const dir = entry?.dir ?? null;
    const scriptOk = stage.script ? Boolean(dir && existsSync(join(dir, ...stage.script))) : true;
    const ok = entry?.status === 'ok' && scriptOk;
    const detail = dir ? (scriptOk ? dir : `${dir} (missing ${join(...stage.script)})`) : 'not installed';
    return { ...stage, status: ok ? 'ok' : 'missing', detail, clash: entry?.clash ?? [] };
  });
  return {
    stages,
    problems: stages.filter((stage) => stage.status !== 'ok').map((stage) => `pipeline stage ${stage.n} (${stage.name}) cannot run: ${stage.detail}`),
  };
};

/**
 * Run the gate against a known-bad and a known-good fixture — the real scripts, actually executed,
 * rather than resolved on disk. Skipped, never failed, when a gate script did not resolve: that
 * condition is already a problem of its own.
 */
export const smokeTest = ({ gate4, gate5 } = {}) => {
  if (!gate4 || !gate5) return { status: 'skipped', reason: 'a gate script did not resolve' };
  const dir = mkdtempSync(join(tmpdir(), 'wf-smoke-'));
  const fixtures = {
    bad: 'He said \u201cthis uses curly quotes\u201d and see e.g. the docs.\n',
    good: '## Straight quotes and a parenthesised abbreviation.\n\nSee the docs (e.g.) for the shape of it.\n',
  };
  const exits = {};
  for (const [name, text] of Object.entries(fixtures)) {
    const file = join(dir, `${name}.md`);
    writeFileSync(file, text, 'utf8');
    exits[name] = spawnSync(process.execPath, [join(HERE, 'gate.mjs'), file], { encoding: 'utf8' }).status;
  }
  if (exits.bad === 1 && exits.good === 0) return { status: 'ok', exits };
  return {
    status: 'failed',
    exits,
    reason: `a known-bad draft exited ${exits.bad} (expected 1) and a known-good one exited ${exits.good} (expected 0)`,
  };
};

/** The Hermes MCP surface, when there is one. Absent means not applicable, never a problem. */
export const checkMcp = ({ home }) => {
  const configPath = join(home, '.hermes', 'config.yaml');
  if (!existsSync(configPath)) return { status: 'not-applicable', detail: 'no ~/.hermes on this machine' };
  const server = join(home, '.hermes', 'skills', 'writing-flow', 'scripts', 'mcp-server.mjs');
  if (/^\s{2}writing-flow:/m.test(readFileSync(configPath, 'utf8'))) {
    return { status: 'ok', detail: `registered in ${configPath}` };
  }
  return {
    status: 'missing',
    detail: `not registered in ${configPath} — run: hermes mcp add writing-flow --command node --args ${server}`,
  };
};

/**
 * Report, in one call, everything a person needs to explain their writing setup:
 * the effective profile, where it came from, which tools resolved, whether any
 * rendered copy has diverged from the store, and whether the six stages can run.
 */
export async function runDoctor({ cwd = process.cwd(), pluginRoot = DEFAULT_PLUGIN_ROOT, roots = null, store = null, toolPaths = null, home = homedir(), smoke = false } = {}) {
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

  const warnings = [];
  if (profile) {
    const files = await checkProfileFiles(profile.dir, profile.version, profile.name);
    problems.push(...files.problems);
    warnings.push(...files.warnings);
  }

  const tools = toolPaths ?? (await resolveToolPaths({ cwd, pluginRoot, roots: roots ?? null }));
  const missing = [...(tools.missing ?? [])];
  for (const skill of missing) {
    problems.push(`missing skill: ${skill} is not installed in any known skill root`);
  }
  if (!tools.python) {
    problems.push(`${tools.pythonProblem ?? 'python not found on PATH'}: the provenance gate cannot run (skip it with --skip-marks)`);
  }

  const searchRoots = roots ?? tools.roots ?? [];
  // The Hermes root is scanned for the skill inventory only, never for drift: it holds what the
  // skills CLI put there, which is not a rendered copy of the store.
  //
  // The cwd is a search root for *tools*, not for skills. A harness reads fixed roots, and a
  // project tree can carry vendored copies of a skill at any depth — reporting those as ambiguous
  // names a root nothing loads, and buries the collisions that matter.
  const cwdResolved = resolve(cwd);
  const skillRoots = [
    ...new Set([
      ...searchRoots.filter((root) => resolve(root) !== cwdResolved),
      ...(existsSync(join(home, '.hermes', 'skills')) ? [join(home, '.hermes', 'skills')] : []),
    ]),
  ];

  // The four skills the profile names, plus the pipeline skill itself. Reported by name and
  // status, because "the harness cannot load this" is the failure a user actually meets.
  const required = [...new Set(['writing-flow', ...((profile && readManifest(profile.dir)?.requiredSkills) ?? [])])];
  const skillReport = checkSkills(skillRoots, required, new Set(missing));
  problems.push(...skillReport.problems);

  const stageReport = checkStages({ profile, skills: skillReport.skills });
  problems.push(...stageReport.problems);

  const smokeReport = smoke ? smokeTest({ gate4: tools.gate4, gate5: tools.gate5 }) : { status: 'not-run' };
  if (smokeReport.status === 'failed') problems.push(`the gate scripts are not behaving: ${smokeReport.reason}`);
  if (smokeReport.status === 'skipped') warnings.push(`the gate scripts were not exercised: ${smokeReport.reason}`);

  const mcp = checkMcp({ home });
  if (mcp.status === 'missing') problems.push(`the MCP server is ${mcp.detail}`);
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
    pythonProblem: tools.pythonProblem ?? null,
    gate4: tools.gate4,
    gate5: tools.gate5,
    roots: searchRoots,
    skills: skillReport.skills,
    stages: stageReport.stages,
    smoke: smokeReport,
    mcp,
    rendered,
    drift,
    problems,
    warnings,
  };
}

/** The report as the lines a person reads. One formatter, so the CLI and the installer agree. */
export const formatDoctor = (report) => {
  const lines = [];
  const p = report.profile;
  lines.push(`profile : ${p ? `${p.name} ${p.version} (${p.resolvedBy}) at ${p.dir}` : 'none'}`);
  lines.push(`gate4   : ${report.gate4 ? report.gate4.path : 'MISSING'}`);
  lines.push(`gate5   : ${report.gate5 ? report.gate5.path : 'MISSING'}`);
  lines.push(`python  : ${report.python ?? `MISSING (${report.pythonProblem ?? 'not found'})`}`);
  lines.push(
    `scripts : ${
      report.smoke.status === 'ok'
        ? `ok (a known-bad draft exited ${report.smoke.exits.bad}, a known-good one ${report.smoke.exits.good})`
        : `${report.smoke.status}${report.smoke.reason ? ` (${report.smoke.reason})` : ''}`
    }`,
  );
  for (const skill of report.skills) {
    const extra = skill.status === 'ambiguous' ? ' (no root has exactly one copy)' : skill.clash?.length ? ` (also clashes under ${skill.clash.join(', ')})` : '';
    lines.push(`skill   : ${skill.skill.padEnd(24)} ${skill.status}${extra}`);
  }
  for (const stage of report.stages) lines.push(`stage ${stage.n} : ${stage.name.padEnd(34)} ${stage.status}`);
  lines.push(`mcp     : ${report.mcp.status}${report.mcp.detail ? ` (${report.mcp.detail})` : ''}`);
  lines.push(`rendered: ${report.rendered.length === 0 ? 'nowhere' : report.rendered.join(', ')}`);
  for (const warning of report.warnings) lines.push(`warning : ${warning}`);
  for (const problem of report.problems) lines.push(`problem : ${problem}`);
  lines.push(report.ok ? 'doctor: OK' : 'doctor: PROBLEMS');
  return `${lines.join('\n')}\n`;
};

const invokedDirectly = isEntryPoint(import.meta.url);
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  const report = await runDoctor({ store: flag('--store'), smoke: !argv.includes('--no-smoke') });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatDoctor(report));
  }
  process.exit(report.ok ? 0 : 1);
}
