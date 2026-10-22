/**
 * Track B F1: Automation Loop cycles follow the service review.read grant.
 * DB-free. Tenant enabled, mode, and policy stay readable for every console reader.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import {
  canReadConsoleLoopCycles,
  consoleLoopCycleConnection,
  planConsoleLoopRead,
  projectConsoleLoop,
  restrictConsoleLoopCycles,
  type ConsoleLoopCycleSource,
} from './console-loop-operations';
import type { ServiceGrantRow } from './service-member-management';

const TENANT = 'trackb-loop';
const FOREIGN = 'trackb-loop-foreign';
const CONN_A = 'trackb-conn-a';
const CONN_B = 'trackb-conn-b';

function actor(role: 'OWNER' | 'ADMIN' | 'REVIEWER' | 'DEVELOPER' | 'VIEWER', userId = `trackb-${role.toLowerCase()}`): JuryActor {
  return { ok: true, userId, tenantId: TENANT, role, membershipId: `${userId}-m` };
}

function grant(userId: string, connectionId: string, permission: ServiceGrantRow['permission']): ServiceGrantRow {
  return { id: `${userId}-${connectionId}`, tenantId: TENANT, connectionId, userId, permission };
}

function review(connectionId: string | null, tenantId = TENANT) {
  return {
    tenantId,
    request: { tenantId, connection: connectionId ? { id: connectionId, tenantId } : null },
  };
}

function cycle(id: string, root: ReturnType<typeof review> | null, current: ReturnType<typeof review> | null, extra: Partial<ConsoleLoopCycleSource> = {}): ConsoleLoopCycleSource {
  return {
    id,
    tenantId: TENANT,
    status: 'ACTIVE',
    iteration: 2,
    verificationAttempts: 1,
    sameDecisionCount: 1,
    sameConflictCount: 0,
    blockedReason: null,
    rootReviewResult: root,
    currentReviewResult: current,
    ...extra,
  };
}

const cycleA = cycle('cycle-a', review(CONN_A), review(CONN_A));
const cycleB = cycle('cycle-b', review(CONN_B), review(CONN_B), { status: 'BLOCKED', blockedReason: 'MAX_RUNTIME' });
const unlinked = cycle('cycle-unlinked', review(null), review(null));
const missing = cycle('cycle-missing', null, null);
const split = cycle('cycle-split', review(CONN_A), review(CONN_B));
const foreignReview = cycle('cycle-foreign-review', review(CONN_A, FOREIGN), review(CONN_A, FOREIGN));
const foreignCycle = cycle('cycle-foreign', review(CONN_A), review(CONN_A), { tenantId: FOREIGN });
const ALL = [cycleA, cycleB, unlinked, missing, split, foreignReview, foreignCycle];

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

test('VIEWER never receives cycles, even with a service grant', () => {
  const viewer = actor('VIEWER');
  assert.equal(canReadConsoleLoopCycles(viewer), false);
  const grants = [grant('trackb-viewer', CONN_A, 'AGENT'), grant('trackb-viewer', CONN_B, 'AGENT')];
  assert.deepEqual(restrictConsoleLoopCycles({ actor: viewer, cycles: ALL, grants }), []);
  assert.equal(canReadConsoleLoopCycles({ ok: false, reason: 'UNAUTHENTICATED' }), false);
  assert.deepEqual(restrictConsoleLoopCycles({ actor: { ok: false, reason: 'NO_MEMBERSHIP' }, cycles: ALL, grants }), []);
});

test('REVIEWER and above need review.read on the cycle service', () => {
  for (const role of ['OWNER', 'ADMIN', 'REVIEWER', 'DEVELOPER'] as const) {
    const who = actor(role);
    assert.equal(canReadConsoleLoopCycles(who), true, role);
    assert.deepEqual(restrictConsoleLoopCycles({ actor: who, cycles: ALL, grants: [] }), [], `${role} without grant`);
    const viewOnly = [grant(who.ok ? who.userId : '', CONN_A, 'VIEW'), grant(who.ok ? who.userId : '', CONN_B, 'VIEW')];
    assert.deepEqual(restrictConsoleLoopCycles({ actor: who, cycles: ALL, grants: viewOnly }), [], `${role} with VIEW`);
    const reviewA = [grant(who.ok ? who.userId : '', CONN_A, 'REVIEW')];
    assert.deepEqual(ids(restrictConsoleLoopCycles({ actor: who, cycles: ALL, grants: reviewA })), ['cycle-a'], `${role} with REVIEW on A`);
  }
});

test('a permitted cycle keeps its existing values and drops relation fields', () => {
  const reviewer = actor('REVIEWER');
  const shown = restrictConsoleLoopCycles({ actor: reviewer, cycles: [cycleA], grants: [grant('trackb-reviewer', CONN_A, 'REVIEW')] });
  assert.deepEqual(shown, [{
    id: 'cycle-a',
    status: 'ACTIVE',
    iteration: 2,
    verificationAttempts: 1,
    sameDecisionCount: 1,
    sameConflictCount: 0,
    blockedReason: null,
  }]);
  const json = JSON.stringify(shown);
  for (const token of ['rootReviewResult', 'currentReviewResult', 'tenantId', CONN_A]) {
    assert.equal(json.includes(token), false, token);
  }
});

test('mixed services return only the services the actor may review', () => {
  const reviewer = actor('REVIEWER');
  const onlyA = [grant('trackb-reviewer', CONN_A, 'REVIEW'), grant('trackb-reviewer', CONN_B, 'VIEW')];
  assert.deepEqual(ids(restrictConsoleLoopCycles({ actor: reviewer, cycles: ALL, grants: onlyA })), ['cycle-a']);
  const developer = actor('DEVELOPER');
  const onlyB = [grant('trackb-developer', CONN_B, 'AGENT')];
  assert.deepEqual(ids(restrictConsoleLoopCycles({ actor: developer, cycles: ALL, grants: onlyB })), ['cycle-b']);
  const owner = actor('OWNER');
  const both = [grant('trackb-owner', CONN_A, 'REVIEW'), grant('trackb-owner', CONN_B, 'IMPROVE')];
  assert.deepEqual(ids(restrictConsoleLoopCycles({ actor: owner, cycles: ALL, grants: both })), ['cycle-a', 'cycle-b']);
  const otherUser = [grant('trackb-someone-else', CONN_A, 'AGENT')];
  assert.deepEqual(restrictConsoleLoopCycles({ actor: owner, cycles: ALL, grants: otherUser }), []);
  const foreignGrant = [{ ...grant('trackb-owner', CONN_A, 'AGENT'), tenantId: FOREIGN }];
  assert.deepEqual(restrictConsoleLoopCycles({ actor: owner, cycles: ALL, grants: foreignGrant }), []);
});

test('cycles without one resolvable service of this tenant are never shown', () => {
  for (const row of [unlinked, missing, split, foreignReview, foreignCycle]) {
    assert.equal(consoleLoopCycleConnection(row, TENANT), null, row.id);
  }
  assert.deepEqual(consoleLoopCycleConnection(cycleA, TENANT), { id: CONN_A, tenantId: TENANT });
  const owner = actor('OWNER');
  const both = [grant('trackb-owner', CONN_A, 'AGENT'), grant('trackb-owner', CONN_B, 'AGENT')];
  const shown = ids(restrictConsoleLoopCycles({ actor: owner, cycles: ALL, grants: both }));
  assert.deepEqual(shown, ['cycle-a', 'cycle-b']);
});

test('tenant enabled, mode, and policy stay as before for every reader', () => {
  const policy = {
    maxIterations: 5,
    maxVerificationAttempts: 2,
    maxSameDecision: 3,
    maxSameConflict: 2,
    maxRuntimeMs: 1_800_000,
    maxCostUsd: 1,
  };
  const viewer = actor('VIEWER');
  assert.equal(planConsoleLoopRead(viewer).ok, true);
  const screen = projectConsoleLoop({
    activation: { enabled: true, mode: 'FULL_AUTO' },
    policy,
    cycles: restrictConsoleLoopCycles({ actor: viewer, cycles: ALL, grants: [] }),
  });
  assert.equal(screen.enabled, true);
  assert.equal(screen.mode, 'FULL_AUTO');
  assert.deepEqual(screen.policy, policy);
  assert.deepEqual(screen.cycles, []);
  assert.equal(screen.stopReason, null);
  const off = projectConsoleLoop({ activation: null, policy: null, cycles: restrictConsoleLoopCycles({ actor: viewer, cycles: ALL, grants: [] }) });
  assert.equal(off.stopReason, 'AUTO_LOOP_DISABLED');
});

test('stopReason comes only from the cycles that remain', () => {
  const reviewer = actor('REVIEWER');
  const onlyA = restrictConsoleLoopCycles({ actor: reviewer, cycles: ALL, grants: [grant('trackb-reviewer', CONN_A, 'REVIEW')] });
  const hidden = projectConsoleLoop({ activation: { enabled: true, mode: 'FULL_AUTO' }, policy: null, cycles: onlyA });
  assert.equal(hidden.stopReason, null);
  assert.equal(JSON.stringify(hidden).includes('MAX_RUNTIME'), false);
  const taskOnly = projectConsoleLoop({ activation: { enabled: true, mode: 'TASK_ONLY' }, policy: null, cycles: onlyA });
  assert.equal(taskOnly.stopReason, 'TASK_ONLY');
  const withB = restrictConsoleLoopCycles({ actor: reviewer, cycles: ALL, grants: [grant('trackb-reviewer', CONN_B, 'REVIEW')] });
  const shown = projectConsoleLoop({ activation: { enabled: true, mode: 'FULL_AUTO' }, policy: null, cycles: withB });
  assert.equal(shown.stopReason, 'MAX_RUNTIME');
});

test('the store gates the cycle query on review.start and filters before projecting', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/console-loop-operations-store.ts'), 'utf8');
  const read = source.slice(source.indexOf('export async function readConsoleLoopOperations'), source.indexOf('export async function persistConsoleLoopStop'));
  assert.equal(read.includes('canReadConsoleLoopCycles(actor)'), true);
  assert.equal(read.indexOf('readCycles\r\n      ? prisma.juryDecisionCycle.findMany') >= 0 || read.indexOf('readCycles\n      ? prisma.juryDecisionCycle.findMany') >= 0, true);
  assert.equal(read.includes('listUserServiceGrants(plan.tenantId, userId)'), true);
  assert.equal(read.includes('cycles: restrictConsoleLoopCycles({ actor, cycles, grants })'), true);
  assert.equal(read.includes('clientTenantId'), false);
  const stop = source.slice(source.indexOf('export async function persistConsoleLoopStop'));
  assert.equal(stop.includes('restrictConsoleLoopCycles'), false);
  assert.equal(stop.includes('planConsoleLoopStop(input)'), true);
});
