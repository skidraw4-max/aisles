/**
 * Activation is a separate switch from loop-guard numbers and from review.start.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { autoLoopExecutionMode, autoLoopIsEnabled, canonicalAutoLoopMode, planAutoLoopActivation } from './auto-loop-activation';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-owner',
  tenantId: 'tenant-a',
  userId: 'user-owner',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};
const member: JuryMembership = { ...owner, id: 'mem-member', userId: 'user-member', role: 'MEMBER' };
const auditor: JuryMembership = { ...owner, id: 'mem-auditor', userId: 'user-auditor', role: 'AUDITOR' };

test('auto loop stays off until an activation row is on', () => {
  assert.equal(autoLoopIsEnabled(null, { maxIterations: 5 }), false);
  assert.equal(autoLoopIsEnabled({ enabled: false }, { maxIterations: 1 }), false);
  assert.equal(autoLoopIsEnabled({ enabled: true }), true);
});

test('a missing execution mode stays off even when activation is on', () => {
  assert.equal(canonicalAutoLoopMode(undefined), 'OFF');
  assert.equal(canonicalAutoLoopMode('DRY_RUN'), 'OFF');
  assert.equal(autoLoopExecutionMode(null), 'OFF');
  assert.equal(autoLoopExecutionMode({ enabled: true }), 'OFF');
  assert.equal(autoLoopExecutionMode({ enabled: true, mode: 'OFF' }), 'OFF');
  assert.equal(autoLoopExecutionMode({ enabled: false, mode: 'FULL_AUTO' }), 'OFF');
  assert.equal(autoLoopExecutionMode({ enabled: true, mode: 'TASK_ONLY' }), 'TASK_ONLY');
  assert.equal(autoLoopExecutionMode({ enabled: true, mode: 'FULL_AUTO' }), 'FULL_AUTO');
});

test('only the membership owner can plan an activation change', () => {
  const memberPlan = planAutoLoopActivation({ userId: member.userId, memberships: [member] });
  assert.equal(memberPlan.ok, false);
  if (!memberPlan.ok) assert.equal(memberPlan.reason, 'FORBIDDEN');
  const auditorPlan = planAutoLoopActivation({ userId: auditor.userId, memberships: [auditor] });
  assert.equal(auditorPlan.ok, false);
  if (!auditorPlan.ok) assert.equal(auditorPlan.reason, 'FORBIDDEN');
  const stranger = planAutoLoopActivation({ userId: 'stranger', memberships: [] });
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.reason, 'FORBIDDEN');
  const otherTenant = planAutoLoopActivation({ userId: owner.userId, memberships: [owner], clientTenantId: 'tenant-b' });
  assert.equal(otherTenant.ok, false);
  if (!otherTenant.ok) assert.equal(otherTenant.reason, 'TENANT_MISMATCH');
  const allowed = planAutoLoopActivation({
    userId: owner.userId,
    memberships: [owner],
    clientTenantId: 'forged-tenant',
  });
  assert.equal(allowed.ok, false);
  const sameTenant = planAutoLoopActivation({ userId: owner.userId, memberships: [owner], clientTenantId: 'tenant-a' });
  assert.equal(sameTenant.ok, true);
  if (sameTenant.ok) assert.equal(sameTenant.tenantId, 'tenant-a');
  const secret = planAutoLoopActivation({
    userId: owner.userId,
    memberships: [owner],
    note: 'postgres://hidden',
  });
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');
});
