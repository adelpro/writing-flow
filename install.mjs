#!/usr/bin/env node
/**
 * writing-flow installer.
 *
 * All logic lives here so the .ps1 and .sh files stay three-line shims. Idempotent: a second
 * run reports `unchanged` and writes nothing.
 *
 * Dependency policy, inherited from WRITING-FLOW.md: targeted `add <repo> -s <skill>` only.
 * Never a bare `-g` update, which re-materialises real directories across every agent dir and
 * restores files that were deliberately pruned.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveToolPaths } from './skills/writing-flow/scripts/resolve-paths.mjs';
import { generateShims } from './skills/writing-flow/scripts/shims.mjs';

const OPENCODE_TOKEN = '__PLUGIN_ROOT__';
/** Dependency identifiers must never contain shell metacharacters or spaces. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9@/._-]+$/;

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));

export const DEPENDENCIES = [
  { skill: 'fasaha', repo: 'adelpro/fasaha' },
  { skill: 'purple-cow-content', repo: 'adelpro/purple-cow-content' },
  { skill: 'avoid-ai-writing', repo: 'conorbronsdon/avoid-ai-writing' },
  { skill: 'remove-ai-marks', repo: 'guillaumemeyer/watermarks-remover' },
];

/** The skills this package ships, installed into every harness root. */
export const PACKAGED_SKILLS = ['writing-flow', 'voice-default'];

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

/** Harness skill roots present under a home directory. The first is always created. */
const harnessRoots = (home) => {
  const roots = [join(home, '.agents', 'skills')];
  if (existsSync(join(home, '.claude'))) roots.push(join(home, '.claude', 'skills'));
  return roots;
};

const copyFile = (src, dest, dryRun, actions) => {
  const content = readFileSync(src);
  const kind = !existsSync(dest)
    ? 'create'
    : sha256(readFileSync(dest)) === sha256(content)
      ? 'unchanged'
      : 'update';
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

/** Native slash commands. Not every harness reads them — see the README. */
const commandFiles = (pluginRoot) => {
  const dir = join(pluginRoot, 'commands');
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
    : [];
};

const copyCommands = (pluginRoot, targetDir, dryRun, actions) => {
  for (const name of commandFiles(pluginRoot)) {
    copyFile(join(pluginRoot, 'commands', name), join(targetDir, name), dryRun, actions);
  }
};

const copySkill = (srcDir, destRoot, dryRun, actions) => {
  for (const { abs, rel } of walk(srcDir, srcDir)) copyFile(abs, join(destRoot, rel), dryRun, actions);
};

const writeFileTracked = (target, content, dryRun, actions) => {
  const kind = !existsSync(target)
    ? 'create'
    : readFileSync(target, 'utf8') === content
      ? 'unchanged'
      : 'update';
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

/** OpenCode merges its config files; the JSONC one is usually the real one. Try plain JSON first. */
const CONFIG_CANDIDATES = ['opencode.json', 'opencode.jsonc'];

const findConfig = (home) => {
  for (const name of CONFIG_CANDIDATES) {
    const candidate = join(home, name);
    if (existsSync(candidate)) return candidate;
  }
  return join(home, CONFIG_CANDIDATES[0]);
};

const escapeKey = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alreadyPresent = (text, name) => new RegExp(`"${escapeKey(name)}"\\s*:`).test(text);

/**
 * Merge MCP servers into an OpenCode config without disturbing anything else.
 *
 * A JSONC config cannot be round-tripped through JSON.parse without destroying its comments,
 * so the entry is inserted textually after the `mcp` object's opening brace.
 */
const mergeConfigText = (text, fragment) => {
  const names = Object.keys(fragment);
  if (names.every((name) => alreadyPresent(text, name))) return { text, changed: false };

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (parsed) {
    parsed.mcp = { ...(parsed.mcp ?? {}), ...fragment };
    return { text: `${JSON.stringify(parsed, null, 2)}\n`, changed: true };
  }

  const opening = /"mcp"\s*:\s*\{/.exec(text);
  if (!opening) throw new Error('opencode config has no "mcp" object to merge into');
  const at = opening.index + opening[0].length;
  const pending = names.filter((name) => !alreadyPresent(text, name));
  const entries = pending.map((name) => `${JSON.stringify(name)}: ${JSON.stringify(fragment[name])}`);
  const empty = /^\s*\}/.test(text.slice(at));
  const insertion = empty ? `\n    ${entries.join(',\n    ')}\n  ` : `\n    ${entries.join(',\n    ')},`;
  return { text: `${text.slice(0, at)}${insertion}${text.slice(at)}`, changed: true };
};

export async function install({
  home,
  pluginRoot = PLUGIN_ROOT,
  dryRun = false,
  runner = defaultRunner,
  dependencies = DEPENDENCIES,
  targets = null,
} = {}) {
  if (!home) throw new Error('install: a home directory is required');
  const actions = [];
  const skipped = [];
  const roots = targets ?? harnessRoots(home);

  for (const root of roots) {
    for (const skill of PACKAGED_SKILLS) {
      copySkill(join(pluginRoot, 'skills', skill), join(root, skill), dryRun, actions);
    }
  }

  const primary = roots[0];
  const tools = await resolveToolPaths({ cwd: pluginRoot, pluginRoot });
  const record = {
    node: tools.node,
    python: tools.python,
    gate4: tools.gate4,
    gate5: tools.gate5,
    missing: tools.missing,
  };
  writeFileTracked(
    join(primary, 'writing-flow', 'scripts', 'paths.json'),
    `${JSON.stringify(record, null, 2)}\n`,
    dryRun,
    actions,
  );

  for (const dep of dependencies ?? []) {
    if (!SAFE_IDENTIFIER.test(dep.skill) || !SAFE_IDENTIFIER.test(dep.repo)) {
      skipped.push(`${dep.skill} (identifier contains characters unsafe to pass to a shell)`);
      continue;
    }
    if (existsSync(join(primary, dep.skill))) {
      skipped.push(dep.skill);
      continue;
    }
    const args = ['-y', 'skills@latest', 'add', dep.repo, '-g', '-a', 'opencode', '-s', dep.skill, '-y', '--copy'];
    const command = `npx ${args.join(' ')}`;
    actions.push({
      kind: dryRun ? 'create' : 'wrote',
      target: join(primary, dep.skill),
      detail: dryRun ? `would run: ${command}` : `ran: ${command}`,
    });
    if (!dryRun) runner('npx', args);
  }

  // The client shims are generated from the single portable mcp.json, then wired in here.
  // Without this step the package installs its skills but never reaches a harness's MCP.
  const pluginRootPosix = resolve(pluginRoot).split('\\').join('/');

  const opencodeHome = join(home, '.config', 'opencode');
  if (existsSync(opencodeHome)) {
    copyCommands(pluginRoot, join(opencodeHome, 'commands'), dryRun, actions);

    const { files } = await generateShims({ pluginRoot, outDir: join(pluginRoot, 'shims'), dryRun: true });
    const fragmentFile = files.find((f) => f.path.endsWith('mcp.opencode.json'));
    const fragment = JSON.parse(fragmentFile.content.split(OPENCODE_TOKEN).join(pluginRootPosix));

    const configPath = findConfig(opencodeHome);
    const existing = existsSync(configPath)
      ? readFileSync(configPath, 'utf8')
      : `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: {} }, null, 2)}\n`;
    const { text, changed } = mergeConfigText(existing, fragment);
    if (changed) writeFileTracked(configPath, text, dryRun, actions);
    else actions.push({ kind: 'unchanged', target: configPath, detail: `unchanged ${configPath}` });
  }

  const claudeHome = join(home, '.claude');
  if (existsSync(claudeHome)) {
    // Assembled from the root-level Claude files. No skills are copied here on purpose: the
    // skills already live in ~/.claude/skills, and a plugin copy would namespace and duplicate
    // them, which is the trigger duplication this package avoids everywhere else.
    const bundle = join(claudeHome, 'plugins', 'writing-flow');
    copyFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), join(bundle, '.claude-plugin', 'plugin.json'), dryRun, actions);
    copyFile(join(pluginRoot, '.mcp.json'), join(bundle, '.mcp.json'), dryRun, actions);
    copyCommands(pluginRoot, join(bundle, 'commands'), dryRun, actions);
  }
  return { ok: true, home: resolve(home), roots, actions, skipped };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]).endsWith('install.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const dryRun = !argv.includes('--apply');
  const report = await install({ home: process.env.HOME ?? process.env.USERPROFILE, dryRun });
  for (const action of report.actions) process.stdout.write(`  ${action.kind.padEnd(9)} ${action.detail}\n`);
  const changed = report.actions.filter((a) => a.kind !== 'unchanged').length;
  process.stdout.write(
    dryRun
      ? `install: dry run, ${changed} change(s) planned. Re-run with --apply to make them.\n`
      : `install: applied, ${changed} change(s).\n`,
  );
  process.exit(0);
}
