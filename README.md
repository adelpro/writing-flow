# writing-flow

A portable voice-writing pipeline, packaged as an [Agent Plugins](https://agent-plugins.org)
1.0.0 plugin: a skill that owns the process, a bundled MCP server that manages profiles and
runs the gates, and an installer that places it in whichever harness you use.

The voice itself is not in here. This package is the engine; a voice is a *profile* you install
separately. Without one, the bundled neutral default applies.

## Install

**Prerequisites:** Node 22+ on `PATH` (18 and 20 are end-of-life); network access for the four
dependency skills; Python 3 for the provenance gate (without it the gate exits `2` with a named
cause, never silently).

One command, no clone:

```sh
npx -y @adelpro/writing-flow --apply
```

Or from a clone:

```sh
git clone https://github.com/adelpro/writing-flow
cd writing-flow
node bin/install.mjs            # dry run: prints exactly what it would change, writes nothing
node bin/install.mjs --apply    # make the changes
```

**Then reload your harness.** The installer registers the MCP server in your config, but a
harness reads that config at startup — until you reload, the tools, prompts and commands do not
exist yet. In OpenCode that is `opencode-cli reload`; in Claude Code, restart the session.

Finally, confirm:

```sh
npm run doctor          # or: node skills/writing-flow/scripts/doctor.mjs
```

`doctor` names the effective profile, where each gate tool resolved, and whether any rendered
copy has drifted from the store.

### For an agent asked to install this

Do the four steps above in order. Do not skip the dry run, and **do not skip the reload** — the
install is not finished until the harness can see the server.

The install does these things, so you do not have to:

- renders the skills into each harness root it finds;
- merges the MCP server into `opencode.json` / `opencode.jsonc`, and writes the Claude plugin
  bundle when `~/.claude` exists;
- copies every native command into the OpenCode commands directory and the Claude bundle;
- records the resolved tool paths in `paths.json` so later runs need not guess;
- pulls the four dependency skills with targeted installs.

And it deliberately does **not**:

- **create a profile.** Without one the bundled neutral default applies. The pipeline skill
  mentions once, on the first writing task rather than now, that a profile can be generated from
  writing you already have;
- **touch a harness it cannot find.** It only writes to `~/.config/opencode` and `~/.claude` when
  those directories already exist;
- **remove anything.** It copies; it never prunes. If a command or skill was renamed upstream, a
  stale copy stays behind and you should delete it yourself.

If a dependency pull fails, that upstream repository has probably moved. Install that one skill
by hand and re-run:

```sh
npx -y skills@latest add <owner>/<repo> -g -a <agent> -s <skill> -y --copy
```

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
plugin.json                      Agent Plugins 1.0.0 manifest (source)
mcp.json                         the bundled stdio MCP server (single source of truth)
package.json                     npm metadata, the `writing-flow` bin, and scripts
commands/                        the native commands: flow-writing, flow-doctor
bin/install.mjs                  the installer (+ .ps1 / .sh shims)
skills/writing-flow/SKILL.md     the pipeline contract (no voice, no style rules)
skills/writing-flow/scripts/     the engine: gate, profile, render, doctor, MCP server
skills/voice-default/            the neutral fallback profile
docs/                            ROADMAP only — no planning documents are tracked
.mcp.json                        Claude Code MCP config (generated)
.claude-plugin/                  Claude Code manifest and marketplace (generated)
shims/opencode/                  generated OpenCode fragment
```

`AGENTS.md` carries the full source-vs-generated map. Anything generated is regenerated with
`npm run build`; the committed copies are marked so in `.gitattributes`, and a test fails if they
drift from `mcp.json` and `plugin.json`.

**One repo, three client surfaces.** The root is an Agent Plugins package for Codex, Cursor,
Copilot/VS Code and Kiro; `.claude-plugin/` makes it a Claude Code plugin and marketplace; and
`mcp.json` gives every MCP client the server. The Claude files are generated, never
hand-maintained — `shims.mjs` writes them all from `mcp.json` and `plugin.json`.

### Claude Code

```
/plugin marketplace add adelpro/writing-flow
/plugin install writing-flow@writing-flow
```

Or, from a clone: `node bin/install.mjs --apply` writes the bundle to
`~/.claude/plugins/writing-flow/`.

### Prompts (any MCP client)

The server also exposes two MCP **prompts** — the user-invoked counterpart of a slash command,
and the only portable one:

| Prompt | Argument | What it does |
|---|---|---|
| `write` | `request` (required) | Runs the whole flow, carrying the profile that is active at the moment it is served |
| `doctor` | — | Asks for the setup to be diagnosed in plain language, with the fixing command |

A prompt is **computed at request time**, which a static command file cannot do: it names
the profile actually in play rather than leaving the agent to discover it. Where a client does
not surface prompts, `commands/` and the skill's own triggers remain the entry points — prompts
are protocol-portable, but no client is obliged to show them.

### Commands

`commands/` holds the native slash commands. Whether a client reads them depends on the client:

| Client | Reads `commands/`? | Invocation | How it arrives |
|---|---|---|---|
| Claude Code | yes — plugin component | `/writing-flow:flow-writing`, `/writing-flow:flow-doctor` | the plugin, or `bin/install.mjs` |
| Cursor | yes — Cursor's plugin format | Cursor's command surface | the plugin |
| OpenCode | **no** | `/flow-writing`, `/flow-doctor` | `bin/install.mjs` copies it |
| Codex, Copilot, Kiro | **no** | — | the skill, or the MCP prompts |

**OpenCode does not read the repository's `commands/`.** It reads `~/.config/opencode/commands/`,
and `bin/install.mjs` copies every file there. To do it by hand:

```sh
mkdir -p ~/.config/opencode/commands
cp commands/*.md ~/.config/opencode/commands/
```

Two names for the same files, and it is worth saying so wherever you point people: in **OpenCode**
they are `/flow-writing` and `/flow-doctor` — personal commands in a flat namespace — while in
**Claude Code** the plugin name is prefixed, giving `/writing-flow:flow-writing` and
`/writing-flow:flow-doctor`. The `flow-` prefix is deliberate: a bare `/doctor` collides with
unrelated tooling, and a flat namespace has no other way to stay clear.

The MCP prompts are named `write` and `doctor` and left unprefixed, because clients namespace
prompts themselves (`/mcp__writing-flow__write`). Prefixing those would double it.

### Other harnesses

Three pieces travel separately, and knowing which is which saves confusion:

| Piece | Carries | How it travels |
|---|---|---|
| **Skills** | the whole process, and the gate as a command | as files, into a skills directory |
| **MCP server** | profile tools and prompts | one entry in the client's MCP config |
| **Commands** | `/flow-writing`, `/flow-doctor` | as files — OpenCode and Claude Code only |

**Any MCP client** — one entry, the widest-reaching piece:

```json
"writing-flow": {
  "command": "node",
  "args": ["<plugin-root>/skills/writing-flow/scripts/mcp-server.mjs"]
}
```

Claude Code has a one-liner for exactly that:

```sh
claude mcp add writing-flow -- node <plugin-root>/skills/writing-flow/scripts/mcp-server.mjs
```

**Any client that reads Agent Skills** — the skills CLI installs both skills in one command:

```sh
npx -y skills@latest add adelpro/writing-flow -g -a opencode -s writing-flow -s voice-default -y --copy
```

- `-a` is the agent id — `opencode`, `claude`, `cursor`, or `*` for every agent it detects.
  **`-a opencode` installs to `~/.agents/skills`**, not `~/.config/opencode/skills`.
- `-s` takes **one skill per flag**. A comma-separated list silently falls into the interactive
  picker instead of installing.
- Verified: the CLI finds two skills in this repository, `writing-flow` and `voice-default`.

**This installs skills and nothing else** — no `/flow-writing` command, no MCP server, no
`paths.json`. For those, run the installer or add the MCP entry below. The skills are the piece
that carries the process, so this is a working install, just a partial one.

Or copy them by hand:

```sh
cp -r skills/writing-flow skills/voice-default <that-client's-skills-directory>
```

**Agent Plugins clients** — Codex, Cursor, Copilot in VS Code, Kiro — load the package directory
as published. The root `plugin.json` is the manifest; no shim needed.

**OpenCode** — `node bin/install.mjs --apply` places all three pieces at once.

**Antigravity** reads **Agent Plugins** packages directly — `plugin.json`, `skills/` and `mcp.json`
— which is exactly what this repository already is, so there is nothing extra to ship for it.
(Antigravity's *native* plugin format uses `mcp_config.json` rather than `mcp.json` and can carry
hooks and rules; its migration tool `agy plugin import gemini` converts the older Gemini CLI
layout.) **No Gemini-specific files are shipped**, because Gemini CLI stopped serving free, Pro and
Ultra users on 18 June 2026 — its replacement is Antigravity CLI, and the format above already
covers it.

**If a client can take only one piece, take the skills.** They carry the entire process, and the
gate is runnable as a plain command from inside them — the pipeline is designed to work with no
MCP server configured. The server is the layer that reaches clients with no skills system at all:
in a chat UI it is the *only* option.

Exact install syntax for Codex and Antigravity CLI moves between versions — check their current
docs. What is listed here is the payload you are placing, which is the part that will not change.

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
npm test          # node --test
```

No runtime dependencies. Tests that need the third-party gate tools skip cleanly when those
tools are absent.

## Not in scope

The gate checks **mechanics** — abbreviation placement, quote style, invisible Unicode. It does
not measure whether text sounds like the intended voice, and nothing here should be read as
claiming that.
