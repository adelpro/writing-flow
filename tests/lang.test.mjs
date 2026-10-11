import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, scriptCounts } from '../skills/writing-flow/scripts/lang.mjs';

const ARABIC_SENTENCE =
  'شرحت في هذه المقالة كيف يعمل المتن مع بقية الأدوات، وما تغيّر في هذه النسخة الجديدة من الحزمة.';
const ENGLISH_SENTENCE =
  'This article explains how the pipeline works with the rest of the tools, and what changed in this release.';

test('an Arabic piece is Arabic', () => {
  const verdict = detectLanguage(ARABIC_SENTENCE);
  assert.equal(verdict.language, 'ar');
  assert.equal(verdict.arabicStages, true);
});

test('an English piece is English, and stages 2-3 are inapplicable', () => {
  const verdict = detectLanguage(ENGLISH_SENTENCE);
  assert.equal(verdict.language, 'en');
  assert.equal(verdict.arabicStages, false);
});

test('inline identifiers do not make Arabic prose English', () => {
  const text = `${ARABIC_SENTENCE} يعمل \`writing-flow\` مع \`~/.hermes/skills\` عبر \`paths.json\` و \`mcp-server.mjs\`.`;
  const verdict = detectLanguage(text);
  assert.equal(verdict.language, 'ar');
  assert.equal(verdict.counts.latin, 0, 'identifiers inside backticks are not prose');
});

test('code fences, URLs and link targets are not evidence of a language', () => {
  const fenced = `# English title\n\n\`\`\`sh\n${ARABIC_SENTENCE}\n\`\`\`\n\nAll English here, and a link to https://example.com/docs plus [the docs](https://example.com).\n`;
  assert.equal(detectLanguage(fenced).language, 'en');
  assert.equal(detectLanguage(fenced).counts.arabic, 0, 'Arabic inside a fence is not this piece\'s prose');
});

test('one Arabic word in an English piece does not make it Arabic', () => {
  assert.equal(detectLanguage('This is an English paragraph about a مشروع, more or less.').language, 'en');
});

test('too little text to decide is unknown, and the Arabic stages do not apply', () => {
  const verdict = detectLanguage('نعم');
  assert.equal(verdict.language, 'unknown');
  assert.equal(verdict.arabicStages, false);
  assert.equal(detectLanguage('').language, 'unknown');
  assert.equal(detectLanguage(undefined).language, 'unknown');
});

test('an Arabic piece carrying a lot of Latin prose is mixed, and still runs the Arabic stages', () => {
  const text = `${ARABIC_SENTENCE} ${ARABIC_SENTENCE} The pipeline runs the gates in one shot and reports which one failed, with the offending rule named for each.`;
  const verdict = detectLanguage(text);
  assert.equal(verdict.language, 'ar');
  assert.equal(verdict.mixed, true);
  assert.equal(verdict.arabicStages, true, 'Arabic presence, not a majority, decides whether the stages run');
});

test('counts punctuation and digits as neither script', () => {
  const counts = scriptCounts('1234 — !!! ??? ١٢٣٤');
  assert.equal(counts.arabic, 0);
  assert.equal(counts.latin, 0);
  assert.equal(counts.share, 0);
});
