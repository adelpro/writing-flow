---
description: Diagnose the writing-flow setup — effective profile, resolved tools, drift
---

Diagnose the voice-writing setup, then explain it in plain language.

**Prefer the MCP tool** when the writing-flow server is connected:

```
doctor({ store? })
```

**Otherwise run the CLI** directly:

```sh
node ~/.agents/skills/writing-flow/scripts/doctor.mjs
```

Report, in this order:

1. **Which profile is effective, and why** — a project override, an installed profile, or the
   bundled default. Name the one that won and the one that would have been used otherwise.
2. **Where each of the profile's required skills resolved**, and any that are missing.
3. **Any drift** between the store and a rendered copy, naming which copy diverged.
4. **The exact command** that fixes whatever you found. A missing skill is a targeted
   `npx -y skills@latest add <repo> -g -a <agent> -s <skill> -y --copy`; drift is re-rendered
   with `render_profile`.

Do not change anything without asking first. This command reports; it does not repair.
