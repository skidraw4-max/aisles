import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { activeOrganizationCookie } from './active-organization';
import type { JuryActor } from './access';
import { juryCallbackNext, juryInvitationHref, juryLoginHref, jurySignupLink, safeJuryNext } from './jury-url';
import { organizationsForUser } from './organization-switch';
import {
  commitInvitationAcceptance,
  commitOrganizationInvitation,
  createInvitationToken,
  hashInvitationToken,
  invitationAudit,
  invitationStatus,
  type InvitationDb,
  type OrganizationInvitationRecord,
} from './organization-invitation';
import type { JuryMemberRole, JuryMembership } from './records';

const now = '2026-10-08T00:00:00.000Z';

function actor(role: JuryMemberRole, tenantId = 'org-a', userId = 'user-a'): JuryActor {
  return { ok: true, userId, tenantId, role, membershipId: `mem-${userId}` };
}

function memory() {
  const invitations: OrganizationInvitationRecord[] = [];
  const memberships: JuryMembership[] = [];
  const users: { id: string; email: string }[] = [];
  const audits: unknown[] = [];
  let tail = Promise.resolve();
  const db: InvitationDb = {
    async lockTenant() {},
    async findUserIdByEmail(email) {
      return users.find((row) => row.email === email)?.id ?? null;
    },
    async userHasMembership(userId, tenantId) {
      return memberships.some((row) => row.userId === userId && row.tenantId === tenantId);
    },
    async listPendingInvitationIds(tenantId, email, at) {
      return invitations
        .filter((row) => row.tenantId === tenantId && row.email === email && invitationStatus(row, at) === 'PENDING')
        .map((row) => row.id);
    },
    async expireInvitation(id, expiresAt) {
      const row = invitations.find((item) => item.id === id);
      if (row) row.expiresAt = expiresAt;
    },
    async insertInvitation(row) {
      invitations.push({ ...row });
    },
    async appendAudit(event) {
      audits.push(event);
    },
    async lockInvitationByHash(tokenHash) {
      return invitations.find((row) => row.tokenHash === tokenHash) ?? null;
    },
    async listMemberships(userId) {
      return memberships.filter((row) => row.userId === userId);
    },
    async createMembership(row) {
      if (memberships.some((item) => item.tenantId === row.tenantId && item.userId === row.userId)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      memberships.push({ ...row });
    },
    async markInvitationUsed(id, usedAt) {
      const row = invitations.find((item) => item.id === id);
      if (row) row.usedAt = usedAt;
    },
  };
  return {
    invitations,
    memberships,
    users,
    audits,
    db,
    exclusive<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(fn, fn);
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

test('only owner and admin can invite, and owner is not an invitation role', async () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    const store = memory();
    const created = await commitOrganizationInvitation({
      actor: actor(role),
      email: 'person@example.com',
      role: 'VIEWER',
      now,
      allocateId: () => `invite-${role}`,
      allocateAuditId: () => `audit-${role}`,
    }, store.db);
    assert.equal(created.ok, true, role);
  }
  for (const role of ['REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const store = memory();
    const denied = await commitOrganizationInvitation({
      actor: actor(role),
      email: 'person@example.com',
      role: 'VIEWER',
      now,
    }, store.db);
    assert.equal(denied.ok, false, role);
    if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');
    assert.equal(store.invitations.length, 0);
  }
  for (const role of ['ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const store = memory();
    const created = await commitOrganizationInvitation({
      actor: actor('OWNER'),
      email: `${role.toLowerCase()}@example.com`,
      role,
      now,
      allocateId: () => `invite-${role}`,
    }, store.db);
    assert.equal(created.ok, true, role);
    if (created.ok) assert.equal(created.invitation.role, role);
  }
  const ownerRole = await commitOrganizationInvitation({
    actor: actor('OWNER'),
    email: 'person@example.com',
    role: 'OWNER',
    now,
    requestedTenantId: 'org-b',
    requestedUserId: 'user-b',
  }, memory().db);
  assert.equal(ownerRole.ok, false);
  if (!ownerRole.ok) assert.equal(ownerRole.reason, 'INVALID_ROLE');
});

test('invitation tokens are hashed, expiring, and replaced instead of stacked', async () => {
  const store = memory();
  const first = await commitOrganizationInvitation({
    actor: actor('ADMIN'),
    email: 'Admin@Example.com',
    role: 'ADMIN',
    now,
    allocateId: () => 'invite-1',
    allocateAuditId: () => 'audit-1',
  }, store.db);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.invitation.email, 'admin@example.com');
  assert.equal(first.invitation.tenantId, 'org-a');
  assert.notEqual(first.token, first.invitation.tokenHash);
  assert.equal(first.invitation.tokenHash, hashInvitationToken(first.token));
  assert.equal(first.invitation.tokenHash, createHash('sha256').update(first.token).digest('hex'));
  assert.equal(Date.parse(first.invitation.expiresAt) - Date.parse(now), 7 * 24 * 60 * 60 * 1000);
  assert.equal(JSON.stringify(first.audit).includes(first.token), false);
  assert.equal(JSON.stringify(first.audit).includes(first.invitation.tokenHash), false);
  assert.equal(first.audit.action, 'INVITATION_CREATED');
  const second = await commitOrganizationInvitation({
    actor: actor('ADMIN'),
    email: 'admin@example.com',
    role: 'REVIEWER',
    now,
    allocateId: () => 'invite-2',
    allocateAuditId: () => 'audit-2',
  }, store.db);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(store.invitations.length, 2);
  assert.equal(invitationStatus(store.invitations[0]!, now), 'EXPIRED');
  assert.equal(invitationStatus(store.invitations[1]!, now), 'PENDING');
  assert.notEqual(second.token, first.token);
});

test('an existing member is not invited and a missing account can be invited', async () => {
  const store = memory();
  store.users.push({ id: 'user-member', email: 'member@example.com' });
  store.memberships.push({ id: 'mem-member', tenantId: 'org-a', userId: 'user-member', role: 'VIEWER', createdAt: now });
  const duplicate = await commitOrganizationInvitation({
    actor: actor('OWNER'),
    email: 'Member@Example.com',
    role: 'ADMIN',
    now,
  }, store.db);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.reason, 'ALREADY_HAS_MEMBERSHIP');
  assert.equal(store.invitations.length, 0);
  const fresh = await commitOrganizationInvitation({
    actor: actor('OWNER'),
    email: 'new-person@example.com',
    role: 'DEVELOPER',
    now,
    allocateId: () => 'invite-new',
  }, store.db);
  assert.equal(fresh.ok, true);
  if (fresh.ok) assert.equal(store.users.some((row) => row.email === 'new-person@example.com'), false);
});

test('acceptance creates one membership in the invited organization and keeps the others', async () => {
  const store = memory();
  const created = await commitOrganizationInvitation({
    actor: actor('OWNER'),
    email: 'person@example.com',
    role: 'DEVELOPER',
    now,
    allocateId: () => 'invite-ok',
    allocateAuditId: () => 'audit-create',
  }, store.db);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  store.memberships.push({ id: 'mem-home', tenantId: 'org-home', userId: 'user-person', role: 'OWNER', createdAt: now });
  const accepted = await commitInvitationAcceptance({
    presentedToken: created.token,
    userId: 'user-person',
    authenticatedEmail: 'Person@Example.com',
    emailVerified: true,
    now,
    allocateId: () => 'mem-new',
    allocateAuditId: () => 'audit-accept',
    requestedTenantId: 'org-b',
    requestedUserId: 'user-other',
    requestedRole: 'OWNER',
  }, store.db);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.membership.tenantId, 'org-a');
  assert.equal(accepted.membership.userId, 'user-person');
  assert.equal(accepted.membership.role, 'DEVELOPER');
  assert.equal(store.memberships.some((row) => row.tenantId === 'org-home' && row.role === 'OWNER'), true);
  assert.equal(store.invitations[0]?.usedAt, now);
  assert.equal(JSON.stringify(accepted.audit).includes(created.token), false);
  assert.equal(accepted.audit.action, 'INVITATION_ACCEPTED');
  const cookie = activeOrganizationCookie(accepted.membership.tenantId);
  assert.equal(cookie.value, 'org-a');
  assert.equal('domain' in cookie.options, false);
  const listed = organizationsForUser({
    userId: 'user-person',
    memberships: store.memberships,
    tenants: [
      { id: 'org-home', name: 'Home' },
      { id: 'org-a', name: 'Invited' },
    ],
  });
  assert.deepEqual(listed.map((row) => row.tenantId).sort(), ['org-a', 'org-home']);
  const reuse = await commitInvitationAcceptance({
    presentedToken: created.token,
    userId: 'user-person',
    authenticatedEmail: 'person@example.com',
    emailVerified: true,
    now,
  }, store.db);
  assert.equal(reuse.ok, false);
  if (!reuse.ok) assert.equal(reuse.reason, 'ALREADY_USED');
  assert.equal(store.memberships.filter((row) => row.tenantId === 'org-a').length, 1);
});

test('invalid, expired, mismatched, and unverified invitations do not create memberships', async () => {
  const store = memory();
  const created = await commitOrganizationInvitation({
    actor: actor('ADMIN'),
    email: 'person@example.com',
    role: 'VIEWER',
    now,
    allocateId: () => 'invite-guard',
  }, store.db);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const cases: Array<{ token: string; email: string | null; verified: boolean; userId: string | null; at: string; reason: string }> = [
    { token: createInvitationToken().token, email: 'person@example.com', verified: true, userId: 'user-person', at: now, reason: 'NOT_FOUND' },
    { token: 'not a token', email: 'person@example.com', verified: true, userId: 'user-person', at: now, reason: 'MALFORMED' },
    { token: '', email: 'person@example.com', verified: true, userId: 'user-person', at: now, reason: 'MALFORMED' },
    { token: created.token, email: 'person@example.com', verified: true, userId: 'user-person', at: '2026-10-20T00:00:00.000Z', reason: 'EXPIRED' },
    { token: created.token, email: 'other@example.com', verified: true, userId: 'user-other', at: now, reason: 'EMAIL_MISMATCH' },
    { token: created.token, email: 'person@example.com', verified: false, userId: 'user-person', at: now, reason: 'EMAIL_UNVERIFIED' },
    { token: created.token, email: 'person@example.com', verified: true, userId: null, at: now, reason: 'UNAUTHENTICATED' },
  ];
  for (const item of cases) {
    const result = await commitInvitationAcceptance({
      presentedToken: item.token,
      userId: item.userId,
      authenticatedEmail: item.email,
      emailVerified: item.verified,
      now: item.at,
    }, store.db);
    assert.equal(result.ok, false, item.reason);
    if (!result.ok) assert.equal(result.reason, item.reason);
  }
  assert.equal(store.memberships.length, 0);
  assert.equal(store.invitations[0]?.usedAt, null);
});

test('a foreign tenant cannot be invited and another tenant membership stays untouched', async () => {
  const store = memory();
  store.memberships.push({ id: 'mem-b', tenantId: 'org-b', userId: 'user-b', role: 'OWNER', createdAt: now });
  const created = await commitOrganizationInvitation({
    actor: actor('OWNER', 'org-a', 'user-a'),
    email: 'person@example.com',
    role: 'VIEWER',
    now,
    requestedTenantId: 'org-b',
    allocateId: () => 'invite-a',
  }, store.db);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.invitation.tenantId, 'org-a');
  const wrongAccount = await commitInvitationAcceptance({
    presentedToken: created.token,
    userId: 'user-b',
    authenticatedEmail: 'owner-b@example.com',
    emailVerified: true,
    now,
  }, store.db);
  assert.equal(wrongAccount.ok, false);
  if (!wrongAccount.ok) assert.equal(wrongAccount.reason, 'EMAIL_MISMATCH');
  assert.equal(store.memberships.some((row) => row.tenantId === 'org-b' && row.userId === 'user-b'), true);
  assert.equal(store.memberships.some((row) => row.tenantId === 'org-a'), false);
});

test('concurrent acceptance creates one membership', async () => {
  const store = memory();
  const created = await commitOrganizationInvitation({
    actor: actor('OWNER'),
    email: 'person@example.com',
    role: 'REVIEWER',
    now,
    allocateId: () => 'invite-race',
  }, store.db);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const results = await Promise.all([
    store.exclusive(() => commitInvitationAcceptance({
      presentedToken: created.token,
      userId: 'user-person',
      authenticatedEmail: 'person@example.com',
      emailVerified: true,
      now,
      allocateId: () => 'mem-race-1',
    }, store.db)),
    store.exclusive(() => commitInvitationAcceptance({
      presentedToken: created.token,
      userId: 'user-person',
      authenticatedEmail: 'person@example.com',
      emailVerified: true,
      now,
      allocateId: () => 'mem-race-2',
    }, store.db)),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(store.memberships.length, 1);
  assert.equal(store.invitations[0]?.usedAt, now);
});

test('invitation status follows usedAt and expiresAt without a stored status', () => {
  const row = { usedAt: null, expiresAt: '2026-10-15T00:00:00.000Z' };
  assert.equal(invitationStatus(row, now), 'PENDING');
  assert.equal(invitationStatus(row, '2026-10-15T00:00:00.001Z'), 'EXPIRED');
  assert.equal(invitationStatus({ ...row, usedAt: now }, '2026-10-20T00:00:00.000Z'), 'ACCEPTED');
  const audit = invitationAudit({
    id: 'audit',
    action: 'INVITATION_CREATED',
    invitation: {
      id: 'invite',
      tenantId: 'org-a',
      email: 'person@example.com',
      role: 'VIEWER',
      tokenHash: 'hash',
      expiresAt: row.expiresAt,
      usedAt: null,
      invitedBy: 'user-a',
    },
    actorUserId: 'user-a',
    timestamp: now,
  });
  assert.equal(JSON.stringify(audit).includes('token'), false);
});

test('invitation routes stay inside Jury and do not carry a tenant id', () => {
  const token = createInvitationToken().token;
  assert.equal(juryInvitationHref(token, null), `/jury/invitation/${token}`);
  assert.equal(juryInvitationHref(token, 'https://jury.aisleshub.com'), `https://jury.aisleshub.com/invitation/${token}`);
  assert.equal(juryInvitationHref(token, null).includes('tenantId'), false);
  assert.equal(safeJuryNext(`/jury/invitation/${token}`, null), `/jury/invitation/${token}`);
  assert.equal(juryCallbackNext(`/jury/invitation/${token}`), `/jury/invitation/${token}`);
  assert.equal(juryCallbackNext('https://evil.example'), '/jury');
  assert.equal(juryLoginHref(`/jury/invitation/${token}`, null), `/jury/login?next=${encodeURIComponent(`/jury/invitation/${token}`)}`);
  assert.equal(jurySignupLink(`/jury/invitation/${token}`, null).startsWith('/jury/signup?next='), true);
  assert.equal(juryLoginHref('https://evil.example', null), '/jury/login');
  assert.equal(safeJuryNext('https://evil.example', null), '/jury');
  const invitePage = readFileSync(new URL('../../app/(root)/jury/organization/invitations/page.tsx', import.meta.url), 'utf8');
  const acceptPage = readFileSync(new URL('../../app/(root)/jury/invitation/[token]/page.tsx', import.meta.url), 'utf8');
  const createAction = readFileSync(new URL('../../app/(root)/jury/organization/invitations/actions.ts', import.meta.url), 'utf8');
  const acceptAction = readFileSync(new URL('../../app/(root)/jury/invitation/actions.ts', import.meta.url), 'utf8');
  const form = readFileSync(new URL('../../components/jury/JuryInvitationForm.tsx', import.meta.url), 'utf8');
  const db = readFileSync(new URL('./jury-db.ts', import.meta.url), 'utf8');
  assert.match(invitePage, /JuryInvitationForm/);
  assert.match(invitePage, /listTenantInvitations/);
  assert.match(acceptPage, /Login/);
  assert.match(acceptPage, /Create account/);
  assert.match(createAction, /createOrganizationInvitationRecord/);
  assert.match(createAction, /getJuryActor/);
  assert.equal(createAction.includes('searchParams'), false);
  assert.equal(createAction.includes('formData.get(\'userId\')'), false);
  assert.equal(createAction.includes('formData.get(\'tenantId\')'), false);
  assert.equal(form.includes('localStorage'), false);
  assert.match(acceptAction, /acceptOrganizationInvitationRecord/);
  assert.match(acceptAction, /activeOrganizationCookie/);
  assert.equal(acceptAction.includes('searchParams'), false);
  assert.equal(/resend|sendgrid|nodemailer|smtp/i.test(createAction), false);
  assert.match(db, /FOR UPDATE/);
  assert.equal(db.includes('Math.random'), false);
});
