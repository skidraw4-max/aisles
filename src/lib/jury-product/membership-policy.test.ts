/**
 * Jury membership invariants. No database and no JSON directory.
 * Run: node --import tsx --test src/lib/jury-product/membership-policy.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import type { JuryActor } from './access';
import {
  planMembershipCommand,
  runMembershipCommand,
  type MembershipTx,
} from './membership-policy';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-owner',
  tenantId: 'tenant-a',
  userId: 'user-owner',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const member: JuryMembership = {
  id: 'mem-member',
  tenantId: 'tenant-a',
  userId: 'user-member',
  role: 'MEMBER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

function actor(role: JuryMembership['role'], userId = 'user-owner'): JuryActor {
  return {
    ok: true,
    userId,
    tenantId: 'tenant-a',
    role,
    membershipId: role === 'OWNER' ? owner.id : member.id,
  };
}

describe('membership invariants', () => {
  it('lets a signed-in user create one tenant and become its only OWNER', () => {
    const decision = planMembershipCommand({
      kind: 'CREATE_TENANT',
      userId: 'user-new',
      existingMemberships: [],
      tenantName: 'Aisle Studio',
      clientTenantId: 'tenant-b',
      allocateId: () => 'tenant-new',
    });
    assert.equal(decision.ok, true);
    if (decision.ok && decision.kind === 'CREATE_TENANT') {
      assert.equal(decision.tenantId, 'tenant-new');
      assert.notEqual(decision.tenantId, 'tenant-b');
      assert.equal(decision.membership.role, 'OWNER');
      assert.equal(decision.audit.action, 'TENANT_CREATED');
      assert.equal(decision.audit.tenantId, 'tenant-new');
      assert.equal(decision.membershipAudit.action, 'MEMBERSHIP_ADDED');
      assert.equal(decision.membershipAudit.role, 'OWNER');
      assert.equal(decision.membershipAudit.targetUserId, 'user-new');
      assert.equal(decision.membershipAudit.tenantId, 'tenant-new');
    }
  });

  it('does not create a second membership for someone who already has one', () => {
    const decision = planMembershipCommand({
      kind: 'CREATE_TENANT',
      userId: 'user-owner',
      existingMemberships: [owner],
      tenantName: 'Second',
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, 'ALREADY_HAS_MEMBERSHIP');
  });

  it('lets OWNER add a member in the actor tenant and ignores a client tenant id', () => {
    const decision = planMembershipCommand({
      kind: 'ADD_MEMBER',
      actor: actor('OWNER'),
      tenantMembers: [owner],
      targetExisting: [],
      targetUserId: 'user-new',
      role: 'MEMBER',
      clientTenantId: 'tenant-b',
    });
    assert.equal(decision.ok, true);
    if (decision.ok && decision.kind === 'ADD_MEMBER') {
      assert.equal(decision.membership.tenantId, 'tenant-a');
      assert.equal(decision.audit.tenantId, 'tenant-a');
    }
  });

  it('refuses MEMBER and AUDITOR membership changes', () => {
    for (const role of ['MEMBER', 'AUDITOR'] as const) {
      const decision = planMembershipCommand({
        kind: 'ADD_MEMBER',
        actor: actor(role, role === 'MEMBER' ? 'user-member' : 'user-auditor'),
        tenantMembers: [owner, member],
        targetExisting: [],
        targetUserId: 'user-new',
        role: 'AUDITOR',
      });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.reason, 'FORBIDDEN');
    }
  });

  it('refuses to remove or demote the last OWNER', () => {
    const remove = planMembershipCommand({
      kind: 'REMOVE_MEMBER',
      actor: actor('OWNER'),
      tenantMembers: [owner, member],
      targetUserId: 'user-owner',
    });
    const demote = planMembershipCommand({
      kind: 'CHANGE_ROLE',
      actor: actor('OWNER'),
      tenantMembers: [owner],
      targetUserId: 'user-owner',
      role: 'MEMBER',
    });
    assert.equal(remove.ok, false);
    assert.equal(demote.ok, false);
    if (!remove.ok) assert.equal(remove.reason, 'LAST_OWNER');
    if (!demote.ok) assert.equal(demote.reason, 'LAST_OWNER');
  });

  it('lets an OWNER leave after another OWNER exists', () => {
    const second: JuryMembership = { ...owner, id: 'mem-owner-2', userId: 'user-owner-2' };
    const decision = planMembershipCommand({
      kind: 'REMOVE_MEMBER',
      actor: actor('OWNER'),
      tenantMembers: [owner, second],
      targetUserId: 'user-owner',
    });
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.audit.action, 'MEMBERSHIP_REMOVED');
  });

  it('does not change a user from another tenant', () => {
    const decision = planMembershipCommand({
      kind: 'REMOVE_MEMBER',
      actor: actor('OWNER'),
      tenantMembers: [owner],
      targetUserId: 'user-other',
      clientTenantId: 'tenant-b',
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, 'TARGET_NOT_IN_TENANT');
  });
});

describe('membership commit', () => {
  it('writes TENANT_CREATED and the first OWNER MEMBERSHIP_ADDED before it returns', async () => {
    const audits: string[] = [];
    const tx: MembershipTx = {
      async userExists() {
        return true;
      },
      async listTenant() {
        return [];
      },
      async listUser() {
        return [];
      },
      async createTenant() {},
      async createMembership(row) {
        assert.equal(row.role, 'OWNER');
        assert.equal(row.tenantId, 'tenant-new');
        assert.notEqual(row.tenantId, 'tenant-b');
      },
      async updateRole() {},
      async deleteMembership() {},
      async appendAudit(event) {
        audits.push(event.action);
        assert.equal(event.tenantId, 'tenant-new');
        assert.equal(event.targetUserId, 'user-new');
      },
    };
    const decision = await runMembershipCommand(
      {
        kind: 'CREATE_TENANT',
        userId: 'user-new',
        tenantName: 'Aisle Studio',
        clientTenantId: 'tenant-b',
        allocateId: () => 'tenant-new',
      },
      tx,
    );
    assert.equal(decision.ok, true);
    assert.deepEqual(audits, ['TENANT_CREATED', 'MEMBERSHIP_ADDED']);
  });

  it('rejects before success when the OWNER membership audit fails, so the surrounding transaction can roll back', async () => {
    const tx: MembershipTx = {
      async userExists() {
        return true;
      },
      async listTenant() {
        return [];
      },
      async listUser() {
        return [];
      },
      async createTenant() {},
      async createMembership() {},
      async updateRole() {},
      async deleteMembership() {},
      async appendAudit(event) {
        if (event.action === 'MEMBERSHIP_ADDED') throw new Error('audit failed');
      },
    };
    await assert.rejects(
      runMembershipCommand(
        {
          kind: 'CREATE_TENANT',
          userId: 'user-new',
          tenantName: 'Aisle Studio',
          allocateId: () => 'tenant-new',
        },
        tx,
      ),
    );
    const source = fs.readFileSync(new URL('./jury-db.ts', import.meta.url), 'utf8');
    assert.match(source, /prisma\.\$transaction\(async \(tx\) => runMembershipCommand\(/);
  });

  it('writes an audit row only after the invariant passes', async () => {
    const rows = [owner, member];
    const audits: string[] = [];
    const tx: MembershipTx = {
      async userExists() {
        return true;
      },
      async listTenant() {
        return rows;
      },
      async listUser(userId) {
        return rows.filter((row) => row.userId === userId);
      },
      async createTenant() {},
      async createMembership() {},
      async updateRole() {},
      async deleteMembership(id) {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      },
      async appendAudit(event) {
        audits.push(event.action);
      },
    };
    const blocked = await runMembershipCommand(
      {
        kind: 'REMOVE_MEMBER',
        actor: actor('OWNER'),
        targetUserId: 'user-owner',
      },
      tx,
    );
    assert.equal(blocked.ok, false);
    assert.equal(rows.some((row) => row.userId === 'user-owner'), true);
    assert.deepEqual(audits, []);
  });
});

describe('persistence boundary', () => {
  it('keeps the product session off the JSON directory', () => {
    const session = fs.readFileSync(new URL('./session.ts', import.meta.url), 'utf8');
    const load = fs.readFileSync(new URL('../../app/(root)/jury/load.ts', import.meta.url), 'utf8');
    const actions = fs.readFileSync(new URL('../../app/(root)/jury/actions.ts', import.meta.url), 'utf8');
    const route = fs.readFileSync(new URL('../../app/api/jury/console/route.ts', import.meta.url), 'utf8');
    const db = fs.readFileSync(new URL('./jury-db.ts', import.meta.url), 'utf8');
    for (const source of [session, load, actions, route, db]) {
      assert.equal(source.includes('membership-directory'), false);
      assert.equal(source.includes('memberships.json'), false);
      assert.equal(source.includes('JURY_CONSOLE_FIXTURE'), false);
    }
  });
});
