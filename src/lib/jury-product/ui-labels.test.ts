import assert from 'node:assert/strict';
import test from 'node:test';
import { auditActionLabel, committeeRoleLabel, confidenceLabel, DECISION_GUIDANCE, displayText, MEMBER_OPINION_NOTICE, STATUS_LABELS, userLabel } from './ui-labels';

test('status labels follow the glossary and keep raw values as keys', () => {
  assert.equal(userLabel('PENDING'), '대기 중');
  assert.equal(userLabel('RUNNING'), '진행 중');
  assert.equal(userLabel('PASS'), '통과');
  assert.equal(userLabel('FAIL'), '실패');
  assert.equal(userLabel('REVISION_REQUIRED'), '수정 필요');
  assert.equal(userLabel('COMPLETED'), '완료');
  assert.equal(userLabel('FULL_REVIEW'), '전체 심사');
  assert.equal(userLabel('OWNER'), '소유자');
  assert.ok(Object.keys(STATUS_LABELS).every((key) => /^[A-Z_]+$/.test(key)));
});

test('unknown values keep the previous readable fallback', () => {
  assert.equal(userLabel('SOME_NEW_STATE'), 'some new state');
  assert.equal(userLabel(null), '확인 필요');
});

test('audit actions get Korean labels', () => {
  assert.equal(auditActionLabel('REVIEW_COMPLETED'), '심사 완료');
  assert.equal(auditActionLabel('IMPROVEMENT_TASK_CREATED'), '개선 작업 생성');
});

test('display text keeps measured zero distinct from missing values', () => {
  assert.equal(displayText('0 · measured zero'), '0 · 측정값 0');
  assert.equal(displayText('Not measured'), '측정되지 않음');
  assert.equal(displayText('Not available'), '확인할 수 없음');
  assert.notEqual(displayText('0 · measured zero'), displayText('Not measured'));
  assert.equal(displayText('42'), '42');
});

test('relative ages are localized', () => {
  assert.equal(displayText('8 h ago'), '8시간 전');
  assert.equal(displayText('10 min ago'), '10분 전');
  assert.equal(displayText('3 d ago'), '3일 전');
  assert.equal(displayText('just now'), '방금 전');
});

test('committee labels, confidence and decision guidance are display-only Korean text', () => {
  assert.equal(committeeRoleLabel('A'), 'UX/UI');
  assert.equal(committeeRoleLabel('Z'), 'Z');
  assert.equal(confidenceLabel(0.64), '64%');
  assert.equal(confidenceLabel(null), '확인 불가');
  assert.equal(MEMBER_OPINION_NOTICE.LEGACY.includes('재심사 시 표시됩니다'), true);
  for (const code of ['ACCEPT', 'VERIFY', 'REWORD']) {
    assert.equal(DECISION_GUIDANCE[code].length > 0, true, code);
    assert.equal(DECISION_GUIDANCE[code].includes('실패'), false, code);
  }
  assert.equal(userLabel('REWORD'), '수정 필요');
  assert.equal(userLabel('VERIFY'), '검증 필요');
});
