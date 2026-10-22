/**
 * CONNECTED mock service → product evidence → existing Jury Core.
 * The adapter runs only after AccessContext. The core decision is stored unchanged.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { EvidenceDb } from '@/lib/ai-review-board/evidence-pack';
import { decideJuryMutation, type JuryActor } from './access';
import type { AccessFailure } from './access-layer';
import type { JuryConsoleView } from './console-view';
import { buildProductEvidence } from './evidence-builder';
import { persistProductEvidence, type PersistCommand, type PersistResult } from './evidence-store';
import { JURY_INTERACTIVE_TRANSACTION, notePersistenceFailure } from './persistence-diagnostic';
import { projectEvidenceToPack } from './projection';
import { isGithubInstallationConnection } from './services/github/onboarding-discovery';
import type { ProductReviewCore } from './review-boundary';
import {
  JURY_CLAIM_STRENGTHS,
  JURY_CORE_CONTRACT_VERSION,
  JURY_DECISIONS,
  JURY_EVIDENCE_STRENGTHS,
  JURY_PRODUCT_DATA_ROOT,
  type JuryAvailability,
  type JuryDecision,
  type JuryEvidence,
  type JuryNormalizedMetric,
  type JuryReviewStatus,
} from './records';

const GA4_ENV = [
  'GA4_PROPERTY_ID',
  'GA4_SERVICE_ACCOUNT_JSON',
  'GA4_SERVICE_ACCOUNT_JSON_BASE64',
  'GOOGLE_APPLICATION_CREDENTIALS',
] as const;

export type ConnectedCollectionFailure =
  | AccessFailure
  | 'FORBIDDEN'
  | 'TIMEZONE_UNSUPPORTED'
  | 'INVALID_VALUE'
  | 'COLLECTION_FAILED'
  | 'PACK_NOT_READ_ONLY'
  | 'PERSISTENCE_FAILED';

export type ConnectedReviewFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'
  | 'EVIDENCE_UNAVAILABLE'
  | 'TIMEZONE_UNSUPPORTED'
  | 'PACK_NOT_READ_ONLY'
  | 'PROJECTION_FAILED'
  | 'REVIEW_NOT_EXECUTED'
  | 'REVIEW_ALREADY_EXISTS'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'CORE_READING_REJECTED'
  | 'PERSISTENCE_FAILED';

export type CollectionCommand = {
  actor: JuryActor;
  connectionId: string;
  purpose: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  clientTenantId?: string | null;
};

export type ReviewCommand = {
  actor: JuryActor;
  connectionId: string;
  evidenceId: string;
  clientTenantId?: string | null;
  core?: ProductReviewCore;
};

type CollectionStatus = 'AVAILABLE' | 'NOT_MEASURED' | 'NOT_AVAILABLE' | 'COLLECTION_FAILED';

export function describeEvidenceCollection(
  metrics: readonly { availability: string; value: number | null }[],
): CollectionStatus {
  if (metrics.some((metric) => metric.availability === 'AVAILABLE' && typeof metric.value === 'number' && Number.isFinite(metric.value))) {
    return 'AVAILABLE';
  }
  if (metrics.some((metric) => metric.availability === 'COLLECTION_FAILED')) return 'COLLECTION_FAILED';
  if (metrics.some((metric) => metric.availability === 'NOT_MEASURED')) return 'NOT_MEASURED';
  return 'NOT_AVAILABLE';
}

export function projectConnectedServiceFlow(view: JuryConsoleView, connectionId: string) {
  const evidence = view.evidence
    .filter((row) => row.connectionId === connectionId && row.tenantId === view.tenantId)
    .slice()
    .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt));
  return evidence.map((row) => {
    const metrics = view.metrics.filter((metric) => metric.evidenceId === row.id && metric.tenantId === view.tenantId);
    const request = view.requests.find((item) => item.evidenceId === row.id && item.tenantId === view.tenantId) ?? null;
    const result = request ? (view.results.find((item) => item.reviewRequestId === request.id && item.tenantId === view.tenantId) ?? null) : null;
    return {
      id: row.id,
      purpose: row.purpose,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      timezone: row.timezone,
      adapterKey: row.adapterKey,
      contentHash: row.contentHash ?? null,
      readOnly: row.readOnly === true,
      piiExcluded: row.piiExcluded === true,
      collectionStatus: describeEvidenceCollection(metrics),
      metrics: metrics.map((metric) => ({
        id: metric.id,
        metric: metric.metric,
        value: metric.value,
        availability: metric.availability,
      })),
      reviewStatus: request?.status ?? null,
      decision: result?.expectedDecision ?? null,
      completedAt: result?.completedAt ?? null,
      summary: result?.finalSurface.statusSummary ?? null,
      topProblems: result?.finalSurface.topProblems ?? [],
      expectedUserEffect: result?.finalSurface.expectedUserEffect ?? null,
      risk: result?.finalSurface.risk ?? null,
      resultId: result?.id ?? null,
    };
  });
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function periodOk(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function mockObservationDb(): EvidenceDb {
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

function grantsOf(value: unknown): Array<{ resource: string; mode: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as { resource?: unknown; mode?: unknown };
    if (typeof record.resource !== 'string' || typeof record.mode !== 'string') return [];
    return [{ resource: record.resource, mode: record.mode }];
  });
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function loadPrisma() {
  const { prisma } = await import('@/lib/prisma');
  return prisma;
}

export async function runConnectedServiceEvidenceCollection(
  command: CollectionCommand,
  deps?: { evidenceDb?: EvidenceDb; persist?: (input: PersistCommand) => Promise<PersistResult> },
): Promise<
  | { ok: true; created: boolean; evidenceId: string; contentHash: string; connectionId: string }
  | { ok: false; reason: ConnectedCollectionFailure }
> {
  void command.clientTenantId;
  const actor = command.actor;
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return allowed;
  if (command.timezone !== 'Asia/Seoul') return { ok: false, reason: 'TIMEZONE_UNSUPPORTED' };
  if (!periodOk(command.periodStart) || !periodOk(command.periodEnd) || command.purpose.trim().length === 0) {
    return { ok: false, reason: 'INVALID_VALUE' };
  }

  const prisma = await loadPrisma();
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: command.connectionId, tenantId: actor.tenantId },
  });
  if (!connection || connection.tenantId !== actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
  if (isGithubInstallationConnection(connection)) return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
  const scopeRows = await prisma.juryAccessScope.findMany({
    where: { tenantId: actor.tenantId, connectionId: connection.id },
  });
  const scope = scopeRows.find((row) => row.status === 'APPROVED') ?? scopeRows[0] ?? null;
  const { runAisleServiceAccess } = await import('./service-access');
  const observed = await withoutGa4(() =>
    runAisleServiceAccess({
      actor,
      connection: {
        id: connection.id,
        tenantId: connection.tenantId,
        serviceKey: connection.serviceKey,
        accessMethod: connection.accessMethod,
        status: connection.status,
        credentialRef: connection.credentialRef ?? undefined,
      },
      scope: scope
        ? {
            id: scope.id,
            tenantId: scope.tenantId,
            connectionId: scope.connectionId,
            status: scope.status,
            grants: grantsOf(scope.grants),
          }
        : null,
      clientTenantId: null,
      evidenceDb: deps?.evidenceDb ?? mockObservationDb(),
    }),
  );
  if (!observed.ok) return { ok: false, reason: observed.reason === 'CONTEXT_NOT_ISSUED' ? 'COLLECTION_FAILED' : observed.reason };
  const built = buildProductEvidence({
    actorTenantId: actor.tenantId,
    connection: { id: connection.id, tenantId: connection.tenantId },
    clientTenantId: null,
    pack: {
      ...observed.pack,
      analysisPeriod: {
        start: command.periodStart,
        end: command.periodEnd,
        timezone: 'Asia/Seoul',
      },
    },
  });
  if (!built.ok) return { ok: false, reason: built.reason === 'TENANT_MISMATCH' ? 'NOT_FOUND' : built.reason };
  const persist = deps?.persist ?? persistProductEvidence;
  const persistCommand = {
    actorTenantId: actor.tenantId,
    connectionId: connection.id,
    clientTenantId: null,
    evidence: built.evidence,
    metrics: built.metrics,
  };
  let stored: PersistResult;
  try {
    stored = await persist(persistCommand);
  } catch (error) {
    notePersistenceFailure('evidence.persist', error);
    const existing = await prisma.juryEvidence.findFirst({
      where: {
        tenantId: actor.tenantId,
        connectionId: connection.id,
        purpose: built.evidence.purpose,
        periodStart: built.evidence.periodStart,
        periodEnd: built.evidence.periodEnd,
        timezone: built.evidence.timezone,
        contentHash: built.evidence.contentHash,
      },
    });
    if (!existing?.contentHash || existing.tenantId !== actor.tenantId) return { ok: false, reason: 'PERSISTENCE_FAILED' };
    return {
      ok: true,
      created: false,
      evidenceId: existing.id,
      contentHash: existing.contentHash,
      connectionId: connection.id,
    };
  }
  if (!stored.ok) {
    if (stored.reason === 'HASH_REQUIRED') return { ok: false, reason: 'PERSISTENCE_FAILED' };
    if (stored.reason === 'PACK_NOT_READ_ONLY') return { ok: false, reason: 'PACK_NOT_READ_ONLY' };
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (stored.created) {
    const provenance = {
      purpose: stored.evidence.purpose,
      periodStart: stored.evidence.periodStart,
      periodEnd: stored.evidence.periodEnd,
      timezone: stored.evidence.timezone,
      adapterKey: stored.evidence.adapterKey,
      contentHash: stored.evidence.contentHash,
      readOnly: true,
      piiExcluded: true,
    };
    const now = new Date();
    await prisma.juryAuditEvent.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: actor.tenantId,
          timestamp: now,
          actor: actor.userId,
          action: 'EVIDENCE_COLLECTION_STARTED',
          evidenceId: stored.evidence.id,
          provenance,
        },
        {
          id: randomUUID(),
          tenantId: actor.tenantId,
          timestamp: new Date(now.getTime() + 1),
          actor: actor.userId,
          action: 'EVIDENCE_RECORDED',
          evidenceId: stored.evidence.id,
          provenance,
        },
      ],
    });
  }
  return {
    ok: true,
    created: stored.created,
    evidenceId: stored.evidence.id,
    contentHash: stored.evidence.contentHash ?? '',
    connectionId: connection.id,
  };
}

function metricFromRow(row: {
  id: string;
  tenantId: string;
  connectionId: string;
  evidenceId: string | null;
  metric: string;
  value: number | null;
  unit: JuryNormalizedMetric['unit'];
  periodStart: string;
  periodEnd: string;
  timezone: string;
  sourceSystem: JuryNormalizedMetric['sourceSystem'];
  sourceRef: string;
  collectedAt: Date;
  availability: JuryAvailability;
  rawValueText: string | null;
  rawPayloadRef: string;
  adapterKey: string;
  adapterVersion: string;
  ruleId: string;
}): JuryNormalizedMetric {
  return {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    ...(row.evidenceId ? { evidenceId: row.evidenceId } : {}),
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    timezone: row.timezone,
    sourceSystem: row.sourceSystem,
    sourceRef: row.sourceRef,
    collectedAt: row.collectedAt.toISOString(),
    availability: row.availability,
    ...(row.rawValueText ? { rawValueText: row.rawValueText } : {}),
    rawPayloadRef: row.rawPayloadRef,
    adapterKey: row.adapterKey,
    adapterVersion: row.adapterVersion,
    ruleId: row.ruleId,
  };
}

function evidenceFromRow(row: {
  id: string;
  tenantId: string;
  connectionId: string;
  purpose: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  metricIds: unknown;
  adapterKey: string;
  collectedAt: Date;
  contentHash: string | null;
  piiExcluded: boolean;
  readOnly: boolean;
}): JuryEvidence {
  return {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    purpose: row.purpose,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    timezone: row.timezone,
    metricIds: stringList(row.metricIds),
    adapterKey: row.adapterKey,
    collectedAt: row.collectedAt.toISOString(),
    ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    piiExcluded: row.piiExcluded,
    readOnly: row.readOnly,
  };
}

function reviewStartedAudit(actorUserId: string, tenantId: string, evidence: JuryEvidence, requestId: string) {
  return {
    id: randomUUID(),
    tenantId,
    timestamp: new Date(),
    actor: actorUserId,
    action: 'REVIEW_STARTED' as const,
    evidenceId: evidence.id,
    reviewId: requestId,
    provenance: {
      purpose: evidence.purpose,
      reviewType: 'FULL_REVIEW' as const,
      adapterKey: evidence.adapterKey,
      contentHash: evidence.contentHash ?? null,
      readOnly: true,
      piiExcluded: true,
    },
  };
}

async function markReviewFailed(requestId: string, tenantId: string): Promise<void> {
  const prisma = await loadPrisma();
  await prisma.juryReviewRequest.updateMany({
    where: { id: requestId, tenantId, status: 'RUNNING' },
    data: { status: 'FAILED' },
  });
}

export async function runConnectedServiceReview(
  command: ReviewCommand,
): Promise<
  | { ok: true; reused: boolean; requestId: string; resultId: string; decision: JuryDecision; status: 'COMPLETED' }
  | { ok: false; reason: ConnectedReviewFailure }
> {
  void command.clientTenantId;
  const actor = command.actor;
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return allowed;
  const prisma = await loadPrisma();
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: command.connectionId, tenantId: actor.tenantId },
  });
  if (!connection || connection.tenantId !== actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
  const evidenceRow = await prisma.juryEvidence.findFirst({
    where: { id: command.evidenceId, tenantId: actor.tenantId, connectionId: connection.id },
  });
  if (!evidenceRow || evidenceRow.tenantId !== actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
  const evidence = evidenceFromRow(evidenceRow);
  if (evidence.readOnly !== true || evidence.piiExcluded !== true) return { ok: false, reason: 'PACK_NOT_READ_ONLY' };
  if (evidence.timezone !== 'Asia/Seoul') return { ok: false, reason: 'TIMEZONE_UNSUPPORTED' };
  const metricRows = await prisma.juryNormalizedMetric.findMany({
    where: { tenantId: actor.tenantId, evidenceId: evidence.id },
  });
  const metrics = metricRows.map((row) => metricFromRow(row));
  if (describeEvidenceCollection(metrics) !== 'AVAILABLE') return { ok: false, reason: 'EVIDENCE_UNAVAILABLE' };
  if (!command.core) return { ok: false, reason: 'REVIEW_NOT_EXECUTED' };

  let projection: ReturnType<typeof projectEvidenceToPack>;
  try {
    projection = projectEvidenceToPack({
      evidence,
      metrics,
      generatedAt: new Date().toISOString(),
      siteName: connection.displayName || connection.serviceKey,
    });
  } catch {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (projection.periodWithheld || projection.issues.length > 0) return { ok: false, reason: 'PROJECTION_FAILED' };

  const requestId = sha([actor.tenantId, evidence.id, 'FULL_REVIEW', '']);
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "JuryServiceConnection" WHERE id = ${connection.id} AND "tenantId" = ${actor.tenantId} FOR UPDATE`);
    const existing = await tx.juryReviewRequest.findFirst({
      where: { id: requestId, tenantId: actor.tenantId },
      include: { result: true },
    });
    if (existing?.result && existing.result.tenantId === actor.tenantId) {
      return { kind: 'reused' as const, resultId: existing.result.id, decision: existing.result.expectedDecision };
    }
    if (existing?.status === 'FAILED') {
      const reclaimed = await tx.juryReviewRequest.updateMany({
        where: { id: requestId, tenantId: actor.tenantId, status: 'FAILED' },
        data: { status: 'RUNNING' },
      });
      if (reclaimed.count !== 1) return { kind: 'busy' as const };
      await tx.juryAuditEvent.create({ data: reviewStartedAudit(actor.userId, actor.tenantId, evidence, requestId) });
      return { kind: 'claimed' as const };
    }
    if (existing) return { kind: 'busy' as const };
    await tx.juryReviewRequest.create({
      data: {
        id: requestId,
        tenantId: actor.tenantId,
        connectionId: connection.id,
        evidenceId: evidence.id,
        reviewType: 'FULL_REVIEW',
        mode: 'AISLE_SELF',
        status: 'RUNNING',
        coreRootDir: JURY_PRODUCT_DATA_ROOT,
        requestedByUserId: actor.userId,
      },
    });
    await tx.juryAuditEvent.create({
      data: reviewStartedAudit(actor.userId, actor.tenantId, evidence, requestId),
    });
    return { kind: 'claimed' as const };
  }, JURY_INTERACTIVE_TRANSACTION);
  if (claimed.kind === 'busy') return { ok: false, reason: 'REVIEW_ALREADY_EXISTS' };
  if (claimed.kind === 'reused') {
    if (!(JURY_DECISIONS as readonly string[]).includes(claimed.decision)) {
      return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
    }
    return {
      ok: true,
      reused: true,
      requestId,
      resultId: claimed.resultId,
      decision: claimed.decision as JuryDecision,
      status: 'COMPLETED',
    };
  }

  let reading: Awaited<ReturnType<ProductReviewCore>>;
  try {
    reading = await command.core({
      rootDir: JURY_PRODUCT_DATA_ROOT,
      evidence: projection.pack,
    });
  } catch {
    await markReviewFailed(requestId, actor.tenantId);
    return { ok: false, reason: 'REVIEW_NOT_EXECUTED' };
  }
  if (!(JURY_DECISIONS as readonly string[]).includes(reading.expectedDecision)) {
    await markReviewFailed(requestId, actor.tenantId);
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  }
  if (
    !(JURY_EVIDENCE_STRENGTHS as readonly string[]).includes(reading.evidenceStrength) ||
    !(JURY_CLAIM_STRENGTHS as readonly string[]).includes(reading.claimStrength) ||
    typeof reading.boardRunId !== 'string' ||
    reading.boardRunId.length === 0
  ) {
    await markReviewFailed(requestId, actor.tenantId);
    return { ok: false, reason: 'CORE_READING_REJECTED' };
  }
  const decision = reading.expectedDecision as JuryDecision;
  const resultId = sha([requestId, reading.boardRunId]);
  const surface = reading.finalSurface;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.juryReviewResult.create({
        data: {
          id: resultId,
          tenantId: actor.tenantId,
          reviewRequestId: requestId,
          boardRunId: reading.boardRunId,
          evidenceStrength: reading.evidenceStrength as 'strong' | 'moderate' | 'unknown',
          claimStrength: reading.claimStrength as 'weak' | 'strong' | 'extreme',
          conflictDetected: reading.conflictDetected,
          overclaimDetected: reading.overclaimDetected,
          revisionRequired: reading.revisionRequired,
          expectedDecision: decision,
          finalSurface: surface as Prisma.InputJsonValue,
          contractVersion: JURY_CORE_CONTRACT_VERSION,
          completedAt: new Date(reading.completedAt),
        },
      });
      await tx.juryReviewRequest.update({
        where: { id: requestId },
        data: { status: 'COMPLETED' satisfies JuryReviewStatus },
      });
      await tx.juryAuditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: actor.tenantId,
          timestamp: new Date(),
          actor: actor.userId,
          action: 'REVIEW_COMPLETED',
          evidenceId: evidence.id,
          reviewId: resultId,
          decision,
          provenance: {
            purpose: evidence.purpose,
            reviewType: 'FULL_REVIEW',
            contentHash: evidence.contentHash ?? null,
            readOnly: true,
            piiExcluded: true,
          },
        },
      });
    }, JURY_INTERACTIVE_TRANSACTION);
  } catch (error) {
    notePersistenceFailure('review.persist', error);
    const raced = await prisma.juryReviewResult.findFirst({
      where: { reviewRequestId: requestId, tenantId: actor.tenantId },
    });
    if (raced && (JURY_DECISIONS as readonly string[]).includes(raced.expectedDecision)) {
      return {
        ok: true,
        reused: true,
        requestId,
        resultId: raced.id,
        decision: raced.expectedDecision,
        status: 'COMPLETED',
      };
    }
    await markReviewFailed(requestId, actor.tenantId);
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
  return { ok: true, reused: false, requestId, resultId, decision, status: 'COMPLETED' };
}
