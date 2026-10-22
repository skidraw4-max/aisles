/**
 * Builds product Evidence from normalized metrics.
 * Nothing here is written to the database.
 */
import { createHash } from 'node:crypto';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { applyAvailability, draftNormalizedMetrics } from './normalizer';
import type { JuryEvidence, JuryNormalizedMetric } from './records';

export { applyAvailability } from './normalizer';

export type ProductEvidenceFailure = 'TENANT_MISMATCH' | 'TIMEZONE_UNSUPPORTED' | 'PACK_NOT_READ_ONLY';

export type BuiltJuryEvidence = JuryEvidence & { piiExcluded: true; readOnly: true };

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export function buildProductEvidence(input: {
  actorTenantId: string;
  connection: { id: string; tenantId: string };
  clientTenantId?: string | null;
  pack: EvidencePack;
}): { ok: true; metrics: JuryNormalizedMetric[]; evidence: BuiltJuryEvidence } | { ok: false; reason: ProductEvidenceFailure } {
  void input.clientTenantId;
  if (input.connection.tenantId !== input.actorTenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (input.pack.piiExcluded !== true || input.pack.readOnly !== true) return { ok: false, reason: 'PACK_NOT_READ_ONLY' };
  const period = input.pack.analysisPeriod;
  if (!period || period.timezone !== 'Asia/Seoul') return { ok: false, reason: 'TIMEZONE_UNSUPPORTED' };
  const drafts = draftNormalizedMetrics({
    tenantId: input.actorTenantId,
    connectionId: input.connection.id,
    pack: input.pack,
  });
  const metrics: JuryNormalizedMetric[] = drafts.map((row) => ({
    ...row,
    id: stableId([
      row.tenantId,
      row.connectionId,
      row.metric,
      row.sourceSystem,
      row.periodStart,
      row.periodEnd,
      row.availability,
      row.value === null ? 'null' : String(row.value),
    ]),
  }));
  const evidenceId = stableId([input.actorTenantId, input.connection.id, period.start, period.end, ...metrics.map((metric) => metric.id)]);
  const linked = metrics.map((metric) => ({ ...metric, evidenceId }));
  const canonical = linked.map((metric) => ({
    metric: metric.metric,
    value: metric.value,
    availability: metric.availability,
    sourceSystem: metric.sourceSystem,
    sourceRef: metric.sourceRef,
    ruleId: metric.ruleId,
  }));
  const evidence: BuiltJuryEvidence = {
    id: evidenceId,
    tenantId: input.actorTenantId,
    connectionId: input.connection.id,
    purpose: 'aisle-self-observation',
    periodStart: period.start,
    periodEnd: period.end,
    timezone: period.timezone,
    metricIds: linked.map((metric) => metric.id),
    apiEvidence: [
      {
        endpoint: 'buildEvidencePackFromDb',
        payloadRef: 'evidence-pack:aggregates',
        requestedAt: input.pack.generatedAt,
      },
      ...(input.pack.ga4
        ? [
            {
              endpoint: 'attachGa4Evidence',
              payloadRef: 'evidence-pack:ga4',
              requestedAt: input.pack.ga4.fetchedAt ?? input.pack.generatedAt,
            },
          ]
        : []),
    ],
    adapterKey: 'aisle-self',
    collectedAt: input.pack.generatedAt,
    contentHash: stableId([JSON.stringify(canonical)]),
    piiExcluded: true,
    readOnly: true,
  };
  return { ok: true, metrics: linked, evidence };
}
