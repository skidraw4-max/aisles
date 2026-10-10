/**
 * Runs one completed product execution through the existing Change Gate.
 * The bridge checks product lineage, then the existing evaluator inspects the allowlisted workspace.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { containsSecret } from './agent-execution';
import { parseWorkspaceRef, type WorkspaceRef } from './agent-handoff';
import { resolveAllowedWorkspace } from './agent-workspace';
import {
  evaluateChangeGate,
  type ChangeGateDraft,
  type ChangeGateWriteTx,
  type ChangeInspection,
  type WorkspaceChange,
} from './change-gate';
import { inspectAllowlistedWorkspace } from './change-gate-workspace';
import { HUMAN_HANDOFF_AGENT } from './human-agent-handoff';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import { evaluateImprovementChangeScope } from './improvement-scope-check';
import { JURY_INTERACTIVE_TRANSACTION, notePersistenceFailure } from './persistence-diagnostic';
import { inspectionWorkspaceForProduct } from './product-inspection-workspace';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';

export type ProductChangeGateFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'EXECUTION_NOT_COMPLETED'
  | 'SNAPSHOT_UNSAFE'
  | 'PERSISTENCE_FAILED';

export type ProductChangeGateView = {
  id: string;
  status: string;
  errorCode: string | null;
  discrepancy: boolean;
  reasons: string[];
  credentialDetected: boolean;
  testsPassed: boolean | null;
};

export type ProductGateState = 'APPROVED' | 'BLOCKED' | 'GATED' | 'PENDING';

type InspectionResult =
  | { ok: true; files: WorkspaceChange[]; present: string[] }
  | { ok: false; reason: 'WORKSPACE_NOT_ALLOWED' | 'WORKSPACE_ESCAPE' };

type Lineage = {
  reviewResultId: string;
  reviewRequestId: string;
  humanDecisionId: string;
  humanDecision: JuryDecision;
  juryDecision: JuryDecision;
  taskType: 'VERIFICATION' | 'REWORD';
};

export async function evaluateProductChangeGate(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  clientTenantId?: string | null;
  inspect?: (relativeRoot: string) => Promise<InspectionResult>;
}): Promise<
  | {
      ok: true;
      created: boolean;
      evaluated: boolean;
      reviewId: string;
      agentExecutionId: string;
      gate: ProductChangeGateView;
    }
  | { ok: false; reason: ProductChangeGateFailure }
> {
  void input.clientTenantId;
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.agentExecutionId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN' };
  const readWorkspace = input.inspect ?? inspectAllowlistedWorkspace;
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
          inputSnapshot: true,
          workspaceRef: true,
          allowedPaths: true,
          provenance: true,
          task: {
            select: {
              id: true,
              tenantId: true,
              reviewResultId: true,
              evidenceId: true,
              taskType: true,
              provenance: true,
              reviewResult: {
                select: {
                  id: true,
                  tenantId: true,
                  reviewRequestId: true,
                  expectedDecision: true,
                  request: {
                    select: {
                      id: true,
                      tenantId: true,
                      evidenceId: true,
                      connectionId: true,
                      evidence: { select: { id: true, tenantId: true, connectionId: true } },
                      connection: { select: { id: true, tenantId: true } },
                    },
                  },
                  humanDecision: {
                    select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true, decision: true },
                  },
                },
              },
            },
          },
        },
      });
      const task = execution?.task?.tenantId === actor.tenantId ? execution.task : null;
      const review = task?.reviewResult?.tenantId === actor.tenantId ? task.reviewResult : null;
      const request = review?.request?.tenantId === actor.tenantId ? review.request : null;
      const evidence = request?.evidence;
      const connection = request?.connection;
      const human = review?.humanDecision?.tenantId === actor.tenantId ? review.humanDecision : null;
      if (
        !execution
        || execution.agent !== HUMAN_HANDOFF_AGENT
        || !task
        || task.id !== execution.taskId
        || !review
        || !request
        || request.id !== review.reviewRequestId
        || !productExecutionProvenance(execution.provenance, task.id)
        || !evidence
        || evidence.tenantId !== actor.tenantId
        || evidence.id !== request.evidenceId
        || task.evidenceId !== evidence.id
        || !connection
        || connection.tenantId !== actor.tenantId
        || connection.id !== request.connectionId
        || evidence.connectionId !== connection.id
      ) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      if (!productTaskProvenance(task.provenance, review.id)) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      const juryDecision = oneOf(JURY_DECISIONS, review.expectedDecision);
      const humanDecision = human ? oneOf(JURY_DECISIONS, human.decision) : null;
      const taskType = humanDecision === 'VERIFY' || humanDecision === 'REWORD' ? humanImprovementTaskType(humanDecision) : null;
      if (!human || !juryDecision || !humanDecision || !taskType || task.taskType !== taskType || human.reviewResultId !== review.id) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      if (execution.status !== 'COMPLETED') {
        return { ok: false as const, reason: 'EXECUTION_NOT_COMPLETED' as const };
      }
      if (containsSecret(execution.inputSnapshot) || containsSecret(execution.provenance)) {
        return { ok: false as const, reason: 'SNAPSHOT_UNSAFE' as const };
      }
      const lineage: Lineage = {
        reviewResultId: review.id,
        reviewRequestId: review.reviewRequestId,
        humanDecisionId: human.id,
        humanDecision,
        juryDecision,
        taskType,
      };
      const existing = await tx.juryChangeGateResult.findFirst({
        where: { executionId: execution.id, tenantId: actor.tenantId },
      });
      if (existing) {
        return {
          ok: true as const,
          created: false,
          evaluated: false,
          reviewId: review.id,
          agentExecutionId: execution.id,
          gate: viewOf(existing),
        };
      }
      const lineageWorkspace = parseWorkspaceRef(execution.workspaceRef);
      const inspectionWorkspace = lineageWorkspace
        ? inspectionWorkspaceForProduct(lineageWorkspace) ?? lineageWorkspace
        : null;
      const workspaceRoot = inspectionWorkspace ? resolveAllowedWorkspace(inspectionWorkspace) : null;
      const inspection = workspaceRoot ? await readInspection(readWorkspace, workspaceRoot) : { files: [], present: [] };
      const reported = readReported(execution.provenance);
      const writer = gateWriter(
        tx,
        actor.userId,
        actor.tenantId,
        lineage,
        stringList(execution.allowedPaths),
        lineageWorkspace,
        inspectionWorkspace,
      );
      const judged = await evaluateChangeGate(
        {
          userId: input.userId,
          memberships: input.memberships,
          clientTenantId: null,
          now: new Date().toISOString(),
          execution: {
            id: execution.id,
            tenantId: execution.tenantId,
            taskId: execution.taskId,
            status: execution.status,
            workspaceRef: inspectionWorkspace ?? execution.workspaceRef,
            provenance: null,
          },
          task: { id: task.id, tenantId: task.tenantId },
          agentReportedFiles: reported.files,
          testResults: reported.tests,
          inspection,
        },
        writer,
      );
      if (!judged.ok) {
        if (judged.reason === 'EXECUTION_NOT_COMPLETED') return { ok: false as const, reason: 'EXECUTION_NOT_COMPLETED' as const };
        if (judged.reason === 'FORBIDDEN') return { ok: false as const, reason: 'FORBIDDEN' as const };
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      return {
        ok: true as const,
        created: judged.created,
        evaluated: true,
        reviewId: review.id,
        agentExecutionId: execution.id,
        gate: viewOfDraft(judged.gate),
      };
    }, JURY_INTERACTIVE_TRANSACTION);
  } catch (error) {
    notePersistenceFailure('change-gate.persist', error);
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

export async function loadProductChangeGateStates(tenantId: string): Promise<Record<string, ProductGateState>> {
  const { prisma } = await import('@/lib/prisma');
  const executions = await prisma.juryAgentExecution.findMany({
    where: { tenantId, status: 'COMPLETED', agent: HUMAN_HANDOFF_AGENT },
    select: {
      id: true,
      taskId: true,
      provenance: true,
      task: { select: { id: true, provenance: true, reviewResultId: true } },
    },
  });
  const ids = executions
    .filter((row) => row.task && productExecutionProvenance(row.provenance, row.task.id) && productTaskProvenance(row.task.provenance, row.task.reviewResultId))
    .map((row) => row.id);
  if (ids.length === 0) return {};
  const gates = await prisma.juryChangeGateResult.findMany({
    where: { tenantId, executionId: { in: ids } },
    select: { executionId: true, status: true },
  });
  const byExecution = new Map(gates.map((row) => [row.executionId, row.status]));
  const states: Record<string, ProductGateState> = {};
  for (const id of ids) {
    const status = byExecution.get(id);
    states[id] = status === 'APPROVED' || status === 'BLOCKED' || status === 'GATED' ? status : 'PENDING';
  }
  return states;
}

async function readInspection(
  inspect: (relativeRoot: string) => Promise<InspectionResult>,
  relativeRoot: string,
): Promise<ChangeInspection> {
  const read = await inspect(relativeRoot);
  return read.ok ? { files: read.files, present: read.present } : { files: [], present: [] };
}

function gateWriter(
  tx: Prisma.TransactionClient,
  userId: string,
  tenantId: string,
  lineage: Lineage,
  allowedPaths: string[],
  lineageWorkspace: WorkspaceRef | null,
  inspectionWorkspace: WorkspaceRef | null,
): ChangeGateWriteTx {
  return {
    async findByExecution(executionId) {
      const row = await tx.juryChangeGateResult.findFirst({ where: { executionId, tenantId } });
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
            workspaceRef: lineageWorkspace ?? row.provenance.workspaceRef,
            inspectionWorkspaceRef: inspectionWorkspace,
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

function viewOf(row: {
  id: string;
  status: string | null;
  errorCode: string | null;
  discrepancy: boolean | null;
  discrepancyReasons: unknown;
  riskReasons: unknown;
  credentialDetected: boolean | null;
  testsPassed: boolean | null;
}): ProductChangeGateView {
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

function viewOfDraft(row: ChangeGateDraft): ProductChangeGateView {
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
  files: string[];
  tests: { available: boolean; passed: boolean | null; commands: string[] };
} {
  const empty = { files: [] as string[], tests: { available: false, passed: null, commands: [] as string[] } };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const result = (value as { result?: unknown }).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return empty;
  const row = result as { changedFiles?: unknown; testsRun?: unknown; testsPassed?: unknown };
  const files = Array.isArray(row.changedFiles) ? row.changedFiles.filter((item): item is string => typeof item === 'string') : [];
  const commands = Array.isArray(row.testsRun) ? row.testsRun.filter((item): item is string => typeof item === 'string') : [];
  const passed = typeof row.testsPassed === 'boolean' ? row.testsPassed : null;
  return { files, tests: { available: passed != null || commands.length > 0, passed, commands } };
}

function productTaskProvenance(value: unknown, reviewResultId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.kind === HUMAN_IMPROVEMENT_KIND && row.reviewResultId === reviewResultId;
}

function productExecutionProvenance(value: unknown, taskId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.reReviewResultId || row.changeGateResultId || row.sourceAgentExecutionId) return false;
  if (row.improvementTaskId !== taskId) return false;
  return row.kind === 'human-agent-handoff' || row.kind === 'human-agent-execution';
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
