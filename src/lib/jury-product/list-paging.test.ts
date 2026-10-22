/** RM-15 (I-020/I-021). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { listHref, pageList, readListQuery } from './list-paging';

const items = Array.from({ length: 45 }, (_, i) => ({ id: i, kind: i % 3 === 0 ? 'A' : 'B', text: `항목 ${i}` }));

test('paging: 20 per page, clamps out-of-range pages', () => {
  const q = readListQuery({ page: '3' });
  const r = pageList(items, q, { text: (x) => x.text });
  assert.equal(r.items.length, 5);
  assert.equal(r.pages, 3);
  assert.equal(pageList(items, readListQuery({ page: '99' }), { text: (x) => x.text }).page, 3);
  assert.equal(readListQuery({ page: '-1' }).page, 1);
});

test('filter + Korean search', () => {
  const r = pageList(items, readListQuery({ q: '항목 4', filter: 'B' }), { text: (x) => x.text, key: (x) => x.kind });
  assert.deepEqual(r.items.map((x) => x.id), [4, 40, 41, 43, 44]);
  assert.deepEqual(r.filterOptions, ['A', 'B']);
});

test('listHref keeps non-ASCII query values', () => {
  assert.equal(listHref('/jury/audit', { q: '심사', filter: '', page: 1 }, 2), '/jury/audit?q=%EC%8B%AC%EC%82%AC&page=2');
});

test('mobile: 480px rules and text copy button exist (I-020)', () => {
  const css = readFileSync('src/app/(jury)/jury/jury.module.css', 'utf8');
  assert.match(css, /@media \(max-width: 480px\)/);
  const dialog = readFileSync('src/app/(jury)/jury/ReviewSummaryDialog.tsx', 'utf8');
  assert.equal(dialog.includes('⧉'), false);
});
