/**
 * Records one PENDING agent execution for a human-approved improvement task.
 * It does not call an adapter, spawn a process, or change files.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';

export const HUMAN_HANDOFF_AGENT = 'CURSOR' as const;
export const HUMAN_HANDOFF_AUDIT = 'AGENT_HANDOFF_CREATED';
export const HUMAN_HANDOFF_WORKSPACE = { type: 'PROJECT', ref: 'jury-product' } as const;

export type HumanHandoffFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'IMPROVEMENT_TASK_NOT_OPEN'
  | 'SNAPSHOT_UNSAFE'
  | 'PERSISTENCE_FAILED';

export function humanAgentExecutionId(tenantId: string, taskId: string): string {
  return sha([tenantId, taskId, HUMAN_HANDOFF_AGENT, 'human-handoff']);
}

export function humanAgentHandoffAuditId(tenantId: string, executionId: string): string {
  return sha([tenantId, HUMAN_HANDOFF_AUDIT, executionId]);
}

export async function persistHumanAgentHandoff(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  improvementTaskId: string;
}): Promise<
  | {
      ok: true;
      created: boolean;
      reviewId: string;
      improvementTaskId: string;
      agentExecutionId: string;
      status: 'PENDING';
      agent: typeof HUMAN_HANDOFF_AGENT;
    }
  | { ok: false; reason: HumanHandoffFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.improvementTaskId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  try {
    const { prisma } = await import('@/lib/prisma');
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryImprovementTask" WHERE id = ${input.improvementTaskId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const task = await tx.juryImprovementTask.findFirst({
        where: { id: input.improvementTaskId, tenantId: actor.tenantId },
        select: {
          id: true,
          tenantId: true,
          reviewResultId: true,
          evidenceId: true,
          taskType: true,
          status: true,
          diagnosis: true,
          acceptanceCriteria: true,
          provenance: true,
          evidence: { select: { id: true, tenantId: true } },
        },
      });
      if (!task || task.tenantId !== actor.tenantId) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const review = await tx.juryReviewResult.findFirst({
        where: { id: task.reviewResultId, tenantId: actor.tenantId },
        select: { id: true, tenantId: true, reviewRequestId: true, expectedDecision: true },
      });
      const juryDecision = review ? oneOf(JURY_DECISIONS, review.expectedDecision) : null;
      if (!review || review.tenantId !== actor.tenantId || !juryDecision) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      const linked = linkedHumanId(task.provenance, review.id);
      if (!linked) return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      const human = await tx.juryHumanDecision.findFirst({
        where: { tenantId: actor.tenantId, reviewResultId: review.id },
        select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true, decision: true },
      });
      const humanDecision = human ? oneOf(JURY_DECISIONS, human.decision) : null;
      if (
        !human
        || !humanDecision
        || human.tenantId !== actor.tenantId
        || human.id !== linked.humanDecisionId
        || human.reviewResultId !== review.id
        || human.reviewRequestId !== review.reviewRequestId
        || linked.reviewRequestId !== review.reviewRequestId
      ) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      const taskType = humanImprovementTaskType(humanDecision);
      if (humanDecision === 'ACCEPT' || !taskType || task.taskType !== taskType) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      const allowed = decideJuryMutation({
        actor,
        action: 'improvement.write',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      if (task.status !== 'OPEN') return { ok: false as const, reason: 'IMPROVEMENT_TASK_NOT_OPEN' as const };
      const executionId = humanAgentExecutionId(actor.tenantId, task.id);
      const existing = await tx.juryAgentExecution.findFirst({
        where: { tenantId: actor.tenantId, taskId: task.id, agent: HUMAN_HANDOFF_AGENT },
        select: { id: true, tenantId: true, status: true, taskId: true },
      });
      if (existing) {
        if (existing.tenantId !== actor.tenantId || existing.taskId !== task.id || existing.status !== 'PENDING') {
          return { ok: false as const, reason: 'NOT_FOUND' as const };
        }
        return {
          ok: true as const,
          created: false,
          reviewId: review.id,
          improvementTaskId: task.id,
          agentExecutionId: existing.id,
          status: 'PENDING' as const,
          agent: HUMAN_HANDOFF_AGENT,
        };
      }
      const evidenceId = task.evidence?.tenantId === actor.tenantId ? task.evidence.id : null;
      const snapshot = {
        kind: 'human-agent-handoff',
        improvementTaskId: task.id,
        reviewResultId: review.id,
        reviewRequestId: review.reviewRequestId,
        humanDecisionId: human.id,
        humanDecision,
        juryDecision,
        taskType,
        diagnosis: task.diagnosis,
        acceptanceCriteria: stringList(task.acceptanceCriteria),
        evidenceId,
      };
      if (containsSecret(snapshot) || containsSecret(HUMAN_HANDOFF_WORKSPACE)) {
        return { ok: false as const, reason: 'SNAPSHOT_UNSAFE' as const };
      }
      const now = new Date();
      await tx.juryAgentExecution.create({
        data: {
          id: executionId,
          tenantId: actor.tenantId,
          taskId: task.id,
          agent: HUMAN_HANDOFF_AGENT,
          allowedPaths: [],
          deniedPaths: [],
          status: 'PENDING',
          startedAt: null,
          finishedAt: null,
          inputSnapshot: snapshot,
          workspaceRef: HUMAN_HANDOFF_WORKSPACE,
          requestedAt: now,
          provenance: {
            kind: 'human-agent-handoff',
            reviewRequestId: review.reviewRequestId,
            reviewResultId: review.id,
            humanDecisionId: human.id,
            improvementTaskId: task.id,
            humanDecision,
            juryDecision,
            taskType,
          },
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.juryAuditEvent.create({
        data: {
          id: humanAgentHandoffAuditId(actor.tenantId, executionId),
          tenantId: actor.tenantId,
          timestamp: now,
          actor: actor.userId,
          action: HUMAN_HANDOFF_AUDIT,
          reviewId: review.id,
          decision: humanDecision,
          improvementTaskId: task.id,
          agent: HUMAN_HANDOFF_AGENT,
          agentExecutionId: executionId,
          provenance: {
            kind: 'human-agent-handoff',
            reviewRequestId: review.reviewRequestId,
            reviewResultId: review.id,
            humanDecisionId: human.id,
            improvementTaskId: task.id,
            agentExecutionId: executionId,
            humanDecision,
            taskType,
          },
        },
      });
      return {
        ok: true as const,
        created: true,
        reviewId: review.id,
        improvementTaskId: task.id,
        agentExecutionId: executionId,
        status: 'PENDING' as const,
        agent: HUMAN_HANDOFF_AGENT,
      };
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

function linkedHumanId(value: unknown, reviewResultId: string): { humanDecisionId: string; reviewRequestId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== HUMAN_IMPROVEMENT_KIND) return null;
  if (typeof row.humanDecisionId !== 'string' || row.humanDecisionId.trim().length === 0) return null;
  if (typeof row.reviewRequestId !== 'string' || row.reviewRequestId.trim().length === 0) return null;
  if (row.reviewResultId !== reviewResultId) return null;
  return { humanDecisionId: row.humanDecisionId, reviewRequestId: row.reviewRequestId };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function containsSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('credentialref')
    || lower.includes('private_key')
    || lower.includes('begin private')
    || lower.includes('postgres://')
    || lower.includes('password')
    || lower.includes('access_token')
    || lower.includes('refresh_token')
    || lower.includes('api_key')
    || lower.includes('sessioncookie')
  );
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
