/**
 * Loads the active organization's service grant and asks the feature helper.
 * Callers pass connection and resource ids. Client tenant, role, and permission are ignored.
 */
import { prisma } from '@/lib/prisma';
import type { JuryActor } from './access';
import {
  authorizeJuryServiceFeature,
  type FeatureAuthorizationFailure,
  type ServiceFeature,
} from './service-feature-authorization';
import type { ServiceGrantRow } from './service-member-management';
import { JURY_SERVICE_PERMISSIONS, type JuryServicePermission } from './service-permission';

type ReadyActor = Extract<JuryActor, { ok: true }>;

function oneOf(value: string): JuryServicePermission | null {
  return (JURY_SERVICE_PERMISSIONS as readonly string[]).includes(value) ? (value as JuryServicePermission) : null;
}

export async function listUserServiceGrants(tenantId: string, userId: string): Promise<ServiceGrantRow[]> {
  const rows = await prisma.juryServiceMember.findMany({
    where: { tenantId, userId },
    select: { id: true, tenantId: true, connectionId: true, userId: true, permission: true },
  });
  return rows.flatMap((row) => {
    const permission = oneOf(row.permission);
    if (!permission || row.tenantId !== tenantId || row.userId !== userId) return [];
    return [{
      id: row.id,
      tenantId: row.tenantId,
      connectionId: row.connectionId,
      userId: row.userId,
      permission,
    }];
  });
}

async function membershipFor(actor: ReadyActor) {
  const row = await prisma.juryMembership.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId },
    select: { tenantId: true, userId: true },
  });
  if (!row || row.tenantId !== actor.tenantId || row.userId !== actor.userId) return null;
  return { tenantId: row.tenantId, userId: row.userId };
}

async function connectionFor(tenantId: string, connectionId: string) {
  const row = await prisma.juryServiceConnection.findFirst({
    where: { id: connectionId, tenantId },
    select: { id: true, tenantId: true },
  });
  if (!row || row.tenantId !== tenantId || row.id !== connectionId) return null;
  return { id: row.id, tenantId: row.tenantId };
}

export async function guardServiceFeature(input: {
  actor: ReadyActor;
  feature: ServiceFeature;
  connectionId: string;
  resource?: { kind: 'service' | 'evidence' | 'review' | 'improvement' | 'agent' | 'changeGate' | 'rereview'; id: string; tenantId: string; connectionId: string } | null;
  clientTenantId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
  permission?: string | null;
  capability?: string | null;
}): Promise<{ ok: true; servicePermissions: JuryServicePermission[] } | { ok: false; reason: FeatureAuthorizationFailure }> {
  const [membership, connection, grants] = await Promise.all([
    membershipFor(input.actor),
    connectionFor(input.actor.tenantId, input.connectionId),
    listUserServiceGrants(input.actor.tenantId, input.actor.userId),
  ]);
  return authorizeJuryServiceFeature({
    actor: input.actor,
    membership,
    connection,
    grants,
    feature: input.feature,
    resource: input.resource,
    clientTenantId: input.clientTenantId,
    actingUserId: input.actingUserId,
    actorRole: input.actorRole,
    permission: input.permission,
    capability: input.capability,
  });
}

async function reviewConnection(tenantId: string, reviewId: string) {
  const review = await prisma.juryReviewResult.findFirst({
    where: { id: reviewId, tenantId },
    select: {
      id: true,
      tenantId: true,
      request: { select: { tenantId: true, connection: { select: { id: true, tenantId: true } } } },
    },
  });
  const connection = review?.request?.connection;
  if (!review || review.tenantId !== tenantId || review.request?.tenantId !== tenantId || !connection || connection.tenantId !== tenantId) {
    return null;
  }
  return { reviewId: review.id, connectionId: connection.id };
}

async function evidenceConnection(tenantId: string, evidenceId: string) {
  const evidence = await prisma.juryEvidence.findFirst({
    where: { id: evidenceId, tenantId },
    select: { id: true, tenantId: true, connection: { select: { id: true, tenantId: true } } },
  });
  const connection = evidence?.connection;
  if (!evidence || evidence.tenantId !== tenantId || !connection || connection.tenantId !== tenantId) return null;
  return { evidenceId: evidence.id, connectionId: connection.id };
}

async function taskConnection(tenantId: string, taskId: string) {
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: taskId, tenantId },
    select: {
      id: true,
      tenantId: true,
      reviewResult: {
        select: { tenantId: true, request: { select: { tenantId: true, connection: { select: { id: true, tenantId: true } } } } },
      },
    },
  });
  const connection = task?.reviewResult?.request?.connection;
  if (
    !task
    || task.tenantId !== tenantId
    || task.reviewResult?.tenantId !== tenantId
    || task.reviewResult.request?.tenantId !== tenantId
    || !connection
    || connection.tenantId !== tenantId
  ) return null;
  return { taskId: task.id, connectionId: connection.id };
}

async function executionConnection(tenantId: string, executionId: string) {
  const execution = await prisma.juryAgentExecution.findFirst({
    where: { id: executionId, tenantId },
    select: {
      id: true,
      tenantId: true,
      task: {
        select: {
          tenantId: true,
          reviewResult: {
            select: { tenantId: true, request: { select: { tenantId: true, connection: { select: { id: true, tenantId: true } } } } },
          },
        },
      },
    },
  });
  const connection = execution?.task?.reviewResult?.request?.connection;
  if (
    !execution
    || execution.tenantId !== tenantId
    || execution.task?.tenantId !== tenantId
    || execution.task.reviewResult?.tenantId !== tenantId
    || execution.task.reviewResult.request?.tenantId !== tenantId
    || !connection
    || connection.tenantId !== tenantId
  ) return null;
  return { executionId: execution.id, connectionId: connection.id };
}

export async function guardEvidenceFeature(actor: ReadyActor, evidenceId: string, feature: ServiceFeature) {
  const located = await evidenceConnection(actor.tenantId, evidenceId);
  if (!located) return { ok: false as const, reason: 'NOT_FOUND' as const };
  return guardServiceFeature({
    actor,
    feature,
    connectionId: located.connectionId,
    resource: { kind: 'evidence', id: located.evidenceId, tenantId: actor.tenantId, connectionId: located.connectionId },
  });
}

export async function guardReviewFeature(actor: ReadyActor, reviewId: string, feature: ServiceFeature) {
  const located = await reviewConnection(actor.tenantId, reviewId);
  if (!located) return { ok: false as const, reason: 'NOT_FOUND' as const };
  return guardServiceFeature({
    actor,
    feature,
    connectionId: located.connectionId,
    resource: { kind: 'review', id: located.reviewId, tenantId: actor.tenantId, connectionId: located.connectionId },
  });
}

export async function guardImprovementFeature(actor: ReadyActor, taskId: string, feature: ServiceFeature) {
  const located = await taskConnection(actor.tenantId, taskId);
  if (!located) return { ok: false as const, reason: 'NOT_FOUND' as const };
  return guardServiceFeature({
    actor,
    feature,
    connectionId: located.connectionId,
    resource: { kind: 'improvement', id: located.taskId, tenantId: actor.tenantId, connectionId: located.connectionId },
  });
}

export async function guardAgentExecutionFeature(actor: ReadyActor, executionId: string, feature: ServiceFeature) {
  const located = await executionConnection(actor.tenantId, executionId);
  if (!located) return { ok: false as const, reason: 'NOT_FOUND' as const };
  return guardServiceFeature({
    actor,
    feature,
    connectionId: located.connectionId,
    resource: { kind: 'agent', id: located.executionId, tenantId: actor.tenantId, connectionId: located.connectionId },
  });
}
