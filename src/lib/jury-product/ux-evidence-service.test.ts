import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidenceServiceFilter, evidenceServiceInfo, serviceDomain } from './evidence-service';

const conn = (id: string, displayName: string, serviceKey: string, status: string) => ({ id, tenantId: 't', displayName, serviceKey, status } as never);
const view = { tenantId: 't', connections: [conn('a', '나단', 'https://shop.example.com/x', 'CONNECTED'), conn('b', '가단', 'svc-key', 'LIMITED'), conn('c', '다단', 'old', 'DISCONNECTED')] } as never;

test('domain: URL host or raw key', () => {
  assert.equal(serviceDomain('https://shop.example.com/x'), 'shop.example.com');
  assert.equal(serviceDomain('svc-key'), 'svc-key');
});
test('info: deleted flag and missing', () => {
  assert.equal(evidenceServiceInfo(view, 'c')?.deleted, true);
  assert.equal(evidenceServiceInfo(view, 'zz'), null);
});
test('filter: active by name, deleted last, hidden for one service', () => {
  const f = evidenceServiceFilter(view, ['a', 'c', 'b', 'a']);
  assert.deepEqual(f.options, ['b', 'a', 'c']);
  assert.match(f.labelOf('c'), /삭제/);
  assert.deepEqual(evidenceServiceFilter(view, ['a', 'a']).options, []);
});
test('evidence table copy', () => {
  const src = readFileSync('src/app/(jury)/jury/ui.tsx', 'utf8');
  assert.ok(src.includes('<th>서비스</th>\n            <th>분석 목적</th>'));
  assert.ok(src.includes('삭제된 서비스라 새 심사를 할 수 없어요.'));
  assert.ok(src.includes('서비스 정보 없음'));
});
