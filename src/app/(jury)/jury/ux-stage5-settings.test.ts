import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ui = readFileSync('src/app/(jury)/jury/ui.tsx', 'utf8');
const settings = ui.slice(ui.indexOf('title="관리"'), ui.indexOf('export function ReReviewAgentRunBody'));

test('settings links to members instead of a member-ID form', () => {
  assert.ok(settings.includes('멤버 관리로 이동'));
  assert.ok(!settings.includes('name="targetUserId"'));
});

test('automation is shown once on /automation with Korean labels', () => {
  assert.ok(settings.includes('자동화 상태 보기'));
  assert.ok(!settings.includes('최대 반복 횟수'));
  assert.ok(ui.includes('>최대 반복 횟수</span>'));
  assert.ok(!ui.includes('>maxIterations</span>'));
});

test('service access card and view-only badge', () => {
  assert.ok(ui.includes('<strong>서비스 접근 권한</strong>'));
  assert.ok(ui.includes('보기 전용</StatusBadge>'));
});
