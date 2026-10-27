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

test('I-081 dark scheme: scoped panel, outline return button, phase column hidden in deleted view', () => {
  const css = readFileSync('src/app/(jury)/jury/jury.module.css', 'utf8');
  assert.ok(UI.includes('styles.servicesPanelDark'));
  assert.ok(UI.includes('<Link className={styles.outlineButton} href={activeHref}>연결 중 목록으로</Link>'));
  assert.ok(UI.includes('{showDeleted ? null : <th>운영 상태</th>}'));
  assert.match(UI, /showDeleted \? null : <td title=\{row\.phase/);
  for (const needle of ['--svc-body: #16213a', 'rgba(255, 255, 255, 0.08)', '--svc-deleted-text: #9aa4b5', 'tbody tr:hover td', '.outlineButton', 'border-left: 3px solid', '.badge.badgeDeleted']) assert.ok(css.includes(needle), needle);
  assert.ok(!/\.badgeDeleted \{ background: #e4e7ec/.test(css), 'old light badge removed');
});

test('I-081 contrast ≥ 4.5:1 for body/deleted/header/badge text', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
  for (const [fg, bg] of [['#c4cfdf', '#16213a'], ['#9aa4b5', '#16213a'], ['#a8b5c9', '#101a2f'], ['#d0d5dd', '#2b3445'], ['#8dd7f7', '#16213a']]) {
    assert.ok(ratio(fg!, bg!) >= 4.5, `${fg} on ${bg} = ${ratio(fg!, bg!).toFixed(2)}`);
  }
});
