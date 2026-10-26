import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoveryMenuText, displayText, userLabel, userLabels } from '@/lib/jury-product/ui-labels';
import { restoreServiceTabUrl, serviceTabMemoryKey } from './service-detail-tabs-model';

const dir = 'src/app/(jury)/jury/';
const read = (f: string) => readFileSync(dir + f, 'utf8');

test('I-052: raw enum and status values render in Korean', () => {
  assert.equal(displayText('READ_ONLY'), '읽기 전용');
  assert.equal(displayText('READ'), '읽기');
  assert.equal(userLabel('active'), '사용 중');
  assert.equal(userLabel('idle'), '대기');
  assert.equal(userLabel('ACTIVE'), '사용 중');
  assert.equal(displayText('APPROVED'), '승인됨');
  assert.equal(displayText('AVAILABLE'), '사용 가능');
  assert.equal(userLabels(['DISCOVERY', 'READ', 'EVIDENCE']), '서비스 확인, 읽기, 검증 근거');
  assert.equal(displayText('readonly.pagesObserved'), '관찰 페이지 수');
});

test('I-052: discovery menus built from a URL serviceKey drop the stray leading slash', () => {
  assert.equal(discoveryMenuText('/https://sidesync.io/'), 'https://sidesync.io/');
  assert.equal(discoveryMenuText('/admin'), '/admin');
  const ui = read('service-onboarding-ui.tsx');
  assert.ok(ui.includes('discovery.menus.map(discoveryMenuText)'));
});

test('I-052: tab survives server-action redirects via a client-only memory', () => {
  assert.equal(serviceTabMemoryKey('c1'), 'jury-service-tab:c1');
  assert.equal(restoreServiceTabUrl('https://x/jury/services/c1?result=OK', 'results'), '/jury/services/c1?result=OK&tab=results');
  assert.equal(restoreServiceTabUrl('https://x/jury/services/c1?result=OK&tab=connect', 'results'), null);
  assert.equal(restoreServiceTabUrl('https://x/jury/services/c1', 'results'), null);
  assert.equal(restoreServiceTabUrl('https://x/jury/services/c1?result=OK', 'overview'), null);
  assert.equal(restoreServiceTabUrl('https://x/jury/services/c1?result=OK', 'bogus'), null);
  const page = read('services/[connectionId]/page.tsx');
  assert.ok(page.includes('<ServiceTabMemory connectionId={connectionId} tab={tab} />'));
});

test('I-052: page layout — results first, no repeated name, technical strings collapsed', () => {
  const page = read('services/[connectionId]/page.tsx');
  const result = page.indexOf('view="result"');
  const detail = page.indexOf('<ServiceOperationDetail');
  assert.ok(result > 0 && result < detail);
  const ui = read('service-onboarding-ui.tsx');
  assert.doesNotMatch(ui, /<p>서비스 이름 /);
  assert.doesNotMatch(ui, /<p>contentHash |<p>adapter |<p>purpose |collection status|readOnly \{|piiExcluded \{/);
  assert.ok(ui.includes('<summary>기술 정보</summary>'));
  const ops = read('service-operations-ui.tsx');
  assert.doesNotMatch(ops, /<p>GA4 \{model\.evidence\.ga4\}<\/p>/);
  assert.ok(ops.includes('근거 수집 시각'));
  assert.ok(ops.includes('styles.serviceNextAction'));
});

test('I-052: page copy uses 해요체', () => {
  for (const f of ['service-onboarding-ui.tsx', 'service-operations-ui.tsx', 'ReadOnlyAccountCredentialForm.tsx']) {
    assert.doesNotMatch(read(f), /[가-힣]니다[.'"<]/, f);
  }
});
