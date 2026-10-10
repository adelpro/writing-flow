# Roadmap

Where this package is, what it deliberately is not yet, and how it changes.

**Current version: 0.10.0 — pre-1.0.** While the major version is 0, a minor bump may change
behaviour; a patch bump will not.

---

## Memory

### How it works now

`learn_preference({ text, consent: true })` appends one durable note to
`learned-preferences.json` **inside the profile directory**. `get_profile` returns them as
`learnedPreferences`, and the pipeline skill instructs the agent to apply them and never
re-litigate a recorded one.

Four properties worth knowing:

- **Consent is required.** Without `consent: true` the call is refused. Nothing is recorded
  silently.
- **Notes are per-location, not shared.** They live beside the profile they belong to, so the
  copy in `~/.agents/skills` and the copy in `~/.claude/skills` keep separate notes.
- **`manage_profile({action:'set'})` does not copy them into a project.** A project pin carries
  the voice but not your accumulated notes — deliberate, since a project directory is often
  committed.
- **Damage is tolerated.** A missing or corrupt notes file reads as "nothing learned yet" rather
  than stopping a write.

### What is missing

| Gap | Why it matters |
|---|---|
| **No deduplication or conflict handling** | Two contradictory notes both apply. Nothing arbitrates. |
| **No scoping** | A note cannot be marked "this project only" or "always". It is profile-wide or nowhere. |
| **Free text only** | `{ text }` cannot be acted on mechanically. A typed shape (`kind`, `scope`, `example`) would let the gate warn when a draft contradicts a recorded preference. |
| **Never pruned** | Notes accumulate. There is no "forget this". |

### Planned

1. **Typed entries** — `{ kind, text, example?, scope? }`, defaulting `kind` to `preference`
   so existing files keep working.
2. **Scoping** — profile-wide, project, or session. Resolution mirrors the profile tiers.
3. **Contradiction check in the gate** — advisory, never hard, and only once entries are typed.
4. **A `forget_preference` path** — because "delete" is a promise this package makes elsewhere
   and should keep here.

---

## Release and versioning

### What ships in a release

```sh
# 1. bump the version in plugin.json AND package.json (a test asserts they agree)
# 2. add the CHANGELOG entry
# 3. regenerate the generated client files (they embed the version)
npm run build
# 4. prove it
npm test
# 5. install and verify locally
node bin/install.mjs --apply && npm run doctor
# 6. commit
# 7. publish, when intended: npm publish
```

`plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `.mcp.json`
are **generated** from `mcp.json` and `plugin.json`. Editing them by hand is a bug: a test
compares them against the generator and fails if they drift.

### Update path for users

There is no auto-update. Users run `git pull` and `node bin/install.mjs --apply`, or install
without a clone with `npx -y @adelpro/writing-flow --apply`. The skills travel
separately and can be updated on their own:

```sh
npx -y skills@latest add adelpro/writing-flow -g -a opencode -s writing-flow -s voice-default -y --copy
```

That installs **skills only** — no commands, no MCP server, no `paths.json`. The installer
declares the Claude marketplace, adds the OpenCode plugin, and installs the skills everywhere
else.

### Where each harness gets its copy

| Harness | Mechanism | Who fetches |
|---|---|---|
| Claude Code | marketplace plugin, declared in `~/.claude/settings.json` | Claude Code |
| OpenCode | package plugin, from `plugins` in `opencode.json(c)` | OpenCode |
| Other detected agents | the two skills, via the skills CLI | the installer, at install time |

`~/.agents/skills` is the skills CLI's canonical store and the root the engine resolves against
(`paths.json`, `doctor`, the gate entry points). The installer copies the two skills there
byte-exact for the installed version after the CLI runs, so that root cannot drift; the copies in
other agents' directories come from the repository's default branch.

### CI

`.github/workflows/test.yml` runs the hermetic suite on ubuntu (Node 22 and 24) and windows
(Node 22), and an integration job that installs the dependencies through the package's own
installer, then asserts the gate tests did not silently skip. On the hermetic runners the gate
tests skip by design — the tools are not installed there — so a green hermetic run proves the
engine loads and behaves, and the integration job is what actually exercises the gate.

---

## Known gaps, in priority order

1. **The installer copies but never prunes.** Renaming or removing a command or skill leaves a
   stale copy in the user's directories. It bit us once already (`/write` → `/flow-writing`).
   The fix is a written-manifest of what the installer created, so it can remove only what it
   owns.
2. **`.claude-plugin/marketplace.json` is unvalidated.** It ships the documented `github` source
   form (`{ "source": "github", "repo": "adelpro/writing-flow" }`), not the relative `"./"`
   drafted first. A `claude plugin validate` run is still outstanding.
3. **The MCP-only surface — a chat UI with no skills system — is not supported.** Its `write`
   prompt asks the model to follow the `writing-flow` skill, which such a client cannot load, and
   `run_gate` takes a file path, so a pasted draft cannot be gated. Recorded as a non-goal rather
   than a gap: closing it means a second, self-contained pipeline inside the prompt, and a
   lower-fidelity flow is worse than an honest refusal. The server keeps its role as the
   profile-tool component of the supported surfaces.
4. **Gate 5 needs Python.** Deliberate: the authoritative check is `remove-ai-marks`'s script, and
   a Node reimplementation would be a second authority that could disagree. A missing Python is
   exit `2` with a named cause, never a silent pass.
5. **Never verified on a machine without the dependency tools.** The suite skips its integration
   tests when `avoid-ai-writing`, `remove-ai-marks` or Python are absent, and no run has yet been
   done on a host that had none of them.
6. **The skills CLI installs from the default branch, not from the installed package.** A user on
   `@adelpro/writing-flow@0.10.0` can receive skill files newer than their package in every
   directory except `~/.agents/skills`, which the installer overwrites byte-exact. The CLI exposes
   no ref or version pin for `add`, so closing this needs either a changed CLI or copying from the
   package per agent.
6. **`generate_profile` reads a file, never the session.** The skill instructs the agent to say,
   once, that a personal profile "can be generated from writing the user already has" — but the
   tool's `source` is a path (a `SKILL.md`, a markdown file, or a directory). Nothing reads the
   harness's session or memory, and the suggestion carries no accept/decline branch: the bundled
   default stays active until a real profile is installed, and acting on the suggestion needs the
   user to name existing writing first. Bridging the conversation to a profile is the obvious next
   step, and the parked service already assumed an agent that distils local writing.

### Deferred minors

- Junction-mode render reports hash the path string, so a junction pointing at the wrong store is
  invisible. Not reachable through the shipped installer, which uses copy mode.
- On Windows, `where python` can resolve to the Microsoft Store stub, which exits non-zero when
  run — surfacing as a confusing exit `2` rather than "Python is not installed".

---

## Parked: the hosted service

A **public, multi-user, hosted** version was designed and deliberately not built. The decisions
are recorded here so they are not relitigated from scratch:

- **Public service, anyone can join** — accounts, tokens, dashboard, published retention policy.
- **No inference on the server.** The client's model writes; the server supplies the voice and
  checks the result. CPU only, no model keys, and the operator is never the author of the text.
- **Raw writing never reaches the server.** The client's agent distils locally and uploads only
  the finished profile, so a breach leaks a style description rather than a corpus.
- **Content in git, metadata in SQLite.** Git gives export (`clone`) and deletion (drop the repo)
  as *verifiable* properties, which a published policy needs; SQLite serves the dashboard and a
  gallery.
- **Streamable HTTP transport**, because no chat UI launches a local server — Claude, ChatGPT and
  Gemini all require a remote HTTPS endpoint with OAuth 2.1.

**Why parked:** it needs identity, a retention and deletion policy, abuse handling (the vector is
impersonation — "write in X's voice"), and a dashboard. That is a product, not a feature, and none
of it makes the local package better.

**Prerequisite when it resumes:** the engine must be **one shared artefact** consumed by both the
plugin and the server. Forking `gate.mjs` between the two would make "same engine" a claim rather
than a fact.

---

## What is explicitly out of scope

- **Measuring voice fidelity.** The gate checks mechanics — abbreviation placement, quotes,
  invisible Unicode. It cannot tell you whether text sounds like the profile, and nothing here
  should imply otherwise.
- **Vendoring the dependency skills.** `fasaha`, `purple-cow-content`, `avoid-ai-writing` and
  `remove-ai-marks` keep their own repositories. Bundling would fork them and ship seven extra
  skills into every user's trigger pool.
- **A registry.** Agent Plugins v1 defines no distribution mechanism, so the repository *is* the
  distribution unit.
