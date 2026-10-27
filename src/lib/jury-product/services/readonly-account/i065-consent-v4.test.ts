import assert from 'node:assert/strict';
import { test } from 'node:test';
import { READONLY_ACCOUNT_CONSENT_TEXT, READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';

test('I-065: consent v4 covers screen audit viewports, masked screenshots, retention, AI default off', () => {
  assert.match(READONLY_ACCOUNT_CONSENT_VERSION, /^readonly-account-consent-v([4-9]|\d{2,})$/); // I-069 bumped to v5
  const t = READONLY_ACCOUNT_CONSENT_TEXT.join('\n');
  for (const needle of ['1366×768', '390×844', '가린 뒤 촬영', '14일', '/mypage', 'AI 화면 평가는 기본으로 꺼져']) assert.ok(t.includes(needle), needle);
  assert.ok(t.includes('저장·제출·삭제를 하지 않습니다'));
});
