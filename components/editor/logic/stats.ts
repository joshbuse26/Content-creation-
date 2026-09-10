/** Word count / runtime estimation (spec §5.7.7: words ÷ 150 wpm). */

export const WORDS_PER_MINUTE = 150;

export function wordCount(text: string): number {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
  return words.length;
}

export function estSecondsFromWords(words: number, wpm: number = WORDS_PER_MINUTE): number {
  if (words <= 0) return 0;
  return Math.round((words / wpm) * 60);
}

export interface ScriptTotals {
  words: number;
  estSeconds: number;
  sections: number;
}

export function totalsFor(bodies: string[]): ScriptTotals {
  const words = bodies.reduce((acc, b) => acc + wordCount(b), 0);
  return { words, estSeconds: estSecondsFromWords(words), sections: bodies.length };
}
