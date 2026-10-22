/**
 * Prompt contract: AI FORTUNE system instruction must require Korean for trendBullets.
 * Run: node --import tsx --test src/lib/ai-fortune/generate-weekly-fortune.prompt.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AI_FORTUNE_SYSTEM_PROMPT } from './fortune-system-prompt';

describe('AI_FORTUNE_SYSTEM_PROMPT language', () => {
  it('requires Korean for trendBullets / AI 흐름', () => {
    assert.match(AI_FORTUNE_SYSTEM_PROMPT, /trendBullets/);
    assert.match(AI_FORTUNE_SYSTEM_PROMPT, /한국어/);
    // Explicit constraint so English headlines do not leak into "이번 주 AI 흐름"
    assert.match(
      AI_FORTUNE_SYSTEM_PROMPT,
      /trendBullets[\s\S]{0,200}한국어|한국어[\s\S]{0,200}trendBullets/,
    );
  });
});
