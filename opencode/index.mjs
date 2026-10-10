import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['writing-flow', 'voice-default'];
const COMMANDS = ['flow-writing', 'flow-doctor'];

const skillDir = (name) => join(ROOT, 'skills', name);

const field = (block, key) => {
  const line = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return line ? line[1].trim().replace(/^["']|["']$/g, '') : undefined;
};

const readSkill = (name) => {
  const path = join(skillDir(name), 'SKILL.md');
  const content = readFileSync(path, 'utf8');
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  return { id: name, name: field(block, 'name') ?? name, description: field(block, 'description'), path, content };
};

const readCommand = (name) => {
  const text = readFileSync(join(ROOT, 'commands', `${name}.md`), 'utf8');
  const [, block = '', body = ''] = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/) ?? [];
  return { name, description: field(block, 'description'), body: body.trim() };
};

const bindSkillDir = (text) =>
  text.split('<writing-flow skill base directory>').join(skillDir('writing-flow')).split('~/.agents/skills/writing-flow').join(skillDir('writing-flow'));

export default {
  id: 'writing-flow',
  async setup(ctx) {
    const skills = SKILLS.map(readSkill);
    const commands = COMMANDS.map(readCommand);
    const server = join(skillDir('writing-flow'), 'scripts', 'mcp-server.mjs');

    // OpenCode discovers ~/.agents/skills on its own, so a skill the installer already placed
    // there would otherwise be registered a second time. Add only what is not present yet.
    await ctx.skill.transform((editor) => {
      for (const skill of skills) if (!editor.get(skill.id)) editor.add(skill);
    });

    await ctx.mcp.transform((editor) => {
      editor.set('writing-flow', { type: 'local', command: ['node', server] });
    });

    await ctx.command.transform((editor) => {
      for (const command of commands) {
        editor.add({
          name: command.name,
          description: command.description,
          execute: async ({ sessionID, prompt, delivery }) => {
            const text = bindSkillDir(command.body).split('$ARGUMENTS').join(prompt.text);
            await ctx.session.prompt({ ...prompt, sessionID, text, delivery });
          },
        });
      }
    });
  },
};
