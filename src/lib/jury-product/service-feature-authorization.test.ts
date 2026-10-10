/**
 * Run: node --import tsx --test src/lib/jury-product/service-feature-authorization.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import type { JuryConsoleView } from './console-view';
import type { JuryMemberRole } from './records';
import {
  agentPermissionBypassesPipeline,
  authorizeJuryServiceFeature,
  restrictJuryConsole,
  type ServiceFeature,
} from './service-feature-authorization';
import type { ServiceGrantRow } from './service-member-management';
import type { JuryServicePermission } from './service-permission';

function actor(role: JuryMemberRole, tenantId = 'org-a', userId = 'user-1'): Extract<JuryActor, { ok: true }> {
  return { ok: true, userId, tenantId, role, membershipId: `mem-${userId}` };
}

function grant(connectionId: string, permission: JuryServicePermission, userId = 'user-1', tenantId = 'org-a'): ServiceGrantRow {
  return { id: `${connectionId}-${permission}`, tenantId, connectionId, userId, permission };
}

function decide(
  role: JuryMemberRole,
  permission: JuryServicePermission | null,
  feature: ServiceFeature,
  extra: Partial<Parameters<typeof authorizeJuryServiceFeature>[0]> = {},
) {
  const current = actor(role);
  return authorizeJuryServiceFeature({
    actor: current,
    membership: { tenantId: current.tenantId, userId: current.userId },
    connection: { id: 'svc-a', tenantId: 'org-a' },
    grants: permission ? [grant('svc-a', permission)] : [],
    feature,
    ...extra,
  });
}

test('service read follows view permission and organization membership', () => {
  assert.equal(decide('VIEWER', 'VIEW', 'service.read').ok, true);
  assert.equal(decide('VIEWER', 'REVIEW', 'service.read').ok, true);
  assert.equal(decide('VIEWER', null, 'service.read').ok, false);
  const missingMembership = authorizeJuryServiceFeature({
    actor: actor('VIEWER'),
    membership: null,
    connection: { id: 'svc-a', tenantId: 'org-a' },
    grants: [grant('svc-a', 'VIEW')],
    feature: 'service.read',
  });
  assert.equal(missingMembership.ok, false);
  const foreign = authorizeJuryServiceFeature({
    actor: actor('VIEWER'),
    membership: { tenantId: 'org-a', userId: 'user-1' },
    connection: { id: 'svc-b', tenantId: 'org-b' },
    grants: [grant('svc-b', 'AGENT', 'user-1', 'org-b')],
    feature: 'service.read',
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
});

test('review requires review permission and a role that can review', () => {
  assert.equal(decide('REVIEWER', 'REVIEW', 'review.read').ok, true);
  assert.equal(decide('REVIEWER', 'REVIEW', 'review.execute').ok, true);
  assert.equal(decide('REVIEWER', 'VIEW', 'review.read').ok, false);
  assert.equal(decide('REVIEWER', null, 'review.execute').ok, false);
  assert.equal(decide('DEVELOPER', 'IMPROVE', 'review.read').ok, true);
  assert.equal(decide('VIEWER', 'REVIEW', 'review.read').ok, false);
  assert.equal(decide('VIEWER', 'AGENT', 'review.execute').ok, false);
});

test('improvement and agent follow role capability and the permission hierarchy', () => {
  assert.equal(decide('DEVELOPER', 'IMPROVE', 'improvement.read').ok, true);
  assert.equal(decide('DEVELOPER', 'IMPROVE', 'improvement.write').ok, true);
  assert.equal(decide('DEVELOPER', 'VIEW', 'improvement.write').ok, false);
  assert.equal(decide('DEVELOPER', 'REVIEW', 'improvement.write').ok, false);
  assert.equal(decide('DEVELOPER', 'AGENT', 'improvement.write').ok, true);
  assert.equal(decide('DEVELOPER', 'AGENT', 'agent.execute').ok, true);
  assert.equal(decide('DEVELOPER', 'IMPROVE', 'agent.execute').ok, false);
  assert.equal(decide('DEVELOPER', 'REVIEW', 'agent.execute').ok, false);
  assert.equal(decide('DEVELOPER', 'VIEW', 'agent.execute').ok, false);
  assert.equal(decide('DEVELOPER', null, 'agent.execute').ok, false);
  assert.equal(decide('REVIEWER', 'IMPROVE', 'improvement.write').ok, false);
  assert.equal(decide('REVIEWER', 'REVIEW', 'review.execute').ok, true);
});

test('owner and admin service administration does not grant feature execution', () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    assert.equal(decide(role, 'VIEW', 'service.read').ok, true);
    assert.equal(decide(role, 'VIEW', 'agent.execute').ok, false);
    assert.equal(decide(role, 'VIEW', 'improvement.write').ok, false);
    assert.equal(decide(role, 'AGENT', 'agent.execute').ok, true);
  }
  assert.equal(decide('VIEWER', 'AGENT', 'agent.execute').ok, false);
  assert.equal(decide('VIEWER', 'AGENT', 'service.read').ok, true);
});

test('role and service permission stay independent across services and access scopes', () => {
  const grants = [grant('svc-a', 'AGENT'), grant('svc-b', 'VIEW')];
  const before = grants.map((row) => ({ ...row }));
  const developer = authorizeJuryServiceFeature({
    actor: actor('DEVELOPER'),
    membership: { tenantId: 'org-a', userId: 'user-1' },
    connection: { id: 'svc-a', tenantId: 'org-a' },
    grants,
    feature: 'agent.execute',
    accessScope: { grants: [{ resource: 'ga4', mode: 'READ' }] },
  });
  const reviewer = authorizeJuryServiceFeature({
    actor: actor('REVIEWER'),
    membership: { tenantId: 'org-a', userId: 'user-1' },
    connection: { id: 'svc-a', tenantId: 'org-a' },
    grants,
    feature: 'agent.execute',
    accessScope: { grants: [] },
  });
  const otherService = authorizeJuryServiceFeature({
    actor: actor('DEVELOPER'),
    membership: { tenantId: 'org-a', userId: 'user-1' },
    connection: { id: 'svc-b', tenantId: 'org-a' },
    grants,
    feature: 'agent.execute',
  });
  assert.equal(developer.ok, true);
  assert.equal(reviewer.ok, false);
  assert.equal(otherService.ok, false);
  assert.deepEqual(grants, before);
  assert.equal(actor('DEVELOPER').role, 'DEVELOPER');
});

test('foreign resource ids and client identity cannot widen access', () => {
  const base = {
    actor: actor('DEVELOPER'),
    membership: { tenantId: 'org-a', userId: 'user-1' },
    connection: { id: 'svc-a', tenantId: 'org-a' },
    grants: [grant('svc-a', 'AGENT')],
    feature: 'agent.execute' as const,
    clientTenantId: 'org-b',
    actingUserId: 'owner-user',
    actorRole: 'OWNER',
    permission: 'AGENT',
    capability: 'agent.execute',
  };
  assert.equal(authorizeJuryServiceFeature(base).ok, true);
  for (const kind of ['service', 'evidence', 'review', 'improvement', 'agent', 'changeGate', 'rereview'] as const) {
    const foreign = authorizeJuryServiceFeature({
      ...base,
      resource: { kind, id: `${kind}-b`, tenantId: 'org-b', connectionId: 'svc-b' },
      connection: { id: 'svc-b', tenantId: 'org-b' },
    });
    assert.equal(foreign.ok, false, kind);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
  }
  const viewer = authorizeJuryServiceFeature({
    ...base,
    actor: actor('VIEWER'),
    actorRole: 'OWNER',
    permission: 'AGENT',
    capability: 'agent.execute',
  });
  assert.equal(viewer.ok, false);
});

test('agent permission does not bypass change gate, re-review, or jury core', () => {
  assert.equal(agentPermissionBypassesPipeline(), false);
  const gate = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/product-change-gate.ts'), 'utf8');
  const rereview = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/product-change-gate-rereview.ts'), 'utf8');
  const helper = readFileSync(new URL('./service-feature-authorization.ts', import.meta.url), 'utf8');
  assert.equal(gate.includes('evaluateChangeGate'), true);
  assert.equal(gate.includes('authorizeJuryServiceFeature'), false);
  assert.equal(rereview.includes('evaluateHumanReReview'), true);
  assert.equal(rereview.includes('authorizeJuryServiceFeature'), false);
  for (const token of ['evaluateChangeGate', 'evaluateHumanReReview', 'runReviewBoardPipeline', 'migratedServicePermissions']) {
    assert.equal(helper.includes(token), false, token);
  }
});

test('console lists keep service administration and hide feature rows without permission', () => {
  const view = {
    tenantId: 'org-a',
    role: 'DEVELOPER',
    connections: [
      { id: 'svc-a', tenantId: 'org-a', displayName: 'A' },
      { id: 'svc-b', tenantId: 'org-a', displayName: 'B' },
      { id: 'svc-x', tenantId: 'org-b', displayName: 'X' },
    ],
    scopes: [{ id: 'scope-a', tenantId: 'org-a', connectionId: 'svc-a' }],
    discoveries: [],
    metrics: [{ id: 'metric-a', tenantId: 'org-a', connectionId: 'svc-a' }],
    evidence: [
      { id: 'ev-a', tenantId: 'org-a', connectionId: 'svc-a' },
      { id: 'ev-b', tenantId: 'org-b', connectionId: 'svc-x' },
    ],
    requests: [{ id: 'req-a', tenantId: 'org-a', connectionId: 'svc-a', reviewRequestId: 'req-a' }],
    results: [{ id: 'rev-a', tenantId: 'org-a', reviewRequestId: 'req-a' }],
    tasks: [{ id: 'task-a', tenantId: 'org-a', reviewResultId: 'rev-a' }],
    executions: [{ id: 'exec-a', tenantId: 'org-a', taskId: 'task-a' }],
    gates: [{ id: 'gate-a', tenantId: 'org-a', executionId: 'exec-a' }],
    reReviews: [{ id: 'rr-a', tenantId: 'org-a', taskId: 'task-a' }],
    audit: [{ id: 'audit-a', tenantId: 'org-a' }],
    loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
  } as unknown as JuryConsoleView;
  const visible = restrictJuryConsole(view, actor('DEVELOPER'), [grant('svc-a', 'AGENT')]);
  assert.equal(visible.connections.length, 3);
  assert.equal(visible.evidence.length, 1);
  assert.equal(visible.results.length, 1);
  assert.equal(visible.tasks.length, 1);
  assert.equal(visible.executions.length, 1);
  const limited = restrictJuryConsole(view, actor('DEVELOPER'), [grant('svc-a', 'VIEW')]);
  assert.equal(limited.connections.length, 3);
  assert.equal(limited.evidence.length, 1);
  assert.equal(limited.results.length, 0);
  assert.equal(limited.tasks.length, 0);
  assert.equal(limited.executions.length, 0);
  assert.equal(limited.gates.length, 0);
});

test('product actions authorize before review, improvement, and agent work', () => {
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const review = actions.slice(actions.indexOf('export async function runConnectedServiceJuryReview'));
  assert.equal(review.indexOf('guardServiceFeature') < review.indexOf('runConnectedServiceReview'), true);
  const agent = actions.slice(
    actions.indexOf('export async function runHumanAgentExecution'),
    actions.indexOf('async function tenantReviewCore'),
  );
  assert.equal(agent.indexOf('guardAgentExecutionFeature') < agent.indexOf('executeProductAgentExecution'), true);
  assert.equal(agent.includes('servicePermissions: agentAccess.servicePermissions'), true);
  for (const key of ['tenantId', 'actingUserId', 'actorRole', 'permission', 'capability']) {
    assert.equal(agent.includes(`formData.get('${key}')`), false, key);
  }
  const gate = actions.slice(actions.indexOf('export async function runProductChangeGate'), actions.indexOf('export async function runProductChangeGateReReview'));
  assert.equal(gate.includes('evaluateProductChangeGate'), true);
  assert.equal(gate.includes('guardAgentExecutionFeature'), false);
});
