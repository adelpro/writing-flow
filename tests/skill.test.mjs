import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = readFileSync('skills/writing-flow/SKILL.md', 'utf8').replace(/\r\n/g, '\n');
const frontmatter = skill.slice(3, skill.indexOf('\n---', 3));

test('frontmatter declares the skill name and a description', () => {
  assert.match(frontmatter, /^name: writing-flow$/m);
  assert.match(frontmatter, /^description: .+/m);
});

test('declares every stage of the pipeline', () => {
  for (const marker of ['purple-cow', 'fasaha', 'voice re-check', 'avoid-ai-writing', 'remove-ai-marks']) {
    assert.ok(skill.includes(marker), `missing stage marker: ${marker}`);
  }
});

test('bounds the loop between the Arabic passes', () => {
  assert.match(skill, /one .*pass.*then stop/i);
});

test('states the gate exit contract', () => {
  assert.match(skill, /exit `?0`?[^\n]*clean/i);
  assert.match(skill, /never deliver silently/i);
});

test('runs without an MCP server', () => {
  assert.match(skill, /no MCP server|without the MCP server/i);
});

test('carries no voice text', () => {
  assert.ok(!/Adel/.test(skill), 'the pipeline skill must not name the author voice');
});

test('tells the agent to read the active profile, not merely name it', () => {
  assert.match(
    skill,
    /read[^\n]{0,60}SKILL\.md/i,
    'the skill must instruct reading the profile SKILL.md, not just resolve it',
  );
});

test('tells the agent to apply learned preferences', () => {
  assert.match(skill, /learned preference/i);
  assert.match(skill, /preferences/i);
});

test('suggests generating a profile without letting it block the work', () => {
  assert.match(skill, /generate_profile/, 'the skill must name the tool that creates a profile');
  assert.match(skill, /bundled default/i, 'the suggestion hinges on the active profile being the fallback');
  assert.match(skill, /\bonce\b/i, 'the suggestion must be bounded, or it becomes nagging');
  assert.match(skill, /never as a blocker|not a blocker|never block/i, 'the suggestion must never stop the writing');
  assert.match(skill, /generate\.mjs/, 'the CLI path must be named, so the suggestion works with no server');
});

test('never lets a stage be skipped silently', () => {
  assert.match(skill, /cannot run|cannot be loaded|unloadable/i, 'the failing-stage case must be defined');
  assert.match(skill, /skipped in\s+silence|silently skip/i, 'silent skipping must be named as the failure');
  assert.match(skill, /doctor\.mjs/, 'the fix must be reachable without the MCP server');
  assert.match(skill, /Read the gate's lines rather than its exit code/i, 'a skip must not be read as a pass');
});

test('checks the language before the Arabic stages and calls them inapplicable, not missing', () => {
  assert.match(skill, /lang\.mjs/, 'the language check must be a script, not a guess');
  assert.match(skill, /\*\*before\*\* stage 2/i, 'the check has to happen before the pass, not after it');
  assert.match(skill, /inapplicable, not missing/i, 'inapplicable and missing are different outcomes');
  assert.match(skill, /\bmixed\b/, 'Arabic carrying Latin prose must still run the Arabic stages');
});

test('separates the producing stages from the verifying ones', () => {
  assert.match(skill, /verification, not production/i);
  assert.match(skill, /Stages 0-3 produce the piece; stages 4-5 verify it/);
});
