import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../install.mjs';

const scratchHome = () => mkdtempSync(join(tmpdir(), 'wf-home '));

const recorder = () => {
  const calls = [];
  return {
    calls,
    runner: (exe, args) => {
      calls.push([exe, ...args]);
      return { status: 0, stdout: '', stderr: '' };
    },
  };
};

test('a dry run reports what it would do and writes nothing', async () => {
  const home = scratchHome();
  const r = await install({ home, dryRun: true });
  assert.equal(r.ok, true);
  assert.ok(r.actions.length > 0);
  assert.ok(r.actions.every((a) => a.detail.startsWith('would ')), JSON.stringify(r.actions, null, 2));
  assert.equal(existsSync(join(home, '.agents')), false, 'a dry run must create nothing');
});

test('a real run installs the package skills into the harness root', async () => {
  const home = scratchHome();
  await install({ home, dependencies: [], runner: recorder().runner });
  assert.ok(existsSync(join(home, '.agents', 'skills', 'writing-flow', 'SKILL.md')));
  assert.ok(existsSync(join(home, '.agents', 'skills', 'voice-default', 'writing-profile.json')));
});

test('records the resolved tool paths for later runs', async () => {
  const home = scratchHome();
  await install({ home, dependencies: [], runner: recorder().runner });
  assert.ok(existsSync(join(home, '.agents', 'skills', 'writing-flow', 'scripts', 'paths.json')));
});

test('is idempotent', async () => {
  const home = scratchHome();
  await install({ home, dependencies: [], runner: recorder().runner });
  const r = await install({ home, dependencies: [], runner: recorder().runner });
  assert.ok(r.actions.length > 0);
  assert.ok(r.actions.every((a) => a.kind === 'unchanged'), JSON.stringify(r.actions, null, 2));
});

test('never issues a bare global skills update', async () => {
  const rec = recorder();
  await install({ home: scratchHome(), dependencies: undefined, runner: rec.runner });
  assert.ok(rec.calls.length > 0, 'the dependency installs should have been attempted');
  for (const call of rec.calls) {
    const args = call.slice(1);
    assert.notDeepEqual(args, ['-g'], 'a bare -g update rewrites every agent directory');
    assert.ok(!args.includes('update'), `global update is forbidden: ${args.join(' ')}`);
    if (args.includes('-g')) {
      assert.ok(args.includes('-a'), `a -g install must name an agent: ${args.join(' ')}`);
      assert.ok(args.includes('-s'), `a -g install must name one skill: ${args.join(' ')}`);
    }
  }
});

test('refuses a dependency identifier containing shell metacharacters', async () => {
  const rec = recorder();
  await install({
    home: scratchHome(),
    runner: rec.runner,
    dependencies: [{ skill: 'bad skill; rm -rf /', repo: 'a b/c' }],
  });
  assert.equal(rec.calls.length, 0, 'nothing may be handed to a shell');
});

test('wires the MCP server and the command into an existing OpenCode config', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  await install({ home, dependencies: [], runner: recorder().runner });

  assert.ok(existsSync(join(home, '.config', 'opencode', 'commands', 'write.md')), 'the /write command must be installed');

  const config = JSON.parse(readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.ok(config.mcp['writing-flow'], 'the MCP server must be registered');
  assert.equal(config.mcp['writing-flow'].type, 'local');
  assert.ok(!JSON.stringify(config).includes('__PLUGIN_ROOT__'), 'the plugin root must be substituted');
  assert.ok(config.mcp['writing-flow'].command[1].endsWith('mcp-server.mjs'));
});

test('preserves unrelated OpenCode MCP servers when merging', async () => {
  const home = scratchHome();
  const dir = join(home, '.config', 'opencode');
  mkdirSync(dir, { recursive: true });
  await import('node:fs').then(({ writeFileSync }) =>
    writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ mcp: { other: { type: 'local', command: ['true'] } } })),
  );
  await install({ home, dependencies: [], runner: recorder().runner });
  const config = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.ok(config.mcp.other, 'an existing server must survive the merge');
  assert.ok(config.mcp['writing-flow']);
});
