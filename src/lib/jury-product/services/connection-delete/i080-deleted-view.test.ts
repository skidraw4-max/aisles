import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countConnectionRows, deletedByLabel, DELETED_VIEW_EMPTY, DELETED_VIEW_NOTICE, DELETED_VIEW_TITLE } from './deleted-view';

const UI = readFileSync('src/app/(jury)/jury/service-operations-ui.tsx', 'utf8');

test('I-080 counts active vs deleted', () => {
  assert.deepEqual(countConnectionRows([{ connectionStatus: 'CONNECTED' }, { connectionStatus: 'DISCONNECTED' }, { connectionStatus: 'PENDING' }]), { active: 2, deleted: 1 });
  assert.deepEqual(countConnectionRows([]), { active: 0, deleted: 0 });
});

test('I-080 deleted-by label never exposes a raw email', () => {
  assert.equal(deletedByLabel({ username: 'jd', email: 'jd@example.com' }), 'jd');
  assert.equal(deletedByLabel({ username: '', email: 'jdoe@example.com' }), 'j***@example.com');
  assert.equal(deletedByLabel(null), '—');
});

test('I-080 copy', () => {
  assert.equal(DELETED_VIEW_NOTICE, '삭제된 연결을 보고 있어요. 계정 정보와 스크린샷은 지워졌고, 심사 결과만 남아 있어요.');
  assert.equal(DELETED_VIEW_TITLE, '서비스 연결 · 삭제됨');
  assert.equal(DELETED_VIEW_EMPTY, '삭제된 연결이 없어요.');
});

test('I-080 UI: tablist + aria-selected, juryHref query form, deleted columns, badge, return button', () => {
  assert.match(UI, /role="tablist"/);
  assert.equal((UI.match(/role="tab"/g) ?? []).length, 2);
  assert.match(UI, /aria-selected=\{!showDeleted\}/);
  assert.match(UI, /aria-selected=\{showDeleted\}/);
  assert.match(UI, /juryHref\('\/services', \{ filter: 'deleted' \}\)/);
  assert.ok(!/juryHref\('[^']*\?/.test(UI));
  for (const s of ['연결 중 {counts.active}', '삭제된 연결 {counts.deleted}', '삭제 시각 (KST)', '삭제한 사람', '삭제됨', '연결 중 목록으로', 'styles.mutedRow', 'DELETED_VIEW_NOTICE', 'DELETED_VIEW_TITLE']) assert.ok(UI.includes(s), s);
  assert.match(UI, /canDelete && !showDeleted \? \(\s*<td><ConnectionDeleteDialog/);
});
