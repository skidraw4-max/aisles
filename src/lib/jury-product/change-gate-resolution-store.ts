/**
 * Stores a change-gate resolution. It does not re-run the gate or an agent.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { JuryMembership } from './records';
import {
  resolveChangeGate,
  type GateResolutionDraft,
  type ResolutionAction,
  type ResolutionCommand,
  type ResolutionWriteTx,
} from './change-gate-resolution';

type PrismaTx = {
  juryChangeGateResult: {
    updateMany(args: {
      where: { id: string; tenantId: string; status: 'GATED' };
      data: { status: 'APPROVED' | 'BLOCKED'; gate: 'PASS' | 'BLOCK'; updatedAt: Date };
    }): Promise<{ count: number }>;
  };
  juryChangeGateResolution: {
    findFirst(args: {
      where: { changeGateResultId: string; action: ResolutionAction; reasonFingerprint: string };
    }): Promise<ResolutionRow | null>;
    create(args: { data: Prisma.JuryChangeGateResolutionUncheckedCreateInput }): Promise<unknown>;
  };
  juryAuditEvent: {
    create(args: { data: Prisma.JuryAuditEventUncheckedCreateInput }): Promise<unknown>;
  };
};

type ResolutionOutcome = Awaited<ReturnType<typeof resolveChangeGate>>;

export async function persistChangeGateResolution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  changeGateResultId: string;
  action: string;
  reason: { code?: unknown; message?: unknown } | null;
}): Promise<ResolutionOutcome> {
  const { prisma } = await import('@/lib/prisma');
  return prisma.$transaction((tx) => applyChangeGateResolution(tx, input));
}

export async function applyChangeGateResolution(
  tx: {
    juryChangeGateResult: PrismaTx['juryChangeGateResult'] & {
      findUnique(args: { where: { id: string } }): Promise<GateRow | null>;
    };
    juryAgentExecution: {
      findUnique(args: { where: { id: string } }): Promise<{ tenantId: string; workspaceRef: unknown } | null>;
    };
    juryImprovementTask: { findUnique(args: { where: { id: string } }): Promise<{ tenantId: string } | null> };
    juryChangeGateResolution: PrismaTx['juryChangeGateResolution'];
    juryAuditEvent: PrismaTx['juryAuditEvent'];
  },
  input: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    changeGateResultId: string;
    action: string;
    reason: { code?: unknown; message?: unknown } | null;
  },
): Promise<ResolutionOutcome> {
  const gate = await tx.juryChangeGateResult.findUnique({ where: { id: input.changeGateResultId } });
  const execution = gate ? await tx.juryAgentExecution.findUnique({ where: { id: gate.executionId } }) : null;
  const task = gate?.improvementTaskId
    ? await tx.juryImprovementTask.findUnique({ where: { id: gate.improvementTaskId } })
    : null;
  const command: ResolutionCommand = {
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    action: input.action,
    reason: input.reason,
    gate: gate ? mapGate(gate, execution?.workspaceRef ?? null) : null,
    executionTenantId: execution?.tenantId ?? null,
    taskTenantId: task?.tenantId ?? null,
  };
  return resolveChangeGate(command, resolutionTx(tx, gate?.tenantId ?? ''));
}

function resolutionTx(tx: PrismaTx, tenantId: string): ResolutionWriteTx {
  return {
    async findResolution(changeGateResultId, action, fingerprint) {
      const row = await tx.juryChangeGateResolution.findFirst({
        where: { changeGateResultId, action, reasonFingerprint: fingerprint },
      });
      return row ? mapResolution(row) : null;
    },
    async updateStatus(changeGateResultId, _from, to) {
      const gateRow = await tx.juryChangeGateResult.updateMany({
        where: { id: changeGateResultId, tenantId, status: 'GATED' },
        data: { status: to, gate: to === 'APPROVED' ? 'PASS' : 'BLOCK', updatedAt: new Date() },
      });
      return gateRow.count === 1;
    },
    async insert(row) {
      await tx.juryChangeGateResolution.create({ data: resolutionData(row) });
    },
    async audit(action, row) {
      await tx.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([row.id, action].join('\n')).digest('hex'),
          tenantId: row.tenantId,
          timestamp: new Date(row.resolvedAt),
          actor: row.resolvedBy,
          action,
          improvementTaskId: row.improvementTaskId,
          agentExecutionId: row.agentExecutionId,
          provenance: {
            changeGateResultId: row.changeGateResultId,
            agentExecutionId: row.agentExecutionId,
            improvementTaskId: row.improvementTaskId,
            action: row.action,
            previousStatus: row.previousStatus,
            resultingStatus: row.resultingStatus,
            resolvedBy: row.resolvedBy,
          } as Prisma.InputJsonValue,
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
  status: 'GATED' | 'APPROVED' | 'BLOCKED' | null;
  changedFiles: unknown;
  blockedFiles: unknown;
  credentialDetected: boolean | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  discrepancy: boolean | null;
  provenance: unknown;
};

type ResolutionRow = {
  id: string;
  tenantId: string;
  changeGateResultId: string;
  agentExecutionId: string;
  improvementTaskId: string;
  action: ResolutionAction;
  previousStatus: 'GATED' | 'APPROVED' | 'BLOCKED';
  resultingStatus: 'GATED' | 'APPROVED' | 'BLOCKED';
  reason: unknown;
  reasonFingerprint: string;
  resolvedBy: string;
  resolvedAt: Date;
  provenance: unknown;
  createdAt: Date;
};

function mapGate(row: GateRow, executionWorkspace: unknown): ResolutionCommand['gate'] {
  if (!row.status || !row.riskLevel || !row.improvementTaskId) return null;
  const provenance = row.provenance as { workspaceRef?: unknown } | null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    executionId: row.executionId,
    improvementTaskId: row.improvementTaskId,
    status: row.status,
    changedFiles: asStrings(row.changedFiles),
    blockedFiles: asStrings(row.blockedFiles),
    credentialDetected: row.credentialDetected === true,
    riskLevel: row.riskLevel,
    discrepancy: row.discrepancy === true,
    workspaceRef: provenance?.workspaceRef ?? executionWorkspace,
  };
}

function mapResolution(row: ResolutionRow): GateResolutionDraft {
  const reason = row.reason as { code?: unknown; message?: unknown };
  return {
    id: row.id,
    tenantId: row.tenantId,
    changeGateResultId: row.changeGateResultId,
    agentExecutionId: row.agentExecutionId,
    improvementTaskId: row.improvementTaskId,
    action: row.action,
    previousStatus: row.previousStatus,
    resultingStatus: row.resultingStatus,
    reason: {
      code: typeof reason.code === 'string' ? reason.code : '',
      message: typeof reason.message === 'string' ? reason.message : '',
    },
    reasonFingerprint: row.reasonFingerprint,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt.toISOString(),
    provenance: row.provenance as GateResolutionDraft['provenance'],
    createdAt: row.createdAt.toISOString(),
  };
}

function resolutionData(row: GateResolutionDraft): Prisma.JuryChangeGateResolutionUncheckedCreateInput {
  return {
    id: row.id,
    tenantId: row.tenantId,
    changeGateResultId: row.changeGateResultId,
    agentExecutionId: row.agentExecutionId,
    improvementTaskId: row.improvementTaskId,
    action: row.action,
    previousStatus: row.previousStatus,
    resultingStatus: row.resultingStatus,
    reason: row.reason,
    reasonFingerprint: row.reasonFingerprint,
    resolvedBy: row.resolvedBy,
    resolvedAt: new Date(row.resolvedAt),
    provenance: row.provenance as Prisma.InputJsonValue,
    createdAt: new Date(row.createdAt),
  };
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
