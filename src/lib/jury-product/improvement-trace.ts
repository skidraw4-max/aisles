/**
 * Assembles one improvement trace from explicit rows.
 * It does not write, start an agent, or invent a missing link.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { containsSecret } from './agent-execution';
import type { LineageCycleRef, LineageFailure } from './decision-cycle-lineage';
import { effectFromStoredRows, evaluateImprovementEffect, type ImprovementEffectResult } from './improvement-effect-validation';
import { evaluateImprovementIntent, type ImprovementIntentChange, type ImprovementIntentResult } from './improvement-intent-check';
import { evaluateImprovementChangeScope, type ImprovementScopeResult } from './improvement-scope-check';
import type { JuryMembership } from './records';

export const IMPROVEMENT_TRACE_OUTCOMES = [
  'COMPLETED',
  'STOPPED_SCOPE',
  'STOPPED_INTENT',
  'STOPPED_GATE',
  'STOPPED_VERIFICATION',
  'STOPPED_EFFECT',
  'ACTIVE',
  'UNKNOWN',
] as const;

export type ImprovementTraceOutcome = (typeof IMPROVEMENT_TRACE_OUTCOMES)[number];

export type ImprovementTraceFailure =
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'TENANT_MISMATCH'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'REVIEW_LINEAGE_CYCLE';

export type TraceReview = {
  id: string;
  decision: string;
  parentReviewResultId: string | null;
  overclaimDetected: boolean;
};

export type TraceDecisionTask = {
  id: string;
  taskType: string;
  decision: string;
  status: string;
  reviewResultId: string;
};

export type TraceImprovementTask = {
  id: string;
  tenantId: string;
  decisionTaskId: string | null;
  evidenceId: string | null;
  taskType: string | null;
  objective: string | null;
  constraints: string[];
  provenance: {
    sourceDecision: string | null;
    reviewResultId: string | null;
    decisionTaskId: string | null;
    evidenceId: string | null;
    workspaceRef: { type: string; ref: string } | null;
  };
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TraceExecution = {
  id: string;
  agent: string;
  status: string;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  workspaceRef: { type: string; ref: string } | null;
  errorCode: string | null;
};

export type TraceScope = { executionId: string; result: ImprovementScopeResult | { status: 'NOT_AVAILABLE' } };
export type TraceIntent = { executionId: string; result: ImprovementIntentResult | { status: 'NOT_AVAILABLE' } };

export type TraceGate = {
  id: string;
  executionId: string;
  status: string | null;
  risk: string | null;
  changedFiles: string[];
  agentReportedFiles: string[];
  discrepancy: boolean | null;
  reason: string | null;
  diffStat: Record<string, number> | null;
  credentialDetected: boolean;
  testResults: { testsPassed: boolean | null };
};

export type TraceRereview = {
  source: 'CHANGE_GATE' | 'VERIFICATION';
  request: { id: string; status: string; reviewRequestId: string | null; createdAt: string; updatedAt: string };
  reviewResult: TraceReview | null;
};

export type ImprovementTrace = {
  rootReviewResult: TraceReview | null;
  decisionTask: TraceDecisionTask | null;
  improvementTask: TraceImprovementTask | null;
  agentExecutions: TraceExecution[];
  scopeChecks: TraceScope[];
  intentChecks: TraceIntent[];
  changeGates: TraceGate[];
  rereviews: TraceRereview[];
  verification: {
    task: TraceDecisionTask | null;
    result: { id: string; status: string; finding: string | null } | null;
    review: { id: string; status: string } | null;
  } | null;
  effectValidation: ImprovementEffectResult | { status: 'NOT_AVAILABLE' } | null;
  decisionCycle: {
    id: string;
    rootReviewResultId: string;
    currentReviewResultId: string;
    status: string;
    iteration: number;
    verificationAttempts: number;
    sameDecisionCount: number;
    sameConflictCount: number;
    blockedReason: string | null;
  } | null;
  outcome: ImprovementTraceOutcome;
  nextImprovementTask: {
    id: string;
    taskType: string | null;
    status: string;
    reviewResultId: string;
  } | null;
  nextHumanApproval: { id: string; decision: string } | null;
  nextAgentExecution: { id: string; status: string; agent: string } | null;
};

export type TraceBundle = {
  actorTenantId: string;
  improvementTask: {
    id: string;
    tenantId: string;
    reviewResultId: string;
    decisionTaskId: string | null;
    evidenceId: string | null;
    taskType: string | null;
    objective: string | null;
    constraints: readonly string[] | null;
    provenance: unknown;
    status: string;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
  decisionTask: {
    id: string;
    tenantId: string;
    taskType: string;
    decision: string;
    status: string;
    reviewResultId: string;
  } | null;
  reviews: ReadonlyArray<{
    id: string;
    tenantId: string;
    decision: string;
    parentReviewResultId: string | null;
    overclaimDetected: boolean;
    verificationResultId: string | null;
  }>;
  executions: ReadonlyArray<{
    id: string;
    tenantId: string;
    taskId: string;
    agent: string;
    status: string;
    requestedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    workspaceRef: unknown;
    allowedPaths: readonly string[];
    errorCode: string | null;
  }>;
  artifacts: ReadonlyArray<{
    executionId: string;
    changedFiles: readonly string[] | null;
    changes: readonly ImprovementIntentChange[] | null;
    summary: string | null;
  }>;
  gates: ReadonlyArray<{
    id: string;
    tenantId: string;
    executionId: string;
    improvementTaskId: string | null;
    status: string | null;
    risk: string | null;
    changedFiles: readonly string[];
    agentReportedFiles: readonly string[];
    discrepancy: boolean | null;
    reason: string | null;
    diffStat: unknown;
    credentialDetected: boolean;
    testsPassed: boolean | null;
    createdAt: string | null;
  }>;
  changeGateReviews: ReadonlyArray<{
    id: string;
    tenantId: string;
    changeGateResultId: string;
    improvementTaskId: string;
    status: string;
    source: string;
    reviewRequestId: string | null;
    reviewResultId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  verificationTask: TraceBundle['decisionTask'];
  verificationResult: {
    id: string;
    tenantId: string;
    decisionTaskId: string;
    reviewResultId: string;
    status: string;
    finding: string | null;
  } | null;
  verificationReview: {
    id: string;
    tenantId: string;
    verificationResultId: string;
    status: string;
    parentReviewResultId: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  verificationChildren: ReadonlyArray<{ id: string; tenantId: string; reReviewRequestId: string | null }>;
  nextImprovementTask?: {
    id: string;
    tenantId: string;
    reviewResultId: string;
    taskType: string | null;
    status: string;
  } | null;
  nextHumanApproval?: { id: string; tenantId: string; decision: string } | null;
  nextAgentExecution?: { id: string; tenantId: string; status: string; agent: string } | null;
  lineage:
    | { ok: true; cycle: (LineageCycleRef & { status: string; iteration: number; verificationAttempts: number; sameDecisionCount: number; sameConflictCount: number; blockedReason: string | null }) | null }
    | { ok: false; reason: LineageFailure };
};

export function planImprovementTraceRead(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
}): { ok: true; tenantId: string } | { ok: false; reason: ImprovementTraceFailure } {
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'console.read',
    resourceTenantId: actor.tenantId,
    clientTenantId: input.clientTenantId,
  });
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  return { ok: true, tenantId: actor.tenantId };
}

export function assembleImprovementTrace(bundle: TraceBundle): { ok: true; trace: ImprovementTrace } | { ok: false; reason: ImprovementTraceFailure } {
  const tenant = tenantProblem(bundle);
  if (tenant) return { ok: false, reason: tenant };
  const link = linkProblem(bundle);
  if (link) return { ok: false, reason: link };
  if (bundle.lineage.ok === false && bundle.lineage.reason === 'TENANT_MISMATCH') return { ok: false, reason: 'TENANT_MISMATCH' };
  if (bundle.lineage.ok === false && bundle.lineage.reason === 'DECISION_CYCLE_LINEAGE_AMBIGUOUS') return { ok: false, reason: 'AMBIGUOUS' };
  if (bundle.lineage.ok === false && bundle.lineage.reason === 'REVIEW_LINEAGE_CYCLE') return { ok: false, reason: 'REVIEW_LINEAGE_CYCLE' };

  const executions = [...bundle.executions].sort((left, right) => stamp(left.requestedAt).localeCompare(stamp(right.requestedAt)) || left.id.localeCompare(right.id));
  const scopeChecks = executions.map((execution) => scopeFor(bundle, execution));
  const intentChecks = executions.map((execution) => intentFor(bundle, execution));
  const gates = [...bundle.gates].sort((left, right) => stamp(left.createdAt).localeCompare(stamp(right.createdAt)) || left.id.localeCompare(right.id));
  const reviews = new Map(bundle.reviews.map((review) => [review.id, review]));
  const rereviews = rereviewRows(bundle, reviews);
  const effect = effectFor(bundle, reviews);
  if (effect && 'code' in effect && effect.code === 'TENANT_MISMATCH') return { ok: false, reason: 'TENANT_MISMATCH' };
  const cycle = bundle.lineage.ok ? bundle.lineage.cycle : null;
  const root = cycle ? reviews.get(cycle.rootReviewResultId) ?? null : null;
  const trace: ImprovementTrace = {
    rootReviewResult: root ? projectReview(root) : null,
    decisionTask: bundle.decisionTask ? projectDecision(bundle.decisionTask) : null,
    improvementTask: bundle.improvementTask ? projectTask(bundle.improvementTask) : null,
    agentExecutions: executions.map(projectExecution),
    scopeChecks,
    intentChecks,
    changeGates: gates.map(projectGate),
    rereviews,
    verification: verificationOf(bundle),
    effectValidation: effect,
    decisionCycle: cycle
      ? {
          id: cycle.id,
          rootReviewResultId: cycle.rootReviewResultId,
          currentReviewResultId: cycle.currentReviewResultId,
          status: cycle.status,
          iteration: cycle.iteration,
          verificationAttempts: cycle.verificationAttempts,
          sameDecisionCount: cycle.sameDecisionCount,
          sameConflictCount: cycle.sameConflictCount,
          blockedReason: clean(cycle.blockedReason),
        }
      : null,
    nextImprovementTask: bundle.nextImprovementTask
      ? {
          id: bundle.nextImprovementTask.id,
          taskType: bundle.nextImprovementTask.taskType,
          status: bundle.nextImprovementTask.status,
          reviewResultId: bundle.nextImprovementTask.reviewResultId,
        }
      : null,
    nextHumanApproval: bundle.nextHumanApproval
      ? { id: bundle.nextHumanApproval.id, decision: bundle.nextHumanApproval.decision }
      : null,
    nextAgentExecution: bundle.nextAgentExecution
      ? { id: bundle.nextAgentExecution.id, status: bundle.nextAgentExecution.status, agent: bundle.nextAgentExecution.agent }
      : null,
    outcome: 'UNKNOWN',
  };
  trace.outcome = outcomeOf(trace, executions);
  return { ok: true, trace };
}

function tenantProblem(bundle: TraceBundle): ImprovementTraceFailure | null {
  const tenants = [
    bundle.improvementTask?.tenantId,
    bundle.decisionTask?.tenantId,
    bundle.verificationTask?.tenantId,
    bundle.verificationResult?.tenantId,
    bundle.verificationReview?.tenantId,
    ...bundle.reviews.map((row) => row.tenantId),
    ...bundle.executions.map((row) => row.tenantId),
    ...bundle.gates.map((row) => row.tenantId),
    ...bundle.changeGateReviews.map((row) => row.tenantId),
    ...bundle.verificationChildren.map((row) => row.tenantId),
    bundle.lineage.ok ? bundle.lineage.cycle?.tenantId : undefined,
    bundle.nextImprovementTask?.tenantId,
    bundle.nextHumanApproval?.tenantId,
    bundle.nextAgentExecution?.tenantId,
  ];
  if (tenants.some((tenant) => tenant && tenant !== bundle.actorTenantId)) return 'TENANT_MISMATCH';
  return null;
}

function linkProblem(bundle: TraceBundle): ImprovementTraceFailure | null {
  const task = bundle.improvementTask;
  if (task && bundle.decisionTask && task.decisionTaskId !== bundle.decisionTask.id) return 'AMBIGUOUS';
  if (task && bundle.executions.some((row) => row.taskId !== task.id)) return 'AMBIGUOUS';
  const executionIds = new Set(bundle.executions.map((row) => row.id));
  if (bundle.gates.some((row) => !executionIds.has(row.executionId))) return 'AMBIGUOUS';
  if (task && bundle.gates.some((row) => row.improvementTaskId && row.improvementTaskId !== task.id)) return 'AMBIGUOUS';
  const gateIds = new Set(bundle.gates.map((row) => row.id));
  if (bundle.changeGateReviews.some((row) => !gateIds.has(row.changeGateResultId) || (task && row.improvementTaskId !== task.id))) return 'AMBIGUOUS';
  if (bundle.verificationResult && bundle.verificationTask && bundle.verificationResult.decisionTaskId !== bundle.verificationTask.id) return 'AMBIGUOUS';
  if (bundle.verificationReview && bundle.verificationResult && bundle.verificationReview.verificationResultId !== bundle.verificationResult.id) return 'AMBIGUOUS';
  if (bundle.verificationChildren.length > 1) return 'AMBIGUOUS';
  const child = bundle.verificationChildren[0];
  if (child && bundle.verificationReview && child.reReviewRequestId !== bundle.verificationReview.id) return 'AMBIGUOUS';
  if (bundle.changeGateReviews.some((row) => row.source !== 'CHANGE_GATE')) return 'AMBIGUOUS';
  if (task && bundle.verificationTask) {
    const fromGate = new Set(bundle.changeGateReviews.flatMap((row) => (row.reviewResultId ? [row.reviewResultId] : [])));
    if (!fromGate.has(bundle.verificationTask.reviewResultId)) return 'AMBIGUOUS';
  }
  return null;
}

function scopeFor(bundle: TraceBundle, execution: TraceBundle['executions'][number]): TraceScope {
  const artifact = bundle.artifacts.find((row) => row.executionId === execution.id);
  const task = bundle.improvementTask;
  if (!artifact || artifact.changedFiles === null || !task) return { executionId: execution.id, result: { status: 'NOT_AVAILABLE' } };
  return {
    executionId: execution.id,
    result: evaluateImprovementChangeScope({
      actorTenantId: bundle.actorTenantId,
      taskTenantId: task.tenantId,
      executionTenantId: execution.tenantId,
      workspaceRef: workspaceOf(execution.workspaceRef) ?? workspaceOf(record(task.provenance).workspaceRef),
      allowedPaths: execution.allowedPaths,
      objective: task.objective,
      constraints: task.constraints,
      provenance: task.provenance,
      changedFiles: artifact.changedFiles,
    }),
  };
}

function intentFor(bundle: TraceBundle, execution: TraceBundle['executions'][number]): TraceIntent {
  const artifact = bundle.artifacts.find((row) => row.executionId === execution.id);
  const task = bundle.improvementTask;
  if (!artifact || artifact.changedFiles === null || artifact.changes === null || !task) return { executionId: execution.id, result: { status: 'NOT_AVAILABLE' } };
  const provenance = record(task.provenance);
  return {
    executionId: execution.id,
    result: evaluateImprovementIntent({
      actorTenantId: bundle.actorTenantId,
      taskTenantId: task.tenantId,
      executionTenantId: execution.tenantId,
      objective: task.objective,
      constraints: task.constraints,
      provenance: task.provenance,
      allowedPaths: [...execution.allowedPaths, ...strings(provenance.allowedPaths)],
      workspaceRef: workspaceOf(execution.workspaceRef) ?? workspaceOf(provenance.workspaceRef),
      changedFiles: artifact.changedFiles,
      changes: artifact.changes,
      summary: artifact.summary,
    }),
  };
}

function rereviewRows(bundle: TraceBundle, reviews: ReadonlyMap<string, TraceBundle['reviews'][number]>): TraceRereview[] {
  const gate = bundle.changeGateReviews.map((row) => ({
    source: 'CHANGE_GATE' as const,
    request: {
      id: row.id,
      status: row.status,
      reviewRequestId: row.reviewRequestId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    reviewResult: row.reviewResultId ? projectMaybe(reviews.get(row.reviewResultId)) : null,
    createdAt: row.createdAt,
  }));
  const verification = bundle.verificationReview
    ? [{
        source: 'VERIFICATION' as const,
        request: {
          id: bundle.verificationReview.id,
          status: bundle.verificationReview.status,
          reviewRequestId: null,
          createdAt: bundle.verificationReview.createdAt,
          updatedAt: bundle.verificationReview.updatedAt,
        },
        reviewResult: projectMaybe(childReview(bundle, reviews)),
        createdAt: bundle.verificationReview.createdAt,
      }]
    : [];
  return [...gate, ...verification]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.request.id.localeCompare(right.request.id))
    .map(({ createdAt: _createdAt, ...row }) => row);
}

function childReview(bundle: TraceBundle, reviews: ReadonlyMap<string, TraceBundle['reviews'][number]>): TraceBundle['reviews'][number] | undefined {
  const child = bundle.verificationChildren[0];
  return child ? reviews.get(child.id) : undefined;
}

function effectFor(bundle: TraceBundle, reviews: ReadonlyMap<string, TraceBundle['reviews'][number]>): ImprovementTrace['effectValidation'] {
  const child = childReview(bundle, reviews);
  const gateResults = bundle.changeGateReviews.flatMap((row) => (row.reviewResultId ? [row.reviewResultId] : []));
  const selected = child ?? (gateResults.length === 1 ? reviews.get(gateResults[0]!) : undefined);
  const verifyReview = bundle.verificationResult ? reviews.get(bundle.verificationResult.reviewResultId) : undefined;
  const review = selected ?? (bundle.improvementTask ? undefined : verifyReview);
  const decision = review ? decisionOf(review.decision) : null;
  if (!review || !decision) return { status: 'NOT_AVAILABLE' };
  if (!bundle.improvementTask) {
    return evaluateImprovementEffect({
      actorTenantId: bundle.actorTenantId,
      taskTenantId: review.tenantId,
      reviewTenantId: review.tenantId,
      objective: null,
      decision,
      linked: bundle.verificationResult?.reviewResultId === review.id,
      overclaimPersists: review.overclaimDetected,
      verificationStatus: verificationState(bundle.verificationResult?.status ?? null),
    });
  }
  return effectFromStoredRows({
    actorTenantId: bundle.actorTenantId,
    decision,
    task: { tenantId: bundle.improvementTask.tenantId, reviewResultId: bundle.improvementTask.reviewResultId, objective: bundle.improvementTask.objective },
    review: {
      tenantId: review.tenantId,
      parentReviewResultId: review.parentReviewResultId,
      overclaimDetected: review.overclaimDetected,
      verificationResultId: review.verificationResultId,
    },
    verification: bundle.verificationResult
      ? { tenantId: bundle.verificationResult.tenantId, status: bundle.verificationResult.status, reviewResultId: bundle.verificationResult.reviewResultId }
      : null,
    verifiedReview: verifyReview ? { tenantId: verifyReview.tenantId, parentReviewResultId: verifyReview.parentReviewResultId } : null,
  });
}

function outcomeOf(trace: ImprovementTrace, executions: ReadonlyArray<{ status: string }>): ImprovementTraceOutcome {
  const scopeBlocked = trace.scopeChecks.some((row) => row.result.status === 'BLOCKED');
  const intentBlocked = trace.intentChecks.some((row) => row.result.status === 'BLOCKED');
  const approved = trace.changeGates.some((row) => row.status === 'APPROVED');
  const gateStopped = trace.changeGates.some((row) => row.status === 'GATED' || row.status === 'BLOCKED');
  const gateReviewed = trace.rereviews.some((row) => row.source === 'CHANGE_GATE' && row.reviewResult);
  const verificationStatus = trace.verification?.result?.status;
  const verificationReviewed = trace.rereviews.some((row) => row.source === 'VERIFICATION' && row.reviewResult);
  if (scopeBlocked && !approved && !gateReviewed) return 'STOPPED_SCOPE';
  if (intentBlocked && !approved && !gateReviewed) return 'STOPPED_INTENT';
  if (gateStopped && !gateReviewed) return 'STOPPED_GATE';
  if ((verificationStatus === 'INCONCLUSIVE' || verificationStatus === 'UNRESOLVED') && !verificationReviewed) return 'STOPPED_VERIFICATION';
  if (trace.decisionCycle?.status === 'COMPLETED' && trace.effectValidation && 'code' in trace.effectValidation && trace.effectValidation.code === 'EFFECTIVE') return 'COMPLETED';
  if (trace.effectValidation && 'code' in trace.effectValidation && trace.effectValidation.code === 'NOT_EFFECTIVE') return 'STOPPED_EFFECT';
  if (trace.decisionCycle?.status === 'ACTIVE' || executions.some((row) => row.status === 'PENDING' || row.status === 'RUNNING')) return 'ACTIVE';
  return 'UNKNOWN';
}

function verificationOf(bundle: TraceBundle): ImprovementTrace['verification'] {
  if (!bundle.verificationTask && !bundle.verificationResult && !bundle.verificationReview) return null;
  return {
    task: bundle.verificationTask ? projectDecision(bundle.verificationTask) : null,
    result: bundle.verificationResult ? { id: bundle.verificationResult.id, status: bundle.verificationResult.status, finding: clean(bundle.verificationResult.finding) } : null,
    review: bundle.verificationReview ? { id: bundle.verificationReview.id, status: bundle.verificationReview.status } : null,
  };
}

function projectTask(task: NonNullable<TraceBundle['improvementTask']>): TraceImprovementTask {
  const provenance = record(task.provenance);
  return {
    id: task.id,
    tenantId: task.tenantId,
    decisionTaskId: task.decisionTaskId,
    evidenceId: task.evidenceId,
    taskType: task.taskType,
    objective: clean(task.objective),
    constraints: (task.constraints ?? []).filter((item) => !containsSecret(item)),
    provenance: {
      sourceDecision: typeof provenance.sourceDecision === 'string' ? clean(provenance.sourceDecision) : null,
      reviewResultId: typeof provenance.reviewResultId === 'string' ? provenance.reviewResultId : null,
      decisionTaskId: typeof provenance.decisionTaskId === 'string' ? provenance.decisionTaskId : null,
      evidenceId: typeof provenance.evidenceId === 'string' ? provenance.evidenceId : null,
      workspaceRef: workspaceOf(provenance.workspaceRef),
    },
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function projectDecision(task: NonNullable<TraceBundle['decisionTask']>): TraceDecisionTask {
  return { id: task.id, taskType: task.taskType, decision: task.decision, status: task.status, reviewResultId: task.reviewResultId };
}

function projectExecution(execution: TraceBundle['executions'][number]): TraceExecution {
  return {
    id: execution.id,
    agent: execution.agent,
    status: execution.status,
    requestedAt: execution.requestedAt,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    workspaceRef: workspaceOf(execution.workspaceRef),
    errorCode: clean(execution.errorCode),
  };
}

function projectGate(gate: TraceBundle['gates'][number]): TraceGate {
  return {
    id: gate.id,
    executionId: gate.executionId,
    status: gate.status,
    risk: clean(gate.risk),
    changedFiles: gate.changedFiles.filter((file) => !containsSecret(file)),
    agentReportedFiles: gate.agentReportedFiles.filter((file) => !containsSecret(file)),
    discrepancy: gate.discrepancy,
    reason: clean(gate.reason),
    diffStat: numbers(gate.diffStat),
    credentialDetected: gate.credentialDetected,
    testResults: { testsPassed: gate.testsPassed },
  };
}

function projectReview(review: TraceBundle['reviews'][number]): TraceReview {
  return {
    id: review.id,
    decision: review.decision,
    parentReviewResultId: review.parentReviewResultId,
    overclaimDetected: review.overclaimDetected,
  };
}

function projectMaybe(review: TraceBundle['reviews'][number] | undefined): TraceReview | null {
  return review ? projectReview(review) : null;
}

function decisionOf(value: string): 'ACCEPT' | 'VERIFY' | 'REWORD' | null {
  if (value === 'ACCEPT' || value === 'VERIFY' || value === 'REWORD') return value;
  return null;
}

function verificationState(status: string | null): 'RESOLVED' | 'INCONCLUSIVE' | 'MISSING' | null {
  if (!status) return null;
  if (status === 'RESOLVED') return 'RESOLVED';
  if (status === 'INCONCLUSIVE' || status === 'UNRESOLVED') return 'INCONCLUSIVE';
  return 'MISSING';
}

function workspaceOf(value: unknown): { type: string; ref: string } | null {
  const row = record(value);
  if (typeof row.type !== 'string' || typeof row.ref !== 'string') return null;
  if (!/^[A-Za-z0-9._-]+$/.test(row.ref) || containsSecret(row.ref)) return null;
  return { type: row.type, ref: row.ref };
}

function numbers(value: unknown): Record<string, number> | null {
  const row = record(value);
  const entries = Object.entries(row).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function clean(value: string | null): string | null {
  if (value == null || containsSecret(value)) return null;
  return value;
}

function stamp(value: string | null): string {
  return value ?? '';
}
