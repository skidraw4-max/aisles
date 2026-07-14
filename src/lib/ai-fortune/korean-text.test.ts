/**
 * Node built-in test — no vitest/jest in this repo.
 * Run: node --import tsx --test src/lib/ai-fortune/korean-text.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasSignificantHangul, looksPrimarilyEnglish } from './korean-text';

describe('ai-fortune korean-text', () => {
  it('accepts Korean trend bullets with Latin product names', () => {
    const ko =
      'Anthropic의 Claude Fable 5 접근 연장과 Claude Code 요청 한도 확대로, GPT-5.6 경쟁 속 사용자 유지를 노린 전략이 드러났습니다.';
    assert.equal(hasSignificantHangul(ko), true);
    assert.equal(looksPrimarilyEnglish(ko), false);
  });

  it('rejects English-only trend bullets', () => {
    const en =
      "Anthropic's Claude Fable 5 access extension and increased rate limits for Claude Code through July 19 indicate a strategic move to retain users.";
    assert.equal(hasSignificantHangul(en), false);
    assert.equal(looksPrimarilyEnglish(en), true);
  });
});
