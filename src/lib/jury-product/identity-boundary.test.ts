import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { juryEntrySurface } from '../../components/jury/entry';
import { decideJuryMutation, resolveJuryActor, selectActiveOrganization } from './access';
import { activeOrganizationCookie } from './active-organization';
import { juryEmailVerification } from './jury-email-gate';
import { planInvitationAcceptance, planOrganizationInvitation } from './organization-invitation';
import type { JuryMembership } from './records';
import { decideServicePermission } from './service-permission';

const now = '2026-10-08T00:00:00.000Z';

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: now };
}

const ownerA = membership('mem-a', 'org-a', 'user-a', 'OWNER');
const reviewerB = membership('mem-b', 'org-b', 'user-a', 'REVIEWER');
const viewerZ = membership('mem-z', 'org-z', 'user-a', 'VIEWER');

test('authentication stays with Supabase and Jury entry follows verification then membership', () => {
  assert.equal(juryEmailVerification(null), 'unauthenticated');
  assert.equal(juryEmailVerification({ email_confirmed_at: null }), 'unverified');
  assert.equal(juryEmailVerification({ email_confirmed_at: now }), 'verified');
  assert.equal(juryEntrySurface({ ok: false, reason: 'UNAUTHENTICATED' }), 'landing');
  const signedOut = resolveJuryActor({ userId: null, memberships: [ownerA] });
  assert.equal(signedOut.ok, false);
  if (!signedOut.ok) assert.equal(signedOut.reason, 'UNAUTHENTICATED');
  const noOrg = resolveJuryActor({ userId: 'user-a', memberships: [] });
  assert.equal(noOrg.ok, false);
  if (!noOrg.ok) assert.equal(noOrg.reason, 'NO_MEMBERSHIP');
  const member = resolveJuryActor({ userId: 'user-a', memberships: [ownerA] });
  assert.equal(member.ok, true);
  if (member.ok) assert.equal(member.tenantId, 'org-a');
  const dashboard = readFileSync(new URL('../../app/(root)/jury/page.tsx', import.meta.url), 'utf8');
  const session = readFileSync(new URL('./session.ts', import.meta.url), 'utf8');
  assert.match(dashboard, /EMAIL_UNVERIFIED/);
  assert.match(dashboard, /JuryEmailNotice/);
  assert.match(dashboard, /JuryLanding/);
  assert.match(session, /auth\.getUser\(\)/);
  assert.equal(session.includes('user_metadata'), false);
  assert.equal(session.includes('app_metadata'), false);
});

test('one user can belong to several organizations and a foreign tenant id cannot select one', () => {
  const many = resolveJuryActor({
    userId: 'user-a',
    memberships: [ownerA, reviewerB, viewerZ],
    clientTenantId: 'org-b',
    activeTenantId: 'org-stolen',
  });
  assert.equal(many.ok, true);
  if (many.ok) {
    assert.equal(many.tenantId, 'org-a');
    assert.equal(many.role, 'OWNER');
  }
  const selected = selectActiveOrganization([ownerA, reviewerB, viewerZ], 'org-z');
  assert.equal(selected.status, 'accepted');
  assert.equal(selected.membership.role, 'VIEWER');
  assert.equal(selected.membership.tenantId, 'org-z');
  const outsider = resolveJuryActor({
    userId: 'user-other',
    memberships: [ownerA],
    clientTenantId: 'org-a',
    activeTenantId: 'org-a',
  });
  assert.equal(outsider.ok, false);
  if (!outsider.ok) assert.equal(outsider.reason, 'NO_MEMBERSHIP');
  const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  const membershipModel = schema.slice(schema.indexOf('model JuryMembership'), schema.indexOf('model JuryServiceConnection'));
  assert.match(membershipModel, /@@unique\(\[tenantId, userId\]\)/);
  assert.equal(/@@unique\(\[userId\]\)/.test(membershipModel), false);
  const userModel = schema.slice(schema.indexOf('model User {'), schema.indexOf('model GameScore'));
  assert.equal(/\n\s*password\s+String/.test(userModel), false);
  const db = readFileSync(new URL('./jury-db.ts', import.meta.url), 'utf8');
  assert.match(db, /juryMembership\.findMany\(\{ where: \{ userId \} \}\)/);
  assert.equal(db.includes('juryMembership.findUnique'), false);
});

test('the active organization cookie is host-only and a forged tenant falls back to a real membership', () => {
  const cookie = activeOrganizationCookie('org-a');
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, 'lax');
  assert.equal(cookie.options.path, '/');
  assert.equal('domain' in cookie.options, false);
  const forged = selectActiveOrganization([reviewerB], 'org-a');
  assert.equal(forged.status, 'rejected');
  assert.equal(forged.membership.tenantId, 'org-b');
  const crossed = decideJuryMutation({
    actor: { ok: true, userId: 'user-a', tenantId: 'org-b', role: 'REVIEWER', membershipId: 'mem-b' },
    action: 'console.read',
    resourceTenantId: 'org-a',
    clientTenantId: 'org-a',
  });
  assert.equal(crossed.ok, false);
  if (!crossed.ok) assert.equal(crossed.reason, 'TENANT_MISMATCH');
});

test('OWNER and ADMIN stay distinct and service grants do not cross connections', () => {
  const owner = { ok: true as const, userId: 'user-a', tenantId: 'org-a', role: 'OWNER' as const, membershipId: 'mem-a' };
  const admin = { ...owner, role: 'ADMIN' as const };
  assert.equal(decideJuryMutation({ actor: owner, action: 'settings.write', resourceTenantId: 'org-a' }).ok, true);
  assert.equal(decideJuryMutation({ actor: admin, action: 'settings.write', resourceTenantId: 'org-a' }).ok, false);
  assert.equal(decideJuryMutation({ actor: admin, action: 'membership.write', resourceTenantId: 'org-a' }).ok, true);
  assert.equal(decideJuryMutation({ actor: { ...owner, role: 'REVIEWER' }, action: 'membership.write', resourceTenantId: 'org-a' }).ok, false);
  assert.equal(decideJuryMutation({ actor: { ...owner, role: 'DEVELOPER' }, action: 'improvement.write', resourceTenantId: 'org-a' }).ok, true);
  assert.equal(decideJuryMutation({
    actor: { ...owner, role: 'DEVELOPER' },
    action: 'agent.execute',
    resourceTenantId: 'org-a',
    servicePermissions: ['VIEW'],
  }).ok, false);
  assert.equal(decideJuryMutation({
    actor: { ...owner, role: 'DEVELOPER' },
    action: 'agent.execute',
    resourceTenantId: 'org-a',
    servicePermissions: ['AGENT'],
  }).ok, true);
  assert.equal(decideJuryMutation({ actor: { ...owner, role: 'VIEWER' }, action: 'review.start', resourceTenantId: 'org-a' }).ok, false);
  const viewOnly = [{ connectionId: 'service-1', userId: 'user-a', permission: 'VIEW' as const }];
  for (const permission of ['REVIEW', 'IMPROVE', 'AGENT'] as const) {
    assert.equal(decideServicePermission({
      tenantId: 'org-a',
      connectionTenantId: 'org-a',
      userId: 'user-a',
      connectionId: 'service-1',
      permission,
      grants: viewOnly,
    }).ok, false);
  }
  const otherService = [{ connectionId: 'service-2', userId: 'user-a', permission: 'AGENT' as const }];
  assert.equal(decideServicePermission({
    tenantId: 'org-a',
    connectionTenantId: 'org-a',
    userId: 'user-a',
    connectionId: 'service-1',
    permission: 'AGENT',
    grants: otherService,
  }).ok, false);
  assert.equal(decideServicePermission({
    tenantId: 'org-a',
    connectionTenantId: 'org-a',
    userId: 'user-a',
    connectionId: 'service-2',
    permission: 'AGENT',
    grants: otherService,
  }).ok, true);
});

test('an invitation targets an email and does not require an existing Jury account', () => {
  const created = planOrganizationInvitation({
    actor: { ok: true, userId: 'user-a', tenantId: 'org-a', role: 'ADMIN', membershipId: 'mem-a' },
    email: 'new-person@example.com',
    role: 'REVIEWER',
    now,
    allocateId: () => 'invite-new',
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.invitation.email, 'new-person@example.com');
  assert.equal('userId' in created.invitation, false);
  const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  const invitation = schema.slice(schema.indexOf('model OrganizationInvitation'), schema.indexOf('model JuryAccessScope'));
  assert.match(invitation, /email\s+String/);
  assert.equal(/inviteeUserId/.test(invitation), false);
  const pending = planInvitationAcceptance({
    invitation: created.invitation,
    presentedToken: created.token,
    userId: null,
    authenticatedEmail: created.invitation.email,
    existingMemberships: [],
    now,
  });
  assert.equal(pending.ok, false);
  if (!pending.ok) assert.equal(pending.reason, 'UNAUTHENTICATED');
});
