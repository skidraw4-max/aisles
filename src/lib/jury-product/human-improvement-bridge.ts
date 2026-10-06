/**
 * Creates one ImprovementTask from a stored JuryHumanDecision.
 * ACCEPT stops. VERIFY and REWORD stop after the task. No agent, gate, or loop.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { REWORD_CONSTRAINTS } from './improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';

export const HUMAN_IMPROVEMENT_KIND = 'human-decision-improvement';
export const HUMAN_IMPROVEMENT_AUDIT = 'IMPROVEMENT_TASK_CREATED';

export type HumanImprovementFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'HUMAN_DECISION_REQUIRED'
  | 'REVIEW_NOT_COMPLETED'
  | 'PERSISTENCE_FAILED';

export function humanImprovementTaskType(decision: JuryDecision): 'VERIFICATION' | 'REWORD' | null {
  if (decision === 'VERIFY') return 'VERIFICATION';
  if (decision === 'REWORD') return 'REWORD';
  return null;
}

export function humanImprovementTaskId(tenantId: string, reviewResultId: string, humanDecisionId: string): string {
  return sha([tenantId, reviewResultId, humanDecisionId, 'human-improvement']);
}

export function humanImprovementAuditId(tenantId: string, taskId: string): string {
  return sha([tenantId, HUMAN_IMPROVEMENT_AUDIT, taskId]);
}

export function isHumanImprovementProvenance(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as { kind?: unknown }).kind === HUMAN_IMPROVEMENT_KIND);
}

export async function persistHumanImprovement(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  reviewId: string;
}): Promise<
  | {
      ok: true;
      created: boolean;
      reviewId: string;
      juryDecision: JuryDecision;
      humanDecision: JuryDecision;
      taskId: string | null;
      taskType: 'VERIFICATION' | 'REWORD' | null;
    }
  | { ok: false; reason: HumanImprovementFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.reviewId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  try {
    const { prisma } = await import('@/lib/prisma');
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryReviewResult" WHERE id = ${input.reviewId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const review = await tx.juryReviewResult.findFirst({
        where: { id: input.reviewId, tenantId: actor.tenantId },
        select: {
          id: true,
          tenantId: true,
          reviewRequestId: true,
          expectedDecision: true,
          finalSurface: true,
          request: {
            select: {
              id: true,
              tenantId: true,
              status: true,
              evidence: { select: { id: true, tenantId: true } },
            },
          },
          humanDecision: {
            select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true, decision: true },
          },
        },
      });
      if (
        !review
        || review.tenantId !== actor.tenantId
        || review.request?.tenantId !== actor.tenantId
        || review.request.id !== review.reviewRequestId
      ) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      const human = review.humanDecision;
      if (!human) return { ok: false as const, reason: 'HUMAN_DECISION_REQUIRED' as const };
      const juryDecision = oneOf(JURY_DECISIONS, review.expectedDecision);
      const humanDecision = oneOf(JURY_DECISIONS, human.decision);
      if (
        !juryDecision
        || !humanDecision
        || human.tenantId !== actor.tenantId
        || human.reviewResultId !== review.id
        || human.reviewRequestId !== review.reviewRequestId
      ) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      const allowed = decideJuryMutation({
        actor,
        action: 'improvement.write',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      if (review.request.status !== 'COMPLETED') return { ok: false as const, reason: 'REVIEW_NOT_COMPLETED' as const };
      if (juryDecision === 'ACCEPT' || humanDecision === 'ACCEPT') {
        return {
          ok: true as const,
          created: false,
          reviewId: review.id,
          juryDecision,
          humanDecision,
          taskId: null,
          taskType: null,
        };
      }
      const taskType = humanImprovementTaskType(humanDecision);
      const surface = asSurface(review.finalSurface);
      if (!taskType || !surface) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const taskId = humanImprovementTaskId(actor.tenantId, review.id, human.id);
      const existing = await tx.juryImprovementTask.findFirst({
        where: { id: taskId, tenantId: actor.tenantId, reviewResultId: review.id },
        select: { id: true, tenantId: true, taskType: true },
      });
      if (existing) {
        if (existing.tenantId !== actor.tenantId || existing.taskType !== taskType) {
          return { ok: false as const, reason: 'NOT_FOUND' as const };
        }
        return {
          ok: true as const,
          created: false,
          reviewId: review.id,
          juryDecision,
          humanDecision,
          taskId: existing.id,
          taskType,
        };
      }
      const evidence = review.request.evidence?.tenantId === actor.tenantId ? review.request.evidence : null;
      const diagnosis = surface.statusSummary || surface.topProblems[0] || review.id;
      const now = new Date();
      await tx.juryImprovementTask.create({
        data: {
          id: taskId,
          tenantId: actor.tenantId,
          reviewResultId: review.id,
          diagnosis,
          acceptanceCriteria: surface.topProblems.length > 0 ? surface.topProblems : [diagnosis],
          status: 'OPEN',
          loopIndex: 0,
          loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
          evidenceId: evidence?.id ?? null,
          taskType,
          title: taskType === 'VERIFICATION' ? 'Review 결과 추가 검증' : '결과 문구 정리',
          description: surface.topProblems.join('\n') || diagnosis,
          reason: surface.statusSummary || diagnosis,
          objective: surface.expectedUserEffect,
          constraints: [...REWORD_CONSTRAINTS],
          provenance: {
            kind: HUMAN_IMPROVEMENT_KIND,
            reviewRequestId: review.reviewRequestId,
            reviewResultId: review.id,
            humanDecisionId: human.id,
            juryDecision,
            humanDecision,
            statusSummary: surface.statusSummary,
            topProblems: surface.topProblems,
          },
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.juryAuditEvent.create({
        data: {
          id: humanImprovementAuditId(actor.tenantId, taskId),
          tenantId: actor.tenantId,
          timestamp: now,
          actor: actor.userId,
          action: HUMAN_IMPROVEMENT_AUDIT,
          reviewId: review.id,
          decision: humanDecision,
          improvementTaskId: taskId,
          provenance: {
            kind: HUMAN_IMPROVEMENT_KIND,
            reviewRequestId: review.reviewRequestId,
            reviewResultId: review.id,
            humanDecisionId: human.id,
            improvementTaskId: taskId,
            juryDecision,
            humanDecision,
          },
        },
      });
      return {
        ok: true as const,
        created: true,
        reviewId: review.id,
        juryDecision,
        humanDecision,
        taskId,
        taskType,
      };
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
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
