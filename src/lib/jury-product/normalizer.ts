/**
 * Turns an existing EvidencePack into product metrics.
 * It reads the pack and does not write back to it.
 */
import type { EvidencePack } from '@/lib/ai-review-board/types';
import {
  JURY_GA4_EVENT_PREFIX,
  JURY_PROJECTABLE_DB_METRICS,
  JURY_PROJECTABLE_GA4_METRICS,
} from './projection';
import type { JuryAvailability, JuryMetricUnit, JuryNormalizedMetric, JurySourceSystem } from './records';

export const AISLE_ADAPTER_KEY = 'aisle-self';
export const AISLE_ADAPTER_VERSION = 'aisle-self-v1';
export const DB_RULE_ID = 'normalize.evidence-pack.aggregate.v1';
export const GA4_RULE_ID = 'normalize.evidence-pack.ga4.v1';

export function applyAvailability(
  availability: JuryAvailability,
  value: number | null,
): { availability: JuryAvailability; value: number | null } {
  if (availability !== 'AVAILABLE') return { availability, value: null };
  if (typeof value === 'number' && Number.isFinite(value)) return { availability: 'AVAILABLE', value };
  return { availability: 'NOT_MEASURED', value: null };
}

type DraftMetric = Omit<JuryNormalizedMetric, 'id' | 'evidenceId'>;

function draft(input: {
  tenantId: string;
  connectionId: string;
  metric: string;
  raw: number | null;
  availability: JuryAvailability;
  unit: JuryMetricUnit;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  sourceSystem: JurySourceSystem;
  sourceRef: string;
  collectedAt: string;
  ruleId: string;
}): DraftMetric {
  const measured = applyAvailability(input.availability, input.raw);
  return {
    tenantId: input.tenantId,
    connectionId: input.connectionId,
    metric: input.metric,
    value: measured.value,
    unit: input.unit,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    timezone: input.timezone,
    sourceSystem: input.sourceSystem,
    sourceRef: input.sourceRef,
    collectedAt: input.collectedAt,
    availability: measured.availability,
    rawValueText: measured.value === null ? 'null' : String(measured.value),
    rawPayloadRef: `evidence-pack:${input.sourceRef}`,
    adapterKey: AISLE_ADAPTER_KEY,
    adapterVersion: AISLE_ADAPTER_VERSION,
    ruleId: input.ruleId,
  };
}

function ga4BlockAvailability(pack: EvidencePack): JuryAvailability {
  if (!pack.ga4 || pack.ga4.available) return 'AVAILABLE';
  if (pack.ga4.errorCode === 'PROPERTY_ACCESS' || pack.ga4.errorCode === 'INVALID_CREDENTIALS') {
    return 'PERMISSION_DENIED';
  }
  if (pack.ga4.errorCode === 'API_ERROR') return 'COLLECTION_FAILED';
  return 'NOT_AVAILABLE';
}

function ga4Number(pack: EvidencePack, metric: (typeof JURY_PROJECTABLE_GA4_METRICS)[number]): number | null {
  const ga4 = pack.ga4;
  if (!ga4) return null;
  if (metric === 'ga4.newUsers') return ga4.users?.newUsers ?? null;
  if (metric === 'ga4.activeUsers') return ga4.metrics.activeUsers;
  if (metric === 'ga4.screenPageViews') return ga4.metrics.screenPageViews;
  if (metric === 'ga4.sessions') return ga4.metrics.sessions;
  if (metric === 'ga4.engagedSessions') return ga4.metrics.engagedSessions;
  return ga4.metrics.averageSessionDurationSec;
}

function ga4SourceRef(metric: (typeof JURY_PROJECTABLE_GA4_METRICS)[number]): string {
  if (metric === 'ga4.newUsers') return 'ga4.users.newUsers';
  if (metric === 'ga4.activeUsers') return 'ga4.metrics.activeUsers';
  if (metric === 'ga4.screenPageViews') return 'ga4.metrics.screenPageViews';
  if (metric === 'ga4.sessions') return 'ga4.metrics.sessions';
  if (metric === 'ga4.engagedSessions') return 'ga4.metrics.engagedSessions';
  return 'ga4.metrics.averageSessionDurationSec';
}

export function draftNormalizedMetrics(input: {
  tenantId: string;
  connectionId: string;
  pack: EvidencePack;
}): DraftMetric[] {
  const period = input.pack.analysisPeriod;
  if (!period || period.timezone !== 'Asia/Seoul') return [];
  const collectedAt = input.pack.generatedAt;
  const common = {
    tenantId: input.tenantId,
    connectionId: input.connectionId,
    periodStart: period.start,
    periodEnd: period.end,
    timezone: period.timezone,
    collectedAt,
  };
  const db = JURY_PROJECTABLE_DB_METRICS.map((metric) =>
    draft({
      ...common,
      metric,
      raw: input.pack.aggregates[metric],
      availability: input.pack.aggregates[metric] === null ? 'NOT_MEASURED' : 'AVAILABLE',
      unit: 'COUNT',
      sourceSystem: 'DATABASE',
      sourceRef: `aggregates.${metric}`,
      ruleId: DB_RULE_ID,
    }),
  );
  const blockAvailability = ga4BlockAvailability(input.pack);
  const ga4Available = Boolean(input.pack.ga4?.available);
  const ga4CollectedAt = input.pack.ga4?.fetchedAt ?? collectedAt;
  const ga4 = JURY_PROJECTABLE_GA4_METRICS.map((metric) => {
    const raw = ga4Available ? ga4Number(input.pack, metric) : null;
    const availability = !input.pack.ga4
      ? 'NOT_AVAILABLE'
      : ga4Available
        ? raw === null
          ? 'NOT_MEASURED'
          : 'AVAILABLE'
        : blockAvailability;
    return draft({
      ...common,
      metric,
      raw,
      availability,
      unit: metric === 'ga4.averageSessionDurationSec' ? 'DURATION_SEC' : 'COUNT',
      sourceSystem: 'GA4',
      sourceRef: ga4SourceRef(metric),
      collectedAt: ga4CollectedAt,
      ruleId: GA4_RULE_ID,
    });
  });
  const events = ga4Available
    ? Object.keys(input.pack.ga4?.metrics.eventCountByName ?? {})
        .sort()
        .map((eventName) => {
          const raw = input.pack.ga4?.metrics.eventCountByName[eventName] ?? null;
          return draft({
            ...common,
            metric: `${JURY_GA4_EVENT_PREFIX}${eventName}`,
            raw,
            availability: raw === null ? 'NOT_MEASURED' : 'AVAILABLE',
            unit: 'COUNT',
            sourceSystem: 'GA4',
            sourceRef: `ga4.metrics.eventCountByName.${eventName}`,
            collectedAt: ga4CollectedAt,
            ruleId: GA4_RULE_ID,
          });
        })
    : [];
  return [...db, ...ga4, ...events];
}
