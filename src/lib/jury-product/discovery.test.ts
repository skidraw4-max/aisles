/**
 * Discovery proposes surfaces and metrics. It does not measure or call a network.
 * Run: node --import tsx --test src/lib/jury-product/discovery.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import type { JuryActor } from './access';
import {
  buildMockDiscovery,
  planMetricCollection,
  planScopeDecision,
  planServiceTarget,
  runMockDiscovery,
  runScopeDecision,
  type DiscoveryTx,
} from './discovery';
import type { JuryAccessScope, JuryDiscoveryResult, JuryServiceConnection } from './records';

const owner: JuryActor = {
  ok: true,
  userId: 'user-owner',
  tenantId: 'tenant-a',
  role: 'OWNER',
  membershipId: 'mem-owner',
};

function actor(role: 'MEMBER' | 'AUDITOR'): JuryActor {
  return {
    ok: true,
    userId: `user-${role.toLowerCase()}`,
    tenantId: 'tenant-a',
    role,
    membershipId: `mem-${role.toLowerCase()}`,
  };
}

const connection: JuryServiceConnection = {
  id: 'conn-a',
  tenantId: 'tenant-a',
  serviceKey: 'shop',
  displayName: 'Shop',
  accessMethod: 'API_KEY',
  status: 'DISCOVERY_PENDING',
  credentialRef: 'secret-store/shop',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function ids() {
  const values = ['discovery-1', 'scope-1', 'audit-1', 'audit-2'];
  return () => values.shift() ?? 'extra';
}

function hasMeasurement(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.some(hasMeasurement);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => key === 'value' || key === 'measurement' || hasMeasurement(child));
}

describe('mock discovery', () => {
  it('proposes surfaces and metrics without a measurement or the credential', () => {
    const draft = buildMockDiscovery({
      actorTenantId: 'tenant-a',
      connection,
      clientTenantId: 'tenant-b',
      now: '2026-10-01T03:00:00.000Z',
      allocateId: ids(),
    });
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    assert.equal(draft.discovery.tenantId, 'tenant-a');
    assert.notEqual(draft.discovery.tenantId, 'tenant-b');
    assert.equal(draft.discovery.approval, 'PENDING');
    assert.deepEqual(draft.discovery.proposedMetrics[0], {
      metric: draft.discovery.proposedMetrics[0]?.metric,
      reason: draft.discovery.proposedMetrics[0]?.reason,
    });
    assert.equal(draft.discovery.proposedMetrics.length > 0, true);
    assert.equal(draft.scope.status, 'PROPOSED');
    assert.equal(draft.scope.grants.every((grant) => grant.mode === 'READ'), true);
    assert.equal(hasMeasurement(draft.discovery), false);
    assert.equal(JSON.stringify(draft).includes('secret-store/shop'), false);
    for (const surface of ['FRONTEND', 'ADMIN', 'BO', 'API'] as const) {
      assert.equal(draft.discovery.surfaces.includes(surface), true);
    }
  });

  it('does not discover a connection from another tenant', () => {
    const draft = buildMockDiscovery({
      actorTenantId: 'tenant-a',
      connection: { ...connection, tenantId: 'tenant-b' },
      clientTenantId: 'tenant-b',
    });
    assert.equal(draft.ok, false);
    if (!draft.ok) assert.equal(draft.reason, 'TENANT_MISMATCH');
  });

  it('does not call the network', () => {
    const source = fs.readFileSync(new URL('./discovery.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('JURY_CONSOLE_FIXTURE'), false);
    assert.equal(source.includes('memberships.json'), false);
  });
});

describe('scope approval', () => {
  const discovery: JuryDiscoveryResult = {
    id: 'discovery-1',
    tenantId: 'tenant-a',
    connectionId: 'conn-a',
    exploredAt: '2026-10-01T03:00:00.000Z',
    surfaces: ['FRONTEND', 'ADMIN', 'BO', 'API'],
    menus: ['/'],
    dataSources: ['API', 'SCREEN'],
    feasibility: 'PARTIAL',
    proposedMetrics: [{ metric: 'routes', reason: '후보' }],
    approval: 'PENDING',
  };
  const scope: JuryAccessScope = {
    id: 'scope-1',
    tenantId: 'tenant-a',
    connectionId: 'conn-a',
    status: 'PROPOSED',
    grants: [{ resource: 'metric:routes', mode: 'READ' }],
  };

  it('lets only OWNER approve or revoke, and ignores a client tenant id', () => {
    const approved = planScopeDecision({
      actor: owner,
      scope,
      discovery,
      decision: 'APPROVE',
      clientTenantId: 'tenant-b',
    });
    const revoked = planScopeDecision({
      actor: owner,
      scope,
      discovery,
      decision: 'REJECT',
      clientTenantId: 'tenant-b',
    });
    assert.equal(approved.ok, true);
    assert.equal(revoked.ok, true);
    if (approved.ok) {
      assert.equal(approved.scope.status, 'APPROVED');
      assert.equal(approved.discovery.approval, 'APPROVED');
      assert.equal(approved.audit.action, 'SCOPE_APPROVED');
      assert.equal(approved.audit.tenantId, 'tenant-a');
    }
    if (revoked.ok) {
      assert.equal(revoked.scope.status, 'REVOKED');
      assert.equal(revoked.discovery.approval, 'REJECTED');
      assert.equal(revoked.audit.action, 'SCOPE_REVOKED');
    }
    for (const role of ['MEMBER', 'AUDITOR'] as const) {
      const decision = planScopeDecision({
        actor: actor(role),
        scope,
        discovery,
        decision: 'APPROVE',
      });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.reason, 'FORBIDDEN');
    }
  });

  it('blocks metric collection until the scope is approved', () => {
    const blocked = planMetricCollection({ actor: owner, scope, clientTenantId: 'tenant-b' });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, 'SCOPE_NOT_APPROVED');
    const open = planMetricCollection({
      actor: owner,
      scope: { ...scope, status: 'APPROVED' },
    });
    assert.equal(open.ok, false);
    if (!open.ok) assert.equal(open.reason, 'NOT_IMPLEMENTED');
  });
});

describe('discovery commit', () => {
  it('writes the result, proposed scope, and both audits for the actor tenant only', async () => {
    const audits: string[] = [];
    const scopes: JuryAccessScope[] = [];
    const tx: DiscoveryTx = {
      async findConnection(tenantId, connectionId) {
        if (tenantId !== connection.tenantId || connectionId !== connection.id) return null;
        return connection;
      },
      async insertDiscovery(row) {
        assert.equal(row.tenantId, 'tenant-a');
        assert.equal(hasMeasurement(row), false);
      },
      async insertScope(row) {
        scopes.push(row);
      },
      async updateConnectionStatus() {},
      async findScope() {
        return null;
      },
      async findDiscovery() {
        return null;
      },
      async updateScope() {},
      async updateDiscoveryApproval() {},
      async appendAudit(event) {
        audits.push(event.action);
        assert.equal(event.tenantId, 'tenant-a');
      },
    };
    const decision = await runMockDiscovery(
      { actor: owner, connectionId: 'conn-a', clientTenantId: 'tenant-b', allocateId: ids(), now: '2026-10-01T03:00:00.000Z' },
      tx,
    );
    assert.equal(decision.ok, true);
    assert.equal(scopes[0]?.status, 'PROPOSED');
    assert.deepEqual(audits, ['DISCOVERY_RECORDED', 'SCOPE_PROPOSED']);
  });

  it('does not write a second discovery for the same connection', async () => {
    const audits: string[] = [];
    const tx: DiscoveryTx = {
      async findConnection() {
        return connection;
      },
      async insertDiscovery() {
        throw new Error('should not insert');
      },
      async insertScope() {
        throw new Error('should not insert');
      },
      async updateConnectionStatus() {},
      async findScope() {
        return null;
      },
      async findDiscovery() {
        return {
          id: 'discovery-1',
          tenantId: 'tenant-a',
          connectionId: 'conn-a',
          exploredAt: '2026-10-01T03:00:00.000Z',
          surfaces: ['FRONTEND'],
          menus: ['/'],
          dataSources: ['SCREEN'],
          feasibility: 'PARTIAL',
          proposedMetrics: [{ metric: 'routes', reason: '후보' }],
          approval: 'PENDING',
        };
      },
      async updateScope() {},
      async updateDiscoveryApproval() {},
      async appendAudit(event) {
        audits.push(event.action);
      },
    };
    const decision = await runMockDiscovery({ actor: owner, connectionId: 'conn-a' }, tx);
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, 'ALREADY_DECIDED');
    assert.deepEqual(audits, []);
  });

  it('does not write when the connection is outside the actor tenant', async () => {
    const audits: string[] = [];
    const tx: DiscoveryTx = {
      async findConnection() {
        return null;
      },
      async insertDiscovery() {
        throw new Error('should not insert');
      },
      async insertScope() {
        throw new Error('should not insert');
      },
      async updateConnectionStatus() {},
      async findScope() {
        return null;
      },
      async findDiscovery() {
        return null;
      },
      async updateScope() {},
      async updateDiscoveryApproval() {},
      async appendAudit(event) {
        audits.push(event.action);
      },
    };
    const decision = await runMockDiscovery(
      { actor: owner, connectionId: 'conn-b', clientTenantId: 'tenant-b' },
      tx,
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, 'NOT_FOUND');
    assert.deepEqual(audits, []);
  });

  it('records approve and revoke audits only after the scope is still proposed', async () => {
    const scope: JuryAccessScope = {
      id: 'scope-1',
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
      status: 'PROPOSED',
      grants: [{ resource: 'metric:routes', mode: 'READ' }],
    };
    const discovery: JuryDiscoveryResult = {
      id: 'discovery-1',
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
      exploredAt: '2026-10-01T03:00:00.000Z',
      surfaces: ['FRONTEND'],
      menus: ['/'],
      dataSources: ['SCREEN'],
      feasibility: 'PARTIAL',
      proposedMetrics: [{ metric: 'routes', reason: '후보' }],
      approval: 'PENDING',
    };
    const audits: string[] = [];
    const tx: DiscoveryTx = {
      async findConnection() {
        return null;
      },
      async insertDiscovery() {},
      async insertScope() {},
      async updateConnectionStatus() {},
      async findScope(tenantId, scopeId) {
        if (tenantId !== 'tenant-a' || scopeId !== 'scope-1') return null;
        return scope;
      },
      async findDiscovery(tenantId, connectionId) {
        if (tenantId !== 'tenant-a' || connectionId !== 'conn-a') return null;
        return discovery;
      },
      async updateScope(_id, status) {
        scope.status = status;
      },
      async updateDiscoveryApproval(_id, approval) {
        discovery.approval = approval;
      },
      async appendAudit(event) {
        audits.push(event.action);
      },
    };
    const member = await runScopeDecision({ actor: actor('MEMBER'), scopeId: 'scope-1', decision: 'APPROVE' }, tx);
    assert.equal(member.ok, false);
    const approved = await runScopeDecision(
      { actor: owner, scopeId: 'scope-1', decision: 'APPROVE', clientTenantId: 'tenant-b' },
      tx,
    );
    assert.equal(approved.ok, true);
    const again = await runScopeDecision({ actor: owner, scopeId: 'scope-1', decision: 'REJECT' }, tx);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.reason, 'ALREADY_DECIDED');
    assert.deepEqual(audits, ['SCOPE_APPROVED']);
  });
});

describe('service target', () => {
  it('keeps the new connection in the actor tenant and drops a supplied credential', () => {
    const decision = planServiceTarget({
      actor: owner,
      serviceKey: 'shop',
      displayName: 'Shop',
      accessMethod: 'API_KEY',
      credentialRef: 'raw-token',
      clientTenantId: 'tenant-b',
      allocateId: () => 'conn-new',
      now: '2026-10-01T03:00:00.000Z',
    });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.connection.tenantId, 'tenant-a');
      assert.equal(decision.connection.credentialRef, undefined);
      assert.equal(JSON.stringify(decision.connection).includes('raw-token'), false);
    }
    const member = planServiceTarget({
      actor: actor('MEMBER'),
      serviceKey: 'shop',
      displayName: 'Shop',
      accessMethod: 'API_KEY',
    });
    assert.equal(member.ok, false);
  });
});
