/**
 * Organization, invitation, service permission, and email boundaries.
 * Run: node --import tsx --test src/lib/jury-product/organization-foundation.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { decideJuryMutation, resolveJuryActor, selectActiveOrganization } from './access';
import { juryEmailVerification } from './jury-email-gate';
import { planMembershipCommand } from './membership-policy';
import { activeOrganizationCookie, JURY_ACTIVE_ORG_COOKIE } from './active-organization';
import {
  createInvitationToken,
  hashInvitationToken,
  planInvitationAcceptance,
  planOrganizationInvitation,
  type OrganizationInvitationRecord,
} from './organization-invitation';
import { decideServicePermission, migratedServicePermissions } from './service-permission';
import type { JuryActor } from './access';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-owner',
  tenantId: 'org-a',
  userId: 'user-owner',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const second: JuryMembership = {
  id: 'mem-owner-b',
  tenantId: 'org-b',
  userId: 'user-owner',
  role: 'ADMIN',
  createdAt: '2026-10-02T00:00:00.000Z',
};

function actor(role: JuryMembership['role'], tenantId = 'org-a'): JuryActor {
  return { ok: true, userId: 'user-owner', tenantId, role, membershipId: 'mem-owner' };
}

test('a user can belong to more than one organization', () => {
  const created = planMembershipCommand({
    kind: 'CREATE_TENANT',
    userId: owner.userId,
    existingMemberships: [owner],
    tenantName: 'Second',
    allocateId: () => 'org-b',
  });
  assert.equal(created.ok, true);
  const added = planMembershipCommand({
    kind: 'ADD_MEMBER',
    actor: actor('OWNER'),
    tenantMembers: [owner],
    targetExisting: [second],
    targetUserId: 'user-other',
    role: 'REVIEWER',
  });
  assert.equal(added.ok, true);
  if (added.ok && added.kind === 'ADD_MEMBER') assert.equal(added.membership.tenantId, 'org-a');
});

test('the same user cannot join one organization twice', () => {
  const decision = planMembershipCommand({
    kind: 'ADD_MEMBER',
    actor: actor('ADMIN'),
    tenantMembers: [owner],
    targetExisting: [owner],
    targetUserId: owner.userId,
    role: 'DEVELOPER',
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.reason, 'ALREADY_HAS_MEMBERSHIP');
});

test('the active organization cookie is accepted only for a real membership', () => {
  const accepted = selectActiveOrganization([owner, second], 'org-b');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.membership.tenantId, 'org-b');
  const rejected = selectActiveOrganization([owner], 'org-b');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.membership.tenantId, 'org-a');
  const missing = selectActiveOrganization([second, owner], null);
  assert.equal(missing.status, 'fallback');
  assert.equal(missing.membership.tenantId, 'org-a');
  const cookie = activeOrganizationCookie('org-a');
  assert.equal(cookie.name, JURY_ACTIVE_ORG_COOKIE);
  assert.equal(cookie.options.httpOnly, true);
});

test('a client tenant id cannot cross an organization boundary', () => {
  const resolved = resolveJuryActor({
    userId: owner.userId,
    memberships: [owner],
    clientTenantId: 'org-b',
    activeTenantId: 'org-b',
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.tenantId, 'org-a');
  const read = decideJuryMutation({
    actor: actor('OWNER'),
    action: 'console.read',
    resourceTenantId: 'org-b',
    clientTenantId: 'org-b',
  });
  const write = decideJuryMutation({
    actor: actor('DEVELOPER'),
    action: 'improvement.write',
    resourceTenantId: 'org-b',
    clientTenantId: 'org-b',
  });
  assert.equal(read.ok, false);
  assert.equal(write.ok, false);
  if (!read.ok) assert.equal(read.reason, 'TENANT_MISMATCH');
  if (!write.ok) assert.equal(write.reason, 'TENANT_MISMATCH');
});

test('organization roles keep owner protection and split the other roles', () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    assert.equal(decideJuryMutation({ actor: actor(role), action: 'membership.write', resourceTenantId: 'org-a' }).ok, true);
    assert.equal(decideJuryMutation({ actor: actor(role), action: 'agent.execute', resourceTenantId: 'org-a' }).ok, true);
  }
  assert.equal(decideJuryMutation({ actor: actor('ADMIN'), action: 'settings.write', resourceTenantId: 'org-a' }).ok, false);
  assert.equal(decideJuryMutation({ actor: actor('REVIEWER'), action: 'review.start', resourceTenantId: 'org-a' }).ok, true);
  assert.equal(decideJuryMutation({ actor: actor('REVIEWER'), action: 'improvement.write', resourceTenantId: 'org-a' }).ok, false);
  assert.equal(decideJuryMutation({ actor: actor('DEVELOPER'), action: 'improvement.write', resourceTenantId: 'org-a' }).ok, true);
  assert.equal(decideJuryMutation({ actor: actor('DEVELOPER'), action: 'agent.execute', resourceTenantId: 'org-a' }).ok, false);
  assert.equal(decideJuryMutation({
    actor: actor('DEVELOPER'),
    action: 'agent.execute',
    resourceTenantId: 'org-a',
    servicePermissions: ['AGENT'],
  }).ok, true);
  assert.equal(decideJuryMutation({ actor: actor('VIEWER'), action: 'console.read', resourceTenantId: 'org-a' }).ok, true);
  assert.equal(decideJuryMutation({ actor: actor('VIEWER'), action: 'review.start', resourceTenantId: 'org-a' }).ok, false);
  const demote = planMembershipCommand({
    kind: 'CHANGE_ROLE',
    actor: actor('ADMIN'),
    tenantMembers: [owner],
    targetUserId: owner.userId,
    role: 'ADMIN',
  });
  assert.equal(demote.ok, false);
  if (!demote.ok) assert.equal(demote.reason, 'LAST_OWNER');
});

test('invitations are hashed, expiring, single use, and bound to the invited email', () => {
  const now = '2026-10-08T00:00:00.000Z';
  for (const role of ['REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const denied = planOrganizationInvitation({ actor: actor(role), email: 'person@example.com', role: 'VIEWER', now });
    assert.equal(denied.ok, false);
  }
  const created = planOrganizationInvitation({
    actor: actor('ADMIN'),
    email: 'Person@Example.com',
    role: 'DEVELOPER',
    now,
    allocateId: () => 'invite-1',
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.notEqual(created.token, created.invitation.tokenHash);
  assert.equal(created.invitation.tokenHash, hashInvitationToken(created.token));
  assert.equal(created.invitation.email, 'person@example.com');
  assert.equal(created.token.includes(created.invitation.tokenHash), false);
  const other = createInvitationToken();
  assert.notEqual(other.token, created.token);
  assert.equal(other.tokenHash, createHash('sha256').update(other.token).digest('hex'));
  const base = {
    invitation: created.invitation,
    presentedToken: created.token,
    userId: 'user-person',
    authenticatedEmail: 'person@example.com',
    existingMemberships: [] as JuryMembership[],
    now,
  };
  const accepted = planInvitationAcceptance(base);
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.membership.tenantId, 'org-a');
    assert.equal(accepted.membership.role, 'DEVELOPER');
    assert.equal(accepted.usedAt, now);
  }
  const used: OrganizationInvitationRecord = { ...created.invitation, usedAt: now };
  const reuse = planInvitationAcceptance({ ...base, invitation: used });
  assert.equal(reuse.ok, false);
  if (!reuse.ok) assert.equal(reuse.reason, 'ALREADY_USED');
  const expired = planInvitationAcceptance({ ...base, now: '2026-10-20T00:00:00.000Z' });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, 'EXPIRED');
  const mismatch = planInvitationAcceptance({ ...base, authenticatedEmail: 'other@example.com' });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.reason, 'EMAIL_MISMATCH');
  const duplicate = planInvitationAcceptance({
    ...base,
    existingMemberships: [{ id: 'mem-person', tenantId: 'org-a', userId: 'user-person', role: 'VIEWER', createdAt: now }],
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.reason, 'ALREADY_HAS_MEMBERSHIP');
  const ownerInvite = planOrganizationInvitation({ actor: actor('OWNER'), email: 'person@example.com', role: 'VIEWER', now });
  assert.equal(ownerInvite.ok, true);
});

test('service permissions stay explicit and historical roles keep their access', () => {
  assert.deepEqual(migratedServicePermissions('OWNER'), ['VIEW', 'REVIEW', 'IMPROVE', 'AGENT']);
  assert.deepEqual(migratedServicePermissions('DEVELOPER'), ['VIEW', 'REVIEW', 'IMPROVE', 'AGENT']);
  assert.deepEqual(migratedServicePermissions('VIEWER'), ['VIEW']);
  const grants = [{ connectionId: 'service-1', userId: 'user-viewer', permission: 'VIEW' as const }];
  const view = decideServicePermission({
    tenantId: 'org-a',
    connectionTenantId: 'org-a',
    userId: 'user-viewer',
    connectionId: 'service-1',
    permission: 'VIEW',
    grants,
  });
  const review = decideServicePermission({
    tenantId: 'org-a',
    connectionTenantId: 'org-a',
    userId: 'user-viewer',
    connectionId: 'service-1',
    permission: 'REVIEW',
    grants,
  });
  const foreign = decideServicePermission({
    tenantId: 'org-a',
    connectionTenantId: 'org-b',
    userId: 'user-viewer',
    connectionId: 'service-1',
    permission: 'VIEW',
    grants,
  });
  assert.equal(view.ok, true);
  assert.equal(review.ok, false);
  assert.equal(foreign.ok, false);
  for (const permission of ['IMPROVE', 'AGENT'] as const) {
    const decision = decideServicePermission({
      tenantId: 'org-a',
      connectionTenantId: 'org-a',
      userId: 'user-viewer',
      connectionId: 'service-1',
      permission,
      grants,
    });
    assert.equal(decision.ok, false);
  }
});

test('Jury entry allows a verified email and blocks an unverified user', () => {
  assert.equal(juryEmailVerification(null), 'unauthenticated');
  assert.equal(juryEmailVerification({ email_confirmed_at: null }), 'unverified');
  assert.equal(juryEmailVerification({ email_confirmed_at: '2026-10-08T00:00:00.000Z' }), 'verified');
});
