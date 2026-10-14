/**
 * Read-only observation of the existing EvidencePack.
 * The product layer may call the v9.x readers. It must not change their result.
 * Run: node --import tsx --test src/lib/jury-product/collection.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attachGa4Evidence } from '@/lib/ai-review-board/ga4-evidence';
import { buildEvidencePackFromDb, type EvidenceDb } from '@/lib/ai-review-board/evidence-pack';
import type { JuryActor } from './access';
import { runAisleServiceAccess } from './service-access';

const owner: JuryActor = {
  ok: true,
  userId: 'user-owner',
  tenantId: 'tenant-a',
  role: 'OWNER',
  membershipId: 'mem-owner',
};

const connection = {
  id: 'conn-a',
  tenantId: 'tenant-a',
  serviceKey: 'aisle',
  accessMethod: 'READ_ONLY_ACCOUNT',
  status: 'CONNECTED',
  credentialRef: 'secret-store/aisle',
};

const scope = {
  id: 'scope-a',
  tenantId: 'tenant-a',
  connectionId: 'conn-a',
  status: 'APPROVED',
  grants: [{ resource: 'metric:aisle.routes', mode: 'READ' }],
};

const GA4_ENV = [
  'GA4_PROPERTY_ID',
  'GA4_SERVICE_ACCOUNT_JSON',
  'GA4_SERVICE_ACCOUNT_JSON_BASE64',
  'GOOGLE_APPLICATION_CREDENTIALS',
] as const;

function observationDb(): EvidenceDb {
  return {
    user: {
      count: async (args?: { where?: unknown }) => (args?.where ? null : 0),
    },
    post: {
      count: async () => 0,
      aggregate: async () => ({ _sum: { views: 0 } }),
      groupBy: async () => [],
      findMany: async () => [],
    },
    comment: {
      count: async () => 0,
      findMany: async () => [],
    },
    postLike: { findMany: async () => [] },
    bookmark: { findMany: async () => [] },
    gameScore: { findMany: async () => [] },
    postViewDaily: {
      aggregate: async () => ({ _sum: { count: null } }),
    },
  } as unknown as EvidenceDb;
}

async function withoutGa4<T>(run: () => Promise<T>): Promise<T> {
  const saved = GA4_ENV.map((key) => [key, process.env[key]] as const);
  for (const key of GA4_ENV) delete process.env[key];
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('aisle read-only collection', () => {
  it('blocks PROPOSED, DISCONNECTED, a missing credential, and another tenant before any read', async () => {
    let reads = 0;
    const db = observationDb();
    const counting = {
      ...db,
      user: {
        count: async () => {
          reads += 1;
          return 0;
        },
      },
    } as unknown as EvidenceDb;
    const proposed = await runAisleServiceAccess({
      actor: owner,
      connection: { ...connection, serviceKey: 'mock-aisle', status: 'DISCOVERY_PENDING', credentialRef: undefined },
      scope: { ...scope, status: 'PROPOSED' },
      clientTenantId: 'tenant-b',
      evidenceDb: counting,
    });
    const disconnected = await runAisleServiceAccess({
      actor: owner,
      connection: { ...connection, status: 'DISCONNECTED' },
      scope,
      evidenceDb: counting,
    });
    const missing = await runAisleServiceAccess({
      actor: owner,
      connection: { ...connection, credentialRef: '' },
      scope,
      evidenceDb: counting,
    });
    const foreign = await runAisleServiceAccess({
      actor: owner,
      connection: { ...connection, tenantId: 'tenant-b' },
      scope,
      clientTenantId: 'tenant-b',
      evidenceDb: counting,
    });
    assert.equal(proposed.ok, false);
    assert.equal(disconnected.ok, false);
    assert.equal(missing.ok, false);
    assert.equal(foreign.ok, false);
    if (!proposed.ok) assert.equal(proposed.reason, 'SCOPE_NOT_APPROVED');
    if (!disconnected.ok) assert.equal(disconnected.reason, 'CONNECTION_NOT_APPROVED');
    if (!missing.ok) assert.equal(missing.reason, 'CREDENTIAL_REF_REQUIRED');
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
    assert.equal(reads, 0);
  });

  it('observes the existing pack without changing zero, null, period, or privacy flags', async () => {
    await withoutGa4(async () => {
      const db = observationDb();
      const directBuilt = await buildEvidencePackFromDb(db);
      const direct = await attachGa4Evidence(directBuilt);
      const result = await runAisleServiceAccess({
        actor: owner,
        connection,
        scope,
        clientTenantId: 'tenant-b',
        evidenceDb: db,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.executed, true);
      assert.equal(result.tenantId, 'tenant-a');
      assert.equal(result.pack.piiExcluded, true);
      assert.equal(result.pack.readOnly, true);
      assert.equal(result.pack.aggregates.userCount, 0);
      assert.equal(result.pack.aggregates.newUsersLast7d, null);
      assert.equal(result.pack.aggregates.usersLast7d, null);
      assert.equal(result.pack.analysisPeriod?.timezone, 'Asia/Seoul');
      assert.deepEqual(result.pack.analysisPeriod, direct.analysisPeriod);
      assert.deepEqual(result.pack.aggregates, direct.aggregates);
      assert.deepEqual(result.pack.docsHints, direct.docsHints);
      assert.deepEqual(result.pack.evidenceItems, direct.evidenceItems);
      assert.deepEqual(result.pack.ga4, direct.ga4);
      assert.equal(result.pack.ga4?.available, false);
      assert.equal(JSON.stringify(result).includes('secret-store/aisle'), false);
    });
  });

  it('returns a reader failure without storing a pack', async () => {
    const db = observationDb();
    db.user.count = (async () => {
      throw new Error('reader failed secret-store/aisle');
    }) as unknown as EvidenceDb['user']['count'];
    const result = await runAisleServiceAccess({
      actor: owner,
      connection,
      scope,
      evidenceDb: db,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'COLLECTION_FAILED');
      assert.equal('pack' in result, false);
    }
    assert.equal(JSON.stringify(result).includes('secret-store/aisle'), false);
  });
});
