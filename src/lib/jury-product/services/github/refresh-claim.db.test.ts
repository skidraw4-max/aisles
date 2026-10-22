/**
 * Proves the refresh claim against the Preview primary key.
 * It inserts and deletes only phase8024 fixture rows.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FrozenCoreReading } from '../../review-boundary';
import { JURY_CORE_CONTRACT_VERSION } from '../../records';
import { openPreviewDbTest } from '../../preview-db-guard';
import { createPrismaRefreshStore, insertRefreshClaim } from './refresh-store';

const TENANT = 'phase8024-refresh';
const CONNECTION = 'phase8024-connection';
const EVIDENCE = 'phase8024-evidence';
const REQUEST = 'phase8024-refresh-claim';
const PARENT_REQUEST = 'phase8024-parent-request';
const PARENT_RESULT = 'phase8024-parent-result';
const CHILD_RESULT = 'phase8024-child-result';
const LIVE_EVIDENCE = 'd1b0ad96d0eec8100ff599035b68e748933a142ade65058fb0830115ff97b5b1';
const LIVE_REQUEST = '69fd71a82cea4ca5d2f9e4af334bc03d0c50e9d1ee57416b63ec878b9770480a';
const LIVE_RESULT = 'd6a8e87391e7eb6d551b0ee9d3461c3f506f62100f447697696093a748a52de0';

test('refresh claim insert admits one concurrent primary key', { timeout: 180_000 }, async () => {
  const gate = await openPreviewDbTest(process.env, async () => {
    const { prisma } = await import('@/lib/prisma');
    const rows = await prisma.$queryRaw<Array<{ failed: number }>>`
      SELECT count(*)::int AS failed
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `;
    return Number(rows[0]?.failed ?? 1);
  });
  if (!gate.ok) assert.fail(gate.status);
  const { prisma } = await import('@/lib/prisma');
  const before = await liveRow(prisma);
  try {
    await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
    await prisma.juryServiceConnection.create({
      data: {
        id: CONNECTION,
        tenantId: TENANT,
        serviceKey: 'phase8024',
        displayName: 'phase8024',
        accessMethod: 'FILE_UPLOAD',
        status: 'DISCOVERY_PENDING',
      },
    });
    await prisma.juryEvidence.create({
      data: {
        id: EVIDENCE,
        tenantId: TENANT,
        connectionId: CONNECTION,
        purpose: 'phase8024-fixture',
        periodStart: '2026-10-09',
        periodEnd: '2026-10-09',
        timezone: 'Asia/Seoul',
        metricIds: [],
        adapterKey: 'fixture',
        collectedAt: new Date('2026-10-09T00:00:00.000Z'),
        piiExcluded: true,
        readOnly: true,
      },
    });
    const row = {
      id: REQUEST,
      tenantId: TENANT,
      connectionId: CONNECTION,
      evidenceId: EVIDENCE,
      fingerprint: 'a'.repeat(64),
      requestedByUserId: null,
    };
    const [left, right] = await Promise.all([insertRefreshClaim(row), insertRefreshClaim(row)]);
    assert.equal([left, right].filter(Boolean).length, 1);
    const stored = await prisma.juryReviewRequest.findFirst({ where: { id: REQUEST, tenantId: TENANT } });
    assert.equal(stored?.status, 'QUEUED');
    assert.equal(stored?.claim, row.fingerprint);
    assert.equal(stored?.evidenceId, EVIDENCE);
    await prisma.juryReviewRequest.create({
      data: {
        id: PARENT_REQUEST,
        tenantId: TENANT,
        connectionId: CONNECTION,
        evidenceId: EVIDENCE,
        reviewType: 'FULL_REVIEW',
        mode: 'EXTERNAL_SERVICE',
        status: 'COMPLETED',
        coreRootDir: 'data/jury-product',
      },
    });
    await prisma.juryReviewResult.create({
      data: {
        id: PARENT_RESULT,
        tenantId: TENANT,
        reviewRequestId: PARENT_REQUEST,
        boardRunId: 'run-phase8024-parent',
        evidenceStrength: 'unknown',
        claimStrength: 'weak',
        conflictDetected: false,
        overclaimDetected: false,
        revisionRequired: false,
        expectedDecision: 'ACCEPT',
        finalSurface: { statusSummary: 'parent', topProblems: [], expectedUserEffect: 'parent', risk: 'High', dimensionEvidence: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [] },
        contractVersion: JURY_CORE_CONTRACT_VERSION,
        completedAt: new Date('2026-10-09T08:00:00.000Z'),
      },
    });
    const store = await createPrismaRefreshStore();
    const saved = await store.complete({
      requestId: REQUEST,
      resultId: CHILD_RESULT,
      tenantId: TENANT,
      parentResultId: PARENT_RESULT,
      reading: childReading(),
    });
    assert.equal(saved, 'completed');
    const replay = await store.complete({
      requestId: REQUEST,
      resultId: 'phase8024-child-again',
      tenantId: TENANT,
      parentResultId: PARENT_RESULT,
      reading: childReading(),
    });
    assert.equal(replay, 'lost');
    const child = await prisma.juryReviewResult.findFirst({ where: { id: CHILD_RESULT, tenantId: TENANT } });
    const parent = await prisma.juryReviewResult.findFirst({ where: { id: PARENT_RESULT, tenantId: TENANT } });
    assert.equal(child?.parentReviewResultId, PARENT_RESULT);
    assert.equal(child?.expectedDecision, 'VERIFY');
    assert.equal(parent?.expectedDecision, 'ACCEPT');
    assert.equal(parent?.parentReviewResultId, null);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, id: 'phase8024-child-again' } }), 0);
  } finally {
    await prisma.juryReviewResult.deleteMany({ where: { tenantId: TENANT, id: { in: [CHILD_RESULT, PARENT_RESULT, 'phase8024-child-again'] } } });
    await prisma.juryReviewRequest.deleteMany({ where: { tenantId: TENANT, id: { in: [REQUEST, PARENT_REQUEST] } } });
    await prisma.juryEvidence.deleteMany({ where: { id: EVIDENCE, tenantId: TENANT } });
    await prisma.juryServiceConnection.deleteMany({ where: { id: CONNECTION, tenantId: TENANT } });
    await prisma.juryTenant.deleteMany({ where: { id: TENANT } });
  }
  const after = await liveRow(prisma);
  assert.deepEqual(after, before);
  assert.equal(after.status, 'COMPLETED');
  assert.equal(after.decision, 'ACCEPT');
  assert.equal(after.requests, 1);
});

function childReading(): FrozenCoreReading {
  return {
    boardRunId: 'run-phase8024-child',
    evidenceStrength: 'unknown',
    claimStrength: 'weak',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: 'VERIFY',
    finalSurface: {
      statusSummary: 'child',
      topProblems: [],
      expectedUserEffect: 'child',
      risk: 'High',
      dimensionEvidence: [],
      supportedClaims: [],
      partiallySupportedClaims: [],
      hypotheses: [],
    },
    completedAt: '2026-10-09T09:00:00.000Z',
  };
}

async function liveRow(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const rows = await prisma.$queryRaw<Array<{ status: string; decision: string; requests: number }>>`
    SELECT
      (SELECT status::text FROM "JuryReviewRequest" WHERE id = ${LIVE_REQUEST}) AS status,
      (SELECT "expectedDecision"::text FROM "JuryReviewResult" WHERE id = ${LIVE_RESULT}) AS decision,
      (SELECT count(*)::int FROM "JuryReviewRequest" WHERE "evidenceId" = ${LIVE_EVIDENCE}) AS requests
  `;
  return rows[0] ?? { status: '', decision: '', requests: -1 };
}
