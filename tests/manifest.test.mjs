import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const ALLOWED = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
const NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

test('plugin.json declares the 1.0.0 schema and no unknown top-level keys', () => {
  const m = read('plugin.json');
  assert.equal(m.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.deepEqual(Object.keys(m).filter((k) => !ALLOWED.includes(k)), []);
});

test('plugin.json declares its required fields', () => {
  const m = read('plugin.json');
  for (const key of ['$schema', 'name']) {
    assert.ok(key in m, `missing required field: ${key}`);
  }
});

test('the plugin name satisfies the manifest constraints', () => {
  const { name } = read('plugin.json');
  assert.ok(name.length >= 1 && name.length <= 64, 'name must be 1-64 characters');
  assert.match(name, NAME_PATTERN);
});

test('author, when present, uses only name, email and url', () => {
  const { author } = read('plugin.json');
  if (author) {
    assert.deepEqual(Object.keys(author).filter((k) => !['name', 'email', 'url'].includes(k)), []);
  }
});

test('package.json and plugin.json agree on the version', () => {
  assert.equal(read('package.json').version, read('plugin.json').version);
});

test('the npm files allowlist ships everything the installer reads at runtime', () => {
  const normalised = read('package.json').files.map((f) => f.replace(/\/$/, ''));
  for (const needed of ['plugin.json', 'mcp.json', 'bin', 'commands', 'opencode', 'skills']) {
    assert.ok(normalised.includes(needed), `package.json "files" must include ${needed}`);
  }
});

const MCP_ALLOWED = ['$schema', 'mcpServers'];
const CWD_PATTERN = /^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/;

test('mcp.json declares the 1.0.0 schema and only the permitted top-level keys', () => {
  const m = read('mcp.json');
  assert.equal(m.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(Object.keys(m).filter((k) => !MCP_ALLOWED.includes(k)), []);
  assert.equal(typeof m.mcpServers, 'object');
});

test('every MCP server entry is a valid stdio, streamable-http or sse variant', () => {
  const { mcpServers } = read('mcp.json');
  const entries = Object.entries(mcpServers);
  assert.ok(entries.length >= 1);
  for (const [name, server] of entries) {
    assert.ok(['stdio', 'streamable-http', 'sse'].includes(server.type), `${name}: bad type`);
    if (server.type === 'stdio') {
      assert.ok(typeof server.command === 'string' && server.command.length >= 1, `${name}: command`);
      assert.equal(server.command.split(/\s+/).length, 1, `${name}: command must be a single token`);
      if (server.args) assert.ok(server.args.every((a) => typeof a === 'string'), `${name}: args`);
      if (server.cwd) assert.match(server.cwd, CWD_PATTERN, `${name}: cwd must be plugin-rooted`);
      if (server.env) {
        for (const reserved of ['PLUGIN_ROOT', 'PLUGIN_DATA']) {
          assert.ok(!(reserved in server.env), `${name}: env must not define ${reserved}`);
        }
      }
    } else {
      assert.ok(typeof server.url === 'string' && server.url.length >= 1, `${name}: url`);
    }
  }
});

test('the package ships no secrets in its MCP configuration', () => {
  const { mcpServers } = read('mcp.json');
  for (const [name, server] of Object.entries(mcpServers)) {
    assert.equal(server.env, undefined, `${name}: env is visible package data`);
    assert.equal(server.headers, undefined, `${name}: headers are visible package data`);
  }
});
