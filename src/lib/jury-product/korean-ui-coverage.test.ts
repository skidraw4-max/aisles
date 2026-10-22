/** RM-12 (I-019): 전 화면 한글·KST·enum 번역 회귀 가드. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JURY_CONNECTION_STATUSES, JURY_MEMBER_ROLES } from './records';
import { displayText } from './ui-labels';
import { formatKstFull } from '../../app/(jury)/jury/review-summary-format';

const ROOT = 'src/app/(jury)/jury';
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
});
/** Product names / proper nouns allowed in English. */
const ALLOWED = new Set(['AIsles Jury', 'GitHub', 'Mock', 'README']);

test('no English-only JSX text nodes on Jury screens', () => {
  const offenders: string[] = [];
  for (const f of files(ROOT)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/>\s*([A-Z][A-Za-z]+(?: [A-Za-z]+)*)\s*</g)) {
      if (!ALLOWED.has(m[1]!)) offenders.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('raw status/role/date fields are not rendered directly', () => {
  const offenders: string[] = [];
  for (const f of files(ROOT)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/>\{[\w.?[\]]+\.(status|role|accessMethod|action|createdAt|updatedAt|completedAt|expiresAt)\}</g)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test('connection statuses and member roles all have Korean labels', () => {
  for (const v of [...JURY_CONNECTION_STATUSES, ...JURY_MEMBER_ROLES, 'OAUTH', 'API_KEY', 'BROWSER_SESSION', 'FILE_UPLOAD', 'ACCEPTED', 'EXPIRED']) {
    assert.notEqual(displayText(v), v, v);
  }
});

test('ISO UTC is shown as KST', () => {
  assert.equal(formatKstFull('2026-10-22T08:00:00.000Z'), '2026-10-22 17:00:00 KST');
});
