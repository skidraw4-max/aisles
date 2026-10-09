/**
 * Read-only GitHub Refresh status for the signed-in actor's connection.
 * Identity comes from getJuryActor. This module does not start a review or insert a claim.
 */
import type { JuryActor } from '../../access';
import type { JuryEvidence, JuryReviewStatus } from '../../records';
import { githubInstallationReference, githubServiceKey, installationIdFromConnection, repositoryFromGrants } from './access';
import { githubPayloadHasSecret } from './document-secret';
import { packFromStoredEvidence, type GithubStoredMetric } from './evidence';
import { evidencePackFingerprint, githubRefreshRequestId } from './pack-fingerprint';
import { githubFirstReviewRequestId } from './review';

export type GithubRefreshStatusState = 'hidden' | 'none' | 'in-progress' | 'reusable' | 'failed' | 'unavailable';

export type GithubRefreshStatus = { state: GithubRefreshStatusState };

export type GithubRefreshStatusClaim = {
  status: JuryReviewStatus;
  fingerprint: string;
  resultId: string | null;
  parentResultId: string | null;
};

export type GithubRefreshStatusEvidence = {
  id: string;
  tenantId: string;
  connectionId: string;
  purpose: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  documentEvidence: Array<{ fileName: string; source: string; section?: string }>;
  collectedAt: string;
  piiExcluded: boolean;
  readOnly: boolean;
  metrics: readonly GithubStoredMetric[];
};

export type GithubRefreshStatusPort = {
  actor: () => Promise<JuryActor>;
  loadConnection: (query: { connectionId: string; tenantId: string }) => Promise<{
    id: string;
    tenantId: string;
    serviceKey: string;
    credentialRef: string | null;
  } | null>;
  loadEvidence: (query: { connectionId: string; tenantId: string }) => Promise<GithubRefreshStatusEvidence | null>;
  loadRepository: (query: { connectionId: string; tenantId: string }) => Promise<string | null>;
  loadParentResultId: (query: { connectionId: string; tenantId: string; evidenceId: string; requestId: string }) => Promise<string | null>;
  loadClaim: (query: { id: string; tenantId: string; connectionId: string; evidenceId: string }) => Promise<GithubRefreshStatusClaim | null>;
};

export function classifyGithubRefreshClaim(input: {
  claim: GithubRefreshStatusClaim | null;
  fingerprint: string;
  parentResultId: string | null;
}): Exclude<GithubRefreshStatusState, 'hidden'> {
  const claim = input.claim;
  if (!claim) return 'none';
  if (claim.status === 'QUEUED' || claim.status === 'RUNNING') return 'in-progress';
  if (claim.status === 'FAILED') return 'failed';
  if (
    claim.status === 'COMPLETED'
    && claim.resultId
    && claim.fingerprint === input.fingerprint
    && input.parentResultId
    && claim.parentResultId === input.parentResultId
  ) {
    return 'reusable';
  }
  return 'unavailable';
}

function isGithubConnection(connection: { serviceKey: string; credentialRef: string | null }): boolean {
  const installationId = installationIdFromConnection(connection);
  if (!installationId) return false;
  return connection.serviceKey === githubServiceKey(installationId)
    && connection.credentialRef === githubInstallationReference(installationId);
}

export async function readGithubRefreshStatus(connectionId: string, port?: GithubRefreshStatusPort): Promise<GithubRefreshStatus> {
  const deps = port ?? await prismaRefreshStatusPort();
  try {
    const actor = await deps.actor();
    if (!actor.ok) return { state: 'hidden' };
    const connection = await deps.loadConnection({ connectionId, tenantId: actor.tenantId });
    if (!connection || connection.id !== connectionId || connection.tenantId !== actor.tenantId) return { state: 'hidden' };
    if (!isGithubConnection(connection)) return { state: 'hidden' };
    const evidence = await deps.loadEvidence({ connectionId, tenantId: actor.tenantId });
    if (!evidence) return { state: 'none' };
    if (evidence.tenantId !== actor.tenantId || evidence.connectionId !== connection.id) return { state: 'hidden' };
    if (evidence.purpose !== 'github-repository-observation') return { state: 'unavailable' };
    const repository = await deps.loadRepository({ connectionId, tenantId: actor.tenantId });
    if (!repository) return { state: 'unavailable' };
    const pack = packFromStoredEvidence({
      evidence: evidence as unknown as JuryEvidence,
      repository,
      metrics: evidence.metrics,
    });
    if (!pack || githubPayloadHasSecret(pack)) return { state: 'unavailable' };
    const fingerprint = evidencePackFingerprint(pack);
    const claim = await deps.loadClaim({
      id: githubRefreshRequestId(actor.tenantId, evidence.id, fingerprint),
      tenantId: actor.tenantId,
      connectionId: connection.id,
      evidenceId: evidence.id,
    });
    const parentResultId = await deps.loadParentResultId({
      connectionId: connection.id,
      tenantId: actor.tenantId,
      evidenceId: evidence.id,
      requestId: githubFirstReviewRequestId(actor.tenantId, evidence.id),
    });
    return { state: classifyGithubRefreshClaim({ claim, fingerprint, parentResultId }) };
  } catch {
    return { state: 'unavailable' };
  }
}

async function prismaRefreshStatusPort(): Promise<GithubRefreshStatusPort> {
  const { prisma } = await import('@/lib/prisma');
  const { getJuryActor } = await import('../../session');
  return {
    actor: () => getJuryActor(null),
    async loadConnection(query) {
      return prisma.juryServiceConnection.findFirst({
        where: { id: query.connectionId, tenantId: query.tenantId },
        select: { id: true, tenantId: true, serviceKey: true, credentialRef: true },
      });
    },
    async loadEvidence(query) {
      const row = await prisma.juryEvidence.findFirst({
        where: {
          tenantId: query.tenantId,
          connectionId: query.connectionId,
          adapterKey: 'github',
          purpose: 'github-repository-observation',
        },
        orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }],
        include: { metrics: true },
      });
      if (!row || row.tenantId !== query.tenantId || row.connectionId !== query.connectionId) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        connectionId: row.connectionId,
        purpose: row.purpose,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        timezone: row.timezone,
        documentEvidence: documentsOf(row.documentEvidence),
        collectedAt: row.collectedAt.toISOString(),
        piiExcluded: row.piiExcluded,
        readOnly: row.readOnly,
        metrics: row.metrics.map((metric) => ({
          metric: metric.metric,
          value: metric.value,
          availability: metric.availability,
          rawValueText: metric.rawValueText,
        })),
      };
    },
    async loadRepository(query) {
      const scope = await prisma.juryAccessScope.findFirst({
        where: { tenantId: query.tenantId, connectionId: query.connectionId, status: 'APPROVED' },
        select: { grants: true },
      });
      return repositoryFromGrants(scope?.grants);
    },
    async loadParentResultId(query) {
      const request = await prisma.juryReviewRequest.findFirst({
        where: {
          id: query.requestId,
          tenantId: query.tenantId,
          connectionId: query.connectionId,
          evidenceId: query.evidenceId,
        },
        select: { result: { select: { id: true } } },
      });
      return request?.result?.id ?? null;
    },
    async loadClaim(query) {
      const request = await prisma.juryReviewRequest.findFirst({
        where: {
          id: query.id,
          tenantId: query.tenantId,
          connectionId: query.connectionId,
          evidenceId: query.evidenceId,
        },
        select: {
          claim: true,
          status: true,
          result: { select: { id: true, parentReviewResultId: true } },
        },
      });
      if (!request) return null;
      return {
        status: request.status,
        fingerprint: request.claim ?? '',
        resultId: request.result?.id ?? null,
        parentResultId: request.result?.parentReviewResultId ?? null,
      };
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
