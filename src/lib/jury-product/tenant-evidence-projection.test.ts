import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { projectTenantEvidenceToPack } from './tenant-evidence-projection';
import type { JuryEvidence, JuryNormalizedMetric } from './records';

const NOW = '2026-10-02T00:30:00.000Z';

test('declared metrics keep zero and null in the pack', () => {
  const zero = project(metric('newUsersLast7d', 'AVAILABLE', 0));
  assert.equal(zero.ok, true);
  if (!zero.ok) return;
  assert.equal(zero.pack.aggregates.newUsersLast7d, 0);
  assert.equal(zero.pack.aggregates.userCount, null);
  assert.equal(zero.pack.piiExcluded, true);
  assert.equal(zero.pack.readOnly, true);
  assert.equal(zero.pack.analysisPeriod?.timezone, 'Asia/Seoul');
  assert.deepEqual(zero.pack.docsHints, []);
  assert.equal(zero.pack.evidenceItems?.find((item) => item.id === 'DB_NEW_USERS_7D')?.value, 0);
  assert.equal(JSON.stringify(zero.pack).includes('password='), false);

  const finite = project(metric('userCount', 'AVAILABLE', 12));
  assert.equal(finite.ok, true);
  if (finite.ok) assert.equal(finite.pack.aggregates.userCount, 12);
  for (const availability of ['NOT_MEASURED', 'NOT_AVAILABLE', 'PERMISSION_DENIED', 'COLLECTION_FAILED'] as const) {
    const packed = project(metric('commentsLast7d', availability, 4));
    assert.equal(packed.ok, true);
    if (packed.ok) assert.equal(packed.pack.aggregates.commentsLast7d, null);
  }
  const missing = project(metric('activeUsersLast7d', 'AVAILABLE', null));
  assert.equal(missing.ok, true);
  if (missing.ok) assert.equal(missing.pack.aggregates.activeUsersLast7d, null);
  const nan = project(metric('postCount', 'AVAILABLE', Number.NaN));
  assert.equal(nan.ok, true);
  if (nan.ok) assert.equal(nan.pack.aggregates.postCount, null);

  const file = project(metric('viewsLast7d', 'AVAILABLE', 3, 'FILE'));
  assert.equal(file.ok, true);
  if (file.ok) assert.equal(file.pack.aggregates.viewsLast7d, 3);
  assert.equal(project(metric('totalViews', 'AVAILABLE', 1, 'DATABASE')).ok, false);
  assert.equal(project(metric('commentCount', 'AVAILABLE', 1, 'GA4')).ok, false);

  const ga4 = project(metric('ga4.newUsers', 'AVAILABLE', 0));
  assert.equal(ga4.ok, true);
  if (ga4.ok) {
    assert.equal(ga4.pack.ga4?.users?.newUsers, 0);
    assert.equal(ga4.pack.ga4?.propertyId, null);
    assert.equal(ga4.pack.ga4?.available, true);
  }
  const again = project(metric('newUsersLast7d', 'AVAILABLE', 0));
  assert.equal(again.ok && zero.ok, true);
  if (again.ok && zero.ok) assert.deepEqual(again.pack, zero.pack);
  assert.equal(JSON.stringify(zero.pack.docsHints).includes('0'), false);
});

test('tenant projection does not import host collectors', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/tenant-evidence-projection.ts'), 'utf8');
  assert.equal(source.includes('buildEvidencePackFromDb'), false);
  assert.equal(source.includes('attachGa4Evidence'), false);
  assert.equal(source.includes('runAisleAdapter'), false);
  assert.equal(source.includes('prisma.user'), false);
  assert.equal(source.includes('prisma.post'), false);
  assert.equal(source.includes('prisma.comment'), false);
  assert.equal(source.includes('GA4_PROPERTY_ID'), false);
  assert.equal(source.includes('GA4_SERVICE_ACCOUNT'), false);
  assert.equal(source.includes('GOOGLE_APPLICATION_CREDENTIALS'), false);
  assert.equal(source.includes('if (!value)'), false);
  assert.equal(source.includes('if (!metric.value)'), false);
});

function project(row: JuryNormalizedMetric) {
  const evidence: JuryEvidence & { piiExcluded: boolean; readOnly: boolean } = {
    id: 'evidence-1',
    tenantId: 'tenant-1',
    connectionId: 'connection-1',
    purpose: 'tenant-declared-observation',
    periodStart: '2026-09-25',
    periodEnd: '2026-10-01',
    timezone: 'Asia/Seoul',
    metricIds: [row.id],
    adapterKey: 'console-declared',
    collectedAt: NOW,
    piiExcluded: true,
    readOnly: true,
  };
  return projectTenantEvidenceToPack({
    evidence,
    metrics: [{ ...row, evidenceId: evidence.id }],
    generatedAt: NOW,
    siteName: 'Acme',
  });
}

function metric(
  name: string,
  availability: JuryNormalizedMetric['availability'],
  value: number | null,
  sourceSystem: JuryNormalizedMetric['sourceSystem'] = 'OTHER',
): JuryNormalizedMetric {
  return {
    id: `metric-${name}-${availability}-${sourceSystem}`,
    tenantId: 'tenant-1',
    connectionId: 'connection-1',
    metric: name,
    value,
    unit: 'COUNT',
    periodStart: '2026-09-25',
    periodEnd: '2026-10-01',
    timezone: 'Asia/Seoul',
    sourceSystem,
    sourceRef: 'console-declared',
    collectedAt: NOW,
    availability,
    rawPayloadRef: 'tenant-declared:console-declared',
    adapterKey: 'console-declared',
    adapterVersion: 'v1',
    ruleId: 'normalize.tenant-declared.v1',
  };
}
