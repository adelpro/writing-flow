---
name: writing-flow
description: Run the voice-writing pipeline — take an angle, draft in the active profile's voice, pass the Arabic, anti-AI and provenance stages, then gate the result. Use when asked to write, draft, rewrite or publish prose in the user's voice.
---

# Writing Flow

Owns the order of the pipeline and the rules for stopping. It contains **no voice and no style
rules**: those belong to the active profile.

## Stage order

0. **Angle** — `purple-cow-content` for the angle and the A/B title **only**. Never its Mode B
   writer mode: Mode B mandates a call-to-action and emoji output, both banned by most
   profiles.
1. **Draft** — write in the active profile's voice.
2. **Arabic pass** — `fasaha`, Arabic pieces only.
3. **Voice re-check** — restore anything the Arabic pass flattened, Arabic pieces only.
4. **AI-ism audit** — `avoid-ai-writing`.
5. **Provenance strip** — `remove-ai-marks`: Layer A always, Layer B offered, then Layer A
   again if Layer B was accepted.

**Bounded loop (stages 2-3):** one `fasaha` pass, one voice re-check pass, then stop and report
any residual. Never a third round: each pass rewrites, so an unbounded loop re-breaks what the
other just fixed.

## The active profile

The profile is the register authority. Never ask "which register?" — the resolved profile
answers that. Resolution order:

1. `writing-profile.json` in the working project, if present.
2. An installed profile skill containing `writing-profile.json` with `"kind": "voice"`.
3. The bundled `skills/voice-default/`.

If more than one profile is installed at the same tier, stop and report the ambiguity rather
than silently picking one.

## Suggesting a profile

When the active profile is the bundled default — `get_profile` reports `resolvedBy: bundled`
and the name `default` — say **once**, in one sentence, that a personal profile can be
generated from writing the user already has. Then carry on with the default. Say it once per
conversation, never as a blocker, and never instead of doing the work.

Profile administration is `generate_profile`. It takes a markdown file, a `SKILL.md`, or a
directory containing one; it previews the result and reports every line it would drop as
pipeline instruction rather than voice. Show the user those dropped lines, then apply only on
their confirmation (`confirm: true`). With no MCP server configured, the same capability is:

```sh
node <this skill's base directory>/scripts/generate.mjs <source> --name <name> --out <dir>
```

## Gates (stages 4-5)

Run both gates in one shot and treat a non-zero exit as failure — never deliver silently past
it:

```sh
node <this skill's base directory>/scripts/gate.mjs <draft-file>
```

Exit `0` clean, `1` violation (name the gate and the offending line, fix, re-run once),
`2` tool error (report it; do not loop). Drafts must be written as BOM-less UTF-8, because a
byte-order mark makes the provenance gate fail on every file.

The gate checks mechanics only. It does not measure whether the text sounds like the profile's
voice, and nothing may present a passing gate as a claim that it does.

## No server required

This skill must work with no MCP server configured. Every gate stays runnable as a plain
command, and no tool call is mandatory. If the server is available it may be used for the
profile and diagnostic tools, but the pipeline never depends on it.
