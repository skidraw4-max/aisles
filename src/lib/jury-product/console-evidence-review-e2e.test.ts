import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveAnalysisPeriod } from '@/lib/ai-review-board/analysis-period';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import type { JuryActor } from './access';
import {
  CONSOLE_INTAKE_ADAPTER,
  CONSOLE_INTAKE_REF,
  CONSOLE_INTAKE_SOURCE,
  CONSOLE_INTAKE_VERSION,
} from './console-evidence-intake';
import { persistCatalogScope, persistCatalogScopeDecision } from './console-catalog-scope';
import { buildMockDiscovery } from './discovery';
import type { ProductReviewCore } from './review-boundary';
import { projectTenantEvidenceToPack } from './tenant-evidence-projection';
import { persistTenantEvidenceIntake } from './tenant-evidence-intake-store';
import { runTenantReview } from './tenant-review';
import type { JuryEvidence, JuryMembership, JuryNormalizedMetric } from './records';

const TENANT = 'phase46c-e2e';
const FOREIGN = 'phase46c-e2e-foreign';
const CONN = 'phase46c-e2e-conn';
const NOW = '2026-10-02T02:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase46c-e2e-owner-m', TENANT, 'phase46c-e2e-owner', 'OWNER');
const member = membership('phase46c-e2e-member-m', TENANT, 'phase46c-e2e-member', 'DEVELOPER');
const auditor = membership('phase46c-e2e-auditor-m', TENANT, 'phase46c-e2e-auditor', 'VIEWER');
const foreign = membership('phase46c-e2e-foreign-m', FOREIGN, 'phase46c-e2e-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };

test('console catalog evidence reaches one external review', { timeout: 120_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  const calls: EvidencePack[] = [];
  const core: ProductReviewCore = async ({ evidence }) => {
    calls.push(evidence);
    return reading();
  };
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const { persistServiceTarget } = await import('./jury-db');
    const registered = await persistServiceTarget({
      actor: ownerActor,
      serviceKey: 'phase46c',
      displayName: 'Phase 46C',
      accessMethod: 'FILE_UPLOAD',
      clientTenantId: FOREIGN,
      allocateId: () => CONN,
      now: NOW,
    });
    assert.equal(registered.ok, true);
    if (!registered.ok) return;
    assert.equal(registered.connection.tenantId, TENANT);

    for (const metric of ['newUsersLast7d', 'activeUsersLast7d', 'commentsLast7d', 'postsLast7d']) {
      const proposed = await persistCatalogScope({
        userId: owner.userId,
        memberships: [owner],
        clientTenantId: null,
        connectionId: CONN,
        metric,
        now: NOW,
      });
      assert.equal(proposed.ok, true, metric);
    }
    const scope = await prisma.juryAccessScope.findFirst({
      where: { tenantId: TENANT, connectionId: CONN, status: 'PROPOSED' },
    });
    assert.ok(scope);
    const approved = await persistCatalogScopeDecision({
      userId: owner.userId,
      memberships: [owner],
      clientTenantId: null,
      scopeId: scope.id,
      decision: 'APPROVE',
      now: NOW,
    });
    assert.equal(approved.ok, true);
    const grants = JSON.stringify(scope.grants);
    assert.equal(grants.includes('metric:newUsersLast7d'), true);
    assert.equal(grants.includes('acme.routes'), false);

    const period = resolveAnalysisPeriod(new Date(NOW));
    const measured = await persistTenantEvidenceIntake({
      userId: owner.userId,
      memberships: [owner],
      clientTenantId: null,
      connectionId: CONN,
      scopeId: scope.id,
      periodStart: period.start,
      periodEnd: period.end,
      timezone: 'Asia/Seoul',
      metrics: [
        { metric: 'newUsersLast7d', availability: 'AVAILABLE', value: 0 },
        { metric: 'activeUsersLast7d', availability: 'AVAILABLE', value: 10 },
        { metric: 'commentsLast7d', availability: 'AVAILABLE', value: 2 },
      ],
      sourceSystem: CONSOLE_INTAKE_SOURCE,
      sourceRef: CONSOLE_INTAKE_REF,
      adapterKey: CONSOLE_INTAKE_ADAPTER,
      adapterVersion: CONSOLE_INTAKE_VERSION,
      now: NOW,
    });
    assert.equal(measured.ok, true);
    if (!measured.ok) return;
    const stored = await prisma.juryNormalizedMetric.findMany({ where: { evidenceId: measured.evidenceId } });
    assert.equal(stored.find((row) => row.metric === 'newUsersLast7d')?.value, 0);
    assert.equal(stored.every((row) => row.sourceSystem === 'OTHER'), true);

    const unmeasured = await persistTenantEvidenceIntake({
      userId: owner.userId,
      memberships: [owner],
      clientTenantId: null,
      connectionId: CONN,
      scopeId: scope.id,
      periodStart: period.start,
      periodEnd: period.end,
      timezone: 'Asia/Seoul',
      metrics: [{ metric: 'postsLast7d', availability: 'NOT_MEASURED', value: null }],
      sourceSystem: CONSOLE_INTAKE_SOURCE,
      sourceRef: CONSOLE_INTAKE_REF,
      adapterKey: CONSOLE_INTAKE_ADAPTER,
      adapterVersion: CONSOLE_INTAKE_VERSION,
      now: NOW,
    });
    assert.equal(unmeasured.ok, true);
    if (!unmeasured.ok) return;
    const nullMetric = await prisma.juryNormalizedMetric.findFirst({
      where: { evidenceId: unmeasured.evidenceId, metric: 'postsLast7d' },
    });
    assert.equal(nullMetric?.value, null);
    assert.notEqual(nullMetric?.value, 0);
    const pack = projectTenantEvidenceToPack(await projectionInput(prisma, unmeasured.evidenceId));
    assert.equal(pack.ok, true);
    if (!pack.ok) return;
    assert.equal(pack.pack.aggregates.postsLast7d, null);
    assert.equal(pack.pack.aggregates.newUsersLast7d, null);
    assert.equal(JSON.stringify(pack.pack.docsHints).includes('0'), false);

    const foreignRun = await runTenantReview({
      userId: foreign.userId,
      memberships: [foreign],
      clientTenantId: null,
      evidenceId: measured.evidenceId,
      reviewType: 'FULL_REVIEW',
      now: NOW,
    }, core);
    assert.equal(foreignRun.ok, false);
    if (!foreignRun.ok) assert.equal(foreignRun.reason, 'NOT_FOUND');
    assert.equal(calls.length, 0);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: FOREIGN } }), 0);

    const auditorRun = await runTenantReview({
      userId: auditor.userId,
      memberships: [auditor],
      evidenceId: measured.evidenceId,
      reviewType: 'FULL_REVIEW',
      now: NOW,
    }, core);
    assert.equal(auditorRun.ok, false);
    if (!auditorRun.ok) assert.equal(auditorRun.reason, 'FORBIDDEN');

    const reviewed = await runTenantReview({
      userId: member.userId,
      memberships: [member],
      clientTenantId: null,
      evidenceId: measured.evidenceId,
      reviewType: 'FULL_REVIEW',
      now: NOW,
    }, core);
    assert.equal(reviewed.ok, true);
    if (!reviewed.ok) return;
    assert.equal(reviewed.request.mode, 'EXTERNAL_SERVICE');
    assert.equal(reviewed.request.tenantId, TENANT);
    assert.equal(reviewed.request.evidenceId, measured.evidenceId);
    assert.equal(reviewed.result.tenantId, TENANT);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.aggregates.newUsersLast7d, 0);
    assert.equal(calls[0]?.aggregates.activeUsersLast7d, 10);
    assert.equal(calls[0]?.aggregates.commentsLast7d, 2);
    assert.equal(calls[0]?.ga4, undefined);
    assert.equal(JSON.stringify(calls[0]).includes('buildEvidencePackFromDb'), false);

    const again = await runTenantReview({
      userId: owner.userId,
      memberships: [owner],
      evidenceId: measured.evidenceId,
      reviewType: 'FULL_REVIEW',
      now: NOW,
    }, core);
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.reused, true);
    assert.equal(calls.length, 1);
    assert.equal(await prisma.juryReviewRequest.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT } }), 1);

    await prisma.juryAccessScope.update({ where: { id: scope.id }, data: { status: 'REVOKED' } });
    const revoked = await runTenantReview({
      userId: member.userId,
      memberships: [member],
      evidenceId: measured.evidenceId,
      reviewType: 'FULL_REVIEW',
      now: NOW,
    }, core);
    assert.equal(revoked.ok, false);
    if (!revoked.ok) assert.equal(revoked.reason, 'SCOPE_NOT_APPROVED');
    assert.equal(calls.length, 1);

    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 0);

    const placeholder = buildMockDiscovery({
      actorTenantId: TENANT,
      connection: registered.connection,
      allocateId: sequence('e2e-discovery', 'e2e-placeholder'),
    });
    assert.equal(placeholder.ok, true);
    if (placeholder.ok) {
      assert.deepEqual(placeholder.discovery.proposedMetrics.map((item) => item.metric), ['phase46c.routes', 'phase46c.api']);
      assert.equal(placeholder.scope.grants.some((grant) => grant.resource.includes('userCount')), false);
    }
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

test('console review path does not call host collectors', () => {
  const files = [
    'src/lib/jury-product/console-catalog-scope.ts',
    'src/app/(root)/jury/actions.ts',
    'src/app/(root)/jury/ui.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    for (const token of ['buildEvidencePackFromDb', 'attachGa4Evidence', 'runAisleAdapter', 'GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT']) {
      assert.equal(source.includes(token), false, `${file} ${token}`);
    }
  }
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const review = actions.slice(actions.indexOf('export async function submitTenantReview'));
  assert.equal(review.includes('runTenantReview'), true);
  assert.equal(review.includes("formData.get('tenantId')"), false);
  assert.equal(review.includes("formData.get('connectionId')"), false);
  assert.equal(review.includes("formData.get('scopeId')"), false);
});

function reading() {
  return {
    boardRunId: 'phase46c-board',
    evidenceStrength: 'strong' as const,
    claimStrength: 'weak' as const,
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: 'ACCEPT' as const,
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

async function projectionInput(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  evidenceId: string,
): Promise<Parameters<typeof projectTenantEvidenceToPack>[0]> {
  const row = await prisma.juryEvidence.findUnique({ where: { id: evidenceId } });
  const metrics = await prisma.juryNormalizedMetric.findMany({ where: { evidenceId } });
  if (!row) throw new Error('missing evidence');
  const evidence: JuryEvidence & { piiExcluded: boolean; readOnly: boolean } = {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    purpose: row.purpose,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    timezone: row.timezone,
    metricIds: Array.isArray(row.metricIds) ? row.metricIds.filter((item): item is string => typeof item === 'string') : [],
    adapterKey: row.adapterKey,
    collectedAt: row.collectedAt.toISOString(),
    piiExcluded: row.piiExcluded,
    readOnly: row.readOnly,
  };
  const mapped: JuryNormalizedMetric[] = metrics.map((metric) => ({
    id: metric.id,
    tenantId: metric.tenantId,
    connectionId: metric.connectionId,
    evidenceId: metric.evidenceId ?? evidenceId,
    metric: metric.metric,
    value: metric.value,
    unit: metric.unit,
    periodStart: metric.periodStart,
    periodEnd: metric.periodEnd,
    timezone: metric.timezone,
    sourceSystem: metric.sourceSystem,
    sourceRef: metric.sourceRef,
    collectedAt: metric.collectedAt.toISOString(),
    availability: metric.availability,
    rawPayloadRef: metric.rawPayloadRef,
    adapterKey: metric.adapterKey,
    adapterVersion: metric.adapterVersion,
    ruleId: metric.ruleId,
  }));
  return { evidence, metrics: mapped, generatedAt: NOW, siteName: 'Phase 46C' };
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function sequence(...ids: string[]): () => string {
  const pending = [...ids];
  return () => pending.shift() ?? 'extra';
}

function loadEnv(): void {
  for (const [file, override] of [['.env', false], ['.env.local', true]] as const) {
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
  for (const actor of [owner, member, auditor, foreign]) {
    await prisma.user.create({ data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` } });
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  await prisma.juryTenant.create({ data: { id: FOREIGN, name: FOREIGN } });
  for (const actor of [owner, member, auditor, foreign]) {
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
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
    cycles: await prisma.juryDecisionCycle.count({ where: { tenantId } }),
  };
}

async function removeFixture(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryDiscoveryResult.deleteMany({ where });
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: [TENANT, FOREIGN] } } });
  await prisma.user.deleteMany({
    where: {
      username: {
        in: ['phase46c-e2e-owner', 'phase46c-e2e-member', 'phase46c-e2e-auditor', 'phase46c-e2e-foreign'],
      },
    },
  });
}
