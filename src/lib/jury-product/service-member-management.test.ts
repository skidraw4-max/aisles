import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { JuryActor } from './access';
import { planMemberRoleChange } from './member-management';
import type { JuryMemberRole, JuryMembership } from './records';
import { decideServicePermission } from './service-permission';
import {
  commitAddServiceMember,
  commitChangeServicePermission,
  commitRemoveServiceMember,
  hasJuryServicePermission,
  highestServicePermission,
  planAddServiceMember,
  projectServiceAccess,
  servicePermissionSatisfies,
  type ServiceConnectionRow,
  type ServiceGrantRow,
  type ServiceMemberDb,
} from './service-member-management';

const now = '2026-10-08T00:00:00.000Z';

function actor(role: JuryMemberRole, userId = 'owner', tenantId = 'org-a'): JuryActor {
  return { ok: true, userId, tenantId, role, membershipId: `mem-${userId}` };
}

function member(userId: string, role: JuryMemberRole, tenantId = 'org-a'): JuryMembership {
  return { id: `mem-${tenantId}-${userId}`, tenantId, userId, role, createdAt: now };
}

function connection(id: string, tenantId = 'org-a', displayName = id): ServiceConnectionRow {
  return { id, tenantId, displayName };
}

function grant(id: string, connectionId: string, userId: string, permission: ServiceGrantRow['permission'], tenantId = 'org-a'): ServiceGrantRow {
  return { id, tenantId, connectionId, userId, permission };
}

function memory(seed: { connections: ServiceConnectionRow[]; members: JuryMembership[]; grants: ServiceGrantRow[] }) {
  const connections = seed.connections.map((row) => ({ ...row }));
  const members = seed.members.map((row) => ({ ...row }));
  let grants = seed.grants.map((row) => ({ ...row }));
  const audits: unknown[] = [];
  const scopes = [{ id: 'scope-1', grants: ['GA4_READ'] }];
  const db: ServiceMemberDb = {
    async lockConnection(tenantId, connectionId) {
      return connections.find((row) => row.id === connectionId && row.tenantId === tenantId) ?? null;
    },
    async listMemberships(tenantId) {
      return members.filter((row) => row.tenantId === tenantId);
    },
    async listGrants(tenantId, connectionId) {
      return grants.filter((row) => row.tenantId === tenantId && row.connectionId === connectionId);
    },
    async insertGrant(row) {
      grants.push({ ...row });
    },
    async setGrantPermission(id, permission) {
      const row = grants.find((item) => item.id === id);
      if (row) row.permission = permission;
    },
    async deleteGrants(ids) {
      grants = grants.filter((row) => !ids.includes(row.id));
    },
    async appendAudit(event) {
      audits.push(event);
    },
  };
  return { db, members, scopes, audits, grants: () => grants };
}

test('service lists stay inside the active organization for every role', () => {
  const connections = [connection('svc-a', 'org-a', 'A'), connection('svc-b', 'org-b', 'B')];
  const grants = [grant('g1', 'svc-a', 'viewer', 'VIEW'), grant('g2', 'svc-b', 'viewer', 'AGENT', 'org-b')];
  const members = [
    { ...member('viewer', 'VIEWER'), email: 'viewer@example.com', displayName: 'Viewer' },
    { ...member('viewer', 'VIEWER', 'org-b'), email: 'viewer@example.com', displayName: 'Viewer' },
  ];
  for (const role of ['OWNER', 'ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const listed = projectServiceAccess({ tenantId: 'org-a', connections, grants, members });
    assert.deepEqual(listed.map((row) => row.connectionId), ['svc-a'], role);
    assert.equal(listed[0]?.members.some((row) => row.permission === 'AGENT'), false);
  }
  const switched = projectServiceAccess({ tenantId: 'org-b', connections, grants, members });
  assert.deepEqual(switched.map((row) => row.connectionId), ['svc-b']);
  assert.equal(switched[0]?.members[0]?.permission, 'AGENT');
});

test('only owner and admin add a service member, defaulting to view', async () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    const store = memory({
      connections: [connection('svc-a')],
      members: [member('owner', 'OWNER'), member('admin', 'ADMIN'), member('dev', 'DEVELOPER')],
      grants: [],
    });
    const added = await commitAddServiceMember({
      actor: actor(role, role === 'OWNER' ? 'owner' : 'admin'),
      connectionId: 'svc-a',
      targetUserId: 'dev',
      now,
      requestedTenantId: 'org-b',
      actingUserId: 'intruder',
      actorRole: 'OWNER',
      allocateId: () => `grant-${role}`,
      allocateAuditId: () => `audit-${role}`,
    }, store.db);
    assert.equal(added.ok, true, role);
    if (added.ok) {
      assert.equal(added.grant.permission, 'VIEW');
      assert.equal(added.audit.action, 'SERVICE_MEMBER_ADDED');
      assert.equal(JSON.stringify(added.audit).includes('password'), false);
    }
    assert.equal(store.members.find((row) => row.userId === 'dev')?.role, 'DEVELOPER');
    assert.deepEqual(store.scopes, [{ id: 'scope-1', grants: ['GA4_READ'] }]);
  }
  for (const role of ['REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const denied = planAddServiceMember({
      actor: actor(role, 'member'),
      connection: connection('svc-a'),
      members: [member('member', role), member('dev', 'DEVELOPER')],
      grants: [],
      targetUserId: 'dev',
    });
    assert.equal(denied.ok, false, role);
    if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');
  }
  const outsider = planAddServiceMember({
    actor: actor('OWNER'),
    connection: connection('svc-a'),
    members: [member('owner', 'OWNER')],
    grants: [],
    targetUserId: 'stranger',
  });
  assert.equal(outsider.ok, false);
  if (!outsider.ok) assert.equal(outsider.reason, 'NOT_IN_ORGANIZATION');
});

test('permission changes stay on one service and do not change organization role', async () => {
  const store = memory({
    connections: [connection('svc-a', 'org-a', 'Service A'), connection('svc-b', 'org-a', 'Service B')],
    members: [member('owner', 'OWNER'), member('dev', 'DEVELOPER')],
    grants: [grant('ga', 'svc-a', 'dev', 'VIEW'), grant('gb', 'svc-b', 'dev', 'REVIEW')],
  });
  for (const [from, to] of [['VIEW', 'REVIEW'], ['REVIEW', 'IMPROVE'], ['IMPROVE', 'AGENT']] as const) {
    store.grants().find((row) => row.id === 'ga')!.permission = from;
    const changed = await commitChangeServicePermission({
      actor: actor('OWNER'),
      connectionId: 'svc-a',
      targetUserId: 'dev',
      permission: to,
      now,
      allocateAuditId: () => `audit-${to}`,
    }, store.db);
    assert.equal(changed.ok, true, to);
    assert.equal(store.grants().find((row) => row.id === 'ga')?.permission, to);
  }
  assert.equal(store.grants().find((row) => row.id === 'gb')?.permission, 'REVIEW');
  assert.equal(store.members.find((row) => row.userId === 'dev')?.role, 'DEVELOPER');
  const invalid = planAddServiceMember({
    actor: actor('ADMIN', 'owner'),
    connection: connection('svc-a'),
    members: [member('owner', 'ADMIN'), member('dev', 'DEVELOPER')],
    grants: [],
    targetUserId: 'dev',
    permission: 'SUPER',
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, 'INVALID_PERMISSION');
  const duplicate = planAddServiceMember({
    actor: actor('OWNER'),
    connection: connection('svc-a'),
    members: store.members,
    grants: store.grants(),
    targetUserId: 'dev',
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.reason, 'ALREADY_EXISTS');
});

test('removing service access keeps the organization membership', async () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    const store = memory({
      connections: [connection('svc-a')],
      members: [member('owner', 'OWNER'), member('admin', 'ADMIN'), member('dev', 'DEVELOPER')],
      grants: [grant('g', 'svc-a', 'dev', 'AGENT')],
    });
    const removed = await commitRemoveServiceMember({
      actor: actor(role, role === 'OWNER' ? 'owner' : 'admin'),
      connectionId: 'svc-a',
      targetUserId: 'dev',
      now,
    }, store.db);
    assert.equal(removed.ok, true, role);
    assert.equal(store.grants().length, 0);
    assert.equal(store.members.some((row) => row.userId === 'dev' && row.role === 'DEVELOPER'), true);
    if (removed.ok) assert.equal(removed.audit.provenance.previousPermission, 'AGENT');
  }
  for (const role of ['REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const denied = await commitRemoveServiceMember({
      actor: actor(role, 'member'),
      connectionId: 'svc-a',
      targetUserId: 'dev',
      now,
    }, memory({
      connections: [connection('svc-a')],
      members: [member('member', role), member('dev', 'DEVELOPER')],
      grants: [grant('g', 'svc-a', 'dev', 'VIEW')],
    }).db);
    assert.equal(denied.ok, false, role);
  }
});

test('another organization service cannot be changed', async () => {
  const store = memory({
    connections: [connection('svc-a', 'org-a'), connection('svc-b', 'org-b', 'B')],
    members: [member('owner', 'OWNER'), member('person', 'DEVELOPER'), member('person', 'VIEWER', 'org-b')],
    grants: [grant('gb', 'svc-b', 'person', 'VIEW', 'org-b'), grant('ga', 'svc-a', 'person', 'AGENT')],
  });
  const change = await commitChangeServicePermission({
    actor: actor('ADMIN', 'owner', 'org-a'),
    connectionId: 'svc-b',
    targetUserId: 'person',
    permission: 'AGENT',
    now,
    requestedTenantId: 'org-b',
  }, store.db);
  const remove = await commitRemoveServiceMember({
    actor: actor('ADMIN', 'owner', 'org-a'),
    connectionId: 'svc-b',
    targetUserId: 'person',
    now,
  }, store.db);
  assert.equal(change.ok, false);
  assert.equal(remove.ok, false);
  if (!change.ok) assert.equal(change.reason, 'SERVICE_NOT_FOUND');
  assert.equal(store.grants().find((row) => row.id === 'gb')?.permission, 'VIEW');
  const crossed = planAddServiceMember({
    actor: actor('OWNER', 'owner', 'org-a'),
    connection: connection('svc-b', 'org-b'),
    members: [member('person', 'VIEWER', 'org-b')],
    grants: [],
    targetUserId: 'person',
  });
  assert.equal(crossed.ok, false);
  if (!crossed.ok) assert.equal(crossed.reason, 'TENANT_MISMATCH');
});

test('service permission and organization role stay independent, and access needs both', () => {
  const members = [member('owner', 'OWNER'), member('dev', 'DEVELOPER')];
  const grants = [grant('g', 'svc-a', 'dev', 'AGENT'), grant('other', 'svc-b', 'dev', 'VIEW')];
  const roleChange = planMemberRoleChange({
    actor: actor('OWNER'),
    members,
    targetUserId: 'dev',
    role: 'REVIEWER',
  });
  assert.equal(roleChange.ok, true);
  assert.equal(grants[0]?.permission, 'AGENT');
  assert.equal(members.find((row) => row.userId === 'dev')?.role, 'DEVELOPER');
  const level = highestServicePermission(grants.filter((row) => row.connectionId === 'svc-a'));
  assert.equal(level, 'AGENT');
  assert.equal(grants.find((row) => row.connectionId === 'svc-b')?.permission, 'VIEW');
  const allowed = hasJuryServicePermission({
    membership: { tenantId: 'org-a', userId: 'dev' },
    connection: connection('svc-a'),
    grants,
    required: 'AGENT',
  });
  const orphan = hasJuryServicePermission({
    membership: null,
    connection: connection('svc-a'),
    grants,
    required: 'VIEW',
  });
  const missingConnection = hasJuryServicePermission({
    membership: { tenantId: 'org-a', userId: 'dev' },
    connection: null,
    grants,
    required: 'VIEW',
  });
  assert.equal(allowed, true);
  assert.equal(orphan, false);
  assert.equal(missingConnection, false);
  const exact = decideServicePermission({
    tenantId: 'org-a',
    connectionTenantId: 'org-a',
    userId: 'dev',
    connectionId: 'svc-a',
    permission: 'VIEW',
    grants: [{ connectionId: 'svc-a', userId: 'dev', permission: 'AGENT' }],
  });
  assert.equal(exact.ok, false);
});

test('effective service permission follows the stored level', () => {
  const levels = ['VIEW', 'REVIEW', 'IMPROVE', 'AGENT'] as const;
  for (const actual of levels) {
    for (const required of levels) {
      assert.equal(
        servicePermissionSatisfies(actual, required),
        levels.indexOf(actual) >= levels.indexOf(required),
        `${actual} ${required}`,
      );
    }
  }
  const grants = [grant('g', 'svc-a', 'dev', 'IMPROVE')];
  assert.equal(hasJuryServicePermission({
    membership: { tenantId: 'org-a', userId: 'dev' },
    connection: connection('svc-a'),
    grants,
    required: 'REVIEW',
  }), true);
  assert.equal(hasJuryServicePermission({
    membership: { tenantId: 'org-a', userId: 'dev' },
    connection: connection('svc-a'),
    grants: [grant('g', 'svc-a', 'dev', 'VIEW')],
    required: 'REVIEW',
  }), false);
});

test('service access screen posts to the server and ignores caller identity', () => {
  const page = readFileSync(new URL('../../app/(root)/jury/organization/services/page.tsx', import.meta.url), 'utf8');
  const action = readFileSync(new URL('../../app/(root)/jury/organization/services/actions.ts', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../../app/(root)/jury/ui.tsx', import.meta.url), 'utf8');
  const db = readFileSync(new URL('./jury-db.ts', import.meta.url), 'utf8');
  assert.match(page, /Service access/);
  assert.match(page, /listServiceAccess/);
  assert.match(page, /JuryServiceMemberAdd/);
  assert.match(chrome, /juryHref\('\/organization\/services'\)/);
  assert.match(action, /getJuryActor/);
  assert.match(action, /addServiceMemberRecord/);
  assert.equal(action.includes('searchParams'), false);
  assert.equal(action.includes('formData.get(\'tenantId\')'), false);
  assert.equal(action.includes('formData.get(\'actingUserId\')'), false);
  assert.equal(action.includes('formData.get(\'actorRole\')'), false);
  assert.equal(db.includes('juryServiceMember.create'), false);
  assert.equal(db.includes('juryServiceMember.delete'), false);
});
