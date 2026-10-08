# Changelog

All notable changes to this package. Versioning follows Semantic Versioning.

## 0.1.0

Initial release.

- Agent Plugins 1.0.0 package: `plugin.json`, `skills/`, `mcp.json`.
- `writing-flow` skill: the six-stage pipeline contract, the bounded loop between the Arabic
  passes, the gate exit contract, and the profile resolution rule. Carries no voice and no
  style rules.
- `voice-default` skill: a neutral fallback profile, marked `isDefault` so it never competes
  with a real profile for resolution.
- `gate.mjs`: gates 4 and 5 in Node, replacing `write-gate.ps1`. Exit contract preserved —
  `0` clean, `1` violation, `2` tool error, with a missing tool always `2`.
- `profile.mjs`: profile manifest parsing and three-tier resolution, with same-tier ambiguity
  reported rather than silently resolved.
- `render.mjs`: renders a profile from the store into a harness skill root, generates a
  portable `voice-card.md`, and detects drift between the store and every rendered copy.
- `resolve-paths.mjs`: locates the third-party gate tools without hardcoding a path.
- `doctor.mjs`: one call reporting the effective profile, resolved tools, missing skills and
  drift.
- `mcp-server.mjs`: bundled local stdio MCP server exposing `get_profile`, `manage_profile`,
  `learn_preference`, `run_gate`, `doctor` and `render_profile`.
- `shims.mjs`: generates the Claude Code and OpenCode client configs from the single portable
  `mcp.json`.
- `install.mjs` plus `install.ps1` / `install.sh` shims: renders the skills into each harness
  root, records resolved tool paths, pulls declared dependencies with targeted installs only,
  and wires the MCP server and `/write` command into an existing OpenCode config.
