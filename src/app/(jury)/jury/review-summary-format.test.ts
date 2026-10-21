import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { formatKstFull, formatKstShort, shortId } from './review-summary-format';

test('reviews table formats completion time in KST', () => {
  assert.equal(formatKstShort('2026-10-21T06:52:10.000Z'), '10-21 15:52');
  assert.equal(formatKstFull('2026-10-21T06:52:10.000Z'), '2026-10-21 15:52:10 KST');
  assert.equal(formatKstShort('not-a-date'), 'not-a-date');
  assert.equal(formatKstShort(''), '—');
});

test('reviews table shortens evidence ids to 8 characters with an ellipsis', () => {
  assert.equal(shortId('10a856f7abcdef0123456789'), '10a856f7…');
  assert.equal(shortId('abc'), 'abc');
  assert.equal(shortId(null), '—');
});

test('reviews table uses fixed columns and a summary popup', () => {
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(jury)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReviewsBody'), ui.indexOf('export function ReviewDetailBody'));
  assert.match(body, /styles\.reviewsTable/);
  assert.match(body, /<colgroup>/);
  assert.match(body, /<ReviewSummaryDialog/);
  const dialog = readFileSync(path.resolve(process.cwd(), 'src/app/(jury)/jury/ReviewSummaryDialog.tsx'), 'utf8');
  assert.match(dialog, /^'use client';/);
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /요약 상세/);
  assert.match(dialog, /리뷰 상세로 이동/);
});
