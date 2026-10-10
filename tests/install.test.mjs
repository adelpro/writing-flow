import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPENDENCIES, install, parseFlags } from '../bin/install.mjs';

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
  // The skills CLI is always invoked (it is what keeps the copies fresh); every file-level
  // action it is not responsible for must report `unchanged`.
  assert.ok(
    r.actions.filter((a) => a.kind !== 'ran').every((a) => a.kind === 'unchanged'),
    JSON.stringify(r.actions, null, 2),
  );
});

test('never issues a bare global skills update', async () => {
  const rec = recorder();
  // The machinery dependency performs a real `git clone` outside `runner`; leave it out so the
  // suite stays hermetic. Its planning is covered by its own test.
  const deps = DEPENDENCIES.filter((d) => !d.machinery);
  await install({ home: scratchHome(), dependencies: deps, runner: rec.runner });
  assert.ok(rec.calls.length > 0, 'the skill installs should have been attempted');
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

test('installs the packaged skills for every detected agent and never for claude-code', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.cursor'), { recursive: true });
  mkdirSync(join(home, '.kiro'), { recursive: true });
  const rec = recorder();
  await install({ home, dependencies: [], runner: rec.runner });

  const skillsCall = rec.calls.find((call) => call.includes('adelpro/writing-flow'));
  assert.ok(skillsCall, 'the packaged skills must be installed through the skills CLI');
  const args = skillsCall.slice(1);
  assert.ok(args.includes('-a') && args.includes('opencode'), 'the portable root is always selected');
  assert.ok(args.includes('cursor'), 'a detected agent is selected');
  assert.ok(args.includes('kiro-cli'), 'a detected agent is selected');
  assert.ok(!args.includes('codex'), 'an absent agent must not be selected');
  assert.ok(!args.includes('claude-code'), 'Claude Code receives the skills from the plugin');
  assert.ok(args.includes('writing-flow') && args.includes('voice-default'), 'both skills travel');
});

test('installs the dependencies for every detected agent, including claude-code', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.cursor'), { recursive: true });
  const rec = recorder();
  await install({ home, runner: rec.runner, dependencies: [DEPENDENCIES.find((d) => d.skill === 'fasaha')] });

  const depCall = rec.calls.find((call) => call.includes('adelpro/fasaha'));
  assert.ok(depCall, 'the dependencies must be installed');
  const args = depCall.slice(1);
  assert.ok(args.includes('claude-code'), 'Claude Code reads ~/.claude/skills, not ~/.agents/skills');
  assert.ok(args.includes('cursor'), 'a detected agent is selected');
  assert.ok(args.includes('opencode'), 'the portable root is always selected');
});

test('a dependency directory that exists but cannot run is warned about, not silently skipped', async () => {
  const home = scratchHome();
  // The observed failure: an umbrella repo cloned into the skill root, so the gate script sits a
  // level deeper and the gate resolves nothing.
  mkdirSync(join(home, '.agents', 'skills', 'avoid-ai-writing', 'skills', 'avoid-ai-writing', 'scripts'), { recursive: true });
  mkdirSync(join(home, '.agents', 'skills', 'remove-ai-marks', 'scripts'), { recursive: true });
  const deps = DEPENDENCIES.filter((d) => ['avoid-ai-writing', 'remove-ai-marks'].includes(d.skill));
  const r = await install({ home, dependencies: deps, runner: recorder().runner });

  assert.ok(
    r.warnings.some((w) => w.includes('avoid-ai-writing') && w.includes('check-style.js')),
    `expected a warning about the unusable dependency:\n${r.warnings.join('\n')}`,
  );
});

test('does not install generated skills into the hand-curated OpenCode skills directory', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.config', 'opencode', 'skills'), { recursive: true });
  await install({ home, dependencies: [], runner: recorder().runner });
  assert.equal(existsSync(join(home, '.config', 'opencode', 'skills', 'writing-flow')), false);
  assert.ok(existsSync(join(home, '.agents', 'skills', 'writing-flow', 'SKILL.md')), 'the real root still gets them');
});

test('plans the Python machinery for a dependency that ships it separately', async () => {
  const dep = DEPENDENCIES.find((d) => d.skill === 'remove-ai-marks');
  assert.ok(dep?.machinery, 'remove-ai-marks keeps its scripts outside the skill directory');

  const r = await install({ home: scratchHome(), dryRun: true, dependencies: [dep], runner: recorder().runner });
  assert.ok(
    r.actions.some((a) => a.detail.includes('service/scripts')),
    `the plan must fetch the machinery, else gate 5 has nothing to run:\n${r.actions.map((a) => a.detail).join('\n')}`,
  );
});

test('refuses a dependency identifier containing shell metacharacters', async () => {
  const rec = recorder();
  await install({
    home: scratchHome(),
    runner: rec.runner,
    dependencies: [{ skill: 'bad skill; rm -rf /', repo: 'a b/c' }],
  });
  assert.equal(rec.calls.length, 1, 'only the packaged-skill install may reach a shell');
  assert.ok(!rec.calls.some((call) => call.some((arg) => arg.includes('rm -rf'))));
});

// --- OpenCode: the package plugin, not an MCP entry -----------------------------------------

const opencodeHome = (home) => join(home, '.config', 'opencode');

test('registers the package plugin in an existing OpenCode config', async () => {
  const home = scratchHome();
  mkdirSync(opencodeHome(home), { recursive: true });
  await install({ home, dependencies: [], runner: recorder().runner });

  const config = JSON.parse(readFileSync(join(opencodeHome(home), 'opencode.json'), 'utf8'));
  assert.deepEqual(config.plugins, ['@adelpro/writing-flow']);
  assert.equal(config.mcp, undefined, 'the plugin registers the MCP server itself');
});

test('creates the plugins array when the config has none', async () => {
  const home = scratchHome();
  const dir = opencodeHome(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ mcp: { other: { type: 'local', command: ['true'] } } }));
  await install({ home, dependencies: [], runner: recorder().runner });

  const config = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.deepEqual(config.plugins, ['@adelpro/writing-flow']);
  assert.ok(config.mcp.other, 'unrelated configuration must survive');
});

test('merges into a JSONC config without destroying its comments', async () => {
  const home = scratchHome();
  const dir = opencodeHome(home);
  mkdirSync(dir, { recursive: true });
  const jsonc = '// Generated by something\n{\n  "$schema": "https://opencode.ai/config.json",\n  "plugins": [\n    "superpowers"\n  ],\n  "mcp": {\n    "other": { "type": "local", "command": ["true"] }\n  }\n}\n';
  writeFileSync(join(dir, 'opencode.jsonc'), jsonc);
  await install({ home, dependencies: [], runner: recorder().runner });

  const text = readFileSync(join(dir, 'opencode.jsonc'), 'utf8');
  assert.match(text, /Generated by something/, 'comments must survive');
  assert.match(text, /"superpowers"/, 'existing plugins must survive');
  assert.match(text, /"@adelpro\/writing-flow"/, 'the plugin must be added');
  assert.ok(!existsSync(join(dir, 'opencode.json')), 'the wrong config file must not be created');
});

test('the OpenCode entry is idempotent', async () => {
  const home = scratchHome();
  const dir = opencodeHome(home);
  mkdirSync(dir, { recursive: true });
  await install({ home, dependencies: [], runner: recorder().runner });
  const first = readFileSync(join(dir, 'opencode.json'), 'utf8');
  const r = await install({ home, dependencies: [], runner: recorder().runner });
  assert.equal(readFileSync(join(dir, 'opencode.json'), 'utf8'), first);
  assert.ok(r.actions.some((a) => a.detail === `unchanged ${join(dir, 'opencode.json')}`));
});

// --- Claude Code: the marketplace plugin, not a hand-assembled bundle ------------------------

const claudeSettings = (home) => join(home, '.claude', 'settings.json');

test('declares the marketplace and the plugin in the Claude settings', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.claude'), { recursive: true });
  await install({ home, dependencies: [], runner: recorder().runner });

  const settings = JSON.parse(readFileSync(claudeSettings(home), 'utf8'));
  assert.deepEqual(settings.extraKnownMarketplaces['writing-flow'], {
    source: { source: 'github', repo: 'adelpro/writing-flow' },
  });
  assert.equal(settings.enabledPlugins['writing-flow@writing-flow'], true);
});

test('preserves unrelated Claude settings keys when merging', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(claudeSettings(home), JSON.stringify({ enabledPlugins: { 'other@official': true }, effortLevel: 'high' }));
  await install({ home, dependencies: [], runner: recorder().runner });

  const settings = JSON.parse(readFileSync(claudeSettings(home), 'utf8'));
  assert.equal(settings.enabledPlugins['other@official'], true);
  assert.equal(settings.effortLevel, 'high');
  assert.equal(settings.enabledPlugins['writing-flow@writing-flow'], true);
});

test('copies nothing into ~/.claude: the plugin brings its own pieces', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.claude'), { recursive: true });
  await install({ home, dependencies: [], runner: recorder().runner });

  assert.equal(existsSync(join(home, '.claude', 'plugins')), false, 'no hand-assembled bundle');
  assert.equal(existsSync(join(home, '.claude', 'skills')), false, 'the plugin provides the skills');
  assert.equal(existsSync(join(home, '.claude', 'commands')), false, 'the plugin provides the commands');
});

test('leaves ~/.claude alone when it is absent', async () => {
  const home = scratchHome();
  const r = await install({ home, dependencies: [], runner: recorder().runner });
  assert.equal(existsSync(join(home, '.claude')), false);
  assert.ok(!r.actions.some((a) => a.target?.includes('.claude')));
});

test('a byte-order mark does not stop the Claude merge', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(claudeSettings(home), `\uFEFF${JSON.stringify({ effortLevel: 'high' })}`);
  const r = await install({ home, dependencies: [], runner: recorder().runner });

  const settings = JSON.parse(readFileSync(claudeSettings(home), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(settings.enabledPlugins['writing-flow@writing-flow'], true);
  assert.equal(settings.effortLevel, 'high');
  assert.equal(r.skipped.length, 0, `the merge must not be skipped: ${r.skipped.join(', ')}`);
});

// --- flags ----------------------------------------------------------------------------------

test('parseFlags splits --agents and reports unknown ids', () => {
  const o = parseFlags(['--agents=cursor,kiro-cli,nope', '--apply']);
  assert.deepEqual(o.agentIds, ['cursor', 'kiro-cli']);
  assert.deepEqual(o.invalid, ['nope']);
  assert.equal(o.apply, true);
});

test('parseFlags reads the profile flags', () => {
  assert.equal(parseFlags(['--no-profile']).profile, 'none');
  assert.equal(parseFlags(['--default-profile']).profile, 'default');
  assert.equal(parseFlags(['--generate-profile', 'notes.md']).profile, 'generate');
  assert.equal(parseFlags(['--generate-profile', 'notes.md']).profileSource, 'notes.md');
  assert.equal(parseFlags(['--profile', 'voices/adel']).profileDir, 'voices/adel');
});

test('--no-agents installs no skills through the CLI', async () => {
  const rec = recorder();
  const r = await install({ home: scratchHome(), noAgents: true, dependencies: [], runner: rec.runner });
  assert.equal(rec.calls.length, 0);
  assert.ok(r.skipped.some((s) => s.includes('no agent root selected')));
});

test('--skills-only writes no harness config and installs no dependencies', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const rec = recorder();
  const r = await install({ home, skillsOnly: true, runner: rec.runner });

  assert.ok(!existsSync(join(home, '.config', 'opencode', 'opencode.json')));
  assert.ok(!existsSync(join(home, '.claude', 'settings.json')));
  assert.ok(!rec.calls.some((c) => c.includes('adelpro/fasaha')));
  assert.ok(r.actions.every((a) => !a.target?.includes('.claude')));
});

test('--no-deps installs the skills but none of the four dependencies', async () => {
  const rec = recorder();
  await install({ home: scratchHome(), includeDeps: false, runner: rec.runner });
  assert.ok(rec.calls.some((c) => c.includes('adelpro/writing-flow')));
  assert.ok(!rec.calls.some((c) => c.includes('adelpro/fasaha')));
});

test('--all-agents includes every detected harness, claude-code among them', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.claude'), { recursive: true });
  const rec = recorder();
  await install({ home, allAgents: true, dependencies: [DEPENDENCIES[0]], runner: rec.runner });
  const call = rec.calls.find((c) => c.includes('adelpro/fasaha'));
  assert.ok(call.includes('claude-code'));
});

test('--agents scopes every surface, not only the skills', async () => {
  const home = scratchHome();
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  await install({ home, agentIds: ['cursor'], dependencies: [], runner: recorder().runner });

  assert.ok(!existsSync(join(home, '.config', 'opencode', 'opencode.json')), 'OpenCode was not named');
  assert.ok(!existsSync(join(home, '.claude', 'settings.json')), 'Claude was not named');
});

test('--offline reaches no network at all', async () => {
  const rec = recorder();
  const r = await install({ home: scratchHome(), offline: true, runner: rec.runner });
  assert.equal(rec.calls.length, 0);
  assert.ok(r.warnings.some((w) => w.includes('--offline')));
});

test('--prune removes what 0.9.1 left, including the stale MCP entry', async () => {
  const home = scratchHome();
  const dir = join(home, '.config', 'opencode');
  mkdirSync(join(dir, 'commands'), { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ mcp: { 'writing-flow': { type: 'local', command: ['node', 'x'] } } }));
  writeFileSync(join(dir, 'commands', 'flow-writing.md'), 'x');
  mkdirSync(join(home, '.claude', 'plugins', 'writing-flow'), { recursive: true });
  mkdirSync(join(home, '.claude', 'skills', 'writing-flow'), { recursive: true });

  await install({ home, prune: true, dependencies: [], runner: recorder().runner });

  assert.equal(existsSync(join(home, '.claude', 'plugins', 'writing-flow')), false);
  assert.equal(existsSync(join(home, '.claude', 'skills', 'writing-flow')), false);
  assert.equal(existsSync(join(dir, 'commands', 'flow-writing.md')), false);
  const config = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.ok(!config.mcp?.['writing-flow'], 'the merged MCP entry is gone');
});

test('--uninstall removes the plugin entry, the Claude keys and the packaged skills', async () => {
  const home = scratchHome();
  const dir = join(home, '.config', 'opencode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ plugins: ['@adelpro/writing-flow', 'other'] }));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'settings.json'),
    JSON.stringify({
      extraKnownMarketplaces: { 'writing-flow': { source: { source: 'github', repo: 'adelpro/writing-flow' } } },
      enabledPlugins: { 'writing-flow@writing-flow': true, 'other@official': true },
    }),
  );
  mkdirSync(join(home, '.agents', 'skills', 'writing-flow'), { recursive: true });

  await install({ home, uninstall: true, dependencies: [], runner: recorder().runner });

  const config = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
  assert.deepEqual(config.plugins, ['other']);
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.enabledPlugins['writing-flow@writing-flow'], undefined);
  assert.equal(settings.enabledPlugins['other@official'], true, 'unrelated plugins survive');
  assert.equal(settings.extraKnownMarketplaces['writing-flow'], undefined);
  assert.equal(existsSync(join(home, '.agents', 'skills', 'writing-flow')), false);
});

test('a profile kept in the store is rendered into the harness roots', async () => {
  const home = scratchHome();
  const store = join(home, '.agents', 'writing-flow', 'profiles', 'adel');
  mkdirSync(store, { recursive: true });
  writeFileSync(
    join(store, 'writing-profile.json'),
    JSON.stringify({ kind: 'voice', name: 'adel', version: '1.0.0', languages: ['en'], houseStyle: './house-style.json', requiredSkills: [] }),
  );
  writeFileSync(join(store, 'SKILL.md'), '---\nname: adel\ndescription: test voice\n---\n\n- Quiet and factual.\n');
  writeFileSync(join(store, 'house-style.json'), '{}\n');

  const r = await install({ home, dependencies: [], runner: recorder().runner });

  assert.ok(existsSync(join(home, '.agents', 'skills', 'adel', 'SKILL.md')), 'the store profile reaches the root');
  assert.ok(r.actions.some((a) => a.detail.includes('profile: store')), 'and is reported as coming from the store');
});

test('with no personal profile, the default applies and the fix is named', async () => {
  const r = await install({ home: scratchHome(), dependencies: [], runner: recorder().runner });
  assert.ok(r.warnings.some((w) => w.includes('voice-default') && w.includes('generate.mjs')));
});

test('--generate-profile previews in a dry run and writes nothing', async () => {
  const home = scratchHome();
  const src = join(home, 'notes.md');
  writeFileSync(src, '# Voice\n\n- Quiet and factual.\n- Short sentences, no jargon.\n');

  const r = await install({ home, dependencies: [], profile: 'generate', profileSource: src, runner: recorder().runner, dryRun: true });

  assert.ok(r.actions.some((a) => a.detail.includes('would generate')));
  assert.equal(existsSync(join(home, '.agents', 'writing-flow', 'profiles')), false);
});

test('--generate-profile refuses to write without confirmation', async () => {
  const home = scratchHome();
  const src = join(home, 'notes.md');
  writeFileSync(src, '# Voice\n\n- Quiet and factual.\n');

  const r = await install({ home, dependencies: [], profile: 'generate', profileSource: src, runner: recorder().runner, dryRun: false });

  assert.ok(r.actions.some((a) => a.detail.includes('without confirmation')));
});

test('--generate-profile writes and renders when confirmed', async () => {
  const home = scratchHome();
  const src = join(home, 'notes.md');
  writeFileSync(src, '# Voice\n\n- Quiet and factual.\n- Short sentences, no jargon.\n');

  await install({ home, dependencies: [], profile: 'generate', profileSource: src, runner: recorder().runner, dryRun: false, yes: true });

  const store = join(home, '.agents', 'writing-flow', 'profiles', 'notes');
  assert.ok(existsSync(join(store, 'writing-profile.json')), 'the profile lands in the store');
  assert.ok(existsSync(join(home, '.agents', 'skills', 'notes', 'SKILL.md')), 'and is rendered into the root');
});
