/**
 * Flesch reading ease — pure code, used by the quality gate (spec §5.7.7).
 * Score = 206.835 − 1.015 × (words/sentences) − 84.6 × (syllables/word).
 */

const VOWELS = /[aeiouy]+/g;

/** Heuristic syllable counter — good enough for a gate, not for linguistics. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  let stripped = w.replace(/(?:ed|es)$/, "");
  if (stripped.endsWith("e") && !stripped.endsWith("le")) {
    stripped = stripped.slice(0, -1);
  }
  const groups = stripped.match(VOWELS);
  return Math.max(1, groups === null ? 1 : groups.length);
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}'$-]+/gu);
  return matches === null ? 0 : matches.length;
}

export function countSentences(text: string): number {
  const matches = text.match(/[.!?]+(?=\s|$)/g);
  return Math.max(1, matches === null ? 1 : matches.length);
}

export function fleschReadingEase(text: string): number {
  const words = text.match(/[\p{L}\p{N}'$-]+/gu) ?? [];
  if (words.length === 0) return 100;
  const sentences = countSentences(text);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  return Math.round(score * 10) / 10;
}

/**
 * Flesch–Kincaid grade level — drives the PER-CARD readingLevel gate
 * (PRODUCT-CONTRACTS §6): grade = 0.39·(words/sentences) +
 * 11.8·(syllables/word) − 15.59, floored at 0, rounded to one decimal.
 */
export function fleschKincaidGrade(text: string): number {
  const words = text.match(/[\p{L}\p{N}'$-]+/gu) ?? [];
  if (words.length === 0) return 0;
  const sentences = countSentences(text);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

/** Spoken-runtime estimate at 150 wpm (config per language later). */
export const WORDS_PER_MINUTE = 150;

export function estimateSeconds(wordCount: number): number {
  return Math.round((wordCount / WORDS_PER_MINUTE) * 60);
}

export function estimateSecondsForText(text: string): number {
  return estimateSeconds(countWords(text));
}
