/**
 * Stores product evidence. It does not reinterpret measurements.
 * The database unique key is designed in a migration that is not applied here.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { BuiltJuryEvidence } from './evidence-builder';
import type { JuryEvidence, JuryNormalizedMetric } from './records';

export type EvidenceIdentity = {
  tenantId: string;
  connectionId: string;
  purpose: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  contentHash: string;
};

export type EvidenceWriteTx = {
  findConnection(tenantId: string, connectionId: string): Promise<{ id: string; tenantId: string } | null>;
  findByIdentity(identity: EvidenceIdentity): Promise<BuiltJuryEvidence | null>;
  listMetrics(evidenceId: string): Promise<JuryNormalizedMetric[]>;
  insertEvidence(row: BuiltJuryEvidence): Promise<void>;
  insertMetrics(rows: JuryNormalizedMetric[]): Promise<void>;
};

export type PersistCommand = {
  actorTenantId: string;
  connectionId: string;
  clientTenantId?: string | null;
  evidence: BuiltJuryEvidence;
  metrics: JuryNormalizedMetric[];
};

export type PersistResult =
  | { ok: true; created: boolean; evidence: BuiltJuryEvidence; metrics: JuryNormalizedMetric[] }
  | { ok: false; reason: 'TENANT_MISMATCH' | 'PACK_NOT_READ_ONLY' | 'HASH_REQUIRED' };

function identityOf(evidence: BuiltJuryEvidence): EvidenceIdentity | null {
  if (!evidence.contentHash) return null;
  return {
    tenantId: evidence.tenantId,
    connectionId: evidence.connectionId,
    purpose: evidence.purpose,
    periodStart: evidence.periodStart,
    periodEnd: evidence.periodEnd,
    timezone: evidence.timezone,
    contentHash: evidence.contentHash,
  };
}

function uniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === 'P2002' || code === '23505';
}

export async function runProductEvidencePersist(command: PersistCommand, tx: EvidenceWriteTx): Promise<PersistResult> {
  void command.clientTenantId;
  const { evidence, metrics } = command;
  if (evidence.tenantId !== command.actorTenantId || evidence.connectionId !== command.connectionId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (metrics.some((metric) => metric.tenantId !== command.actorTenantId || metric.connectionId !== command.connectionId)) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const connection = await tx.findConnection(command.actorTenantId, command.connectionId);
  if (!connection || connection.tenantId !== command.actorTenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (evidence.piiExcluded !== true || evidence.readOnly !== true) return { ok: false, reason: 'PACK_NOT_READ_ONLY' };
  const identity = identityOf(evidence);
  if (!identity) return { ok: false, reason: 'HASH_REQUIRED' };
  const existing = await tx.findByIdentity(identity);
  if (existing) return { ok: true, created: false, evidence: existing, metrics: await tx.listMetrics(existing.id) };
  try {
    await tx.insertEvidence(evidence);
    await tx.insertMetrics(metrics);
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    const raced = await tx.findByIdentity(identity);
    if (!raced) throw error;
    return { ok: true, created: false, evidence: raced, metrics: await tx.listMetrics(raced.id) };
  }
  const stored = await tx.findByIdentity(identity);
  if (!stored) throw new Error('product evidence was not readable after insert');
  return { ok: true, created: true, evidence: stored, metrics: await tx.listMetrics(stored.id) };
}

export async function commitProductEvidence(
  command: PersistCommand,
  boundary: { transaction<T>(work: (tx: EvidenceWriteTx) => Promise<T>): Promise<T> },
): Promise<PersistResult> {
  return boundary.transaction((tx) => runProductEvidencePersist(command, tx));
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

function jsonArray<T>(value: unknown): T[] | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function mapEvidence(row: Record<string, unknown>): BuiltJuryEvidence {
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    connectionId: text(row.connectionId),
    purpose: text(row.purpose),
    periodStart: text(row.periodStart),
    periodEnd: text(row.periodEnd),
    timezone: text(row.timezone),
    metricIds: jsonArray<string>(row.metricIds) ?? [],
    ...(jsonArray(row.apiEvidence) ? { apiEvidence: jsonArray(row.apiEvidence) } : {}),
    ...(jsonArray(row.uiEvidence) ? { uiEvidence: jsonArray(row.uiEvidence) } : {}),
    ...(jsonArray(row.documentEvidence) ? { documentEvidence: jsonArray(row.documentEvidence) } : {}),
    adapterKey: text(row.adapterKey),
    collectedAt: iso(row.collectedAt),
    ...(typeof row.contentHash === 'string' ? { contentHash: row.contentHash } : {}),
    piiExcluded: true,
    readOnly: true,
  };
}

function mapMetric(row: Record<string, unknown>): JuryNormalizedMetric {
  const value = row.value == null ? null : Number(row.value);
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    connectionId: text(row.connectionId),
    ...(typeof row.evidenceId === 'string' ? { evidenceId: row.evidenceId } : {}),
    metric: text(row.metric),
    value: value == null || Number.isNaN(value) ? null : value,
    unit: text(row.unit) as JuryNormalizedMetric['unit'],
    periodStart: text(row.periodStart),
    periodEnd: text(row.periodEnd),
    timezone: text(row.timezone),
    sourceSystem: text(row.sourceSystem) as JuryNormalizedMetric['sourceSystem'],
    sourceRef: text(row.sourceRef),
    collectedAt: iso(row.collectedAt),
    availability: text(row.availability) as JuryNormalizedMetric['availability'],
    ...(typeof row.rawValueText === 'string' ? { rawValueText: row.rawValueText } : {}),
    rawPayloadRef: text(row.rawPayloadRef),
    adapterKey: text(row.adapterKey),
    adapterVersion: text(row.adapterVersion),
    ruleId: text(row.ruleId),
  };
}

function prismaEvidenceTx(tx: Tx): EvidenceWriteTx {
  return {
    async findConnection(tenantId, connectionId) {
      const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string }>>(
        Prisma.sql`SELECT id, "tenantId" FROM "JuryServiceConnection" WHERE id = ${connectionId} AND "tenantId" = ${tenantId} FOR UPDATE`,
      );
      return rows[0] ?? null;
    },
    async findByIdentity(identity) {
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT id, "tenantId", "connectionId", purpose, "periodStart", "periodEnd", timezone,
               "metricIds", "apiEvidence", "uiEvidence", "documentEvidence", "adapterKey",
               "collectedAt", "contentHash", "piiExcluded", "readOnly"
        FROM "JuryEvidence"
        WHERE "tenantId" = ${identity.tenantId}
          AND "connectionId" = ${identity.connectionId}
          AND purpose = ${identity.purpose}
          AND "periodStart" = ${identity.periodStart}
          AND "periodEnd" = ${identity.periodEnd}
          AND timezone = ${identity.timezone}
          AND "contentHash" = ${identity.contentHash}
        FOR UPDATE
      `);
      const row = rows[0];
      if (!row || row.piiExcluded !== true || row.readOnly !== true) return null;
      return mapEvidence(row);
    },
    async listMetrics(evidenceId) {
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`SELECT * FROM "JuryNormalizedMetric" WHERE "evidenceId" = ${evidenceId} ORDER BY id`,
      );
      return rows.map(mapMetric);
    },
    async insertEvidence(row) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "JuryEvidence" (
          id, "tenantId", "connectionId", purpose, "periodStart", "periodEnd", timezone,
          "metricIds", "apiEvidence", "uiEvidence", "documentEvidence", "adapterKey",
          "collectedAt", "contentHash", "piiExcluded", "readOnly"
        ) VALUES (
          ${row.id}, ${row.tenantId}, ${row.connectionId}, ${row.purpose}, ${row.periodStart},
          ${row.periodEnd}, ${row.timezone}, ${JSON.stringify(row.metricIds)}::jsonb,
          ${row.apiEvidence ? JSON.stringify(row.apiEvidence) : null}::jsonb,
          ${row.uiEvidence ? JSON.stringify(row.uiEvidence) : null}::jsonb,
          ${row.documentEvidence ? JSON.stringify(row.documentEvidence) : null}::jsonb,
          ${row.adapterKey}, ${new Date(row.collectedAt)}, ${row.contentHash ?? null},
          ${row.piiExcluded}, ${row.readOnly}
        )
      `);
    },
    async insertMetrics(rows) {
      for (const row of rows) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "JuryNormalizedMetric" (
            id, "tenantId", "connectionId", "evidenceId", metric, value, unit,
            "periodStart", "periodEnd", timezone, "sourceSystem", "sourceRef", "collectedAt",
            availability, "rawValueText", "rawPayloadRef", "adapterKey", "adapterVersion", "ruleId"
          ) VALUES (
            ${row.id}, ${row.tenantId}, ${row.connectionId}, ${row.evidenceId ?? null}, ${row.metric},
            ${row.value}, ${row.unit}::"JuryMetricUnit", ${row.periodStart}, ${row.periodEnd}, ${row.timezone},
            ${row.sourceSystem}::"JurySourceSystem", ${row.sourceRef}, ${new Date(row.collectedAt)},
            ${row.availability}::"JuryAvailability", ${row.rawValueText ?? null}, ${row.rawPayloadRef},
            ${row.adapterKey}, ${row.adapterVersion}, ${row.ruleId}
          )
        `);
      }
    },
  };
}

export async function persistProductEvidence(command: PersistCommand): Promise<PersistResult> {
  const { prisma } = await import('@/lib/prisma');
  return commitProductEvidence(command, {
    transaction: (work) => prisma.$transaction((tx) => work(prismaEvidenceTx(tx))),
  });
}
