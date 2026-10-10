import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { EvidencePack, ReviewBoardRun } from '@/lib/ai-review-board/types';
import { extractActualFromRun } from '../../../tests/ai-review-board/evaluation/runner/compare';
import type { ProductReviewCore } from './review-boundary';
import { persistTenantEvidenceIntake } from './tenant-evidence-intake-store';
import { projectTenantEvidenceToPack } from './tenant-evidence-projection';
import { runTenantReview, type TenantReviewCommand } from './tenant-review';
import type { JuryEvidence, JuryMembership, JuryNormalizedMetric } from './records';

const TENANT = 'phase46-review';
const FOREIGN = 'phase46-foreign';
const CONN = 'phase46-conn';
const FOREIGN_CONN = 'phase46-foreign-conn';
const SCOPE = 'phase46-scope';
const FOREIGN_SCOPE = 'phase46-foreign-scope';
const NOW = '2026-10-02T00:30:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase46-owner-m', TENANT, 'phase46-owner', 'OWNER');
const member = membership('phase46-member-m', TENANT, 'phase46-member', 'DEVELOPER');
const auditor = membership('phase46-auditor-m', TENANT, 'phase46-auditor', 'VIEWER');

test('tenant packs follow the existing comparator contract', () => {
  const zero = packOf([row('newUsersLast7d', 'AVAILABLE', 0)]);
  const zeroActual = extractActualFromRun(board(zero, 'steady'));
  assert.equal(zeroActual.evidenceStrength, 'strong');
  assert.equal(zeroActual.expectedDecision, 'ACCEPT');

  const missing = packOf([row('newUsersLast7d', 'NOT_MEASURED', null)]);
  const missingActual = extractActualFromRun(board(missing, 'steady'));
  assert.equal(missingActual.evidenceStrength, 'unknown');
  assert.equal(missingActual.expectedDecision, 'ACCEPT');

  const conflict = packOf([
    row('newUsersLast7d', 'AVAILABLE', 1),
    row('ga4.newUsers', 'AVAILABLE', 2),
  ]);
  const conflictActual = extractActualFromRun(board(conflict, 'steady'));
  assert.equal(conflictActual.conflictDetected, true);
  assert.equal(conflictActual.expectedDecision, 'VERIFY');

  const overclaim = extractActualFromRun(board(zero, 'critical outage'));
  assert.equal(overclaim.overclaimDetected, true);
  assert.equal(overclaim.expectedDecision, 'REWORD');
});

test('tenant review stores one external result and does not rerun the core', { timeout: 120_000 }, async () => {
  loadEnv();
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  const calls: EvidencePack[] = [];
  const core: ProductReviewCore = async ({ evidence }) => {
    calls.push(evidence);
    return reading();
  };
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const stored = await persistTenantEvidenceIntake(intake());
    assert.equal(stored.ok, true);
    if (!stored.ok) return;

    const foreign = await runTenantReview(command({ evidenceId: 'phase46-foreign-evidence' }), core);
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'NOT_FOUND');
    const mismatch = await runTenantReview(command({ evidenceId: stored.evidenceId, connectionId: FOREIGN_CONN }), core);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, 'EVIDENCE_CONNECTION_MISMATCH');
    const foreignScope = await runTenantReview(command({ evidenceId: stored.evidenceId, scopeId: FOREIGN_SCOPE }), core);
    assert.equal(foreignScope.ok, false);
    if (!foreignScope.ok) assert.equal(foreignScope.reason, 'NOT_FOUND');
    const client = await runTenantReview(command({ evidenceId: stored.evidenceId, clientTenantId: FOREIGN }), core);
    assert.equal(client.ok, false);
    if (!client.ok) assert.equal(client.reason, 'TENANT_MISMATCH');
    const asAuditor = await runTenantReview(command({
      evidenceId: stored.evidenceId,
      userId: auditor.userId,
      memberships: [auditor],
    }), core);
    assert.equal(asAuditor.ok, false);
    if (!asAuditor.ok) assert.equal(asAuditor.reason, 'FORBIDDEN');
    await prisma.juryAccessScope.update({ where: { id: SCOPE }, data: { status: 'REVOKED' } });
    const revoked = await runTenantReview(command({ evidenceId: stored.evidenceId }), core);
    assert.equal(revoked.ok, false);
    if (!revoked.ok) assert.equal(revoked.reason, 'SCOPE_NOT_APPROVED');
    assert.equal(calls.length, 0);
    await prisma.juryAccessScope.update({ where: { id: SCOPE }, data: { status: 'APPROVED' } });

    await prisma.juryEvidence.create({
      data: {
        id: 'phase46-no-audit',
        tenantId: TENANT,
        connectionId: CONN,
        purpose: 'tenant-declared-observation',
        periodStart: '2026-09-25',
        periodEnd: '2026-10-01',
        timezone: 'Asia/Seoul',
        metricIds: [],
        adapterKey: 'console-declared',
        collectedAt: new Date(NOW),
        piiExcluded: true,
        readOnly: true,
      },
    });
    const unaudited = await runTenantReview(command({ evidenceId: 'phase46-no-audit' }), core);
    assert.equal(unaudited.ok, false);
    if (!unaudited.ok) assert.equal(unaudited.reason, 'SCOPE_NOT_APPROVED');

    const memberRun = await runTenantReview(command({
      evidenceId: stored.evidenceId,
      userId: member.userId,
      memberships: [member],
    }), core);
    assert.equal(memberRun.ok, true);
    if (!memberRun.ok) return;
    assert.equal(memberRun.reused, false);
    assert.equal(memberRun.request.mode, 'EXTERNAL_SERVICE');
    assert.equal(memberRun.request.tenantId, TENANT);
    assert.equal(memberRun.request.evidenceId, stored.evidenceId);
    assert.equal(memberRun.result.tenantId, TENANT);
    assert.equal(memberRun.result.reviewRequestId, memberRun.request.id);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.aggregates.newUsersLast7d, 0);
    assert.deepEqual(calls[0]?.docsHints, []);
    assert.equal(calls[0]?.ga4, undefined);
    assert.equal(JSON.stringify(calls[0]).includes('buildEvidencePackFromDb'), false);

    const again = await runTenantReview(command({ evidenceId: stored.evidenceId }), core);
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.reused, true);
      assert.equal(again.result.id, memberRun.result.id);
    }
    assert.equal(calls.length, 1);
    assert.equal(await prisma.juryReviewRequest.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 0);
    const { loadJuryCatalog } = await import('./jury-db');
    const foreignCatalog = await loadJuryCatalog(FOREIGN);
    assert.equal(foreignCatalog.results.length, 0);
    assert.equal(foreignCatalog.requests.length, 0);
  } finally {
    try {
      await removeFixture(prisma);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'failed';
    }
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    if (cleanupError) throw new Error(`CLEANUP_FAILED ${cleanupError}`);
  }
});

test('tenant review source stays off the host collectors', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/tenant-review.ts'), 'utf8');
  assert.equal(source.includes('buildEvidencePackFromDb'), false);
  assert.equal(source.includes('attachGa4Evidence'), false);
  assert.equal(source.includes('runAisleAdapter'), false);
  assert.equal(source.includes('projectEvidenceToPack'), false);
  assert.equal(source.includes("mode: 'EXTERNAL_SERVICE'"), true);
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function EvidenceBody'), ui.indexOf('export function ImprovementsBody'));
  assert.equal(body.includes('Run Jury Review'), true);
  assert.equal(body.includes("canShowWrite(actor, 'review.start')"), true);
  assert.equal(body.includes('name="tenantId"'), false);
  const reviewForm = body.slice(body.indexOf('submitTenantReview'));
  assert.equal(reviewForm.includes('scopeId'), false);
  assert.equal(reviewForm.includes('connectionId'), false);
});

function board(evidence: EvidencePack, summary: string): ReviewBoardRun {
  return {
    evidence,
    final: {
      statusSummary: summary,
      topProblems: [],
      expectedUserEffect: '',
      risk: '',
      dimensionScores: [],
      supportedClaims: [],
      partiallySupportedClaims: [],
      hypotheses: [],
      confirmedFacts: [],
    },
  } as unknown as ReviewBoardRun;
}

function packOf(metrics: JuryNormalizedMetric[]): EvidencePack {
  const evidence: JuryEvidence & { piiExcluded: boolean; readOnly: boolean } = {
    id: 'evidence-1',
    tenantId: TENANT,
    connectionId: CONN,
    purpose: 'tenant-declared-observation',
    periodStart: '2026-09-25',
    periodEnd: '2026-10-01',
    timezone: 'Asia/Seoul',
    metricIds: metrics.map((metric) => metric.id),
    adapterKey: 'console-declared',
    collectedAt: NOW,
    piiExcluded: true,
    readOnly: true,
  };
  const projected = projectTenantEvidenceToPack({
    evidence,
    metrics: metrics.map((metric) => ({ ...metric, evidenceId: evidence.id })),
    generatedAt: NOW,
    siteName: 'Acme',
  });
  assert.equal(projected.ok, true);
  if (!projected.ok) throw new Error('pack');
  return projected.pack;
}

function row(name: string, availability: JuryNormalizedMetric['availability'], value: number | null): JuryNormalizedMetric {
  return {
    id: `metric-${name}`,
    tenantId: TENANT,
    connectionId: CONN,
    metric: name,
    value,
    unit: name === 'ga4.averageSessionDurationSec' ? 'DURATION_SEC' : 'COUNT',
    periodStart: '2026-09-25',
    periodEnd: '2026-10-01',
    timezone: 'Asia/Seoul',
    sourceSystem: 'OTHER',
    sourceRef: 'console-declared',
    collectedAt: NOW,
    availability,
    rawPayloadRef: 'tenant-declared:console-declared',
    adapterKey: 'console-declared',
    adapterVersion: 'v1',
    ruleId: 'normalize.tenant-declared.v1',
  };
}

function reading() {
  return {
    boardRunId: 'phase46-board',
    evidenceStrength: 'strong',
    claimStrength: 'weak',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: 'ACCEPT',
    finalSurface: {
      statusSummary: 'steady',
      topProblems: [],
      expectedUserEffect: '',
      risk: '',
      dimensionEvidence: [],
      supportedClaims: [],
      partiallySupportedClaims: [],
      hypotheses: [],
    },
    completedAt: NOW,
  };
}

function command(overrides: Partial<TenantReviewCommand>): TenantReviewCommand {
  return {
    userId: owner.userId,
    memberships: [owner],
    evidenceId: 'missing',
    reviewType: 'FULL_REVIEW',
    now: NOW,
    ...overrides,
  };
}

function intake() {
  return {
    userId: owner.userId,
    memberships: [owner],
    connectionId: CONN,
    scopeId: SCOPE,
    periodStart: '2026-09-25',
    periodEnd: '2026-10-01',
    timezone: 'Asia/Seoul',
    metrics: [{ metric: 'newUsersLast7d', availability: 'AVAILABLE', value: 0 }],
    sourceSystem: 'FILE' as const,
    sourceRef: 'console-declared',
    adapterKey: 'console-declared',
    adapterVersion: 'v1',
    now: NOW,
  };
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function loadEnv(): void {
  for (const [file, override] of [
    ['.env', false],
    ['.env.local', true],
  ] as const) {
    let text = '';
    try {
      text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || (process.env[key] && !override)) continue;
      process.env[key] = raw.replace(/^"|"$/g, '');
    }
  }
}

async function seed(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  for (const actor of [owner, member, auditor]) {
    await prisma.user.create({
      data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` },
    });
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  await prisma.juryTenant.create({ data: { id: FOREIGN, name: FOREIGN } });
  for (const actor of [owner, member, auditor]) {
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
  await prisma.juryServiceConnection.create({
    data: {
      id: CONN,
      tenantId: TENANT,
      serviceKey: 'acme',
      displayName: 'Acme',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
      createdByUserId: owner.userId,
    },
  });
  await prisma.juryServiceConnection.create({
    data: {
      id: FOREIGN_CONN,
      tenantId: FOREIGN,
      serviceKey: 'acme',
      displayName: 'Foreign',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
    },
  });
  const grants = [{ resource: 'metric:newUsersLast7d', mode: 'READ' }];
  await prisma.juryAccessScope.create({
    data: { id: SCOPE, tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants },
  });
  await prisma.juryAccessScope.create({
    data: { id: FOREIGN_SCOPE, tenantId: FOREIGN, connectionId: FOREIGN_CONN, status: 'APPROVED', grants },
  });
}

async function liveSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { expectedDecision: true, tenantId: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({
    where: { id: LIVE_CYCLE },
    select: { status: true, iteration: true, updatedAt: true },
  });
  const tenantId = review?.tenantId ?? 'missing';
  return {
    decision: review?.expectedDecision ?? null,
    reviewCompletedAt: review?.completedAt.toISOString() ?? null,
    status: cycle?.status ?? null,
    iteration: cycle?.iteration ?? null,
    cycleUpdatedAt: cycle?.updatedAt.toISOString() ?? null,
    activations: await prisma.juryAutoLoopActivation.count({ where: { tenantId } }),
    executions: await prisma.juryAgentExecution.count({ where: { tenantId } }),
    gates: await prisma.juryChangeGateResult.count({ where: { tenantId } }),
    reviews: await prisma.juryReviewResult.count({ where: { tenantId } }),
    reReviews: await prisma.juryReReviewResult.count({ where: { tenantId } }),
    tasks: await prisma.juryImprovementTask.count({ where: { tenantId } }),
  };
}

async function removeFixture(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: [TENANT, FOREIGN] } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase46-owner', 'phase46-member', 'phase46-auditor'] } },
  });
}
