/**
 * Which language a draft is in, decided mechanically.
 *
 * Stages 2 and 3 — the `fasaha` pass and the voice re-check — are Arabic-only, so whether they are
 * part of a run is a question about the draft rather than a judgement call. The counts are taken
 * from prose only: code fences, inline code, URLs, link targets and HTML tags are removed first,
 * because a profile may keep English identifiers untranslated inline and those are not evidence
 * that the piece is English.
 *
 * The verdict drives the pipeline, not a gate. Nothing here blocks a delivery.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './entry.mjs';

/**
 * Arabic: the main block, the supplements, and the presentation forms an editor may paste in.
 * Arabic-Indic digits live inside those blocks but are not letters, so they are subtracted.
 */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** Latin letters only: digits and punctuation say nothing about the language of the prose. */
const LATIN = /[A-Za-z]/g;

/** Below this many letters of a script, the sample is too small to decide anything. */
const FLOOR = 20;

/** Fenced blocks, inline code, URLs, link targets, HTML tags — not evidence of a language. */
const stripNonProse = (text) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<(https?:\/\/)?[^>\s]+>/g, ' ')
    .replace(/\]\([^)\s]+\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>\n]{1,200}>/g, ' ');

/** Count the letters of each script in the prose that remains. */
export const scriptCounts = (text) => {
  const prose = stripNonProse(text ?? '');
  const arabic = (prose.match(ARABIC)?.length ?? 0) - (prose.match(ARABIC_DIGITS)?.length ?? 0);
  const latin = prose.match(LATIN)?.length ?? 0;
  return { arabic, latin, share: arabic + latin === 0 ? 0 : arabic / (arabic + latin) };
};

/**
 * Decide the language of a draft.
 *
 * `ar` and `en` are decided by dominant script with a floor, so a short reply does not become
 * Arabic because it contains one Arabic word. `mixed` is a real answer — an Arabic piece carrying
 * a lot of untranslated identifiers lands there — and the Arabic stages apply to it, because the
 * alternative is deciding that Arabic prose is not Arabic.
 */
export const detectLanguage = (text) => {
  const counts = scriptCounts(text);
  const arabic = counts.arabic >= FLOOR;
  const latin = counts.latin >= FLOOR;

  let language = 'unknown';
  if (arabic && latin) language = counts.share >= 0.5 ? 'ar' : 'en';
  else if (arabic) language = 'ar';
  else if (latin) language = 'en';

  const mixed = arabic && latin && counts.share < 0.8 && counts.share > 0.2;
  return {
    language,
    counts,
    mixed,
    arabicStages: language === 'ar' || language === 'en' ? language === 'ar' : mixed ? true : false,
  };
};

const invokedDirectly = isEntryPoint(import.meta.url);
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    process.stdout.write('usage: node lang.mjs <draft-file> [--json]\n');
    process.exit(2);
  }
  if (!existsSync(file)) {
    process.stdout.write(`lang: no such file: ${resolve(file)}\n`);
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  const verdict = detectLanguage(text);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ file: resolve(file), ...verdict }, null, 2)}\n`);
  } else {
    process.stdout.write(`file      : ${resolve(file)}\n`);
    process.stdout.write(
      `prose     : ${verdict.counts.arabic} Arabic letter(s), ${verdict.counts.latin} Latin letter(s), after code, URLs and identifiers\n`,
    );
    process.stdout.write(`language  : ${verdict.language}${verdict.mixed ? ' (mixed, Arabic present)' : ''}\n`);
    process.stdout.write(
      `stages 2-3: ${verdict.arabicStages ? 'apply — Arabic pass, then the voice re-check' : 'inapplicable — the piece is not Arabic, so stages 2 and 3 are not part of the run'}\n`,
    );
  }
  process.exit(0);
}
