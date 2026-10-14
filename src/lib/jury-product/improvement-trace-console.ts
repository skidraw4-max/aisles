/**
 * Projects a stored improvement trace into console text.
 * It does not read the database or start a review.
 */
import type { JuryActor } from './access';
import { containsSecret } from './agent-execution';
import type { ImprovementTrace, ImprovementTraceFailure } from './improvement-trace';
import type { JuryMembership } from './records';

export type TraceScreenLine = { label: string; value: string };

export type TraceScreenStep = {
  key: string;
  title: string;
  status: string;
  lines: TraceScreenLine[];
};

export type ImprovementTraceScreen = {
  summary: TraceScreenLine[];
  objective: string | null;
  constraints: string[];
  timeline: TraceScreenStep[];
};

export function projectImprovementTrace(trace: ImprovementTrace): ImprovementTraceScreen {
  const task = trace.improvementTask;
  const summary = lines([
    ['ImprovementTask', task?.id ?? null],
    ['taskType', task?.taskType ?? null],
    ['decision', trace.decisionTask?.decision ?? null],
    ['status', task?.status ?? null],
    ['outcome', trace.outcome],
    ['createdAt', task?.createdAt ?? null],
    ['updatedAt', task?.updatedAt ?? null],
  ]);
  return {
    summary,
    objective: show(task?.objective ?? null),
    constraints: task?.constraints.map((item) => show(item)).filter((item): item is string => item !== null) ?? [],
    timeline: timeline(trace),
  };
}

export function traceReadHttpStatus(reason: ImprovementTraceFailure | 'OK'): number {
  if (reason === 'OK') return 200;
  if (reason === 'UNAUTHENTICATED') return 401;
  if (reason === 'STORE_UNAVAILABLE') return 503;
  if (reason === 'TENANT_MISMATCH' || reason === 'NOT_FOUND' || reason === 'AMBIGUOUS' || reason === 'REVIEW_LINEAGE_CYCLE') return 404;
  return 403;
}

export function improvementTraceQuery(
  actor: JuryActor,
  improvementTaskId: string,
  clientTenantId?: string | null,
):
  | { ok: false; reason: ImprovementTraceFailure }
  | {
      ok: true;
      input: {
        userId: string;
        memberships: JuryMembership[];
        clientTenantId: null;
        improvementTaskId: string;
      };
    } {
  void clientTenantId;
  if (!actor.ok) return { ok: false, reason: actor.reason };
  return {
    ok: true,
    input: {
      userId: actor.userId,
      memberships: [
        {
          id: actor.membershipId,
          tenantId: actor.tenantId,
          userId: actor.userId,
          role: actor.role,
          createdAt: '1970-01-01T00:00:00.000Z',
        },
      ],
      clientTenantId: null,
      improvementTaskId,
    },
  };
}

function timeline(trace: ImprovementTrace): TraceScreenStep[] {
  const steps: TraceScreenStep[] = [];
  const task = trace.improvementTask;
  if (task) {
    steps.push(step('task', 'ImprovementTask', task.status, [
      ['id', task.id],
      ['taskType', task.taskType],
      ['status', task.status],
      ['sourceDecision', task.provenance.sourceDecision],
      ['reviewResultId', task.provenance.reviewResultId],
      ['workspace', task.provenance.workspaceRef ? `${task.provenance.workspaceRef.type}:${task.provenance.workspaceRef.ref}` : null],
    ]));
  }
  trace.agentExecutions.forEach((execution, index) => {
    steps.push(step(`agent-${execution.id}-${index}`, 'AgentExecution', execution.status, [
      ['id', execution.id],
      ['agent', execution.agent],
      ['status', execution.status],
      ['requestedAt', execution.requestedAt],
      ['startedAt', execution.startedAt],
      ['finishedAt', execution.finishedAt],
      ['workspace', execution.workspaceRef ? `${execution.workspaceRef.type}:${execution.workspaceRef.ref}` : null],
      ['errorCode', execution.errorCode],
    ]));
  });
  trace.scopeChecks.forEach((check, index) => {
    if (check.result.status === 'NOT_AVAILABLE') return;
    steps.push(step(`scope-${check.executionId}-${index}`, 'Scope Check', check.result.status, [
      ['status', check.result.status],
      ['code', check.result.code],
      ['reason', check.result.reason],
    ]));
  });
  trace.intentChecks.forEach((check, index) => {
    if (check.result.status === 'NOT_AVAILABLE') return;
    steps.push(step(`intent-${check.executionId}-${index}`, 'Intent Check', check.result.status, [
      ['status', check.result.status],
      ['code', check.result.code],
      ['reason', check.result.reason],
    ]));
  });
  trace.changeGates.forEach((gate, index) => {
    steps.push(step(`gate-${gate.id}-${index}`, 'Change Gate', gate.status ?? 'UNKNOWN', [
      ['id', gate.id],
      ['status', gate.status],
      ['risk', gate.risk],
      ['changedFiles', gate.changedFiles.join(', ')],
      ['agentReportedFiles', gate.agentReportedFiles.join(', ')],
      ['discrepancy', gate.discrepancy === null ? null : String(gate.discrepancy)],
      ['reason', gate.reason],
    ]));
  });
  for (const [index, review] of trace.rereviews.entries()) {
    if (review.source !== 'CHANGE_GATE') continue;
    steps.push(step(`gate-review-${review.request.id}-${index}`, 'Change Gate Review', review.request.status, [
      ['id', review.request.id],
      ['status', review.request.status],
      ['reviewRequestId', review.request.reviewRequestId],
      ['createdAt', review.request.createdAt],
      ['updatedAt', review.request.updatedAt],
    ]));
    if (review.reviewResult) {
      steps.push(step(`rereview-${review.request.id}-${index}`, 'Re-review', review.reviewResult.decision, [
        ['source', 'CHANGE_GATE'],
        ['Decision', review.reviewResult.decision],
        ['id', review.reviewResult.id],
        ['overclaimDetected', String(review.reviewResult.overclaimDetected)],
      ]));
    }
  }
  if (trace.nextImprovementTask) {
    steps.push(step(`next-improvement-${trace.nextImprovementTask.id}`, 'Next Improvement Task', trace.nextImprovementTask.taskType, [
      ['id', trace.nextImprovementTask.id],
      ['taskType', trace.nextImprovementTask.taskType],
      ['status', trace.nextImprovementTask.status],
      ['reviewResultId', trace.nextImprovementTask.reviewResultId],
    ]));
  }
  if (trace.nextHumanApproval) {
    steps.push(step(`next-approval-${trace.nextHumanApproval.id}`, 'Human Approval', trace.nextHumanApproval.decision, [
      ['id', trace.nextHumanApproval.id],
      ['Decision', trace.nextHumanApproval.decision],
    ]));
  }
  if (trace.nextAgentExecution) {
    steps.push(step(`next-agent-${trace.nextAgentExecution.id}`, 'AgentExecution', trace.nextAgentExecution.status, [
      ['id', trace.nextAgentExecution.id],
      ['agent', trace.nextAgentExecution.agent],
      ['status', trace.nextAgentExecution.status],
    ]));
  }
  if (trace.verification) {
    steps.push(step('verification', 'Verification', trace.verification.result?.status ?? trace.verification.task?.status ?? 'UNKNOWN', [
      ['taskId', trace.verification.task?.id ?? null],
      ['status', trace.verification.result?.status ?? null],
      ['finding', trace.verification.result?.finding ?? null],
    ]));
  }
  for (const [index, review] of trace.rereviews.entries()) {
    if (review.source !== 'VERIFICATION') continue;
    steps.push(step(`verification-review-${review.request.id}-${index}`, 'Verification Re-review', review.reviewResult?.decision ?? review.request.status, [
      ['source', 'VERIFICATION'],
      ['Decision', review.reviewResult?.decision ?? null],
      ['id', review.request.id],
      ['status', review.request.status],
    ]));
  }
  if (trace.effectValidation && trace.effectValidation.status !== 'NOT_AVAILABLE') {
    steps.push(step('effect', 'Effect Validation', trace.effectValidation.status, [
      ['Effect', trace.effectValidation.status],
      ['code', trace.effectValidation.code],
      ['reason', trace.effectValidation.reason],
    ]));
  }
  if (trace.decisionCycle) {
    steps.push(step('cycle', 'Decision Cycle', trace.decisionCycle.status, [
      ['id', trace.decisionCycle.id],
      ['status', trace.decisionCycle.status],
      ['iteration', String(trace.decisionCycle.iteration)],
      ['verificationAttempts', String(trace.decisionCycle.verificationAttempts)],
      ['sameDecisionCount', String(trace.decisionCycle.sameDecisionCount)],
      ['sameConflictCount', String(trace.decisionCycle.sameConflictCount)],
    ]));
  }
  steps.push(step('outcome', 'Outcome', trace.outcome, [['outcome', trace.outcome]]));
  return steps;
}

function step(key: string, title: string, status: string | null, pairs: Array<[string, string | null]>): TraceScreenStep {
  return { key, title, status: show(status) ?? 'UNKNOWN', lines: lines(pairs) };
}

function lines(pairs: Array<[string, string | null]>): TraceScreenLine[] {
  return pairs.flatMap(([label, value]) => {
    const safe = show(value);
    return safe === null ? [] : [{ label, value: safe }];
  });
}

function show(value: string | null): string | null {
  if (value == null || value.length === 0) return null;
  if (containsSecret(value) || /(?:postgres|mysql|redis|mongodb):\/\//i.test(value) || /\bsk-[A-Za-z0-9]/.test(value) || /\bAKIA[0-9A-Z]{8,}/.test(value)) return null;
  return value;
}
