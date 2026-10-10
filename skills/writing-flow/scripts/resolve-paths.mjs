import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defaultRoots } from './profile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATHS_FILE = 'paths.json';

/** The skill directory names this package depends on, and the script each must provide. */
const TOOLS = {
  'avoid-ai-writing': { key: 'gate4', script: join('scripts', 'check-style.js') },
  'remove-ai-marks': { key: 'gate5', script: join('scripts', 'inspect_text.py') },
};

const firstOnPath = (names) => {
  for (const name of names) {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(finder, [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout) {
      const hit = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (hit) return hit;
    }
  }
  return null;
};

/**
 * Resolve a Python that actually runs.
 *
 * `where python` on Windows can resolve to the Microsoft Store stub, which is on PATH but exits
 * non-zero when executed. That surfaced as a bare "python not found" exit 2 — misleading, because
 * something *was* found. Probing the candidate turns it into a named cause instead.
 */
export function probePython(candidates = ['python', 'python3', 'py']) {
  const candidate = firstOnPath(candidates);
  if (!candidate) return { path: null, problem: 'python not found on PATH' };

  const r = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) {
    return {
      path: null,
      problem: `${candidate} does not run — on Windows this is usually the Microsoft Store stub; install Python 3, or run the gate with --skip-marks`,
    };
  }
  return { path: candidate, problem: null };
}

const loadPathsJson = (candidates) => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const file = join(candidate, PATHS_FILE);
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // A damaged paths.json is not authoritative; fall back to searching.
    }
  }
  return null;
};

const searchRoots = ({ cwd, pluginRoot, roots }) => {
  const list = roots === null || roots === undefined
    ? [pluginRoot ? join(pluginRoot, 'skills') : null, ...defaultRoots(), cwd]
    : [...roots, cwd];
  return [...new Set(list.filter(Boolean).map((r) => resolve(r)))];
};

/**
 * Locate the third-party tools the gates depend on.
 * Order: an explicit `roots`/paths.json record first, then a search of the known skill roots.
 */
export async function resolveToolPaths({ cwd = process.cwd(), pluginRoot = null, roots = null, node = null, python = null } = {}) {
  const search = searchRoots({ cwd, pluginRoot, roots });
  const recorded = loadPathsJson([HERE, cwd, pluginRoot]);
  const missing = [];

  const resolveTool = (skill) => {
    const { key, script } = TOOLS[skill];
    const claimed = recorded?.[key];
    if (claimed?.path && existsSync(claimed.path)) {
      return { path: claimed.path, source: 'paths.json' };
    }
    const hit = search.map((root) => join(root, skill, script)).find((p) => existsSync(p));
    if (hit) return { path: hit, source: 'search' };
    missing.push(skill);
    return null;
  };

  const gate4 = resolveTool('avoid-ai-writing');
  const gate5 = resolveTool('remove-ai-marks');

  let pythonPath = python;
  let pythonProblem = null;
  if (!pythonPath) {
    const probed = probePython();
    pythonPath = probed.path;
    pythonProblem = probed.problem;
  }

  return {
    node: node ?? process.execPath,
    python: pythonPath,
    pythonProblem,
    gate4,
    gate5,
    missing,
    roots: search,
  };
}

/** Record what was actually installed, so later runs never have to guess. */
export async function writePathsJson(target, paths) {
  mkdirSync(dirname(resolve(target)), { recursive: true });
  const record = {
    node: paths.node ?? null,
    python: paths.python ?? null,
    ...(paths.pythonProblem ? { pythonProblem: paths.pythonProblem } : {}),
    gate4: paths.gate4 ?? null,
    gate5: paths.gate5 ?? null,
    missing: paths.missing ?? [],
  };
  writeFileSync(resolve(target), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}
