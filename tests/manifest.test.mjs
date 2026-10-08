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
