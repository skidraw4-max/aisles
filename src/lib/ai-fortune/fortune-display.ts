/** Display helpers for AI FORTUNE hub / archive lists. */

const AI_FORTUNE_TITLE_PREFIX = /^\[\s*AI\s*FORTUNE\s*\]\s*/i;

/** Hub/archive list title — drop repetitive `[AI FORTUNE]` prefix. */
export function formatFortuneHubTitle(title: string): string {
  return title.trim().replace(AI_FORTUNE_TITLE_PREFIX, '').trim();
}
