import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
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
