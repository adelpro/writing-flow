import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleYaml, commandParts, install, mcpAlreadyRegistered } from '../bin/install.mjs';

const scratchHome = () => mkdtempSync(join(tmpdir(), 'wf-hermes-'));
const quiet = () => ({ status: 0, stdout: '', stderr: '' });
const hermesHome = (home) => join(home, '.hermes');

const withHermes = () => {
  const home = scratchHome();
  mkdirSync(hermesHome(home), { recursive: true });
  return home;
};

const recorder = () => {
  const calls = [];
  return { calls, run: (args) => { calls.push(args); return quiet(); } };
};

test('registers the MCP server through the hermes CLI, never by editing config.yaml', async () => {
  const home = withHermes();
  const hermes = recorder();
  await install({ home, dependencies: [], runner: quiet, hermesRunner: hermes.run, hermesPresent: true });

  const add = hermes.calls.find((a) => a[0] === 'mcp' && a[1] === 'add');
  assert.ok(add, JSON.stringify(hermes.calls));
  assert.equal(add[2], 'writing-flow');
  assert.equal(add[3], '--command');
  assert.equal(add[4], 'node');
  assert.equal(add[5], '--args');
  assert.ok(add[6].endsWith(join('scripts', 'mcp-server.mjs')), add[6]);
  assert.equal(add.at(-1), add[6], '--args must be the last option: the CLI takes the rest as args');
});

test('a dry run plans the MCP registration and runs nothing', async () => {
  const home = withHermes();
  const hermes = recorder();
  const r = await install({ home, dryRun: true, dependencies: [], runner: quiet, hermesRunner: hermes.run, hermesPresent: true });
  assert.equal(hermes.calls.length, 0);
  assert.ok(r.actions.some((a) => a.detail.includes('hermes mcp add')), JSON.stringify(r.actions, null, 2));
});

test('an already-registered server is reported unchanged, not added twice', async () => {
  const home = withHermes();
  writeFileSync(
    join(hermesHome(home), 'config.yaml'),
    'mcp_servers:\n  writing-flow:\n    command: node\n    enabled: true\n',
  );
  const hermes = recorder();
  const r = await install({ home, dependencies: [], runner: quiet, hermesRunner: hermes.run, hermesPresent: true });
  assert.equal(hermes.calls.filter((a) => a[0] === 'mcp').length, 0, 'the CLI must not be driven again');
  assert.ok(r.actions.some((a) => a.kind === 'unchanged' && a.detail.includes('writing-flow in')));
});

test('writes both commands as bundles, derived from commands/', async () => {
  const home = withHermes();
  await install({ home, dependencies: [], runner: quiet, hermesRunner: recorder().run, hermesPresent: true });
  const dir = join(hermesHome(home), 'skill-bundles');
  for (const name of ['flow-writing', 'flow-doctor']) {
    const text = readFileSync(join(dir, `${name}.yaml`), 'utf8');
    assert.match(text, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(text, /^instruction: \|$/m);
    assert.ok(text.endsWith('\n'));
    const skills = text.split('skills:\n')[1].split('instruction:')[0].trim().split('\n').map((l) => l.trim().slice(2));
    if (name === 'flow-writing') {
      assert.deepEqual(skills, ['writing-flow', 'fasaha', 'purple-cow-content', 'avoid-ai-writing', 'remove-ai-marks']);
    } else {
      assert.deepEqual(skills, ['writing-flow']);
    }
    const block = text.split('instruction: |\n')[1].split('\n');
    for (const line of block) {
      if (line.length === 0) continue;
      assert.ok(line.startsWith('  '), `instruction line is not inside the block scalar: ${JSON.stringify(line)}`);
    }
  }
});

test('records the resolved tool paths for the hermes root too', async () => {
  const home = withHermes();
  await install({ home, dependencies: [], runner: quiet, hermesRunner: recorder().run, hermesPresent: true });
  const file = join(home, '.hermes', 'skills', 'writing-flow', 'scripts', 'paths.json');
  assert.ok(existsSync(file), file);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['node', 'python', 'gate4', 'gate5', 'missing']) assert.ok(key in record, key);
  assert.ok(Array.isArray(record.missing));
});

test('a home without ~/.hermes is left alone by the hermes branch', async () => {
  const home = scratchHome();
  const hermes = recorder();
  const r = await install({ home, dependencies: [], runner: quiet, hermesRunner: hermes.run, hermesPresent: true });
  assert.equal(hermes.calls.length, 0);
  assert.ok(
    !r.actions.some((a) => a.detail.includes('skill-bundles') || a.detail.includes('hermes mcp')),
    JSON.stringify(r.actions.slice(-6), null, 2),
  );
  assert.ok(!existsSync(join(home, '.hermes')), 'the installer must not create the root it looks for');
});

test('--no-hermes leaves ~/.hermes alone', async () => {
  const home = withHermes();
  const hermes = recorder();
  await install({ home, noHermes: true, dependencies: [], runner: quiet, hermesRunner: hermes.run, hermesPresent: true });
  assert.equal(hermes.calls.length, 0);
  assert.ok(!existsSync(join(hermesHome(home), 'skill-bundles')));
});

test('--uninstall removes the bundles and deregisters the MCP server', async () => {
  const home = withHermes();
  const dir = join(hermesHome(home), 'skill-bundles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'flow-writing.yaml'), 'name: flow-writing\n');
  writeFileSync(join(hermesHome(home), 'config.yaml'), 'mcp_servers:\n  writing-flow:\n    command: node\n');
  const hermes = recorder();
  await install({ home, uninstall: true, dependencies: [], runner: quiet, hermesRunner: hermes.run, hermesPresent: true });

  assert.equal(existsSync(join(dir, 'flow-writing.yaml')), false, 'the bundle must be gone');
  const remove = hermes.calls.find((a) => a[0] === 'mcp');
  assert.deepEqual(remove, ['mcp', 'remove', 'writing-flow']);
});

test('a missing hermes CLI is a warning with the exact command, never a silent gap', async () => {
  const home = withHermes();
  const r = await install({ home, dependencies: [], runner: quiet, hermesRunner: recorder().run, hermesPresent: false });
  const warning = r.warnings.find((w) => w.includes('hermes mcp add'));
  assert.ok(warning, JSON.stringify(r.warnings, null, 2));
  assert.ok(warning.includes('mcp-server.mjs'));
});

test('the bundle writer emits a valid block scalar for prose with blank lines', () => {
  const text = bundleYaml('flow-writing', 'Run the flow.', 'First line.\n\nSecond paragraph.\n');
  assert.equal(
    text,
    'name: flow-writing\ndescription: Run the flow.\nskills:\n  - writing-flow\ninstruction: |\n  First line.\n\n  Second paragraph.\n',
  );
});

test('the bundle writer lists every skill the flow needs, and drops no leading blank line', () => {
  const text = bundleYaml('flow-writing', 'Run the flow.', '\n\nFirst line.\n', ['writing-flow', 'fasaha']);
  assert.equal(text.split('\n')[1], 'description: Run the flow.');
  assert.ok(text.includes('skills:\n  - writing-flow\n  - fasaha\n'));
  assert.ok(text.includes('instruction: |\n  First line.\n'), text);
});

test('a second apply changes nothing in ~/.hermes', async () => {
  const home = withHermes();
  // The real CLI writes config.yaml as it registers; a stub that only records would make the
  // second run look like a fresh registration and the test would prove nothing.
  const run = (options) =>
    install({
      home,
      dependencies: [],
      runner: quiet,
      hermesPresent: true,
      hermesRunner: (args) => {
        if (args[0] === 'mcp' && args[1] === 'add') {
          writeFileSync(join(hermesHome(home), 'config.yaml'), 'mcp_servers:\n  writing-flow:\n    command: node\n');
        }
        return quiet();
      },
      ...options,
    });
  await run({});
  const second = await run({ dryRun: true });
  const hermesActions = second.actions.filter((a) => a.target.startsWith(join(hermesHome(home))));
  assert.ok(hermesActions.length >= 3, JSON.stringify(hermesActions, null, 2));
  assert.ok(
    hermesActions.every((a) => a.kind === 'unchanged'),
    JSON.stringify(hermesActions, null, 2),
  );
});

test('the command parser splits the frontmatter description from the body', () => {
  const { description, body } = commandParts('---\ndescription: Diagnose the setup\n---\n\nDo the thing.\n');
  assert.equal(description, 'Diagnose the setup');
  assert.equal(body.trim(), 'Do the thing.');
});

test('mcpAlreadyRegistered reads the indented key, not any mention of the name', () => {
  const home = scratchHome();
  const file = join(home, 'config.yaml');
  writeFileSync(file, 'plugins:\n  enabled:\n    - writing-flow\n');
  assert.equal(mcpAlreadyRegistered(file), false, 'a plugin name is not an mcp_servers entry');
  writeFileSync(file, 'mcp_servers:\n  writing-flow:\n    command: node\n');
  assert.equal(mcpAlreadyRegistered(file), true);
});
