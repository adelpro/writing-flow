import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateShims } from '../skills/writing-flow/scripts/shims.mjs';

const PORTABLE = '${PLUGIN_ROOT}';

const serverNames = () => Object.keys(JSON.parse(readFileSync('mcp.json', 'utf8')).mcpServers);
const find = (files, suffix) => files.find((f) => f.path.endsWith(suffix));
const preview = (outDir = 'shims-preview') => generateShims({ pluginRoot: '.', outDir, dryRun: true });

test('the Claude MCP config uses the Claude placeholder', async () => {
  const { files } = await preview();
  const content = find(files, '.mcp.json').content;
  assert.match(content, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.ok(!content.includes(PORTABLE), 'Claude does not expand the portable placeholder');
});

test('both client configs declare exactly the servers in mcp.json', async () => {
  const { files } = await preview();
  const claude = JSON.parse(find(files, '.mcp.json').content).mcpServers;
  const opencode = JSON.parse(find(files, 'mcp.opencode.json').content);
  assert.deepEqual(Object.keys(claude).sort(), serverNames().sort());
  assert.deepEqual(Object.keys(opencode).sort(), serverNames().sort());
});

test('the Claude files land at the plugin root, not in a bundle to copy', async () => {
  const { files } = await preview();
  const paths = files.map((f) => f.path);
  assert.ok(paths.some((p) => p.endsWith(join('.claude-plugin', 'plugin.json'))), 'plugin manifest at root');
  assert.ok(paths.some((p) => p.endsWith('.mcp.json')), 'MCP config at root');
  assert.ok(!paths.some((p) => p.includes('claude-code')), 'no copyable bundle directory remains');
});

test('marketplace.json is well formed and points at the repository', async () => {
  const { files } = await preview();
  const marketplace = JSON.parse(find(files, 'marketplace.json').content);
  const manifest = JSON.parse(readFileSync('plugin.json', 'utf8'));

  assert.equal(typeof marketplace.name, 'string');
  assert.equal(typeof marketplace.owner, 'object');
  assert.ok(Array.isArray(marketplace.plugins));
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, manifest.name, 'the entry name must equal the plugin manifest name');

  const source = marketplace.plugins[0].source;
  const asText = typeof source === 'string' ? source : JSON.stringify(source);
  assert.ok(!asText.includes('..'), 'a marketplace source must not contain ".."');

  // Derived from the manifest's repository, because a relative "./" root is permitted but
  // undocumented — every published example nests the plugin in a subdirectory.
  assert.deepEqual(source, { source: 'github', repo: 'adelpro/writing-flow' });
});

test('no Cursor manifest is generated', async () => {
  const { files } = await preview();
  assert.ok(
    !files.some((f) => f.path.includes('.cursor-plugin')),
    'Cursor reads the Agent Plugins manifest already; a marketplace file is for multi-plugin repos',
  );
});

test('the Gemini extension manifest matches the plugin and points at the server', async () => {
  const { files } = await preview();
  const gemini = JSON.parse(find(files, 'gemini-extension.json').content);
  const manifest = JSON.parse(readFileSync('plugin.json', 'utf8'));

  assert.equal(gemini.name, manifest.name);
  assert.equal(gemini.version, manifest.version);
  assert.equal(gemini.contextFileName, 'GEMINI.md');

  const server = gemini.mcpServers[manifest.name];
  assert.equal(server.command, 'node', 'Gemini wants the executable and its args separated');
  assert.match(server.args[0], /^\$\{extensionPath\}\//, 'Gemini expands ${extensionPath} itself');
  assert.ok(server.args[0].endsWith('mcp-server.mjs'));
  assert.ok(!JSON.stringify(gemini).includes(PORTABLE), 'no placeholder of ours may survive');
});

test('the Gemini manifest does not exclude shell execution', async () => {
  const { files } = await preview();
  const gemini = JSON.parse(find(files, 'gemini-extension.json').content);
  const excluded = gemini.excludeTools ?? [];
  assert.ok(
    !excluded.some((tool) => tool.startsWith('run_shell_command')),
    'the gate is a shell command; excluding it would leave nothing able to run it',
  );
});

test('the Gemini commands are TOML, with a prompt, and hold no placeholders', () => {
  const names = readdirSync('commands');
  for (const name of ['flow-writing.toml', 'flow-doctor.toml']) {
    assert.ok(names.includes(name), `${name} is missing`);
    const text = readFileSync(join('commands', name), 'utf8');
    assert.match(text, /^prompt\s*=\s*"""/m, `${name} needs a prompt`);
    assert.match(text, /^description\s*=\s*"/m, `${name} needs a description for /help`);
    assert.ok(
      !text.includes('${extensionPath}'),
      `${name}: variables expand in the manifest and hooks, not in commands`,
    );
  }
});

test('the OpenCode fragment carries a token the installer substitutes', async () => {
  const { files } = await preview();
  const content = find(files, 'mcp.opencode.json').content;
  assert.match(content, /__PLUGIN_ROOT__/);
  assert.ok(!content.includes(PORTABLE), 'OpenCode performs no placeholder expansion');
});

test('the OpenCode entry is a local server launched with node', async () => {
  const { files } = await preview();
  const opencode = JSON.parse(find(files, 'mcp.opencode.json').content);
  for (const config of Object.values(opencode)) {
    assert.equal(config.type, 'local');
    assert.equal(config.command[0], 'node');
    assert.ok(config.command[1].endsWith('mcp-server.mjs'));
  }
});

test('generation is deterministic and a dry run writes nothing', async () => {
  const out = mkdtempSync(join(tmpdir(), 'wf-'));
  const first = await generateShims({ pluginRoot: '.', outDir: out });
  const second = await generateShims({ pluginRoot: '.', outDir: out });
  assert.deepEqual(
    first.files.map((f) => f.content),
    second.files.map((f) => f.content),
  );
  assert.equal(existsSync(join(out, '.claude-plugin')), false);
});

test('a real run writes every shim under outDir', async () => {
  const out = mkdtempSync(join(tmpdir(), 'wf-'));
  await generateShims({ pluginRoot: '.', outDir: out, dryRun: false });
  assert.ok(existsSync(join(out, '.claude-plugin', 'plugin.json')));
  assert.ok(existsSync(join(out, '.claude-plugin', 'marketplace.json')));
  assert.ok(existsSync(join(out, '.mcp.json')));
  assert.ok(existsSync(join(out, 'shims', 'opencode', 'mcp.opencode.json')));
});

test('the committed shims match what the generator produces', async () => {
  const { files } = await generateShims({ pluginRoot: '.', outDir: '.' });
  assert.ok(files.length >= 4);
  for (const file of files) {
    assert.ok(existsSync(file.path), `${file.path} is missing; run: node skills/writing-flow/scripts/shims.mjs --apply`);
    assert.equal(
      readFileSync(file.path, 'utf8'),
      file.content,
      `${file.path} is stale; run: node skills/writing-flow/scripts/shims.mjs --apply`,
    );
  }
});
