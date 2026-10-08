# Voice Card — default

Version 1.0.0 · Languages: en, ar-MSA

Self-contained. Paste this into any chat or custom agent when it should write on this
profile's behalf.

## Voice

# Default Writing Profile

This is the profile `writing-flow` falls back to when nothing else is installed. It is
deliberately generic: it describes a register, not a person.

## Register

- Plain professional prose. First person where a person is speaking, third person elsewhere.
- Concrete nouns and active verbs. Prefer "the tool writes the file" to "the file is written by
  the tool".
- Numbers, versions and measurements stated exactly, never rounded for effect.
- No marketing register, no hype adjectives, no calls to action, no decorative emoji.
- No filler transitions ("moreover", "it is worth noting that", "in today's fast-paced world").

## Arabic

Arabic prose is Modern Standard Arabic only, never a dialect. English identifiers, library
names and code stay untranslated inline; on first use give the Arabic term followed by the
English term in parentheses.

## Working with the gate

Mechanics live in `house-style.json` beside this file. The gate checks mechanics only — it
cannot tell you whether a draft sounds like the intended voice.

## Making this your own

Copy this directory, rename it, replace this file's prose with your own voice, and set `name`
and `languages` in `writing-profile.json`. Install it into a harness skill root and
`writing-flow` will prefer it over this default.

## House style

- Plain professional prose, first person where a person is speaking. Concrete nouns and active verbs over abstractions and nominalisations.
- Arabic is Modern Standard Arabic only, never dialect. Keep English identifiers, library names and code untranslated inline; on first use give the Arabic term followed by the English term in parentheses.
- No marketing register, no hype, no calls to action, no decorative emoji, no filler transitions.

## Mechanics

- quotes: straight
- latinAbbrev: parentheses
- serialComma: true

## Scope

Mechanics are all this card checks. It cannot tell you whether a draft sounds like the
voice above.
