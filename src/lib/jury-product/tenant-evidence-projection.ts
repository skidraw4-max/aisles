/**
 * Declared tenant metrics become an EvidencePack.
 * Host databases and GA4 credentials are not read.
 */
import { GA4_EVIDENCE_METRIC_DEFINITIONS } from '../ai-review-board/ga4-evidence';
import { EVIDENCE_METRIC_DEFINITIONS, type EvidencePack } from '../ai-review-board/types';
import type { Ga4CatalogEvidenceItem } from '../ai-review-board/ga4-evidence';
import {
  JURY_GA4_EVENT_PREFIX,
  JURY_PROJECTABLE_DB_METRICS,
  JURY_PROJECTABLE_GA4_METRICS,
} from './projection';
import type { JuryEvidence, JuryNormalizedMetric } from './records';

export type TenantProjectionInput = {
  evidence: JuryEvidence & { piiExcluded: boolean; readOnly: boolean };
  metrics: readonly JuryNormalizedMetric[];
  generatedAt: string;
  siteName: string;
};

export type TenantProjection =
  | {
      ok: true;
      tenantId: string;
      evidenceId: string;
      connectionId: string;
      pack: EvidencePack;
    }
  | { ok: false; reason: 'PROJECTION_FAILED' };

const DECLARED_SOURCES = new Set(['OTHER', 'FILE']);

export function projectTenantEvidenceToPack(input: TenantProjectionInput): TenantProjection {
  const { evidence } = input;
  if (!evidence.id || !evidence.tenantId || !evidence.connectionId) return { ok: false, reason: 'PROJECTION_FAILED' };
  if (evidence.piiExcluded !== true || evidence.readOnly !== true) return { ok: false, reason: 'PROJECTION_FAILED' };
  if (evidence.timezone !== 'Asia/Seoul' || !evidence.periodStart || !evidence.periodEnd) {
    return { ok: false, reason: 'PROJECTION_FAILED' };
  }
  if (!input.siteName.trim() || Number.isNaN(new Date(input.generatedAt).getTime())) {
    return { ok: false, reason: 'PROJECTION_FAILED' };
  }
  const byId = new Map(input.metrics.map((metric) => [metric.id, metric]));
  if (evidence.metricIds.length !== byId.size) return { ok: false, reason: 'PROJECTION_FAILED' };
  for (const metricId of evidence.metricIds) {
    const metric = byId.get(metricId);
    if (!metric || metric.evidenceId !== evidence.id) return { ok: false, reason: 'PROJECTION_FAILED' };
    if (metric.tenantId !== evidence.tenantId || metric.connectionId !== evidence.connectionId) {
      return { ok: false, reason: 'PROJECTION_FAILED' };
    }
    if (!DECLARED_SOURCES.has(metric.sourceSystem)) return { ok: false, reason: 'PROJECTION_FAILED' };
  }

  const aggregates: EvidencePack['aggregates'] = {
    userCount: null,
    usersLast7d: null,
    newUsersLast7d: null,
    activeUsersLast7d: null,
    postCount: null,
    postsLast7d: null,
    commentsLast7d: null,
    viewsLast7d: null,
    totalViews: null,
    commentCount: null,
    postsByCategory: {},
  };
  const ga4Metrics: Array<{ name: string; value: number | null }> = [];
  for (const metric of input.metrics) {
    const value = measuredValue(metric);
    if ((JURY_PROJECTABLE_DB_METRICS as readonly string[]).includes(metric.metric)) {
      aggregates[metric.metric as (typeof JURY_PROJECTABLE_DB_METRICS)[number]] = value;
      continue;
    }
    if (
      (JURY_PROJECTABLE_GA4_METRICS as readonly string[]).includes(metric.metric) ||
      isEventMetric(metric.metric)
    ) {
      ga4Metrics.push({ name: metric.metric, value });
    }
  }

  const pack: EvidencePack = {
    generatedAt: input.generatedAt,
    site: { name: input.siteName.trim(), corridors: [], stackNotes: [] },
    aggregates,
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    docsHints: [],
    piiExcluded: true,
    readOnly: true,
    analysisPeriod: {
      start: evidence.periodStart,
      end: evidence.periodEnd,
      timezone: 'Asia/Seoul',
    },
  };
  if (ga4Metrics.length > 0) {
    pack.ga4 = ga4Block(evidence, ga4Metrics);
  }
  pack.evidenceItems = catalogItems(pack);
  return {
    ok: true,
    tenantId: evidence.tenantId,
    evidenceId: evidence.id,
    connectionId: evidence.connectionId,
    pack,
  };
}

function measuredValue(metric: JuryNormalizedMetric): number | null {
  if (metric.availability !== 'AVAILABLE') return null;
  if (typeof metric.value === 'number' && Number.isFinite(metric.value)) return metric.value;
  return null;
}

function isEventMetric(metric: string): boolean {
  if (!metric.startsWith(JURY_GA4_EVENT_PREFIX)) return false;
  return /^[A-Za-z0-9_]+$/.test(metric.slice(JURY_GA4_EVENT_PREFIX.length));
}

function ga4Block(
  evidence: TenantProjectionInput['evidence'],
  metrics: readonly { name: string; value: number | null }[],
): NonNullable<EvidencePack['ga4']> {
  const block: NonNullable<EvidencePack['ga4']> = {
    available: false,
    propertyId: null,
    range: { startDate: evidence.periodStart, endDate: evidence.periodEnd },
    period: { start: evidence.periodStart, end: evidence.periodEnd, timezone: 'Asia/Seoul' },
    fetchedAt: null,
    error: 'GA4 metrics on this evidence are not available',
    errorCode: 'NOT_CONFIGURED',
    metrics: {
      activeUsers: null,
      sessions: null,
      screenPageViews: null,
      engagedSessions: null,
      averageSessionDurationSec: null,
      eventCountByName: {},
    },
    metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
    users: { totalUsers: null, activeUsers: null, newUsers: null, returningUsers: null },
    views: { screenPageViews: null, topPages: [] },
  };
  let finite = false;
  for (const metric of metrics) {
    if (typeof metric.value === 'number') finite = true;
    if (metric.name === 'ga4.newUsers') block.users = { ...block.users!, newUsers: metric.value };
    else if (metric.name === 'ga4.activeUsers') {
      block.metrics.activeUsers = metric.value;
      block.users = { ...block.users!, activeUsers: metric.value };
    } else if (metric.name === 'ga4.screenPageViews') block.metrics.screenPageViews = metric.value;
    else if (metric.name === 'ga4.sessions') block.metrics.sessions = metric.value;
    else if (metric.name === 'ga4.engagedSessions') block.metrics.engagedSessions = metric.value;
    else if (metric.name === 'ga4.averageSessionDurationSec') block.metrics.averageSessionDurationSec = metric.value;
    else if (metric.name.startsWith(JURY_GA4_EVENT_PREFIX) && typeof metric.value === 'number') {
      const eventName = metric.name.slice(JURY_GA4_EVENT_PREFIX.length);
      block.metrics.eventCountByName = { ...block.metrics.eventCountByName, [eventName]: metric.value };
    }
  }
  if (finite) {
    block.available = true;
    block.fetchedAt = evidence.collectedAt;
    block.error = null;
    block.errorCode = undefined;
  }
  return block;
}

function catalogItems(pack: EvidencePack): Ga4CatalogEvidenceItem[] {
  const items: Ga4CatalogEvidenceItem[] = [
    { id: 'DB_USER_COUNT', source: 'DATABASE', metric: 'userCount', value: pack.aggregates.userCount },
    { id: 'DB_NEW_USERS_7D', source: 'DATABASE', metric: 'newUsersLast7d', value: pack.aggregates.newUsersLast7d },
    { id: 'DB_ACTIVE_USERS_7D', source: 'DATABASE', metric: 'activeUsersLast7d', value: pack.aggregates.activeUsersLast7d },
    { id: 'DB_POSTS_7D', source: 'DATABASE', metric: 'postsLast7d', value: pack.aggregates.postsLast7d },
    { id: 'DB_COMMENTS_7D', source: 'DATABASE', metric: 'commentsLast7d', value: pack.aggregates.commentsLast7d },
    { id: 'DB_VIEWS_7D', source: 'DATABASE', metric: 'viewsLast7d', value: pack.aggregates.viewsLast7d },
  ];
  const ga4 = pack.ga4;
  if (ga4?.available) {
    items.push(
      { id: 'GA_ACTIVE_USERS_7D', source: 'GA4', metric: 'activeUsers', value: ga4.metrics.activeUsers ?? ga4.users?.activeUsers ?? null },
      { id: 'GA_NEW_USERS_7D', source: 'GA4', metric: 'newUsers', value: ga4.users?.newUsers ?? null },
      { id: 'GA_SESSIONS_7D', source: 'GA4', metric: 'sessions', value: ga4.metrics.sessions ?? null },
      { id: 'GA_ENGAGED_SESSIONS_7D', source: 'GA4', metric: 'engagedSessions', value: ga4.metrics.engagedSessions ?? null },
      { id: 'GA_SCREEN_PAGE_VIEWS_7D', source: 'GA4', metric: 'screenPageViews', value: ga4.metrics.screenPageViews ?? ga4.views?.screenPageViews ?? null },
    );
  }
  return items;
}
