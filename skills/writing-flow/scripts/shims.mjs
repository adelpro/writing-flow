import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PORTABLE = '${PLUGIN_ROOT}';
const CLAUDE_PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
const OPENCODE_TOKEN = '__PLUGIN_ROOT__';

const rewrite = (value, from, to) => {
  if (typeof value === 'string') return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((item) => rewrite(item, from, to));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, from, to)]));
  }
  return value;
};

const asString = (value) => JSON.stringify(value, null, 2);

const claudeEntry = (config) => {
  const entry = { command: rewrite(config.command, PORTABLE, CLAUDE_PLACEHOLDER) };
  if (config.args) entry.args = rewrite(config.args, PORTABLE, CLAUDE_PLACEHOLDER);
  if (config.cwd) entry.cwd = rewrite(config.cwd, PORTABLE, CLAUDE_PLACEHOLDER);
  return entry;
};

/**
 * OpenCode reads `command` as an argv array and performs no placeholder expansion, so the
 * fragment carries a token the installer replaces with the real plugin root.
 */
const opencodeEntry = (config) => ({
  type: 'local',
  command: [rewrite(config.command, PORTABLE, OPENCODE_TOKEN), ...(config.args ?? []).map((a) => rewrite(a, PORTABLE, OPENCODE_TOKEN))],
  enabled: true,
});

/**
 * Generate every client shim from the single portable `mcp.json`.
 *
 * The Claude Code files are written to the plugin ROOT, not into a bundle to copy: Claude Code
 * looks for `.claude-plugin/plugin.json` at the plugin root, so a root-level pair makes the
 * repository a Claude plugin directly. Conformant Agent Plugins clients ignore extra top-level
 * directories, and `.mcp.json` is not the fixed `mcp.json` path they read — so this costs
 * nothing on the portable side.
 *
 * Cursor needs no file: Cursor reads the Agent Plugins `plugin.json` it already finds, and
 * `.cursor-plugin/marketplace.json` is for multi-plugin repositories.
 */
export async function generateShims({ pluginRoot = '.', outDir = null, dryRun = true } = {}) {
  const root = resolve(pluginRoot);
  const target = outDir ? resolve(outDir) : root;
  const portable = JSON.parse(readFileSync(join(root, 'mcp.json'), 'utf8')).mcpServers;
  const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));

  const claudeServers = Object.fromEntries(
    Object.entries(portable).map(([name, config]) => [name, claudeEntry(config)]),
  );
  const opencodeServers = Object.fromEntries(
    Object.entries(portable).map(([name, config]) => [name, opencodeEntry(config)]),
  );

  const claudeManifest = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    license: manifest.license,
  };

  // A marketplace entry's `source` is relative to the marketplace root and must not contain
  // "..", and the entry name must equal the plugin's manifest name.
  //
  // The entry points at the repository rather than at "./" because a github source is the
  // documented form for a plugin that is its own repository; a relative source resolving to the
  // marketplace root itself is permitted by the rules but appears in none of the examples.
  const slug = /github\.com[/:]([^/]+)\/([^/.#]+)/.exec(manifest.repository ?? '');
  const marketplace = {
    name: manifest.name,
    description: manifest.description,
    owner: manifest.author ?? { name: manifest.name },
    plugins: [
      {
        name: manifest.name,
        source: slug ? { source: 'github', repo: `${slug[1]}/${slug[2]}` } : './',
        description: manifest.description,
      },
    ],
  };

  const files = [
    { path: join(target, '.claude-plugin', 'plugin.json'), content: `${asString(claudeManifest)}\n` },
    { path: join(target, '.claude-plugin', 'marketplace.json'), content: `${asString(marketplace)}\n` },
    { path: join(target, '.mcp.json'), content: `${asString({ mcpServers: claudeServers })}\n` },
    { path: join(target, 'shims', 'opencode', 'mcp.opencode.json'), content: `${asString(opencodeServers)}\n` },
  ];

  if (!dryRun) {
    for (const file of files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content, 'utf8');
    }
  }

  return { files, dryRun, outDir: target };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]).endsWith('shims.mjs');
if (invokedDirectly) {
  const apply = process.argv.includes('--apply');
  const pluginRoot = resolve(dirname(process.argv[1]), '..', '..', '..');
  const report = await generateShims({ pluginRoot, dryRun: !apply });
  for (const file of report.files) process.stdout.write(`${apply ? 'wrote' : 'would write'} ${file.path}\n`);
}
