/**
 * Product evidence persistence. The normalizer stays pure and the pack stays unchanged.
 * Run: node --import tsx --test src/lib/jury-product/evidence-store.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from '@/lib/ai-review-board/evidence-pack';
import { buildProductEvidence, type BuiltJuryEvidence } from './evidence-builder';
import { commitProductEvidence, runProductEvidencePersist, type EvidenceWriteTx } from './evidence-store';
import type { JuryNormalizedMetric } from './records';

const built = buildProductEvidence({
  actorTenantId: 'tenant-a',
  connection: { id: 'conn-a', tenantId: 'tenant-a' },
  clientTenantId: 'tenant-b',
  pack: buildStubEvidencePack({
    generatedAt: '2026-10-01T00:00:00.000Z',
    analysisPeriod: { start: '2026-09-24', end: '2026-09-30', timezone: 'Asia/Seoul' },
    aggregates: {
      userCount: 0,
      newUsersLast7d: null,
      activeUsersLast7d: 2,
      postCount: 4,
      postsLast7d: 0,
      commentsLast7d: null,
      viewsLast7d: 3,
      totalViews: 0,
      commentCount: 1,
    },
  }),
});

if (!built.ok) throw new Error('fixture evidence did not build');
const fixture = built;

function memoryDb() {
  const evidence: BuiltJuryEvidence[] = [];
  const metrics: JuryNormalizedMetric[] = [];
  const tx: EvidenceWriteTx = {
    async findConnection(tenantId, connectionId) {
      if (tenantId === 'tenant-a' && connectionId === 'conn-a') return { id: 'conn-a', tenantId: 'tenant-a' };
      return null;
    },
    async findByIdentity(identity) {
      return (
        evidence.find(
          (row) =>
            row.tenantId === identity.tenantId &&
            row.connectionId === identity.connectionId &&
            row.purpose === identity.purpose &&
            row.periodStart === identity.periodStart &&
            row.periodEnd === identity.periodEnd &&
            row.timezone === identity.timezone &&
            row.contentHash === identity.contentHash,
        ) ?? null
      );
    },
    async listMetrics(evidenceId) {
      return metrics.filter((row) => row.evidenceId === evidenceId).map((row) => ({ ...row }));
    },
    async insertEvidence(row) {
      evidence.push({ ...row });
    },
    async insertMetrics(rows) {
      metrics.push(...rows.map((row) => ({ ...row })));
    },
  };
  return { tx, evidence, metrics };
}

describe('product evidence store', () => {
  it('reads back the same measurements, provenance, and privacy flags', async () => {
    const pack = buildStubEvidencePack({
      generatedAt: '2026-10-01T00:00:00.000Z',
      analysisPeriod: { start: '2026-09-24', end: '2026-09-30', timezone: 'Asia/Seoul' },
      aggregates: { userCount: 0, newUsersLast7d: null },
    });
    const before = JSON.stringify(pack);
    const { tx } = memoryDb();
    const saved = await runProductEvidencePersist(
      {
        actorTenantId: 'tenant-a',
        connectionId: 'conn-a',
        clientTenantId: 'tenant-b',
        evidence: fixture.evidence,
        metrics: fixture.metrics,
        credentialRef: 'raw-token-value',
      } as Parameters<typeof runProductEvidencePersist>[0],
      tx,
    );
    assert.equal(JSON.stringify(pack), before);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const zero = saved.metrics.find((metric) => metric.metric === 'userCount');
    const missing = saved.metrics.find((metric) => metric.metric === 'newUsersLast7d');
    assert.equal(zero?.value, 0);
    assert.equal(zero?.availability, 'AVAILABLE');
    assert.equal(missing?.value, null);
    assert.equal(missing?.availability, 'NOT_MEASURED');
    assert.equal(saved.evidence.tenantId, 'tenant-a');
    assert.equal(saved.evidence.connectionId, 'conn-a');
    assert.equal(saved.evidence.purpose, fixture.evidence.purpose);
    assert.equal(saved.evidence.periodStart, fixture.evidence.periodStart);
    assert.equal(saved.evidence.periodEnd, fixture.evidence.periodEnd);
    assert.equal(saved.evidence.timezone, 'Asia/Seoul');
    assert.equal(saved.evidence.contentHash, fixture.evidence.contentHash);
    assert.equal(saved.evidence.piiExcluded, true);
    assert.equal(saved.evidence.readOnly, true);
    assert.equal(JSON.stringify(saved).includes('raw-token-value'), false);
    for (const metric of saved.metrics) {
      const original = fixture.metrics.find((row) => row.id === metric.id);
      assert.equal(metric.value, original?.value);
      assert.equal(metric.unit, original?.unit);
      assert.equal(metric.availability, original?.availability);
      assert.equal(metric.sourceSystem, original?.sourceSystem);
      assert.equal(metric.sourceRef, original?.sourceRef);
      assert.equal(metric.adapterKey, original?.adapterKey);
      assert.equal(metric.adapterVersion, original?.adapterVersion);
      assert.equal(metric.ruleId, original?.ruleId);
      assert.equal(metric.periodStart, original?.periodStart);
      assert.equal(metric.timezone, original?.timezone);
    }
  });

  it('does not save another tenant and does not duplicate the same evidence', async () => {
    const db = memoryDb();
    const first = await runProductEvidencePersist(
      { actorTenantId: 'tenant-a', connectionId: 'conn-a', evidence: fixture.evidence, metrics: fixture.metrics },
      db.tx,
    );
    const second = await runProductEvidencePersist(
      { actorTenantId: 'tenant-a', connectionId: 'conn-a', evidence: fixture.evidence, metrics: fixture.metrics },
      db.tx,
    );
    const foreign = await runProductEvidencePersist(
      {
        actorTenantId: 'tenant-a',
        connectionId: 'conn-b',
        clientTenantId: 'tenant-b',
        evidence: { ...fixture.evidence, tenantId: 'tenant-b', connectionId: 'conn-b' },
        metrics: fixture.metrics.map((metric) => ({ ...metric, tenantId: 'tenant-b', connectionId: 'conn-b' })),
      },
      db.tx,
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.evidence.contentHash, first.evidence.contentHash);
    }
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
    assert.equal(db.evidence.length, 1);
  });

  it('rolls back the evidence row when a metric write fails', async () => {
    const db = memoryDb();
    const failing: EvidenceWriteTx = {
      ...db.tx,
      async insertMetrics() {
        throw new Error('metric write failed');
      },
    };
    await assert.rejects(() =>
      commitProductEvidence(
        { actorTenantId: 'tenant-a', connectionId: 'conn-a', evidence: fixture.evidence, metrics: fixture.metrics },
        {
          async transaction(work) {
            const copied = { evidence: [...db.evidence], metrics: [...db.metrics] };
            try {
              return await work(failing);
            } catch (error) {
              db.evidence.splice(0, db.evidence.length, ...copied.evidence);
              db.metrics.splice(0, db.metrics.length, ...copied.metrics);
              throw error;
            }
          },
        },
      ),
    );
    assert.equal(db.evidence.length, 0);
    assert.equal(db.metrics.length, 0);
  });

  it('keeps the product write inside one transaction and off v9.x', () => {
    const source = fs.readFileSync(new URL('./evidence-store.ts', import.meta.url), 'utf8');
    assert.match(source, /\$transaction/);
    assert.equal(source.includes('credentialRef'), false);
    assert.equal(source.includes('ai-review-board'), false);
  });
});
