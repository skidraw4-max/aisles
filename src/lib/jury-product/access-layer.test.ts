/**
 * Access Layer checks tenant and scope before any adapter runs.
 * Run: node --import tsx --test src/lib/jury-product/access-layer.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import type { JuryActor } from './access';
import { createAccessContext, type JuryAccessContext } from './access-layer';
import { runAisleAdapter } from './aisle-adapter';
import { runAisleServiceAccess } from './service-access';
import type { JuryAccessScope, JuryServiceConnection } from './records';

const owner: JuryActor = {
  ok: true,
  userId: 'user-owner',
  tenantId: 'tenant-a',
  role: 'OWNER',
  membershipId: 'mem-owner',
};

const connection: JuryServiceConnection = {
  id: 'conn-a',
  tenantId: 'tenant-a',
  serviceKey: 'aisle',
  displayName: 'AIsle',
  accessMethod: 'API_KEY',
  status: 'CONNECTED',
  credentialRef: 'secret-store/aisle',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const scope: JuryAccessScope = {
  id: 'scope-a',
  tenantId: 'tenant-a',
  connectionId: 'conn-a',
  status: 'APPROVED',
  grants: [{ resource: 'metric:aisle.routes', mode: 'READ' }],
  approvedByUserId: 'user-owner',
  approvedAt: '2026-10-01T04:00:00.000Z',
};

describe('access context', () => {
  it('issues a context only for an approved scope and ignores the client tenant id', () => {
    const issued = createAccessContext({
      actor: owner,
      connection,
      scope,
      clientTenantId: 'tenant-b',
    });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    assert.equal(issued.context.tenantId, 'tenant-a');
    assert.notEqual(issued.context.tenantId, 'tenant-b');
    assert.equal(issued.context.credentialRef, 'secret-store/aisle');
    assert.equal(issued.context.grants.every((grant) => grant.mode === 'READ'), true);
  });

  it('does not issue a context for a PROPOSED scope', () => {
    const issued = createAccessContext({
      actor: owner,
      connection,
      scope: { ...scope, status: 'PROPOSED' },
      clientTenantId: 'tenant-b',
    });
    assert.equal(issued.ok, false);
    if (!issued.ok) assert.equal(issued.reason, 'SCOPE_NOT_APPROVED');
  });

  it('does not issue a context for another tenant connection', () => {
    const issued = createAccessContext({
      actor: owner,
      connection: { ...connection, tenantId: 'tenant-b' },
      scope,
      clientTenantId: 'tenant-b',
    });
    assert.equal(issued.ok, false);
    if (!issued.ok) assert.equal(issued.reason, 'TENANT_MISMATCH');
  });

  it('requires a credential pointer and a supported access method', () => {
    const missing = createAccessContext({
      actor: owner,
      connection: { ...connection, credentialRef: '  ' },
      scope,
    });
    const unsupported = createAccessContext({
      actor: owner,
      connection: { ...connection, accessMethod: 'SSH' },
      scope,
    });
    const wide = createAccessContext({
      actor: owner,
      connection,
      scope: { ...scope, grants: [{ resource: 'db', mode: 'WRITE' }] },
    });
    assert.equal(missing.ok, false);
    assert.equal(unsupported.ok, false);
    assert.equal(wide.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'CREDENTIAL_REF_REQUIRED');
    if (!unsupported.ok) assert.equal(unsupported.reason, 'ACCESS_METHOD_UNSUPPORTED');
    if (!wide.ok) assert.equal(wide.reason, 'LEAST_PRIVILEGE');
  });
});

describe('aisle adapter boundary', () => {
  it('does not run the adapter while the scope is PROPOSED', async () => {
    const result = await runAisleServiceAccess({
      actor: owner,
      connection: { ...connection, serviceKey: 'mock-aisle', status: 'DISCOVERY_PENDING', credentialRef: undefined },
      scope: { ...scope, status: 'PROPOSED' },
      clientTenantId: 'tenant-b',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'SCOPE_NOT_APPROVED');
    assert.equal('targets' in result, false);
  });

  it('uses only an access-layer context and does not echo the credential pointer', async () => {
    const result = await runAisleServiceAccess({
      actor: owner,
      connection,
      scope,
      clientTenantId: 'tenant-b',
      evidenceDb: {
        user: { count: async () => 0 },
        post: {
          count: async () => 0,
          aggregate: async () => ({ _sum: { views: 0 } }),
          groupBy: async () => [],
          findMany: async () => [],
        },
        comment: { count: async () => 0, findMany: async () => [] },
        postLike: { findMany: async () => [] },
        bookmark: { findMany: async () => [] },
        gameScore: { findMany: async () => [] },
        postViewDaily: { aggregate: async () => ({ _sum: { count: 0 } }) },
      } as unknown as import('@/lib/ai-review-board/evidence-pack').EvidenceDb,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.executed, true);
    assert.equal(result.tenantId, 'tenant-a');
    assert.equal(JSON.stringify(result).includes('secret-store/aisle'), false);

    const forged = {
      tenantId: 'tenant-b',
      connectionId: 'conn-b',
      serviceKey: 'other',
      accessMethod: 'API_KEY',
      credentialRef: 'raw-token',
      grants: [{ resource: 'metric:other', mode: 'READ' }],
      scopeId: 'scope-b',
    } as JuryAccessContext;
    const rejected = await runAisleAdapter(forged);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.reason, 'CONTEXT_NOT_ISSUED');
    assert.equal(JSON.stringify(rejected).includes('raw-token'), false);
  });

  it('does not let the adapter choose a tenant or open its own network call', () => {
    const accessSource = fs.readFileSync(new URL('./access-layer.ts', import.meta.url), 'utf8');
    const adapterSource = fs.readFileSync(new URL('./aisle-adapter.ts', import.meta.url), 'utf8');
    const pipelineSource = fs.readFileSync(new URL('./service-access.ts', import.meta.url), 'utf8');
    assert.equal(adapterSource.includes('clientTenantId'), false);
    assert.equal(adapterSource.includes('console.'), false);
    assert.equal(adapterSource.includes('fetch('), false);
    assert.equal(adapterSource.includes('JuryEvidence'), false);
    assert.equal(accessSource.includes('fetch('), false);
    assert.equal(accessSource.includes('JURY_CONSOLE_FIXTURE'), false);
    assert.match(pipelineSource, /createAccessContext\([\s\S]*runAisleAdapter\(/);
  });
});
