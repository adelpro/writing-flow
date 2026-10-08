# Changelog

All notable changes to this package. Versioning follows Semantic Versioning.

## 0.3.0

- **The repository is now a Claude Code plugin as well as an Agent Plugins 1.0.0 package.**
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `.mcp.json` moved to the
  repository root, and `commands/write.md` moved out of the copyable bundle. Claude Code looks
  for its manifest at the plugin root, so the previous layout could only ever be a bundle to
  copy. The files stay generated from `mcp.json` and `plugin.json`.
- Conformant Agent Plugins clients are unaffected: extra top-level directories are not
  component types and must be ignored, and `.mcp.json` is not the fixed `mcp.json` path.
- **No Cursor manifest is shipped, deliberately.** Cursor reads the Agent Plugins manifest
  already, and `.cursor-plugin/marketplace.json` is for multi-plugin repositories.
- The installed Claude plugin bundle carries no skills — they already live in
  `~/.claude/skills`, and a namespaced plugin copy would duplicate them.

## 0.2.1

- The pipeline skill now suggests a profile: when the active profile is the bundled default it
  says so **once** and moves on, and it names `generate_profile` (with the CLI fallback) as the
  way to create or import a voice. Bounded on purpose — a suggestion that repeats becomes
  nagging, and one that blocks stops the writing. Pinned by a test.

## 0.2.0

- `generate_profile`: build a profile in the standard format from existing writing — a
  `SKILL.md`, a markdown file, or a directory containing one. Reports every line it would drop
  as pipeline instruction, previews by default, and requires `confirm: true` to write.
  `includeAll` keeps every line. Exposed as a seventh MCP tool and as a CLI
  (`node skills/writing-flow/scripts/generate.mjs <source> --name <n> --out <dir>`).

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
