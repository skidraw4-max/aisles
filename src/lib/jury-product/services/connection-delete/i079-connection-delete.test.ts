import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { JuryActor } from '../../access';
import {
  confirmationMatches,
  connectionDeleteMessage,
  deleteServiceConnection,
  type ConnectionDeleteStore,
  type DeletableConnection,
} from './delete';
import { isDeletedConnection } from './active-guard';
import { filterConnectionRows } from './list-filter';

const actor = (role: string, tenantId = 't1'): JuryActor => ({ ok: true, userId: 'u1', tenantId, role } as unknown as JuryActor);

function fakeStore(conn: DeletableConnection | null, shots = [{ id: 'e1', storageKey: 't1/a1/x.jpg' }]) {
  const calls: string[] = [];
  let keys = [...shots];
  const store: ConnectionDeleteStore = {
    async findConnection(tenantId, id) { return conn && conn.tenantId === tenantId && conn.id === id ? conn : null; },
    async listScreenshotKeys() { return keys; },
    async markScreenshotsDeleted(_t, ids) { calls.push(`mark:${ids.join(',')}`); keys = keys.filter((k) => !ids.includes(k.id)); },
    async disconnect(input) {
      calls.push(`disconnect:${input.userId}`);
      if (conn) conn.status = 'DISCONNECTED';
      return { credentialsDestroyed: 1, consentsRevoked: 2, ownershipRevoked: 1, auditsCancelled: 1, reviewsCancelled: 0 };
    },
  };
  return { store, calls };
}
const conn = (over: Partial<DeletableConnection> = {}): DeletableConnection => ({ id: 'c1', tenantId: 't1', displayName: '에일 서비스', serviceKey: 'svc', accessMethod: 'READ_ONLY_ACCOUNT', status: 'CONNECTED', ...over });
const okSink = () => { const removed: string[] = []; return { removed, sink: { async put() {}, async remove(k: string[]) { removed.push(...k); } } }; };

test('I-079: only OWNER/ADMIN can delete', async () => {
  for (const role of ['REVIEWER', 'DEVELOPER', 'VIEWER']) {
    const { store, calls } = fakeStore(conn());
    const r = await deleteServiceConnection({ actor: actor(role), connectionId: 'c1', confirmName: '에일 서비스', store, sink: null });
    assert.deepEqual(r, { ok: false, reason: 'FORBIDDEN' });
    assert.equal(calls.length, 0);
  }
  const unauth = await deleteServiceConnection({ actor: { ok: false, reason: 'UNAUTHENTICATED' } as unknown as JuryActor, connectionId: 'c1', confirmName: 'x', store: fakeStore(conn()).store, sink: null });
  assert.deepEqual(unauth, { ok: false, reason: 'UNAUTHENTICATED' });
});

test('I-079: other tenant connection is NOT_FOUND; client tenant ignored', async () => {
  const { store, calls } = fakeStore(conn({ tenantId: 't2' }));
  const r = await deleteServiceConnection({ actor: actor('OWNER'), connectionId: 'c1', confirmName: '에일 서비스', clientTenantId: 't2', store, sink: null });
  assert.deepEqual(r, { ok: false, reason: 'NOT_FOUND' });
  assert.equal(calls.length, 0);
});

test('I-079: typed name must match exactly (trim/NFC only)', async () => {
  assert.equal(confirmationMatches('에일 서비스', ' 에일 서비스 '), true);
  assert.equal(confirmationMatches('에일 서비스', '에일서비스'), false);
  assert.equal(confirmationMatches('', ''), false);
  const { store, calls } = fakeStore(conn());
  const r = await deleteServiceConnection({ actor: actor('ADMIN'), connectionId: 'c1', confirmName: '에일', store, sink: null });
  assert.deepEqual(r, { ok: false, reason: 'NAME_MISMATCH' });
  assert.equal(calls.length, 0);
});

test('I-079: delete revokes, then purges screenshots; second call is idempotent', async () => {
  const c = conn();
  const { store, calls } = fakeStore(c);
  const { sink, removed } = okSink();
  const r = await deleteServiceConnection({ actor: actor('OWNER'), connectionId: 'c1', confirmName: '에일 서비스', store, sink });
  assert.equal(r.ok && r.state, 'DELETED');
  assert.ok(r.ok && !r.screenshotsPending && r.screenshotsDeleted === 1 && r.counts?.consentsRevoked === 2);
  assert.deepEqual(calls, ['disconnect:u1', 'mark:e1']);
  assert.deepEqual(removed, ['t1/a1/x.jpg']);
  const again = await deleteServiceConnection({ actor: actor('OWNER'), connectionId: 'c1', confirmName: '', store, sink });
  assert.equal(again.ok && again.state, 'ALREADY_DELETED');
  assert.equal(calls.filter((x) => x.startsWith('disconnect')).length, 1);
});

test('I-079: storage failure still revokes and reports pending; retry purges', async () => {
  const { store } = fakeStore(conn());
  const bad = { async put() {}, async remove() { throw new Error('x'); } };
  const r = await deleteServiceConnection({ actor: actor('OWNER'), connectionId: 'c1', confirmName: '에일 서비스', store, sink: bad });
  assert.ok(r.ok && r.state === 'DELETED' && r.screenshotsPending);
  assert.match(connectionDeleteMessage(r), /화면 캡처를 아직 지우지 못했어요/);
  const retry = await deleteServiceConnection({ actor: actor('OWNER'), connectionId: 'c1', confirmName: '', store, sink: okSink().sink });
  assert.ok(retry.ok && retry.state === 'ALREADY_DELETED' && !retry.screenshotsPending && retry.screenshotsDeleted === 1);
});

test('I-079: GitHub connection result carries the uninstall notice', async () => {
  const { store } = fakeStore(conn({ serviceKey: 'github-123' }), []);
  const r = await deleteServiceConnection({ actor: actor('OWNER'), connectionId: 'c1', confirmName: '에일 서비스', store, sink: okSink().sink });
  assert.ok(r.ok && r.githubUninstallNeeded);
  assert.match(connectionDeleteMessage(r), /GitHub 설정에서 직접 제거/);
});

test('I-079: store errors return FAILED without leaking details', async () => {
  const { store } = fakeStore(conn());
  store.disconnect = async () => { throw new Error('db secret detail'); };
  const r = await deleteServiceConnection({ actor: actor('OWNER'), connectionId: 'c1', confirmName: '에일 서비스', store, sink: null });
  assert.deepEqual(r, { ok: false, reason: 'FAILED' });
  assert.doesNotMatch(connectionDeleteMessage(r), /secret/);
});

test('I-079: deleted connections are blocked from new actions', async () => {
  assert.equal(await isDeletedConnection(actor('OWNER'), 'c1', async () => 'DISCONNECTED'), true);
  assert.equal(await isDeletedConnection(actor('OWNER'), 'c1', async () => 'CONNECTED'), false);
  for (const f of ['readonly-account-actions.ts', 'screen-audit-actions.ts', 'phase1-actions.ts']) {
    const src = readFileSync(`src/app/(jury)/jury/${f}`, 'utf8');
    assert.match(src, /isDeletedConnection/, f);
  }
});

test('I-079: list hides deleted by default; filter shows only deleted', () => {
  const rows = [{ connectionStatus: 'CONNECTED' }, { connectionStatus: 'DISCONNECTED' }];
  assert.deepEqual(filterConnectionRows(rows, false), [rows[0]]);
  assert.deepEqual(filterConnectionRows(rows, true), [rows[1]]);
});

test('I-079: Prisma store revokes everything in one transaction and audits counts only', () => {
  const src = readFileSync('src/lib/jury-product/services/connection-delete/delete.ts', 'utf8');
  for (const needle of ["status: 'DISCONNECTED'", 'providerConfig: Prisma.DbNull', 'credentialRef: null', 'ciphertext: null', 'juryConnectionConsent.deleteMany', "status: 'REVOKED'", "state: 'FAILED'", 'disconnectedByUserId', 'juryAuditEvent.create', '$transaction']) {
    assert.ok(src.includes(needle), needle);
  }
  assert.doesNotMatch(src, /juryServiceConnection\.delete\(/);
});

test('I-079: migration is additive and idempotent', () => {
  const sql = readFileSync('prisma/migrations/20261027150000_jury_connection_soft_delete/migration.sql', 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "disconnectedAt"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "disconnectedByUserId"/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE FROM|UPDATE|TRUNCATE)\b/);
});
