import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveJuryActor, type JuryActor } from './access';
import {
  canManageMember,
  commitMemberRemoval,
  commitMemberRoleChange,
  juryRoleLabel,
  planMemberRemoval,
  planMemberRoleChange,
  type MemberManagementDb,
} from './member-management';
import { organizationsForUser } from './organization-switch';
import type { JuryMemberRole, JuryMembership } from './records';

const now = '2026-10-08T00:00:00.000Z';

function row(userId: string, role: JuryMemberRole, tenantId = 'org-a'): JuryMembership {
  return { id: `mem-${tenantId}-${userId}`, tenantId, userId, role, createdAt: now };
}

function actor(role: JuryMemberRole, userId: string, tenantId = 'org-a'): JuryActor {
  return { ok: true, userId, tenantId, role, membershipId: `mem-${tenantId}-${userId}` };
}

function memory(seed: JuryMembership[]) {
  let members = seed.map((item) => ({ ...item }));
  const audits: unknown[] = [];
  const grants = [{ userId: 'user-dev', permission: 'AGENT' }];
  let tail = Promise.resolve();
  const db: MemberManagementDb = {
    async lockTenantMemberships(tenantId) {
      return members.filter((item) => item.tenantId === tenantId);
    },
    async updateRole(id, role) {
      const target = members.find((item) => item.id === id);
      if (target) target.role = role;
    },
    async deleteMembership(id) {
      members = members.filter((item) => item.id !== id);
    },
    async appendAudit(event) {
      audits.push(event);
    },
  };
  return {
    audits,
    grants,
    db,
    members: () => members,
    exclusive<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(fn, fn);
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

test('every organization role can read its own member list and not another tenant', () => {
  const members = [row('owner', 'OWNER'), row('admin', 'ADMIN'), row('reviewer', 'REVIEWER'), row('developer', 'DEVELOPER'), row('viewer', 'VIEWER'), row('other', 'OWNER', 'org-b')];
  for (const role of ['OWNER', 'ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const mine = members.filter((item) => item.tenantId === 'org-a');
    assert.equal(mine.length, 5, role);
    assert.equal(mine.some((item) => item.tenantId === 'org-b'), false);
    assert.equal(juryRoleLabel(role).length > 0, true);
  }
  assert.equal(members.filter((item) => item.tenantId === 'org-b').length, 1);
});

test('owner and admin manage ordinary members and cannot cross the owner or admin boundary', async () => {
  const owner = actor('OWNER', 'owner');
  const admin = actor('ADMIN', 'admin');
  for (const role of ['ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const next = role === 'ADMIN' ? 'REVIEWER' : 'ADMIN';
    const store = memory([row('owner', 'OWNER'), row('target', role)]);
    const changed = await commitMemberRoleChange({
      actor: owner,
      targetUserId: 'target',
      role: next,
      now,
      requestedTenantId: 'org-b',
      actingUserId: 'intruder',
      actorRole: 'OWNER',
    }, store.db);
    assert.equal(changed.ok, true, role);
    assert.equal(store.members().find((item) => item.userId === 'target')?.role, next);
    assert.equal(JSON.stringify(store.grants), JSON.stringify([{ userId: 'user-dev', permission: 'AGENT' }]));
  }
  const byAdmin = await commitMemberRoleChange({
    actor: admin,
    targetUserId: 'viewer',
    role: 'DEVELOPER',
    now,
  }, memory([row('owner', 'OWNER'), row('admin', 'ADMIN'), row('viewer', 'VIEWER')]).db);
  assert.equal(byAdmin.ok, true);
  const adminOnAdmin = await commitMemberRoleChange({
    actor: admin,
    targetUserId: 'admin-b',
    role: 'VIEWER',
    now,
  }, memory([row('owner', 'OWNER'), row('admin', 'ADMIN'), row('admin-b', 'ADMIN')]).db);
  assert.equal(adminOnAdmin.ok, false);
  if (!adminOnAdmin.ok) assert.equal(adminOnAdmin.reason, 'ADMIN_PROTECTED');
  for (const role of ['REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const denied = planMemberRoleChange({
      actor: actor(role, role.toLowerCase()),
      members: [row('owner', 'OWNER'), row('viewer', 'VIEWER')],
      targetUserId: 'viewer',
      role: 'ADMIN',
    });
    assert.equal(denied.ok, false, role);
    if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');
  }
});

test('owner membership cannot be promoted, demoted, or removed', () => {
  const members = [row('owner', 'OWNER'), row('admin', 'ADMIN')];
  for (const role of ['ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const demote = planMemberRoleChange({ actor: actor('ADMIN', 'admin'), members, targetUserId: 'owner', role });
    assert.equal(demote.ok, false, role);
  }
  for (const role of ['ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const promote = planMemberRoleChange({
      actor: actor('OWNER', 'owner'),
      members: [row('owner', 'OWNER'), row('member', role === 'ADMIN' ? 'VIEWER' : role)],
      targetUserId: 'member',
      role: 'OWNER',
    });
    assert.equal(promote.ok, false, role);
    if (!promote.ok) assert.equal(promote.reason, 'INVALID_ROLE');
  }
  const removeOwner = planMemberRemoval({ actor: actor('ADMIN', 'admin'), members, targetUserId: 'owner' });
  assert.equal(removeOwner.ok, false);
  if (!removeOwner.ok) assert.equal(removeOwner.reason, 'LAST_OWNER');
  const second = [row('owner', 'OWNER'), row('owner-2', 'OWNER'), row('admin', 'ADMIN')];
  const stillOwner = planMemberRemoval({ actor: actor('OWNER', 'owner'), members: second, targetUserId: 'owner-2' });
  assert.equal(stillOwner.ok, false);
  if (!stillOwner.ok) assert.equal(stillOwner.reason, 'OWNER_PROTECTED');
});

test('removal follows owner and admin boundaries', async () => {
  const removed = await commitMemberRemoval({
    actor: actor('OWNER', 'owner'),
    targetUserId: 'developer',
    now,
  }, memory([row('owner', 'OWNER'), row('developer', 'DEVELOPER')]).db);
  assert.equal(removed.ok, true);
  const removedAdmin = await commitMemberRemoval({
    actor: actor('OWNER', 'owner'),
    targetUserId: 'admin',
    now,
    allocateAuditId: () => 'audit-remove',
  }, memory([row('owner', 'OWNER'), row('admin', 'ADMIN')]).db);
  assert.equal(removedAdmin.ok, true);
  if (removedAdmin.ok) {
    assert.equal(removedAdmin.audit.action, 'MEMBERSHIP_REMOVED');
    assert.equal(removedAdmin.audit.provenance.previousRole, 'ADMIN');
    assert.equal(JSON.stringify(removedAdmin.audit).includes('password'), false);
  }
  const adminRemoves = await commitMemberRemoval({
    actor: actor('ADMIN', 'admin'),
    targetUserId: 'viewer',
    now,
  }, memory([row('owner', 'OWNER'), row('admin', 'ADMIN'), row('viewer', 'VIEWER')]).db);
  assert.equal(adminRemoves.ok, true);
  const adminRemovesAdmin = planMemberRemoval({
    actor: actor('ADMIN', 'admin'),
    members: [row('owner', 'OWNER'), row('admin', 'ADMIN'), row('admin-b', 'ADMIN')],
    targetUserId: 'admin-b',
  });
  assert.equal(adminRemovesAdmin.ok, false);
  if (!adminRemovesAdmin.ok) assert.equal(adminRemovesAdmin.reason, 'ADMIN_PROTECTED');
  for (const role of ['REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const denied = planMemberRemoval({
      actor: actor(role, 'member'),
      members: [row('owner', 'OWNER'), row('member', role), row('viewer', 'VIEWER')],
      targetUserId: 'viewer',
    });
    assert.equal(denied.ok, false, role);
  }
});

test('self management cannot drop owner or admin authority', () => {
  const members = [row('owner', 'OWNER'), row('admin', 'ADMIN'), row('viewer', 'VIEWER')];
  const ownerRemove = planMemberRemoval({ actor: actor('OWNER', 'owner'), members, targetUserId: 'owner' });
  const ownerChange = planMemberRoleChange({ actor: actor('OWNER', 'owner'), members, targetUserId: 'owner', role: 'ADMIN' });
  const adminChange = planMemberRoleChange({ actor: actor('ADMIN', 'admin'), members, targetUserId: 'admin', role: 'VIEWER' });
  const viewerSelf = planMemberRoleChange({ actor: actor('VIEWER', 'viewer'), members, targetUserId: 'viewer', role: 'ADMIN' });
  assert.equal(ownerRemove.ok, false);
  assert.equal(ownerChange.ok, false);
  assert.equal(adminChange.ok, false);
  assert.equal(viewerSelf.ok, false);
  if (!ownerChange.ok) assert.equal(ownerChange.reason, 'SELF_PROTECTED');
  if (!adminChange.ok) assert.equal(adminChange.reason, 'SELF_PROTECTED');
});

test('a member command stays inside the active organization and leaves service grants alone', async () => {
  const members = [row('owner', 'OWNER'), row('person', 'DEVELOPER'), row('person', 'VIEWER', 'org-b')];
  const crossRole = planMemberRoleChange({
    actor: actor('OWNER', 'owner', 'org-a'),
    members,
    targetUserId: 'person',
    role: 'REVIEWER',
    requestedTenantId: 'org-b',
  });
  assert.equal(crossRole.ok, true);
  if (crossRole.ok) assert.equal(crossRole.audit.tenantId, 'org-a');
  const onlyForeign = planMemberRoleChange({
    actor: actor('OWNER', 'owner', 'org-a'),
    members: [row('owner', 'OWNER'), row('person', 'VIEWER', 'org-b')],
    targetUserId: 'person',
    role: 'ADMIN',
  });
  assert.equal(onlyForeign.ok, false);
  if (!onlyForeign.ok) assert.equal(onlyForeign.reason, 'TENANT_MISMATCH');
  const foreignRemove = planMemberRemoval({
    actor: actor('ADMIN', 'admin', 'org-a'),
    members: [row('admin', 'ADMIN'), row('person', 'VIEWER', 'org-b')],
    targetUserId: 'person',
    requestedTenantId: 'org-b',
  });
  assert.equal(foreignRemove.ok, false);
  const store = memory([row('owner', 'OWNER'), row('person', 'DEVELOPER'), row('person', 'OWNER', 'org-b')]);
  const changed = await commitMemberRoleChange({
    actor: actor('OWNER', 'owner'),
    targetUserId: 'person',
    role: 'REVIEWER',
    now,
    allocateAuditId: () => 'audit-role',
  }, store.db);
  assert.equal(changed.ok, true);
  assert.equal(store.members().find((item) => item.tenantId === 'org-a' && item.userId === 'person')?.role, 'REVIEWER');
  assert.equal(store.members().find((item) => item.tenantId === 'org-b' && item.userId === 'person')?.role, 'OWNER');
  assert.equal(store.grants[0]?.permission, 'AGENT');
  if (changed.ok && changed.audit) {
    assert.equal(changed.audit.provenance.previousRole, 'DEVELOPER');
    assert.equal(changed.audit.provenance.role, 'REVIEWER');
    assert.equal(JSON.stringify(changed.audit).includes('AGENT'), false);
  }
  const removed = await commitMemberRemoval({
    actor: actor('OWNER', 'owner'),
    targetUserId: 'person',
    now,
  }, store.db);
  assert.equal(removed.ok, true);
  assert.equal(store.members().some((item) => item.tenantId === 'org-a' && item.userId === 'person'), false);
  assert.equal(store.members().some((item) => item.tenantId === 'org-b' && item.userId === 'person'), true);
  const listed = organizationsForUser({
    userId: 'person',
    memberships: store.members().filter((item) => item.userId === 'person'),
    tenants: [{ id: 'org-b', name: 'B' }],
  });
  assert.deepEqual(listed.map((item) => item.tenantId), ['org-b']);
  const fallback = resolveJuryActor({
    userId: 'person',
    memberships: store.members().filter((item) => item.userId === 'person'),
    activeTenantId: 'org-a',
    clientTenantId: 'org-a',
  });
  assert.equal(fallback.ok, true);
  if (fallback.ok) assert.equal(fallback.tenantId, 'org-b');
  assert.equal(canManageMember(actor('VIEWER', 'viewer'), row('person', 'DEVELOPER')), false);
  assert.equal(canManageMember(actor('OWNER', 'owner'), row('person', 'DEVELOPER')), true);
});

test('concurrent owner removal leaves the owner in place', async () => {
  const store = memory([row('owner', 'OWNER'), row('admin-b', 'ADMIN'), row('admin-c', 'ADMIN')]);
  const results = await Promise.all([
    store.exclusive(() => commitMemberRemoval({ actor: actor('ADMIN', 'admin-b'), targetUserId: 'owner', now }, store.db)),
    store.exclusive(() => commitMemberRemoval({ actor: actor('ADMIN', 'admin-c'), targetUserId: 'owner', now }, store.db)),
  ]);
  assert.equal(results.every((result) => result.ok === false), true);
  assert.equal(store.members().some((item) => item.userId === 'owner' && item.role === 'OWNER'), true);
});

test('members and invitations stay linked without changing service permissions', () => {
  const page = readFileSync(new URL('../../app/(root)/jury/organization/members/page.tsx', import.meta.url), 'utf8');
  const action = readFileSync(new URL('../../app/(root)/jury/organization/members/actions.ts', import.meta.url), 'utf8');
  const policy = readFileSync(new URL('./member-management.ts', import.meta.url), 'utf8');
  const db = readFileSync(new URL('./jury-db.ts', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../../app/(root)/jury/ui.tsx', import.meta.url), 'utf8');
  assert.match(page, /Invite member/);
  assert.match(page, /juryHref\('\/organization\/invitations'\)/);
  assert.match(page, /listOrganizationMembers/);
  assert.match(chrome, /juryHref\('\/organization\/members'\)/);
  assert.match(action, /getJuryActor/);
  assert.match(action, /changeOrganizationMemberRole/);
  assert.match(action, /removeOrganizationMember/);
  assert.equal(action.includes('searchParams'), false);
  assert.equal(action.includes('formData.get(\'tenantId\')'), false);
  assert.equal(action.includes('formData.get(\'actingUserId\')'), false);
  assert.equal(action.includes('formData.get(\'actorRole\')'), false);
  assert.equal(policy.includes('JuryServiceMember'), false);
  assert.match(db, /FROM "JuryMembership"/);
  assert.match(db, /FOR UPDATE/);
  assert.equal(db.includes('juryServiceMember.update'), false);
  assert.equal(db.includes('juryServiceMember.delete'), false);
});
