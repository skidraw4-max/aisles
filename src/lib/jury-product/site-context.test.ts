import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeProviderConfig, normalizeSiteContext, readSiteContext, saveSiteContext, type SiteContextStore } from './site-context';

const now = new Date('2026-10-28T00:00:00Z');
const base = { siteType: 'commerce', primaryUsers: ' 회원 ', coreTasks: '제품 찾기\n\n장바구니\n결제\n넷째', brandTraits: '녹색 톤', referenceUrl: '' };

test('normalize: trims, caps tasks at 3, rejects bad type/url/secret', () => {
  const r = normalizeSiteContext(base, now);
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.value.primaryUsers, '회원'); assert.deepEqual(r.value.coreTasks, ['제품 찾기', '장바구니', '결제']); assert.equal(r.value.referenceUrl, null); }
  assert.deepEqual(normalizeSiteContext({ ...base, siteType: 'x' }, now), { ok: false, reason: 'INVALID_SITE_TYPE' });
  assert.deepEqual(normalizeSiteContext({ ...base, referenceUrl: 'javascript:alert(1)' }, now), { ok: false, reason: 'INVALID_URL' });
  assert.deepEqual(normalizeSiteContext({ ...base, referenceUrl: 'https://u:p@x.com' }, now), { ok: false, reason: 'INVALID_URL' });
  assert.deepEqual(normalizeSiteContext({ ...base, brandTraits: 'password=1' }, now), { ok: false, reason: 'SECRET_LIKE' });
});

test('merge keeps ga4; read is tolerant', () => {
  const merged = mergeProviderConfig({ ga4: { propertyId: '1' } }, { siteContext: { siteType: 'saas' } });
  assert.deepEqual((merged as { ga4: unknown }).ga4, { propertyId: '1' });
  assert.equal(readSiteContext(null), null);
  assert.equal(readSiteContext({ siteContext: { siteType: 'nope' } }), null);
  assert.equal(readSiteContext(merged)?.siteType, 'saas');
});

function store(status = 'CONNECTED') {
  const saved: unknown[] = [];
  const s: SiteContextStore = {
    async findConnection(tenantId, id) { return tenantId === 't1' && id === 'c1' ? { id, tenantId, serviceKey: 'k', status } : null; },
    async saveSiteContext(row) { saved.push(row); },
    async audit() {},
  };
  return { s, saved };
}
const actor = (role: string) => ({ ok: true, userId: 'u', tenantId: 't1', role, organizationId: 'o' }) as never;

test('save: permission, tenant, deleted', async () => {
  const a = store();
  assert.deepEqual(await saveSiteContext({ actor: { ok: false, reason: 'UNAUTHENTICATED' } as never, connectionId: 'c1', input: base, store: a.s, now }), { ok: false, reason: 'UNAUTHENTICATED' });
  assert.equal((await saveSiteContext({ actor: actor('OWNER'), connectionId: 'other', input: base, store: a.s, now })).ok, false);
  const d = store('DISCONNECTED');
  assert.deepEqual(await saveSiteContext({ actor: actor('OWNER'), connectionId: 'c1', input: base, store: d.s, now }), { ok: false, reason: 'CONNECTION_DELETED' });
});

test('ga4 save merges providerConfig instead of overwriting', () => {
  const src = readFileSync('src/lib/jury-product/services/ga4-viewer/service.ts', 'utf8');
  assert.ok(src.includes('mergeProviderConfig(current?.providerConfig, { ga4:'));
});
