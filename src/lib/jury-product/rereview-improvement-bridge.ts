/**
 * Creates one ImprovementTask from a stored re-review ReviewResult.
 * ACCEPT stops. VERIFY and REWORD stop after the task.
 * The task type comes from the re-review decision. Human Decision is lineage only.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { containsSecret } from './agent-execution';
import { HUMAN_IMPROVEMENT_AUDIT, HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import { REWORD_CONSTRAINTS } from './improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';

export const REREVIEW_IMPROVEMENT_KIND = 'rereview-improvement';

export type ReReviewImprovementFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_REREVIEW_RESULT'
  | 'PERSISTENCE_FAILED';

export function reReviewImprovementTaskId(tenantId: string, reReviewResultId: string): string {
  return sha([tenantId, reReviewResultId, 'rereview-improvement']);
}

export function reReviewImprovementAuditId(tenantId: string, taskId: string): string {
  return sha([tenantId, HUMAN_IMPROVEMENT_AUDIT, taskId]);
}

export async function persistReReviewImprovement(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  reReviewResultId: string;
}): Promise<
  | {
      ok: true;
      created: boolean;
      outcome: 'NO_IMPROVEMENT' | 'IMPROVEMENT';
      reviewId: string;
      reReviewResultId: string;
      taskId: string | null;
      taskType: 'VERIFICATION' | 'REWORD' | null;
    }
  | { ok: false; reason: ReReviewImprovementFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.reReviewResultId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  try {
    const { prisma } = await import('@/lib/prisma');
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryReviewResult" WHERE id = ${input.reReviewResultId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const result = await tx.juryReviewResult.findFirst({
        where: { id: input.reReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          tenantId: true,
          reviewRequestId: true,
          parentReviewResultId: true,
          expectedDecision: true,
          finalSurface: true,
          request: { select: { id: true, tenantId: true, evidenceId: true } },
        },
      });
      const decision = result ? oneOf(JURY_DECISIONS, result.expectedDecision) : null;
      const reviews = result
        ? await tx.juryChangeGateReview.findMany({
            where: { reviewResultId: result.id, tenantId: actor.tenantId },
            select: {
              id: true,
              tenantId: true,
              parentReviewResultId: true,
              changeGateResultId: true,
              agentExecutionId: true,
              improvementTaskId: true,
              evidenceId: true,
              reviewRequestId: true,
              reviewResultId: true,
              status: true,
              source: true,
            },
          })
        : [];
      const linked = reviews.length === 1 ? reviews[0] : null;
      if (
        !result
        || !decision
        || result.tenantId !== actor.tenantId
        || result.request?.tenantId !== actor.tenantId
        || result.request.id !== result.reviewRequestId
        || !result.parentReviewResultId
        || !linked
        || linked.status !== 'EXECUTED'
        || linked.source !== 'CHANGE_GATE'
        || linked.reviewRequestId !== result.reviewRequestId
        || linked.reviewResultId !== result.id
        || linked.parentReviewResultId !== result.parentReviewResultId
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_RESULT' as const };
      }
      const original = await tx.juryReviewResult.findFirst({
        where: { id: result.parentReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          tenantId: true,
          reviewRequestId: true,
          request: { select: { id: true, tenantId: true } },
          humanDecision: {
            select: { id: true, tenantId: true, decision: true, reviewResultId: true, reviewRequestId: true },
          },
        },
      });
      const gate = await tx.juryChangeGateResult.findFirst({
        where: { id: linked.changeGateResultId, tenantId: actor.tenantId },
        select: { id: true, tenantId: true, executionId: true, improvementTaskId: true, status: true },
      });
      const execution = await tx.juryAgentExecution.findFirst({
        where: { id: linked.agentExecutionId, tenantId: actor.tenantId },
        select: { id: true, tenantId: true, taskId: true, status: true },
      });
      const sourceTask = await tx.juryImprovementTask.findFirst({
        where: { id: linked.improvementTaskId, tenantId: actor.tenantId },
        select: { id: true, tenantId: true, reviewResultId: true, provenance: true },
      });
      const evidence = await tx.juryEvidence.findFirst({
        where: { id: linked.evidenceId, tenantId: actor.tenantId },
        select: { id: true, tenantId: true },
      });
      const human = original?.humanDecision?.tenantId === actor.tenantId ? original.humanDecision : null;
      const humanDecision = human ? oneOf(JURY_DECISIONS, human.decision) : null;
      const sourceHuman = sourceTask ? linkedHuman(sourceTask.provenance, original?.id ?? '') : null;
      if (
        !original
        || original.tenantId !== actor.tenantId
        || original.request?.tenantId !== actor.tenantId
        || original.request.id !== original.reviewRequestId
        || !human
        || !humanDecision
        || human.reviewResultId !== original.id
        || human.reviewRequestId !== original.reviewRequestId
        || !gate
        || gate.tenantId !== actor.tenantId
        || gate.status !== 'APPROVED'
        || gate.executionId !== execution?.id
        || gate.improvementTaskId !== sourceTask?.id
        || !execution
        || execution.tenantId !== actor.tenantId
        || execution.status !== 'COMPLETED'
        || execution.taskId !== sourceTask?.id
        || !sourceTask
        || sourceTask.reviewResultId !== original.id
        || !sourceHuman
        || sourceHuman.humanDecisionId !== human.id
        || sourceHuman.reviewRequestId !== original.reviewRequestId
        || !evidence
        || evidence.tenantId !== actor.tenantId
        || result.request.evidenceId !== evidence.id
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_RESULT' as const };
      }
      const allowed = decideJuryMutation({
        actor,
        action: 'improvement.write',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      return recordReReviewImprovement(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        resultId: result.id,
        reviewRequestId: result.reviewRequestId,
        decision,
        finalSurface: result.finalSurface,
        originalReviewResultId: original.id,
        originalReviewRequestId: original.reviewRequestId,
        humanDecisionId: human.id,
        sourceTaskId: sourceTask.id,
        executionId: execution.id,
        gateId: gate.id,
        evidenceId: evidence.id,
      });
    });
  } catch (error) {
    if (!isUnique(error)) return { ok: false, reason: 'PERSISTENCE_FAILED' };
    return reloadReReviewImprovement(actor.tenantId, input.reReviewResultId);
  }
}

export async function recordReReviewImprovement(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    userId: string;
    resultId: string;
    reviewRequestId: string;
    decision: JuryDecision;
    finalSurface: unknown;
    originalReviewResultId: string;
    originalReviewRequestId: string;
    humanDecisionId: string;
    sourceTaskId: string;
    executionId: string;
    gateId: string;
    evidenceId: string;
  },
): Promise<
  | {
      ok: true;
      created: boolean;
      outcome: 'NO_IMPROVEMENT' | 'IMPROVEMENT';
      reviewId: string;
      reReviewResultId: string;
      taskId: string | null;
      taskType: 'VERIFICATION' | 'REWORD' | null;
    }
  | { ok: false; reason: 'NOT_REREVIEW_RESULT' | 'PERSISTENCE_FAILED' }
> {
  if (input.decision === 'ACCEPT') {
    return {
      ok: true,
      created: false,
      outcome: 'NO_IMPROVEMENT',
      reviewId: input.originalReviewResultId,
      reReviewResultId: input.resultId,
      taskId: null,
      taskType: null,
    };
  }
  const taskType = humanImprovementTaskType(input.decision);
  const surface = asSurface(input.finalSurface);
  if (!taskType || !surface) return { ok: false, reason: 'NOT_REREVIEW_RESULT' };
  const taskId = reReviewImprovementTaskId(input.tenantId, input.resultId);
  const existing = await tx.juryImprovementTask.findFirst({
    where: { id: taskId, tenantId: input.tenantId, reviewResultId: input.resultId },
    select: { id: true, tenantId: true, taskType: true },
  });
  if (existing) {
    if (existing.tenantId !== input.tenantId || existing.taskType !== taskType) {
      return { ok: false, reason: 'PERSISTENCE_FAILED' };
    }
    return {
      ok: true,
      created: false,
      outcome: 'IMPROVEMENT',
      reviewId: input.originalReviewResultId,
      reReviewResultId: input.resultId,
      taskId: existing.id,
      taskType,
    };
  }
  const diagnosis = safeText(surface.statusSummary || surface.topProblems[0] || input.resultId, input.resultId);
  const criteria = surface.topProblems.map((item) => safeText(item, '')).filter((item) => item.length > 0);
  const acceptanceCriteria = criteria.length > 0 ? criteria : [diagnosis];
  const now = new Date();
  const provenance = {
    kind: REREVIEW_IMPROVEMENT_KIND,
    reReviewReviewRequestId: input.reviewRequestId,
    reReviewReviewResultId: input.resultId,
    originalReviewRequestId: input.originalReviewRequestId,
    originalReviewResultId: input.originalReviewResultId,
    humanDecisionId: input.humanDecisionId,
    sourceImprovementTaskId: input.sourceTaskId,
    improvementTaskId: taskId,
    agentExecutionId: input.executionId,
    changeGateResultId: input.gateId,
    reReviewDecision: input.decision,
    statusSummary: safeText(surface.statusSummary, ''),
    topProblems: acceptanceCriteria,
  };
  await tx.juryImprovementTask.create({
    data: {
      id: taskId,
      tenantId: input.tenantId,
      reviewResultId: input.resultId,
      parentTaskId: input.sourceTaskId,
      diagnosis,
      acceptanceCriteria,
      status: 'OPEN',
      loopIndex: 0,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      evidenceId: input.evidenceId,
      taskType,
      title: taskType === 'VERIFICATION' ? 'Review 결과 추가 검증' : '결과 문구 정리',
      description: acceptanceCriteria.join('\n') || diagnosis,
      reason: safeText(surface.statusSummary, diagnosis) || diagnosis,
      objective: safeText(surface.expectedUserEffect, diagnosis),
      constraints: [...REWORD_CONSTRAINTS],
      provenance,
      createdAt: now,
      updatedAt: now,
    },
  });
  await tx.juryAuditEvent.create({
    data: {
      id: reReviewImprovementAuditId(input.tenantId, taskId),
      tenantId: input.tenantId,
      timestamp: now,
      actor: input.userId,
      action: HUMAN_IMPROVEMENT_AUDIT,
      reviewId: input.resultId,
      decision: input.decision,
      improvementTaskId: taskId,
      agentExecutionId: input.executionId,
      reReviewResultId: input.resultId,
      provenance: {
        kind: REREVIEW_IMPROVEMENT_KIND,
        reReviewReviewRequestId: input.reviewRequestId,
        reReviewReviewResultId: input.resultId,
        originalReviewRequestId: input.originalReviewRequestId,
        originalReviewResultId: input.originalReviewResultId,
        humanDecisionId: input.humanDecisionId,
        improvementTaskId: taskId,
        agentExecutionId: input.executionId,
        changeGateResultId: input.gateId,
        reReviewDecision: input.decision,
      },
    },
  });
  return {
    ok: true,
    created: true,
    outcome: 'IMPROVEMENT',
    reviewId: input.originalReviewResultId,
    reReviewResultId: input.resultId,
    taskId,
    taskType,
  };
}

export async function reloadReReviewImprovement(tenantId: string, reReviewResultId: string): Promise<
  | {
      ok: true;
      created: false;
      outcome: 'IMPROVEMENT';
      reviewId: string;
      reReviewResultId: string;
      taskId: string;
      taskType: 'VERIFICATION' | 'REWORD';
    }
  | { ok: false; reason: 'PERSISTENCE_FAILED' }
> {
  const { prisma } = await import('@/lib/prisma');
  const taskId = reReviewImprovementTaskId(tenantId, reReviewResultId);
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: taskId, tenantId, reviewResultId: reReviewResultId },
    select: { id: true, taskType: true },
  });
  const result = await prisma.juryReviewResult.findFirst({
    where: { id: reReviewResultId, tenantId },
    select: { parentReviewResultId: true },
  });
  if (!task || !result?.parentReviewResultId || (task.taskType !== 'VERIFICATION' && task.taskType !== 'REWORD')) {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
  return {
    ok: true,
    created: false,
    outcome: 'IMPROVEMENT',
    reviewId: result.parentReviewResultId,
    reReviewResultId,
    taskId: task.id,
    taskType: task.taskType,
  };
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function linkedHuman(value: unknown, reviewResultId: string): { humanDecisionId: string; reviewRequestId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== HUMAN_IMPROVEMENT_KIND) return null;
  if (typeof row.humanDecisionId !== 'string' || row.humanDecisionId.length === 0) return null;
  if (typeof row.reviewRequestId !== 'string' || row.reviewRequestId.length === 0) return null;
  if (row.reviewResultId !== reviewResultId) return null;
  return { humanDecisionId: row.humanDecisionId, reviewRequestId: row.reviewRequestId };
}

function asSurface(value: unknown): { statusSummary: string; topProblems: string[]; expectedUserEffect: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.statusSummary !== 'string' || typeof row.expectedUserEffect !== 'string' || !Array.isArray(row.topProblems)) {
    return null;
  }
  if (row.topProblems.some((item) => typeof item !== 'string')) return null;
  return {
    statusSummary: row.statusSummary,
    topProblems: row.topProblems as string[],
    expectedUserEffect: row.expectedUserEffect,
  };
}

function safeText(value: string, fallback: string): string {
  return containsSecret(value) ? fallback : value;
}

function isUnique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}
