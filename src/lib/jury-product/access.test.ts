/**
 * Jury console access boundary.
 * Run: node --import tsx --test src/lib/jury-product/access.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { decideJuryMutation, resolveJuryActor, type JuryAction } from './access';
import { readJuryConsole, readJuryReviewDetail } from './console-view';
import { JURY_CONSOLE_FIXTURE } from './console-fixture';
import { loadJuryMembershipDirectory } from './membership-directory';
import type { JuryMembership } from './records';

const ownerA: JuryMembership = {
  id: 'mem-owner-a',
  tenantId: 'tenant-a',
  userId: 'user-owner',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const memberA: JuryMembership = {
  id: 'mem-member-a',
  tenantId: 'tenant-a',
  userId: 'user-member',
  role: 'MEMBER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const auditorA: JuryMembership = {
  id: 'mem-auditor-a',
  tenantId: 'tenant-a',
  userId: 'user-auditor',
  role: 'AUDITOR',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const ownerAndMember: JuryMembership[] = [
  ownerA,
  {
    id: 'mem-owner-b',
    tenantId: 'tenant-b',
    userId: 'user-owner',
    role: 'OWNER',
    createdAt: '2026-10-02T00:00:00.000Z',
  },
];

function actor(userId: string, memberships: JuryMembership[], clientTenantId?: string) {
  return resolveJuryActor({ userId, memberships, clientTenantId });
}

describe('resolveJuryActor', () => {
  it('does not grant access from a client tenant id', () => {
    const resolved = resolveJuryActor({
      userId: null,
      memberships: [ownerA],
      clientTenantId: 'tenant-a',
    });
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.equal(resolved.reason, 'UNAUTHENTICATED');
  });

  it('uses the membership tenant and ignores a different client tenant id', () => {
    const resolved = actor('user-owner', [ownerA], 'tenant-b');
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.tenantId, 'tenant-a');
      assert.equal(resolved.role, 'OWNER');
    }
  });

  it('refuses to pick among multiple memberships', () => {
    const resolved = actor('user-owner', ownerAndMember, 'tenant-b');
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.equal(resolved.reason, 'AMBIGUOUS_MEMBERSHIP');
  });

  it('denies a signed-in user with no membership', () => {
    const resolved = actor('user-stranger', [ownerA]);
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.equal(resolved.reason, 'NO_MEMBERSHIP');
  });
});

describe('OWNER MEMBER AUDITOR', () => {
  const owner = actor('user-owner', [ownerA]);
  const member = actor('user-member', [memberA]);
  const auditor = actor('user-auditor', [auditorA]);
  const ownerOnly: JuryAction[] = [
    'connection.write',
    'discovery.approve',
    'scope.write',
    'agent.execute',
    'automation.write',
    'settings.write',
    'membership.write',
  ];

  it('lets MEMBER start reviews and write improvements, not connections or settings', () => {
    assert.equal(decideJuryMutation({ actor: member, action: 'review.start', resourceTenantId: 'tenant-a', clientTenantId: 'tenant-b' }).ok, true);
    assert.equal(decideJuryMutation({ actor: member, action: 'improvement.write', resourceTenantId: 'tenant-a' }).ok, true);
    for (const action of ownerOnly) {
      const decision = decideJuryMutation({ actor: member, action, resourceTenantId: 'tenant-a' });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.reason, 'FORBIDDEN');
    }
  });

  it('lets OWNER change connections and settings inside the membership tenant only', () => {
    assert.equal(decideJuryMutation({ actor: owner, action: 'connection.write', resourceTenantId: 'tenant-a', clientTenantId: 'tenant-b' }).ok, true);
    const cross = decideJuryMutation({
      actor: owner,
      action: 'connection.write',
      resourceTenantId: 'tenant-b',
      clientTenantId: 'tenant-b',
    });
    assert.equal(cross.ok, false);
    if (!cross.ok) assert.equal(cross.reason, 'TENANT_MISMATCH');
  });

  it('gives AUDITOR read access and no change actions', () => {
    assert.equal(decideJuryMutation({ actor: auditor, action: 'console.read', resourceTenantId: 'tenant-a' }).ok, true);
    const writes: JuryAction[] = ['review.start', 'improvement.write', ...ownerOnly];
    for (const action of writes) {
      const decision = decideJuryMutation({ actor: auditor, action, resourceTenantId: 'tenant-a' });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.reason, 'FORBIDDEN');
    }
  });
});

describe('console tenant isolation', () => {
  it('hides the other tenant from an OWNER of tenant A', () => {
    const resolved = actor('user-owner', [ownerA], 'tenant-b');
    const view = readJuryConsole(resolved, JURY_CONSOLE_FIXTURE);
    assert.ok(view);
    const blob = JSON.stringify(view);
    assert.equal(blob.includes('TENANT_B_SECRET_CLAIM'), false);
    assert.equal(blob.includes('다른 조직 상점'), false);
    assert.equal(view?.connections.every((row) => row.tenantId === 'tenant-a'), true);
    assert.equal(readJuryReviewDetail(resolved, JURY_CONSOLE_FIXTURE, 'review-b'), null);
    const own = readJuryReviewDetail(resolved, JURY_CONSOLE_FIXTURE, 'review-a');
    assert.equal(own?.result.expectedDecision, 'ACCEPT');
    assert.equal(own?.result.evidenceStrength, 'strong');
  });

  it('returns no console data when the actor is not in a tenant', () => {
    assert.equal(readJuryConsole(actor('user-stranger', [ownerA]), JURY_CONSOLE_FIXTURE), null);
  });
});

describe('membership directory', () => {
  it('fails closed when the file is missing or a row is not a membership', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jury-mem-'));
    assert.deepEqual(await loadJuryMembershipDirectory(dir), []);
    await fs.writeFile(
      path.join(dir, 'memberships.json'),
      JSON.stringify([
        ownerA,
        { id: 'bad', tenantId: 'tenant-x', userId: 'user-x', role: 'ADMIN', createdAt: '2026-10-01T00:00:00.000Z' },
      ]),
      'utf8',
    );
    const loaded = await loadJuryMembershipDirectory(dir);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.role, 'OWNER');
    assert.equal(loaded.some((row) => row.role === ('ADMIN' as 'OWNER')), false);
  });
});
