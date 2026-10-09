/**
 * Persistence for an explicit GitHub refresh.
 * The claim is one INSERT ... ON CONFLICT (id) DO NOTHING. The primary key is the lock.
 * Existing first-review rows are only read.
 */
import { Prisma } from '@prisma/client';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryFinalSurface } from '../../records';
import { repositoryFromGrants } from './access';
import { readRefreshArtifact, type GithubRefreshClaim, type GithubRefreshSnapshot, type GithubRefreshStore } from './refresh';
import { githubFirstReviewRequestId } from './review';

export async function insertRefreshClaim(row: {
  id: string;
  tenantId: string;
  connectionId: string;
  evidenceId: string;
  fingerprint: string;
  requestedByUserId: string | null;
}): Promise<boolean> {
  const { prisma } = await import('@/lib/prisma');
  const inserted = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "JuryReviewRequest" (
      id, "tenantId", "connectionId", "evidenceId", "reviewType", claim, mode, status, "coreRootDir", "requestedByUserId"
    ) VALUES (
      ${row.id}, ${row.tenantId}, ${row.connectionId}, ${row.evidenceId},
      'FULL_REVIEW'::"JuryReviewType", ${row.fingerprint}, 'EXTERNAL_SERVICE'::"JuryReviewMode",
      'QUEUED'::"JuryReviewStatus", ${JURY_PRODUCT_DATA_ROOT}, ${row.requestedByUserId}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `);
  return inserted.length === 1;
}

export async function createPrismaRefreshStore(): Promise<GithubRefreshStore> {
  const { prisma } = await import('@/lib/prisma');
  return {
    async load(input): Promise<GithubRefreshSnapshot> {
      const evidence = await prisma.juryEvidence.findFirst({
        where: { id: input.evidenceId, tenantId: input.tenantId, connectionId: input.connectionId },
        include: { metrics: true },
      });
      const scope = await prisma.juryAccessScope.findFirst({
        where: { tenantId: input.tenantId, connectionId: input.connectionId, status: 'APPROVED' },
      });
      const firstId = githubFirstReviewRequestId(input.tenantId, input.evidenceId);
      const first = await prisma.juryReviewRequest.findFirst({
        where: { id: firstId, tenantId: input.tenantId, evidenceId: input.evidenceId },
      });
      const result = first
        ? await prisma.juryReviewResult.findFirst({ where: { reviewRequestId: first.id, tenantId: input.tenantId } })
        : null;
      return {
        evidence: evidence ? {
          id: evidence.id,
          tenantId: evidence.tenantId,
          connectionId: evidence.connectionId,
          purpose: evidence.purpose,
          periodStart: evidence.periodStart,
          periodEnd: evidence.periodEnd,
          timezone: evidence.timezone,
          metricIds: Array.isArray(evidence.metricIds) ? evidence.metricIds.filter((item): item is string => typeof item === 'string') : [],
          documentEvidence: documentsOf(evidence.documentEvidence),
          adapterKey: evidence.adapterKey,
          collectedAt: evidence.collectedAt.toISOString(),
          piiExcluded: evidence.piiExcluded,
          readOnly: evidence.readOnly,
        } : null,
        repository: repositoryFromGrants(scope?.grants),
        metrics: (evidence?.metrics ?? []).map((metric) => ({
          metric: metric.metric,
          value: metric.value,
          availability: metric.availability,
          rawValueText: metric.rawValueText,
        })),
        firstRequest: first ? { id: first.id, status: first.status } : null,
        firstResult: result ? {
          id: result.id,
          decision: result.expectedDecision,
          boardRunId: result.boardRunId,
          finalSurface: surfaceOf(result.finalSurface),
        } : null,
      };
    },
    async claim(row) {
      const claimed = await insertRefreshClaim({
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        evidenceId: row.evidenceId,
        fingerprint: row.fingerprint,
        requestedByUserId: row.requestedByUserId,
      });
      return claimed ? 'claimed' : 'conflict';
    },
    async readClaim(id): Promise<GithubRefreshClaim | null> {
      const request = await prisma.juryReviewRequest.findFirst({
        where: { id },
        include: { result: true },
      });
      if (!request) return null;
      return {
        id: request.id,
        status: request.status,
        fingerprint: request.claim ?? '',
        resultId: request.result?.id ?? null,
        parentResultId: request.result?.parentReviewResultId ?? null,
      };
    },
    async complete(row) {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.$executeRaw(Prisma.sql`
          UPDATE "JuryReviewRequest"
          SET status = 'COMPLETED'::"JuryReviewStatus"
          WHERE id = ${row.requestId} AND status = 'QUEUED'::"JuryReviewStatus"
        `);
        if (updated !== 1) return 'lost' as const;
        await tx.juryReviewResult.create({
          data: {
            id: row.resultId,
            tenantId: row.tenantId,
            reviewRequestId: row.requestId,
            boardRunId: row.reading.boardRunId,
            evidenceStrength: row.reading.evidenceStrength as 'strong' | 'moderate' | 'unknown',
            claimStrength: row.reading.claimStrength as 'weak' | 'strong' | 'extreme',
            conflictDetected: row.reading.conflictDetected,
            overclaimDetected: row.reading.overclaimDetected,
            revisionRequired: row.reading.revisionRequired,
            expectedDecision: row.reading.expectedDecision as 'ACCEPT' | 'VERIFY' | 'REWORD',
            finalSurface: row.reading.finalSurface as Prisma.InputJsonValue,
            contractVersion: JURY_CORE_CONTRACT_VERSION,
            completedAt: new Date(row.reading.completedAt),
            parentReviewResultId: row.parentResultId,
          },
        });
        return 'completed' as const;
      });
    },
    async fail(requestId) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "JuryReviewRequest"
        SET status = 'FAILED'::"JuryReviewStatus"
        WHERE id = ${requestId} AND status = 'QUEUED'::"JuryReviewStatus"
      `);
    },
    readArtifact(boardRunId: string): Promise<EvidencePack | null> {
      return readRefreshArtifact(boardRunId);
    },
  };
}

function documentsOf(value: unknown): Array<{ fileName: string; source: string; section?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { fileName?: unknown; source?: unknown; section?: unknown };
    if (typeof row.fileName !== 'string' || typeof row.source !== 'string') return [];
    return [{ fileName: row.fileName, source: row.source, ...(typeof row.section === 'string' ? { section: row.section } : {}) }];
  });
}

function surfaceOf(value: unknown): JuryFinalSurface {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const list = (item: unknown) => Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string') : [];
  return {
    statusSummary: typeof row.statusSummary === 'string' ? row.statusSummary : '',
    topProblems: list(row.topProblems),
    expectedUserEffect: typeof row.expectedUserEffect === 'string' ? row.expectedUserEffect : '',
    risk: typeof row.risk === 'string' ? row.risk : '',
    dimensionEvidence: list(row.dimensionEvidence),
    supportedClaims: list(row.supportedClaims),
    partiallySupportedClaims: list(row.partiallySupportedClaims),
    hypotheses: list(row.hypotheses),
  };
}
