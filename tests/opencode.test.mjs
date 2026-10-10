import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import plugin from '../opencode/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fakeContext = () => {
  const skills = [];
  const servers = {};
  const commands = [];
  const prompts = [];
  const ctx = {
    skill: {
      transform: async (fn) =>
        fn({ add: (s) => skills.push(s), get: (id) => skills.find((s) => s.id === id) }),
    },
    mcp: { transform: async (fn) => fn({ set: (name, config) => (servers[name] = config) }) },
    command: { transform: async (fn) => fn({ add: (c) => commands.push(c) }) },
    session: { prompt: async (input) => prompts.push(input) },
  };
  return { ctx, skills, servers, commands, prompts };
};

test('the plugin registers both skills, the MCP server and both commands', async () => {
  const { ctx, skills, servers, commands } = fakeContext();
  await plugin.setup(ctx);

  assert.equal(plugin.id, 'writing-flow');
  assert.deepEqual(skills.map((s) => s.id), ['writing-flow', 'voice-default']);
  for (const skill of skills) {
    assert.ok(skill.name && skill.description, `${skill.id} has frontmatter`);
    assert.ok(existsSync(skill.path), `${skill.path} exists`);
    assert.ok(skill.content.length > 0);
  }

  assert.deepEqual(Object.keys(servers), ['writing-flow']);
  assert.equal(servers['writing-flow'].type, 'local');
  assert.deepEqual(servers['writing-flow'].command, ['node', join(ROOT, 'skills', 'writing-flow', 'scripts', 'mcp-server.mjs')]);

  assert.deepEqual(commands.map((c) => c.name), ['flow-writing', 'flow-doctor']);
  assert.ok(commands.every((c) => c.description));
});

test('a skill OpenCode already discovered is not registered twice', async () => {
  const { ctx, skills } = fakeContext();
  skills.push({
    id: 'writing-flow',
    name: 'discovered',
    description: 'already installed in ~/.agents/skills',
    path: 'x/SKILL.md',
    content: 'x',
  });
  await plugin.setup(ctx);

  assert.deepEqual(skills.map((s) => s.id), ['writing-flow', 'voice-default']);
  assert.equal(skills[0].name, 'discovered', 'the discovered entry is left untouched');
});

test('a command substitutes its arguments and the skill directory before prompting', async () => {
  const { ctx, commands, prompts } = fakeContext();
  await plugin.setup(ctx);

  const writing = commands.find((c) => c.name === 'flow-writing');
  await writing.execute({
    sessionID: 'ses_test',
    prompt: { text: 'a post about remote work', files: [] },
    delivery: 'steer',
  });

  assert.equal(prompts.length, 1);
  const [sent] = prompts;
  assert.equal(sent.sessionID, 'ses_test');
  assert.equal(sent.delivery, 'steer');
  assert.ok(sent.text.includes('a post about remote work'));
  assert.ok(!sent.text.includes('$ARGUMENTS'));
  assert.ok(!sent.text.includes('<writing-flow skill base directory>'));
  // The command text is a shell snippet, so the bound skill directory keeps whichever
  // separator the platform produced; compare with one separator on both sides.
  const normalise = (value) => value.split('\\').join('/');
  assert.ok(
    normalise(sent.text).includes(normalise(join(ROOT, 'skills', 'writing-flow', 'scripts', 'gate.mjs'))),
  );
});
