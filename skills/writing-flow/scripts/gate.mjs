import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readManifest, resolveProfile } from './profile.mjs';
import { resolveToolPaths } from './resolve-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** <plugin root>/skills/writing-flow/scripts -> <plugin root> */
const DEFAULT_PLUGIN_ROOT = resolve(HERE, '..', '..', '..');

const stateFor = (code) => (code === 0 ? 'PASS' : code === 1 ? 'FAIL' : 'ERROR');
const normalise = (code) => (code === 0 || code === 1 ? code : 2);

const spawnTool = (exe, args) => {
  try {
    const r = spawnSync(exe, args, { encoding: 'utf8' });
    return {
      code: normalise(typeof r.status === 'number' ? r.status : 2),
      text: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    };
  } catch (err) {
    return { code: 2, text: String(err && err.message) };
  }
};

const parseAvoidAiWriting = (text) => {
  const lines = text.split(/\r?\n/);
  const summary = (lines.find((l) => /\d+\s+hard/.test(l)) ?? '').trim();
  const hits = [];
  for (const line of lines) {
    const m = /^\s*L\d+\s+(.+?)\s*$/.exec(line);
    if (m) hits.push(m[1]);
  }
  return { summary, hits };
};

const parseRemoveAiMarks = (text) => {
  const lines = text.split(/\r?\n/);
  const summary = (lines.find((l) => /^Suspicious:\s*\d+/.test(l.trim())) ?? '').trim();
  const hits = lines.filter((l) => /U\+[0-9A-Fa-f]{4}/.test(l)).map((l) => l.trim());
  return { summary, hits };
};

const entry = (id, code, summary, hits) => ({ id, state: stateFor(code), code, summary, hits });

/**
 * Run every gate over one draft and report the worst outcome.
 * Exit contract: 0 clean, 1 violation, 2 tool error. A missing tool is always 2, never a pass.
 */
export async function runGate({
  path,
  cwd = process.cwd(),
  profileDir = null,
  skipMarks = false,
  skipStyle = false,
  roots,
  toolPaths = null,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
} = {}) {
  if (!path) throw new Error('runGate: a draft path is required');
  const draft = resolve(cwd, path);
  if (!existsSync(draft)) {
    return { code: 2, ok: false, draft, profile: null, gates: [], error: `draft not found: ${draft}` };
  }

  let profile = null;
  let houseStylePath = null;
  try {
    if (profileDir) {
      const dir = resolve(profileDir);
      const manifest = readManifest(dir);
      profile = { name: manifest.name, dir, resolvedBy: 'explicit' };
      houseStylePath = resolve(dir, manifest.houseStyle);
    } else {
      const r = await resolveProfile({ cwd, pluginRoot, roots });
      profile = { name: r.manifest.name, dir: r.dir, resolvedBy: r.resolvedBy, ambiguous: r.ambiguous, candidates: r.candidates };
      houseStylePath = r.houseStylePath;
    }
  } catch {
    profile = null;
    houseStylePath = null;
  }

  const tools = toolPaths ?? (await resolveToolPaths({ cwd, pluginRoot, roots }));
  const config = houseStylePath && existsSync(houseStylePath) ? houseStylePath : null;
  const gates = [];

  if (skipStyle) {
    gates.push(entry('avoid-ai-writing', 0, 'skipped (--skip-style)', []));
  } else if (!tools.gate4) {
    gates.push(entry('avoid-ai-writing', 2, 'avoid-ai-writing not found', []));
  } else {
    const args = [tools.gate4.path, draft, ...(config ? ['--config', config] : [])];
    const r = spawnTool(tools.node ?? process.execPath, args);
    const { summary, hits } = parseAvoidAiWriting(r.text);
    gates.push(entry('avoid-ai-writing', r.code, summary || `exit ${r.code}`, hits));
  }

  if (skipMarks) {
    gates.push(entry('remove-ai-marks', 0, 'skipped (--skip-marks)', []));
  } else if (!tools.python) {
    gates.push(entry('remove-ai-marks', 2, tools.pythonProblem ?? 'python not found on PATH', []));
  } else if (!tools.gate5) {
    gates.push(entry('remove-ai-marks', 2, 'remove-ai-marks not found', []));
  } else {
    const r = spawnTool(tools.python, [tools.gate5.path, draft]);
    const { summary, hits } = parseRemoveAiMarks(r.text);
    gates.push(entry('remove-ai-marks', r.code, summary || `exit ${r.code}`, hits));
  }

  const code = gates.reduce((worst, g) => Math.max(worst, g.code), 0);
  return { code, ok: code === 0, draft, profile, gates };
}

/** Human-readable report, mirroring the PowerShell gate it replaces. */
export function formatReport(result) {
  const lines = result.gates.map((g) => {
    const detail = [g.summary, g.hits.join('; ')].filter(Boolean).join('  |  ');
    return `${g.id === 'avoid-ai-writing' ? 'gate4 avoid-ai-writing' : 'gate5 remove-ai-marks '} : ${g.state}  ${detail}`;
  });
  if (result.profile?.ambiguous) {
    lines.push(
      `profile: AMBIGUOUS  ${result.profile.candidates.join(', ')}  —  using ${result.profile.dir}; pin one with manage_profile(action=set)`,
    );
  }
  if (lines.length === 0) lines.push(result.error ?? 'write-gate: BLOCKED');
  lines.push(result.code === 0 ? 'write-gate: CLEAN' : `write-gate: BLOCKED (worst exit ${result.code})`);
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]).endsWith('gate.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--profile');
  try {
    const result = await runGate({
      path: file,
      profileDir: flag('--profile'),
      skipMarks: argv.includes('--skip-marks'),
      skipStyle: argv.includes('--skip-style'),
    });
    if (argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatReport(result)}\n`);
    }
    process.exit(result.code);
  } catch (err) {
    process.stdout.write(`write-gate: ERROR ${err.message}\n`);
    process.exit(2);
  }
}
