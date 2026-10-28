import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DIR = path.resolve(process.cwd(), 'src/app/(jury)/jury');
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8');

test('I-100: /jury/services renders one list (ServicesBody removed)', () => {
  const page = read('services/page.tsx');
  assert.match(page, /<ServiceOperationsList/);
  assert.doesNotMatch(page, /ServicesBody/);
  assert.doesNotMatch(read('ui.tsx'), /ServicesBody|서비스 연결 목록/);
  assert.match(page, /canAddService=\{canShowWrite\(actor, 'connection\.write'\)\}/);
});

test('I-100: header has primary 서비스 추가 and secondary GitHub 연결; tabs kept', () => {
  const ui = read('service-operations-ui.tsx');
  assert.match(ui, /variant="primary" icon=\{Plus\} href=\{juryHref\('\/services\/new'\)\}>서비스 추가/);
  assert.match(ui, /variant="secondary" icon=\{Link2\} href=\{juryHref\('\/services\/github'\)\}>GitHub 연결/);
  assert.match(ui, /data-testid="services-add-blocked"/);
  assert.match(ui, /연결 중 <span/);
  assert.match(ui, /삭제된 연결 <span/);
});

test('I-100: list columns — 연결 방식 under 제공자; no 수정일/서비스 확인 상태/범위 상태; single primary empty action', () => {
  const ui = read('service-operations-ui.tsx');
  const list = ui.slice(ui.indexOf('export function ServiceOperationsList'), ui.indexOf('export function ServiceSummaryHeader'));
  assert.match(list, /accessMethods\[row\.connectionId\]/);
  assert.match(list, /styles\.subText/);
  for (const col of ['<th>수정일</th>', '<th>생성일</th>', '<th>서비스 확인 상태</th>', '<th>범위 상태</th>']) assert.equal(list.includes(col), false, col);
  assert.match(list, /<EmptyState action=\{canAddService \? <ButtonLink variant="primary" icon=\{Plus\} href=\{juryHref\('\/organization\/services'\)\}>서비스 연결/);
});

test('I-100: 생성일 is visible in the service detail overview (not only in admin details)', () => {
  const ui = read('service-onboarding-ui.tsx');
  const overview = ui.slice(ui.indexOf("show('overview')"), ui.indexOf("show('connect')"));
  const details = overview.slice(overview.indexOf('<details'), overview.indexOf('</details>'));
  assert.match(overview, /<p>생성일 \{formatKstFull\(connection\.createdAt\)\}<\/p>/);
  assert.equal(details.includes('생성일'), false);
});
