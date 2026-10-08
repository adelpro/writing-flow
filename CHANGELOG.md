# Changelog

All notable changes to this package. Versioning follows Semantic Versioning.

## 0.8.0

- **CI.** GitHub Actions: a fast hermetic job across ubuntu node 22/24 and windows node 22, plus an integration job that installs the four dependency skills so the gate is exercised against the real upstream tools. That job asserts the gate tests did not silently skip - the suite passes vacuously without the tools, which is exactly the failure a green badge would hide.
- **Claude marketplace source pinned to the repository.** Was `source: ./ ` - permitted but undocumented. Now a github source derived from plugin.json's repository, so it cannot drift from the manifest.
- Node floor raised to 22: 18 and 20 are end-of-life.
- README gains per-harness instructions, including the honest note that the skills are the piece to take if a client can only take one.

## 0.7.0

- **Two gaps closed that would have made the profile advisory rather than applied.** The
  pipeline skill never told the agent to *read* the resolved profile - it said which one won and
  left it there, so a profile could be resolved and then ignored. It now instructs reading the
  profiles SKILL.md and applying it.
- **Learned preferences were write-only.** `learn_preference` appended to
  `learned-preferences.json` and nothing ever read it. `get_profile` now returns
  `learnedPreferences`, and the skill instructs applying them and never re-litigating a recorded
  one.
- Added ROADMAP.md: the memory plan, the release process, the known gaps in priority order, and
  the parked hosted-service decisions.
- README and the internal plan sanitised of machine-specific paths.

## 0.6.1

- The README's install section is now **agent-executable**, because pasting the repo link and
  asking an agent to install it is a primary path. It states the prerequisites (Node 18+,
  network, Python 3), the dry run, and â€” the step that was missing â€” **the harness reload**,
  without which the MCP server is registered but invisible.
- It also records what the installer deliberately does not do: create a profile, touch a harness
  it cannot find, or remove anything. The last one matters: the installer copies but never
  prunes, so a renamed command leaves a stale copy behind.

## 0.6.0

- **Commands renamed: `/write` â†’ `/flow-writing`, `/doctor` â†’ `/flow-doctor`.** The filename is
  the command name, and in OpenCode's flat namespace a bare `/doctor` collides with unrelated
  tooling (the `react-doctor` skill already claims that trigger). The `flow-` prefix is what
  keeps the pair unambiguous.
- In Claude Code the plugin name is prefixed, so they read `/writing-flow:flow-writing` and
  `/writing-flow:flow-doctor` â€” redundant there, correct in a flat namespace.
- The MCP prompts keep their unprefixed names (`write`, `doctor`): clients namespace prompts
  themselves, so a prefix there would double.

## 0.5.0

- **`commands/doctor.md`.** The diagnostic entry point now exists as a native command alongside
  `write`, mirroring the MCP `doctor` prompt for clients that do not surface prompts.
- The installer copies **every** file in `commands/` rather than a hardcoded `write.md`, to both
  `~/.config/opencode/commands/` and the Claude plugin bundle. Adding a command no longer needs
  an installer edit.
- The README now documents which clients read `commands/` (Claude Code and Cursor do; OpenCode
  does not) and gives the exact steps to install the OpenCode commands by hand. It also records
  that the same files are `/write` in OpenCode and `/writing-flow:write` in Claude Code.

## 0.4.0

- **MCP prompts: `write` and `doctor`.** The server now declares the `prompts` capability and
  answers `prompts/list` and `prompts/get`. A prompt is user-invoked, which is the MCP
  counterpart of a slash command and the only portable one â€” `commands/*.md` reaches Claude
  Code and Cursor, a prompt reaches any client that surfaces prompts.
- `write` takes a required `request`, and unlike a static file it is **computed**: it names the
  profile active at the moment it is served, with the voice path, house-style path, languages
  and required skills, plus the gate command and exit contract.
- `doctor` asks for the setup to be diagnosed in plain language, with the exact fixing command.
- An unknown prompt or a missing required argument is `-32602`, not a crash.

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
- The installed Claude plugin bundle carries no skills â€” they already live in
  `~/.claude/skills`, and a namespaced plugin copy would duplicate them.

## 0.2.1

- The pipeline skill now suggests a profile: when the active profile is the bundled default it
  says so **once** and moves on, and it names `generate_profile` (with the CLI fallback) as the
  way to create or import a voice. Bounded on purpose â€” a suggestion that repeats becomes
  nagging, and one that blocks stops the writing. Pinned by a test.

## 0.2.0

- `generate_profile`: build a profile in the standard format from existing writing â€” a
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
- `gate.mjs`: gates 4 and 5 in Node, replacing `write-gate.ps1`. Exit contract preserved â€”
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
