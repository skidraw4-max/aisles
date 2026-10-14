/**
 * Product Evidence → existing EvidencePack.
 * Does not modify v9.x types. Metrics outside the comparator catalog stay off the pack.
 */
import { buildEvidenceItems, GA4_EVIDENCE_METRIC_DEFINITIONS } from '../ai-review-board/ga4-evidence';
import { EVIDENCE_METRIC_DEFINITIONS, type EvidencePack } from '../ai-review-board/types';
import {
  JURY_CORE_CONTRACT_VERSION,
  type JuryAvailability,
  type JuryEvidence,
  type JuryNormalizedMetric,
} from './records';

export const JURY_PROJECTABLE_DB_METRICS = [
  'userCount',
  'newUsersLast7d',
  'activeUsersLast7d',
  'postCount',
  'postsLast7d',
  'commentsLast7d',
  'viewsLast7d',
  'totalViews',
  'commentCount',
] as const;
export type JuryProjectableDbMetric = (typeof JURY_PROJECTABLE_DB_METRICS)[number];

export const JURY_PROJECTABLE_GA4_METRICS = [
  'ga4.newUsers',
  'ga4.activeUsers',
  'ga4.screenPageViews',
  'ga4.sessions',
  'ga4.engagedSessions',
  'ga4.averageSessionDurationSec',
] as const;
export type JuryProjectableGa4Metric = (typeof JURY_PROJECTABLE_GA4_METRICS)[number];

export const JURY_GA4_EVENT_PREFIX = 'ga4.eventCount.';

export const JURY_PROJECTION_WITHHOLD_REASONS = [
  'NOT_IN_EVIDENCE_PACK',
  'DEPRECATED_ALIAS',
  'UNSUPPORTED_SHAPE',
  'SOURCE_MISMATCH',
  'DUPLICATE_TARGET',
] as const;
export type JuryProjectionWithholdReason = (typeof JURY_PROJECTION_WITHHOLD_REASONS)[number];

export const JURY_PROJECTION_ISSUE_CODES = [
  'AVAILABLE_WITHOUT_FINITE_VALUE',
  'NON_AVAILABLE_WITH_VALUE',
] as const;
export type JuryProjectionIssueCode = (typeof JURY_PROJECTION_ISSUE_CODES)[number];

export type JuryProjectedField = {
  metricId: string;
  metric: string;
  evidencePackPath: string;
  value: number | null;
  availability: JuryAvailability;
};

export type JuryWithheldMetric = {
  metricId: string;
  metric: string;
  reason: JuryProjectionWithholdReason;
};

export type JuryProjectionIssue = {
  metricId: string;
  metric: string;
  code: JuryProjectionIssueCode;
};

export type EvidencePackProjection = {
  contractVersion: typeof JURY_CORE_CONTRACT_VERSION;
  tenantId: string;
  evidenceId: string;
  projected: JuryProjectedField[];
  withheld: JuryWithheldMetric[];
  issues: JuryProjectionIssue[];
  periodWithheld: boolean;
  docsHintsExcludesUnmappedMetrics: true;
  nullIsNotZero: true;
  pack: EvidencePack;
};

export class JuryTenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JuryTenantIsolationError';
  }
}

export type EvidenceProjectionInput = {
  evidence: JuryEvidence;
  metrics: JuryNormalizedMetric[];
  generatedAt: string;
  siteName: string;
};

type ResolvedTarget =
  | { kind: 'withhold'; reason: JuryProjectionWithholdReason }
  | { kind: 'db'; key: JuryProjectableDbMetric; path: string }
  | { kind: 'ga4'; key: JuryProjectableGa4Metric | `ga4.eventCount.${string}`; path: string };

function isDbMetric(metric: string): metric is JuryProjectableDbMetric {
  return (JURY_PROJECTABLE_DB_METRICS as readonly string[]).includes(metric);
}

function isGa4Metric(metric: string): metric is JuryProjectableGa4Metric {
  return (JURY_PROJECTABLE_GA4_METRICS as readonly string[]).includes(metric);
}

function resolveTarget(metric: string, sourceSystem: JuryNormalizedMetric['sourceSystem']): ResolvedTarget {
  if (metric === 'usersLast7d') return { kind: 'withhold', reason: 'DEPRECATED_ALIAS' };
  if (metric === 'postsByCategory' || metric.startsWith('postsByCategory.')) {
    return { kind: 'withhold', reason: 'UNSUPPORTED_SHAPE' };
  }
  if (metric.startsWith(JURY_GA4_EVENT_PREFIX)) {
    const eventName = metric.slice(JURY_GA4_EVENT_PREFIX.length);
    if (!eventName || sourceSystem !== 'GA4') {
      return { kind: 'withhold', reason: eventName ? 'SOURCE_MISMATCH' : 'UNSUPPORTED_SHAPE' };
    }
    return { kind: 'ga4', key: metric as `ga4.eventCount.${string}`, path: `ga4.metrics.eventCountByName.${eventName}` };
  }
  if (isDbMetric(metric)) {
    if (sourceSystem !== 'DATABASE') return { kind: 'withhold', reason: 'SOURCE_MISMATCH' };
    return { kind: 'db', key: metric, path: `aggregates.${metric}` };
  }
  if (isGa4Metric(metric)) {
    if (sourceSystem !== 'GA4') return { kind: 'withhold', reason: 'SOURCE_MISMATCH' };
    return { kind: 'ga4', key: metric, path: metric };
  }
  return { kind: 'withhold', reason: 'NOT_IN_EVIDENCE_PACK' };
}

function storedMeasurement(metric: JuryNormalizedMetric): {
  value: number | null;
  issue?: JuryProjectionIssueCode;
} {
  const finite = typeof metric.value === 'number' && Number.isFinite(metric.value);
  if (metric.availability === 'AVAILABLE') {
    if (!finite) return { value: null, issue: 'AVAILABLE_WITHOUT_FINITE_VALUE' };
    return { value: metric.value };
  }
  if (finite) return { value: null, issue: 'NON_AVAILABLE_WITH_VALUE' };
  return { value: null };
}

function emptyGa4(evidence: JuryEvidence, available: boolean): NonNullable<EvidencePack['ga4']> {
  const period =
    evidence.timezone === 'Asia/Seoul'
      ? { start: evidence.periodStart, end: evidence.periodEnd, timezone: 'Asia/Seoul' as const }
      : undefined;
  return {
    available,
    propertyId: null,
    range: { startDate: evidence.periodStart, endDate: evidence.periodEnd },
    period,
    fetchedAt: available ? evidence.collectedAt : null,
    error: available ? null : 'GA4 metrics on this evidence are not available',
    errorCode: available ? null : 'NOT_CONFIGURED',
    metrics: {
      activeUsers: null,
      sessions: null,
      screenPageViews: null,
      engagedSessions: null,
      averageSessionDurationSec: null,
      eventCountByName: {},
    },
    metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
    users: {
      totalUsers: null,
      activeUsers: null,
      newUsers: null,
      returningUsers: null,
    },
    views: { screenPageViews: null, topPages: [] },
  };
}

export function projectEvidenceToPack(input: EvidenceProjectionInput): EvidencePackProjection {
  const { evidence } = input;
  for (const metric of input.metrics) {
    if (metric.tenantId !== evidence.tenantId || metric.connectionId !== evidence.connectionId) {
      throw new JuryTenantIsolationError(
        `metric ${metric.id} is outside tenant ${evidence.tenantId} connection ${evidence.connectionId}`,
      );
    }
    if (!evidence.metricIds.includes(metric.id)) {
      throw new JuryTenantIsolationError(`metric ${metric.id} is not listed on evidence ${evidence.id}`);
    }
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

  const projected: JuryProjectedField[] = [];
  const withheld: JuryWithheldMetric[] = [];
  const issues: JuryProjectionIssue[] = [];
  const seenPaths = new Set<string>();
  let ga4 = emptyGa4(evidence, false);
  let ga4Used = false;
  let ga4Available = false;

  for (const metric of input.metrics) {
    const target = resolveTarget(metric.metric, metric.sourceSystem);
    if (target.kind === 'withhold') {
      withheld.push({ metricId: metric.id, metric: metric.metric, reason: target.reason });
      continue;
    }
    if (seenPaths.has(target.path)) {
      withheld.push({ metricId: metric.id, metric: metric.metric, reason: 'DUPLICATE_TARGET' });
      continue;
    }
    seenPaths.add(target.path);
    const stored = storedMeasurement(metric);
    if (stored.issue) {
      issues.push({ metricId: metric.id, metric: metric.metric, code: stored.issue });
    }
    if (target.kind === 'db') {
      aggregates[target.key] = stored.value;
    } else {
      ga4Used = true;
      if (stored.value !== null) ga4Available = true;
      writeGa4(ga4, target.key, stored.value);
    }
    projected.push({
      metricId: metric.id,
      metric: metric.metric,
      evidencePackPath: target.path,
      value: stored.value,
      availability: metric.availability,
    });
  }

  if (ga4Used) ga4 = { ...ga4, available: ga4Available, fetchedAt: ga4Available ? evidence.collectedAt : null, error: ga4Available ? null : ga4.error, errorCode: ga4Available ? null : 'NOT_CONFIGURED' };

  const periodWithheld = evidence.timezone !== 'Asia/Seoul';
  const pack: EvidencePack = {
    generatedAt: input.generatedAt,
    site: { name: input.siteName, corridors: [], stackNotes: [] },
    aggregates,
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    docsHints: ['Jury product projection v9.x-ev020. Metrics outside EvidencePack are withheld.'],
    piiExcluded: true,
    readOnly: true,
  };
  if (!periodWithheld) {
    pack.analysisPeriod = {
      start: evidence.periodStart,
      end: evidence.periodEnd,
      timezone: 'Asia/Seoul',
    };
  }
  if (ga4Used) pack.ga4 = ga4;
  pack.evidenceItems = buildEvidenceItems(pack);

  return {
    contractVersion: JURY_CORE_CONTRACT_VERSION,
    tenantId: evidence.tenantId,
    evidenceId: evidence.id,
    projected,
    withheld,
    issues,
    periodWithheld,
    docsHintsExcludesUnmappedMetrics: true,
    nullIsNotZero: true,
    pack,
  };
}

function writeGa4(
  ga4: NonNullable<EvidencePack['ga4']>,
  key: JuryProjectableGa4Metric | `ga4.eventCount.${string}`,
  value: number | null,
): void {
  if (key === 'ga4.newUsers') {
    ga4.users = { ...ga4.users!, newUsers: value };
    return;
  }
  if (key === 'ga4.activeUsers') {
    ga4.metrics.activeUsers = value;
    ga4.users = { ...ga4.users!, activeUsers: value };
    return;
  }
  if (key === 'ga4.screenPageViews') {
    ga4.metrics.screenPageViews = value;
    return;
  }
  if (key === 'ga4.sessions') {
    ga4.metrics.sessions = value;
    return;
  }
  if (key === 'ga4.engagedSessions') {
    ga4.metrics.engagedSessions = value;
    return;
  }
  if (key === 'ga4.averageSessionDurationSec') {
    ga4.metrics.averageSessionDurationSec = value;
    return;
  }
  if (key.startsWith(JURY_GA4_EVENT_PREFIX) && value !== null) {
    const eventName = key.slice(JURY_GA4_EVENT_PREFIX.length);
    ga4.metrics.eventCountByName = { ...ga4.metrics.eventCountByName, [eventName]: value };
  }
}
