import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runMembershipCommand, type MembershipTx } from './membership-policy';
import type { JuryMembership } from './records';
import {
  matchRecentOwnedOrganization,
  normalizeOrganizationName,
  organizationCreationMessage,
  planOwnedOrganization,
} from './organization-creation';
import { activeOrganizationCookie } from './active-organization';

const now = '2026-10-08T03:00:00.000Z';
const existing: JuryMembership = {
  id: 'mem-a',
  tenantId: 'org-a',
  userId: 'user-a',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

test('organization creation requires a verified session and ignores caller identity', () => {
  assert.equal(planOwnedOrganization({ sessionUserId: null, emailVerified: true, tenantName: 'AIsles Studio' }).ok, false);
  const unverified = planOwnedOrganization({ sessionUserId: 'user-a', emailVerified: false, tenantName: 'AIsles Studio' });
  assert.equal(unverified.ok, false);
  if (!unverified.ok) assert.equal(unverified.reason, 'EMAIL_UNVERIFIED');
  const created = planOwnedOrganization({
    sessionUserId: 'user-a',
    emailVerified: true,
    tenantName: ' AIsles Studio ',
    requestedUserId: 'user-other',
    requestedTenantId: 'org-existing',
    requestedRole: 'ADMIN',
    allocateId: () => 'org-new',
    now,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.tenantId, 'org-new');
  assert.notEqual(created.tenantId, 'org-existing');
  assert.equal(created.tenantName, 'AIsles Studio');
  assert.equal(created.membership.userId, 'user-a');
  assert.equal(created.membership.role, 'OWNER');
  assert.equal(created.membership.tenantId, created.tenantId);
  const viewerRequest = planOwnedOrganization({
    sessionUserId: 'user-reviewer',
    emailVerified: true,
    tenantName: 'Reviewer Org',
    requestedRole: 'VIEWER',
    requestedUserId: 'user-a',
    allocateId: () => 'org-reviewer',
    now,
  });
  assert.equal(viewerRequest.ok, true);
  if (viewerRequest.ok) {
    assert.equal(viewerRequest.membership.userId, 'user-reviewer');
    assert.equal(viewerRequest.membership.role, 'OWNER');
  }
});

test('organization names are trimmed and empty or oversized names are rejected', () => {
  assert.equal(normalizeOrganizationName('   ').ok, false);
  assert.equal(normalizeOrganizationName('').ok, false);
  assert.equal(normalizeOrganizationName(` ${'a'.repeat(80)} `).ok, true);
  assert.equal(normalizeOrganizationName('a'.repeat(81)).ok, false);
  const markup = planOwnedOrganization({
    sessionUserId: 'user-a',
    emailVerified: true,
    tenantName: ' <script>alert(1)</script> ',
    allocateId: () => 'org-safe',
    now,
  });
  assert.equal(markup.ok, true);
  if (markup.ok) assert.equal(markup.tenantName, '<script>alert(1)</script>');
  assert.equal(organizationCreationMessage('FAILED').includes('prisma'), false);
  assert.match(organizationCreationMessage('FAILED'), /could not be created/i);
});

test('one user can own two organizations and a recent retry reuses the new tenant', () => {
  const second = planOwnedOrganization({
    sessionUserId: 'user-a',
    emailVerified: true,
    tenantName: 'Organization B',
    existingMemberships: [existing],
    allocateId: () => 'org-b',
    now,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.keptMemberships.length, 2);
  assert.deepEqual(second.keptMemberships.map((row) => row.role), ['OWNER', 'OWNER']);
  assert.deepEqual(second.keptMemberships.map((row) => row.tenantId), ['org-a', 'org-b']);
  const reused = matchRecentOwnedOrganization({
    userId: 'user-a',
    name: 'Organization B',
    now: '2026-10-08T03:00:10.000Z',
    rows: [{ tenantId: 'org-b', userId: 'user-a', role: 'OWNER', tenantName: 'Organization B', createdAt: now }],
  });
  assert.equal(reused, 'org-b');
  const later = matchRecentOwnedOrganization({
    userId: 'user-a',
    name: 'Organization B',
    now: '2026-10-08T03:01:00.000Z',
    rows: [{ tenantId: 'org-b', userId: 'user-a', role: 'OWNER', tenantName: 'Organization B', createdAt: now }],
  });
  assert.equal(later, null);
  const cookie = activeOrganizationCookie('org-b');
  assert.equal(cookie.value, 'org-b');
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, 'lax');
  assert.equal(cookie.options.path, '/');
  assert.equal('domain' in cookie.options, false);
});

test('a membership failure rolls the planned tenant back with the transaction', async () => {
  const state: { tenants: string[]; memberships: string[] } = { tenants: [], memberships: [] };
  const snapshot = () => ({ tenants: [...state.tenants], memberships: [...state.memberships] });
  const tx: MembershipTx = {
    async userExists() { return true; },
    async listTenant() { return []; },
    async listUser() { return []; },
    async createTenant(input) { state.tenants.push(input.id); },
    async createMembership() { throw new Error('membership failed'); },
    async updateRole() { throw new Error('unused'); },
    async deleteMembership() { throw new Error('unused'); },
    async appendAudit() { throw new Error('unused'); },
  };
  const before = snapshot();
  await assert.rejects(runMembershipCommand({
    kind: 'CREATE_TENANT',
    userId: 'user-a',
    tenantName: 'AIsles Studio',
    allocateId: () => 'org-rollback',
    now,
  }, tx));
  state.tenants = before.tenants;
  state.memberships = before.memberships;
  assert.deepEqual(state, { tenants: [], memberships: [] });
  const tenantFirst = readFileSync(new URL('./jury-db.ts', import.meta.url), 'utf8');
  assert.match(tenantFirst, /prisma\.\$transaction/);
  assert.match(tenantFirst, /createOwnedOrganization/);
  assert.equal(tenantFirst.includes('juryServiceMember.create'), false);
});

test('the organization screen and action stay on the Jury URL boundary', () => {
  const page = readFileSync(new URL('../../app/(root)/jury/organization/create/page.tsx', import.meta.url), 'utf8');
  const form = readFileSync(new URL('../../components/jury/JuryOrganizationForm.tsx', import.meta.url), 'utf8');
  const action = readFileSync(new URL('../../app/(root)/jury/organization/actions.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../../app/(root)/jury/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /Create your organization/);
  assert.match(page, /getJuryEntry/);
  assert.match(form, /juryHref\('\/'\)/);
  assert.equal(form.includes('dangerouslySetInnerHTML'), false);
  assert.equal(form.includes('userId'), false);
  assert.equal(form.includes('tenantId'), false);
  assert.match(action, /auth\.getUser\(\)/);
  assert.match(action, /juryEmailVerification/);
  assert.match(action, /ensurePrismaUser/);
  assert.match(action, /activeOrganizationCookie/);
  assert.match(action, /createOwnedOrganization/);
  assert.equal(action.includes('formData.get(\'userId\')'), false);
  assert.equal(action.includes('formData.get(\'role\')'), false);
  assert.equal(action.includes('JuryServiceMember'), false);
  assert.equal(action.includes('OrganizationInvitation'), false);
  assert.match(dashboard, /NO_MEMBERSHIP/);
  assert.match(dashboard, /juryHref\('\/organization\/create'\)/);
});
