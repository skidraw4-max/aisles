import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseServiceTab, SERVICE_TABS, serviceTabHref } from './service-detail-tabs-model';

test('I-051: five service areas in order, 개요 first', () => {
  assert.deepEqual(SERVICE_TABS.map((t) => t.label), ['개요', '연결 설정', '관찰 결과', '심사·개선', '기록']);
});

test('I-051: ?tab= falls back to overview for missing or unknown values', () => {
  assert.equal(parseServiceTab(undefined), 'overview');
  assert.equal(parseServiceTab('nope'), 'overview');
  assert.equal(parseServiceTab(['connect', 'review']), 'connect');
  for (const t of SERVICE_TABS) assert.equal(parseServiceTab(t.key), t.key);
});

test('I-051: tab links keep the service path; overview has no query', () => {
  assert.doesNotMatch(serviceTabHref('c1', 'overview'), /tab=/);
  assert.match(serviceTabHref('c1', 'results'), /\/services\/c1\?tab=results$/);
});
