import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { JuryConsoleView } from './console-view';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT } from './records';
import { restrictJuryConsole } from './service-feature-authorization';
import type { ServiceGrantRow } from './service-member-management';
import {
  actionState,
  accessSummary,
  calculateNextAction,
  operationCapabilities,
  projectServiceOperation,
  visibleActivity,
  exposeOperationalState,
  hasReviewAccess,
  improvementOpenCountCell,
  withoutOperationalState,
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

test('track A: service operations hide review data from a viewer', () => {
  const reviewedView = view('org-a', 'svc-a', {
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
    audit: [
      { id: 'au-svc', tenantId: 'org-a', action: 'SERVICE_CONNECTION_ACTIVATED', serviceKey: 'key-svc-a', timestamp: '2026-10-08T10:00:00.000Z' },
      { id: 'au-done', tenantId: 'org-a', action: 'REVIEW_COMPLETED', reviewId: 'rev', decision: 'REWORD', timestamp: '2026-10-08T11:00:00.000Z' },
    ],
  } as Partial<JuryConsoleView>);
  for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'REVIEWER', 'VIEWER'] as const) {
    const actor = { ok: true as const, userId: 'user', tenantId: 'org-a', role, membershipId: 'mem' };
    const grants: ServiceGrantRow[] = [{ id: 'g', tenantId: 'org-a', connectionId: 'svc-a', userId: 'user', permission: 'AGENT' }];
    const restricted = restrictJuryConsole({ ...reviewedView, role }, actor, grants);
    const model = projectServiceOperation(restricted, 'svc-a', operationCapabilities({ actor, connection: { id: 'svc-a', tenantId: 'org-a' }, grants }), accessSummary(role, grants), NOW);
    assert.ok(model, role);
    const labels = model.activity.map((row) => row.label);
    if (role === 'VIEWER') {
      assert.equal(model.review.empty, true, role);
      assert.equal(model.review.decision, null, role);
      assert.equal(model.review.statusSummary, null, role);
      assert.equal(labels.includes('Review completed'), false, role);
      assert.equal(JSON.stringify(model).includes('REWORD'), false, role);
      assert.equal(JSON.stringify(model).includes('Final only'), false, role);
    } else {
      assert.equal(model.review.empty, false, role);
      assert.equal(model.review.decision, 'REWORD', role);
      assert.equal(labels.includes('Review completed'), true, role);
    }
  }
  const viewOnly = restrictJuryConsole(reviewedView, { ok: true, userId: 'user', tenantId: 'org-a', role: 'OWNER', membershipId: 'mem' },
    [{ id: 'g', tenantId: 'org-a', connectionId: 'svc-a', userId: 'user', permission: 'VIEW' }]);
  assert.equal(viewOnly.results.length, 0);
});

test('track A: service operations loader restricts before projecting', () => {
  const loader = readFileSync(new URL('./service-operations.ts', import.meta.url), 'utf8');
  const restrict = loader.indexOf('restrictJuryConsole(tenantView, actor, grants)');
  assert.ok(restrict > 0);
  assert.ok(restrict < loader.indexOf('projectServiceOperation('));
});

test('track A follow-up: a viewer sees connection, evidence and metrics but no derived pipeline state', () => {
  const evidence = [{
    id: 'ev', tenantId: 'org-a', connectionId: 'svc-a', purpose: 'observe',
    periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
    metricIds: ['m0'], adapterKey: 'mock', collectedAt: '2026-10-08T10:00:00.000Z',
  }];
  const metrics = [{
    id: 'm0', tenantId: 'org-a', connectionId: 'svc-a', evidenceId: 'ev', metric: 'signups',
    value: 3, unit: 'COUNT', periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
    sourceSystem: 'DATABASE', sourceRef: 'db', collectedAt: '2026-10-08T10:00:00.000Z', availability: 'AVAILABLE',
    rawPayloadRef: 'raw/0', adapterKey: 'mock', adapterVersion: '0', ruleId: 'identity',
  }];
  const full = view('org-a', 'svc-a', {
    evidence,
    metrics,
    requests: [{
      id: 'req', tenantId: 'org-a', connectionId: 'svc-a', evidenceId: 'ev', reviewType: 'FULL_REVIEW',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
    }],
    results: [{
      id: 'rev', tenantId: 'org-a', reviewRequestId: 'req', boardRunId: 'run', evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: false,
      expectedDecision: 'ACCEPT',
      finalSurface: {
        statusSummary: 'Final only', topProblems: [], expectedUserEffect: 'none', risk: 'low',
        dimensionEvidence: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [],
      },
      contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: '2026-10-08T11:00:00.000Z',
    }],
  } as Partial<JuryConsoleView>);
  const grants: ServiceGrantRow[] = [{ id: 'g', tenantId: 'org-a', connectionId: 'svc-a', userId: 'user', permission: 'AGENT' }];
  const build = (role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'REVIEWER' | 'VIEWER') => {
    const actor = { ok: true as const, userId: 'user', tenantId: 'org-a', role, membershipId: 'mem' };
    const restricted = restrictJuryConsole({ ...full, role }, actor, grants);
    const model = projectServiceOperation(restricted, 'svc-a', operationCapabilities({ actor, connection: { id: 'svc-a', tenantId: 'org-a' }, grants }), accessSummary(role, grants), NOW);
    assert.ok(model, role);
    return model;
  };
  const viewer = withoutOperationalState(build('VIEWER'));
  assert.equal(viewer.phase, null);
  assert.equal(viewer.health, null);
  assert.equal(viewer.next, null);
  assert.equal(viewer.connectionStatus, 'CONNECTED');
  assert.equal(viewer.parts.connection, 'CONNECTED');
  assert.equal(viewer.parts.evidence, 'READY');
  assert.equal(viewer.evidence.empty, false);
  assert.equal(viewer.evidence.measuredCount, 1);
  assert.equal(viewer.evidence.evidenceId, 'ev');
  assert.equal(viewer.review.empty, true);
  assert.equal(JSON.stringify(viewer).includes('ACCEPT'), false);
  for (const role of ['OWNER', 'ADMIN', 'DEVELOPER', 'REVIEWER'] as const) {
    const model = build(role);
    assert.equal(model.health, 'HEALTHY', role);
    assert.equal(model.phase, 'REVIEWED', role);
    assert.ok(model.next, role);
    assert.equal(model.review.decision, 'ACCEPT', role);
  }
});

test('track A follow-up: the loader strips derived state only when review access is denied', () => {
  const loader = readFileSync(new URL('./service-operations.ts', import.meta.url), 'utf8');
  assert.equal(loader.includes('exposeOperationalState(model, {'), true);
  assert.equal(loader.includes('withoutOperationalState('), false);
  assert.equal(loader.includes('decideJuryMutation('), false);
  const ui = readFileSync(new URL('../../app/(jury)/jury/service-operations-ui.tsx', import.meta.url), 'utf8');
  assert.equal(ui.includes('if (!action) return null;'), true);
  assert.equal(ui.includes('{model.health ? '), true);
  assert.equal(ui.includes('{model.phase ? '), true);
});

function followUp2View(): JuryConsoleView {
  const at = '2026-10-08T10:00:00.000Z';
  const service = (id: string) => view('org-a', id).connections[0]!;
  const evidenceFor = (id: string) => ({
    id: `ev-${id}`, tenantId: 'org-a', connectionId: id, purpose: 'observe',
    periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
    metricIds: [`m-${id}`], adapterKey: 'mock', collectedAt: at,
  });
  const metricFor = (id: string) => ({
    id: `m-${id}`, tenantId: 'org-a', connectionId: id, evidenceId: `ev-${id}`, metric: 'signups',
    value: 3, unit: 'COUNT', periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
    sourceSystem: 'DATABASE', sourceRef: 'db', collectedAt: at, availability: 'AVAILABLE',
    rawPayloadRef: 'raw/0', adapterKey: 'mock', adapterVersion: '0', ruleId: 'identity',
  });
  const reviewed = (id: string) => ({
    requests: [{
      id: `req-${id}`, tenantId: 'org-a', connectionId: id, evidenceId: `ev-${id}`, reviewType: 'FULL_REVIEW',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
    }],
    results: [{
      id: `rev-${id}`, tenantId: 'org-a', reviewRequestId: `req-${id}`, boardRunId: 'run', evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: true,
      expectedDecision: 'REWORD',
      finalSurface: {
        statusSummary: 'Final only', topProblems: ['copy'], expectedUserEffect: 'clearer', risk: 'low',
        dimensionEvidence: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [],
      },
      contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: '2026-10-08T11:00:00.000Z',
    }],
    tasks: [{
      id: `task-${id}`, tenantId: 'org-a', reviewResultId: `rev-${id}`, diagnosis: 'Reword the headline',
      acceptanceCriteria: ['headline'], status: 'OPEN', loopIndex: 1,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      createdAt: '2026-10-08T11:10:00.000Z',
    }],
    executions: [{
      id: `exec-${id}`, tenantId: 'org-a', taskId: `task-${id}`, agent: 'CURSOR', allowedPaths: [], deniedPaths: [],
      status: 'SUCCEEDED', startedAt: '2026-10-08T11:20:00.000Z', finishedAt: '2026-10-08T11:30:00.000Z',
    }],
  });
  const a = reviewed('svc-a');
  const b = reviewed('svc-b');
  const base = view('org-a', 'svc-a');
  return {
    ...base,
    connections: [service('svc-a'), service('svc-b')],
    scopes: [...base.scopes, ...view('org-a', 'svc-b').scopes],
    discoveries: [...base.discoveries, ...view('org-a', 'svc-b').discoveries],
    evidence: [evidenceFor('svc-a'), evidenceFor('svc-b')],
    metrics: [metricFor('svc-a'), metricFor('svc-b')],
    requests: [...a.requests, ...b.requests],
    results: [...a.results, ...b.results],
    tasks: [...a.tasks, ...b.tasks],
    executions: [...a.executions, ...b.executions],
  } as JuryConsoleView;
}

const FU2_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'REVIEWER', 'VIEWER'] as const;
type Fu2Role = typeof FU2_ROLES[number];

function fu2Model(role: Fu2Role, connectionId: string, grants: ServiceGrantRow[], client: { actorRole?: string; permission?: string } = {}) {
  const actor = { ok: true as const, userId: 'user', tenantId: 'org-a', role, membershipId: 'mem' };
  const restricted = restrictJuryConsole({ ...followUp2View(), role }, actor, grants);
  const connection = { id: connectionId, tenantId: 'org-a' };
  const input = { actor, connection, grants, ...client };
  const projected = projectServiceOperation(restricted, connectionId, operationCapabilities(input), accessSummary(role, grants), NOW);
  assert.ok(projected, `${role} ${connectionId}`);
  return { projected, exposed: exposeOperationalState(projected, input) };
}

function fu2Grant(connectionId: string, permission: ServiceGrantRow['permission']): ServiceGrantRow {
  return { id: `g-${connectionId}`, tenantId: 'org-a', connectionId, userId: 'user', permission };
}

function assertStatusOnly(model: ReturnType<typeof withoutOperationalState>, label: string) {
  assert.equal(model.phase, null, label);
  assert.equal(model.health, null, label);
  assert.equal(model.next, null, label);
  assert.equal(model.parts.review, null, label);
  assert.equal(model.parts.improvement, null, label);
  assert.equal(model.parts.agent, null, label);
  assert.equal(model.flow, null, label);
  const json = JSON.stringify(model);
  for (const word of ['NOT_READY', 'IDLE', 'REWORD', 'Final only']) assert.equal(json.includes(word), false, `${label} ${word}`);
}

function assertStatusKept(model: ReturnType<typeof withoutOperationalState>, connectionId: string, label: string) {
  assert.equal(model.connectionStatus, 'CONNECTED', label);
  assert.equal(model.parts.connection, 'CONNECTED', label);
  assert.equal(model.parts.evidence, 'READY', label);
  assert.equal(model.evidence.empty, false, label);
  assert.equal(model.evidence.evidenceId, `ev-${connectionId}`, label);
  assert.equal(model.evidence.measuredCount, 1, label);
}

test('follow-up 2 (1): a viewer never sees review, improvement, agent or flow state, even with an AGENT grant', () => {
  for (const permission of ['VIEW', 'REVIEW', 'IMPROVE', 'AGENT'] as const) {
    const { exposed } = fu2Model('VIEWER', 'svc-a', [fu2Grant('svc-a', permission)]);
    assertStatusOnly(exposed, `VIEWER ${permission}`);
    assertStatusKept(exposed, 'svc-a', `VIEWER ${permission}`);
  }
});

test('follow-up 2 (2): reviewer and above without a REVIEW grant on the service get the status-only view', () => {
  for (const role of FU2_ROLES.filter((row) => row !== 'VIEWER')) {
    const { exposed } = fu2Model(role, 'svc-a', [fu2Grant('svc-a', 'VIEW')]);
    assertStatusOnly(exposed, `${role} VIEW`);
    assertStatusKept(exposed, 'svc-a', `${role} VIEW`);
  }
});

test('follow-up 2 (3): members with review.read on the service keep the full model unchanged', () => {
  const top: Record<Exclude<Fu2Role, 'VIEWER'>, ServiceGrantRow['permission']> = { OWNER: 'AGENT', ADMIN: 'AGENT', DEVELOPER: 'IMPROVE', REVIEWER: 'REVIEW' };
  for (const role of FU2_ROLES.filter((row): row is Exclude<Fu2Role, 'VIEWER'> => row !== 'VIEWER')) {
    for (const permission of ['REVIEW', top[role]] as const) {
      const { projected, exposed } = fu2Model(role, 'svc-a', [fu2Grant('svc-a', permission)]);
      assert.deepEqual(exposed, projected, `${role} ${permission}`);
      assert.equal(exposed.parts.review, 'LAST_RESULT_AVAILABLE', role);
      assert.ok(exposed.flow, role);
      assert.ok(exposed.phase && exposed.health && exposed.next, role);
      assertStatusKept(exposed, 'svc-a', role);
    }
  }
});

test('follow-up 2 (4): the decision is per service, not per organization role', () => {
  const grants = [fu2Grant('svc-a', 'REVIEW'), fu2Grant('svc-b', 'VIEW')];
  const a = fu2Model('REVIEWER', 'svc-a', grants).exposed;
  const b = fu2Model('REVIEWER', 'svc-b', grants).exposed;
  assert.equal(a.parts.review, 'LAST_RESULT_AVAILABLE');
  assert.ok(a.flow);
  assertStatusOnly(b, 'REVIEWER svc-b VIEW');
  assertStatusKept(b, 'svc-b', 'REVIEWER svc-b VIEW');
});

test('follow-up 2 (5): a client-supplied role or permission does not unlock derived state', () => {
  const { exposed } = fu2Model('VIEWER', 'svc-a', [fu2Grant('svc-a', 'VIEW')], { actorRole: 'OWNER', permission: 'AGENT' });
  assertStatusOnly(exposed, 'VIEWER spoofed');
  const reviewer = fu2Model('REVIEWER', 'svc-a', [fu2Grant('svc-a', 'VIEW')], { actorRole: 'OWNER', permission: 'AGENT' }).exposed;
  assertStatusOnly(reviewer, 'REVIEWER spoofed');
});

test('follow-up 2 (6): the UI renders nothing for hidden parts and flow, and the loader adds no query', () => {
  const ui = readFileSync(new URL('../../app/(jury)/jury/service-operations-ui.tsx', import.meta.url), 'utf8');
  for (const guard of ['{model.parts.review ? ', '{model.parts.improvement ? ', '{model.parts.agent ? ', '{model.flow ? (']) {
    assert.equal(ui.includes(guard), true, guard);
  }
  const loader = readFileSync(new URL('./service-operations.ts', import.meta.url), 'utf8');
  assert.equal((loader.match(/loadJuryCatalog\(/g) ?? []).length, 2);
  assert.equal((loader.match(/listUserServiceGrants\(/g) ?? []).length, 2);
});

function followUp3NoData(): JuryConsoleView {
  const full = followUp2View();
  return { ...full, requests: [], results: [], tasks: [], executions: [] };
}

function fu3Model(input: JuryConsoleView, role: Fu2Role, permission: ServiceGrantRow['permission']) {
  const actor = { ok: true as const, userId: 'user', tenantId: 'org-a', role, membershipId: 'mem' };
  const grants = [fu2Grant('svc-a', permission)];
  const restricted = restrictJuryConsole({ ...input, role }, actor, grants);
  const args = { actor, connection: { id: 'svc-a', tenantId: 'org-a' }, grants };
  const projected = projectServiceOperation(restricted, 'svc-a', operationCapabilities(args), accessSummary(role, grants), NOW);
  assert.ok(projected);
  return exposeOperationalState(projected, args);
}

test('follow-up 3: review, improvement and agent areas follow service review.read in all four data combinations', () => {
  const combos = [
    { label: 'no permission + data', input: followUp2View(), role: 'VIEWER' as const, permission: 'AGENT' as const, access: false, data: true },
    { label: 'no permission + data (reviewer, VIEW grant)', input: followUp2View(), role: 'REVIEWER' as const, permission: 'VIEW' as const, access: false, data: true },
    { label: 'no permission + no data', input: followUp3NoData(), role: 'VIEWER' as const, permission: 'VIEW' as const, access: false, data: false },
    { label: 'permission + data', input: followUp2View(), role: 'REVIEWER' as const, permission: 'REVIEW' as const, access: true, data: true, improvementRead: false },
    { label: 'permission + data (owner, AGENT grant)', input: followUp2View(), role: 'OWNER' as const, permission: 'AGENT' as const, access: true, data: true, improvementRead: true },
    { label: 'permission + no data', input: followUp3NoData(), role: 'OWNER' as const, permission: 'AGENT' as const, access: true, data: false },
  ];
  for (const combo of combos) {
    const model = fu3Model(combo.input, combo.role, combo.permission);
    assert.equal(hasReviewAccess(model), combo.access, combo.label);
    assertStatusKept(model, 'svc-a', combo.label);
    if (!combo.access) {
      assertStatusOnly(model, combo.label);
      continue;
    }
    assert.equal(model.review.empty, !combo.data, combo.label);
    // improvement and agent records follow improvement.read (restrictJuryConsole), independent of this follow-up
    const improvementData = combo.data && combo.improvementRead === true;
    assert.equal(model.improvement.empty, !improvementData, combo.label);
    assert.equal(model.agent.empty, !improvementData, combo.label);
    assert.equal(model.lastReview, combo.data ? 'REWORD' : 'No review', combo.label);
    assert.equal(model.review.decision, combo.data ? 'REWORD' : null, combo.label);
    assert.equal(model.parts.review, combo.data ? 'LAST_RESULT_AVAILABLE' : 'NONE', combo.label);
  }
});

test('follow-up 3: the UI gates review areas and list cells on hasReviewAccess and keeps empty states for permitted users', () => {
  const ui = readFileSync(new URL('../../app/(jury)/jury/service-operations-ui.tsx', import.meta.url), 'utf8');
  assert.equal(ui.includes("<td>{hasReviewAccess(row) ? displayText(row.lastReview) : '—'}</td>"), true);
  assert.equal(ui.includes("<td>{hasReviewAccess(row) ? displayText(row.review.decision ?? 'No review') : '—'}</td>"), true);
  assert.equal(ui.includes("<td>{hasReviewAccess(row) ? <StatusBadge status={row.agent.status ?? undefined} title={row.agent.status ?? undefined}>{displayText(row.agent.status ?? 'No execution')}</StatusBadge> : '—'}</td>"), true);
  const gate = ui.indexOf('{hasReviewAccess(model) ? (');
  assert.ok(gate > 0);
  const end = ui.indexOf(') : null}', gate);
  const gated = ui.slice(gate, end);
  for (const text of ['<h3>심사</h3>', '<p>심사 없음</p>', '<h3>개선</h3>', '<p>개선 없음</p>', '<h3>에이전트</h3>', '<p>실행 없음</p>']) {
    assert.equal(gated.includes(text), true, text);
    assert.equal(ui.split(text).length - 1, 1, `${text} renders only inside the gate`);
  }
  const evidence = ui.indexOf('<h3>심사 근거</h3>');
  assert.ok(evidence > 0 && evidence < gate, 'evidence stays outside the gate');
  assert.equal(ui.includes('{model.flow ? ('), true);
  assert.equal(ui.includes('if (!action) return null;'), true);
});

test('track A pre-commit: open improvement count shows — without review.read and the number with it', () => {
  const full = { parts: { review: 'REVIEWED' }, improvement: { openCount: 3 } } as unknown as Parameters<typeof withoutOperationalState>[0];
  const empty = { parts: { review: 'REVIEWED' }, improvement: { openCount: 0 } } as unknown as Parameters<typeof withoutOperationalState>[0];
  assert.equal(improvementOpenCountCell(full), 3);
  assert.equal(improvementOpenCountCell(empty), 0);
  assert.equal(improvementOpenCountCell(withoutOperationalState(full)), '—');
  assert.equal(improvementOpenCountCell(withoutOperationalState(empty)), '—');
  const ui = readFileSync('src/app/(jury)/jury/service-operations-ui.tsx', 'utf8');
  assert.ok(ui.includes('<td className={styles.num}>{improvementOpenCountCell(row)}</td>'));
  assert.equal(ui.includes('<td>{row.improvement.openCount}</td>'), false);
});
