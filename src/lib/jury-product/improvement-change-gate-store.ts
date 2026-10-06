/**
 * Returns an existing change-gate result, or stores one through the existing gate.
 * It does not resolve the gate or start a re-review.
 */
import { Prisma } from '@prisma/client';
import { persistChangeGate } from './change-gate-store';
import type { ChangeGateDraft, ChangeGateStatus, ChangeRiskLevel } from './change-gate';
import type { JuryMembership, JuryRiskFlag } from './records';
import { JURY_RISK_FLAGS } from './records';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function persistImprovementChangeGate(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  executionId: string;
  inspect?: Parameters<typeof persistChangeGate>[0]['inspect'];
}) {
  const { prisma } = await import('@/lib/prisma');
  const { resolveJuryActor } = await import('./access');
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return actor;
  const existing = await prisma.juryChangeGateResult.findUnique({ where: { executionId: input.executionId } });
  if (existing) {
    if (existing.tenantId !== actor.tenantId) return { ok: false as const, reason: 'TENANT_MISMATCH' as const };
    return { ok: true as const, created: false, gate: mapGate(existing) };
  }
  try {
    return await persistChangeGate(input);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const again = await prisma.juryChangeGateResult.findUnique({ where: { executionId: input.executionId } });
    if (!again || again.tenantId !== actor.tenantId) return { ok: false as const, reason: 'TENANT_MISMATCH' as const };
    return { ok: true as const, created: false, gate: mapGate(again) };
  }
}

function mapGate(row: {
  id: string;
  tenantId: string;
  executionId: string;
  improvementTaskId: string | null;
  status: ChangeGateStatus | null;
  gate: ChangeGateDraft['gate'];
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
}): ChangeGateDraft {
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

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asFlags(value: unknown): JuryRiskFlag[] {
  return asStrings(value).filter((item): item is JuryRiskFlag => (JURY_RISK_FLAGS as readonly string[]).includes(item));
}
