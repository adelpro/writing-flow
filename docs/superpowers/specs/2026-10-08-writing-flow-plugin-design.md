# Writing Flow Plugin — Design

**Date:** 2026-10-08
**Status:** Draft for review
**Package format:** Agent Plugins 1.0.0 (`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`)

---

## 1. Goal

One portable package that carries the voice-writing pipeline, so it installs into any
compatible agent client, on any OS, with the personal voice kept as a **separate private
profile package** that layers on top.

### Success criteria

1. A conformant Agent Plugins client loads the package directory with no shim and no
   per-client editing.
2. OpenCode V2 — not yet conformant — receives the same skills, gate and `/write` command
   through one installer run.
3. Installing a private profile package afterwards takes over the voice with **no change to
   the engine**.
4. Uninstalling the profile leaves a working, generic flow.
5. The gate runs on Windows, macOS and Linux with Node alone.
6. Nothing about the personal voice, or any client secret, exists in the public package.

### Non-goals

- Not a registry, marketplace or distribution mechanism. Agent Plugins v1 defines none.
- Not vendoring `avoid-ai-writing` or `remove-ai-marks`; they are declared and installed by
  the installer.
- Not standardising slash commands, hooks or subagents — v1 makes exactly two component
  types portable, and commands are not one of them.
- Not re-authoring the voice. The voice text moves; it does not change.

---

## 2. Verified starting state

Audited on this machine, 2026-10-08.

| Piece | Location now | Owner | Note |
|---|---|---|---|
| Pipeline contract (stages, loop, gate) | `~/.config/opencode/skills/adelpro-voice/SKILL.md`, lines ~25-45 | yours, private repo | must move out |
| Voice text | same file, remainder | yours, private repo | stays private |
| `house-style.json` | `~/.config/opencode/house-style.json` | yours | must move into the profile |
| `write-gate.ps1` | `~/.config/opencode/scripts/` | yours | PowerShell 5.1, Windows-only, hardcoded paths |
| `WRITING-FLOW.md` | `~/.config/opencode/` | yours | the v2 management plan |
| `/write` command | `~/.config/opencode/commands/write.md` | yours | thin: skill + gates + stop conditions |
| `fasaha` 1.2.0 | `~/.config/opencode/skills/` | yours, public | hand-curated, not CLI-managed |
| `purple-cow-content` 3.0.1 | `~/.agents/skills/` | yours, public | CLI-managed |
| `avoid-ai-writing` 3.37.0 | `~/.agents/skills/` | third-party, MIT | 7-skill suite; `scripts/check-style.js` is gate 4 |
| `remove-ai-marks` | `~/.agents/skills/` + `~/.hermes/skills/` | third-party | `scripts/inspect_text.py` is gate 5 |

Verified working today: clean draft → gate exit 0; `e.g.` outside parens → exit 1
(`latin-abbrev-outside-parens`); missing file → exit 2.

### Constraints carried from `WRITING-FLOW.md` v2

- The three own-repos are the source of truth for their content; no skill is packed into
  another.
- Gate exit codes are the contract: `0` clean, `1` violation, `2` tool error.
- Never run `npx skills update -g`.
- Never add files to `avoid-ai-writing/examples/`.

---

## 3. Fact base: Agent Plugins 1.0.0

Published 2026-08-06 by a TSC with core maintainers from Amazon, Cursor, Microsoft, OpenAI
and Vercel; Google has since joined.

**Portable package:**

```
<plugin>/
├── plugin.json      # required manifest, closed schema
├── skills/          # immediate children containing SKILL.md
└── mcp.json         # optional, MCP servers
```

**Rules that shape this design:**

1. `plugin.json` is a **closed** schema. Permitted top-level fields: `$schema`, `name`,
   `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`,
   `extensions`. Nothing else — no `commands`, no `mcpServers`.
2. Component locations are fixed. A missing `skills/` or `mcp.json` is **not an error**.
3. Failures are isolated. A skill that fails to load is skipped; an MCP server that fails to
   start does not disable the skills. This is what makes the MCP gate safe to ship.
4. `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` expand in `args`, `env` values and `cwd` only — not
   in `command`. `command` is one executable token, bare or `./`-relative.
5. `name` must be lowercase alphanumeric with `.` and `-`, 1-64 chars, no `--` or `..`.
6. v1 defines **no install or distribution mechanism**. Arrival is always client-specific.

**Client support, as of the standard's first months:**

| Client | Reads the standard layout | Consequence |
|---|---|---|
| Codex / ChatGPT | yes (Codex 0.147.0+) | load as-is |
| Cursor 3.x | yes | load as-is |
| VS Code / GitHub Copilot | yes (GA 2026-08-12) | load as-is |
| Kiro, Google Agents CLI, Data Agent Kit | yes | load as-is |
| **Claude Code 2.1.x** | **no** — a root-only `plugin.json` is a hard error | needs `.claude-plugin/plugin.json` + `.mcp.json` |
| **OpenCode V2** | **no** — `anomalyco/opencode#40993` open | skills reachable via `skills.paths`; `mcp.json` ignored |

Two traps recorded from published field reports:

- Claude Code expands `${CLAUDE_PLUGIN_ROOT}`, not `${PLUGIN_ROOT}`. A single shared MCP
  config leaves the path unexpanded, the process exits, and the failure appears only as a
  connection error at session start. Two MCP config files are required, with a check that
  they agree.
- A root `plugin.json` **without** the Agent Plugins `$schema` is read by VS Code as the
  Copilot format. The `$schema` field is not optional bookkeeping; it is what selects the
  interpretation.

### 3.1 Reference implementation: Idiolect AI

`Moshpit-Labs/idiolect-mcp` + `idiolect-plugin` ship this exact architecture in production and
were used as the design reference:

- Two artifacts: a standalone MCP server (`idiolect-mcp`), and a **plugin that bundles a
  self-contained `server.mjs`** plus an auto-triggering skill and four slash commands. No npm
  install for plugin users.
- The skill "triggers automatically whenever the agent drafts prose" and calls the tool. A
  skill that *directs* a tool call is a proven mechanism, not a theory.
- `manage_profile(action: …)` — one tool with an action enum, covering read, change, template,
  preferences and contributions. Not six tools.
- `learn_writing_style(kind, text, consent, basis, scope)` — accumulates durable facts about
  the user's writing. `consent` is a first-class parameter, and stored evidence is never
  returned by a tool.
- Progressive evidence: a write returns `status: waiting for approved writing evidence` plus
  `neededWriting` (the precise shortfall), so only the missing evidence is collected, with
  permission, then the same task is retried.
- The **Voice Card** — a rendered, self-contained style guide that escapes the server and
  works in clients with no MCP at all. Adopted here as `render_profile`.
- `score_voice` / LUAR, a validated voice-fidelity metric. **We have no analogue and must not
  pretend to** (§4.5).

Divergence: Idiolect is a hosted service, so the *server* is its system of record. We have no
service, so the store is a git repo and the server stays stateless (§4.3).

---

## 4. Architecture

### 4.1 Package layout

```
writing-flow/
├── plugin.json                  # Agent Plugins 1.0.0 manifest
├── skills/
│   ├── writing-flow/            # the pipeline contract (portable payload)
│   │   ├── SKILL.md
│   │   └── scripts/             # the engine lives HERE, not at the plugin root
│   │       ├── gate.mjs         # engine core: importable module + CLI
│   │       ├── mcp-server.mjs   # thin MCP wrapper over gate.mjs
│   │       └── resolve-paths.mjs
│   └── voice-default/           # neutral default profile
│       ├── SKILL.md
│       ├── writing-profile.json # the profile manifest / marker
│       ├── house-style.json
│       └── voice-card.md        # rendered, portable
├── mcp.json                     # the gate as a stdio MCP server
├── install.ps1
├── install.sh
├── shims/                       # ignored by conformant clients
│   ├── claude-code/
│   │   ├── .claude-plugin/plugin.json
│   │   ├── .mcp.json
│   │   └── commands/write.md
│   └── opencode/
│       ├── mcp.opencode.json    # fragment merged into opencode.json
│       └── commands/write.md
├── schemas/                     # vendored 1.0.0 schemas, for offline validation
├── CHANGELOG.md
└── LICENSE
```

**The engine lives inside the skill directory, and this is not cosmetic.** The skills CLI
copies skills *out* of a plugin into a flat agent directory (`~/.agents/skills/writing-flow/`,
`~/.claude/skills/writing-flow/`). Anything the skill needs at run time must therefore be
**inside the skill directory**, or it will not exist after that install path. Plugin-root
`scripts/` works only for clients that load the package as a package. So `gate.mjs` sits in
`skills/writing-flow/scripts/`, and the skill refers to it by its own base directory.

`shims/` is deliberately **not** a reverse-domain name, so no client interprets it. Extra
files and directories are permitted by the standard; only the manifest schema and the two
fixed locations are constrained.

### 4.2 The pipeline skill — `skills/writing-flow/`

Owns, and only owns, the composition:

- The six stages: `0` purple-cow angle + A/B title → `1` draft in voice → `2` fasaha
  (Arabic only) → `3` voice re-check (Arabic only) → `4` avoid-ai-writing → `5`
  remove-ai-marks.
- The bounded loop: one `fasaha` pass, one voice re-check, then stop and report residual.
- The gate contract: `0` clean, `1` violation, `2` tool error; never deliver silently past a
  failure.
- The profile resolution rule (§4.3).
- The instruction to invoke the gate as `node <this skill's base dir>/scripts/gate.mjs <file>`,
  using the skill's own base directory as reported by whichever harness loaded it.

It contains **no voice text and no style rules**. Those belong to the profile.

This is a move, not a rewrite: the text comes from `adelpro-voice` lines ~25-45, which are
deleted from that skill in the same change.

### 4.3 The profile store, and the render step

**The store is authoritative.** A profile is authored once, in a profile package — a private
git repo for the voice, and this package for the default. One profile is:

```
adelpro-voice/
├── SKILL.md               # the voice prose — what the agent reads
├── writing-profile.json   # machine-readable manifest
├── house-style.json       # mechanics for the gate
└── voice-card.md          # rendered, self-contained, portable
```

`writing-profile.json`:

```json
{
  "kind": "voice",
  "name": "adelpro",
  "version": "1.0.0",
  "languages": ["ar-MSA", "en"],
  "houseStyle": "./house-style.json",
  "arabicStages": ["fasaha", "voice-recheck"],
  "requiredSkills": ["fasaha", "purple-cow-content", "avoid-ai-writing", "remove-ai-marks"]
}
```

`requiredSkills` is what makes `doctor` possible: the profile declares its own dependencies, so
a missing one is a diagnosable condition rather than a mystery failure.

**`render_profile` materialises the store into a harness.** It writes the skill directory into
the target skill root (junction where the platform supports it) and emits `voice-card.md` — one
self-contained document for clients with neither MCP nor Agent Plugins support. The store is
edited; the rendered copies are outputs. This is the Idiolect Voice Card pattern (§3.1).

**Resolution order** at run time, identical in the pipeline skill and in the gate:

1. `writing-profile.json` in the working project — an explicit per-project override.
2. An installed (rendered) profile skill containing `writing-profile.json` with
   `"kind": "voice"`.
3. The bundled `skills/voice-default/`.

**Why a store rather than server state.** Idiolect can keep profiles server-side because it is
a hosted service. We have none, so the store is a git repo: versioned, reviewable, backed up,
and a natural private/public boundary. The server holds a view and writes back to files; it
never holds the truth.

**Why a marker file rather than a frontmatter key.** Frontmatter is owned by the Agent Skills
specification; adding unknown keys risks a conformant client rejecting the skill. A file
inside the skill directory cannot. It also survives renaming the skill, so the profile can be
called anything.

**Why not a fixed filename.** Naming the skill `adelpro-voice` and looking for that name
couples the engine to one person's naming. The marker decouples them.

**Drift is now a real failure mode.** Rendered copies can go stale against the store, and
nothing about a copy announces that it is old. `doctor` therefore must compare the store
against every rendered copy and report divergence. This is why `doctor` is not optional.

Installing the private profile changes the voice; removing it falls back to `voice-default`.

### 4.4 The default profile — `skills/voice-default/`

A neutral, plain-professional voice with conservative mechanics, so the package is useful
standalone and doubles as the template for a private profile. It is explicitly generic —
not a placeholder that pretends to be a person.

### 4.5 The gate — `scripts/gate.mjs`

The deterministic core, rewritten from PowerShell to Node ESM so it runs anywhere Node 18+
does.

- **Inputs:** a draft path; the resolved profile's `house-style.json`; the third-party tool
  paths.
- **Behaviour:** runs gate 4 (`avoid-ai-writing/scripts/check-style.js` via Node) and gate 5
  (`remove-ai-marks/scripts/inspect_text.py` via Python), accumulates, prints one line per
  gate, exits with the worst code.
- **Exit contract preserved:** `0` clean, `1` violation, `2` tool error. A missing tool is
  `2` with a named cause, never a silent pass.
- **Path resolution** (`resolve-paths.mjs`): search the known skill roots for
  `avoid-ai-writing/scripts/check-style.js` and `remove-ai-marks/scripts/inspect_text.py`;
  prefer a `paths.json` written by the installer, which records what it actually installed.
  Never hardcode an absolute path.
- **Importable:** `gate.mjs` exports `runGate({ path, profile, cwd })` returning a structured
  result, so the MCP server is a thin adapter rather than a second implementation.
- **Locale-independent:** the gate emits stable machine-readable lines so its output does not
  depend on the host's console encoding.

**What the gate is not.** It checks mechanics — abbreviation placement, quote style, heading
case, invisible Unicode. It does **not** measure whether text sounds like the profile's voice.
Idiolect does that with `score_voice` and a trained metric over a corpus; we have neither.
Nothing in this package may present a gate pass as a voice-fidelity claim, and no tool is
named or described as if it scores voice.

**Open decision — Python dependency.** Gate 5 currently requires Python. Options: (a) delegate
to the authoritative `inspect_text.py` and report `2` when Python is absent; (b) add a Node
fallback implementing the same Layer A codepoint scan, used only when Python is missing, and
labelled as such. Recommendation: (a) first, since it keeps one authority for the check, with
(b) added only if field use shows Python-free machines matter.

### 4.6 The MCP server — `mcp.json` + `scripts/mcp-server.mjs`

A stdio server, launched as `node ${PLUGIN_ROOT}/skills/writing-flow/scripts/mcp-server.mjs`.
**Bundled, never `npx`** — a downloaded package would reintroduce the cold-start timeout
already recorded on this machine, and the plugin should need no install step of its own.

Tool surface — deliberately small, following Idiolect's one-tool-with-an-action-enum pattern:

| Tool | Kind | Purpose |
|---|---|---|
| `manage_profile` | read + write | One entry point, discriminated by `action`: `current`, `list`, `set`, `reset`, `default`. `set` writes the project override; it does not hold process state. |
| `get_profile` | read | The effective profile, its `house-style.json` path, `languages`, and **which rule resolved it**. Cheap and optional — never a required pre-flight. |
| `learn_preference` | write | Appends a durable fact about how the user writes. Requires `consent: true`; one entry per genuinely new preference. Feeds `fasaha`'s `llm-failure-log.md` pattern. |
| `run_gate` | read | The structured result from `gate.mjs`. Console output must match the CLI exactly. |
| `doctor` | read | Where each `requiredSkill` actually resolved, which are missing, whether the store and every rendered copy agree, and which profile is effective. |
| `render_profile` | write | Materialises a profile from the store into a target harness root, plus `voice-card.md`. Preview-then-write. |

Design rules:

- **Stateless.** No tool holds authoritative state; every mutation is a file write. A restart
  loses nothing because nothing was held.
- **Read-only by default.** Only `manage_profile(set)`, `learn_preference` and `render_profile`
  write, and each returns a diff of what it changed.
- **Consent is a parameter, not a convention.** Any tool that reads or stores the user's own
  writing requires explicit consent (§3.1).
- **The skill never requires a tool.** The pipeline must run with no server configured; the
  gate stays runnable as `node …/gate.mjs`. Agent Plugins isolates component failures, but only
  if the skill's wording respects that.

Ship the server **after** the gate works, but **before** the client shims: OpenCode speaks MCP
today even though it does not support Agent Plugins, so the server is the fastest route to
giving the primary harness profile tools.

`mcp.json` carries no secrets. Per the standard, `headers` and `env` are visible package data.

### 4.7 The installer — `install.ps1` / `install.sh`

One command per machine. Responsibilities:

1. Resolve the harnesses present (`~/.config/opencode`, `~/.claude`, `~/.agents`, others).
2. Install declared dependencies with targeted calls —
   `npx -y skills@latest add <repo> -g -a <agent> -s <skill> -y --copy` — for `fasaha`,
   `purple-cow-content`, `avoid-ai-writing`, `remove-ai-marks`. Never `-g` alone, never a
   global update.
3. Place the portable skills where each harness reads them (OpenCode: `~/.agents/skills`;
   Claude Code: `~/.claude/skills`), preferring junctions over copies where supported.
4. Write `paths.json` recording the resolved third-party tool paths — into the installed
   skill directory, and into `${PLUGIN_DATA}` when the client supplies it. `resolve-paths.mjs`
   checks both, then falls back to searching the known roots.
5. For OpenCode: merge `shims/opencode/mcp.opencode.json` into `opencode.json` and install
   `commands/write.md`.
6. For Claude Code: install the `shims/claude-code/` files.
7. Be idempotent, and report exactly what it changed.

The installer is run from a **checkout or fetch of the package**, never from an installed
skill — the skills CLI copies only skill directories, so `install.ps1` does not travel with
them. Where a client loads the package as a package, the installer's job for that client
collapses to "nothing to do".

Known hazard, already in `WRITING-FLOW.md`: `npx hyperframes skills update` re-materialises
real directories over junctions. The installer documents that and is safe to re-run.

### 4.8 Client shims

- `shims/claude-code/` — `.claude-plugin/plugin.json`, a `.mcp.json` using
  `${CLAUDE_PLUGIN_ROOT}`, and `commands/write.md`.
- `shims/opencode/` — an MCP config fragment and `commands/write.md`.

A CI check asserts that `mcp.json` and `.mcp.json` declare the same server names, commands
and arguments, so the two configs cannot drift.

---

## 5. Migration of this machine

Ordered so the flow never breaks mid-migration:

1. Author the package and verify the gate there.
2. Trim `adelpro-voice` to voice only; move the pipeline text into `skills/writing-flow/`.
3. Move `house-style.json` into the private profile package; add `writing-profile.json`, then
   render the package into the OpenCode skill root.
4. Switch `~/.config/opencode/commands/write.md` to the installer-generated version.
5. Retire `write-gate.ps1` once `gate.mjs` is verified against the same fixtures.
6. Update `opencode-synced.jsonc`: `extraConfigPaths` currently lists `house-style.json`,
   `WRITING-FLOW.md` and `scripts`. Repoint or drop each.
7. Re-verify the whole flow with the existing fixtures — clean, bad, BOM.

## 6. Testing and verification

| What | How |
|---|---|
| Gate exit codes | clean `/` `e.g.` outside parens `/` missing file → `0 / 1 / 2` |
| BOM handling | a BOM-authored draft reports `U+FEFF`, not a crash |
| Profile resolution | bundled default; then with the private profile installed; then with a project override |
| Store vs render | `doctor` reports agreement; then introduce a divergence and confirm it is caught |
| `render_profile` | idempotent; a second run changes nothing; `voice-card.md` is self-contained |
| Manifest validity | validate against the vendored `1.0.0` schema offline |
| Conformant client | load the directory in one conformant client (Cursor or VS Code) |
| OpenCode | run the installer, confirm skills, gate and `/write` all work |
| Claude Code | `claude plugin validate`, then confirm the MCP server connects (the trap in §3) |
| MCP server | `run_gate` returns the same codes as the CLI; `manage_profile(set)` writes the override file and survives a restart |
| Skill without the server | the pipeline completes with no MCP configured |
| Cross-OS | at least one non-Windows run of the gate |

## 7. Risks and open questions

1. **OpenCode is the primary harness and does not support the standard.** The installer is
   therefore load-bearing, not a convenience. If `#40993` lands, the installer step for
   OpenCode reduces to "point at the directory".
2. **The standard is two months old; 1.1.0 is a draft.** Mitigation: pin to 1.0.0, keep the
   portable core free of anything client-specific, and keep shims separate so a spec change
   touches one directory.
3. **Claude Code's silent MCP failure.** Mitigated by two configs plus the CI equality check.
4. **Python dependency for gate 5.** See §4.5.
5. **`/write` is not portable.** It exists as the OpenCode command and the Claude Code
   command; other clients rely on the pipeline skill's own triggers. Accepted, not solved.
6. **Where the repo lives and what it is called.** Currently proposed as `writing-flow`. Not
   yet decided.
7. **Whether to claim a reverse-domain namespace.** Neither OpenCode nor the pack owns one
   yet, so shims live in a plain `shims/` directory. To be revisited when OpenCode defines
   its namespace.
8. **Render drift.** Once the store and rendered copies exist, they can disagree silently.
   Mitigated by making `doctor` the check and by rendering from the store rather than editing
   copies by hand.
9. **The gate cannot be sold as voice fidelity.** Recorded in §4.5 as a rule, because the
   temptation to imply it will grow with the tools.

## 8. Workstreams

The implementation plan will expand these into ordered, verifiable tasks.

- **A. Package skeleton** — manifest, layout, vendored schemas, validation.
- **B. Pipeline skill** — move the contract out of `adelpro-voice`; delete it there.
- **C. Profile store and render** — `writing-profile.json` manifest, resolution order,
  `render_profile`, `voice-card.md`, `voice-default`.
- **D. Gate** — `gate.mjs` + `resolve-paths.mjs`, fixture-verified parity with `write-gate.ps1`.
- **E. MCP server** — `mcp-server.mjs` and `mcp.json`; the six tools; parity with the CLI.
  Placed before the shims because OpenCode speaks MCP today.
- **F. Installer** — dependency pulls, harness placement, `paths.json`, idempotency.
- **G. Shims** — Claude Code and OpenCode, plus the mcp-config equality check.
- **H. Migration** — trim `adelpro-voice`, move `house-style.json`, retire the PowerShell gate,
  update `extraConfigPaths`, render, end-to-end re-verification.
- **I. Private profile package** — the same shape, built from the moved voice.
