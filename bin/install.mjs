#!/usr/bin/env node
/**
 * writing-flow installer.
 *
 * All logic lives here so the .ps1 and .sh files stay three-line shims. Idempotent: a second run
 * reports `unchanged` and writes nothing. A dry run is the default; only `--apply` (or a
 * confirmed interactive run) writes.
 *
 * Each harness is wired through its own native mechanism, never by hand-copying what the harness
 * can fetch itself:
 *
 *   Claude Code  - the marketplace plugin: two keys merged into ~/.claude/settings.json.
 *   OpenCode     - the package plugin: one entry in the `plugins` array of opencode.json(c).
 *   Other agents - the two skills, installed by the skills CLI into each detected agent.
 *
 * `claude-code` is deliberately absent from the SKILL agent list: Claude Code receives both skills
 * from the marketplace plugin, and a second, un-namespaced copy in ~/.claude/skills is the trigger
 * duplication this package avoids. It is present in the DEPENDENCY list, because no plugin ships
 * the four dependencies.
 *
 * The skills CLI keeps `~/.agents/skills` as its canonical store and copies outward, so it always
 * writes that root from the repository's default branch. The two packaged skills are therefore
 * copied there a second time, from this package, so the root the engine resolves against
 * (paths.json, doctor, the gate entry points) is byte-exact for the installed version.
 *
 * Dependency policy, inherited from WRITING-FLOW.md: targeted `add <repo> -s <skill>` only.
 * Never a bare `-g` update, which re-materialises real directories across every agent dir and
 * restores files that were deliberately pruned.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveToolPaths } from '../skills/writing-flow/scripts/resolve-paths.mjs';
import { readManifest } from '../skills/writing-flow/scripts/profile.mjs';
import { renderProfile } from '../skills/writing-flow/scripts/render.mjs';
import { generateProfile } from '../skills/writing-flow/scripts/generate.mjs';
import { runDoctor } from '../skills/writing-flow/scripts/doctor.mjs';

/** Dependency identifiers must never contain shell metacharacters or spaces. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9@/._-]+$/;

// The installer lives in bin/, so the package root is one level up.
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEPENDENCIES = [
  { skill: 'fasaha', repo: 'adelpro/fasaha' },
  { skill: 'purple-cow-content', repo: 'adelpro/purple-cow-content' },
  { skill: 'avoid-ai-writing', repo: 'conorbronsdon/avoid-ai-writing' },
  {
    skill: 'remove-ai-marks',
    repo: 'guillaumemeyer/watermarks-remover',
    // This repository keeps the skill and its Python machinery in separate trees:
    // `skills/remove-ai-marks/` holds SKILL.md and references, and every script lives under
    // `service/scripts`. Installing only the skill leaves gate 5 with nothing to execute, so
    // the installer fetches the machinery too.
    machinery: 'service/scripts',
  },
];

/** The skills this package ships, installed into every harness root. */
export const PACKAGED_SKILLS = ['writing-flow', 'voice-default'];

/** The repository the skills CLI installs from, and the plugin both package systems load. */
export const PACKAGE_SLUG = 'adelpro/writing-flow';
export const PACKAGE_PLUGIN = '@adelpro/writing-flow';

/**
 * Where a personal voice lives when it is not installed into a harness. A profile is a skill
 * directory, so the store is just one more root to search.
 */
export const DEFAULT_STORE = ['.agents', 'writing-flow', 'profiles'];

/**
 * Harnesses that take the two skills as files, with the directory that proves the harness is
 * present. `always: true` roots are installed regardless, because the portable root is this
 * package's own and always wanted. `claude-code` is intentionally missing - see the header.
 */
export const SKILL_AGENTS = [
  { id: 'opencode', dir: ['.agents'], always: true },
  { id: 'antigravity', dir: ['.antigravity'] },
  { id: 'codex', dir: ['.codex'] },
  { id: 'cursor', dir: ['.cursor'] },
  { id: 'github-copilot', dir: ['.copilot'] },
  { id: 'gemini-cli', dir: ['.gemini'] },
  { id: 'kiro-cli', dir: ['.kiro'] },
  { id: 'windsurf', dir: ['.codeium', 'windsurf'] },
];

/** Harnesses that receive the four dependency skills. See the header for why Claude is here. */
export const DEPENDENCY_AGENTS = [{ id: 'claude-code', dir: ['.claude'] }, ...SKILL_AGENTS];

/** Agent ids the skills CLI accepts, captured from its own error message. */
export const VALID_AGENTS = [
  'opencode', 'claude-code', 'antigravity', 'antigravity-cli', 'codex', 'cursor', 'github-copilot',
  'gemini-cli', 'kiro-cli', 'windsurf', 'zed', 'aider-desk', 'amp', 'cline', 'continue', 'crush',
  'goose', 'kilo', 'openhands', 'roo', 'trae', 'warp', 'qwen-code', 'kimi-code-cli', 'junie',
];

/** The script each gate depends on, for the "installed but unusable" check. */
const REQUIRED_SCRIPTS = {
  'avoid-ai-writing': join('scripts', 'check-style.js'),
  'remove-ai-marks': join('scripts', 'inspect_text.py'),
};

const detectedAgents = (home, table) =>
  table.filter((a) => a.always || existsSync(join(home, ...a.dir))).map((a) => a.id);

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const defaultRunner = (exe, args) =>
  spawnSync(exe, args, { stdio: 'inherit', shell: process.platform === 'win32' });

const walk = (dir, base) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else if (entry.isFile()) out.push({ abs, rel: relative(base, abs) });
  }
  return out;
};

const copyFile = (src, dest, dryRun, actions) => {
  const content = readFileSync(src);
  const kind = !existsSync(dest) ? 'create' : sha256(readFileSync(dest)) === sha256(content) ? 'unchanged' : 'update';
  actions.push({
    kind,
    target: dest,
    detail: kind === 'unchanged' ? `unchanged ${dest}` : `${dryRun ? 'would write' : 'wrote'} ${dest}`,
  });
  if (!dryRun && kind !== 'unchanged') {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
};

const copySkill = (srcDir, destRoot, dryRun, actions) => {
  for (const { abs, rel } of walk(srcDir, srcDir)) copyFile(abs, join(destRoot, rel), dryRun, actions);
};

const writeFileTracked = (target, content, dryRun, actions) => {
  const kind = !existsSync(target) ? 'create' : readFileSync(target, 'utf8') === content ? 'unchanged' : 'update';
  actions.push({
    kind,
    target,
    detail: kind === 'unchanged' ? `unchanged ${target}` : `${dryRun ? 'would write' : 'wrote'} ${target}`,
  });
  if (!dryRun && kind !== 'unchanged') {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
};

const removePath = (target, dryRun, actions) => {
  const kind = existsSync(target) ? 'removed' : 'absent';
  actions.push({
    kind,
    target,
    detail: kind === 'absent' ? `absent ${target}` : `${dryRun ? 'would remove' : 'removed'} ${target}`,
  });
  if (!dryRun && kind === 'removed') rmSync(target, { recursive: true, force: true });
};

/** OpenCode merges its config files; the JSONC one is usually the real one. Try plain JSON first. */
const OPENCODE_CONFIGS = ['opencode.json', 'opencode.jsonc'];

const findOpencodeConfig = (home) => {
  for (const name of OPENCODE_CONFIGS) {
    const candidate = join(home, name);
    if (existsSync(candidate)) return candidate;
  }
  return join(home, OPENCODE_CONFIGS[0]);
};

const escapeKey = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readConfig = (path) => {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : `${JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)}\n`;
  let parsed = null;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    parsed = null;
  }
  return { text, parsed };
};

/**
 * Merge one entry into an OpenCode config's top-level `plugins` array.
 *
 * A JSONC config cannot be round-tripped through JSON.parse without destroying its comments, so
 * the entry is inserted textually when the file does not parse as JSON. The array is created
 * when the config has no `plugins` key yet.
 */
const mergePluginEntry = (text, entry) => {
  if (new RegExp(`"${escapeKey(entry)}"`).test(text)) return { text, changed: false };

  let parsed = null;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    parsed = null;
  }
  if (parsed) {
    parsed.plugins = [...(parsed.plugins ?? []), entry];
    return { text: `${JSON.stringify(parsed, null, 2)}\n`, changed: true };
  }

  const open = /"plugins"\s*:\s*\[/.exec(text);
  if (open) {
    const at = open.index + open[0].length;
    const empty = /^\s*\]/.test(text.slice(at));
    const insertion = empty ? `\n    ${JSON.stringify(entry)}\n  ` : `\n    ${JSON.stringify(entry)},`;
    return { text: `${text.slice(0, at)}${insertion}${text.slice(at)}`, changed: true };
  }

  const root = /\{/.exec(text);
  if (!root) throw new Error('opencode config is not an object');
  const at = root.index + root[0].length;
  return { text: `${text.slice(0, at)}\n  "plugins": [${JSON.stringify(entry)}],${text.slice(at)}`, changed: true };
};

const removePluginEntry = (text, entry) => {
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { text, changed: false, manual: true };
  }
  const next = (parsed.plugins ?? []).filter((p) => p !== entry);
  if (next.length === (parsed.plugins ?? []).length) return { text, changed: false };
  parsed.plugins = next;
  return { text: `${JSON.stringify(parsed, null, 2)}\n`, changed: true };
};

const removeMcpEntry = (text, name) => {
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { text, changed: false, manual: true };
  }
  if (!parsed.mcp || !(name in parsed.mcp)) return { text, changed: false };
  delete parsed.mcp[name];
  return { text: `${JSON.stringify(parsed, null, 2)}\n`, changed: true };
};

const githubSlug = (repository) => {
  const match = /github\.com[/:]([^/]+)\/([^/.#]+)/.exec(repository ?? '');
  return match ? `${match[1]}/${match[2]}` : null;
};

/**
 * Merge the Claude Code marketplace registration into settings.json.
 *
 * Claude Code fetches and installs the plugin itself from these two keys. Nothing is copied into
 * ~/.claude: the plugin brings its own skills, commands and MCP server.
 */
const mergeClaudeSettings = (text, { name, repo }) => {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  const marketplace = parsed.extraKnownMarketplaces?.[name];
  const enabled = parsed.enabledPlugins?.[`${name}@${name}`];
  if (marketplace && enabled === true) return { text, changed: false };

  parsed.extraKnownMarketplaces = { ...(parsed.extraKnownMarketplaces ?? {}), [name]: { source: { source: 'github', repo } } };
  parsed.enabledPlugins = { ...(parsed.enabledPlugins ?? {}), [`${name}@${name}`]: true };
  return { text: `${JSON.stringify(parsed, null, 2)}\n`, changed: true };
};

const removeClaudeKeys = (text, name) => {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  let changed = false;
  if (parsed.extraKnownMarketplaces?.[name]) {
    delete parsed.extraKnownMarketplaces[name];
    changed = true;
  }
  if (parsed.enabledPlugins?.[`${name}@${name}`]) {
    delete parsed.enabledPlugins[`${name}@${name}`];
    changed = true;
  }
  return { text: changed ? `${JSON.stringify(parsed, null, 2)}\n` : text, changed };
};

/**
 * Fetch a dependency's Python machinery, which some repositories keep out of the skill
 * directory. `skills add` copies instructions only, so without this gate 5 has no script to run
 * and exits 2 forever on an otherwise healthy install.
 */
const installMachinery = (dep, primary) => {
  const temp = mkdtempSync(join(tmpdir(), 'writing-flow-'));
  try {
    const cloned = spawnSync('git', ['clone', '--depth', '1', `https://github.com/${dep.repo}`, temp], { stdio: 'inherit' });
    if (cloned.status !== 0) throw new Error(`git clone failed for ${dep.repo}`);

    const from = join(temp, ...dep.machinery.split('/'));
    if (!existsSync(from)) throw new Error(`machinery path not found in ${dep.repo}: ${dep.machinery}`);

    const to = join(primary, dep.skill, 'scripts');
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name));
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
};

/** Every profile directory under a store root. */
const storeProfiles = (storeRoot) => {
  if (!existsSync(storeRoot)) return [];
  return readdirSync(storeRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(storeRoot, e.name, 'writing-profile.json')))
    .map((e) => join(storeRoot, e.name));
};

/** A profile already installed into a harness root, excluding the packaged default. */
const installedProfiles = (home) => {
  const roots = [join(home, '.agents', 'skills'), join(home, '.claude', 'skills'), join(home, '.config', 'opencode', 'skills')];
  return roots
    .filter((root) => existsSync(root))
    .flatMap((root) =>
      readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'writing-profile.json')))
        .map((e) => ({ dir: join(root, e.name), root })),
    )
    .filter(({ dir }) => {
      try {
        return readManifest(dir).isDefault !== true;
      } catch {
        return false;
      }
    });
};

/**
 * Decide the voice, in the order a person would: an explicit choice, then a personal profile kept
 * in the store, then one already installed, then the packaged default. Generating a profile is
 * never automatic - it is offered only when nothing was found.
 */
const planProfile = async ({ home, options, actions, warnings, skipped, dryRun }) => {
  const storeRoot = options.store ? resolve(options.store) : join(home, ...DEFAULT_STORE);
  const targets = [join(home, '.agents', 'skills'), ...(existsSync(join(home, '.claude', 'skills')) ? [join(home, '.claude', 'skills')] : [])];

  const use = async (profileDir, resolvedBy) => {
    actions.push({ kind: 'unchanged', target: profileDir, detail: `profile: ${resolvedBy} at ${profileDir}` });
    for (const root of targets) {
      const r = await renderProfile({ profileDir, targetRoot: root, mode: 'copy', dryRun, force: true });
      for (const w of r.writes) {
        actions.push({
          kind: w.action,
          target: w.path,
          detail: w.action === 'unchanged' ? `unchanged ${w.path}` : `${dryRun ? 'would render' : 'rendered'} ${w.path}`,
        });
      }
    }
  };

  if (options.profile === 'none') {
    warnings.push('no profile requested (--no-profile): the pipeline will have no register until you install a voice');
    return;
  }

  if (options.profile === 'explicit') {
    const dir = resolve(options.profileDir);
    if (!existsSync(join(dir, 'writing-profile.json'))) {
      skipped.push(`${dir} has no writing-profile.json`);
      return;
    }
    await use(dir, 'explicit');
    return;
  }

  if (options.profile === 'generate') {
    const name = basename(options.profileSource).replace(/\.[^.]+$/, '') || 'profile';
    const out = join(storeRoot, name);
    const preview = await generateProfile({ source: options.profileSource, name, outDir: out, dryRun: true });
    for (const line of preview.excluded ?? []) warnings.push(`generate drops: ${line}`);

    const confirm = options.yes === true || options.confirmed === true;
    if (dryRun || !confirm) {
      actions.push({
        kind: 'create',
        target: out,
        detail: dryRun
          ? `would generate ${out} from ${options.profileSource}`
          : `cannot generate ${out} without confirmation — re-run with --yes once the dropped lines above look right`,
      });
      return;
    }
    await generateProfile({ source: options.profileSource, name, outDir: out, dryRun: false, confirm: true });
    actions.push({ kind: 'create', target: out, detail: `generated ${out} from ${options.profileSource}` });
    await use(out, 'generated');
    return;
  }

  const stored = storeProfiles(storeRoot);
  if (stored.length === 1) {
    await use(stored[0], 'store');
    return;
  }
  if (stored.length > 1) {
    warnings.push(`more than one profile in the store (${stored.join(', ')}) — pass --profile=<dir> to choose`);
  }

  const installed = installedProfiles(home);
  if (stored.length === 0 && installed.length > 0) {
    actions.push({ kind: 'unchanged', target: installed[0].dir, detail: `profile: installed at ${installed[0].dir}` });
    return;
  }

  if (options.profile === 'default') {
    actions.push({ kind: 'unchanged', target: storeRoot, detail: 'profile: the bundled voice-default applies' });
    return;
  }

  warnings.push(
    `no personal profile found (searched ${storeRoot} and the harness roots); the bundled voice-default applies — create one with: ` +
      `node ${join(PLUGIN_ROOT, 'skills', 'writing-flow', 'scripts', 'generate.mjs')} <source> --name <name> --out ${storeRoot} --apply`,
  );
};

/** What 0.9.1 left behind. Nothing here is created by 0.10.0. */
const staleArtifacts = (home, name) => [
  join(home, '.claude', 'plugins', name),
  join(home, '.claude', 'skills', 'writing-flow'),
  join(home, '.claude', 'skills', 'voice-default'),
  join(home, '.config', 'opencode', 'commands', 'flow-writing.md'),
  join(home, '.config', 'opencode', 'commands', 'flow-doctor.md'),
];

const prune = ({ home, name, dryRun, actions, warnings }) => {
  for (const path of staleArtifacts(home, name)) removePath(path, dryRun, actions);

  const configPath = findOpencodeConfig(join(home, '.config', 'opencode'));
  if (existsSync(configPath)) {
    const { text } = readConfig(configPath);
    const { text: next, changed, manual } = removeMcpEntry(text, 'writing-flow');
    if (manual) warnings.push(`${configPath} could not be parsed, so the stale mcp."writing-flow" entry must be removed by hand`);
    else if (changed) writeFileTracked(configPath, next, dryRun, actions);
  }
};

const uninstall = ({ home, pluginRoot, name, dryRun, actions, warnings }) => {
  prune({ home, name, dryRun, actions, warnings });

  const configPath = findOpencodeConfig(join(home, '.config', 'opencode'));
  if (existsSync(configPath)) {
    const { text } = readConfig(configPath);
    const { text: next, changed, manual } = removePluginEntry(text, PACKAGE_PLUGIN);
    if (manual) warnings.push(`${configPath} could not be parsed, so remove "${PACKAGE_PLUGIN}" from plugins by hand`);
    else if (changed) writeFileTracked(configPath, next, dryRun, actions);
  }

  const settingsPath = join(home, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    const { text: next, changed } = removeClaudeKeys(readFileSync(settingsPath, 'utf8'), name);
    if (changed) writeFileTracked(settingsPath, next, dryRun, actions);
  }

  for (const skill of PACKAGED_SKILLS) removePath(join(home, '.agents', 'skills', skill), dryRun, actions);
  warnings.push('the four dependency skills were left in place: they are third-party and may be used by other skills');
};

/** Flags, parsed by hand so the package keeps zero runtime dependencies. */
export function parseFlags(argv) {
  const has = (name) => argv.includes(name);
  const value = (name) => {
    const inline = argv.find((a) => a.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1] ?? null;
  };

  const options = {
    apply: has('--apply'),
    yes: has('--yes'),
    json: has('--json'),
    check: has('--check'),
    offline: has('--offline'),
    pythonCheck: !has('--no-python-check'),
    keep: has('--keep'),
    prune: has('--prune'),
    uninstall: has('--uninstall'),
    skillsOnly: has('--skills-only'),
    includeDeps: !has('--no-deps'),
    noAgents: has('--no-agents'),
    noClaude: has('--no-claude'),
    noOpencode: has('--no-opencode'),
    allAgents: has('--all-agents'),
    agentIds: null,
    profile: null,
    profileDir: null,
    profileSource: null,
    store: value('--store'),
    invalid: [],
  };

  const agents = value('--agents');
  if (agents !== null && agents !== undefined) {
    options.agentIds = agents.split(',').map((a) => a.trim()).filter(Boolean);
    const unknown = options.agentIds.filter((id) => !VALID_AGENTS.includes(id));
    if (unknown.length > 0) {
      options.invalid = unknown;
      options.agentIds = options.agentIds.filter((id) => VALID_AGENTS.includes(id));
    }
  }

  if (has('--no-profile')) options.profile = 'none';
  else if (value('--profile') !== null) {
    options.profile = 'explicit';
    options.profileDir = value('--profile');
  } else if (value('--generate-profile') !== null) {
    options.profile = 'generate';
    options.profileSource = value('--generate-profile');
  } else if (has('--default-profile')) options.profile = 'default';

  return options;
}

export async function install({
  home,
  pluginRoot = PLUGIN_ROOT,
  dryRun = false,
  runner = defaultRunner,
  dependencies = null,
  deps = null,
  agents = null,
  agentIds = null,
  allAgents = false,
  noAgents = false,
  includeDeps = true,
  skillsOnly = false,
  offline = false,
  pythonCheck = true,
  noClaude = false,
  noOpencode = false,
  prune: doPrune = false,
  uninstall: doUninstall = false,
  profile = null,
  profileDir = null,
  profileSource = null,
  store = null,
  yes = false,
  confirmed = false,
} = {}) {
  if (!home) throw new Error('install: a home directory is required');
  const actions = [];
  const skipped = [];
  const warnings = [];
  const primary = join(home, '.agents', 'skills');
  const name = JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8')).name;

  const depList = skillsOnly
    ? []
    : dependencies !== null
      ? dependencies
      : includeDeps && deps !== false
        ? DEPENDENCIES
        : [];
  const table = agents ?? SKILL_AGENTS;

  let selected;
  if (noAgents) selected = [];
  else if (agentIds) selected = agentIds;
  else if (allAgents) selected = detectedAgents(home, DEPENDENCY_AGENTS);
  else selected = detectedAgents(home, table);
  const depAgents = agentIds ? agentIds : detectedAgents(home, DEPENDENCY_AGENTS);

  if (doUninstall) {
    uninstall({ home, pluginRoot, name, dryRun, actions, warnings });
    return { ok: true, home: resolve(home), actions, skipped, warnings };
  }
  if (doPrune) prune({ home, name, dryRun, actions, warnings });

  // 1. Skills, per detected agent, through the skills CLI. `opencode` is always selected: its
  //    root is the skills CLI's canonical store, which the engine resolves against.
  if (selected.length > 0 && !offline) {
    const args = ['-y', 'skills@latest', 'add', PACKAGE_SLUG, '-g', ...selected.flatMap((id) => ['-a', id]), '-s', PACKAGED_SKILLS[0], '-s', PACKAGED_SKILLS[1], '-y', '--copy'];
    actions.push({
      kind: dryRun ? 'create' : 'ran',
      target: primary,
      detail: dryRun ? `would run: npx ${args.join(' ')}` : `ran: npx ${args.join(' ')}`,
    });
    if (!dryRun) runner('npx', args);
  } else if (selected.length === 0) {
    skipped.push('no agent root selected for the packaged skills');
  } else {
    warnings.push('--offline: the skills CLI was skipped; only the copies in this package are used');
  }

  // 2. Keep the portable root byte-exact for the installed version.
  if (!skillsOnly) {
    for (const skill of PACKAGED_SKILLS) copySkill(join(pluginRoot, 'skills', skill), join(primary, skill), dryRun, actions);
  }

  // 3. Dependencies.
  const tools = await resolveToolPaths({ cwd: pluginRoot, pluginRoot });
  if (pythonCheck && !tools.python) {
    warnings.push(
      `${tools.pythonProblem ?? 'python not found on PATH'} — gate 5 (provenance) will report exit 2 until Python 3 is available; the gate can skip it with --skip-marks`,
    );
  }
  const record = {
    node: tools.node,
    python: tools.python,
    ...(tools.pythonProblem ? { pythonProblem: tools.pythonProblem } : {}),
    gate4: tools.gate4,
    gate5: tools.gate5,
    missing: tools.missing,
  };
  writeFileTracked(join(primary, 'writing-flow', 'scripts', 'paths.json'), `${JSON.stringify(record, null, 2)}\n`, dryRun, actions);

  for (const dep of depList) {
    if (!SAFE_IDENTIFIER.test(dep.skill) || !SAFE_IDENTIFIER.test(dep.repo)) {
      skipped.push(`${dep.skill} (identifier contains characters unsafe to pass to a shell)`);
      continue;
    }
    if (existsSync(join(primary, dep.skill))) {
      skipped.push(dep.skill);
      const script = REQUIRED_SCRIPTS[dep.skill];
      if (script && !existsSync(join(primary, dep.skill, script))) {
        warnings.push(
          `${dep.skill} exists at ${join(primary, dep.skill)} but ${join(primary, dep.skill, script)} is missing — the installer never rewrites an existing dependency, so the gate resolves nothing for it; delete that directory and re-run`,
        );
      }
      continue;
    }
    if (offline) {
      skipped.push(`${dep.skill} (--offline)`);
      continue;
    }
    const args = ['-y', 'skills@latest', 'add', dep.repo, '-g', ...depAgents.flatMap((id) => ['-a', id]), '-s', dep.skill, '-y', '--copy'];
    actions.push({
      kind: dryRun ? 'create' : 'ran',
      target: join(primary, dep.skill),
      detail: dryRun ? `would run: npx ${args.join(' ')}` : `ran: npx ${args.join(' ')}`,
    });
    if (!dryRun) runner('npx', args);

    if (dep.machinery) {
      const target = join(primary, dep.skill, 'scripts');
      actions.push({
        kind: dryRun ? 'create' : 'wrote',
        target,
        detail: dryRun ? `would copy ${dep.repo}/${dep.machinery} into ${target}` : `copied ${dep.repo}/${dep.machinery} into ${target}`,
      });
      if (!dryRun) installMachinery(dep, primary);
    }
  }

  if (skillsOnly) return { ok: true, home: resolve(home), actions, skipped, warnings };

  // 4. OpenCode: register the package plugin. The plugin itself registers the skills, the MCP
  //    server and the /flow-* commands, so nothing is copied and no MCP entry is merged. Naming
  //    an explicit agent list scopes every surface, not just the skills.
  const wantsOpencode = !noOpencode && (agentIds ? agentIds.includes('opencode') : true);
  const opencodeHome = join(home, '.config', 'opencode');
  if (wantsOpencode && existsSync(opencodeHome)) {
    const configPath = findOpencodeConfig(opencodeHome);
    const { text } = readConfig(configPath);
    try {
      const { text: next, changed } = mergePluginEntry(text, PACKAGE_PLUGIN);
      if (changed) writeFileTracked(configPath, next, dryRun, actions);
      else actions.push({ kind: 'unchanged', target: configPath, detail: `unchanged ${configPath}` });
    } catch (error) {
      skipped.push(`${configPath} (${error.message})`);
    }
  }

  // 5. Claude Code: declare the marketplace and the plugin; Claude does the fetching.
  const wantsClaude = !noClaude && (agentIds ? agentIds.includes('claude-code') : true);
  const claudeHome = join(home, '.claude');
  if (wantsClaude && existsSync(claudeHome)) {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8'));
    const repo = githubSlug(manifest.repository);
    const settingsPath = join(claudeHome, 'settings.json');
    if (!repo) {
      skipped.push('plugin.json has no GitHub repository to point the marketplace at');
    } else {
      const existing = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '{}\n';
      try {
        const { text, changed } = mergeClaudeSettings(existing, { name: manifest.name, repo });
        if (changed) writeFileTracked(settingsPath, text, dryRun, actions);
        else actions.push({ kind: 'unchanged', target: settingsPath, detail: `unchanged ${settingsPath}` });
      } catch (error) {
        skipped.push(`${settingsPath} (${error.message})`);
      }
    }
  }

  // 6. The voice.
  try {
    await planProfile({ home, options: { profile, profileDir, profileSource, store, yes, confirmed }, actions, warnings, skipped, dryRun });
  } catch (error) {
    warnings.push(`the voice step failed and was skipped: ${error.message}`);
  }

  return { ok: true, home: resolve(home), actions, skipped, warnings };
}

/** Ask the choices, then show the plan and take one confirmation. */
async function wizard(home, options) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const detected = detectedAgents(home, DEPENDENCY_AGENTS);
    const answer = await rl.question(
      `Harnesses detected: ${detected.join(', ') || 'none'}\n` +
        `Wire which? [a]ll detected / [n]one / a comma list (default: a) `,
    );
    const pick = answer.trim().toLowerCase();
    if (pick === 'n' || pick === 'none') options.noAgents = true;
    else if (pick && pick !== 'a' && pick !== 'all') options.agentIds = pick.split(',').map((s) => s.trim()).filter(Boolean);

    const scope = await rl.question('Scope? [f]ull install / [s]kills only (default: f) ');
    options.skillsOnly = scope.trim().toLowerCase().startsWith('s');

    const leftovers = staleArtifacts(home, 'writing-flow').filter((p) => existsSync(p));
    if (leftovers.length > 0) {
      const keep = await rl.question(`Found ${leftovers.length} item(s) left by 0.9.1. [k]eep / [p]rune (default: k) `);
      options.prune = keep.trim().toLowerCase().startsWith('p');
    }

    const want = await rl.question('Voice? [s]tore or installed / [d]efault / [g]enerate from a file / [n]one (default: s) ');
    const choice = want.trim().toLowerCase();
    if (choice.startsWith('d')) options.profile = 'default';
    else if (choice.startsWith('n')) options.profile = 'none';
    else if (choice.startsWith('g')) {
      const source = await rl.question('Path to writing to distil (a markdown file or a directory): ');
      options.profile = 'generate';
      options.profileSource = source.trim();
    }

    const go = await rl.question('\nApply these changes? [y/N] ');
    options.confirmed = go.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
  return options;
}

export const HELP = `writing-flow installer

Usage: npx -y ${PACKAGE_SLUG} [options]

Writes nothing unless --apply is given, or an interactive run is confirmed.

Harnesses
  --agents=<a,b>            wire only these harnesses: the skills, and the config for
                            opencode / claude-code when they are named
  --all-agents              wire every detected harness
  --no-agents               install no skills for other agents
  --no-claude               do not touch ~/.claude
  --no-opencode             do not touch ~/.config/opencode

Scope
  --skills-only             only the two skills; no dependencies, no config, no voice
  --no-deps                 the skills, but not the four dependencies
  --offline                 never reach the network; use the copies in this package
  --no-python-check         do not warn about a missing Python

Existing installs
  --prune                   remove what 0.9.1 left (bundle, skill copies, commands, stale MCP entry)
  --uninstall               also remove the plugin entry, the Claude keys and the packaged skills
  --keep                    leave existing artefacts alone (default)

Voice
  --profile=<dir>           use this profile
  --default-profile         use the bundled voice-default
  --generate-profile=<file> distil a profile from writing you already have
  --no-profile              install no voice
  --store=<dir>             profile store (default ~/.agents/writing-flow/profiles)

Output
  --json                    machine-readable plan
  --check                   report the setup and exit, writing nothing
  --yes                     accept the defaults, never prompt
  --apply                   write
  -h, --help                this text

Agent ids the skills CLI accepts include: ${VALID_AGENTS.join(', ')}
`;

const invokedDirectly = process.argv[1] && basename(resolve(process.argv[1])) === 'install.mjs';
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const options = parseFlags(argv);
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const interactive = !options.yes && !options.json && !options.check && process.stdin.isTTY === true;

  if (options.invalid.length > 0) {
    process.stdout.write(`unknown agent id(s): ${options.invalid.join(', ')}\nknown: ${VALID_AGENTS.join(', ')}\n`);
    process.exit(2);
  }

  if (options.check) {
    const report = await runDoctor({});
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      for (const problem of report.problems) process.stdout.write(`problem : ${problem}\n`);
      for (const warning of report.warnings) process.stdout.write(`warning : ${warning}\n`);
      process.stdout.write(report.ok ? 'doctor: OK\n' : 'doctor: PROBLEMS\n');
    }
    process.exit(report.ok ? 0 : 1);
  }

  if (interactive) await wizard(home, options);

  const dryRun = !options.apply && options.confirmed !== true;
  const report = await install({ home, dryRun, ...options });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ dryRun, ...report }, null, 2)}\n`);
  } else {
    for (const action of report.actions) process.stdout.write(`  ${action.kind.padEnd(9)} ${action.detail}\n`);
    for (const skip of report.skipped) process.stdout.write(`  skipped   ${skip}\n`);
    for (const warning of report.warnings) process.stdout.write(`  warning   ${warning}\n`);
    const changed = report.actions.filter((a) => a.kind !== 'unchanged' && a.kind !== 'absent').length;
    process.stdout.write(
      dryRun
        ? `install: dry run, ${changed} change(s) planned. Re-run with --apply to make them.\n`
        : `install: applied, ${changed} change(s).\n`,
    );
  }
  process.exit(0);
}
