import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseServiceTab, SERVICE_TABS, serviceTabHref } from './service-detail-tabs-model';

test('I-051/I-063: service areas in order, 개요 first, 화면 심사 before 심사·개선', () => {
  assert.deepEqual(SERVICE_TABS.map((t) => t.label), ['개요', '연결 설정', '관찰 결과', '화면 심사', '심사·개선', '기록']);
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

test('P5: a clicked tab (?tab= present) is never reverted by the remembered tab', async () => {
  const { restoreServiceTabUrl } = await import('./service-detail-tabs-model');
  assert.equal(restoreServiceTabUrl('/jury/services/c1?tab=screen', 'results'), null);
  assert.equal(restoreServiceTabUrl('/jury/services/c1?tab=screen&result=OK', 'results'), null);
  assert.equal(restoreServiceTabUrl('/jury/services/c1', 'results'), null);
  assert.equal(restoreServiceTabUrl('/jury/services/c1?result=OK', 'screen'), '/jury/services/c1?result=OK&tab=screen');
});

test('P5: remembered tab is single-use and tab links show a pending state', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const read = (f: string) => readFileSync(path.resolve(process.cwd(), 'src/app/(jury)/jury', f), 'utf8');
  const memory = read('service-tab-memory.tsx');
  assert.match(memory, /if \(saved !== null\) \{\s+try \{\s+window\.sessionStorage\.removeItem\(key\);/);
  assert.match(read('service-tab-pending.tsx'), /useLinkStatus\(\)/);
  assert.match(read('service-detail-tabs.tsx'), /<span>\{t\.label\}<\/span>\s+<ServiceTabPending \/>/);
  assert.doesNotMatch(read('jury.module.css'), /pointer-events:\s*none[^}]*serviceTab/);
});
