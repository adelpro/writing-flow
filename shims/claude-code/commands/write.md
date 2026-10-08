---
description: Run the voice-writing flow — draft in the active profile's voice, then run both gates
---

Run the voice-writing flow over this request:

$ARGUMENTS

## How to run it

1. **Load the `writing-flow` skill.** It owns the stage order, the bounded loop, the register
   rule and the stop conditions. Do not restate its rules here — follow them.

2. **Stage 0 — angle.** Run `purple-cow-content` for the angle and the A/B title **only**. Never
   its Mode B writer mode: Mode B mandates a call-to-action and emoji output.

3. **Stages 1-5 — write, then audit.** Follow the pipeline exactly, including its bounded loop.
   Do not improvise the order and do not add extra rounds.

4. **Gates.** Write the draft to a BOM-less UTF-8 file, then run both gates in one shot:

   ```sh
   node <writing-flow skill base directory>/scripts/gate.mjs <draft-file>
   ```

   - exit `0` → clean, deliver the text.
   - exit `1` → a gate failed. Report **which** gate and the offending rule or codepoint, fix
     it, and re-run once.
   - exit `2` → tool error, not a content problem. Report it; do not loop.

   Read the exit code immediately after the call; piping the output through another command
   loses `$LASTEXITCODE`.

5. **Never deliver silently past a failing gate.** If the re-run still fails, deliver the text
   with the residual failure stated plainly at the end.
