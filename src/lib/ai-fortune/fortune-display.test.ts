/**
 * Run: node --import tsx --test src/lib/ai-fortune/fortune-display.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAiFortuneWeekKeyLabel } from './kst-week';
import { formatFortuneHubTitle } from './fortune-display';

describe('formatAiFortuneWeekKeyLabel', () => {
  it('formats DB week keys for humans', () => {
    assert.equal(formatAiFortuneWeekKeyLabel('2026-08-W4'), '2026년 8월 4주차');
  });

  it('returns original string when key is invalid', () => {
    assert.equal(formatAiFortuneWeekKeyLabel('LATEST'), 'LATEST');
  });
});

describe('formatFortuneHubTitle', () => {
  it('strips leading [AI FORTUNE] for hub lists', () => {
    assert.equal(
      formatFortuneHubTitle('[AI FORTUNE] 8월 4주차, 당신의 커리어를 바꿀 AI의 흐름'),
      '8월 4주차, 당신의 커리어를 바꿀 AI의 흐름'
    );
  });

  it('keeps titles without the prefix', () => {
    assert.equal(formatFortuneHubTitle('주간 트렌드 요약'), '주간 트렌드 요약');
  });

  it('trims whitespace after strip', () => {
    assert.equal(formatFortuneHubTitle('  [AI FORTUNE]   본문  '), '본문');
  });
});
