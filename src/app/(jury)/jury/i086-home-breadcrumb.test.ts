import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { shouldShowBreadcrumb } from './page-layout-model';

const read = (f: string) => readFileSync(join(process.cwd(), 'src/app/(jury)/jury', f), 'utf8');

test('single crumb equal to the title is hidden (home shows 홈 once)', () => {
  assert.equal(shouldShowBreadcrumb([{ label: '홈' }], '홈'), false);
  assert.equal(shouldShowBreadcrumb([], '홈'), false);
});

test('multi-level and non-duplicate breadcrumbs stay', () => {
  assert.equal(shouldShowBreadcrumb([{ label: '홈', href: '/jury' }, { label: '결과' }], '결과'), true);
  assert.equal(shouldShowBreadcrumb([{ label: '서비스' }], '서비스 상세'), true);
});

test('PageHeader gates the breadcrumb nav on the rule', () => {
  assert.match(read('page-layout.tsx'), /\{shouldShowBreadcrumb\(crumbs, title\) \? \(\s*<nav aria-label="현재 위치">/);
});
