/**
 * Stores declared catalog metrics as tenant evidence and one completion audit.
 * Validation failures write nothing. A metric insert failure rolls the transaction back.
 */
import { Prisma } from '@prisma/client';
import {
  authorizeTenantIntake,
  buildDeclaredEvidence,
  intakeAuditId,
  precheckDeclaredIntake,
  TENANT_INTAKE_AUDIT,
  TENANT_INTAKE_PURPOSE,
  type DeclaredEvidenceDraft,
  type IntakeFailure,
  type NormalizedDeclaredMetric,
  type TenantEvidenceIntakeInput,
} from './tenant-evidence-intake';

export type IntakeWriteResult =
  | {
      ok: true;
      created: boolean;
      evidenceId: string;
      contentHash: string;
      scopeId: string;
      metrics: NormalizedDeclaredMetric[];
    }
  | { ok: false; reason: IntakeFailure };

type ConnectionRow = { id: string; tenantId: string; serviceKey: string };
type ScopeRow = { id: string; tenantId: string; connectionId: string; status: string; grants: unknown };

export type IntakeTx = {
  lockConnection(tenantId: string, connectionId: string): Promise<ConnectionRow | null>;
  lockScope(tenantId: string, scopeId: string): Promise<ScopeRow | null>;
  findEvidence(identity: {
    tenantId: string;
    connectionId: string;
    purpose: string;
    periodStart: string;
    periodEnd: string;
    timezone: string;
    contentHash: string;
  }): Promise<{ id: string; contentHash: string } | null>;
  insertEvidence(row: DeclaredEvidenceDraft): Promise<void>;
  insertMetric(row: NormalizedDeclaredMetric): Promise<void>;
  findAudit(id: string): Promise<{ id: string } | null>;
  insertAudit(row: {
    id: string;
    tenantId: string;
    actor: string;
    timestamp: string;
    scopeId: string;
    evidenceId: string;
    serviceKey: string;
    created: boolean;
  }): Promise<void>;
};

export async function commitTenantEvidenceIntake(
  input: TenantEvidenceIntakeInput,
  boundary: { transaction<T>(work: (tx: IntakeTx) => Promise<T>): Promise<T> },
): Promise<IntakeWriteResult> {
  const auth = authorizeTenantIntake(input);
  if (!auth.ok) return auth;
  const precheck = precheckDeclaredIntake(input);
  if (!precheck.ok) return precheck;
  try {
    return await boundary.transaction(async (tx) => {
      const connection = await tx.lockConnection(auth.actor.tenantId, input.connectionId);
      if (!connection || connection.tenantId !== auth.actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
      const scope = await tx.lockScope(auth.actor.tenantId, input.scopeId);
      if (!scope || scope.tenantId !== auth.actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
      if (scope.connectionId !== connection.id) return { ok: false, reason: 'SCOPE_CONNECTION_MISMATCH' };
      if (scope.status !== 'APPROVED') return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
      const built = buildDeclaredEvidence({
        tenantId: auth.actor.tenantId,
        connectionId: connection.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        metrics: input.metrics,
        sourceSystem: input.sourceSystem as 'FILE' | 'OTHER',
        sourceRef: input.sourceRef,
        adapterKey: input.adapterKey,
        adapterVersion: input.adapterVersion,
        now: input.now,
        grants: grantsOf(scope.grants),
      });
      if (!built.ok) return built;
      const identity = {
        tenantId: built.evidence.tenantId,
        connectionId: built.evidence.connectionId,
        purpose: built.evidence.purpose,
        periodStart: built.evidence.periodStart,
        periodEnd: built.evidence.periodEnd,
        timezone: built.evidence.timezone,
        contentHash: built.evidence.contentHash,
      };
      let created = false;
      let evidenceId = built.evidence.id;
      const existing = await tx.findEvidence(identity);
      if (existing) {
        evidenceId = existing.id;
      } else {
        try {
          await tx.insertEvidence(built.evidence);
          created = true;
        } catch (error) {
          if (!uniqueViolation(error)) throw error;
          const raced = await tx.findEvidence(identity);
          if (!raced) throw error;
          evidenceId = raced.id;
        }
        if (created) {
          for (const metric of built.metrics) await tx.insertMetric(metric);
        }
      }
      const auditId = intakeAuditId(auth.actor.tenantId, evidenceId, scope.id);
      const audit = await tx.findAudit(auditId);
      if (!audit) {
        await tx.insertAudit({
          id: auditId,
          tenantId: auth.actor.tenantId,
          actor: auth.actor.userId,
          timestamp: input.now,
          scopeId: scope.id,
          evidenceId,
          serviceKey: connection.serviceKey,
          created,
        });
      }
      return {
        ok: true,
        created,
        evidenceId,
        contentHash: built.evidence.contentHash,
        scopeId: scope.id,
        metrics: built.metrics.map((metric) => ({ ...metric, evidenceId })),
      };
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

export async function persistTenantEvidenceIntake(input: TenantEvidenceIntakeInput): Promise<IntakeWriteResult> {
  const { prisma } = await import('@/lib/prisma');
  return commitTenantEvidenceIntake(input, {
    transaction: (work) => prisma.$transaction((tx) => work(prismaIntakeTx(tx))),
  });
}

function grantsOf(value: unknown): Array<{ resource?: unknown; mode?: unknown }> {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object') as Array<{ resource?: unknown; mode?: unknown }>;
}

function uniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function prismaIntakeTx(tx: Prisma.TransactionClient): IntakeTx {
  return {
    async lockConnection(tenantId, connectionId) {
      const rows = await tx.$queryRaw<ConnectionRow[]>(
        Prisma.sql`SELECT id, "tenantId", "serviceKey" FROM "JuryServiceConnection" WHERE id = ${connectionId} AND "tenantId" = ${tenantId} FOR UPDATE`,
      );
      return rows[0] ?? null;
    },
    async lockScope(tenantId, scopeId) {
      const rows = await tx.$queryRaw<ScopeRow[]>(
        Prisma.sql`SELECT id, "tenantId", "connectionId", status::text AS status, grants FROM "JuryAccessScope" WHERE id = ${scopeId} AND "tenantId" = ${tenantId} FOR UPDATE`,
      );
      return rows[0] ?? null;
    },
    async findEvidence(identity) {
      const rows = await tx.$queryRaw<Array<{ id: string; contentHash: string }>>(Prisma.sql`
        SELECT id, "contentHash" FROM "JuryEvidence"
        WHERE "tenantId" = ${identity.tenantId}
          AND "connectionId" = ${identity.connectionId}
          AND purpose = ${identity.purpose}
          AND "periodStart" = ${identity.periodStart}
          AND "periodEnd" = ${identity.periodEnd}
          AND timezone = ${identity.timezone}
          AND "contentHash" = ${identity.contentHash}
        FOR UPDATE
      `);
      return rows[0] ?? null;
    },
    async insertEvidence(row) {
      await tx.juryEvidence.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          connectionId: row.connectionId,
          purpose: row.purpose,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          timezone: row.timezone,
          metricIds: row.metricIds,
          apiEvidence: [{ endpoint: 'tenant-declared', payloadRef: row.payloadRef, requestedAt: row.collectedAt }],
          adapterKey: row.adapterKey,
          collectedAt: new Date(row.collectedAt),
          contentHash: row.contentHash,
          piiExcluded: true,
          readOnly: true,
        },
      });
    },
    async insertMetric(row) {
      await tx.juryNormalizedMetric.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          connectionId: row.connectionId,
          evidenceId: row.evidenceId,
          metric: row.metric,
          value: row.value,
          unit: row.unit,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          timezone: row.timezone,
          sourceSystem: row.sourceSystem,
          sourceRef: row.sourceRef,
          collectedAt: new Date(row.collectedAt),
          availability: row.availability,
          rawValueText: row.rawValueText,
          rawPayloadRef: row.rawPayloadRef,
          adapterKey: row.adapterKey,
          adapterVersion: row.adapterVersion,
          ruleId: row.ruleId,
        },
      });
    },
    async findAudit(id) {
      return tx.juryAuditEvent.findUnique({ where: { id }, select: { id: true } });
    },
    async insertAudit(row) {
      await tx.juryAuditEvent.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          timestamp: new Date(row.timestamp),
          actor: row.actor,
          action: TENANT_INTAKE_AUDIT,
          scopeId: row.scopeId,
          evidenceId: row.evidenceId,
          serviceKey: row.serviceKey,
          provenance: { purpose: TENANT_INTAKE_PURPOSE, created: row.created },
        },
      });
    },
  };
}
