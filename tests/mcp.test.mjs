import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveToolPaths } from '../skills/writing-flow/scripts/resolve-paths.mjs';

const SERVER = 'skills/writing-flow/scripts/mcp-server.mjs';
const scratch = () => mkdtempSync(join(tmpdir(), 'wf-'));

const tools = await resolveToolPaths({ cwd: process.cwd() });
const installed = tools.gate4 && tools.gate5 && tools.python;
const skipUnlessInstalled = installed ? false : 'third-party gate tools are not installed on this machine';

const start = () => spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });

let nextId = 0;
const rpc = (child, method, params) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    let buffer = '';
    const onData = (chunk) => {
      buffer += String(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === id) {
          child.stdout.off('data', onData);
          clearTimeout(timer);
          resolve(message);
        }
      }
    };
    const timer = setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error(`timed out waiting for ${method}`));
    }, 20000);
    child.stdout.on('data', onData);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

const call = async (child, name, args = {}) => {
  const r = await rpc(child, 'tools/call', { name, arguments: args });
  return r.result;
};

const withServer = async (fn) => {
  const child = start();
  try {
    await rpc(child, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    return await fn(child);
  } finally {
    child.kill();
  }
};

test('initializes and advertises exactly the six tools', async () => {
  const hello = await withServer(async (child) => {
    const listed = await rpc(child, 'tools/list', {});
    return listed.result.tools.map((t) => t.name).sort();
  });
  assert.deepEqual(hello, [
    'doctor',
    'get_profile',
    'learn_preference',
    'manage_profile',
    'render_profile',
    'run_gate',
  ]);
});

test('every tool declares a description and an input schema', async () => {
  await withServer(async (child) => {
    const { result } = await rpc(child, 'tools/list', {});
    for (const tool of result.tools) {
      assert.ok(tool.description, `${tool.name} has no description`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} has no object input schema`);
    }
  });
});

test('get_profile names the effective profile and how it resolved', async () => {
  await withServer(async (child) => {
    const result = await call(child, 'get_profile');
    assert.equal(result.isError, undefined);
    assert.ok(result.structuredContent.name);
    assert.ok(['project', 'installed', 'bundled', 'store'].includes(result.structuredContent.resolvedBy));
  });
});

test('manage_profile lists profiles and reports the current one', async () => {
  await withServer(async (child) => {
    const list = await call(child, 'manage_profile', { action: 'list' });
    assert.ok(Array.isArray(list.structuredContent.profiles));
    assert.ok(list.structuredContent.profiles.some((p) => p.name === 'default'));
  });
});

test('manage_profile action=set pins a project to a profile', async () => {
  const project = scratch();
  await withServer(async (child) => {
    const result = await call(child, 'manage_profile', { action: 'set', name: 'default', projectDir: project });
    assert.equal(result.isError, undefined);
  });
  assert.ok(existsSync(join(project, 'writing-profile.json')));
  assert.ok(existsSync(join(project, 'house-style.json')));
});

test('learn_preference refuses without explicit consent', async () => {
  await withServer(async (child) => {
    const result = await call(child, 'learn_preference', { text: 'prefers short sentences', consent: false });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /consent/i);
  });
});

test('learn_preference records a preference when consent is given', async () => {
  const store = scratch();
  await withServer(async (child) => {
    const result = await call(child, 'learn_preference', { text: 'prefers short sentences', consent: true, profileDir: store });
    assert.equal(result.isError, undefined);
  });
  const recorded = JSON.parse(readFileSync(join(store, 'learned-preferences.json'), 'utf8'));
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].text, 'prefers short sentences');
});

test('run_gate returns the same code as the CLI', { skip: skipUnlessInstalled }, async () => {
  await withServer(async (child) => {
    const bad = await call(child, 'run_gate', { path: 'tests/fixtures/bad-latin-abbrev.md' });
    assert.equal(bad.structuredContent.code, 1);
    const clean = await call(child, 'run_gate', { path: 'tests/fixtures/clean.md' });
    assert.equal(clean.structuredContent.code, 0);
  });
});

test('doctor returns a report without throwing', async () => {
  await withServer(async (child) => {
    const result = await call(child, 'doctor');
    assert.ok(result.structuredContent.profile);
    assert.ok(Array.isArray(result.structuredContent.problems));
  });
});

test('an unknown method is a JSON-RPC error, not a crash', async () => {
  await withServer(async (child) => {
    const response = await rpc(child, 'no/such/method', {});
    assert.equal(response.error.code, -32601);
  });
});

test('an unknown tool is reported as an error result, not a crash', async () => {
  await withServer(async (child) => {
    const result = await call(child, 'no_such_tool', {});
    assert.equal(result.isError, true);
  });
});
