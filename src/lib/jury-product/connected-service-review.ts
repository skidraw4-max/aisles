/**
 * CONNECTED mock service → product evidence → existing Jury Core.
 * The adapter runs only after AccessContext. The core decision is stored unchanged.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { EvidenceDb } from '@/lib/ai-review-board/evidence-pack';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { loadLatestObservationRun, type LatestObservationRun } from './services/readonly-account/latest-observation';
import { loadLatestScreenAuditIdentity, boundScreenAuditId, type ScreenAuditIdentity } from './services/screen-audit/audit-jury-review';
import { attachObservationToPack } from './services/readonly-account/observation-evidence';
import { decideJuryMutation, type JuryActor } from './access';
import type { AccessFailure } from './access-layer';
import type { JuryConsoleView } from './console-view';
import { buildProductEvidence } from './evidence-builder';
import { persistProductEvidence, type PersistCommand, type PersistResult } from './evidence-store';
import { JURY_INTERACTIVE_TRANSACTION, notePersistenceFailure } from './persistence-diagnostic';
import { projectEvidenceToPack } from './projection';
import { isGithubInstallationConnection } from './services/github/onboarding-discovery';
import type { ProductReviewCore, ProductReviewTrace } from './review-boundary';
import { createLlmCallRecorder } from './llm-call-log';
import { finishReviewAttempt, startReviewAttempt } from './review-tracking';
import { isStaleRunningReview } from './review-stale';
import { recordReviewAudit } from './review-audit';
import { compareWithPrevious } from './review-compare';
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
  | 'OBSERVATION_REQUIRED'
  | 'NO_AUDIT'
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
  /** One-click 위원 심사: bind the latest DONE 화면 심사 for any connection type; none → NO_AUDIT (no fallback). */
  requireScreenAudit?: boolean;
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
  /** One-click 위원 심사 only: a stored result without improvementProposals is not reused (runs fresh). */
  skipLegacyResult?: boolean;
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

export function projectConnectedServiceFlow(view: JuryConsoleView, connectionId: string, now: number = Date.now()) {
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
      /** I-048: RUNNING with no update for >330s; the review can be run again. */
      reviewStale: request ? isStaleRunningReview(request.status, request.updatedAt ?? null, now) : false,
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

/**
 * I-047: READ_ONLY_ACCOUNT packs record only what the screen observation saw.
 * DB aggregates from the placeholder DB are not measurements, so they become null (NOT_MEASURED).
 */
export function readonlyObservationPack(pack: EvidencePack, run: LatestObservationRun, clearPlaceholderAggregates: boolean): EvidencePack {
  const aggregates = clearPlaceholderAggregates
    ? (Object.fromEntries(
        Object.entries(pack.aggregates).map(([k, v]) => [k, typeof v === 'number' || v === null ? null : {}]),
      ) as unknown as EvidencePack['aggregates'])
    : pack.aggregates;
  return {
    ...attachObservationToPack({ ...pack, aggregates }, run),
    readonlyObservation: {
      runId: run.id,
      observedAt: run.observedAt,
      pagesObserved: run.pagesObserved,
      pagesVisible: run.pagesVisible,
      blockedRequestCount: run.blockedRequestCount,
      finalPath: run.finalPath,
    },
  };
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
  deps?: {
    evidenceDb?: EvidenceDb;
    persist?: (input: PersistCommand) => Promise<PersistResult>;
    latestObservation?: (tenantId: string, connectionId: string) => Promise<LatestObservationRun | null>;
    screenAuditIdentity?: (tenantId: string, connectionId: string) => Promise<ScreenAuditIdentity | null>;
  },
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
  // I-047: READ_ONLY_ACCOUNT evidence comes only from a persisted, successful screen observation.
  let readonlyRun: LatestObservationRun | null = null;
  if (connection.accessMethod === 'READ_ONLY_ACCOUNT') {
    readonlyRun = deps?.latestObservation
      ? await deps.latestObservation(actor.tenantId, connection.id)
      : await loadLatestObservationRun(prisma, actor.tenantId, connection.id, { okOnly: true });
    if (!readonlyRun || !readonlyRun.ok) return { ok: false, reason: 'OBSERVATION_REQUIRED' };
  }
  const scopeRows = await prisma.juryAccessScope.findMany({
    where: { tenantId: actor.tenantId, connectionId: connection.id },
  });
  const scope = scopeRows.find((row) => row.status === 'APPROVED') ?? scopeRows[0] ?? null;
  const { runAisleServiceAccess } = await import('./service-access');
  // I-076: GA4_VIEWER connections get their own property through the Jury service account (env GA4 stays stripped).
  const { ga4OptionsForConnection } = await import('./services/ga4-viewer/service');
  const connectionGa4 = ga4OptionsForConnection(connection) ?? undefined;
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
      ga4: connectionGa4,
    }),
  );
  if (!observed.ok) return { ok: false, reason: observed.reason === 'CONTEXT_NOT_ISSUED' ? 'COLLECTION_FAILED' : observed.reason };
  // I-099: a new finished 화면 심사 makes new evidence (and so a new review) instead of reusing the old result.
  let screenAudit: ScreenAuditIdentity | null = null;
  if (command.requireScreenAudit === true || connection.accessMethod === 'READ_ONLY_ACCOUNT') {
    screenAudit = deps?.screenAuditIdentity
      ? await deps.screenAuditIdentity(actor.tenantId, connection.id)
      : await loadLatestScreenAuditIdentity(prisma, actor.tenantId, connection.id);
  }
  if (command.requireScreenAudit === true && !screenAudit) return { ok: false, reason: 'NO_AUDIT' };
  const basePack = readonlyRun ? readonlyObservationPack(observed.pack, readonlyRun, !deps?.evidenceDb) : observed.pack;
  const built = buildProductEvidence({
    actorTenantId: actor.tenantId,
    connection: { id: connection.id, tenantId: connection.tenantId },
    clientTenantId: null,
    screenAudit,
    ...(command.requireScreenAudit === true ? { purpose: command.purpose } : {}),
    pack: {
      ...basePack,
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

async function markReviewFailed(
  requestId: string,
  tenantId: string,
  audit?: { actorUserId: string; evidenceId: string; failureReason: string },
): Promise<void> {
  const prisma = await loadPrisma();
  await prisma.juryReviewRequest.updateMany({
    where: { id: requestId, tenantId, status: 'RUNNING' },
    data: { status: 'FAILED', ...(audit ? { failureReason: audit.failureReason } : {}) },
  });
  // RM-08: terminal audit event for failed reviews (best-effort; STARTED is written in the claim tx).
  if (audit) {
    await recordReviewAudit(prisma, {
      tenantId,
      actorUserId: audit.actorUserId,
      action: 'REVIEW_FAILED',
      evidenceId: audit.evidenceId,
      reviewId: requestId,
      path: 'CONNECTED_SERVICE',
      reviewType: 'FULL_REVIEW',
      failureReason: audit.failureReason,
    });
  }
}

type ReviewOutcome =
  | { ok: true; reused: boolean; requestId: string; resultId: string; decision: JuryDecision; status: 'COMPLETED' }
  | { ok: false; reason: ConnectedReviewFailure };

export async function runConnectedServiceReview(command: ReviewCommand): Promise<ReviewOutcome> {
  const outcome = await connectedServiceReview(command, null);
  if (outcome.ok && 'started' in outcome) return { ok: false, reason: 'REVIEW_NOT_EXECUTED' };
  return outcome;
}

/**
 * I-099: same validation and claim as runConnectedServiceReview, but the model run is handed to `background`
 * (Next `after()`) once the RUNNING row is claimed, so the click returns at once and the page polls.
 * A reused result returns immediately. A killed background run is picked up by the I-048 stale (330s) rule.
 */
export async function startConnectedServiceReview(
  command: ReviewCommand,
  background: (work: () => Promise<void>) => void,
): Promise<ReviewOutcome | { ok: true; started: true; requestId: string; status: 'RUNNING' }> {
  return connectedServiceReview(command, background);
}

async function connectedServiceReview(
  command: ReviewCommand,
  background: ((work: () => Promise<void>) => void) | null,
): Promise<ReviewOutcome | { ok: true; started: true; requestId: string; status: 'RUNNING' }> {
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
  const core = command.core;

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

  // A stored result without the improvementProposals key (pre-proposals / LEGACY) is never reused: the review runs fresh
  // under a second deterministic id (JuryReviewResult.reviewRequestId is unique, so the old row stays untouched).
  const requestIds = command.skipLegacyResult === true
    ? [sha([actor.tenantId, evidence.id, 'FULL_REVIEW', '']), sha([actor.tenantId, evidence.id, 'FULL_REVIEW', 'proposals'])]
    : [sha([actor.tenantId, evidence.id, 'FULL_REVIEW', ''])];
  let requestId = requestIds[0];
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "JuryServiceConnection" WHERE id = ${connection.id} AND "tenantId" = ${actor.tenantId} FOR UPDATE`);
    let existing: Awaited<ReturnType<typeof tx.juryReviewRequest.findFirst<{ where: { id: string }; include: { result: true } }>>> = null;
    for (const [index, id] of requestIds.entries()) {
      requestId = id;
      existing = await tx.juryReviewRequest.findFirst({
        where: { id, tenantId: actor.tenantId },
        include: { result: true },
      });
      const result = existing?.result && existing.result.tenantId === actor.tenantId ? existing.result : null;
      if (result && (hasProposalsKey(result.finalSurface) || index === requestIds.length - 1)) {
        return { kind: 'reused' as const, resultId: result.id, decision: result.expectedDecision };
      }
      if (!result) break;
    }
    // I-048: a RUNNING row left behind by a killed function (no update for >330s) is retryable like FAILED.
    const stale = existing ? isStaleRunningReview(existing.status, existing.updatedAt, Date.now()) : false;
    if (existing && (existing.status === 'FAILED' || stale)) {
      const reclaimed = await tx.juryReviewRequest.updateMany({
        where: { id: requestId, tenantId: actor.tenantId, status: existing.status, updatedAt: existing.updatedAt },
        data: { status: 'RUNNING', failureReason: null, updatedAt: new Date() },
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

  const execute = async (): Promise<ReviewOutcome> => {
  // I-048 (RM-01 parity): attempt lifecycle + per-LLM-call metadata on this path too (best-effort).
  const trace: ProductReviewTrace = { resultSource: 'UNKNOWN_LEGACY', recorder: createLlmCallRecorder() };
  const attemptId = await startReviewAttempt(prisma, {
    tenantId: actor.tenantId,
    reviewRequestKey: requestId,
    evidenceId: evidence.id,
    reviewType: 'FULL_REVIEW',
    startedAt: new Date(),
  });
  const finishAttempt = (status: 'COMPLETED' | 'FAILED', failureReason: string | null, boardRunId?: string) =>
    finishReviewAttempt(prisma, attemptId, {
      tenantId: actor.tenantId,
      reviewRequestKey: requestId,
      status,
      failureReason,
      resultSource: trace.resultSource,
      boardRunId: boardRunId ?? null,
      calls: trace.recorder.calls,
      finishedAt: new Date(),
    });
  const fail = async (reason: ConnectedReviewFailure, boardRunId?: string) => {
    await markReviewFailed(requestId, actor.tenantId, { actorUserId: actor.userId, evidenceId: evidence.id, failureReason: reason });
    await finishAttempt('FAILED', reason, boardRunId);
    return { ok: false as const, reason };
  };

  // I-093: stored rule-based screen-audit findings join the judge input (no extra model call).
  const { loadScreenAuditEvidence } = await import('./services/screen-audit/review-evidence');
  // I-099: evidence built from a specific audit uses that audit; older evidence keeps the latest-DONE rule.
  const screenAuditFindings = await loadScreenAuditEvidence(prisma, actor.tenantId, connection.id, boundScreenAuditId(evidenceRow.apiEvidence));
  // P2: owner-entered site context (no reference URL) for Jury judging; user input, not evidence.
  const { readSiteContext, siteTypeLabel } = await import('./site-context');
  const storedContext = readSiteContext(connection.providerConfig);
  const siteContext = storedContext
    ? { siteType: siteTypeLabel(storedContext.siteType), primaryUsers: storedContext.primaryUsers, coreTasks: storedContext.coreTasks, brandTraits: storedContext.brandTraits }
    : undefined;
  if (siteContext) projection = { ...projection, pack: { ...projection.pack, siteContext } };
  let reading: Awaited<ReturnType<ProductReviewCore>>;
  try {
    reading = await core({
      rootDir: JURY_PRODUCT_DATA_ROOT,
      evidence: screenAuditFindings ? { ...projection.pack, screenAuditFindings } : projection.pack,
      trace,
    });
  } catch {
    return fail('REVIEW_NOT_EXECUTED');
  }
  if (!(JURY_DECISIONS as readonly string[]).includes(reading.expectedDecision)) {
    return fail('DECISION_NOT_IN_CONTRACT', reading.boardRunId);
  }
  if (
    !(JURY_EVIDENCE_STRENGTHS as readonly string[]).includes(reading.evidenceStrength) ||
    !(JURY_CLAIM_STRENGTHS as readonly string[]).includes(reading.claimStrength) ||
    typeof reading.boardRunId !== 'string' ||
    reading.boardRunId.length === 0
  ) {
    return fail('CORE_READING_REJECTED', typeof reading.boardRunId === 'string' ? reading.boardRunId : undefined);
  }
  const decision = reading.expectedDecision as JuryDecision;
  const resultId = sha([requestId, reading.boardRunId]);
  // P4: link to this service's previous full review (stored in finalSurface; lineage column untouched).
  let previous: { id: string; completedAt: Date; finalSurface: unknown } | null = null;
  try {
    previous = await prisma.juryReviewResult.findFirst({
      where: {
        tenantId: actor.tenantId,
        reviewRequestId: { not: requestId },
        completedAt: { lt: new Date(reading.completedAt) },
        request: { connectionId: connection.id, reviewType: 'FULL_REVIEW' },
      },
      orderBy: { completedAt: 'desc' },
      select: { id: true, completedAt: true, finalSurface: true },
    });
  } catch {
    previous = null;
  }
  const comparison = compareWithPrevious(previous, reading.finalSurface);
  const surface = comparison ? { ...reading.finalSurface, previousComparison: comparison } : reading.finalSurface;
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
      await finishAttempt('COMPLETED', null, reading.boardRunId);
      return {
        ok: true,
        reused: true,
        requestId,
        resultId: raced.id,
        decision: raced.expectedDecision,
        status: 'COMPLETED',
      };
    }
    return fail('PERSISTENCE_FAILED', reading.boardRunId);
  }
  await finishAttempt('COMPLETED', null, reading.boardRunId);
  return { ok: true, reused: false, requestId, resultId, decision, status: 'COMPLETED' };
  };
  if (background) {
    background(async () => {
      try {
        await execute();
      } catch {
        await markReviewFailed(requestId, actor.tenantId, { actorUserId: actor.userId, evidenceId: evidence.id, failureReason: 'REVIEW_NOT_EXECUTED' }).catch(() => undefined);
      }
    });
    return { ok: true, started: true, requestId, status: 'RUNNING' };
  }
  return execute();
}

/** True when a stored finalSurface carries the improvementProposals key (empty list included). */
export function hasProposalsKey(finalSurface: unknown): boolean {
  return typeof finalSurface === 'object' && finalSurface !== null && Object.hasOwn(finalSurface, 'improvementProposals');
}
