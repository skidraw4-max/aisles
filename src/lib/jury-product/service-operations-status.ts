/**
 * Service operations status is derived from existing records.
 * It is not stored and it does not invent a lifecycle column.
 */
import { decideJuryMutation, type JuryActor } from './access';
import type { JuryConsoleView } from './console-view';
import { authorizeJuryServiceFeature } from './service-feature-authorization';
import { highestServicePermission, type ServiceGrantRow } from './service-member-management';
import type {
  JuryAuditEvent,
  JuryChangeGateResult,
  JuryEvidence,
  JuryNormalizedMetric,
  JuryReviewResult,
  JuryTaskStatus,
} from './records';

export type ServiceHealth = 'HEALTHY' | 'ATTENTION' | 'BLOCKED' | 'NOT_READY';
export type ActionAvailability = 'AVAILABLE' | 'LOCKED' | 'COMPLETED' | 'NOT_READY';
export type OperationalPhase =
  | 'DISCOVERING'
  | 'SCOPE_REVIEW'
  | 'CONNECTED'
  | 'EVIDENCE_READY'
  | 'REVIEWED'
  | 'IMPROVEMENT_AVAILABLE'
  | 'IMPROVING'
  | 'RE_REVIEWED';

export type OperationCapabilities = {
  discovery: boolean;
  scope: boolean;
  collectEvidence: boolean;
  review: boolean;
  improve: boolean;
  agent: boolean;
};

export type ServiceNextAction = {
  id: 'discover' | 'review-scope' | 'collect-evidence' | 'run-review' | 'review-improvement' | 'run-agent' | 'review-change-gate' | 'run-rereview' | 'none';
  label: string;
  state: ActionAvailability;
};

const OPEN_TASKS = new Set<JuryTaskStatus>(['OPEN', 'HANDED_OFF', 'GATED', 'NEEDS_APPROVAL']);
const SECRET = /password|token|api[_-]?key|secret|credential|oauth|refresh/i;

export type ServiceOperationModel = {
  connectionId: string;
  tenantId: string;
  name: string;
  connectionStatus: string;
  phase: OperationalPhase;
  health: ServiceHealth;
  parts: {
    connection: string;
    evidence: 'READY' | 'MISSING';
    review: 'LAST_RESULT_AVAILABLE' | 'NONE';
    improvement: 'OPEN' | 'NONE';
    agent: string;
  };
  onboarding: { discovery: 'COMPLETE' | 'NOT_STARTED'; scope: 'APPROVED' | 'PENDING' | 'NONE'; connection: string };
  evidence: {
    empty: boolean;
    period: string | null;
    collectedAt: string | null;
    adapter: string | null;
    measuredCount: number;
    notMeasuredCount: number;
    evidenceItemCount: number;
    ga4: 'available' | 'not measured' | 'none';
    collectionStatus: string;
    evidenceId: string | null;
  };
  review: {
    empty: boolean;
    decision: string | null;
    statusSummary: string | null;
    topProblems: string[];
    expectedUserEffect: string | null;
    risk: string | null;
    reviewedAt: string | null;
  };
  improvement: { empty: boolean; openCount: number; latestStatus: string | null; latestTitle: string | null; latestId: string | null };
  agent: {
    empty: boolean;
    status: string | null;
    provider: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    changedFilesCount: number | null;
    testsPassed: boolean | null;
    errorCode: string | null;
  };
  flow: { agent: string; changeGate: string; reReview: string; jury: string };
  next: ServiceNextAction;
  activity: Array<{ id: string; label: string; timestamp: string; age: string }>;
  access: { organizationRole: string; servicePermission: string | null; capabilities: Record<'VIEW' | 'REVIEW' | 'IMPROVE' | 'AGENT', boolean> };
  lastEvidence: string;
  lastReview: string;
  lastActivity: string;
};

type Rank = Record<'VIEW' | 'REVIEW' | 'IMPROVE' | 'AGENT', number>;
const RANK: Rank = { VIEW: 1, REVIEW: 2, IMPROVE: 3, AGENT: 4 };

function latest<T>(rows: readonly T[], stamp: (row: T) => string): T | null {
  return rows.slice().sort((left, right) => stamp(right).localeCompare(stamp(left)))[0] ?? null;
}

function connectionSlice(view: JuryConsoleView, connectionId: string) {
  const connection = view.connections.find((row) => row.id === connectionId && row.tenantId === view.tenantId) ?? null;
  if (!connection) return null;
  const evidence = view.evidence.filter((row) => row.connectionId === connection.id && row.tenantId === view.tenantId);
  const evidenceIds = new Set(evidence.map((row) => row.id));
  const requests = view.requests.filter((row) => row.connectionId === connection.id && row.tenantId === view.tenantId);
  const requestIds = new Set(requests.map((row) => row.id));
  const results = view.results.filter((row) => row.tenantId === view.tenantId && requestIds.has(row.reviewRequestId));
  const resultIds = new Set(results.map((row) => row.id));
  const tasks = view.tasks.filter((row) => row.tenantId === view.tenantId && resultIds.has(row.reviewResultId));
  const taskIds = new Set(tasks.map((row) => row.id));
  const executions = view.executions.filter((row) => row.tenantId === view.tenantId && taskIds.has(row.taskId));
  const executionIds = new Set(executions.map((row) => row.id));
  const gates = view.gates.filter((row) => row.tenantId === view.tenantId && executionIds.has(row.executionId));
  const reReviews = view.reReviews.filter((row) => row.tenantId === view.tenantId && taskIds.has(row.taskId));
  const metrics = view.metrics.filter((row) => row.tenantId === view.tenantId && row.evidenceId && evidenceIds.has(row.evidenceId));
  const discoveries = view.discoveries.filter((row) => row.connectionId === connection.id && row.tenantId === view.tenantId);
  const scopes = view.scopes.filter((row) => row.connectionId === connection.id && row.tenantId === view.tenantId);
  const audit = view.audit.filter((row) => row.tenantId === view.tenantId && (
    (row.evidenceId && evidenceIds.has(row.evidenceId))
    || (row.reviewId && (resultIds.has(row.reviewId) || requestIds.has(row.reviewId)))
    || (row.improvementTaskId && taskIds.has(row.improvementTaskId))
    || row.serviceKey === connection.serviceKey
  ));
  return { connection, evidence, requests, results, tasks, executions, gates, reReviews, metrics, discoveries, scopes, audit };
}

function gateLabel(gate: JuryChangeGateResult | undefined): string {
  if (!gate) return 'NONE';
  if (gate.gate === 'PASS') return 'APPROVED';
  if (gate.gate === 'BLOCK') return 'BLOCKED';
  return 'GATED';
}

function activityLabel(action: string): string | null {
  if (SECRET.test(action)) return null;
  const known: Record<string, string> = {
    EVIDENCE_COLLECTED: 'Evidence collected',
    REVIEW_COMPLETED: 'Review completed',
    IMPROVEMENT_TASK_CREATED: 'Improvement task created',
    AGENT_EXECUTION_COMPLETED: 'Agent execution completed',
    CHANGE_GATE_APPROVED: 'Change Gate approved',
    CHANGE_GATE_COMPLETED: 'Change Gate approved',
    REVIEW_REREVIEW_COMPLETED: 'Re-review completed',
  };
  return known[action] ?? action.replaceAll('_', ' ');
}

function age(timestamp: string, now: string): string {
  const delta = Date.parse(now) - Date.parse(timestamp);
  if (!Number.isFinite(delta) || delta < 0) return timestamp;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function evidenceSummary(evidence: JuryEvidence | null, metrics: readonly JuryNormalizedMetric[]) {
  if (!evidence) {
    return {
      empty: true,
      period: null,
      collectedAt: null,
      adapter: null,
      measuredCount: 0,
      notMeasuredCount: 0,
      evidenceItemCount: 0,
      ga4: 'none' as const,
      collectionStatus: 'No evidence collected yet',
      evidenceId: null,
    };
  }
  const mine = metrics.filter((row) => row.evidenceId === evidence.id);
  const measuredCount = mine.filter((row) => row.availability === 'AVAILABLE').length;
  const notMeasuredCount = mine.filter((row) => row.availability !== 'AVAILABLE' || row.value === null).length;
  const ga4 = mine.filter((row) => row.sourceSystem === 'GA4');
  const ga4State = ga4.length === 0 ? 'none' as const : ga4.some((row) => row.availability === 'AVAILABLE') ? 'available' as const : 'not measured' as const;
  return {
    empty: false,
    period: `${evidence.periodStart} – ${evidence.periodEnd} · ${evidence.timezone}`,
    collectedAt: evidence.collectedAt,
    adapter: evidence.adapterKey,
    measuredCount,
    notMeasuredCount,
    evidenceItemCount: evidence.metricIds.length,
    ga4: ga4State,
    collectionStatus: 'Collected',
    evidenceId: evidence.id,
  };
}

function reviewSummary(result: JuryReviewResult | null) {
  if (!result) {
    return { empty: true, decision: null, statusSummary: null, topProblems: [], expectedUserEffect: null, risk: null, reviewedAt: null };
  }
  return {
    empty: false,
    decision: result.expectedDecision,
    statusSummary: result.finalSurface.statusSummary,
    topProblems: result.finalSurface.topProblems,
    expectedUserEffect: result.finalSurface.expectedUserEffect,
    risk: result.finalSurface.risk,
    reviewedAt: result.completedAt,
  };
}

export function actionState(
  view: JuryConsoleView,
  connectionId: string,
  capabilities: OperationCapabilities,
  id: ServiceNextAction['id'],
): ActionAvailability {
  const slice = connectionSlice(view, connectionId);
  if (!slice) return 'NOT_READY';
  const evidence = latest(slice.evidence, (row) => row.collectedAt);
  const review = latest(slice.results, (row) => row.completedAt);
  const open = slice.tasks.filter((row) => OPEN_TASKS.has(row.status));
  const execution = latest(slice.executions, (row) => row.finishedAt ?? row.startedAt ?? '');
  const gate = execution ? slice.gates.find((row) => row.executionId === execution.id) : undefined;
  const reReview = latest(slice.reReviews, (row) => row.completedAt);
  const discovered = slice.discoveries.length > 0;
  const scopeApproved = slice.scopes.some((row) => row.status === 'APPROVED') || slice.connection.status === 'CONNECTED';
  if (id === 'discover') {
    if (discovered) return 'COMPLETED';
    return capabilities.discovery ? 'AVAILABLE' : 'LOCKED';
  }
  if (id === 'review-scope') {
    if (!discovered) return 'NOT_READY';
    if (scopeApproved) return 'COMPLETED';
    return capabilities.scope ? 'AVAILABLE' : 'LOCKED';
  }
  if (id === 'collect-evidence') {
    if (slice.connection.status !== 'CONNECTED') return 'NOT_READY';
    if (evidence) return 'COMPLETED';
    return capabilities.collectEvidence ? 'AVAILABLE' : 'LOCKED';
  }
  if (id === 'run-review') {
    if (!evidence) return 'NOT_READY';
    if (review) return 'COMPLETED';
    return capabilities.review ? 'AVAILABLE' : 'LOCKED';
  }
  if (id === 'review-improvement') {
    if (!review) return 'NOT_READY';
    if (review.expectedDecision !== 'VERIFY' && review.expectedDecision !== 'REWORD') return 'COMPLETED';
    const awaitingReview = slice.tasks.some((row) => row.status === 'OPEN');
    if (!awaitingReview) return slice.tasks.length === 0 ? 'NOT_READY' : 'COMPLETED';
    return capabilities.improve ? 'AVAILABLE' : 'LOCKED';
  }
  if (id === 'run-agent') {
    if (!execution && open.length === 0) return 'COMPLETED';
    if (!execution) return capabilities.agent ? 'AVAILABLE' : 'LOCKED';
    if (execution.status === 'PENDING' || execution.status === 'RUNNING') return capabilities.agent ? 'AVAILABLE' : 'LOCKED';
    return 'COMPLETED';
  }
  if (id === 'review-change-gate') {
    if (!execution) return 'COMPLETED';
    if (execution.status !== 'COMPLETED') return execution.status === 'BLOCKED' ? 'LOCKED' : 'NOT_READY';
    if (gate && gate.gate === 'PASS') return 'COMPLETED';
    return 'AVAILABLE';
  }
  if (id === 'run-rereview') {
    if (!execution || execution.status !== 'COMPLETED') return 'COMPLETED';
    if (!gate || gate.gate !== 'PASS') return 'NOT_READY';
    if (reReview) return 'COMPLETED';
    return capabilities.review ? 'AVAILABLE' : 'LOCKED';
  }
  return reReview ? 'COMPLETED' : 'NOT_READY';
}

const STEPS: Array<Pick<ServiceNextAction, 'id' | 'label'>> = [
  { id: 'discover', label: 'Run discovery' },
  { id: 'review-scope', label: 'Review access scope' },
  { id: 'collect-evidence', label: 'Collect evidence' },
  { id: 'run-review', label: 'Run review' },
  { id: 'review-improvement', label: 'Review improvement task' },
  { id: 'run-agent', label: 'Run agent' },
  { id: 'review-change-gate', label: 'Review change gate' },
  { id: 'run-rereview', label: 'Run re-review' },
];

export function calculateNextAction(view: JuryConsoleView, connectionId: string, capabilities: OperationCapabilities): ServiceNextAction {
  for (const step of STEPS) {
    const state = actionState(view, connectionId, capabilities, step.id);
    if (state !== 'COMPLETED') return { ...step, state };
  }
  return { id: 'none', label: 'No action required', state: 'COMPLETED' };
}

export function projectServiceOperation(
  view: JuryConsoleView,
  connectionId: string,
  capabilities: OperationCapabilities,
  access: ServiceOperationModel['access'],
  now: string,
): ServiceOperationModel | null {
  const slice = connectionSlice(view, connectionId);
  if (!slice) return null;
  const evidence = latest(slice.evidence, (row) => row.collectedAt);
  const review = latest(slice.results, (row) => row.completedAt);
  const open = slice.tasks.filter((row) => OPEN_TASKS.has(row.status));
  const task = latest(slice.tasks, (row) => row.createdAt ?? '');
  const execution = latest(slice.executions, (row) => row.finishedAt ?? row.startedAt ?? '');
  const gate = execution ? slice.gates.find((row) => row.executionId === execution.id) : undefined;
  const reReview = latest(slice.reReviews, (row) => row.completedAt);
  const discovered = slice.discoveries.length > 0;
  const scopeApproved = slice.scopes.some((row) => row.status === 'APPROVED');
  const evidenceView = evidenceSummary(evidence, slice.metrics);
  const reviewView = reviewSummary(review);
  const agentBlocked = execution?.status === 'BLOCKED';
  const health: ServiceHealth = agentBlocked
    ? 'BLOCKED'
    : !evidence || !review || slice.connection.status !== 'CONNECTED'
      ? 'NOT_READY'
      : open.length > 0
        ? 'ATTENTION'
        : 'HEALTHY';
  const phase: OperationalPhase = !discovered
    ? 'DISCOVERING'
    : !scopeApproved && slice.connection.status !== 'CONNECTED'
      ? 'SCOPE_REVIEW'
      : slice.connection.status === 'CONNECTED' && !evidence
        ? 'CONNECTED'
        : evidence && !review
          ? 'EVIDENCE_READY'
          : execution && (execution.status === 'PENDING' || execution.status === 'RUNNING')
            ? 'IMPROVING'
            : reReview
              ? 'RE_REVIEWED'
              : open.length > 0
                ? 'IMPROVEMENT_AVAILABLE'
                : 'REVIEWED';
  const activity = slice.audit
    .slice()
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .flatMap((row) => {
      const label = activityLabel(row.action);
      if (!label) return [];
      return [{ id: row.id, label, timestamp: row.timestamp, age: age(row.timestamp, now) }];
    })
    .slice(0, 8);
  const gateName = gateLabel(gate);
  return {
    connectionId: slice.connection.id,
    tenantId: slice.connection.tenantId,
    name: slice.connection.displayName,
    connectionStatus: slice.connection.status,
    phase,
    health,
    parts: {
      connection: slice.connection.status,
      evidence: evidence ? 'READY' : 'MISSING',
      review: review ? 'LAST_RESULT_AVAILABLE' : 'NONE',
      improvement: open.length > 0 ? 'OPEN' : 'NONE',
      agent: execution?.status ?? 'IDLE',
    },
    onboarding: {
      discovery: discovered ? 'COMPLETE' : 'NOT_STARTED',
      scope: scopeApproved ? 'APPROVED' : slice.scopes.length > 0 ? 'PENDING' : 'NONE',
      connection: slice.connection.status,
    },
    evidence: evidenceView,
    review: reviewView,
    improvement: {
      empty: slice.tasks.length === 0,
      openCount: open.length,
      latestStatus: task?.status ?? null,
      latestTitle: task?.diagnosis ?? null,
      latestId: task?.id ?? null,
    },
    agent: {
      empty: !execution,
      status: execution?.status ?? null,
      provider: execution?.agent ?? null,
      startedAt: execution?.startedAt ?? null,
      finishedAt: execution?.finishedAt ?? null,
      changedFilesCount: gate ? gate.changedFiles.length : null,
      testsPassed: gate ? gate.testsPassed : null,
      errorCode: null,
    },
    flow: {
      agent: execution?.status ?? 'NONE',
      changeGate: gateName,
      reReview: reReview ? 'COMPLETED' : gate?.gate === 'PASS' ? 'PENDING' : 'NOT_READY',
      jury: reReview ? 'COMPLETED' : gate?.gate === 'PASS' ? 'WAITING' : 'NOT_READY',
    },
    next: calculateNextAction(view, connectionId, capabilities),
    activity,
    access,
    lastEvidence: evidence?.collectedAt ?? 'No evidence collected yet',
    lastReview: review?.expectedDecision ?? 'No review',
    lastActivity: activity[0] ? activity[0].age : 'No activity',
  };
}

export function accessSummary(
  role: string,
  grants: readonly { permission: 'VIEW' | 'REVIEW' | 'IMPROVE' | 'AGENT' }[],
): ServiceOperationModel['access'] {
  const permission = highestServicePermission(grants);
  return { organizationRole: role, servicePermission: permission, capabilities: accessMarks(permission) };
}

export function accessMarks(permission: 'VIEW' | 'REVIEW' | 'IMPROVE' | 'AGENT' | null): ServiceOperationModel['access']['capabilities'] {
  const rank = permission ? RANK[permission] : 0;
  return {
    VIEW: rank >= RANK.VIEW,
    REVIEW: rank >= RANK.REVIEW,
    IMPROVE: rank >= RANK.IMPROVE,
    AGENT: rank >= RANK.AGENT,
  };
}

export function operationCapabilities(input: {
  actor: Extract<JuryActor, { ok: true }>;
  connection: { id: string; tenantId: string };
  grants: readonly ServiceGrantRow[];
  clientTenantId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
  permission?: string | null;
}): OperationCapabilities {
  void input.clientTenantId;
  void input.actingUserId;
  void input.actorRole;
  void input.permission;
  const feature = (name: 'review.execute' | 'improvement.write' | 'agent.execute') => authorizeJuryServiceFeature({
    actor: input.actor,
    membership: { tenantId: input.actor.tenantId, userId: input.actor.userId },
    connection: input.connection,
    grants: input.grants,
    feature: name,
    clientTenantId: input.clientTenantId,
    actingUserId: input.actingUserId,
    actorRole: input.actorRole,
    permission: input.permission,
  }).ok;
  const role = (action: 'discovery.approve' | 'scope.write' | 'connection.write') => decideJuryMutation({
    actor: input.actor,
    action,
    resourceTenantId: input.actor.tenantId,
    clientTenantId: input.clientTenantId,
  }).ok;
  return {
    discovery: role('discovery.approve'),
    scope: role('scope.write'),
    collectEvidence: role('connection.write'),
    review: feature('review.execute'),
    improve: feature('improvement.write'),
    agent: feature('agent.execute'),
  };
}

export function visibleActivity(events: readonly JuryAuditEvent[], now: string): ServiceOperationModel['activity'] {
  return events.flatMap((row) => {
    const label = activityLabel(row.action);
    if (!label) return [];
    return [{ id: row.id, label, timestamp: row.timestamp, age: age(row.timestamp, now) }];
  });
}
