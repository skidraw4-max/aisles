/** Hangul syllable block — used to detect Korean prose vs English-only AI output. */
const HANGUL_RE = /[\uAC00-\uD7A3]/g;

/** True when the string has enough Hangul to count as Korean prose (proper nouns may stay Latin). */
export function hasSignificantHangul(text: string, minChars = 8): boolean {
  const hangul = text.match(HANGUL_RE)?.length ?? 0;
  return hangul >= minChars;
}

/** True when Latin letters dominate and Hangul is scarce — typical unwanted English trend body. */
export function looksPrimarilyEnglish(text: string): boolean {
  const hangul = text.match(HANGUL_RE)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (hangul >= 8) return false;
  return latin >= 24 && latin > hangul * 3;
}
