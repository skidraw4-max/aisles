import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decideJuryMutation, resolveJuryActor } from './access';
import { activeOrganizationCookie } from './active-organization';
import type { JuryMemberRole, JuryMembership } from './records';
import { organizationsForUser, planOrganizationSwitch } from './organization-switch';

const now = '2026-10-08T00:00:00.000Z';

function membership(id: string, tenantId: string, userId: string, role: JuryMemberRole, createdAt = now): JuryMembership {
  return { id, tenantId, userId, role, createdAt };
}

const mine = [
  membership('mem-a', 'org-a', 'user-a', 'OWNER', '2026-10-01T00:00:00.000Z'),
  membership('mem-b', 'org-b', 'user-a', 'VIEWER', '2026-10-02T00:00:00.000Z'),
];
const foreign = membership('mem-c', 'org-c', 'user-b', 'OWNER', '2026-10-01T00:00:00.000Z');
const tenants = [
  { id: 'org-a', name: 'AIsles Studio' },
  { id: 'org-b', name: 'Acme AI' },
  { id: 'org-c', name: 'Other Org' },
];

test('the switcher lists only the current user organizations', () => {
  assert.deepEqual(organizationsForUser({ userId: 'user-none', memberships: [], tenants }), []);
  const one = organizationsForUser({ userId: 'user-a', memberships: [mine[0]], tenants });
  assert.deepEqual(one.map((row) => row.name), ['AIsles Studio']);
  const many = organizationsForUser({ userId: 'user-a', memberships: [...mine, foreign], tenants });
  assert.deepEqual(many.map((row) => row.tenantId), ['org-a', 'org-b']);
  assert.equal(many.some((row) => row.tenantId === 'org-c'), false);
});

test('every role can switch only into its own membership', () => {
  for (const role of ['OWNER', 'ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const) {
    const switched = planOrganizationSwitch({
      userId: 'user-a',
      memberships: [membership('mem', 'org-a', 'user-a', role)],
      tenantId: 'org-a',
    });
    assert.equal(switched.ok, true, role);
    if (switched.ok) assert.equal(switched.role, role);
  }
  assert.equal(planOrganizationSwitch({ userId: null, memberships: mine, tenantId: 'org-a' }).ok, false);
  assert.equal(planOrganizationSwitch({ userId: 'user-a', memberships: mine, tenantId: 'org-missing' }).ok, false);
  assert.equal(planOrganizationSwitch({ userId: 'user-a', memberships: [...mine, foreign], tenantId: 'org-c' }).ok, false);
  const cookie = activeOrganizationCookie('org-b');
  assert.equal(cookie.options.httpOnly, true);
  assert.equal('domain' in cookie.options, false);
});

test('switching changes the actor tenant and does not carry the previous role', () => {
  const actor = resolveJuryActor({
    userId: 'user-a',
    memberships: mine,
    clientTenantId: 'org-a',
    activeTenantId: 'org-b',
  });
  assert.equal(actor.ok, true);
  if (!actor.ok) return;
  assert.equal(actor.tenantId, 'org-b');
  assert.equal(actor.role, 'VIEWER');
  assert.equal(decideJuryMutation({ actor, action: 'console.read', resourceTenantId: 'org-a', clientTenantId: 'org-a' }).ok, false);
  assert.equal(decideJuryMutation({ actor, action: 'settings.write', resourceTenantId: 'org-b' }).ok, false);
  assert.equal(decideJuryMutation({ actor, action: 'console.read', resourceTenantId: 'org-b' }).ok, true);
  const back = resolveJuryActor({ userId: 'user-a', memberships: mine, activeTenantId: 'org-a' });
  assert.equal(back.ok, true);
  if (back.ok) {
    assert.equal(back.tenantId, 'org-a');
    assert.equal(back.role, 'OWNER');
    assert.equal(decideJuryMutation({ actor: back, action: 'settings.write', resourceTenantId: 'org-a' }).ok, true);
  }
  const forged = resolveJuryActor({ userId: 'user-a', memberships: mine, activeTenantId: 'org-c', clientTenantId: 'org-c' });
  assert.equal(forged.ok, true);
  if (forged.ok) assert.equal(forged.tenantId, 'org-a');
});

test('the console switcher posts to the server and links to organization creation', () => {
  const chrome = readFileSync(new URL('../../app/(root)/jury/ui.tsx', import.meta.url), 'utf8');
  const switcher = readFileSync(new URL('../../components/jury/OrganizationSwitcher.tsx', import.meta.url), 'utf8');
  const action = readFileSync(new URL('../../app/(root)/jury/organization/actions.ts', import.meta.url), 'utf8');
  assert.match(chrome, /OrganizationSwitcher/);
  assert.match(chrome, /listOrganizationsForUser/);
  assert.match(switcher, /juryHref\('\/organization\/create'\)/);
  assert.match(switcher, /switchJuryOrganization/);
  assert.equal(switcher.includes('localStorage'), false);
  assert.match(action, /planOrganizationSwitch/);
  assert.match(action, /listMembershipsForUser/);
  assert.match(action, /activeOrganizationCookie/);
  assert.match(action, /juryHref\('\/'\)/);
  assert.equal(action.includes('searchParams'), false);
});
