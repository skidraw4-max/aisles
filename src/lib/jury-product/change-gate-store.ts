/**
 * Stores one read-only Change Gate result for a completed execution.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import type { JuryMembership, JuryRiskFlag } from './records';
import { JURY_RISK_FLAGS } from './records';
import {
  evaluateChangeGate,
  type ChangeGateDraft,
  type ChangeGateStatus,
  type ChangeInspection,
  type ChangeRiskLevel,
  type ChangeGateWriteTx,
} from './change-gate';
import { inspectAllowlistedWorkspace } from './change-gate-workspace';
import { resolveAllowedWorkspace } from './agent-workspace';
import { parseWorkspaceRef } from './agent-handoff';

type GateOutcome = Awaited<ReturnType<typeof evaluateChangeGate>>;

export async function persistChangeGate(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  executionId: string;
  inspect?: (relativeRoot: string) => Promise<
    | { ok: true; files: ChangeInspection['files']; present: string[] }
    | { ok: false; reason: 'WORKSPACE_NOT_ALLOWED' | 'WORKSPACE_ESCAPE' }
  >;
}): Promise<GateOutcome> {
  const { prisma } = await import('@/lib/prisma');
  const { resolveJuryActor } = await import('./access');
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return actor;
  const execution = await prisma.juryAgentExecution.findUnique({ where: { id: input.executionId } });
  if (!execution || execution.tenantId !== actor.tenantId) {
    return evaluateChangeGate(
      {
        ...input,
        execution: execution
          ? {
              id: execution.id,
              tenantId: execution.tenantId,
              taskId: execution.taskId,
              status: execution.status,
              workspaceRef: execution.workspaceRef,
              provenance: null,
            }
          : null,
        task: null,
        agentReportedFiles: [],
        testResults: { available: false, passed: null, commands: [] },
        inspection: null,
      },
      emptyTx(),
    );
  }
  const task = await prisma.juryImprovementTask.findUnique({ where: { id: execution.taskId } });
  const workspace = parseWorkspaceRef(execution.workspaceRef);
  const root = workspace ? resolveAllowedWorkspace(workspace) : null;
  const readWorkspace = input.inspect ?? inspectAllowlistedWorkspace;
  const inspection = root ? await readWorkspace(root) : { ok: false as const, reason: 'WORKSPACE_NOT_ALLOWED' as const };
  const reported = await readReported(execution.id, execution.resultRef);
  return prisma.$transaction(async (tx) =>
    evaluateChangeGate(
      {
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
        now: input.now,
        execution: {
          id: execution.id,
          tenantId: execution.tenantId,
          taskId: execution.taskId,
          status: execution.status,
          workspaceRef: execution.workspaceRef,
          provenance: asProvenance(execution.provenance),
        },
        task: task ? { id: task.id, tenantId: task.tenantId } : null,
        agentReportedFiles: reported.files,
        testResults: reported.tests,
        inspection: inspection.ok ? { files: inspection.files, present: inspection.present } : { files: [], present: [] },
      },
      prismaTx(tx, input.userId),
    ),
  );
}

function emptyTx(): ChangeGateWriteTx {
  return {
    async findByExecution() {
      return null;
    },
    async insert() {},
    async audit() {},
  };
}

async function readReported(
  executionId: string,
  resultRef: string | null,
): Promise<{ files: string[]; tests: { available: boolean; passed: boolean | null; commands: string[] } }> {
  const expected = `data/jury-product/agent-executions/${executionId}.json`;
  if (resultRef !== expected) return { files: [], tests: { available: false, passed: null, commands: [] } };
  try {
    const body = JSON.parse(await readFile(expected, 'utf8')) as {
      changedFiles?: unknown;
      testsRun?: unknown;
      testsPassed?: unknown;
    };
    const files = Array.isArray(body.changedFiles) ? body.changedFiles.filter((item): item is string => typeof item === 'string') : [];
    const commands = Array.isArray(body.testsRun) ? body.testsRun.filter((item): item is string => typeof item === 'string') : [];
    const available = typeof body.testsPassed === 'boolean' || commands.length > 0;
    const passed = typeof body.testsPassed === 'boolean' ? body.testsPassed : null;
    return { files, tests: { available, passed, commands } };
  } catch {
    return { files: [], tests: { available: false, passed: null, commands: [] } };
  }
}

function prismaTx(
  tx: {
    juryChangeGateResult: {
      findUnique(args: { where: { executionId: string } }): Promise<GateRow | null>;
      create(args: { data: Prisma.JuryChangeGateResultUncheckedCreateInput }): Promise<unknown>;
    };
    juryAuditEvent: {
      create(args: { data: Prisma.JuryAuditEventUncheckedCreateInput }): Promise<unknown>;
    };
  },
  userId: string | null,
): ChangeGateWriteTx {
  return {
    async findByExecution(executionId) {
      const row = await tx.juryChangeGateResult.findUnique({ where: { executionId } });
      return row ? mapGate(row) : null;
    },
    async insert(row) {
      await tx.juryChangeGateResult.create({ data: gateData(row) });
    },
    async audit(action, row) {
      const provenance = {
        agentExecutionId: row.executionId,
        improvementTaskId: row.improvementTaskId,
        status: row.status,
        riskLevel: row.riskLevel,
        discrepancy: row.discrepancy,
      };
      await tx.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([row.id, action].join('\n')).digest('hex'),
          tenantId: row.tenantId,
          timestamp: new Date(row.createdAt),
          actor: userId ?? 'unknown',
          action,
          improvementTaskId: row.improvementTaskId,
          agentExecutionId: row.executionId,
          provenance: provenance as Prisma.InputJsonValue,
        },
      });
    },
  };
}

type GateRow = {
  id: string;
  tenantId: string;
  executionId: string;
  improvementTaskId: string | null;
  status: ChangeGateStatus | null;
  gate: 'PASS' | 'NEEDS_APPROVAL' | 'BLOCK';
  changedFiles: unknown;
  addedFiles: unknown;
  modifiedFiles: unknown;
  deletedFiles: unknown;
  blockedFiles: unknown;
  riskFlags: unknown;
  riskLevel: ChangeRiskLevel | null;
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
};

function mapGate(row: GateRow): ChangeGateDraft {
  if (!row.status || !row.riskLevel || !row.improvementTaskId || !row.createdAt) throw new Error('GATE_SHAPE');
  const tests = row.testResults as ChangeGateDraft['testResults'] | null;
  const diff = row.diffStat as ChangeGateDraft['diffStat'] | null;
  const provenance = row.provenance as ChangeGateDraft['provenance'] | null;
  if (!tests || !diff || !provenance) throw new Error('GATE_SHAPE');
  return {
    id: row.id,
    tenantId: row.tenantId,
    executionId: row.executionId,
    improvementTaskId: row.improvementTaskId,
    status: row.status,
    gate: row.gate,
    changedFiles: asStrings(row.changedFiles),
    addedFiles: asStrings(row.addedFiles),
    modifiedFiles: asStrings(row.modifiedFiles),
    deletedFiles: asStrings(row.deletedFiles),
    blockedFiles: asStrings(row.blockedFiles),
    riskFlags: asFlags(row.riskFlags),
    riskLevel: row.riskLevel,
    riskReasons: asStrings(row.riskReasons),
    testsPassed: row.testsPassed,
    testResults: tests,
    agentReportedFiles: asStrings(row.agentReportedFiles),
    discrepancy: row.discrepancy === true,
    discrepancyReasons: asStrings(row.discrepancyReasons),
    diffStat: diff,
    credentialDetected: row.credentialDetected === true,
    credentialType: row.credentialType,
    errorCode: row.errorCode,
    provenance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? row.createdAt.toISOString(),
  };
}

function gateData(row: ChangeGateDraft): Prisma.JuryChangeGateResultUncheckedCreateInput {
  return {
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
    provenance: row.provenance as Prisma.InputJsonValue,
    errorCode: row.errorCode,
    credentialDetected: row.credentialDetected,
    credentialType: row.credentialType,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asFlags(value: unknown): JuryRiskFlag[] {
  return asStrings(value).filter((item): item is JuryRiskFlag => (JURY_RISK_FLAGS as readonly string[]).includes(item));
}

function asProvenance(value: unknown): { reviewResultId: string; decisionTaskId: string; evidenceId: string } | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { reviewResultId?: unknown; decisionTaskId?: unknown; evidenceId?: unknown };
  if (typeof row.reviewResultId !== 'string' || typeof row.decisionTaskId !== 'string' || typeof row.evidenceId !== 'string') {
    return null;
  }
  return { reviewResultId: row.reviewResultId, decisionTaskId: row.decisionTaskId, evidenceId: row.evidenceId };
}
