/**
 * Reads one tenant review and stores one human decision beside the Jury result.
 * The stored choice does not replace expectedDecision. This module does not create an improvement task.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor, type JuryActor } from './access';
import { containsSecret } from './agent-execution';
import { humanImprovementTaskType, isHumanImprovementProvenance } from './human-improvement-bridge';
import { REREVIEW_IMPROVEMENT_KIND, reReviewImprovementTaskId } from './rereview-improvement-bridge';
import type { JuryDecision, JuryFinalSurface, JuryMembership } from './records';
import { JURY_CORE_CONTRACT_VERSION, JURY_DECISIONS, JURY_REVIEW_STATUSES } from './records';

export const REVIEW_DECISION_MEANING = {
  ACCEPT: '현재 Evidence와 표현 수준에서 추가 조치가 필요하지 않음',
  VERIFY: 'Evidence 또는 측정값에 대한 확인이 필요함',
  REWORD: '표현이 Evidence보다 강하거나 과도할 수 있어 수정이 필요함',
} as const;

export const HUMAN_DECISION_AUDIT = 'HUMAN_DECISION_RECORDED';

export const HUMAN_NEXT_ACTION = {
  ACCEPT: { code: 'ACCEPT', label: '확인 완료' },
  VERIFY: { code: 'VERIFY', label: '검증 필요' },
  REWORD: { code: 'REWORD', label: '수정 필요' },
} as const;

export type ReviewConsoleFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_ACTION'
  | 'DECISION_LOCKED'
  | 'PERSISTENCE_FAILED';

export type ReviewConsoleMetric = {
  id: string;
  metric: string;
  value: number | null;
  availability: string;
  text: string;
};

export type ReviewConsoleScreen = {
  reviewId: string;
  tenantId: string;
  status: string | null;
  completedAt: string;
  decision: JuryDecision;
  decisionMeaning: string;
  summary: string;
  topProblems: string[];
  expectedUserEffect: string;
  risk: string;
  evidenceId: string | null;
  measured: ReviewConsoleMetric[];
  dimensionEvidence: string[];
  supportedClaims: string[];
  partiallySupportedClaims: string[];
  hypotheses: string[];
  humanDecision: JuryDecision | null;
  humanChoices: Array<{ code: JuryDecision; label: string }>;
  improvementTask: { id: string; taskType: 'VERIFICATION' | 'REWORD' } | null;
  canCreateImprovement: boolean;
  agentExecution: {
    id: string;
    status: string;
    agent: string;
    startedAt: string | null;
    finishedAt: string | null;
    summary: string | null;
    changedFiles: string[];
    testsRun: string[];
    testsPassed: boolean | null;
  } | null;
  canHandoff: boolean;
  canRun: boolean;
  changeGate: {
    id: string;
    status: string;
    errorCode: string | null;
    discrepancy: boolean;
    reasons: string[];
  } | null;
  canRunChangeGate: boolean;
  reReview: {
    id: string;
    status: string;
    reviewRequestId: string | null;
    reviewResultId: string | null;
    decision: string | null;
    completedAt: string | null;
  } | null;
  canRunReReview: boolean;
  nextImprovement: { id: string; taskType: 'VERIFICATION' | 'REWORD'; status: string } | null;
  canCreateReReviewImprovement: boolean;
  nextApproval: JuryDecision | null;
  nextAgentExecution: { id: string; status: string; agent: string } | null;
  canApproveReReviewAgent: boolean;
  canHandoffReReviewAgent: boolean;
  canRunReReviewAgent: boolean;
  nextChangeGate: { id: string; status: string; errorCode: string | null } | null;
  canRunReReviewChangeGate: boolean;
  nextSecondReReview: { id: string; status: string } | null;
  canRunSecondReReview: boolean;
  secondReReviewResultId: string | null;
  secondReReviewDecision: JuryDecision | null;
  nextSecondImprovement: { id: string; taskType: 'VERIFICATION' | 'REWORD'; status: string } | null;
  canCreateSecondImprovement: boolean;
  nextSecondApproval: JuryDecision | null;
  canApproveSecondImprovement: boolean;
  nextSecondAgentExecution: { id: string; status: string; agent: string } | null;
  canHandoffSecondImprovement: boolean;
  nextSecondChangeGate: { id: string; status: string; errorCode: string | null } | null;
  canRunSecondChangeGate: boolean;
  nextLaterReReview: { id: string; status: string; reviewResultId: string | null; decision: JuryDecision | null } | null;
  canRunLaterReReview: boolean;
  nextLaterImprovement: { id: string; taskType: 'VERIFICATION' | 'REWORD'; status: string } | null;
  canCreateLaterImprovement: boolean;
  nextLaterApproval: JuryDecision | null;
  canApproveLaterImprovement: boolean;
  nextLaterAgentExecution: { id: string; status: string; agent: string } | null;
  canHandoffLaterImprovement: boolean;
  canRunLaterAgent: boolean;
  nextLaterChangeGate: { id: string; status: string; errorCode: string | null } | null;
  canRunLaterChangeGate: boolean;
  nextFollowingReReview: {
    id: string;
    status: string;
    reviewResultId: string | null;
    decision: JuryDecision | null;
    surface: JuryFinalSurface | null;
  } | null;
  canRunFollowingReReview: boolean;
};

export function formatReviewMetric(value: number | null, availability: string): { value: number | null; text: string } {
  if (availability === 'AVAILABLE' && typeof value === 'number' && Number.isFinite(value)) {
    return { value, text: String(value) };
  }
  return { value: null, text: '측정되지 않음' };
}

export function projectReviewConsole(input: {
  actor: JuryActor;
  result: {
    id: string;
    tenantId: string;
    expectedDecision: JuryDecision;
    finalSurface: JuryFinalSurface;
    completedAt: string;
  };
  status: string | null;
  evidenceId: string | null;
  metrics: readonly { id: string; metric: string; value: number | null; availability: string }[];
  humanDecision?: JuryDecision | null;
  improvementTask?: { id: string; taskType: 'VERIFICATION' | 'REWORD' } | null;
  agentExecution?: {
    id: string;
    status: string;
    agent: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    summary?: string | null;
    changedFiles?: string[];
    testsRun?: string[];
    testsPassed?: boolean | null;
  } | null;
  changeGate?: {
    id: string;
    status: string;
    errorCode?: string | null;
    discrepancy?: boolean;
    reasons?: string[];
  } | null;
  reReview?: {
    id: string;
    status: string;
    reviewRequestId?: string | null;
    reviewResultId?: string | null;
    decision?: string | null;
    completedAt?: string | null;
  } | null;
  nextImprovement?: { id: string; taskType: 'VERIFICATION' | 'REWORD'; status: string } | null;
  nextApproval?: JuryDecision | null;
  nextAgentExecution?: { id: string; status: string; agent: string } | null;
  nextChangeGate?: { id: string; status: string; errorCode?: string | null } | null;
  nextSecondReReview?: { id: string; status: string } | null;
  secondReReviewResultId?: string | null;
  secondReReviewDecision?: JuryDecision | null;
  nextSecondImprovement?: { id: string; taskType: 'VERIFICATION' | 'REWORD'; status: string } | null;
  nextSecondApproval?: JuryDecision | null;
  nextSecondAgentExecution?: { id: string; status: string; agent: string } | null;
  nextSecondChangeGate?: { id: string; status: string; errorCode?: string | null } | null;
  nextLaterReReview?: { id: string; status: string; reviewResultId?: string | null; decision?: JuryDecision | null } | null;
  nextLaterImprovement?: { id: string; taskType: 'VERIFICATION' | 'REWORD'; status: string } | null;
  nextLaterApproval?: JuryDecision | null;
  nextLaterAgentExecution?: { id: string; status: string; agent: string } | null;
  nextLaterChangeGate?: { id: string; status: string; errorCode?: string | null } | null;
  nextFollowingReReview?: {
    id: string;
    status: string;
    reviewResultId?: string | null;
    decision?: JuryDecision | null;
    surface?: JuryFinalSurface | null;
  } | null;
}): { ok: true; screen: ReviewConsoleScreen } | { ok: false; reason: 'NOT_FOUND' } {
  if (!input.actor.ok || input.result.tenantId !== input.actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
  const decision = input.result.expectedDecision;
  const stored = input.humanDecision ?? null;
  const canNote = decideJuryMutation({
    actor: input.actor,
    action: 'review.start',
    resourceTenantId: input.actor.tenantId,
  }).ok;
  const humanChoices = canNote && !stored
    ? JURY_DECISIONS.map((code) => ({ code, label: HUMAN_NEXT_ACTION[code].label }))
    : [];
  const wanted = stored ? humanImprovementTaskType(stored) : null;
  const improvementTask = wanted && input.improvementTask?.taskType === wanted ? input.improvementTask : null;
  const canWriteImprovement = decideJuryMutation({
    actor: input.actor,
    action: 'improvement.write',
    resourceTenantId: input.actor.tenantId,
  }).ok;
  const juryAllowsTask = decision === 'VERIFY' || decision === 'REWORD';
  const canCreateImprovement = Boolean(juryAllowsTask && wanted && !improvementTask && canWriteImprovement);
  const agentExecution = input.agentExecution?.id
    ? {
        id: input.agentExecution.id,
        status: input.agentExecution.status,
        agent: input.agentExecution.agent,
        startedAt: input.agentExecution.startedAt ?? null,
        finishedAt: input.agentExecution.finishedAt ?? null,
        summary: input.agentExecution.summary ?? null,
        changedFiles: input.agentExecution.changedFiles ?? [],
        testsRun: input.agentExecution.testsRun ?? [],
        testsPassed: input.agentExecution.testsPassed ?? null,
      }
    : null;
  const canHandoff = Boolean(wanted && improvementTask && !agentExecution && canWriteImprovement);
  const canRun = Boolean(
    agentExecution?.status === 'PENDING'
    && wanted
    && improvementTask
    && decideJuryMutation({
      actor: input.actor,
      action: 'agent.execute',
      resourceTenantId: input.actor.tenantId,
    }).ok,
  );
  const changeGate = input.changeGate?.id
    ? {
        id: input.changeGate.id,
        status: input.changeGate.status,
        errorCode: input.changeGate.errorCode ?? null,
        discrepancy: input.changeGate.discrepancy === true,
        reasons: input.changeGate.reasons ?? [],
      }
    : null;
  const canRunChangeGate = Boolean(
    agentExecution?.status === 'COMPLETED'
    && !changeGate
    && wanted
    && improvementTask
    && decideJuryMutation({
      actor: input.actor,
      action: 'agent.execute',
      resourceTenantId: input.actor.tenantId,
    }).ok,
  );
  const reReview = input.reReview?.id
    ? {
        id: input.reReview.id,
        status: input.reReview.status,
        reviewRequestId: input.reReview.reviewRequestId ?? null,
        reviewResultId: input.reReview.reviewResultId ?? null,
        decision: input.reReview.decision ?? null,
        completedAt: input.reReview.completedAt ?? null,
      }
    : null;
  const canRunReReview = Boolean(
    agentExecution?.status === 'COMPLETED'
    && changeGate?.status === 'APPROVED'
    && !reReview
    && wanted
    && improvementTask
    && decideJuryMutation({
      actor: input.actor,
      action: 'review.start',
      resourceTenantId: input.actor.tenantId,
    }).ok,
  );
  const nextImprovement = input.nextImprovement?.taskType === 'VERIFICATION' || input.nextImprovement?.taskType === 'REWORD'
    ? input.nextImprovement
    : null;
  const reDecision = reReview?.decision;
  const canCreateReReviewImprovement = Boolean(
    reReview?.status === 'EXECUTED'
    && (reDecision === 'VERIFY' || reDecision === 'REWORD')
    && !nextImprovement
    && canWriteImprovement,
  );
  const nextApproval = input.nextApproval ?? null;
  const nextAgentExecution = input.nextAgentExecution?.id
    ? { id: input.nextAgentExecution.id, status: input.nextAgentExecution.status, agent: input.nextAgentExecution.agent }
    : null;
  const approvalMatches = Boolean(
    nextImprovement
    && nextApproval
    && humanImprovementTaskType(nextApproval) === nextImprovement.taskType,
  );
  const canExecuteAgent = decideJuryMutation({
    actor: input.actor,
    action: 'agent.execute',
    resourceTenantId: input.actor.tenantId,
  }).ok;
  const canApproveReReviewAgent = Boolean(
    nextImprovement
    && !nextApproval
    && (reDecision === 'VERIFY' || reDecision === 'REWORD')
    && canNote,
  );
  const canHandoffReReviewAgent = Boolean(
    approvalMatches
    && !nextAgentExecution
    && canWriteImprovement
    && canExecuteAgent,
  );
  const canRunReReviewAgent = Boolean(
    nextAgentExecution?.status === 'PENDING'
    && nextAgentExecution.agent === 'CURSOR'
    && approvalMatches
    && canExecuteAgent,
  );
  const nextChangeGate = input.nextChangeGate?.id
    ? { id: input.nextChangeGate.id, status: input.nextChangeGate.status, errorCode: input.nextChangeGate.errorCode ?? null }
    : null;
  const canRunReReviewChangeGate = Boolean(
    nextAgentExecution?.status === 'COMPLETED'
    && nextAgentExecution.agent === 'CURSOR'
    && !nextChangeGate
    && approvalMatches
    && canExecuteAgent,
  );
  const nextSecondReReview = input.nextSecondReReview?.id
    ? { id: input.nextSecondReReview.id, status: input.nextSecondReReview.status }
    : null;
  const canRunSecondReReview = Boolean(
    nextAgentExecution?.status === 'COMPLETED'
    && nextChangeGate?.status === 'APPROVED'
    && !nextSecondReReview
    && approvalMatches
    && canNote,
  );
  const secondReReviewResultId = input.secondReReviewResultId ?? null;
  const secondReReviewDecision = input.secondReReviewDecision ?? null;
  const nextSecondImprovement = input.nextSecondImprovement?.taskType === 'VERIFICATION' || input.nextSecondImprovement?.taskType === 'REWORD'
    ? input.nextSecondImprovement
    : null;
  const canCreateSecondImprovement = Boolean(
    nextSecondReReview?.status === 'EXECUTED'
    && secondReReviewResultId
    && (secondReReviewDecision === 'VERIFY' || secondReReviewDecision === 'REWORD')
    && !nextSecondImprovement
    && canWriteImprovement,
  );
  const nextSecondApproval = input.nextSecondApproval ?? null;
  const canApproveSecondImprovement = Boolean(
    nextSecondImprovement?.status === 'OPEN'
    && secondReReviewDecision
    && humanImprovementTaskType(secondReReviewDecision) === nextSecondImprovement.taskType
    && !nextSecondApproval
    && canNote,
  );
  const nextSecondAgentExecution = input.nextSecondAgentExecution?.id
    ? { id: input.nextSecondAgentExecution.id, status: input.nextSecondAgentExecution.status, agent: input.nextSecondAgentExecution.agent }
    : null;
  const secondApprovalMatches = Boolean(
    nextSecondImprovement
    && nextSecondApproval
    && humanImprovementTaskType(nextSecondApproval) === nextSecondImprovement.taskType,
  );
  const canHandoffSecondImprovement = Boolean(
    secondApprovalMatches
    && nextSecondImprovement?.status === 'OPEN'
    && !nextSecondAgentExecution
    && canWriteImprovement
    && canExecuteAgent,
  );
  const nextSecondChangeGate = input.nextSecondChangeGate?.id
    ? { id: input.nextSecondChangeGate.id, status: input.nextSecondChangeGate.status, errorCode: input.nextSecondChangeGate.errorCode ?? null }
    : null;
  const canRunSecondChangeGate = Boolean(
    nextSecondAgentExecution?.status === 'COMPLETED'
    && nextSecondAgentExecution.agent === 'CURSOR'
    && !nextSecondChangeGate
    && secondApprovalMatches
    && canExecuteAgent,
  );
  const nextLaterReReview = input.nextLaterReReview?.id
    ? {
        id: input.nextLaterReReview.id,
        status: input.nextLaterReReview.status,
        reviewResultId: input.nextLaterReReview.reviewResultId ?? null,
        decision: input.nextLaterReReview.decision ?? null,
      }
    : null;
  const canRunLaterReReview = Boolean(
    nextSecondAgentExecution?.status === 'COMPLETED'
    && nextSecondAgentExecution.agent === 'CURSOR'
    && nextSecondChangeGate?.status === 'APPROVED'
    && !nextLaterReReview
    && secondApprovalMatches
    && canNote,
  );
  const nextLaterImprovement = input.nextLaterImprovement?.taskType === 'VERIFICATION' || input.nextLaterImprovement?.taskType === 'REWORD'
    ? input.nextLaterImprovement
    : null;
  const canCreateLaterImprovement = Boolean(
    nextLaterReReview?.status === 'EXECUTED'
    && nextLaterReReview.reviewResultId
    && (nextLaterReReview.decision === 'VERIFY' || nextLaterReReview.decision === 'REWORD')
    && !nextLaterImprovement
    && canWriteImprovement,
  );
  const nextLaterApproval = input.nextLaterApproval ?? null;
  const canApproveLaterImprovement = Boolean(
    nextLaterImprovement?.status === 'OPEN'
    && nextLaterReReview?.decision
    && humanImprovementTaskType(nextLaterReReview.decision) === nextLaterImprovement.taskType
    && !nextLaterApproval
    && canNote,
  );
  const nextLaterAgentExecution = input.nextLaterAgentExecution?.id
    ? { id: input.nextLaterAgentExecution.id, status: input.nextLaterAgentExecution.status, agent: input.nextLaterAgentExecution.agent }
    : null;
  const canHandoffLaterImprovement = Boolean(
    nextLaterImprovement?.status === 'OPEN'
    && nextLaterApproval
    && humanImprovementTaskType(nextLaterApproval) === nextLaterImprovement.taskType
    && !nextLaterAgentExecution
    && canWriteImprovement
    && canExecuteAgent,
  );
  const laterApprovalMatches = Boolean(
    nextLaterImprovement
    && nextLaterApproval
    && humanImprovementTaskType(nextLaterApproval) === nextLaterImprovement.taskType,
  );
  const canRunLaterAgent = Boolean(
    nextLaterAgentExecution?.status === 'PENDING'
    && nextLaterAgentExecution.agent === 'CURSOR'
    && laterApprovalMatches
    && nextLaterImprovement?.status === 'OPEN'
    && canExecuteAgent,
  );
  const nextLaterChangeGate = input.nextLaterChangeGate?.id
    ? { id: input.nextLaterChangeGate.id, status: input.nextLaterChangeGate.status, errorCode: input.nextLaterChangeGate.errorCode ?? null }
    : null;
  const canRunLaterChangeGate = Boolean(
    nextLaterAgentExecution?.status === 'COMPLETED'
    && nextLaterAgentExecution.agent === 'CURSOR'
    && !nextLaterChangeGate
    && laterApprovalMatches
    && canExecuteAgent,
  );
  const nextFollowingReReview = input.nextFollowingReReview?.id
    ? {
        id: input.nextFollowingReReview.id,
        status: input.nextFollowingReReview.status,
        reviewResultId: input.nextFollowingReReview.reviewResultId ?? null,
        decision: input.nextFollowingReReview.decision ?? null,
        surface: input.nextFollowingReReview.surface ?? null,
      }
    : null;
  const canRunFollowingReReview = Boolean(
    nextLaterAgentExecution?.status === 'COMPLETED'
    && nextLaterAgentExecution.agent === 'CURSOR'
    && nextLaterChangeGate?.status === 'APPROVED'
    && !nextFollowingReReview
    && laterApprovalMatches
    && canNote,
  );
  return {
    ok: true,
    screen: {
      reviewId: input.result.id,
      tenantId: input.result.tenantId,
      status: input.status,
      completedAt: input.result.completedAt,
      decision,
      decisionMeaning: REVIEW_DECISION_MEANING[decision],
      summary: input.result.finalSurface.statusSummary,
      topProblems: [...input.result.finalSurface.topProblems],
      expectedUserEffect: input.result.finalSurface.expectedUserEffect,
      risk: input.result.finalSurface.risk,
      evidenceId: input.evidenceId,
      measured: input.metrics.map((metric) => {
        const shown = formatReviewMetric(metric.value, metric.availability);
        return {
          id: metric.id,
          metric: metric.metric,
          value: shown.value,
          availability: metric.availability,
          text: shown.text,
        };
      }),
      dimensionEvidence: [...input.result.finalSurface.dimensionEvidence],
      supportedClaims: [...input.result.finalSurface.supportedClaims],
      partiallySupportedClaims: [...input.result.finalSurface.partiallySupportedClaims],
      hypotheses: [...input.result.finalSurface.hypotheses],
      humanDecision: stored,
      humanChoices,
      improvementTask,
      canCreateImprovement,
      agentExecution,
      canHandoff,
      canRun,
      changeGate,
      canRunChangeGate,
      reReview,
      canRunReReview,
      nextImprovement,
      canCreateReReviewImprovement,
      nextApproval,
      nextAgentExecution,
      canApproveReReviewAgent,
      canHandoffReReviewAgent,
      canRunReReviewAgent,
      nextChangeGate,
      canRunReReviewChangeGate,
      nextSecondReReview,
      canRunSecondReReview,
      secondReReviewResultId,
      secondReReviewDecision,
      nextSecondImprovement,
      canCreateSecondImprovement,
      nextSecondApproval,
      canApproveSecondImprovement,
      nextSecondAgentExecution,
      canHandoffSecondImprovement,
      nextSecondChangeGate,
      canRunSecondChangeGate,
      nextLaterReReview,
      canRunLaterReReview,
      nextLaterImprovement,
      canCreateLaterImprovement,
      nextLaterApproval,
      canApproveLaterImprovement,
      nextLaterAgentExecution,
      canHandoffLaterImprovement,
      canRunLaterAgent,
      nextLaterChangeGate,
      canRunLaterChangeGate,
      nextFollowingReReview,
      canRunFollowingReReview,
    },
  };
}

export function planHumanNextAction(input: {
  actor: JuryActor;
  review: { id: string; tenantId: string; expectedDecision: JuryDecision } | null;
  action: string;
}): { ok: true; persisted: false; reviewId: string; action: string } | { ok: false; reason: ReviewConsoleFailure } {
  if (!input.actor.ok) return { ok: false, reason: input.actor.reason };
  if (!input.review || input.review.tenantId !== input.actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({
    actor: input.actor,
    action: 'review.start',
    resourceTenantId: input.actor.tenantId,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN' };
  const human = oneOf(JURY_DECISIONS, input.action);
  if (!human) return { ok: false, reason: 'INVALID_ACTION' };
  return { ok: true, persisted: false, reviewId: input.review.id, action: human };
}

export async function loadReviewConsole(
  actor: JuryActor,
  reviewId: string,
): Promise<{ ok: true; screen: ReviewConsoleScreen } | { ok: false; reason: 'NOT_FOUND' }> {
  if (!actor.ok || !reviewId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const { prisma } = await import('@/lib/prisma');
  const row = await prisma.juryReviewResult.findFirst({
    where: { id: reviewId, tenantId: actor.tenantId },
    select: {
      id: true,
      tenantId: true,
      expectedDecision: true,
      finalSurface: true,
      completedAt: true,
      contractVersion: true,
      humanDecision: {
        select: { tenantId: true, decision: true },
      },
      tasks: {
        select: {
          id: true,
          tenantId: true,
          taskType: true,
          provenance: true,
          executions: {
            select: {
              id: true,
              tenantId: true,
              status: true,
              agent: true,
              startedAt: true,
              finishedAt: true,
              provenance: true,
              gate: {
                select: {
                  id: true,
                  tenantId: true,
                  status: true,
                  errorCode: true,
                  discrepancy: true,
                  discrepancyReasons: true,
                  riskReasons: true,
                  changeGateReview: {
                    select: {
                      id: true,
                      tenantId: true,
                      status: true,
                      reviewRequestId: true,
                      reviewResultId: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      request: {
        select: {
          tenantId: true,
          status: true,
          evidence: {
            select: {
              id: true,
              tenantId: true,
              metrics: {
                select: { id: true, tenantId: true, metric: true, value: true, availability: true },
              },
            },
          },
        },
      },
    },
  });
  if (!row || row.tenantId !== actor.tenantId || row.contractVersion !== JURY_CORE_CONTRACT_VERSION) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  const decision = oneOf(JURY_DECISIONS, row.expectedDecision);
  const surface = asSurface(row.finalSurface);
  if (!decision || !surface) return { ok: false, reason: 'NOT_FOUND' };
  const request = row.request?.tenantId === actor.tenantId ? row.request : null;
  const evidence = request?.evidence?.tenantId === actor.tenantId ? request.evidence : null;
  const status = request ? oneOf(JURY_REVIEW_STATUSES, request.status) : null;
  const stored = row.humanDecision?.tenantId === actor.tenantId
    ? oneOf(JURY_DECISIONS, row.humanDecision.decision)
    : null;
  const linked = stored ? humanReReviewOnReview(row.tasks, actor.tenantId, stored) : null;
  const child = linked?.reviewResultId
    ? await prisma.juryReviewResult.findFirst({
        where: { id: linked.reviewResultId, tenantId: actor.tenantId },
        select: { expectedDecision: true, completedAt: true },
      })
    : null;
  const nextRow = linked?.reviewResultId
    ? await prisma.juryImprovementTask.findFirst({
        where: {
          id: reReviewImprovementTaskId(actor.tenantId, linked.reviewResultId),
          tenantId: actor.tenantId,
          reviewResultId: linked.reviewResultId,
        },
        select: { id: true, taskType: true, status: true, provenance: true },
      })
    : null;
  const nextKind = nextRow?.provenance && typeof nextRow.provenance === 'object' && !Array.isArray(nextRow.provenance)
    ? (nextRow.provenance as { kind?: unknown }).kind
    : null;
  const nextImprovement = nextRow && nextKind === REREVIEW_IMPROVEMENT_KIND && (nextRow.taskType === 'VERIFICATION' || nextRow.taskType === 'REWORD')
    ? { id: nextRow.id, taskType: nextRow.taskType, status: nextRow.status }
    : null;
  const nextHuman = linked?.reviewResultId
    ? await prisma.juryHumanDecision.findFirst({
        where: { tenantId: actor.tenantId, reviewResultId: linked.reviewResultId },
        select: { decision: true, reviewRequestId: true },
      })
    : null;
  const nextApproval = nextHuman && linked?.reviewRequestId === nextHuman.reviewRequestId
    ? oneOf(JURY_DECISIONS, nextHuman.decision)
    : null;
  const nextExecution = nextImprovement
    ? await prisma.juryAgentExecution.findFirst({
        where: { tenantId: actor.tenantId, taskId: nextImprovement.id, agent: 'CURSOR' },
        select: {
          id: true,
          status: true,
          agent: true,
          gate: {
            select: {
              id: true,
              tenantId: true,
              status: true,
              errorCode: true,
              changeGateReview: { select: { id: true, tenantId: true, status: true, reviewResultId: true } },
            },
          },
        },
      })
    : null;
  const secondReview = nextExecution?.gate?.changeGateReview?.tenantId === actor.tenantId
    ? nextExecution.gate.changeGateReview
    : null;
  const secondResult = secondReview?.reviewResultId
    ? await prisma.juryReviewResult.findFirst({
        where: { id: secondReview.reviewResultId, tenantId: actor.tenantId },
        select: { id: true, expectedDecision: true, reviewRequestId: true },
      })
    : null;
  const secondDecision = secondResult ? oneOf(JURY_DECISIONS, secondResult.expectedDecision) : null;
  const secondTaskRow = secondResult
    ? await prisma.juryImprovementTask.findFirst({
        where: {
          id: reReviewImprovementTaskId(actor.tenantId, secondResult.id),
          tenantId: actor.tenantId,
          reviewResultId: secondResult.id,
        },
        select: { id: true, taskType: true, status: true, provenance: true },
      })
    : null;
  const secondTaskKind = secondTaskRow?.provenance && typeof secondTaskRow.provenance === 'object' && !Array.isArray(secondTaskRow.provenance)
    ? (secondTaskRow.provenance as { kind?: unknown }).kind
    : null;
  const nextSecondImprovement = secondTaskRow
    && secondTaskKind === REREVIEW_IMPROVEMENT_KIND
    && (secondTaskRow.taskType === 'VERIFICATION' || secondTaskRow.taskType === 'REWORD')
    ? { id: secondTaskRow.id, taskType: secondTaskRow.taskType, status: secondTaskRow.status }
    : null;
  const secondHuman = secondResult
    ? await prisma.juryHumanDecision.findFirst({
        where: { tenantId: actor.tenantId, reviewResultId: secondResult.id },
        select: { decision: true, reviewRequestId: true },
      })
    : null;
  const nextSecondApproval = secondHuman && secondHuman.reviewRequestId === secondResult?.reviewRequestId
    ? oneOf(JURY_DECISIONS, secondHuman.decision)
    : null;
  const secondExecution = nextSecondImprovement
    ? await prisma.juryAgentExecution.findFirst({
        where: { tenantId: actor.tenantId, taskId: nextSecondImprovement.id, agent: 'CURSOR' },
        select: { id: true, status: true, agent: true },
      })
    : null;
  const secondGate = secondExecution
    ? await prisma.juryChangeGateResult.findFirst({
        where: { tenantId: actor.tenantId, executionId: secondExecution.id },
        select: {
          id: true,
          tenantId: true,
          status: true,
          errorCode: true,
          changeGateReview: { select: { id: true, tenantId: true, status: true, reviewResultId: true } },
        },
      })
    : null;
  const laterReview = secondGate?.changeGateReview?.tenantId === actor.tenantId ? secondGate.changeGateReview : null;
  const laterResult = laterReview?.reviewResultId
    ? await prisma.juryReviewResult.findFirst({
        where: { id: laterReview.reviewResultId, tenantId: actor.tenantId },
        select: { expectedDecision: true, reviewRequestId: true },
      })
    : null;
  const laterHuman = laterReview?.reviewResultId
    ? await prisma.juryHumanDecision.findFirst({
        where: { tenantId: actor.tenantId, reviewResultId: laterReview.reviewResultId },
        select: { decision: true, reviewRequestId: true },
      })
    : null;
  const nextLaterApproval = laterHuman && laterHuman.reviewRequestId === laterResult?.reviewRequestId
    ? oneOf(JURY_DECISIONS, laterHuman.decision)
    : null;
  const laterTaskRow = laterReview?.reviewResultId
    ? await prisma.juryImprovementTask.findFirst({
        where: {
          id: reReviewImprovementTaskId(actor.tenantId, laterReview.reviewResultId),
          tenantId: actor.tenantId,
          reviewResultId: laterReview.reviewResultId,
        },
        select: { id: true, taskType: true, status: true, provenance: true },
      })
    : null;
  const laterTaskKind = laterTaskRow?.provenance && typeof laterTaskRow.provenance === 'object' && !Array.isArray(laterTaskRow.provenance)
    ? (laterTaskRow.provenance as { kind?: unknown }).kind
    : null;
  const nextLaterImprovement = laterTaskRow
    && laterTaskKind === REREVIEW_IMPROVEMENT_KIND
    && (laterTaskRow.taskType === 'VERIFICATION' || laterTaskRow.taskType === 'REWORD')
    ? { id: laterTaskRow.id, taskType: laterTaskRow.taskType, status: laterTaskRow.status }
    : null;
  const laterExecution = nextLaterImprovement
    ? await prisma.juryAgentExecution.findFirst({
        where: { tenantId: actor.tenantId, taskId: nextLaterImprovement.id, agent: 'CURSOR' },
        select: { id: true, status: true, agent: true },
      })
    : null;
  const laterGate = laterExecution
    ? await prisma.juryChangeGateResult.findFirst({
        where: { tenantId: actor.tenantId, executionId: laterExecution.id },
        select: { id: true, status: true, errorCode: true },
      })
    : null;
  const followingReview = laterGate
    ? await prisma.juryChangeGateReview.findFirst({
        where: { tenantId: actor.tenantId, changeGateResultId: laterGate.id },
        select: { id: true, status: true, reviewResultId: true },
      })
    : null;
  const followingResult = followingReview?.reviewResultId
    ? await prisma.juryReviewResult.findFirst({
        where: { id: followingReview.reviewResultId, tenantId: actor.tenantId },
        select: { expectedDecision: true, finalSurface: true },
      })
    : null;
  const followingSurface = followingResult ? asSurface(followingResult.finalSurface) : null;
  const followingDecision = followingResult ? oneOf(JURY_DECISIONS, followingResult.expectedDecision) : null;
  return projectReviewConsole({
    actor,
    result: {
      id: row.id,
      tenantId: row.tenantId,
      expectedDecision: decision,
      finalSurface: surface,
      completedAt: row.completedAt.toISOString(),
    },
    status,
    evidenceId: evidence?.id ?? null,
    humanDecision: stored,
    improvementTask: stored ? humanImprovementOnReview(row.tasks, actor.tenantId, stored) : null,
    agentExecution: stored ? humanAgentOnReview(row.tasks, actor.tenantId, stored) : null,
    changeGate: stored ? humanGateOnReview(row.tasks, actor.tenantId, stored) : null,
    reReview: linked
      ? {
          id: linked.id,
          status: linked.status,
          reviewRequestId: linked.reviewRequestId,
          reviewResultId: linked.reviewResultId,
          decision: child ? oneOf(JURY_DECISIONS, child.expectedDecision) : null,
          completedAt: child?.completedAt.toISOString() ?? null,
        }
      : null,
    nextImprovement,
    nextApproval,
    nextAgentExecution: nextExecution
      ? { id: nextExecution.id, status: nextExecution.status, agent: nextExecution.agent }
      : null,
    nextChangeGate: nextExecution?.gate?.tenantId === actor.tenantId && nextExecution.gate.status
      ? { id: nextExecution.gate.id, status: nextExecution.gate.status, errorCode: nextExecution.gate.errorCode }
      : null,
    nextSecondReReview: secondReview
      ? { id: secondReview.id, status: secondReview.status }
      : null,
    secondReReviewResultId: secondResult?.id ?? null,
    secondReReviewDecision: secondDecision,
    nextSecondImprovement,
    nextSecondApproval,
    nextSecondAgentExecution: secondExecution
      ? { id: secondExecution.id, status: secondExecution.status, agent: secondExecution.agent }
      : null,
    nextSecondChangeGate: secondGate?.tenantId === actor.tenantId && secondGate.status
      ? { id: secondGate.id, status: secondGate.status, errorCode: secondGate.errorCode }
      : null,
    nextLaterReReview: laterReview
      ? {
          id: laterReview.id,
          status: laterReview.status,
          reviewResultId: laterReview.reviewResultId,
          decision: laterResult ? oneOf(JURY_DECISIONS, laterResult.expectedDecision) : null,
        }
      : null,
    nextLaterImprovement,
    nextLaterApproval,
    nextLaterAgentExecution: laterExecution
      ? { id: laterExecution.id, status: laterExecution.status, agent: laterExecution.agent }
      : null,
    nextLaterChangeGate: laterGate?.status
      ? { id: laterGate.id, status: laterGate.status, errorCode: laterGate.errorCode }
      : null,
    nextFollowingReReview: followingReview
      ? {
          id: followingReview.id,
          status: followingReview.status,
          reviewResultId: followingReview.reviewResultId,
          decision: followingDecision,
          surface: followingSurface,
        }
      : null,
    metrics: (evidence?.metrics ?? []).flatMap((metric) => {
      if (metric.tenantId !== actor.tenantId) return [];
      return [{ id: metric.id, metric: metric.metric, value: metric.value, availability: metric.availability }];
    }),
  });
}

export function humanDecisionAuditId(tenantId: string, reviewResultId: string): string {
  return sha([tenantId, HUMAN_DECISION_AUDIT, reviewResultId]);
}

export async function noteHumanNextAction(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  reviewId: string;
  action: string;
}): Promise<
  | { ok: true; persisted: true; created: boolean; reviewId: string; juryDecision: JuryDecision; humanDecision: JuryDecision }
  | { ok: false; reason: ReviewConsoleFailure }
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
          request: { select: { id: true, tenantId: true } },
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
      const juryDecision = oneOf(JURY_DECISIONS, review.expectedDecision);
      if (!juryDecision) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const allowed = decideJuryMutation({
        actor,
        action: 'review.start',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      const humanDecision = oneOf(JURY_DECISIONS, input.action);
      if (!humanDecision) return { ok: false as const, reason: 'INVALID_ACTION' as const };
      const existing = await tx.juryHumanDecision.findFirst({
        where: { tenantId: actor.tenantId, reviewResultId: review.id },
        select: { id: true, tenantId: true, decision: true },
      });
      if (existing) {
        if (existing.tenantId !== actor.tenantId) return { ok: false as const, reason: 'NOT_FOUND' as const };
        if (existing.decision !== humanDecision) return { ok: false as const, reason: 'DECISION_LOCKED' as const };
        return {
          ok: true as const,
          persisted: true as const,
          created: false,
          reviewId: review.id,
          juryDecision,
          humanDecision,
        };
      }
      const now = new Date();
      await tx.juryHumanDecision.create({
        data: {
          id: sha([actor.tenantId, review.id, 'human-decision']),
          tenantId: actor.tenantId,
          reviewResultId: review.id,
          reviewRequestId: review.reviewRequestId,
          decision: humanDecision,
          actorUserId: actor.userId,
          createdAt: now,
        },
      });
      await tx.juryAuditEvent.create({
        data: {
          id: humanDecisionAuditId(actor.tenantId, review.id),
          tenantId: actor.tenantId,
          timestamp: now,
          actor: actor.userId,
          action: HUMAN_DECISION_AUDIT,
          reviewId: review.id,
          decision: humanDecision,
          provenance: {
            kind: 'human-decision',
            reviewRequestId: review.reviewRequestId,
            reviewResultId: review.id,
            juryDecision,
            humanDecision,
          },
        },
      });
      return {
        ok: true as const,
        persisted: true as const,
        created: true,
        reviewId: review.id,
        juryDecision,
        humanDecision,
      };
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

type ConsoleTask = {
  id: string;
  tenantId: string;
  taskType: string | null;
  provenance: unknown;
  executions?: readonly {
    id: string;
    tenantId: string;
    status: string;
    agent: string;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    provenance?: unknown;
    gate?: {
      id: string;
      tenantId: string;
      status: string | null;
      errorCode: string | null;
      discrepancy: boolean | null;
      discrepancyReasons: unknown;
      riskReasons: unknown;
      changeGateReview?: {
        id: string;
        tenantId: string;
        status: string;
        reviewRequestId: string | null;
        reviewResultId: string | null;
      } | null;
    } | null;
  }[];
};

function humanImprovementOnReview(
  tasks: readonly ConsoleTask[],
  tenantId: string,
  humanDecision: JuryDecision,
): { id: string; taskType: 'VERIFICATION' | 'REWORD' } | null {
  const task = matchingHumanTask(tasks, tenantId, humanDecision);
  if (!task || (task.taskType !== 'VERIFICATION' && task.taskType !== 'REWORD')) return null;
  return { id: task.id, taskType: task.taskType };
}

function humanAgentOnReview(
  tasks: readonly ConsoleTask[],
  tenantId: string,
  humanDecision: JuryDecision,
): ReviewConsoleScreen['agentExecution'] {
  const task = matchingHumanTask(tasks, tenantId, humanDecision);
  const execution = task?.executions?.find((item) => item.tenantId === tenantId && item.agent === 'CURSOR');
  if (!execution) return null;
  const result = executionResult(execution.provenance);
  return {
    id: execution.id,
    status: execution.status,
    agent: execution.agent,
    startedAt: execution.startedAt?.toISOString() ?? null,
    finishedAt: execution.finishedAt?.toISOString() ?? null,
    summary: result.summary,
    changedFiles: result.changedFiles,
    testsRun: result.testsRun,
    testsPassed: result.testsPassed,
  };
}

function humanReReviewOnReview(
  tasks: readonly ConsoleTask[],
  tenantId: string,
  humanDecision: JuryDecision,
): { id: string; status: string; reviewRequestId: string | null; reviewResultId: string | null } | null {
  const task = matchingHumanTask(tasks, tenantId, humanDecision);
  const review = task?.executions?.find((item) => item.tenantId === tenantId && item.agent === 'CURSOR')?.gate?.changeGateReview;
  if (!review || review.tenantId !== tenantId) return null;
  return {
    id: review.id,
    status: review.status,
    reviewRequestId: review.reviewRequestId,
    reviewResultId: review.reviewResultId,
  };
}

function humanGateOnReview(
  tasks: readonly ConsoleTask[],
  tenantId: string,
  humanDecision: JuryDecision,
): ReviewConsoleScreen['changeGate'] {
  const task = matchingHumanTask(tasks, tenantId, humanDecision);
  const gate = task?.executions?.find((item) => item.tenantId === tenantId && item.agent === 'CURSOR')?.gate;
  if (!gate || gate.tenantId !== tenantId || !gate.status) return null;
  const reasons = [...stringItems(gate.discrepancyReasons), ...stringItems(gate.riskReasons)];
  return {
    id: gate.id,
    status: gate.status,
    errorCode: gate.errorCode,
    discrepancy: gate.discrepancy === true,
    reasons: [...new Set(reasons)],
  };
}

function stringItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function executionResult(provenance: unknown): {
  summary: string | null;
  changedFiles: string[];
  testsRun: string[];
  testsPassed: boolean | null;
} {
  const empty = { summary: null, changedFiles: [], testsRun: [], testsPassed: null };
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return empty;
  const result = (provenance as { result?: unknown }).result;
  if (!result || typeof result !== 'object' || Array.isArray(result) || containsSecret(result)) return empty;
  const row = result as { summary?: unknown; changedFiles?: unknown; testsRun?: unknown; testsPassed?: unknown };
  const changedFiles = Array.isArray(row.changedFiles) ? row.changedFiles.filter((item): item is string => typeof item === 'string') : [];
  const testsRun = Array.isArray(row.testsRun) ? row.testsRun.filter((item): item is string => typeof item === 'string') : [];
  return {
    summary: typeof row.summary === 'string' ? row.summary : null,
    changedFiles,
    testsRun,
    testsPassed: typeof row.testsPassed === 'boolean' ? row.testsPassed : null,
  };
}

function matchingHumanTask(
  tasks: readonly ConsoleTask[],
  tenantId: string,
  humanDecision: JuryDecision,
): ConsoleTask | null {
  const wanted = humanImprovementTaskType(humanDecision);
  return tasks.find((item) =>
    item.tenantId === tenantId && item.taskType === wanted && isHumanImprovementProvenance(item.provenance),
  ) ?? null;
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function asSurface(value: unknown): JuryFinalSurface | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const lists = ['topProblems', 'dimensionEvidence', 'supportedClaims', 'partiallySupportedClaims', 'hypotheses'] as const;
  const parsed: Partial<Record<(typeof lists)[number], string[]>> = {};
  for (const key of lists) {
    const items = asStrings(row[key]);
    if (!items) return null;
    parsed[key] = items;
  }
  if (typeof row.statusSummary !== 'string' || typeof row.expectedUserEffect !== 'string' || typeof row.risk !== 'string') {
    return null;
  }
  return {
    statusSummary: row.statusSummary,
    expectedUserEffect: row.expectedUserEffect,
    risk: row.risk,
    topProblems: parsed.topProblems!,
    dimensionEvidence: parsed.dimensionEvidence!,
    supportedClaims: parsed.supportedClaims!,
    partiallySupportedClaims: parsed.partiallySupportedClaims!,
    hypotheses: parsed.hypotheses!,
  };
}

function asStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value;
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}
