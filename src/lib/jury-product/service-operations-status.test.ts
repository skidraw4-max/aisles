import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { JuryConsoleView } from './console-view';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT } from './records';
import type { ServiceGrantRow } from './service-member-management';
import {
  actionState,
  accessSummary,
  calculateNextAction,
  operationCapabilities,
  projectServiceOperation,
  visibleActivity,
  type OperationCapabilities,
} from './service-operations-status';

const NOW = '2026-10-08T12:00:00.000Z';
const ALL: OperationCapabilities = {
  discovery: true,
  scope: true,
  collectEvidence: true,
  review: true,
  improve: true,
  agent: true,
};
const NONE: OperationCapabilities = {
  discovery: false,
  scope: false,
  collectEvidence: false,
  review: false,
  improve: false,
  agent: false,
};

function view(tenantId: string, connectionId: string, extra: Partial<JuryConsoleView> = {}): JuryConsoleView {
  return {
    tenantId,
    role: 'OWNER',
    connections: [{
      id: connectionId,
      tenantId,
      serviceKey: `key-${connectionId}`,
      displayName: `Service ${connectionId}`,
      accessMethod: 'OAUTH',
      status: 'CONNECTED',
      credentialRef: 'secret-store/do-not-show',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }],
    scopes: [{
      id: `scope-${connectionId}`,
      tenantId,
      connectionId,
      status: 'APPROVED',
      grants: [{ resource: 'metrics.read', mode: 'READ' }],
      approvedAt: '2026-10-01T00:00:00.000Z',
    }],
    discoveries: [{
      id: `discovery-${connectionId}`,
      tenantId,
      connectionId,
      exploredAt: '2026-10-01T00:00:00.000Z',
      surfaces: ['API'],
      menus: ['ops'],
      dataSources: ['API'],
      feasibility: 'PARTIAL',
      proposedMetrics: [],
      approval: 'APPROVED',
    }],
    metrics: [],
    evidence: [],
    requests: [],
    results: [],
    tasks: [],
    executions: [],
    gates: [],
    reReviews: [],
    audit: [],
    loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
    ...extra,
  };
}

function project(input: JuryConsoleView, capabilities: OperationCapabilities = ALL) {
  const model = projectServiceOperation(input, input.connections[0]!.id, capabilities, accessSummary(input.role, []), NOW);
  assert.ok(model);
  return model;
}

test('operational status stays derived and empty evidence is explicit', () => {
  const model = project(view('org-a', 'svc-a'));
  assert.equal(model.phase, 'CONNECTED');
  assert.equal(model.health, 'NOT_READY');
  assert.equal(model.evidence.empty, true);
  assert.equal(model.evidence.collectionStatus, 'No evidence collected yet');
  assert.equal(model.lastEvidence, 'No evidence collected yet');
  assert.equal(model.review.empty, true);
  assert.equal(model.improvement.empty, true);
  assert.equal(model.agent.empty, true);
  assert.equal(model.activity.length, 0);
  assert.equal(model.lastActivity, 'No activity');
  assert.equal(JSON.stringify(model).includes('secret-store'), false);
});

test('health follows evidence, review, blocked agent, and open improvement', () => {
  const base = view('org-a', 'svc-a');
  assert.equal(project(base).health, 'NOT_READY');
  const withEvidence = view('org-a', 'svc-a', {
    evidence: [{
      id: 'ev', tenantId: 'org-a', connectionId: 'svc-a', purpose: 'observe',
      periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
      metricIds: ['m0', 'm-null'], adapterKey: 'mock', collectedAt: '2026-10-08T10:00:00.000Z',
    }],
    metrics: [
      {
        id: 'm0', tenantId: 'org-a', connectionId: 'svc-a', evidenceId: 'ev', metric: 'signups',
        value: 0, unit: 'COUNT', periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
        sourceSystem: 'DATABASE', sourceRef: 'db', collectedAt: '2026-10-08T10:00:00.000Z', availability: 'AVAILABLE',
        rawPayloadRef: 'raw/0', adapterKey: 'mock', adapterVersion: '0', ruleId: 'identity',
      },
      {
        id: 'm-null', tenantId: 'org-a', connectionId: 'svc-a', evidenceId: 'ev', metric: 'sessions',
        value: null, unit: 'COUNT', periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
        sourceSystem: 'GA4', sourceRef: 'ga4', collectedAt: '2026-10-08T10:00:00.000Z', availability: 'NOT_MEASURED',
        rawPayloadRef: 'raw/null', adapterKey: 'mock', adapterVersion: '0', ruleId: 'identity',
      },
    ],
  });
  const evidenceOnly = project(withEvidence);
  assert.equal(evidenceOnly.health, 'NOT_READY');
  assert.equal(evidenceOnly.phase, 'EVIDENCE_READY');
  assert.equal(evidenceOnly.evidence.measuredCount, 1);
  assert.equal(evidenceOnly.evidence.notMeasuredCount, 1);
  assert.equal(evidenceOnly.evidence.ga4, 'not measured');
  assert.equal(evidenceOnly.evidence.evidenceItemCount, 2);

  const reviewed = view('org-a', 'svc-a', {
    ...withEvidence,
    requests: [{
      id: 'req', tenantId: 'org-a', connectionId: 'svc-a', evidenceId: 'ev', reviewType: 'FULL_REVIEW',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
    }],
    results: [{
      id: 'rev', tenantId: 'org-a', reviewRequestId: 'req', boardRunId: 'run', evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: true,
      expectedDecision: 'REWORD',
      finalSurface: {
        statusSummary: 'Final only', topProblems: ['copy'], expectedUserEffect: 'clearer', risk: 'low',
        dimensionEvidence: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [],
      },
      contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: '2026-10-08T11:00:00.000Z',
    }],
    tasks: [{
      id: 'task', tenantId: 'org-a', reviewResultId: 'rev', diagnosis: 'Reword the headline',
      acceptanceCriteria: ['headline'], status: 'OPEN', loopIndex: 1,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      createdAt: '2026-10-08T11:10:00.000Z',
    }],
  });
  const attention = project(reviewed);
  assert.equal(attention.health, 'ATTENTION');
  assert.equal(attention.phase, 'IMPROVEMENT_AVAILABLE');
  assert.equal(attention.review.decision, 'REWORD');
  assert.equal(attention.review.statusSummary, 'Final only');
  assert.equal(attention.improvement.openCount, 1);
  assert.equal(attention.improvement.latestStatus, 'OPEN');

  const blocked = view('org-a', 'svc-a', {
    ...reviewed,
    executions: [{
      id: 'exec', tenantId: 'org-a', taskId: 'task', agent: 'CURSOR', allowedPaths: [], deniedPaths: [],
      status: 'BLOCKED', startedAt: '2026-10-08T11:20:00.000Z', finishedAt: '2026-10-08T11:30:00.000Z',
    }],
  });
  assert.equal(project(blocked).health, 'BLOCKED');
  assert.equal(project(blocked).agent.status, 'BLOCKED');
  assert.equal(project(blocked).agent.provider, 'CURSOR');
});

test('next action follows the pipeline and the caller permission', () => {
  const connected = view('org-a', 'svc-a');
  assert.deepEqual(calculateNextAction(connected, 'svc-a', ALL), {
    id: 'collect-evidence', label: 'Collect evidence', state: 'AVAILABLE',
  });
  assert.equal(actionState(connected, 'svc-a', NONE, 'run-review'), 'NOT_READY');
  assert.equal(calculateNextAction(connected, 'svc-a', NONE).state, 'LOCKED');

  const ready = view('org-a', 'svc-a', {
    evidence: [{
      id: 'ev', tenantId: 'org-a', connectionId: 'svc-a', purpose: 'observe',
      periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
      metricIds: [], adapterKey: 'mock', collectedAt: '2026-10-08T10:00:00.000Z',
    }],
  });
  assert.equal(calculateNextAction(ready, 'svc-a', ALL).label, 'Run review');
  assert.equal(calculateNextAction(ready, 'svc-a', { ...ALL, review: false }).state, 'LOCKED');
  assert.equal(actionState(ready, 'svc-a', ALL, 'collect-evidence'), 'COMPLETED');

  const improving = view('org-a', 'svc-a', {
    evidence: ready.evidence,
    requests: [{
      id: 'req', tenantId: 'org-a', connectionId: 'svc-a', evidenceId: 'ev', reviewType: 'FULL_REVIEW',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
    }],
    results: [{
      id: 'rev', tenantId: 'org-a', reviewRequestId: 'req', boardRunId: 'run', evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: true,
      expectedDecision: 'VERIFY',
      finalSurface: {
        statusSummary: 'Verify', topProblems: [], expectedUserEffect: '', risk: '',
        dimensionEvidence: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [],
      },
      contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: '2026-10-08T11:00:00.000Z',
    }],
    tasks: [{
      id: 'task', tenantId: 'org-a', reviewResultId: 'rev', diagnosis: 'Check the metric',
      acceptanceCriteria: [], status: 'HANDED_OFF', loopIndex: 1,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
    }],
  });
  assert.equal(calculateNextAction(improving, 'svc-a', ALL).label, 'Run agent');
  assert.equal(calculateNextAction(improving, 'svc-a', { ...ALL, agent: false }).state, 'LOCKED');
  const openTask = view('org-a', 'svc-a', {
    ...improving,
    tasks: [{ ...improving.tasks[0]!, status: 'OPEN' }],
  });
  assert.equal(calculateNextAction(openTask, 'svc-a', { ...ALL, improve: false }).id, 'review-improvement');
  assert.equal(calculateNextAction(openTask, 'svc-a', { ...ALL, improve: false }).state, 'LOCKED');

  const gated = view('org-a', 'svc-a', {
    ...improving,
    executions: [{
      id: 'exec', tenantId: 'org-a', taskId: 'task', agent: 'CURSOR', allowedPaths: [], deniedPaths: [],
      status: 'COMPLETED', startedAt: '2026-10-08T11:20:00.000Z', finishedAt: '2026-10-08T11:40:00.000Z',
    }],
    gates: [{
      id: 'gate', tenantId: 'org-a', executionId: 'exec', changedFiles: ['src/app/page.tsx'],
      riskFlags: [], testsPassed: true, gate: 'PASS',
    }],
  });
  const afterGate = project(gated);
  assert.equal(afterGate.flow.changeGate, 'APPROVED');
  assert.equal(afterGate.flow.reReview, 'PENDING');
  assert.equal(afterGate.agent.changedFilesCount, 1);
  assert.equal(afterGate.agent.testsPassed, true);
  assert.equal(calculateNextAction(gated, 'svc-a', ALL).label, 'Run re-review');
  assert.equal(calculateNextAction(gated, 'svc-a', { ...ALL, review: false }).state, 'LOCKED');

  const done = view('org-a', 'svc-a', {
    ...gated,
    tasks: [{ ...improving.tasks[0]!, status: 'DONE' }],
    reReviews: [{
      id: 'rr', tenantId: 'org-a', taskId: 'task', previousReviewResultId: 'rev', nextReviewResultId: 'rev',
      resolved: true, sameProblem: false, completedAt: '2026-10-08T11:50:00.000Z',
    }],
  });
  assert.equal(calculateNextAction(done, 'svc-a', ALL).label, 'No action required');
  assert.equal(project(done).health, 'HEALTHY');
  assert.equal(project(done).phase, 'RE_REVIEWED');
});

test('effective authorization ignores a client-supplied role and permission', () => {
  const actor = { ok: true as const, userId: 'user', tenantId: 'org-a', role: 'VIEWER' as const, membershipId: 'mem' };
  const grant: ServiceGrantRow = { id: 'g', tenantId: 'org-a', connectionId: 'svc-a', userId: 'user', permission: 'AGENT' };
  const caps = operationCapabilities({
    actor,
    connection: { id: 'svc-a', tenantId: 'org-a' },
    grants: [grant],
    clientTenantId: 'org-b',
    actingUserId: 'other',
    actorRole: 'OWNER',
    permission: 'AGENT',
  });
  assert.equal(caps.review, false);
  assert.equal(caps.improve, false);
  assert.equal(caps.agent, false);
  assert.equal(caps.collectEvidence, false);
  const developer = operationCapabilities({
    actor: { ...actor, role: 'DEVELOPER' },
    connection: { id: 'svc-a', tenantId: 'org-a' },
    grants: [{ ...grant, permission: 'IMPROVE' }],
    permission: 'AGENT',
  });
  assert.equal(developer.improve, true);
  assert.equal(developer.agent, false);
  assert.deepEqual(accessSummary('DEVELOPER', [{ permission: 'IMPROVE' }]).capabilities, {
    VIEW: true, REVIEW: true, IMPROVE: true, AGENT: false,
  });
});

test('another organization service is absent after the active organization changes', () => {
  const orgA = view('org-a', 'svc-a', {
    results: [],
    audit: [{
      id: 'a1', tenantId: 'org-a', timestamp: '2026-10-08T11:50:00.000Z', actor: 'owner',
      action: 'EVIDENCE_COLLECTED', serviceKey: 'key-svc-a',
    }],
  });
  const orgB = view('org-b', 'svc-b', {
    audit: [{
      id: 'b1', tenantId: 'org-b', timestamp: '2026-10-08T11:40:00.000Z', actor: 'owner',
      action: 'API_KEY_STORED', serviceKey: 'key-svc-b',
    }, {
      id: 'b2', tenantId: 'org-b', timestamp: '2026-10-08T11:45:00.000Z', actor: 'owner',
      action: 'REVIEW_COMPLETED', serviceKey: 'key-svc-b',
    }],
  });
  assert.equal(projectServiceOperation(orgA, 'svc-b', ALL, accessSummary('OWNER', []), NOW), null);
  const switched = project(orgB);
  assert.equal(switched.tenantId, 'org-b');
  assert.equal(switched.name, 'Service svc-b');
  assert.equal(switched.activity.some((row) => row.label === 'Review completed'), true);
  assert.equal(switched.activity.some((row) => /api/i.test(row.label)), false);
  assert.equal(project(orgA).activity[0]?.label, 'Evidence collected');
  assert.equal(project(orgA).activity[0]?.age, '10 min ago');
  const hidden = visibleActivity([{
    id: 'secret', tenantId: 'org-a', timestamp: NOW, actor: 'x', action: 'refresh_token_saved',
  }], NOW);
  assert.equal(hidden.length, 0);
});

test('onboarding status is discovery, scope, then connection', () => {
  const discovering = view('org-a', 'svc-a', { discoveries: [], scopes: [], connections: [{
    ...view('org-a', 'svc-a').connections[0]!, status: 'DISCOVERY_PENDING',
  }] });
  const model = project(discovering);
  assert.equal(model.onboarding.discovery, 'NOT_STARTED');
  assert.equal(model.phase, 'DISCOVERING');
  assert.equal(model.next.label, 'Run discovery');
  const scoped = view('org-a', 'svc-a', {
    scopes: [{ ...view('org-a', 'svc-a').scopes[0]!, status: 'PROPOSED', approvedAt: undefined }],
    connections: [{ ...view('org-a', 'svc-a').connections[0]!, status: 'DRAFT' }],
  });
  assert.equal(project(scoped).onboarding.scope, 'PENDING');
  assert.equal(project(scoped).next.label, 'Review access scope');
  assert.deepEqual(project(view('org-a', 'svc-a')).onboarding, {
    discovery: 'COMPLETE', scope: 'APPROVED', connection: 'CONNECTED',
  });
});

test('operations source does not persist lifecycle or call jury core', () => {
  const status = readFileSync(new URL('./service-operations-status.ts', import.meta.url), 'utf8');
  const loader = readFileSync(new URL('./service-operations.ts', import.meta.url), 'utf8');
  for (const source of [status, loader]) {
    assert.equal(source.includes('prisma'), false);
    assert.equal(source.includes('evaluateChangeGate'), false);
    assert.equal(source.includes('evaluateHumanReReview'), false);
    assert.equal(source.includes('runReviewBoardPipeline'), false);
  }
  assert.equal(loader.includes('authorizeJuryServiceFeature'), true);
  assert.equal(loader.includes('loadJuryCatalog'), true);
  assert.equal(loader.includes('credentialRef'), false);
});
