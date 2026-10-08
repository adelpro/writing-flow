# Writing Flow Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portable Agent Plugins 1.0.0 package that carries the voice-writing pipeline, its profile store and its deterministic gate, installable into OpenCode, Claude Code and conformant clients.

**Architecture:** One package: a pipeline skill that holds the contract, a bundled local stdio MCP server that manages profiles and runs the gate, a Node gate that replaces the PowerShell one, and an installer that materialises the package into each harness. The private voice is a separate package of the same shape; the store is authoritative and harness copies are rendered output.

**Tech Stack:** Node 18+ ESM, `node --test` (zero runtime dependencies), MCP over stdio, Agent Plugins 1.0.0, PowerShell 5.1 and Bash shims.

**Spec:** `docs/superpowers/specs/2026-10-08-writing-flow-plugin-design.md`

## Global Constraints

- Target Agent Plugins `1.0.0`; `plugin.json` `$schema` is exactly `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. A missing `$schema` makes VS Code read the package as the Copilot format.
- `plugin.json` is a **closed** schema. Only `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions` are permitted.
- Plugin `name`: lowercase `a-z0-9`, `.` and `-` only, 1-64 chars, no `--` or `..`, alphanumeric at both ends.
- Node 18+ ESM only. **Zero runtime dependencies.** Tests use `node --test`.
- Gate exit contract: `0` clean, `1` violation, `2` tool error. A missing tool is `2` with a named cause — never a silent pass.
- The engine lives in `skills/writing-flow/scripts/`. The skills CLI copies skill directories flat, so anything needed at run time must be inside the skill directory.
- The gate checks mechanics, **not** voice fidelity. No tool may be named or described as scoring voice.
- `mcp.json` carries no secrets; `headers` and `env` are visible package data.
- The MCP server is bundled and launched by path. **Never `npx`** — a download reintroduces the cold-start timeout recorded on this machine.
- Run time never performs `npx skills update -g`. Targeted `npx -y skills@latest add <repo> -g -a <agent> -s <skill> -y --copy` only.
- Never add files to `avoid-ai-writing/examples/`; its test asserts on that directory.
- Drafts written from PowerShell must be BOM-less: `[IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`.

## Review Focus

Each line is pinned to the test in the owning task, in that task's step style.

1. **A BOM-prefixed draft.** A user pastes text saved by Notepad. Expected: gate 5 reports `U+FEFF` as a violation, not a crash and not a silent pass. → Task 6.
2. **Python absent, Node present.** A macOS or Linux user has Node but no Python. Expected: gate exits `2`, names gate 5 and Python as the cause, and gate 4's result is still reported. → Task 6.
3. **Two installed voice profiles.** A user leaves an old profile in a skill root. Expected: resolution reports the ambiguity and refuses to guess silently. → Task 3.
4. **Hand-edited rendered copy.** A user edits `~/.agents/skills/adelpro-voice/SKILL.md` directly. Expected: `doctor` reports the divergence, and `render_profile` reports the overwrite it would make. → Task 4.
5. **No MCP server configured.** The user is in a harness where the server was never added. Expected: the pipeline still completes; no tool call is mandatory. → Task 2, re-verified Task 12.
6. **A path containing spaces.** Windows home directories and project paths contain spaces. Expected: every spawned command receives a correct single argument and never a broken quoted string. → Task 5.

---

## Phase 0 — Bootstrap

### Task 1: Package skeleton and manifest

**Files:**
- Create: `D:\benyahia-dev\writing-flow\plugin.json`
- Create: `D:\benyahia-dev\writing-flow\LICENSE` (MIT)
- Create: `D:\benyahia-dev\writing-flow\.gitignore` (`node_modules/`, `paths.json`, `*.log`)
- Create: `D:\benyahia-dev\writing-flow\schemas\1.0.0\plugin.schema.json`
- Create: `D:\benyahia-dev\writing-flow\schemas\1.0.0\mcp.schema.json`
- Test: `D:\benyahia-dev\writing-flow\tests\manifest.test.mjs`

**Interfaces:**
- Produces: the plugin root every later task writes into; the vendored schemas' path `schemas/1.0.0/`.

- [ ] **Step 1: Decide the repo home.** Create the directory `D:\benyahia-dev\writing-flow`, `git init`, and confirm the name `writing-flow` is acceptable. If it changes, change it in `plugin.json` and the README only.
- [ ] **Step 2: Vendor the two schemas.** Download `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` and `.../mcp.schema.json` into `schemas/1.0.0/`. Clients never fetch schemas at load time; we validate offline.
- [ ] **Step 3: Write the failing test**

```js
// tests/manifest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('plugin.json satisfies the 1.0.0 closed schema', () => {
  const m = JSON.parse(readFileSync('plugin.json', 'utf8'));
  assert.equal(m.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(m.name, /^[a-z0-9]([a-z0-9.-]*[a-z0-9])$/);
  assert.ok(m.name.length <= 64 && !m.name.includes('--') && !m.name.includes('..'));
  const allowed = ['$schema','name','version','description','author','homepage','repository','license','keywords','extensions'];
  assert.deepEqual(Object.keys(m).filter(k => !allowed.includes(k)), []);
});
```

- [ ] **Step 4: Run the test to verify it fails.** Run `node --test tests/manifest.test.mjs`. Expected: FAIL, `Cannot find module 'plugin.json'`.
- [ ] **Step 5: Write `plugin.json`** with `$schema`, `name: "writing-flow"`, `version: "0.1.0"`, `description`, `author`, `repository`, `license: "MIT"`, `keywords`.
- [ ] **Step 6: Run the test to verify it passes.** Run `node --test tests/manifest.test.mjs`. Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add plugin.json LICENSE .gitignore schemas tests/manifest.test.mjs
git commit -m "feat: bootstrap the writing-flow agent plugin package"
```

---

## Phase 1 — The pipeline skill

### Task 2: `skills/writing-flow/SKILL.md`, contract only

**Files:**
- Create: `skills/writing-flow/SKILL.md`
- Test: `tests/skill.test.mjs`

**Interfaces:**
- Produces: the stage order, loop policy, gate invocation and profile rule that every later task refers to. The skill refers to the gate as `node <skill base dir>/scripts/gate.mjs`.

- [ ] **Step 1: Write the failing test**

```js
// tests/skill.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const skill = readFileSync('skills/writing-flow/SKILL.md', 'utf8');

test('frontmatter has name and description', () => {
  assert.match(skill, /^---\n[\s\S]*?\nname: writing-flow\n/);
  assert.match(skill, /\ndescription: .+/);
});

test('declares all six stages and both bounds', () => {
  for (const s of ['purple-cow', 'fasaha', 'voice re-check', 'avoid-ai-writing', 'remove-ai-marks'])
    assert.ok(skill.includes(s), `missing stage marker: ${s}`);
  assert.match(skill, /one .*pass.*then stop/i);
});

test('states the gate exit contract and needs no tool', () => {
  assert.match(skill, /exit `?0`?[^\n]*clean/i);
  assert.match(skill, /never deliver silently/i);
  assert.match(skill, /no MCP server|without the MCP server/i);
});

test('carries no voice text', () => {
  assert.ok(!/Adel/.test(skill), 'the pipeline skill must not name the author voice');
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run `node --test tests/skill.test.mjs`. Expected: FAIL, `ENOENT`.
- [ ] **Step 3: Write `SKILL.md`.** Move the content now at `~/.config/opencode/skills/adelpro-voice/SKILL.md` lines ~25-45 verbatim, then add: the profile resolution rule (§4.3), the `node <skill dir>/scripts/gate.mjs` invocation, and this sentence: *"This skill must work with no MCP server configured. No tool call is mandatory."*
- [ ] **Step 4: Run the test to verify it passes.** Run `node --test tests/skill.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add skills/writing-flow/SKILL.md tests/skill.test.mjs
git commit -m "feat(skill): add the pipeline contract skill"
```

---

## Phase 2 — Profile store and render

### Task 3: `profile.mjs` — manifest and resolution

**Files:**
- Create: `skills/writing-flow/scripts/profile.mjs`
- Create: `skills/voice-default/SKILL.md`
- Create: `skills/voice-default/writing-profile.json`
- Create: `skills/voice-default/house-style.json`
- Test: `tests/profile.test.mjs`

**Interfaces:**
- Produces:
  - `readManifest(dir: string): ProfileManifest` — throws `ProfileError` when invalid.
  - `resolveProfile({ cwd, roots }): Promise<ResolvedProfile>`
  - `defaultRoots(): string[]` — `~/.agents/skills`, `~/.claude/skills`, `~/.config/opencode/skills`, `<pluginRoot>/skills`.
  - `type ProfileManifest = { kind:'voice', name:string, version:string, languages:string[], houseStyle:string, arabicStages:string[], requiredSkills:string[] }`
  - `type ResolvedProfile = { dir:string, manifest:ProfileManifest, houseStylePath:string, resolvedBy:'project'|'installed'|'bundled', candidates:string[], ambiguous:boolean }`
- Later tasks consume `resolveProfile` (Tasks 6, 8) and `readManifest` (Task 4).

- [ ] **Step 1: Write the failing tests**

```js
// tests/profile.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProfile, readManifest } from '../skills/writing-flow/scripts/profile.mjs';

const profile = (dir, name) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'writing-profile.json'), JSON.stringify({
    kind:'voice', name, version:'1.0.0', languages:['en'],
    houseStyle:'./house-style.json', arabicStages:[], requiredSkills:[] }));
  writeFileSync(join(dir, 'house-style.json'), '{}');
  return dir;
};

test('prefers a project override over an installed profile', async () => {
  const root = mkdtempSync(join(tmpdir(),'r-'));
  profile(join(root,'project'), 'project-voice');
  profile(join(root,'installed'), 'installed-voice');
  const r = await resolveProfile({ cwd: join(root,'project'), roots: [join(root,'installed')] });
  assert.equal(r.resolvedBy, 'project');
  assert.equal(r.manifest.name, 'project-voice');
});

test('reports ambiguity rather than silently picking one', async () => {
  const root = mkdtempSync(join(tmpdir(),'r-'));
  profile(join(root,'a'), 'alpha');
  profile(join(root,'b'), 'beta');
  const r = await resolveProfile({ cwd: root, roots: [root] });
  assert.equal(r.ambiguous, true);
  assert.equal(r.candidates.length, 2);
});

test('throws on a malformed manifest', () => {
  const dir = mkdtempSync(join(tmpdir(),'r-'));
  writeFileSync(join(dir,'writing-profile.json'), '{"kind":"voice"}');
  assert.throws(() => readManifest(dir), /name/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/profile.test.mjs`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `profile.mjs`.** Walk `roots` one level for `*/writing-profile.json` whose `kind === 'voice'`. Validate required keys and that `houseStyle` resolves inside the profile directory (reject `..` escapes, matching the Agent Plugins containment rule).
- [ ] **Step 4: Create `skills/voice-default/`.** `SKILL.md` is a neutral plain-professional voice. `writing-profile.json` uses `name: "default"`, `languages: ["en","ar-MSA"]`. `house-style.json` is a conservative copy of the existing file with `spellNumbersUpTo` **omitted** (present flags every literal digit).
- [ ] **Step 5: Run the tests to verify they pass.** Run `node --test tests/profile.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add skills/writing-flow/scripts/profile.mjs skills/voice-default tests/profile.test.mjs
git commit -m "feat(profile): add manifest parsing and profile resolution"
```

### Task 4: `render.mjs` — render the store, detect drift

**Files:**
- Create: `skills/writing-flow/scripts/render.mjs`
- Create: `skills/voice-default/voice-card.md`
- Test: `tests/render.test.mjs`

**Interfaces:**
- Produces:
  - `renderProfile({ profileDir, targetRoot, mode='junction', dryRun=true }): Promise<RenderResult>`
  - `checkDrift({ profileDir, roots }): Promise<{ ok:boolean, drift:{root:string,path:string,reason:string}[] }>`
  - `renderVoiceCard(manifest: ProfileManifest, voiceText: string): string`
  - `type RenderResult = { target:string, ok:boolean, writes:{path:string,action:'create'|'update'|'unchanged',hash:string}[], voiceCard:string }`
- Consumes: `readManifest` from Task 3.

- [ ] **Step 1: Write the failing tests**

```js
// tests/render.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderProfile, checkDrift } from '../skills/writing-flow/scripts/render.mjs';

test('dry run reports writes and changes nothing', async () => {
  const target = mkdtempSync(join(tmpdir(),'t-'));
  const r = await renderProfile({ profileDir: 'skills/voice-default', targetRoot: target });
  assert.equal(r.ok, true);
  assert.ok(r.writes.some(w => w.action === 'create'));
  assert.equal(existsSync(join(target,'voice-default')), false);
});

test('a second real render changes nothing', async () => {
  const target = mkdtempSync(join(tmpdir(),'t-'));
  await renderProfile({ profileDir: 'skills/voice-default', targetRoot: target, mode:'copy', dryRun:false });
  const r = await renderProfile({ profileDir: 'skills/voice-default', targetRoot: target, mode:'copy', dryRun:false });
  assert.ok(r.writes.every(w => w.action === 'unchanged'));
});

test('a hand-edited copy is reported as drift', async () => {
  const target = mkdtempSync(join(tmpdir(),'t-'));
  await renderProfile({ profileDir: 'skills/voice-default', targetRoot: target, mode:'copy', dryRun:false });
  const f = join(target,'voice-default','SKILL.md');
  writeFileSync(f, readFileSync(f,'utf8') + '\nhand edit\n');
  const d = await checkDrift({ profileDir: 'skills/voice-default', roots: [target] });
  assert.equal(d.ok, false);
  assert.equal(d.drift[0].reason, 'content-differs');
});

test('the voice card is self-contained', () => {
  const card = renderVoiceCard({ name:'x', version:'1.0.0', languages:['en'], houseStyle:'./house-style.json', arabicStages:[], requiredSkills:[] }, 'VOICE');
  assert.match(card, /VOICE/);
  assert.ok(!card.includes('${'), 'no unresolved placeholders');
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/render.test.mjs`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `render.mjs`.** Hash files with `node:crypto`, compare to decide `create`/`update`/`unchanged`. `junction` mode uses `fs.symlink(..., 'junction')` on Windows and `'dir'` elsewhere, falling back to copy when the link fails. `dryRun` is the default, per the spec's preview-then-write rule.
- [ ] **Step 4: Generate `skills/voice-default/voice-card.md`** by running the render helper and committing the output.
- [ ] **Step 5: Run the tests to verify they pass.** Run `node --test tests/render.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add skills/writing-flow/scripts/render.mjs skills/voice-default/voice-card.md tests/render.test.mjs
git commit -m "feat(profile): render profiles and detect drift"
```

---

## Phase 3 — The gate

### Task 5: `resolve-paths.mjs` — locate the third-party tools

**Files:**
- Create: `skills/writing-flow/scripts/resolve-paths.mjs`
- Test: `tests/paths.test.mjs`

**Interfaces:**
- Produces:
  - `resolveToolPaths({ cwd, pluginRoot }): Promise<ToolPaths>`
  - `writePathsJson(target: string, paths: ToolPaths): Promise<void>`
  - `type ToolPaths = { node:string|null, python:string|null, gate4:{path:string,source:string}|null, gate5:{path:string,source:string}|null, missing:string[] }`
- Consumed by Tasks 6 and 8.

- [ ] **Step 1: Write the failing tests**

```js
// tests/paths.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveToolPaths } from '../skills/writing-flow/scripts/resolve-paths.mjs';

const fakeRoot = (name) => {
  const root = mkdtempSync(join(tmpdir(),'root with spaces '));
  mkdirSync(join(root, name, 'scripts'), { recursive: true });
  return root;
};

test('finds gate4 under a root whose path contains spaces', async () => {
  const root = fakeRoot('avoid-ai-writing');
  writeFileSync(join(root,'avoid-ai-writing','scripts','check-style.js'), '//');
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root });
  assert.equal(p.gate4.source, 'search');
  assert.ok(p.gate4.path.endsWith('check-style.js'));
});

test('reports a missing tool by name', async () => {
  const root = mkdtempSync(join(tmpdir(),'empty '));
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root });
  assert.ok(p.missing.includes('avoid-ai-writing'));
  assert.equal(p.gate4, null);
});

test('prefers paths.json over searching', async () => {
  const root = mkdtempSync(join(tmpdir(),'pj '));
  const found = fakeRoot('avoid-ai-writing');
  writeFileSync(join(root,'paths.json'), JSON.stringify({
    gate4: { path: join(found,'avoid-ai-writing','scripts','check-style.js'), source: 'paths.json' },
    gate5: null, python: null, node: null, missing: [] }));
  const p = await resolveToolPaths({ cwd: root, pluginRoot: root });
  assert.equal(p.gate4.source, 'paths.json');
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/paths.test.mjs`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `resolve-paths.mjs`.** Order: explicit call argument, `paths.json` beside the script, then search `defaultRoots()` (reuse Task 3's). Resolve `node` and `python` with `node:child_process` `where`/`which` fallbacks rather than assuming `PATH` lookup succeeds. Record which route succeeded in `source` as `'arg'`, `'paths.json'` or `'search'`.
- [ ] **Step 4: Run the tests to verify they pass.** Run `node --test tests/paths.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add skills/writing-flow/scripts/resolve-paths.mjs tests/paths.test.mjs
git commit -m "feat(gate): resolve third-party tool paths"
```

### Task 6: `gate.mjs` — the deterministic gate, Node edition

**Files:**
- Create: `skills/writing-flow/scripts/gate.mjs`
- Create: `tests/fixtures/clean.md`, `tests/fixtures/bad-latin-abbrev.md`, `tests/fixtures/bom.md`, `tests/fixtures/arabic.md`
- Test: `tests/gate.test.mjs`

**Interfaces:**
- Produces:
  - `runGate({ path, cwd, profileDir=null, skipMarks=false }): Promise<GateResult>`
  - `type GateResult = { code:0|1|2, ok:boolean, profile:{name:string,dir:string,resolvedBy:string}|null, gates:GateEntry[] }`
  - `type GateEntry = { id:'avoid-ai-writing'|'remove-ai-marks', state:'PASS'|'FAIL'|'ERROR', code:0|1|2, summary:string, hits:string[] }`
  - CLI: `node gate.mjs <file> [--json] [--profile <dir>] [--skip-marks]`
- Consumes: `resolveToolPaths` (Task 5), `resolveProfile` (Task 3).

- [ ] **Step 1: Write the failing tests**

```js
// tests/gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGate } from '../skills/writing-flow/scripts/gate.mjs';

test('clean draft exits 0', async () => {
  const r = await runGate({ path: 'tests/fixtures/clean.md' });
  assert.equal(r.code, 0);
  assert.equal(r.ok, true);
});

test('a bundled abbreviation outside parentheses exits 1', async () => {
  const r = await runGate({ path: 'tests/fixtures/bad-latin-abbrev.md' });
  assert.equal(r.code, 1);
  assert.ok(r.gates.some(g => g.hits.some(h => h === 'latin-abbrev-outside-parens')));
});

test('a BOM is reported as a codepoint, not a crash', async () => {
  const r = await runGate({ path: 'tests/fixtures/bom.md' });
  assert.equal(r.code, 1);
  assert.ok(r.gates.some(g => g.hits.some(h => /U\+FEFF/.test(h))));
});

test('a missing file is a tool error', async () => {
  const r = await runGate({ path: 'tests/fixtures/nope.md' });
  assert.equal(r.code, 2);
});

test('an Arabic draft does not crash the gate', async () => {
  const r = await runGate({ path: 'tests/fixtures/arabic.md' });
  assert.ok([0,1].includes(r.code));
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/gate.test.mjs`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Create the fixtures** with BOM-less UTF-8. `bom.md` is written with a **literal leading `\uFEFF`** (not the file encoding) so the check is about content, and is byte-stable on every platform. `bad-latin-abbrev.md` contains `e.g.` outside parentheses.
- [ ] **Step 4: Implement `gate.mjs`.** Spawn gate 4 with `process.execPath` and gate 5 with the resolved Python. Pass arguments as an **array**, never a shell string, so paths with spaces survive (Review Focus 6). When Python is absent, mark gate 5 `ERROR` with `summary: 'python not found'` (Review Focus 2) and still report gate 4.
- [ ] **Step 5: Run the tests to verify they pass.** Run `node --test tests/gate.test.mjs`. Expected: PASS.
- [ ] **Step 6: Verify parity with the PowerShell gate.** Run both gates over `clean.md` and `bad-latin-abbrev.md` and confirm identical exit codes and the same rule name for the violation.
- [ ] **Step 7: Commit**

```bash
git add skills/writing-flow/scripts/gate.mjs tests/fixtures tests/gate.test.mjs
git commit -m "feat(gate): add the Node gate with parity to write-gate.ps1"
```

### Task 7: `doctor.mjs` — one call to explain the whole state

**Files:**
- Create: `skills/writing-flow/scripts/doctor.mjs`
- Test: `tests/doctor.test.mjs`

**Interfaces:**
- Produces: `runDoctor({ cwd, pluginRoot }): Promise<DoctorResult>`; `type DoctorResult = { ok:boolean, profile:{name:string,dir:string,resolvedBy:string}|null, ambiguity:string[], missing:string[], drift:unknown[], problems:string[] }`
- Consumes: `resolveProfile` (3), `resolveToolPaths` (5), `checkDrift` (4).

- [ ] **Step 1: Write the failing tests**

```js
// tests/doctor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor } from '../skills/writing-flow/scripts/doctor.mjs';

test('reports the effective profile and its resolver', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.' });
  assert.ok(d.profile);
  assert.ok(['project','installed','bundled'].includes(d.profile.resolvedBy));
});

test('names every missing required skill', async () => {
  const d = await runDoctor({ cwd: '.', pluginRoot: '.', roots: [] });
  assert.ok(d.missing.length >= 1);
  assert.ok(d.problems.some(p => /avoid-ai-writing/.test(p)));
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/doctor.test.mjs`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `doctor.mjs`.** Cross-check each `profile.manifest.requiredSkills` entry against `resolveToolPaths().missing`; turn an ambiguity from Task 3 into a `problems` entry (Review Focus 3); turn drift from Task 4 into a `problems` entry (Review Focus 4).
- [ ] **Step 4: Run the tests to verify they pass.** Run `node --test tests/doctor.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add skills/writing-flow/scripts/doctor.mjs tests/doctor.test.mjs
git commit -m "feat(doctor): diagnose profiles, tools and drift in one call"
```

---

## Phase 4 — The MCP server

### Task 8: `mcp-server.mjs` and `mcp.json`

**Files:**
- Create: `skills/writing-flow/scripts/mcp-server.mjs`
- Create: `mcp.json`
- Test: `tests/mcp.test.mjs`

**Interfaces:**
- Consumes: `runGate` (6), `runDoctor` (7), `resolveProfile`/`readManifest` (3), `renderProfile` (4).
- Produces the six tools: `manage_profile(action)`, `get_profile`, `learn_preference(consent,…)`, `run_gate({path})`, `doctor`, `render_profile({profileDir,targetRoot,dryRun})`.

- [ ] **Step 1: Write the failing tests** — a helper that spawns the server and speaks JSON-RPC over stdio:

```js
// tests/mcp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const rpc = (child, id, method, params) => new Promise((res) => {
  const onData = (b) => {
    for (const line of String(b).split('\n').filter(Boolean)) {
      const m = JSON.parse(line);
      if (m.id === id) { child.stdout.off('data', onData); res(m); }
    }
  };
  child.stdout.on('data', onData);
  child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params }) + '\n');
});

test('advertises exactly the six tools', async () => {
  const child = spawn(process.execPath, ['skills/writing-flow/scripts/mcp-server.mjs']);
  await rpc(child, 1, 'initialize', { protocolVersion:'2025-06-18', capabilities:{} });
  const r = await rpc(child, 2, 'tools/list', {});
  assert.deepEqual(r.result.tools.map(t => t.name).sort(),
    ['doctor','get_profile','learn_preference','manage_profile','render_profile','run_gate']);
  child.kill();
});

test('run_gate returns the same code as the CLI', async () => {
  const child = spawn(process.execPath, ['skills/writing-flow/scripts/mcp-server.mjs']);
  await rpc(child, 1, 'initialize', { protocolVersion:'2025-06-18', capabilities:{} });
  const r = await rpc(child, 2, 'tools/call', { name:'run_gate', arguments:{ path:'tests/fixtures/bad-latin-abbrev.md' } });
  assert.equal(r.result.structuredContent.code, 1);
  child.kill();
});

test('learn_preference refuses without consent', async () => {
  const child = spawn(process.execPath, ['skills/writing-flow/scripts/mcp-server.mjs']);
  await rpc(child, 1, 'initialize', { protocolVersion:'2025-06-18', capabilities:{} });
  const r = await rpc(child, 2, 'tools/call', { name:'learn_preference', arguments:{ text:'x', consent:false } });
  assert.equal(r.result.isError, true);
  child.kill();
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/mcp.test.mjs`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `mcp-server.mjs`.** Newline-delimited JSON-RPC 2.0 over stdin/stdout, **stdout reserved for protocol frames** and all logging to stderr. Implement `initialize`, `tools/list`, `tools/call`. `manage_profile` is one tool with `action: 'current'|'list'|'set'|'reset'|'default'`; `set` writes `writing-profile.json` into the project. `learn_preference` requires `consent: true`.
- [ ] **Step 4: Write `mcp.json`** with `$schema` for the 1.0.0 MCP schema and one stdio entry: `command: "node"`, `args: ["${PLUGIN_ROOT}/skills/writing-flow/scripts/mcp-server.mjs"]`, `cwd: "${PLUGIN_ROOT}"`. No `env`, no secrets.
- [ ] **Step 5: Validate `mcp.json`** against `schemas/1.0.0/mcp.schema.json` — add the assertion to `tests/manifest.test.mjs`.
- [ ] **Step 6: Run the tests to verify they pass.** Run `node --test`. Expected: PASS across all files.
- [ ] **Step 7: Commit**

```bash
git add skills/writing-flow/scripts/mcp-server.mjs mcp.json tests/mcp.test.mjs tests/manifest.test.mjs
git commit -m "feat(mcp): add the bundled stdio profile and gate server"
```

---

## Phase 5 — Installer and shims

### Task 9: `install.mjs` and shell shims

**Files:**
- Create: `install.mjs`
- Create: `install.ps1` (thin shim), `install.sh` (thin shim)
- Test: `tests/install.test.mjs`

**Interfaces:**
- Produces: `install({ home, pluginRoot, dryRun=false, targets=null }): Promise<InstallReport>`; `type InstallReport = { actions:{kind:string,target:string,detail:string}[], skipped:string[], ok:boolean }`

- [ ] **Step 1: Write the failing tests**

```js
// tests/install.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../install.mjs';

test('dry run performs no writes', async () => {
  const home = mkdtempSync(join(tmpdir(),'home '));
  const r = await install({ home, pluginRoot: '.', dryRun: true });
  assert.ok(r.actions.length > 0);
  assert.ok(r.actions.every(a => a.detail.startsWith('would ')));
});

test('is idempotent', async () => {
  const home = mkdtempSync(join(tmpdir(),'home '));
  await install({ home, pluginRoot: '.', dryRun: false });
  const r = await install({ home, pluginRoot: '.', dryRun: false });
  assert.ok(r.actions.every(a => a.kind === 'unchanged'));
});

test('never issues a bare global skills update', async () => {
  const home = mkdtempSync(join(tmpdir(),'home '));
  const r = await install({ home, pluginRoot: '.', dryRun: true });
  const cmds = JSON.stringify(r);
  assert.ok(!/skills update -g/.test(cmds));
  assert.ok(!/"-g"\]/.test(cmds));
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/install.test.mjs`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `install.mjs`.** Detect harnesses under `home`. Install declared dependencies with targeted `add … -a <agent> -s <skill> -y --copy` calls. Render the packaged skills into each root via Task 4's `renderProfile`. Write `paths.json` from Task 5. Merge the OpenCode MCP fragment and install the OpenCode command. Report every action.
- [ ] **Step 4: Write `install.ps1`** as three lines: resolve `node`, then `& node install.mjs @args`. **Write `install.sh`** as the equivalent POSIX shim. All logic stays in `install.mjs` so it is not maintained twice.
- [ ] **Step 5: Run the tests to verify they pass.** Run `node --test tests/install.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add install.mjs install.ps1 install.sh tests/install.test.mjs
git commit -m "feat(install): add the cross-platform installer and shell shims"
```

### Task 10: Generate the client shims from one source

**Files:**
- Create: `skills/writing-flow/scripts/shims.mjs`
- Create: `shims/claude-code/.claude-plugin/plugin.json` (generated)
- Create: `shims/claude-code/.mcp.json` (generated)
- Create: `shims/claude-code/commands/write.md`
- Create: `shims/opencode/mcp.opencode.json` (generated)
- Create: `shims/opencode/commands/write.md`
- Test: `tests/shims.test.mjs`

**Interfaces:**
- Produces: `generateShims({ pluginRoot, outDir, dryRun }): Promise<{files:{path:string,content:string}[]}>`

- [ ] **Step 1: Write the failing tests**

```js
// tests/shims.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateShims } from '../skills/writing-flow/scripts/shims.mjs';

test('the generated claude MCP config uses the Claude placeholder', async () => {
  const { files } = await generateShims({ pluginRoot: '.', outDir: 'shims', dryRun: true });
  const cc = files.find(f => f.path.endsWith('.mcp.json')).content;
  assert.match(cc, /\$\{CLAUDE_PLUGIN_ROOT\}/);
});

test('both MCP configs declare the same server name', async () => {
  const { files } = await generateShims({ pluginRoot: '.', outDir: 'shims', dryRun: true });
  const portable = JSON.parse(readFileSync('mcp.json','utf8')).mcpServers;
  const cc = JSON.parse(files.find(f => f.path.endsWith('.mcp.json')).content).mcpServers;
  assert.deepEqual(Object.keys(cc), Object.keys(portable));
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `node --test tests/shims.test.mjs`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `shims.mjs`.** Read `mcp.json` and rewrite `${PLUGIN_ROOT}` to `${CLAUDE_PLUGIN_ROOT}` for the Claude copy, and to a plain path form for OpenCode's fragment. **Generating both from one source removes the drift the spec guarded with a CI check** — record this in the spec's §4.8 when implementing.
- [ ] **Step 4: Add the two `commands/write.md` files** (OpenCode and Claude Code), each thin: load `adelpro-voice`, run the pipeline, run the gate, stop on failure. No style rules.
- [ ] **Step 5: Run the tests to verify they pass.** Run `node --test tests/shims.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add skills/writing-flow/scripts/shims.mjs shims tests/shims.test.mjs
git commit -m "feat(shims): generate client shims from the portable MCP config"
```

---

## Phase 6 — Migration of this machine

### Task 11: Move the contract out, retire the PowerShell gate

**Files:**
- Modify: `~/.config/opencode/skills/adelpro-voice/SKILL.md` (delete lines ~25-45)
- Modify: `~/.config/opencode/opencode-synced.jsonc` (`extraConfigPaths`)
- Modify: `~/.config/opencode/commands/write.md`
- Test: manual verification steps below

**Interfaces:**
- Consumes: the rendered package from Task 9.

- [ ] **Step 1: Back up first.** Copy `~/.config/opencode/skills/adelpro-voice/` and `house-style.json` to `%LOCALAPPDATA%\Temp\opencode\pre-migration\`.
- [ ] **Step 2: Trim `adelpro-voice` to voice only.** Delete the pipeline, loop and gate sections now owned by `skills/writing-flow/`. The skill becomes prose plus the private `writing-profile.json` and `house-style.json`.
- [ ] **Step 3: Render into OpenCode.** Run `node install.mjs` (dry run first, then for real) and confirm `~/.agents/skills/writing-flow/` exists with its `scripts/`.
- [ ] **Step 4: Verify the gate parity once more, in place.** Run `node ~/.agents/skills/writing-flow/scripts/gate.mjs <fixture>` and confirm `0 / 1 / 2`.
- [ ] **Step 5: Retire `write-gate.ps1`** only after Step 4 passes. Move it to `%LOCALAPPDATA%\Temp\opencode\pre-migration\` rather than deleting.
- [ ] **Step 6: Update `extraConfigPaths`.** `house-style.json`, `WRITING-FLOW.md` and `scripts` currently sync; repoint or drop each so no two copies of the same file sync. Run `opencode_sync status` to confirm the config still parses.
- [ ] **Step 7: Commit** the package repo; note the config-repo change for the next startup sync.

### Task 12: End-to-end verification on OpenCode

**Files:**
- Test: manual, with the fixtures from Task 6.

- [ ] **Step 1: Confirm the profile resolves.** Run `node ~/.agents/skills/writing-flow/scripts/doctor.mjs` and check it names `adelpro` as the effective profile and reports no missing skills.
- [ ] **Step 2: Confirm the server is optional.** Temporarily comment the MCP entry out of `opencode.json`, reload, and run `/write` on a short draft (Review Focus 5). Expected: the pipeline completes and the gate still runs by path.
- [ ] **Step 3: Confirm the server works.** Restore the MCP entry, pre-warm with a direct `node` launch (not `npx`), reload, and confirm the six tools appear.
- [ ] **Step 4: Confirm the ambiguity guard.** Drop a second profile into a skill root and confirm `doctor` reports the ambiguity rather than silently choosing.
- [ ] **Step 5: Record the result** in `WRITING-FLOW.md`'s update policy section.

---

## Phase 7 — The private profile package

### Task 13: Build and install the private voice package

**Files:**
- Create: `D:\benyahia-dev\adelpro-voice-profile\plugin.json`
- Create: `D:\benyahia-dev\adelpro-voice-profile\skills\adelpro-voice\{SKILL.md,writing-profile.json,house-style.json,voice-card.md}`
- Create: `D:\benyahia-dev\adelpro-voice-profile\README.md`

**Interfaces:**
- Consumes: the moved voice text and `house-style.json` from Task 11.

- [ ] **Step 1: Create the private repo** `D:\benyahia-dev\adelpro-voice-profile`, `git init`, and confirm it is **private** if it is ever pushed.
- [ ] **Step 2: Assemble the profile.** `SKILL.md` is the voice text; `writing-profile.json` sets `name: "adelpro"`, `languages: ["ar-MSA","en"]`, `arabicStages: ["fasaha","voice-recheck"]`, `requiredSkills` listing all four dependencies.
- [ ] **Step 3: Render `voice-card.md`** from the manifest and confirm it contains no unresolved placeholders.
- [ ] **Step 4: Install and verify.** Render into `~/.agents/skills/`, run `doctor`, and confirm the effective profile switches from `default` to `adelpro` (Review Focus 3 now resolves cleanly).
- [ ] **Step 5: Confirm the fallback.** Remove the rendered profile and confirm the flow falls back to `voice-default` and still passes the gate.
- [ ] **Step 6: Commit** both repos.

---

## Self-Review

**Spec coverage:** §3 → Task 1 (schemas, manifest). §4.1 → Tasks 1-10 (layout). §4.2 → Task 2. §4.3 → Tasks 3-4, 13. §4.4 → Task 3. §4.5 → Task 6. §4.6 → Task 8. §4.7 → Task 9. §4.8 → Task 10. §5 → Task 11. §6 → Tasks 12-13. §7 risks 1-3 → Tasks 10-12; risk 8 → Tasks 4, 7; risk 9 → Task 6.

**Known gaps, deliberately left to Phase 0:** the repo name and location (Task 1 Step 1) and the Python-dependency decision (spec §4.5, exercised by Task 6 Step 4's `python not found` path).

**Type consistency:** `resolveProfile` / `readManifest` (3) → `render.mjs` (4) and `gate.mjs` (6). `resolveToolPaths` (5) → `gate.mjs` (6) and `doctor.mjs` (7). `runGate` / `runDoctor` (6, 7) → `mcp-server.mjs` (8) and the OpenCode CLI path (11). `renderProfile` (4) → `install.mjs` (9), `mcp-server.mjs` (8). No name is used before it is defined.
