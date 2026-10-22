/**
 * Reads explicit improvement rows and assembles a trace.
 * It does not write, start an agent, or open a review.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveDecisionCycleLineage, type LineageCycleRef } from './decision-cycle-lineage';
import type { ImprovementIntentChange } from './improvement-intent-check';
import {
  assembleImprovementTrace,
  planImprovementTraceRead,
  type ImprovementTraceFailure,
  type TraceBundle,
} from './improvement-trace';
import type { JuryMembership } from './records';

export async function readImprovementTrace(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  improvementTaskId?: string;
  reviewResultId?: string;
  decisionTaskId?: string;
}): Promise<ReturnType<typeof assembleImprovementTrace>> {
  const planned = planImprovementTraceRead(input);
  if (!planned.ok) return planned;
  const starts = [input.improvementTaskId, input.reviewResultId, input.decisionTaskId].filter((value) => value);
  if (starts.length !== 1) return { ok: false, reason: starts.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS' };
  const prisma = await client();
  const anchor = await resolveAnchor(prisma, planned.tenantId, input);
  if (!anchor.ok) return anchor;
  const bundle = anchor.taskId
    ? await loadTask(prisma, planned.tenantId, anchor.taskId)
    : await loadVerification(prisma, planned.tenantId, anchor.decisionTaskId);
  if (!bundle.ok) return bundle;
  return assembleImprovementTrace(bundle.bundle);
}

type Client = Awaited<ReturnType<typeof client>>;

async function client() {
  return (await import('@/lib/prisma')).prisma;
}

async function resolveAnchor(
  prisma: Client,
  tenantId: string,
  input: { improvementTaskId?: string; reviewResultId?: string; decisionTaskId?: string },
): Promise<{ ok: true; taskId: string | null; decisionTaskId: string } | { ok: false; reason: ImprovementTraceFailure }> {
  if (input.improvementTaskId) {
    const task = await prisma.juryImprovementTask.findUnique({ where: { id: input.improvementTaskId }, select: { id: true, tenantId: true } });
    if (!task) return { ok: false, reason: 'NOT_FOUND' };
    if (task.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: true, taskId: task.id, decisionTaskId: '' };
  }
  if (input.decisionTaskId) {
    const tasks = await prisma.juryImprovementTask.findMany({ where: { decisionTaskId: input.decisionTaskId }, select: { id: true, tenantId: true } });
    if (tasks.some((task) => task.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
    if (tasks.length > 1) return { ok: false, reason: 'AMBIGUOUS' };
    if (tasks.length === 1) return { ok: true, taskId: tasks[0]!.id, decisionTaskId: input.decisionTaskId };
    const decision = await prisma.juryDecisionTask.findUnique({ where: { id: input.decisionTaskId }, select: { id: true, tenantId: true, taskType: true } });
    if (!decision) return { ok: false, reason: 'NOT_FOUND' };
    if (decision.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    if (decision.taskType !== 'VERIFICATION') return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true, taskId: null, decisionTaskId: decision.id };
  }
  const review = await prisma.juryReviewResult.findUnique({ where: { id: input.reviewResultId }, select: { id: true, tenantId: true } });
  if (!review) return { ok: false, reason: 'NOT_FOUND' };
  if (review.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const tasks = await prisma.juryImprovementTask.findMany({ where: { reviewResultId: review.id }, select: { id: true, tenantId: true } });
  if (tasks.some((task) => task.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (tasks.length > 1) return { ok: false, reason: 'AMBIGUOUS' };
  if (tasks.length === 1) return { ok: true, taskId: tasks[0]!.id, decisionTaskId: '' };
  const decisions = await prisma.juryDecisionTask.findMany({ where: { reviewResultId: review.id, taskType: 'VERIFICATION' }, select: { id: true, tenantId: true } });
  if (decisions.some((task) => task.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (decisions.length !== 1) return { ok: false, reason: decisions.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS' };
  return { ok: true, taskId: null, decisionTaskId: decisions[0]!.id };
}

async function loadTask(prisma: Client, tenantId: string, taskId: string): Promise<{ ok: true; bundle: TraceBundle } | { ok: false; reason: ImprovementTraceFailure }> {
  const task = await prisma.juryImprovementTask.findUnique({ where: { id: taskId } });
  if (!task || task.tenantId !== tenantId) return { ok: false, reason: task ? 'TENANT_MISMATCH' : 'NOT_FOUND' };
  const [decisionTask, executions] = await Promise.all([
    task.decisionTaskId ? prisma.juryDecisionTask.findUnique({ where: { id: task.decisionTaskId } }) : Promise.resolve(null),
    prisma.juryAgentExecution.findMany({ where: { taskId: task.id } }),
  ]);
  if (decisionTask && decisionTask.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (executions.some((row) => row.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  const gates = await prisma.juryChangeGateResult.findMany({ where: { executionId: { in: executions.map((row) => row.id) } } });
  if (gates.some((row) => row.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  const changeGateReviews = await prisma.juryChangeGateReview.findMany({ where: { improvementTaskId: task.id } });
  if (changeGateReviews.some((row) => row.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  const verifyIds = changeGateReviews.flatMap((row) => (row.reviewResultId ? [row.reviewResultId] : []));
  const nextRows = await prisma.juryImprovementTask.findMany({
    where: { parentTaskId: task.id, tenantId },
    select: { id: true, tenantId: true, reviewResultId: true, taskType: true, status: true, provenance: true },
  });
  const nextMatches = nextRows.filter((row) => {
    if (row.tenantId !== tenantId || !verifyIds.includes(row.reviewResultId)) return false;
    if (!row.provenance || typeof row.provenance !== 'object' || Array.isArray(row.provenance)) return false;
    return (row.provenance as { kind?: unknown }).kind === 'rereview-improvement';
  });
  const nextImprovementTask = nextMatches.length === 1
    ? {
        id: nextMatches[0]!.id,
        tenantId: nextMatches[0]!.tenantId,
        reviewResultId: nextMatches[0]!.reviewResultId,
        taskType: nextMatches[0]!.taskType,
        status: nextMatches[0]!.status,
      }
    : null;
  const nextHuman = nextImprovementTask
    ? await prisma.juryHumanDecision.findFirst({
        where: { tenantId, reviewResultId: nextImprovementTask.reviewResultId },
        select: { id: true, tenantId: true, decision: true },
      })
    : null;
  const nextExecution = nextImprovementTask
    ? await prisma.juryAgentExecution.findFirst({
        where: { tenantId, taskId: nextImprovementTask.id, agent: 'CURSOR' },
        select: { id: true, tenantId: true, status: true, agent: true },
      })
    : null;
  if ((nextHuman && nextHuman.tenantId !== tenantId) || (nextExecution && nextExecution.tenantId !== tenantId)) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const verificationTasks = verifyIds.length
    ? await prisma.juryDecisionTask.findMany({ where: { reviewResultId: { in: verifyIds }, taskType: 'VERIFICATION' } })
    : [];
  if (verificationTasks.length > 1) return { ok: false, reason: 'AMBIGUOUS' };
  if (verificationTasks.some((row) => row.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  const verificationTask = verificationTasks[0] ?? null;
  const verificationResult = verificationTask
    ? await prisma.juryVerificationResult.findUnique({ where: { decisionTaskId: verificationTask.id } })
    : null;
  if (verificationResult && verificationResult.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const verificationReview = verificationResult
    ? await prisma.juryVerificationReview.findUnique({ where: { verificationResultId: verificationResult.id } })
    : null;
  if (verificationReview && verificationReview.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const verificationChildren = verificationReview
    ? await prisma.juryReviewResult.findMany({ where: { reReviewRequestId: verificationReview.id }, select: { id: true, tenantId: true, reReviewRequestId: true } })
    : [];
  if (verificationChildren.some((row) => row.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  const lineage = await lineageFor(prisma, task.reviewResultId, tenantId);
  if (!lineage.ok && (lineage.reason === 'TENANT_MISMATCH' || lineage.reason === 'DECISION_CYCLE_LINEAGE_AMBIGUOUS' || lineage.reason === 'REVIEW_LINEAGE_CYCLE')) {
    return { ok: false, reason: lineage.reason === 'DECISION_CYCLE_LINEAGE_AMBIGUOUS' ? 'AMBIGUOUS' : lineage.reason };
  }
  const reviewIds = [
    task.reviewResultId,
    lineage.ok ? lineage.cycle?.rootReviewResultId : null,
    lineage.ok ? lineage.cycle?.currentReviewResultId : null,
    ...verifyIds,
    verificationResult?.reviewResultId,
    ...verificationChildren.map((row) => row.id),
  ].filter((id): id is string => Boolean(id));
  const reviews = await prisma.juryReviewResult.findMany({
    where: { id: { in: [...new Set(reviewIds)] } },
    select: { id: true, tenantId: true, expectedDecision: true, parentReviewResultId: true, overclaimDetected: true, verificationResultId: true },
  });
  if (reviews.some((row) => row.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  return {
    ok: true,
    bundle: {
      actorTenantId: tenantId,
      improvementTask: {
        id: task.id,
        tenantId: task.tenantId,
        reviewResultId: task.reviewResultId,
        decisionTaskId: task.decisionTaskId,
        evidenceId: task.evidenceId,
        taskType: task.taskType,
        objective: task.objective,
        constraints: strings(task.constraints),
        provenance: task.provenance,
        status: task.status,
        createdAt: iso(task.createdAt),
        updatedAt: iso(task.updatedAt),
      },
      decisionTask: decisionTask
        ? { id: decisionTask.id, tenantId: decisionTask.tenantId, taskType: decisionTask.taskType, decision: decisionTask.decision, status: decisionTask.status, reviewResultId: decisionTask.reviewResultId }
        : null,
      reviews: reviews.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        decision: row.expectedDecision,
        parentReviewResultId: row.parentReviewResultId,
        overclaimDetected: row.overclaimDetected,
        verificationResultId: row.verificationResultId,
      })),
      executions: executions.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        taskId: row.taskId,
        agent: row.agent,
        status: row.status,
        requestedAt: iso(row.requestedAt),
        startedAt: iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
        workspaceRef: row.workspaceRef,
        allowedPaths: strings(row.allowedPaths),
        errorCode: row.errorCode,
      })),
      artifacts: executions.map((row) => ({ executionId: row.id, ...readArtifact(row.resultRef) })),
      gates: gates.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        executionId: row.executionId,
        improvementTaskId: row.improvementTaskId,
        status: row.status,
        risk: row.riskLevel,
        changedFiles: strings(row.changedFiles),
        agentReportedFiles: strings(row.agentReportedFiles),
        discrepancy: row.discrepancy,
        reason: row.errorCode,
        diffStat: row.diffStat,
        credentialDetected: row.credentialDetected === true,
        testsPassed: row.testsPassed,
        createdAt: iso(row.createdAt),
      })),
      changeGateReviews: changeGateReviews.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        changeGateResultId: row.changeGateResultId,
        improvementTaskId: row.improvementTaskId,
        status: row.status,
        source: row.source,
        reviewRequestId: row.reviewRequestId,
        reviewResultId: row.reviewResultId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      verificationTask: verificationTask
        ? { id: verificationTask.id, tenantId: verificationTask.tenantId, taskType: verificationTask.taskType, decision: verificationTask.decision, status: verificationTask.status, reviewResultId: verificationTask.reviewResultId }
        : null,
      verificationResult: verificationResult
        ? { id: verificationResult.id, tenantId: verificationResult.tenantId, decisionTaskId: verificationResult.decisionTaskId, reviewResultId: verificationResult.reviewResultId, status: verificationResult.status, finding: verificationResult.finding }
        : null,
      verificationReview: verificationReview
        ? {
            id: verificationReview.id,
            tenantId: verificationReview.tenantId,
            verificationResultId: verificationReview.verificationResultId,
            status: verificationReview.status,
            parentReviewResultId: verificationReview.parentReviewResultId,
            createdAt: verificationReview.createdAt.toISOString(),
            updatedAt: verificationReview.updatedAt.toISOString(),
          }
        : null,
      verificationChildren,
      nextImprovementTask,
      nextHumanApproval: nextHuman ? { id: nextHuman.id, tenantId: nextHuman.tenantId, decision: nextHuman.decision } : null,
      nextAgentExecution: nextExecution
        ? { id: nextExecution.id, tenantId: nextExecution.tenantId, status: nextExecution.status, agent: nextExecution.agent }
        : null,
      lineage,
    },
  };
}

async function loadVerification(prisma: Client, tenantId: string, decisionTaskId: string): Promise<{ ok: true; bundle: TraceBundle } | { ok: false; reason: ImprovementTraceFailure }> {
  const decision = await prisma.juryDecisionTask.findUnique({ where: { id: decisionTaskId } });
  if (!decision || decision.tenantId !== tenantId) return { ok: false, reason: decision ? 'TENANT_MISMATCH' : 'NOT_FOUND' };
  const result = await prisma.juryVerificationResult.findUnique({ where: { decisionTaskId: decision.id } });
  if (result && result.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const reviewRow = result ? await prisma.juryVerificationReview.findUnique({ where: { verificationResultId: result.id } }) : null;
  if (reviewRow && reviewRow.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const children = reviewRow
    ? await prisma.juryReviewResult.findMany({ where: { reReviewRequestId: reviewRow.id }, select: { id: true, tenantId: true, reReviewRequestId: true } })
    : [];
  if (children.some((row) => row.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  const lineage = await lineageFor(prisma, decision.reviewResultId, tenantId);
  if (!lineage.ok && (lineage.reason === 'TENANT_MISMATCH' || lineage.reason === 'DECISION_CYCLE_LINEAGE_AMBIGUOUS' || lineage.reason === 'REVIEW_LINEAGE_CYCLE')) {
    return { ok: false, reason: lineage.reason === 'DECISION_CYCLE_LINEAGE_AMBIGUOUS' ? 'AMBIGUOUS' : lineage.reason };
  }
  const reviewIds = [decision.reviewResultId, result?.reviewResultId, ...children.map((row) => row.id)].filter((id): id is string => Boolean(id));
  const reviews = await prisma.juryReviewResult.findMany({
    where: { id: { in: [...new Set(reviewIds)] } },
    select: { id: true, tenantId: true, expectedDecision: true, parentReviewResultId: true, overclaimDetected: true, verificationResultId: true },
  });
  if (reviews.some((row) => row.tenantId !== tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  return {
    ok: true,
    bundle: {
      actorTenantId: tenantId,
      improvementTask: null,
      decisionTask: null,
      reviews: reviews.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        decision: row.expectedDecision,
        parentReviewResultId: row.parentReviewResultId,
        overclaimDetected: row.overclaimDetected,
        verificationResultId: row.verificationResultId,
      })),
      executions: [],
      artifacts: [],
      gates: [],
      changeGateReviews: [],
      verificationTask: { id: decision.id, tenantId: decision.tenantId, taskType: decision.taskType, decision: decision.decision, status: decision.status, reviewResultId: decision.reviewResultId },
      verificationResult: result
        ? { id: result.id, tenantId: result.tenantId, decisionTaskId: result.decisionTaskId, reviewResultId: result.reviewResultId, status: result.status, finding: result.finding }
        : null,
      verificationReview: reviewRow
        ? {
            id: reviewRow.id,
            tenantId: reviewRow.tenantId,
            verificationResultId: reviewRow.verificationResultId,
            status: reviewRow.status,
            parentReviewResultId: reviewRow.parentReviewResultId,
            createdAt: reviewRow.createdAt.toISOString(),
            updatedAt: reviewRow.updatedAt.toISOString(),
          }
        : null,
      verificationChildren: children,
      lineage,
    },
  };
}

async function lineageFor(
  prisma: Client,
  reviewResultId: string,
  tenantId: string,
): Promise<TraceBundle['lineage']> {
  const found = await resolveDecisionCycleLineage(
    { reviewResultId, tenantId },
    {
      async load(id) {
        const row = await prisma.juryReviewResult.findUnique({ where: { id }, select: { id: true, tenantId: true, parentReviewResultId: true } });
        if (!row) return null;
        return { id: row.id, tenantId: row.tenantId, ancestorIds: row.parentReviewResultId ? [row.parentReviewResultId] : [] };
      },
      async cyclesFor(id) {
        return cyclesFor(prisma, id);
      },
    },
  );
  if (!found.ok) return { ok: false, reason: found.reason };
  const row = await prisma.juryDecisionCycle.findUnique({ where: { id: found.cycle.id } });
  if (!row) return { ok: true, cycle: null };
  if (row.tenantId !== tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  return {
    ok: true,
    cycle: {
      id: row.id,
      tenantId: row.tenantId,
      rootReviewResultId: row.rootReviewResultId,
      currentReviewResultId: row.currentReviewResultId,
      status: row.status,
      iteration: row.iteration,
      verificationAttempts: row.verificationAttempts,
      sameDecisionCount: row.sameDecisionCount,
      sameConflictCount: row.sameConflictCount,
      blockedReason: row.blockedReason,
    },
  };
}

async function cyclesFor(prisma: Client, reviewResultId: string): Promise<LineageCycleRef[]> {
  const [root, currents] = await Promise.all([
    prisma.juryDecisionCycle.findUnique({ where: { rootReviewResultId: reviewResultId } }),
    prisma.juryDecisionCycle.findMany({ where: { currentReviewResultId: reviewResultId } }),
  ]);
  const found = new Map<string, LineageCycleRef>();
  for (const row of [root, ...currents]) {
    if (!row) continue;
    found.set(row.id, { id: row.id, tenantId: row.tenantId, rootReviewResultId: row.rootReviewResultId, currentReviewResultId: row.currentReviewResultId });
  }
  return [...found.values()];
}

function readArtifact(resultRef: string | null): { changedFiles: string[] | null; changes: ImprovementIntentChange[] | null; summary: string | null } {
  const missing = { changedFiles: null, changes: null, summary: null };
  if (!resultRef || !resultRef.startsWith('data/jury-product/agent-executions/') || resultRef.includes('..')) return missing;
  try {
    const body = JSON.parse(readFileSync(path.resolve(process.cwd(), resultRef), 'utf8')) as { changedFiles?: unknown; summary?: unknown; changes?: unknown };
    if (!Array.isArray(body.changedFiles)) return missing;
    const changes = Array.isArray(body.changes)
      ? body.changes.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const row = item as { path?: unknown; kind?: unknown; text?: unknown };
          if (typeof row.path !== 'string') return [];
          return [{ path: row.path, kind: typeof row.kind === 'string' ? row.kind : undefined, text: typeof row.text === 'string' ? row.text : null }];
        })
      : [];
    return { changedFiles: strings(body.changedFiles), changes, summary: typeof body.summary === 'string' ? body.summary : null };
  } catch {
    return missing;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
