# writing-flow — repository guide

A portable voice-writing pipeline, packaged as an Agent Plugins 1.0.0 package. One repository
serves every client: it carries a pipeline skill, a bundled default voice profile, two commands
and one MCP server.

## Source vs generated

**Authored — edit these:**

- `plugin.json` — Agent Plugins manifest (closed schema; only standard fields).
- `mcp.json` — the single portable MCP definition. Every client config is derived from it.
- `skills/writing-flow/` — the pipeline skill and the engine (`scripts/*.mjs`). The engine must
  live here: the skills CLI copies skill directories out of the package, so anything needed at
  run time has to travel inside `skills/writing-flow/`.
- `skills/voice-default/` — the bundled default profile.
- `commands/` — the `/flow-*` commands, read by the Claude Code plugin and copied by the installer.
- `opencode/index.mjs` — the OpenCode plugin. It registers the skills, MCP server and commands
  itself, and reads the files above at setup.
- `bin/install.mjs` — the installer. `bin/install.ps1` and `bin/install.sh` are three-line shims
  that call it, so the logic is not maintained twice.
- `tests/`, `README.md`, `CHANGELOG.md`, `docs/ROADMAP.md`.

**Generated — do not hand-edit; run `npm run build`:**

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — Claude Code manifest.
- `.mcp.json` — Claude Code MCP config.

The generator is `skills/writing-flow/scripts/shims.mjs`; a test fails if the committed copies
drift from it.

OpenCode has no generated file: the package plugin (`opencode/index.mjs`) registers the MCP
server itself, so the installer merges nothing into the user's OpenCode config but the plugin
name.

## Commands

- `npm test` — the whole suite (`node --test`).
- `npm run build` — regenerate the client shims after editing `plugin.json` or `mcp.json`.
- `npm run doctor` — report the effective profile, resolved gate tools and any drift.
- `node bin/install.mjs` (dry run) · `node bin/install.mjs --apply` — install into the harnesses
  found on this machine.
- `npx -y @adelpro/writing-flow --apply` — the same install without a clone (npm path).

## Clients

| Client | How it loads | One command |
|---|---|---|
| Claude Code | the marketplace plugin, declared in `~/.claude/settings.json` | `/plugin marketplace add adelpro/writing-flow` |
| OpenCode | the package plugin, from `plugins` in `opencode.json(c)` | `opencode plugin add @adelpro/writing-flow -g` |
| Agent Plugins clients (Cursor, Copilot/VS Code, Codex) | `plugin.json` + `skills/` + `mcp.json`, loaded as the package directory | load the directory |
| Any Agent Skills client | `skills/`, installed by the skills CLI | `npx -y skills@latest add adelpro/writing-flow -g -a <agent> -s writing-flow -s voice-default -y --copy` |

`bin/install.mjs` wires the first, second and fourth of those natively and never hand-copies
what a harness can fetch itself.

## Notes

- Node 22+ only. No runtime dependencies.
- The five entries the standards fix in place — `plugin.json`, `mcp.json`, `skills/`,
  `.claude-plugin/`, `.mcp.json` — cannot move without breaking a client. Everything else is free.
- No planning or spec documents are tracked. `docs/superpowers/` is gitignored; `docs/` holds
  package documentation only.
