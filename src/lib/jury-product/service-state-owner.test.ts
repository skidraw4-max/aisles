/** RM-10 (I-008/I-009): OWNER auto-grant on connection create, DISCOVERY_PENDING → CONNECTED on scope approval. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JuryActor } from './access';
import { canActivateFromScopes } from './console-catalog-scope';
import { planOwnerGrants } from './service-owner-grants';
import { isIsolatedLocalTestDb } from './preview-db-guard';

const T = 'rm10-tenant';
const F = 'rm10-foreign';
const NOW = '2026-10-22T07:00:00.000Z';
const ALL = ['VIEW', 'REVIEW', 'IMPROVE', 'AGENT'];

test('planOwnerGrants: OWNERs get full grants, creator gets role-level grants, other tenants ignored', () => {
  const rows = planOwnerGrants({
    tenantId: T,
    connectionId: 'c',
    creatorUserId: 'admin',
    memberships: [
      { tenantId: T, userId: 'owner', role: 'OWNER' },
      { tenantId: T, userId: 'admin', role: 'ADMIN' },
      { tenantId: T, userId: 'viewer', role: 'VIEWER' },
      { tenantId: F, userId: 'foreignOwner', role: 'OWNER' },
    ],
  });
  const by = (u: string) => rows.filter((r) => r.userId === u).map((r) => r.permission).sort();
  assert.deepEqual(by('owner'), [...ALL].sort());
  assert.deepEqual(by('admin'), [...ALL].sort());
  assert.deepEqual(by('viewer'), []);
  assert.deepEqual(by('foreignOwner'), []);
  assert.equal(rows.every((r) => r.tenantId === T && r.connectionId === 'c'), true);
});

test('canActivateFromScopes: needs an APPROVED scope; placeholder PROPOSED does not block', () => {
  assert.equal(canActivateFromScopes(['PROPOSED']), false);
  assert.equal(canActivateFromScopes(['REVOKED']), false);
  assert.equal(canActivateFromScopes(['PROPOSED', 'APPROVED']), true);
});

const dbOk = isIsolatedLocalTestDb(process.env);

test('isolated DB: create grants OWNER, catalog approval moves DISCOVERY_PENDING → CONNECTED, tenant isolation kept', { skip: !dbOk, timeout: 120_000 }, async () => {
  const { prisma } = await import('@/lib/prisma');
  const { persistServiceOnboarding } = await import('./service-onboarding');
  const { persistCatalogScope, persistCatalogScopeDecision } = await import('./console-catalog-scope');
  const users = ['rm10-owner', 'rm10-owner2', 'rm10-viewer', 'rm10-foreign-owner'];
  const cleanup = async () => {
    await prisma.juryServiceMember.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryAuditEvent.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryAccessScope.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryServiceConnection.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryMembership.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryTenant.deleteMany({ where: { id: { in: [T, F] } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  };
  await cleanup();
  try {
    for (const id of users) await prisma.user.create({ data: { id, username: id, email: `${id}@example.invalid` } });
    await prisma.juryTenant.create({ data: { id: T, name: T } });
    await prisma.juryTenant.create({ data: { id: F, name: F } });
    const mships = [
      { id: 'rm10-m1', tenantId: T, userId: 'rm10-owner', role: 'OWNER' as const },
      { id: 'rm10-m2', tenantId: T, userId: 'rm10-owner2', role: 'OWNER' as const },
      { id: 'rm10-m3', tenantId: T, userId: 'rm10-viewer', role: 'VIEWER' as const },
      { id: 'rm10-m4', tenantId: F, userId: 'rm10-foreign-owner', role: 'OWNER' as const },
    ];
    for (const m of mships) await prisma.juryMembership.create({ data: { ...m, createdAt: new Date(NOW) } });
    const actor: JuryActor = { ok: true, userId: 'rm10-owner', tenantId: T, role: 'OWNER', membershipId: 'rm10-m1' };

    const created = await persistServiceOnboarding({
      actor, serviceKey: 'rm10svc', displayName: 'RM10', accessMethod: 'FILE_UPLOAD', credentialRef: 'vault://rm10/ref', now: NOW,
    } as Parameters<typeof persistServiceOnboarding>[0]);
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;
    assert.equal(created.status, 'DISCOVERY_PENDING');
    const grants = await prisma.juryServiceMember.findMany({ where: { connectionId: created.connectionId } });
    const perms = (u: string) => grants.filter((g) => g.userId === u).map((g) => g.permission).sort();
    assert.deepEqual(perms('rm10-owner'), [...ALL].sort(), 'creator OWNER can access immediately');
    assert.deepEqual(perms('rm10-owner2'), [...ALL].sort(), 'other OWNER of the same org too');
    assert.deepEqual(perms('rm10-viewer'), [], 'non-owner gets nothing automatically');
    assert.deepEqual(perms('rm10-foreign-owner'), [], 'foreign-tenant OWNER never granted');
    assert.equal(grants.every((g) => g.tenantId === T), true);

    // idempotent re-create returns existing, no duplicate grants
    const again = await persistServiceOnboarding({
      actor, serviceKey: 'rm10svc', displayName: 'RM10', accessMethod: 'FILE_UPLOAD', credentialRef: 'vault://rm10/ref', now: NOW,
    } as Parameters<typeof persistServiceOnboarding>[0]);
    assert.equal(again.ok && again.created, false);
    assert.equal(await prisma.juryServiceMember.count({ where: { connectionId: created.connectionId } }), grants.length);

    // placeholder PROPOSED scope (mock discovery shape) must not block activation
    await prisma.juryAccessScope.create({
      data: { id: 'rm10-placeholder', tenantId: T, connectionId: created.connectionId, status: 'PROPOSED', grants: [{ resource: 'metric:rm10svc.routes', mode: 'READ' }] },
    });
    const base = { userId: 'rm10-owner', memberships: mships.map((m) => ({ ...m, createdAt: NOW })), now: NOW };
    const proposed = await persistCatalogScope({ ...base, connectionId: created.connectionId, metric: 'newUsersLast7d' } as Parameters<typeof persistCatalogScope>[0]);
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    if (!proposed.ok) return;
    const approved = await persistCatalogScopeDecision({ ...base, scopeId: proposed.scopeId, decision: 'APPROVE' } as Parameters<typeof persistCatalogScopeDecision>[0]);
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const conn = await prisma.juryServiceConnection.findUnique({ where: { id: created.connectionId } });
    assert.equal(conn?.status, 'CONNECTED');
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: T, action: 'SERVICE_CONNECTION_ACTIVATED' } }), 1);

    // foreign tenant cannot approve/activate across tenants
    const foreignTry = await persistCatalogScopeDecision({
      userId: 'rm10-foreign-owner', memberships: [{ ...mships[3]!, createdAt: NOW }], now: NOW, scopeId: proposed.scopeId, decision: 'APPROVE',
    } as Parameters<typeof persistCatalogScopeDecision>[0]);
    assert.equal(foreignTry.ok, false);
  } finally {
    await cleanup();
  }
});
