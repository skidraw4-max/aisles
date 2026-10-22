/**
 * Run: node --import tsx --test src/lib/jury-product/service-feature-authorization-agent-visibility.test.ts
 * Track B C2: agentTaskIds from the real restrictJuryConsole. Assertions use task ids only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JuryActor } from './access';
import type { JuryConsoleView } from './console-view';
import type { JuryMemberRole } from './records';
import { restrictJuryConsole } from './service-feature-authorization';
import type { ServiceGrantRow } from './service-member-management';
import type { JuryServicePermission } from './service-permission';

function actor(role: JuryMemberRole, tenantId = 'org-a', userId = 'user-1'): Extract<JuryActor, { ok: true }> {
  return { ok: true, userId, tenantId, role, membershipId: `mem-${userId}` };
}

function grant(connectionId: string, permission: JuryServicePermission, userId = 'user-1', tenantId = 'org-a'): ServiceGrantRow {
  return { id: `${connectionId}-${permission}-${userId}`, tenantId, connectionId, userId, permission };
}

/**
 * task-a -> svc-a, task-b -> svc-b (org-a services).
 * task-x -> svc-x (another tenant's service), task-orphan -> result without a request,
 * task-unmapped -> missing result. Each task has one execution.
 */
function fixture(): JuryConsoleView {
  return {
    tenantId: 'org-a',
    role: 'OWNER',
    connections: [
      { id: 'svc-a', tenantId: 'org-a', displayName: 'A' },
      { id: 'svc-b', tenantId: 'org-a', displayName: 'B' },
      { id: 'svc-x', tenantId: 'org-b', displayName: 'X' },
    ],
    scopes: [],
    discoveries: [],
    metrics: [],
    evidence: [],
    requests: [
      { id: 'req-a', tenantId: 'org-a', connectionId: 'svc-a' },
      { id: 'req-b', tenantId: 'org-a', connectionId: 'svc-b' },
      { id: 'req-x', tenantId: 'org-b', connectionId: 'svc-x' },
    ],
    results: [
      { id: 'rev-a', tenantId: 'org-a', reviewRequestId: 'req-a' },
      { id: 'rev-b', tenantId: 'org-a', reviewRequestId: 'req-b' },
      { id: 'rev-x', tenantId: 'org-a', reviewRequestId: 'req-x' },
      { id: 'rev-orphan', tenantId: 'org-a', reviewRequestId: 'req-missing' },
    ],
    tasks: [
      { id: 'task-a', tenantId: 'org-a', reviewResultId: 'rev-a' },
      { id: 'task-b', tenantId: 'org-a', reviewResultId: 'rev-b' },
      { id: 'task-x', tenantId: 'org-a', reviewResultId: 'rev-x' },
      { id: 'task-orphan', tenantId: 'org-a', reviewResultId: 'rev-orphan' },
      { id: 'task-unmapped', tenantId: 'org-a', reviewResultId: 'rev-missing' },
    ],
    executions: [
      { id: 'exec-a', tenantId: 'org-a', taskId: 'task-a' },
      { id: 'exec-b', tenantId: 'org-a', taskId: 'task-b' },
      { id: 'exec-x', tenantId: 'org-a', taskId: 'task-x' },
      { id: 'exec-orphan', tenantId: 'org-a', taskId: 'task-orphan' },
      { id: 'exec-unmapped', tenantId: 'org-a', taskId: 'task-unmapped' },
    ],
    gates: [],
    reReviews: [],
    audit: [],
    loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
  } as unknown as JuryConsoleView;
}

function agentIds(role: JuryMemberRole, grants: ServiceGrantRow[]): string[] {
  return [...(restrictJuryConsole(fixture(), actor(role), grants).agentTaskIds ?? [])].sort();
}

function taskIds(role: JuryMemberRole, grants: ServiceGrantRow[]): string[] {
  return restrictJuryConsole(fixture(), actor(role), grants).tasks.map((row) => row.id).sort();
}

const AGENT_ROLES: JuryMemberRole[] = ['OWNER', 'ADMIN', 'DEVELOPER'];
const NO_AGENT_ROLES: JuryMemberRole[] = ['REVIEWER', 'VIEWER'];
const ALL_ROLES: JuryMemberRole[] = [...AGENT_ROLES, ...NO_AGENT_ROLES];

test('C2 1: a role with the action and an AGENT grant on the service includes the task id', () => {
  for (const role of AGENT_ROLES) {
    assert.deepEqual(agentIds(role, [grant('svc-a', 'AGENT')]), ['task-a'], role);
    assert.deepEqual(agentIds(role, [grant('svc-a', 'AGENT'), grant('svc-b', 'AGENT')]), ['task-a', 'task-b'], role);
  }
});

test('C2 2: without an AGENT grant on that service the task id is excluded, even when the task is visible', () => {
  for (const role of AGENT_ROLES) {
    assert.deepEqual(taskIds(role, [grant('svc-a', 'IMPROVE')]), ['task-a'], role);
    assert.deepEqual(agentIds(role, [grant('svc-a', 'IMPROVE')]), [], role);
    for (const permission of ['VIEW', 'REVIEW'] as const) {
      assert.deepEqual(agentIds(role, [grant('svc-a', permission)]), [], `${role} ${permission}`);
    }
    assert.deepEqual(agentIds(role, []), [], `${role} no grant`);
    assert.deepEqual(agentIds(role, [grant('svc-a', 'AGENT', 'user-2')]), [], `${role} other user's grant`);
    assert.deepEqual(agentIds(role, [grant('svc-a', 'AGENT', 'user-1', 'org-b')]), [], `${role} other tenant's grant`);
  }
});

test('C2 3: an AGENT grant does not help a role without the action', () => {
  for (const role of NO_AGENT_ROLES) {
    assert.deepEqual(agentIds(role, [grant('svc-a', 'AGENT'), grant('svc-b', 'AGENT')]), [], role);
  }
});

test('C2 4: tasks that cannot be mapped to one of this tenant\'s connections are excluded', () => {
  const everything = [grant('svc-a', 'AGENT'), grant('svc-b', 'AGENT'), grant('svc-x', 'AGENT'), grant('', 'AGENT')];
  for (const role of AGENT_ROLES) {
    const ids = agentIds(role, everything);
    for (const hidden of ['task-x', 'task-orphan', 'task-unmapped']) {
      assert.equal(ids.includes(hidden), false, `${role} ${hidden}`);
    }
    assert.deepEqual(ids, ['task-a', 'task-b'], role);
  }
});

test('C2 5: a grant on one service never includes a task of another service', () => {
  for (const role of AGENT_ROLES) {
    assert.deepEqual(agentIds(role, [grant('svc-a', 'AGENT')]), ['task-a'], `${role} svc-a`);
    assert.deepEqual(agentIds(role, [grant('svc-b', 'AGENT')]), ['task-b'], `${role} svc-b`);
    const mixed = [grant('svc-a', 'AGENT'), grant('svc-b', 'IMPROVE')];
    assert.deepEqual(taskIds(role, mixed), ['task-a', 'task-b'], `${role} mixed tasks`);
    assert.deepEqual(agentIds(role, mixed), ['task-a'], `${role} mixed agent`);
  }
});

test('C2 6: agentTaskIds equals the visible tasks whose executions survive the executions filter', () => {
  const grantSets: ServiceGrantRow[][] = [
    [],
    [grant('svc-a', 'VIEW')],
    [grant('svc-a', 'REVIEW')],
    [grant('svc-a', 'IMPROVE')],
    [grant('svc-a', 'AGENT')],
    [grant('svc-b', 'AGENT')],
    [grant('svc-a', 'AGENT'), grant('svc-b', 'IMPROVE')],
    [grant('svc-a', 'AGENT'), grant('svc-b', 'AGENT'), grant('svc-x', 'AGENT'), grant('', 'AGENT')],
  ];
  for (const role of ALL_ROLES) {
    for (const grants of grantSets) {
      const label = `${role} ${grants.map((row) => `${row.connectionId}:${row.permission}`).join(',') || 'none'}`;
      const shown = restrictJuryConsole(fixture(), actor(role), grants);
      const ids = [...(shown.agentTaskIds ?? [])].sort();
      const visibleTasks = new Set(shown.tasks.map((row) => row.id));
      const executed = new Set(shown.executions.map((row) => row.taskId));
      const expected = [...executed].filter((id) => visibleTasks.has(id)).sort();
      assert.deepEqual(ids, expected, label);
      for (const id of ids) assert.equal(visibleTasks.has(id), true, `${label} ${id} must be a visible task`);
    }
  }
});

test('C2 7: agentTaskIds carries only ids of tasks in the input view', () => {
  const inputIds = new Set(fixture().tasks.map((row) => row.id));
  const shown = restrictJuryConsole(fixture(), actor('OWNER'), [grant('svc-a', 'AGENT'), grant('svc-b', 'AGENT')]);
  for (const id of shown.agentTaskIds ?? []) {
    assert.equal(typeof id, 'string');
    assert.equal(inputIds.has(id), true, id);
  }
});
