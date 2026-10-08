import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateShims } from '../skills/writing-flow/scripts/shims.mjs';

const PORTABLE = '${PLUGIN_ROOT}';

const serverNames = () => Object.keys(JSON.parse(readFileSync('mcp.json', 'utf8')).mcpServers);
const find = (files, suffix) => files.find((f) => f.path.endsWith(suffix));

test('the Claude MCP config uses the Claude placeholder', async () => {
  const { files } = await generateShims({ pluginRoot: '.', outDir: 'shims' });
  const content = find(files, '.mcp.json').content;
  assert.match(content, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.ok(!content.includes(PORTABLE), 'Claude does not expand the portable placeholder');
});

test('both client configs declare exactly the servers in mcp.json', async () => {
  const { files } = await generateShims({ pluginRoot: '.', outDir: 'shims' });
  const claude = JSON.parse(find(files, '.mcp.json').content).mcpServers;
  const opencode = JSON.parse(find(files, 'mcp.opencode.json').content);
  assert.deepEqual(Object.keys(claude).sort(), serverNames().sort());
  assert.deepEqual(Object.keys(opencode).sort(), serverNames().sort());
});

test('the OpenCode fragment carries a token the installer substitutes', async () => {
  const { files } = await generateShims({ pluginRoot: '.', outDir: 'shims' });
  const content = find(files, 'mcp.opencode.json').content;
  assert.match(content, /__PLUGIN_ROOT__/);
  assert.ok(!content.includes(PORTABLE), 'OpenCode performs no placeholder expansion');
});

test('the OpenCode entry is a local server launched with node', async () => {
  const { files } = await generateShims({ pluginRoot: '.', outDir: 'shims' });
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
  assert.equal(existsSync(join(out, 'claude-code')), false);
});

test('a real run writes every shim under outDir', async () => {
  const out = mkdtempSync(join(tmpdir(), 'wf-'));
  await generateShims({ pluginRoot: '.', outDir: out, dryRun: false });
  assert.ok(existsSync(join(out, 'claude-code', '.mcp.json')));
  assert.ok(existsSync(join(out, 'claude-code', '.claude-plugin', 'plugin.json')));
  assert.ok(existsSync(join(out, 'opencode', 'mcp.opencode.json')));
});

test('the committed shims match what the generator produces', async () => {
  const { files } = await generateShims({ pluginRoot: '.', outDir: 'shims' });
  assert.ok(files.length >= 3);
  for (const file of files) {
    assert.ok(existsSync(file.path), `${file.path} is missing; run: node skills/writing-flow/scripts/shims.mjs --apply`);
    assert.equal(
      readFileSync(file.path, 'utf8'),
      file.content,
      `${file.path} is stale; run: node skills/writing-flow/scripts/shims.mjs --apply`,
    );
  }
});
