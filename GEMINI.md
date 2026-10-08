# writing-flow

A voice-writing pipeline. The **process** lives in the `writing-flow` skill; the **tools** come
from the `writing-flow` MCP server this extension starts. Both load automatically.

## What to reach for

| Need | Use |
|---|---|
| write, draft or rewrite prose for the user | the `writing-flow` skill, or `/flow-writing` |
| which voice is active, and why | the `get_profile` tool |
| check a finished draft | the `run_gate` tool |
| something is misconfigured | `/flow-doctor`, or the `doctor` tool |

## The rules that are easy to get wrong

- **Read the active profile's `SKILL.md` before drafting.** The profile *is* the voice; its name
  and metadata only say which one to read. `get_profile` reports the one in force and whether it
  came from a project override, an installed profile, or the bundled default.
- **The gate is not a voice score.** It checks mechanics — abbreviation placement, quote style,
  invisible Unicode. It cannot tell you whether the text sounds like the profile, and nothing
  should imply it does.
- **Never deliver past a failing gate.** Exit `0` clean, `1` violation (name the rule, fix,
  re-run once), `2` tool error (report it, do not loop).
- **The pipeline works with no server.** If the MCP tools are unavailable, the skill names the
  gate command to run directly; nothing here is mandatory.

## Do not restate the pipeline

The stage order, the bounded loop and the stop conditions live in
`skills/writing-flow/SKILL.md`. Read that file and follow it rather than reconstructing it from
this page — a second copy would drift.
