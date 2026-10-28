import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ui = readFileSync('src/app/(jury)/jury/ui.tsx', 'utf8');
const svc = readFileSync('src/app/(jury)/jury/service-onboarding-ui.tsx', 'utf8');

test('improvements list shows 문제/우선순위/상태/최근 활동 with details folded', () => {
  for (const h of ['<th>문제</th>', '<th>우선순위</th>', '<th>최근 활동</th>', '세부 정보·작업']) assert.ok(ui.includes(h), h);
  assert.ok(!ui.includes('<th>완료 기준</th>'));
});

test('reviews list shows evidence period and a Korean one-line conclusion', () => {
  assert.ok(ui.includes('<th>심사 근거 · 기간</th>'));
  assert.ok(ui.includes('<th>한 줄 결론</th>'));
});

test('evidence is a table and service overview has one status', () => {
  assert.ok(ui.includes('<th>자세히 · 심사</th>'));
  assert.ok(!svc.includes('<h3>활성화</h3>'));
});
