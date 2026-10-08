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
