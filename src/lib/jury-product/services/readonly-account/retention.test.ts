import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destroyCredentialManually, purgeExpiredCredentials, READONLY_ACCOUNT_RETENTION_AUDIT, type CredentialRow, type RetentionStore } from './retention';
import { handleReadonlyAccountPurge } from './retention-route';

function mockStore(rows: (CredentialRow & { expiresAt: number; destroyed?: boolean; boom?: boolean })[]) {
  const audits: { action: string; actor: string; tenantId: string }[] = [];
  const store: RetentionStore = {
    async listExpired(now, limit) { return rows.filter((r) => !r.destroyed && r.expiresAt <= now.getTime()).slice(0, limit); },
    async findActive(tenantId, connectionId) { return rows.find((r) => !r.destroyed && r.tenantId === tenantId && r.connectionId === connectionId) ?? null; },
    async destroy(row) {
      const r = rows.find((x) => x.id === row.id)!;
      if (r.boom) throw new Error('db');
      if (r.destroyed) return false;
      r.destroyed = true;
      return true;
    },
    async audit(e) { audits.push({ action: e.action, actor: e.actor, tenantId: e.tenantId }); },
  };
  return { store, audits, rows };
}
const row = (id: string, expiresAt: number, extra = {}) => ({ id, tenantId: 't1', connectionId: `c-${id}`, serviceKey: 'svc', expiresAt, ...extra });

test('purge destroys only expired rows, audits each, counts failures', async () => {
  const m = mockStore([row('a', 1), row('b', 5), row('c', 99), row('d', 2, { boom: true })]);
  const res = await purgeExpiredCredentials(m.store, new Date(10));
  assert.deepEqual(res, { scanned: 3, destroyed: 2, failed: 1 });
  assert.deepEqual(m.audits.map((a) => a.action), [READONLY_ACCOUNT_RETENTION_AUDIT.EXPIRED_DESTROYED, READONLY_ACCOUNT_RETENTION_AUDIT.EXPIRED_DESTROYED]);
  assert.equal(m.rows.find((r) => r.id === 'c')!.destroyed, undefined);
  assert.deepEqual(await purgeExpiredCredentials(m.store, new Date(10)), { scanned: 1, destroyed: 0, failed: 1 });
});

test('manual destroy requires connection.write in the same tenant', async () => {
  const m = mockStore([row('a', 999)]);
  assert.deepEqual(await destroyCredentialManually({ actor: { ok: false, reason: 'UNAUTHENTICATED' } as never, connectionId: 'c-a', store: m.store }), { ok: false, reason: 'UNAUTHENTICATED' });
  assert.deepEqual(await destroyCredentialManually({ actor: { ok: true, userId: 'u', tenantId: 't1', role: 'VIEWER' } as never, connectionId: 'c-a', store: m.store }), { ok: false, reason: 'FORBIDDEN' });
  assert.deepEqual(await destroyCredentialManually({ actor: { ok: true, userId: 'u', tenantId: 't2', role: 'OWNER' } as never, connectionId: 'c-a', store: m.store }), { ok: false, reason: 'NOT_FOUND' });
  assert.deepEqual(await destroyCredentialManually({ actor: { ok: true, userId: 'u', tenantId: 't1', role: 'ADMIN' } as never, connectionId: 'c-a', store: m.store }), { ok: true });
  assert.deepEqual(m.audits, [{ action: READONLY_ACCOUNT_RETENTION_AUDIT.MANUAL_DESTROYED, actor: 'u', tenantId: 't1' }]);
});

test('purge route handler: auth, disabled switch, and run', async () => {
  const m = mockStore([row('a', 1)]);
  const deps = (o: Partial<Parameters<typeof handleReadonlyAccountPurge>[1]>) => ({ secret: 's3', enabled: true, loadStore: async () => m.store, now: () => new Date(10), ...o });
  assert.equal((await handleReadonlyAccountPurge('Bearer s3', deps({ secret: undefined }))).status, 401);
  assert.equal((await handleReadonlyAccountPurge('Bearer nope', deps({}))).status, 401);
  assert.deepEqual(await handleReadonlyAccountPurge('Bearer s3', deps({ enabled: false })), { status: 200, body: { ok: true, skipped: 'DISABLED' } });
  assert.deepEqual(await handleReadonlyAccountPurge('Bearer s3', deps({})), { status: 200, body: { ok: true, scanned: 1, destroyed: 1, failed: 0 } });
  assert.equal((await handleReadonlyAccountPurge('Bearer s3', deps({ loadStore: async () => { throw new Error('x'); } }))).status, 500);
});
