/**
 * Run: node --import tsx --test src/lib/jury-product/organization-security.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import {
  commitMemberRemovalWithServiceCleanup,
  commitMemberRoleWithoutServiceChange,
  serviceAccessCounts,
  type CleanupGrant,
  type MemberCleanupDb,
} from './member-service-cleanup';
import { authorizeJuryServiceFeature } from './service-feature-authorization';
import { hasJuryServicePermission } from './service-member-management';
import { planChangeServicePermission } from './service-member-management';
import type { MemberManagementDb } from './member-management';
import { organizationSecurityOverview } from './organization-security';
import type { JuryMemberRole, JuryMembership } from './records';
import type { JuryServicePermission } from './service-permission';

const now = '2026-10-08T03:00:00.000Z';

function row(userId: string, role: JuryMemberRole, tenantId = 'org-a'): JuryMembership {
  return { id: `mem-${tenantId}-${userId}`, tenantId, userId, role, createdAt: now };
}

function actor(role: JuryMemberRole, userId: string, tenantId = 'org-a'): Extract<JuryActor, { ok: true }> {
  return { ok: true, userId, tenantId, role, membershipId: `mem-${tenantId}-${userId}` };
}

function grant(id: string, tenantId: string, connectionId: string, userId: string, permission: JuryServicePermission): CleanupGrant {
  return { id, tenantId, connectionId, userId, permission };
}

type Store = { members: JuryMembership[]; grants: CleanupGrant[]; audits: unknown[] };

function transaction(store: Store, failAt: 'service-audit' | null = null) {
  return async function run<T>(work: (db: MemberCleanupDb) => Promise<T>): Promise<T> {
    const snapshot: Store = {
      members: store.members.map((item) => ({ ...item })),
      grants: store.grants.map((item) => ({ ...item })),
      audits: [...store.audits],
    };
    const working: Store = {
      members: store.members.map((item) => ({ ...item })),
      grants: store.grants.map((item) => ({ ...item })),
      audits: [...store.audits],
    };
    const db: MemberCleanupDb = {
      async lockTenantMemberships(tenantId) {
        return working.members.filter((item) => item.tenantId === tenantId).map((item) => ({ ...item }));
      },
      async updateRole(id, role) {
        const target = working.members.find((item) => item.id === id);
        if (target) target.role = role;
      },
      async deleteMembership(id) {
        working.members = working.members.filter((item) => item.id !== id);
      },
      async listUserGrants(tenantId, userId) {
        return working.grants.filter((item) => item.tenantId === tenantId && item.userId === userId).map((item) => ({ ...item }));
      },
      async deleteUserGrants(tenantId, userId) {
        working.grants = working.grants.filter((item) => item.tenantId !== tenantId || item.userId !== userId);
      },
      async appendAudit(event) {
        working.audits.push(event);
      },
      async appendServiceAudit(event) {
        if (failAt === 'service-audit') throw new Error('audit failed');
        working.audits.push(event);
      },
    };
    try {
      const result = await work(db);
      store.members = working.members;
      store.grants = working.grants;
      store.audits = working.audits;
      return result;
    } catch (error) {
      store.members = snapshot.members;
      store.grants = snapshot.grants;
      store.audits = snapshot.audits;
      throw error;
    }
  };
}

test('removing a member clears only that organization service access', async () => {
  const store: Store = {
    members: [row('owner', 'OWNER'), row('dev', 'DEVELOPER'), row('dev', 'DEVELOPER', 'org-b')],
    grants: [
      grant('ga', 'org-a', 'svc-a', 'dev', 'AGENT'),
      grant('gb', 'org-a', 'svc-b', 'dev', 'VIEW'),
      grant('gx', 'org-b', 'svc-x', 'dev', 'AGENT'),
      grant('other', 'org-a', 'svc-a', 'owner', 'VIEW'),
    ],
    audits: [],
  };
  const result = await transaction(store)((db) => commitMemberRemovalWithServiceCleanup({
    actor: actor('OWNER', 'owner'),
    targetUserId: 'dev',
    now,
    requestedTenantId: 'org-b',
    actingUserId: 'owner',
    actorRole: 'ADMIN',
  }, db));
  assert.equal(result.ok, true);
  assert.equal(store.members.some((item) => item.tenantId === 'org-a' && item.userId === 'dev'), false);
  assert.equal(store.members.some((item) => item.tenantId === 'org-b' && item.userId === 'dev'), true);
  assert.equal(store.grants.some((item) => item.tenantId === 'org-a' && item.userId === 'dev'), false);
  assert.equal(store.grants.some((item) => item.id === 'gx'), true);
  assert.equal(store.grants.some((item) => item.id === 'other'), true);
  if (result.ok) {
    assert.equal(result.audit.action, 'MEMBERSHIP_REMOVED');
    assert.deepEqual(result.serviceAudits.map((item) => item.provenance.previousPermission).sort(), ['AGENT', 'VIEW']);
    const serialized = JSON.stringify(result);
    for (const secret of ['password', 'token', 'credential', 'apiKey', 'secret']) {
      assert.equal(serialized.toLowerCase().includes(secret), false, secret);
    }
  }
  assert.equal(hasJuryServicePermission({
    membership: null,
    connection: { id: 'svc-a', tenantId: 'org-a' },
    grants: [grant('ga', 'org-a', 'svc-a', 'dev', 'AGENT')],
    required: 'VIEW',
  }), false);
});

test('a failed cleanup transaction leaves membership and service grants together', async () => {
  const store: Store = {
    members: [row('owner', 'OWNER'), row('dev', 'DEVELOPER')],
    grants: [grant('ga', 'org-a', 'svc-a', 'dev', 'AGENT')],
    audits: [],
  };
  await assert.rejects(() => transaction(store, 'service-audit')((db) => commitMemberRemovalWithServiceCleanup({
    actor: actor('OWNER', 'owner'),
    targetUserId: 'dev',
    now,
  }, db)));
  assert.equal(store.members.some((item) => item.userId === 'dev'), true);
  assert.equal(store.grants.some((item) => item.id === 'ga'), true);
  assert.equal(store.audits.length, 0);
});

test('role changes do not rewrite service grants and services stay independent', async () => {
  const store: Store = {
    members: [row('owner', 'OWNER'), row('dev', 'DEVELOPER')],
    grants: [grant('ga', 'org-a', 'svc-a', 'dev', 'AGENT'), grant('gb', 'org-a', 'svc-b', 'dev', 'VIEW')],
    audits: [],
  };
  const roleDb: MemberManagementDb = {
    async lockTenantMemberships(tenantId) {
      return store.members.filter((item) => item.tenantId === tenantId);
    },
    async updateRole(id, role) {
      const target = store.members.find((item) => item.id === id);
      if (target) target.role = role;
    },
    async deleteMembership() {
      throw new Error('role change must not delete membership');
    },
    async appendAudit(event) {
      store.audits.push(event);
    },
  };
  const changed = await commitMemberRoleWithoutServiceChange({
    actor: actor('OWNER', 'owner'),
    targetUserId: 'dev',
    role: 'REVIEWER',
    now,
  }, roleDb);
  assert.equal(changed.ok, true);
  assert.deepEqual(store.grants.map((item) => item.permission), ['AGENT', 'VIEW']);
  const permission = planChangeServicePermission({
    actor: actor('OWNER', 'owner'),
    connection: { id: 'svc-a', tenantId: 'org-a', displayName: 'A' },
    members: store.members,
    grants: store.grants.map((item) => ({ ...item })),
    targetUserId: 'dev',
    permission: 'REVIEW',
    requestedTenantId: 'org-b',
    actingUserId: 'stranger',
    actorRole: 'VIEWER',
  });
  assert.equal(permission.ok, true);
  if (permission.ok) {
    assert.equal(permission.permission, 'REVIEW');
    assert.equal(permission.audit.provenance.previousPermission, 'AGENT');
    assert.equal(permission.audit.provenance.serviceConnectionId, 'svc-a');
    assert.equal(store.grants.find((item) => item.connectionId === 'svc-b')?.permission, 'VIEW');
    const text = JSON.stringify(permission.audit);
    assert.equal(text.toLowerCase().includes('password'), false);
    assert.equal(text.toLowerCase().includes('credential'), false);
  }
});

test('role plus service permission still follows the existing feature policy', () => {
  const cases: Array<[JuryMemberRole, JuryServicePermission, 'improvement.write' | 'agent.execute', boolean]> = [
    ['VIEWER', 'AGENT', 'agent.execute', false],
    ['REVIEWER', 'IMPROVE', 'improvement.write', false],
    ['DEVELOPER', 'VIEW', 'improvement.write', false],
    ['DEVELOPER', 'REVIEW', 'improvement.write', false],
    ['DEVELOPER', 'AGENT', 'agent.execute', true],
    ['ADMIN', 'AGENT', 'agent.execute', true],
    ['OWNER', 'AGENT', 'agent.execute', true],
    ['OWNER', 'VIEW', 'agent.execute', false],
    ['ADMIN', 'VIEW', 'agent.execute', false],
  ];
  for (const [role, permission, feature, expected] of cases) {
    const decision = authorizeJuryServiceFeature({
      actor: actor(role, 'user-1'),
      membership: { tenantId: 'org-a', userId: 'user-1' },
      connection: { id: 'svc-a', tenantId: 'org-a' },
      grants: [grant('g', 'org-a', 'svc-a', 'user-1', permission)],
      feature,
      clientTenantId: 'org-b',
      actingUserId: 'owner',
      actorRole: 'OWNER',
      permission: 'AGENT',
      capability: 'agent.execute',
    });
    assert.equal(decision.ok, expected, `${role} ${permission} ${feature}`);
  }
});

test('service access counts stay inside the current organization', () => {
  const counts = serviceAccessCounts([
    { tenantId: 'org-a', userId: 'dev', connectionId: 'svc-a' },
    { tenantId: 'org-a', userId: 'dev', connectionId: 'svc-a' },
    { tenantId: 'org-a', userId: 'dev', connectionId: 'svc-b' },
    { tenantId: 'org-b', userId: 'dev', connectionId: 'svc-x' },
  ], 'org-a');
  assert.equal(counts.dev, 2);
  assert.equal(counts['svc-x'], undefined);
});

test('security overview is read only and organization pages ignore url identity', () => {
  const overview = organizationSecurityOverview();
  assert.equal(overview.dangerZone[0]?.value, 'Not available yet');
  assert.equal(overview.organizationAccess.find((item) => item.label === 'Invitation expiry')?.value, '7 days');
  for (const section of Object.values(overview)) {
    assert.equal(section.every((item) => item.mutable === false), true);
  }
  for (const file of [
    'src/app/(root)/jury/organization/security/page.tsx',
    'src/app/(root)/jury/organization/members/page.tsx',
    'src/app/(root)/jury/organization/services/page.tsx',
  ]) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.equal(source.includes('searchParams'), false, file);
    assert.equal(source.includes('tenantId='), false, file);
  }
  const security = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/organization/security/page.tsx'), 'utf8');
  const members = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/organization/members/page.tsx'), 'utf8');
  const services = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/organization/services/page.tsx'), 'utf8');
  const controls = readFileSync(path.resolve(process.cwd(), 'src/components/jury/JuryMemberControls.tsx'), 'utf8');
  const chrome = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const db = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/jury-db.ts'), 'utf8');
  assert.match(security, /Organization security/);
  assert.match(security, /cannot be changed here/);
  assert.match(members, /Service access/);
  assert.match(members, /countOrganizationServiceAccess/);
  assert.match(services, /Members:/);
  assert.match(controls, /also remove their access to services in this organization/);
  assert.match(chrome, /juryHref\('\/organization\/security'\)/);
  assert.equal(db.includes('juryServiceMember.delete'), false);
  assert.equal(db.includes('juryServiceMember.create'), false);
  const gate = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/product-change-gate.ts'), 'utf8');
  const rereview = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/product-change-gate-rereview.ts'), 'utf8');
  assert.equal(gate.includes('evaluateChangeGate'), true);
  assert.equal(gate.includes('member-service-cleanup'), false);
  assert.equal(rereview.includes('evaluateHumanReReview'), true);
  assert.equal(rereview.includes('runReviewBoardPipeline'), false);
});
