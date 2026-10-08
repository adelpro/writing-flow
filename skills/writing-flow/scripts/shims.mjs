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
 * Generating them removes the drift that a "keep two configs in sync" check would only detect.
 */
export async function generateShims({ pluginRoot = '.', outDir = 'shims', dryRun = true } = {}) {
  const root = resolve(pluginRoot);
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

  const target = resolve(outDir);
  const files = [
    {
      path: join(target, 'claude-code', '.claude-plugin', 'plugin.json'),
      content: `${asString(claudeManifest)}\n`,
    },
    {
      path: join(target, 'claude-code', '.mcp.json'),
      content: `${asString({ mcpServers: claudeServers })}\n`,
    },
    {
      path: join(target, 'opencode', 'mcp.opencode.json'),
      content: `${asString(opencodeServers)}\n`,
    },
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
  const outDir = resolve(dirname(process.argv[1]), '..', '..', '..', 'shims');
  const report = await generateShims({ pluginRoot: resolve(dirname(process.argv[1]), '..', '..', '..'), outDir, dryRun: !apply });
  for (const file of report.files) process.stdout.write(`${apply ? 'wrote' : 'would write'} ${file.path}\n`);
}
