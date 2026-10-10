/**
 * Product boundary for GitHub evidence.
 * The collector does not call Prisma. Persistence uses the existing evidence store.
 */
import { randomUUID } from 'node:crypto';
import type { JuryActor } from '../../access';
import { persistProductEvidence } from '../../evidence-store';
import { JURY_CLAIM_STRENGTHS, JURY_EVIDENCE_STRENGTHS } from '../../records';
import { persistProductReview } from '../../review-store';
import { guardServiceFeature } from '../../service-feature-guard';
import { providerError, type ProviderError } from '../provider-types';
import { githubPayloadHasSecret } from './document-secret';
import { installationIdFromConnection, planGithubEvidenceCollection, repositoryFromGrants } from './access';
import { confirmInstallationAccess } from './client';
import { collectRepositoryEvidence } from './collector';
import { readGithubAppConfig } from './config';
import { normalizeGithubCollection, packFromStoredEvidence, viewFromStoredMetrics, type GithubEvidenceView } from './evidence';
import type { GithubRepository } from './discovery';
import { githubSectionState, planGithubProductAccess, planGithubReviewStart, projectGithubProductScreen, type GithubFlowReview, type GithubProductScreen } from './product-flow';
import { githubFirstReviewRequestId, runGithubEvidenceReview } from './review';
import type { FrozenCoreReading } from '../../review-boundary';

export type GithubFlowStop = { ok: false; flow: 'in-progress' | 'evidence-failed' | 'review-failed' | 'review-exists' };

function stopped(flow: GithubFlowStop['flow']): GithubFlowStop {
  return { ok: false, flow };
}

function listed<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function denied(actor: JuryActor): ProviderError | null {
  if (!actor.ok) return providerError('CONNECTION_UNAUTHORIZED');
  return null;
}

export async function collectGithubRepositoryEvidence(input: {
  actor: JuryActor;
  connectionId: string;
  requestedFullName: string;
  collectedAt?: string;
  clientTenantId?: string | null;
  clientOrganizationId?: string | null;
  clientUserId?: string | null;
  clientRole?: string | null;
  clientPermission?: string | null;
}): Promise<{ ok: true; evidenceId: string; view: GithubEvidenceView } | ProviderError | GithubFlowStop> {
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const guarded = await guardServiceFeature({
    actor,
    feature: 'review.execute',
    connectionId: input.connectionId,
    clientTenantId: null,
    actingUserId: null,
    actorRole: null,
    permission: null,
  });
  if (!guarded.ok) {
    return providerError(guarded.reason === 'NOT_FOUND' || guarded.reason === 'TENANT_MISMATCH' ? 'CONNECTION_NOT_FOUND' : 'CONNECTION_UNAUTHORIZED');
  }
  const config = readGithubAppConfig();
  if (!config.ok) return config;
  const { prisma } = await import('@/lib/prisma');
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: input.connectionId, tenantId: actor.tenantId },
  });
  if (!connection || connection.status !== 'CONNECTED') return providerError('CONNECTION_NOT_FOUND');
  const installationId = installationIdFromConnection(connection);
  if (!installationId) return providerError('CONNECTION_NOT_FOUND');
  const scope = await prisma.juryAccessScope.findFirst({
    where: { tenantId: actor.tenantId, connectionId: connection.id, status: 'APPROVED' },
  });
  const planned = planGithubEvidenceCollection({
    actorTenantId: actor.tenantId,
    connectionTenantId: connection.tenantId,
    connectionId: connection.id,
    requestedConnectionId: input.connectionId,
    allowedFullName: repositoryFromGrants(scope?.grants),
    requestedFullName: input.requestedFullName,
    clientTenantId: input.clientTenantId,
    clientOrganizationId: input.clientOrganizationId,
    clientUserId: input.clientUserId,
    clientRole: input.clientRole,
    clientPermission: input.clientPermission,
  });
  if (!planned.ok) return planned;
  const openReview = await prisma.juryReviewRequest.findFirst({
    where: { tenantId: actor.tenantId, connectionId: connection.id, status: { in: ['QUEUED', 'RUNNING'] } },
    select: { id: true },
  });
  if (openReview) return stopped('in-progress');
  const collected = await collectRepositoryEvidence({
    appId: config.config.appId,
    privateKey: config.config.privateKey,
    installationId,
    connectionId: connection.id,
    allowedFullName: planned.fullName,
    requestedFullName: planned.fullName,
    collectedAt: input.collectedAt ?? new Date().toISOString(),
  });
  if (!collected.ok) return collected;
  const draft = normalizeGithubCollection({ tenantId: actor.tenantId, collection: collected.collection });
  if (githubPayloadHasSecret(draft)) return providerError('SECRET_REJECTED');
  const stored = await persistProductEvidence({
    actorTenantId: actor.tenantId,
    connectionId: connection.id,
    evidence: draft.evidence,
    metrics: draft.metrics,
  });
  if (!stored.ok) return providerError('EVIDENCE_COLLECTION_FAILED');
  await prisma.juryAuditEvent.create({
    data: {
      id: randomUUID(),
      tenantId: actor.tenantId,
      timestamp: new Date(),
      actor: actor.userId,
      action: 'GITHUB_EVIDENCE_COLLECTED',
      serviceKey: connection.serviceKey,
      accessMethod: 'OAUTH',
      evidenceId: stored.evidence.id,
      provenance: {
        connectionId: connection.id,
        repository: planned.fullName,
        status: collected.collection.status,
        readOnly: true,
      },
    },
  });
  return { ok: true, evidenceId: stored.evidence.id, view: draft.view };
}

export async function loadGithubEvidenceView(input: {
  actor: JuryActor;
  connectionId: string;
}): Promise<{ ok: true; view: GithubEvidenceView | null } | ProviderError> {
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const guarded = await guardServiceFeature({
    actor,
    feature: 'evidence.read',
    connectionId: input.connectionId,
    clientTenantId: null,
    actingUserId: null,
    actorRole: null,
    permission: null,
  });
  if (!guarded.ok) {
    return providerError(guarded.reason === 'NOT_FOUND' || guarded.reason === 'TENANT_MISMATCH' ? 'CONNECTION_NOT_FOUND' : 'CONNECTION_UNAUTHORIZED');
  }
  const { prisma } = await import('@/lib/prisma');
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: input.connectionId, tenantId: actor.tenantId },
  });
  if (!connection) return providerError('CONNECTION_NOT_FOUND');
  const evidence = await prisma.juryEvidence.findFirst({
    where: { tenantId: actor.tenantId, connectionId: connection.id, adapterKey: 'github', purpose: 'github-repository-observation' },
    orderBy: { collectedAt: 'desc' },
    include: { metrics: true },
  });
  if (!evidence) return { ok: true, view: null };
  const scope = await prisma.juryAccessScope.findFirst({
    where: { tenantId: actor.tenantId, connectionId: connection.id, status: 'APPROVED' },
  });
  const repository = repositoryFromGrants(scope?.grants);
  if (!repository) return { ok: true, view: null };
  return {
    ok: true,
    view: viewFromStoredMetrics({
      repository,
      metrics: evidence.metrics.map((metric) => ({
        metric: metric.metric,
        value: metric.value,
        availability: metric.availability,
      })),
    }),
  };
}

export async function startGithubRepositoryReview(input: {
  actor: JuryActor;
  connectionId: string;
  execute: (pack: import('@/lib/ai-review-board/types').EvidencePack) => Promise<FrozenCoreReading>;
}): Promise<{ ok: true; reviewId: string } | ProviderError | GithubFlowStop> {
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const guarded = await guardServiceFeature({
    actor,
    feature: 'review.execute',
    connectionId: input.connectionId,
    clientTenantId: null,
    actingUserId: null,
    actorRole: null,
    permission: null,
  });
  if (!guarded.ok) {
    return providerError(guarded.reason === 'NOT_FOUND' || guarded.reason === 'TENANT_MISMATCH' ? 'CONNECTION_NOT_FOUND' : 'CONNECTION_UNAUTHORIZED');
  }
  const { prisma } = await import('@/lib/prisma');
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: input.connectionId, tenantId: actor.tenantId },
  });
  if (!connection) return providerError('CONNECTION_NOT_FOUND');
  const scope = await prisma.juryAccessScope.findFirst({
    where: { tenantId: actor.tenantId, connectionId: connection.id, status: 'APPROVED' },
  });
  const repository = repositoryFromGrants(scope?.grants);
  if (!repository) return providerError('SCOPE_DENIED');
  const evidence = await prisma.juryEvidence.findFirst({
    where: { tenantId: actor.tenantId, connectionId: connection.id, adapterKey: 'github', purpose: 'github-repository-observation' },
    orderBy: { collectedAt: 'desc' },
    include: { metrics: true },
  });
  if (!evidence || evidence.piiExcluded !== true || evidence.readOnly !== true) return stopped('evidence-failed');
  const existing = await prisma.juryReviewRequest.findFirst({
    where: {
      id: githubFirstReviewRequestId(actor.tenantId, evidence.id),
      tenantId: actor.tenantId,
      evidenceId: evidence.id,
    },
    select: { status: true },
  });
  const gate = planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: existing?.status ?? null });
  if (!gate.ok) return stopped(gate.flow);
  const pack = packFromStoredEvidence({
    evidence: {
      id: evidence.id,
      tenantId: evidence.tenantId,
      connectionId: evidence.connectionId,
      purpose: evidence.purpose,
      periodStart: evidence.periodStart,
      periodEnd: evidence.periodEnd,
      timezone: evidence.timezone,
      metricIds: Array.isArray(evidence.metricIds) ? evidence.metricIds.filter((item): item is string => typeof item === 'string') : [],
      documentEvidence: Array.isArray(evidence.documentEvidence) ? evidence.documentEvidence.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as { fileName?: unknown; source?: unknown; section?: unknown };
        if (typeof row.fileName !== 'string' || typeof row.source !== 'string') return [];
        return [{ fileName: row.fileName, source: row.source, ...(typeof row.section === 'string' ? { section: row.section } : {}) }];
      }) : undefined,
      adapterKey: evidence.adapterKey,
      collectedAt: evidence.collectedAt.toISOString(),
      piiExcluded: true,
      readOnly: true,
    },
    repository,
    metrics: evidence.metrics.map((metric) => ({
      metric: metric.metric,
      value: metric.value,
      availability: metric.availability,
      rawValueText: metric.rawValueText,
    })),
  });
  if (!pack || githubPayloadHasSecret(pack)) return providerError('SECRET_REJECTED');
  const reviewed = await runGithubEvidenceReview({
    tenantId: actor.tenantId,
    userId: actor.userId,
    connectionId: connection.id,
    evidenceId: evidence.id,
    pack,
    execute: input.execute,
  });
  if (!reviewed.ok) return providerError('EVIDENCE_COLLECTION_FAILED');
  const saved = await persistProductReview({ request: reviewed.request, result: reviewed.result });
  if (!saved.ok) return providerError('EVIDENCE_COLLECTION_FAILED');
  return { ok: true, reviewId: reviewed.result.id };
}

export async function listGithubRepositories(input: {
  actor: JuryActor;
  connectionId: string;
}): Promise<{ ok: true; repositories: GithubRepository[] } | ProviderError> {
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const guarded = await guardServiceFeature({
    actor,
    feature: 'evidence.read',
    connectionId: input.connectionId,
    clientTenantId: null,
    actingUserId: null,
    actorRole: null,
    permission: null,
  });
  if (!guarded.ok) {
    return providerError(guarded.reason === 'NOT_FOUND' || guarded.reason === 'TENANT_MISMATCH' ? 'CONNECTION_NOT_FOUND' : 'CONNECTION_UNAUTHORIZED');
  }
  const config = readGithubAppConfig();
  if (!config.ok) return config;
  const { prisma } = await import('@/lib/prisma');
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: input.connectionId, tenantId: actor.tenantId },
  });
  if (!connection || connection.status !== 'CONNECTED') return providerError('CONNECTION_NOT_FOUND');
  const installationId = installationIdFromConnection(connection);
  if (!installationId) return providerError('CONNECTION_NOT_FOUND');
  const access = await confirmInstallationAccess({
    appId: config.config.appId,
    privateKey: config.config.privateKey,
    installationId,
  });
  if (!access.ok) return access;
  return { ok: true, repositories: access.repositories };
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function storedSurface(value: unknown): GithubFlowReview['result'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.statusSummary !== 'string' || typeof row.expectedUserEffect !== 'string' || typeof row.risk !== 'string') return null;
  return {
    id: '',
    decision: 'VERIFY',
    statusSummary: row.statusSummary,
    topProblems: textList(row.topProblems),
    expectedUserEffect: row.expectedUserEffect,
    risk: row.risk,
    dimensionEvidence: textList(row.dimensionEvidence),
    supportedClaims: textList(row.supportedClaims),
    partiallySupportedClaims: textList(row.partiallySupportedClaims),
    hypotheses: textList(row.hypotheses),
  };
}

export async function loadGithubProductScreen(input: {
  actor: JuryActor;
  connectionId: string;
  configured: boolean;
  servicePermission: import('../../service-permission').JuryServicePermission | null;
  repository: string | null;
}): Promise<{ ok: true; screen: GithubProductScreen } | ProviderError> {
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const access = planGithubProductAccess({
    actorTenantId: actor.tenantId,
    connectionTenantId: actor.tenantId,
    connectionId: input.connectionId,
    requestedConnectionId: input.connectionId,
    servicePermission: input.servicePermission,
    clientTenantId: null,
    clientRole: null,
    clientPermission: null,
    clientOperation: null,
    clientReadonly: null,
  });
  if (!access.ok) return access;
  const { prisma } = await import('@/lib/prisma');
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: input.connectionId, tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!connection) return providerError('CONNECTION_NOT_FOUND');
  if (!access.canView) {
    return {
      ok: true,
      screen: projectGithubProductScreen({
        source: 'github',
        configured: input.configured,
        access,
        repository: null,
        evidence: null,
        review: null,
      }),
    };
  }
  const evidence = await prisma.juryEvidence.findFirst({
    where: { tenantId: actor.tenantId, connectionId: input.connectionId, adapterKey: 'github', purpose: 'github-repository-observation' },
    orderBy: { collectedAt: 'desc' },
    include: { metrics: true },
  });
  const request = evidence
    ? await prisma.juryReviewRequest.findFirst({
      where: { tenantId: actor.tenantId, evidenceId: evidence.id },
      include: { result: true },
    })
    : null;
  const metrics = evidence?.metrics.map((metric) => ({
    metric: metric.metric,
    value: metric.value,
    availability: metric.availability,
    rawValueText: metric.rawValueText,
  })) ?? [];
  const summary = evidence ? viewFromStoredMetrics({ repository: input.repository ?? '', metrics }) : null;
  const readme = metrics.find((metric) => metric.metric === 'github.readmeBytes');
  const documents = Array.isArray(evidence?.documentEvidence) ? evidence.documentEvidence : [];
  const readmeDocument = documents.find((item) => item && typeof item === 'object' && String((item as { fileName?: unknown }).fileName ?? '').startsWith('README'));
  const repositoryDocument = documents.find((item) => item && typeof item === 'object' && (item as { fileName?: unknown }).fileName === input.repository);
  const branch = typeof (repositoryDocument as { section?: unknown } | undefined)?.section === 'string'
    ? /defaultBranch=([A-Za-z0-9._/-]+)/.exec((repositoryDocument as { section: string }).section)?.[1] ?? null
    : null;
  const decision = request?.result?.expectedDecision;
  const surface = storedSurface(request?.result?.finalSurface);
  const review: GithubFlowReview | null = request && (request.status === 'QUEUED' || request.status === 'RUNNING' || request.status === 'COMPLETED' || request.status === 'FAILED')
    ? {
      status: request.status,
      result: surface && (decision === 'ACCEPT' || decision === 'VERIFY' || decision === 'REWORD')
        ? {
          ...surface,
          id: request.result?.id ?? '',
          decision,
          evidenceStrength: listed(request.result?.evidenceStrength, JURY_EVIDENCE_STRENGTHS),
          claimStrength: listed(request.result?.claimStrength, JURY_CLAIM_STRENGTHS),
        }
        : null,
    }
    : null;
  return {
    ok: true,
    screen: projectGithubProductScreen({
      source: 'github',
      configured: input.configured,
      access,
      repository: input.repository,
      evidence: summary ? {
        status: summary.status === 'PARTIAL' && readme?.availability === 'COLLECTION_FAILED' && metrics.filter((metric) => metric.availability === 'COLLECTION_FAILED').length >= 3 ? 'FAILED' : summary.status,
        collectedAt: evidence?.collectedAt.toISOString() ?? null,
        repository: summary.repository,
        defaultBranch: branch === 'not-available' ? null : branch,
        readme: readme?.availability === 'COLLECTION_FAILED' ? 'FAILED' : summary.readme,
        readmeBytes: readme?.availability === 'AVAILABLE' ? readme.value : null,
        commitCount: summary.commitCount,
        structureCount: summary.structureCount,
        structureState: githubSectionState(metrics.find((metric) => metric.metric === 'github.structureEntryCount')),
        readmeState: githubSectionState(readme),
        excerpt: typeof (readmeDocument as { section?: unknown } | undefined)?.section === 'string' ? (readmeDocument as { section: string }).section : null,
      } : null,
      review,
    }),
  };
}
