# writing-flow

A portable voice-writing pipeline, packaged as an [Agent Plugins](https://agent-plugins.org)
1.0.0 plugin: a skill that owns the process, a bundled MCP server that manages profiles and
runs the gates, and an installer that places it in whichever harness you use.

The voice itself is not in here. This package is the engine; a voice is a *profile* you install
separately. Without one, the bundled neutral default applies.

## Install

```sh
node install.mjs            # dry run: prints exactly what it would change
node install.mjs --apply    # make the changes
```

`install.ps1` and `install.sh` are three-line shims over the same script. Afterwards:

```sh
node skills/writing-flow/scripts/doctor.mjs
```

`doctor` names the effective profile, where each gate tool resolved, and whether any rendered
copy has drifted from the store.

## What it does

Six stages, run in order:

| Stage | Does |
|---|---|
| 0 | `purple-cow-content` — the angle and an A/B title, nothing more |
| 1 | draft in the active profile's voice |
| 2 | `fasaha` — Arabic pieces only |
| 3 | voice re-check — restore what the Arabic pass flattened |
| 4 | `avoid-ai-writing` — the anti-AI-ism pass |
| 5 | `remove-ai-marks` — provenance marks |

Stages 4 and 5 are checked by the gate, which exits `0` clean, `1` violation, `2` tool error.
A missing tool is always `2`, never a silent pass.

## Layout

```
plugin.json                      Agent Plugins 1.0.0 manifest
mcp.json                         the bundled stdio MCP server (single source of truth)
commands/write.md                the /write command (Claude Code + OpenCode)
.claude-plugin/                  Claude Code manifest and marketplace (generated)
.mcp.json                        Claude Code MCP config (generated)
skills/writing-flow/SKILL.md     the pipeline contract (no voice, no style rules)
skills/writing-flow/scripts/     the engine: gate, profile, render, doctor, MCP server
skills/voice-default/            the neutral fallback profile
install.mjs                      the installer (+ .ps1 / .sh shims)
shims/opencode/                  generated OpenCode fragment
```

**One repo, three client surfaces.** The root is an Agent Plugins package for Codex, Cursor,
Copilot/VS Code and Kiro; `.claude-plugin/` makes it a Claude Code plugin and marketplace; and
`mcp.json` gives every MCP client the server. The Claude files are generated, never
hand-maintained — `shims.mjs` writes them all from `mcp.json` and `plugin.json`.

### Claude Code

```
/plugin marketplace add adelpro/writing-flow
/plugin install writing-flow@writing-flow
```

Or, from a clone: `node install.mjs --apply` writes the bundle to
`~/.claude/plugins/writing-flow/`.

**One rule matters when editing:** the engine lives inside `skills/writing-flow/scripts/`
because the skills CLI copies skill directories flat. Anything the skill needs at run time must
be inside its own directory.

## Making a profile

A profile is a skill directory containing `writing-profile.json`:

```json
{
  "kind": "voice",
  "name": "myvoice",
  "version": "1.0.0",
  "languages": ["en"],
  "houseStyle": "./house-style.json",
  "arabicStages": ["fasaha", "voice-recheck"],
  "requiredSkills": ["fasaha", "avoid-ai-writing", "remove-ai-marks"]
}
```

`SKILL.md` holds the voice prose, `house-style.json` the mechanical rules the gate enforces.
Installing that profile takes over the voice with no change to this package; removing it falls
back to the default.

### Generating one from writing you already have

You do not have to author the files by hand:

```sh
node skills/writing-flow/scripts/generate.mjs ./my-writing.md --name myvoice --out ~/.agents/skills/myvoice
```

It reads a markdown file, a `SKILL.md`, or a directory containing one, and reports every line
it would drop as *pipeline* instruction rather than voice. Nothing is written until you add
`--apply`. Read the dropped lines before you do — a bad split is how a voice gets mangled.

Over MCP, the same thing is `generate_profile`, which previews by default and needs
`confirm: true` to write.

**It is suggested, not triggered.** If the active profile is the bundled default, the pipeline
skill mentions once that a personal profile can be generated — then continues with the default.
It never blocks the writing, and it never repeats.

## Tests

```sh
node --test
```

No runtime dependencies. Tests that need the third-party gate tools skip cleanly when those
tools are absent.

## Not in scope

The gate checks **mechanics** — abbreviation placement, quote style, invisible Unicode. It does
not measure whether text sounds like the intended voice, and nothing here should be read as
claiming that.
