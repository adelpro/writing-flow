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
  const opencodeHome = join(home, '.config', 'opencode');
  if (existsSync(opencodeHome)) roots.push(join(opencodeHome, 'skills'));
  if (existsSync(join(home, '.claude'))) roots.push(join(home, '.claude', 'skills'));
  return roots;
};

const copySkill = (srcDir, destRoot, dryRun, actions) => {
  for (const { abs, rel } of walk(srcDir, srcDir)) {
    const dest = join(destRoot, rel);
    const content = readFileSync(abs);
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
  }
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
