#!/usr/bin/env node
/**
 * writing-flow MCP server.
 *
 * Bundled with the plugin and launched by path — never downloaded. Stdout carries protocol
 * frames only; every diagnostic goes to stderr.
 *
 * Stateless: no tool holds authoritative state. Every mutation is a write to a file, so a
 * restart loses nothing.
 */
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRoots, readManifest, resolveProfile } from './profile.mjs';
import { renderProfile } from './render.mjs';
import { runDoctor } from './doctor.mjs';
import { runGate } from './gate.mjs';
import { generateProfile } from './generate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..', '..', '..');
const PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'writing-flow', version: '0.1.0' };
const PREFERENCES = 'learned-preferences.json';
const PROJECT_MANIFEST = 'writing-profile.json';

const str = { type: 'string' };
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required });

const TOOLS = [
  {
    name: 'get_profile',
    description: 'Report the effective writing profile, its languages, its house-style path, and which rule resolved it. Pass "cwd" as the user\'s project directory so a project override is visible. Cheap to call; never required before writing.',
    inputSchema: schema({ cwd: str }),
  },
  {
    name: 'manage_profile',
    description: 'One entry point for profile administration. action=current reports the effective profile; action=list lists installed profiles; action=set pins a project to a named profile by copying it into the project; action=reset removes that project pin; action=default reports the bundled default.',
    inputSchema: schema(
      { action: str, name: str, projectDir: str },
      ['action'],
    ),
  },
  {
    name: 'learn_preference',
    description: 'Record one durable preference about how the user writes. Requires explicit consent. Appends to the profile; never rewrites a draft.',
    inputSchema: schema({ text: str, consent: { type: 'boolean' }, profileDir: str }, ['text', 'consent']),
  },
  {
    name: 'run_gate',
    description: 'Run both writing gates over a draft and return the structured result. Pass "cwd" as the user\'s project directory when "path" is relative. Exit codes: 0 clean, 1 violation, 2 tool error. Checks mechanics only, never voice fidelity.',
    inputSchema: schema({ path: str, cwd: str, skipMarks: { type: 'boolean' } }, ['path']),
  },
  {
    name: 'doctor',
    description: 'Report the effective profile, where each required skill resolved, which are missing, and whether any rendered copy has diverged from the store. Pass "cwd" as the user\'s project directory.',
    inputSchema: schema({ store: str, cwd: str }),
  },
  {
    name: 'render_profile',
    description: 'Render a profile from the store into a harness skill root, and emit its portable voice card. Dry run by default.',
    inputSchema: schema(
      { profileDir: str, targetRoot: str, mode: str, cwd: str, dryRun: { type: 'boolean' }, force: { type: 'boolean' } },
      ['targetRoot'],
    ),
  },
  {
    name: 'generate_profile',
    description: 'Generate a writing profile in the standard format the engine reads, from existing writing: a SKILL.md, a markdown file, or a directory containing one. Previews by default and reports every line it would drop as pipeline instruction. Applying requires confirm: true; pass includeAll to keep every line. Review the returned "excluded" list before applying — losing a voice to a bad split is worse than reading a list.',
    inputSchema: schema(
      { source: str, name: str, outDir: str, description: str, dryRun: { type: 'boolean' }, confirm: { type: 'boolean' }, includeAll: { type: 'boolean' } },
      ['source', 'name'],
    ),
  },
];

const scanProfiles = () => {
  const roots = [join(PLUGIN_ROOT, 'skills'), ...defaultRoots()];
  const found = new Map();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = join(root, entry.name);
      if (!existsSync(join(dir, PROJECT_MANIFEST))) continue;
      try {
        const manifest = readManifest(dir);
        if (!found.has(resolve(dir))) {
          found.set(resolve(dir), {
            name: manifest.name,
            version: manifest.version,
            languages: manifest.languages,
            dir: resolve(dir),
            root,
          });
        }
      } catch {
        // An unreadable profile is reported by doctor, not fatal here.
      }
    }
  }
  return [...found.values()];
};

const locate = (name) => {
  const profiles = scanProfiles();
  return profiles.find((p) => p.name === name) ?? null;
};

/**
 * The client's working directory is not this server's: Agent Plugins pins a stdio server's cwd
 * to the plugin root when `cwd` is omitted, and pins it explicitly when present. Every tool
 * that touches the user's project therefore takes an explicit `cwd`.
 */
const projectDir = (value) => resolve(value ?? process.env.WRITING_FLOW_CWD ?? process.cwd());

const effective = async (cwd) => {
  const r = await resolveProfile({ cwd: projectDir(cwd), pluginRoot: PLUGIN_ROOT });
  return {
    name: r.manifest.name,
    version: r.manifest.version,
    languages: r.manifest.languages,
    houseStyle: r.manifest.houseStyle,
    houseStylePath: r.houseStylePath,
    requiredSkills: r.manifest.requiredSkills,
    dir: r.dir,
    resolvedBy: r.resolvedBy,
    ambiguous: r.ambiguous,
    candidates: r.candidates,
    warnings: r.warnings,
  };
};

const copyProfileFiles = (profileDir, targetDir) => {
  mkdirSync(targetDir, { recursive: true });
  const written = [];
  for (const entry of readdirSync(profileDir, { withFileTypes: true })) {
    // voice-card.md is generated output, and learned preferences are the user's own notes.
    if (!entry.isFile() || entry.name === 'voice-card.md' || entry.name === PREFERENCES) continue;
    const destination = join(targetDir, entry.name);
    writeFileSync(destination, readFileSync(join(profileDir, entry.name)));
    written.push(destination);
  }
  return written;
};

const recordPreference = (profileDir, text) => {
  const file = join(profileDir, PREFERENCES);
  let existing = [];
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = [];
    }
  }
  const entry = { text, recorded: new Date().toISOString().slice(0, 10) };
  existing.push(entry);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  return { file, recorded: entry };
};

const handleManageProfile = async ({ action, name, projectDir: target, cwd }) => {
  switch (action) {
    case 'current':
      return effective(cwd);
    case 'list': {
      const profiles = scanProfiles();
      const current = await effective(cwd).catch(() => null);
      return { profiles, current: current ? { name: current.name, resolvedBy: current.resolvedBy } : null };
    }
    case 'default': {
      const bundled = locate('default');
      if (!bundled) throw new Error('no bundled default profile found');
      return bundled;
    }
    case 'set': {
      if (!name) throw new Error('action=set requires a profile "name"');
      if (!target) throw new Error('action=set requires a "projectDir"');
      const profile = locate(name);
      if (!profile) throw new Error(`no installed profile named "${name}"`);
      const written = copyProfileFiles(profile.dir, resolve(target));
      return { pinned: profile.name, projectDir: resolve(target), written };
    }
    case 'reset': {
      if (!target) throw new Error('action=reset requires a "projectDir"');
      const removed = [];
      // Only what action=set writes. Removing anything else would delete files it never made.
      for (const file of [PROJECT_MANIFEST, 'house-style.json']) {
        const victim = join(resolve(target), file);
        if (existsSync(victim)) {
          rmSync(victim, { force: true });
          removed.push(victim);
        }
      }
      return { projectDir: resolve(target), removed };
    }
    default:
      throw new Error(`unknown action "${action}"; expected current, list, set, reset or default`);
  }
};

const invoke = async (name, args = {}) => {
  switch (name) {
    case 'get_profile':
      return effective(args.cwd);
    case 'manage_profile':
      return handleManageProfile(args);
    case 'learn_preference': {
      if (args.consent !== true) {
        throw new Error('learn_preference requires explicit consent: pass consent: true');
      }
      const text = String(args.text ?? '').trim();
      if (!text) throw new Error('learn_preference requires non-empty "text"');
      const dir = args.profileDir ? resolve(args.profileDir) : (await effective(args.cwd)).dir;
      return recordPreference(dir, text);
    }
    case 'run_gate':
      return runGate({ path: args.path, cwd: projectDir(args.cwd), skipMarks: args.skipMarks === true });
    case 'doctor':
      return runDoctor({ store: args.store ?? null, cwd: projectDir(args.cwd) });
    case 'render_profile': {
      const profileDir = args.profileDir ?? (await effective(args.cwd)).dir;
      return renderProfile({
        profileDir,
        targetRoot: resolve(args.targetRoot),
        mode: args.mode ?? 'copy',
        dryRun: args.dryRun !== false,
        force: args.force === true,
      });
    }
    case 'generate_profile':
      return generateProfile({
        source: args.source,
        name: args.name,
        outDir: args.outDir ?? null,
        description: args.description ?? null,
        dryRun: args.dryRun !== false,
        confirm: args.confirm === true,
        includeAll: args.includeAll === true,
      });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
};

/** Versions this server can speak. A client asking for anything else is answered with ours. */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const preamble = (method, params) => {
  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return {
      protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS };
  return null;
};

const respond = async (request) => {
  const { id, method, params } = request;
  if (method === 'notifications/initialized' || method === undefined) return;
  if (method === 'tools/call') {
    const name = params?.name;
    try {
      const structured = await invoke(name, params?.arguments ?? {});
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: String(err && err.message ? err.message : err) }],
          isError: true,
        },
      };
    }
  }
  const result = preamble(method, params);
  if (result) return { jsonrpc: '2.0', id, result };
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
};

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  Promise.resolve(respond(request))
    .then((reply) => {
      if (reply) send(reply);
    })
    .catch((err) => {
      if (request?.id !== undefined) {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(err?.message ?? err) } });
      }
    });
});

process.stderr.write(`writing-flow mcp server ready (root ${PLUGIN_ROOT})\n`);
