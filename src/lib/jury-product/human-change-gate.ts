/**
 * Runs the existing Change Gate on one completed human-approved execution.
 * It re-reads lineage from the database and does not inspect or write a workspace.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { containsSecret } from './agent-execution';
import { parseWorkspaceRef } from './agent-handoff';
import {
  evaluateChangeGate,
  type ChangeGateDraft,
  type ChangeGateWriteTx,
} from './change-gate';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import { evaluateImprovementChangeScope } from './improvement-scope-check';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';

export type HumanChangeGateFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'EXECUTION_NOT_COMPLETED'
  | 'PERSISTENCE_FAILED';

export type HumanChangeGateView = {
  id: string;
  status: string;
  errorCode: string | null;
  discrepancy: boolean;
  reasons: string[];
  credentialDetected: boolean;
  testsPassed: boolean | null;
};

type Lineage = {
  reviewResultId: string;
  reviewRequestId: string;
  humanDecisionId: string;
  humanDecision: JuryDecision;
  juryDecision: JuryDecision;
  taskType: 'VERIFICATION' | 'REWORD';
};

export async function evaluateHumanChangeGate(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
}): Promise<
  | { ok: true; created: boolean; reviewId: string; agentExecutionId: string; gate: HumanChangeGateView }
  | { ok: false; reason: HumanChangeGateFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.agentExecutionId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  try {
    const { prisma } = await import('@/lib/prisma');
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryAgentExecution" WHERE id = ${input.agentExecutionId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const execution = await tx.juryAgentExecution.findFirst({
        where: { id: input.agentExecutionId, tenantId: actor.tenantId },
        select: {
          id: true,
          tenantId: true,
          taskId: true,
          agent: true,
          status: true,
          workspaceRef: true,
          allowedPaths: true,
          provenance: true,
          task: {
            select: {
              id: true,
              tenantId: true,
              reviewResultId: true,
              taskType: true,
              provenance: true,
              reviewResult: {
                select: {
                  id: true,
                  tenantId: true,
                  reviewRequestId: true,
                  expectedDecision: true,
                  request: { select: { id: true, tenantId: true } },
                  humanDecision: {
                    select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true, decision: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!execution || execution.tenantId !== actor.tenantId || execution.agent !== 'CURSOR') {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      const task = execution.task?.tenantId === actor.tenantId ? execution.task : null;
      const review = task?.reviewResult?.tenantId === actor.tenantId ? task.reviewResult : null;
      const request = review?.request?.tenantId === actor.tenantId ? review.request : null;
      const human = review?.humanDecision?.tenantId === actor.tenantId ? review.humanDecision : null;
      const juryDecision = review ? oneOf(JURY_DECISIONS, review.expectedDecision) : null;
      const humanDecision = human ? oneOf(JURY_DECISIONS, human.decision) : null;
      const linked = task ? linkedHuman(task.provenance, task.reviewResultId) : null;
      if (
        !task
        || !review
        || !request
        || !juryDecision
        || task.id !== execution.taskId
        || request.id !== review.reviewRequestId
        || !linked
        || !human
        || !humanDecision
        || human.id !== linked.humanDecisionId
        || human.reviewResultId !== task.reviewResultId
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
        action: 'agent.execute',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      if (execution.status !== 'COMPLETED') {
        return { ok: false as const, reason: 'EXECUTION_NOT_COMPLETED' as const };
      }
      return recordHumanChangeGate({
        tx,
        userId: actor.userId,
        tenantId: actor.tenantId,
        memberships: input.memberships,
        execution,
        task: { id: task.id, tenantId: task.tenantId },
        lineage: {
          reviewResultId: review.id,
          reviewRequestId: review.reviewRequestId,
          humanDecisionId: human.id,
          humanDecision,
          juryDecision,
          taskType,
        },
      });
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

export async function recordHumanChangeGate(input: {
  tx: Prisma.TransactionClient;
  userId: string;
  tenantId: string;
  memberships: readonly JuryMembership[];
  execution: {
    id: string;
    tenantId: string;
    taskId: string;
    status: string;
    workspaceRef: unknown;
    allowedPaths: unknown;
    provenance: unknown;
  };
  task: { id: string; tenantId: string };
  lineage: Lineage;
}): Promise<
  | { ok: true; created: boolean; reviewId: string; agentExecutionId: string; gate: HumanChangeGateView }
  | { ok: false; reason: HumanChangeGateFailure }
> {
  const { tx, execution, lineage } = input;
  const existing = await tx.juryChangeGateResult.findFirst({
    where: { executionId: execution.id, tenantId: input.tenantId },
  });
  if (existing) {
    if (existing.tenantId !== input.tenantId) return { ok: false, reason: 'NOT_FOUND' };
    return {
      ok: true,
      created: false,
      reviewId: lineage.reviewResultId,
      agentExecutionId: execution.id,
      gate: viewOf(existing),
    };
  }
  const reported = readReported(execution.provenance);
  const now = new Date().toISOString();
  const allowedPaths = stringList(execution.allowedPaths);
  const writer = gateWriter(tx, input.userId, input.tenantId, lineage, allowedPaths);
  if (reported.secret) {
    const row = credentialGate(input.tenantId, execution.id, execution.taskId, execution.workspaceRef, now);
    await writer.insert(row);
    await writer.audit('CHANGE_GATE_STARTED', row);
    await writer.audit('CHANGE_GATE_BLOCKED', row);
    return {
      ok: true,
      created: true,
      reviewId: lineage.reviewResultId,
      agentExecutionId: execution.id,
      gate: viewOfDraft(row),
    };
  }
  const judged = await evaluateChangeGate(
    {
      userId: input.userId,
      memberships: input.memberships,
      clientTenantId: null,
      now,
      execution: {
        id: execution.id,
        tenantId: execution.tenantId,
        taskId: execution.taskId,
        status: execution.status,
        workspaceRef: execution.workspaceRef,
        provenance: null,
      },
      task: { id: input.task.id, tenantId: input.task.tenantId },
      agentReportedFiles: reported.files,
      testResults: reported.tests,
      inspection: { files: [], present: [] },
    },
    writer,
  );
  if (!judged.ok) {
    if (judged.reason === 'TENANT_MISMATCH' || judged.reason === 'EXECUTION_NOT_FOUND' || judged.reason === 'TASK_MISMATCH') {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (judged.reason === 'EXECUTION_NOT_COMPLETED') return { ok: false, reason: 'EXECUTION_NOT_COMPLETED' };
    if (judged.reason === 'FORBIDDEN') return { ok: false, reason: 'FORBIDDEN' };
    return { ok: false, reason: judged.reason };
  }
  return {
    ok: true,
    created: judged.created,
    reviewId: lineage.reviewResultId,
    agentExecutionId: execution.id,
    gate: viewOfDraft(judged.gate),
  };
}

function gateWriter(
  tx: Prisma.TransactionClient,
  userId: string,
  tenantId: string,
  lineage: Lineage,
  allowedPaths: string[],
): ChangeGateWriteTx {
  return {
    async findByExecution(executionId) {
      const row = await tx.juryChangeGateResult.findFirst({
        where: { executionId, tenantId },
      });
      if (!row || row.tenantId !== tenantId) return null;
      return storedGate(row);
    },
    async insert(row) {
      applyScope(row, allowedPaths);
      await tx.juryChangeGateResult.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          executionId: row.executionId,
          improvementTaskId: row.improvementTaskId,
          changedFiles: row.changedFiles,
          riskFlags: row.riskFlags,
          testsPassed: row.testsPassed,
          gate: row.gate,
          status: row.status,
          addedFiles: row.addedFiles,
          modifiedFiles: row.modifiedFiles,
          deletedFiles: row.deletedFiles,
          blockedFiles: row.blockedFiles,
          riskLevel: row.riskLevel,
          riskReasons: row.riskReasons,
          testResults: row.testResults as Prisma.InputJsonValue,
          agentReportedFiles: row.agentReportedFiles,
          discrepancy: row.discrepancy,
          discrepancyReasons: row.discrepancyReasons,
          diffStat: row.diffStat as Prisma.InputJsonValue,
          provenance: {
            agentExecutionId: row.executionId,
            improvementTaskId: row.improvementTaskId,
            workspaceRef: row.provenance.workspaceRef,
            reviewResultId: lineage.reviewResultId,
            reviewRequestId: lineage.reviewRequestId,
            humanDecisionId: lineage.humanDecisionId,
            humanDecision: lineage.humanDecision,
            juryDecision: lineage.juryDecision,
            taskType: lineage.taskType,
          },
          errorCode: row.errorCode,
          credentialDetected: row.credentialDetected,
          credentialType: row.credentialType,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    },
    async audit(action, row) {
      await tx.juryAuditEvent.create({
        data: {
          id: sha([row.id, action]),
          tenantId: row.tenantId,
          timestamp: new Date(row.createdAt),
          actor: userId,
          action,
          reviewId: lineage.reviewResultId,
          decision: lineage.humanDecision,
          improvementTaskId: row.improvementTaskId,
          agentExecutionId: row.executionId,
          provenance: {
            agentExecutionId: row.executionId,
            improvementTaskId: row.improvementTaskId,
            reviewResultId: lineage.reviewResultId,
            reviewRequestId: lineage.reviewRequestId,
            humanDecisionId: lineage.humanDecisionId,
            status: row.status,
            errorCode: row.errorCode,
            discrepancy: row.discrepancy,
            credentialDetected: row.credentialDetected,
          },
        },
      });
    },
  };
}

function applyScope(row: ChangeGateDraft, allowedPaths: string[]): void {
  if (row.credentialDetected) return;
  const scope = evaluateImprovementChangeScope({
    actorTenantId: row.tenantId,
    taskTenantId: row.tenantId,
    executionTenantId: row.tenantId,
    workspaceRef: row.provenance.workspaceRef,
    allowedPaths,
    objective: null,
    constraints: null,
    provenance: null,
    changedFiles: row.agentReportedFiles,
  });
  if (scope.status !== 'BLOCKED' || scope.code === 'TENANT_MISMATCH') return;
  row.status = 'BLOCKED';
  row.gate = 'BLOCK';
  if (!row.errorCode) row.errorCode = scope.code;
  if (!row.riskReasons.includes(scope.code)) row.riskReasons.push(scope.code);
  if (row.riskLevel === 'LOW' || row.riskLevel === 'MEDIUM') row.riskLevel = 'HIGH';
}

function storedGate(row: {
  id: string;
  tenantId: string;
  executionId: string;
  improvementTaskId: string | null;
  status: ChangeGateDraft['status'] | null;
  gate: ChangeGateDraft['gate'];
  changedFiles: unknown;
  addedFiles: unknown;
  modifiedFiles: unknown;
  deletedFiles: unknown;
  blockedFiles: unknown;
  riskFlags: unknown;
  riskLevel: ChangeGateDraft['riskLevel'] | null;
  riskReasons: unknown;
  testsPassed: boolean | null;
  testResults: unknown;
  agentReportedFiles: unknown;
  discrepancy: boolean | null;
  discrepancyReasons: unknown;
  diffStat: unknown;
  provenance: unknown;
  errorCode: string | null;
  credentialDetected: boolean | null;
  credentialType: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}): ChangeGateDraft {
  if (!row.status || !row.riskLevel || !row.improvementTaskId || !row.createdAt) throw new Error('GATE_SHAPE');
  const tests = row.testResults as ChangeGateDraft['testResults'] | null;
  const diff = row.diffStat as ChangeGateDraft['diffStat'] | null;
  const provenance = row.provenance as ChangeGateDraft['provenance'] | null;
  if (!tests || !diff || !provenance?.agentExecutionId || !provenance.improvementTaskId) throw new Error('GATE_SHAPE');
  return {
    id: row.id,
    tenantId: row.tenantId,
    executionId: row.executionId,
    improvementTaskId: row.improvementTaskId,
    status: row.status,
    gate: row.gate,
    changedFiles: stringList(row.changedFiles),
    addedFiles: stringList(row.addedFiles),
    modifiedFiles: stringList(row.modifiedFiles),
    deletedFiles: stringList(row.deletedFiles),
    blockedFiles: stringList(row.blockedFiles),
    riskFlags: stringList(row.riskFlags).filter((item): item is ChangeGateDraft['riskFlags'][number] =>
      item === 'HIGH_RISK_FILE' || item === 'PRODUCTION_CONFIG' || item === 'DB_MIGRATION' || item === 'SECURITY',
    ),
    riskLevel: row.riskLevel,
    riskReasons: stringList(row.riskReasons),
    testsPassed: row.testsPassed,
    testResults: tests,
    agentReportedFiles: stringList(row.agentReportedFiles),
    discrepancy: row.discrepancy === true,
    discrepancyReasons: stringList(row.discrepancyReasons),
    diffStat: diff,
    credentialDetected: row.credentialDetected === true,
    credentialType: row.credentialType,
    errorCode: row.errorCode,
    provenance: {
      agentExecutionId: provenance.agentExecutionId,
      improvementTaskId: provenance.improvementTaskId,
      workspaceRef: provenance.workspaceRef ?? null,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? row.createdAt.toISOString(),
  };
}

function credentialGate(
  tenantId: string,
  executionId: string,
  taskId: string,
  workspaceRef: unknown,
  now: string,
): ChangeGateDraft {
  const workspace = parseWorkspaceRef(workspaceRef);
  return {
    id: sha([tenantId, executionId, 'change-gate']),
    tenantId,
    executionId,
    improvementTaskId: taskId,
    status: 'BLOCKED',
    gate: 'BLOCK',
    changedFiles: [],
    addedFiles: [],
    modifiedFiles: [],
    deletedFiles: [],
    blockedFiles: [],
    riskFlags: ['SECURITY'],
    riskLevel: 'CRITICAL',
    riskReasons: ['CREDENTIAL_DETECTED'],
    testsPassed: null,
    testResults: { available: false, passed: null, commands: [], required: false },
    agentReportedFiles: [],
    discrepancy: false,
    discrepancyReasons: [],
    diffStat: {
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      totalChangedLines: 0,
      largestChangedFile: null,
      files: [],
    },
    credentialDetected: true,
    credentialType: 'SECRET',
    errorCode: 'CREDENTIAL_DETECTED',
    provenance: {
      agentExecutionId: executionId,
      improvementTaskId: taskId,
      workspaceRef: workspace,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function viewOf(row: {
  id: string;
  status: string | null;
  errorCode: string | null;
  discrepancy: boolean | null;
  discrepancyReasons: unknown;
  riskReasons: unknown;
  credentialDetected: boolean | null;
  testsPassed: boolean | null;
}): HumanChangeGateView {
  return {
    id: row.id,
    status: row.status ?? 'BLOCKED',
    errorCode: row.errorCode,
    discrepancy: row.discrepancy === true,
    reasons: [...new Set([...stringList(row.discrepancyReasons), ...stringList(row.riskReasons)])],
    credentialDetected: row.credentialDetected === true,
    testsPassed: row.testsPassed,
  };
}

function viewOfDraft(row: ChangeGateDraft): HumanChangeGateView {
  return {
    id: row.id,
    status: row.status,
    errorCode: row.errorCode,
    discrepancy: row.discrepancy,
    reasons: [...new Set([...row.discrepancyReasons, ...row.riskReasons])],
    credentialDetected: row.credentialDetected,
    testsPassed: row.testsPassed,
  };
}

function readReported(value: unknown): {
  secret: boolean;
  files: string[];
  tests: { available: boolean; passed: boolean | null; commands: string[] };
} {
  const empty = { secret: false, files: [] as string[], tests: { available: false, passed: null, commands: [] as string[] } };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const result = (value as { result?: unknown }).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return empty;
  if (containsSecret(result)) return { secret: true, files: [], tests: empty.tests };
  const row = result as { changedFiles?: unknown; testsRun?: unknown; testsPassed?: unknown };
  const files = Array.isArray(row.changedFiles) ? row.changedFiles.filter((item): item is string => typeof item === 'string') : [];
  const commands = Array.isArray(row.testsRun) ? row.testsRun.filter((item): item is string => typeof item === 'string') : [];
  const passed = typeof row.testsPassed === 'boolean' ? row.testsPassed : null;
  return {
    secret: false,
    files,
    tests: { available: passed != null || commands.length > 0, passed, commands },
  };
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

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
