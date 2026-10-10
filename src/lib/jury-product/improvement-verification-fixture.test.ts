/**
 * One isolated verification cycle through the existing modules.
 * Run: node --import tsx --test src/lib/jury-product/improvement-verification-fixture.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { JuryMembership } from './records';
import { openFixture, runConnected, view } from './improvement-verification-fixture';

const liveReview = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const liveCycle = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const auditor: JuryMembership = {
  id: 'mem-phase32-auditor',
  tenantId: 'tenant-phase32',
  userId: 'user-auditor',
  role: 'VIEWER',
  createdAt: '2026-10-02T00:00:00.000Z',
};
const foreign: JuryMembership = {
  id: 'mem-phase32-foreign',
  tenantId: 'tenant-other',
  userId: 'user-other',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

describe('verification loop fixture', () => {
  it('stops on an inconclusive verification before re-review', async () => {
    const box = await openFixture('inconclusive');
    const first = view(box, await runConnected(box));
    assert.equal(first.outcome.stop, 'VERIFICATION_STOPPED');
    assert.equal(first.verificationResults.length, 1);
    assert.equal(first.verificationResults[0]?.status, 'INCONCLUSIVE');
    assert.equal(first.verificationResults[0]?.finding.includes('어느 데이터 소스'), true);
    assert.equal(first.reviews.length, 0);
    assert.equal(first.requests.length, 0);
    assert.equal(first.results.length, 0);
    assert.equal(first.tasks.length, 1);
    assert.equal(first.coreCalls, 0);
    assert.equal(first.agentCalls, 0);
    assert.equal(first.gateCalls, 0);
    assert.equal(first.cycleStatus, 'ACTIVE');
    const second = view(box, await runConnected(box));
    assert.equal(second.verificationResults.length, 1);
    assert.equal(second.reviews.length, 0);
    assert.equal(second.coreCalls, 0);
    assert.equal(second.cycleStatus, 'ACTIVE');
  });

  it('closes one VERIFY cycle at ACCEPT through verification, re-review, and decision', async () => {
    const box = await openFixture('accept');
    const first = view(box, await runConnected(box));
    assert.equal(first.outcome.stop, 'ACCEPT');
    assert.equal(first.outcome.ok, true);
    assert.equal(first.tasks.length, 1);
    assert.equal(first.tasks[0]?.status, 'COMPLETED');
    assert.equal(first.tasks[0]?.taskType, 'VERIFICATION');
    assert.equal(first.verificationResults.length, 1);
    assert.equal(first.verificationResults[0]?.status, 'RESOLVED');
    assert.equal(first.reviews.length, 1);
    assert.equal(first.reviews[0]?.status, 'EXECUTED');
    assert.equal(first.requests.length, 1);
    assert.equal(first.results.length, 1);
    assert.equal(first.results[0]?.expectedDecision, 'ACCEPT');
    assert.equal(first.childDecision, 'ACCEPT');
    assert.equal(first.cycleStatus, 'COMPLETED');
    assert.equal(first.coreCalls, 1);
    assert.equal(first.outcome.coreRuns, 1);
    assert.equal(first.outcome.rereviewRuns, 1);
    assert.equal(first.agentCalls, 0);
    assert.equal(first.gateCalls, 0);
    assert.equal(first.outcome.agentRuns, 0);
    assert.equal(first.outcome.gateRuns, 0);
    assert.equal(first.cycleId === liveCycle, false);
    assert.equal(first.results[0]?.id === liveReview, false);
    assert.equal(first.protected.updatedAt, '2026-10-01T16:33:57.676Z');

    const second = view(box, await runConnected(box));
    assert.equal(second.outcome.stop, 'ACCEPT');
    assert.equal(second.verificationResults.length, 1);
    assert.equal(second.reviews.length, 1);
    assert.equal(second.requests.length, 1);
    assert.equal(second.results.length, 1);
    assert.equal(second.coreCalls, 1);
    assert.equal(second.cycleId, first.cycleId);
    assert.equal(second.cycleStatus, 'COMPLETED');
  });

  it('keeps one of each row when two verification loops share the fixture', async () => {
    const box = await openFixture('accept');
    const [left, right] = await Promise.all([runConnected(box), runConnected(box)]);
    const done = view(box, left.stop === 'ACCEPT' ? left : right);
    assert.equal(done.tasks.length, 1);
    assert.equal(done.verificationResults.length, 1);
    assert.equal(done.reviews.length, 1);
    assert.equal(done.requests.length, 1);
    assert.equal(done.results.length, 1);
    assert.equal(done.coreCalls, 1);
    assert.equal(done.cycleStatus, 'COMPLETED');
    assert.equal(left.stop === 'ACCEPT' || right.stop === 'ACCEPT', true);
  });

  it('stops when verification resolution fails and does not re-review', async () => {
    const box = await openFixture('resolution-fail');
    const done = view(box, await runConnected(box));
    assert.equal(done.outcome.stop, 'VERIFICATION_STOPPED');
    assert.equal(done.verificationResults.length, 0);
    assert.equal(done.reviews.length, 0);
    assert.equal(done.results.length, 0);
    assert.equal(done.coreCalls, 0);
  });

  it('stops when re-review is not approved and creates no review result', async () => {
    const box = await openFixture('rereview-refused');
    const done = view(box, await runConnected(box));
    assert.equal(done.outcome.stop, 'VERIFICATION_STOPPED');
    assert.equal(done.verificationResults.length, 1);
    assert.equal(done.results.length, 0);
    assert.equal(done.requests.length, 0);
    assert.equal(done.coreCalls, 0);
    assert.equal(done.cycleStatus, 'ACTIVE');
    assert.equal(done.tasks.length, 1);
  });

  it('blocks re-review when the existing loop guard is exceeded after resolution', async () => {
    const box = await openFixture('guard');
    const done = view(box, await runConnected(box));
    assert.equal(done.outcome.stop, 'LOOP_GUARD_BLOCKED');
    assert.equal(done.verificationResults.length, 1);
    assert.equal(done.reviews.length, 0);
    assert.equal(done.results.length, 0);
    assert.equal(done.coreCalls, 0);
    assert.equal(done.tasks.length, 1);
    assert.equal(done.cycleStatus, 'BLOCKED');
    assert.equal(done.blockedReason, 'MAX_VERIFICATION_ATTEMPTS');
  });

  it('refuses another tenant, an auditor, and a credential before writing a verification', async () => {
    const tenantBox = await openFixture('accept');
    const tenant = view(tenantBox, await runConnected(tenantBox, foreign));
    assert.equal(tenant.outcome.stop, 'TENANT_MISMATCH');
    assert.equal(tenant.verificationResults.length, 0);
    assert.equal(tenant.reviews.length, 0);

    const auditorBox = await openFixture('accept');
    const denied = view(auditorBox, await runConnected(auditorBox, auditor));
    assert.equal(denied.outcome.stop, 'FORBIDDEN');
    assert.equal(denied.verificationResults.length, 0);
    assert.equal(denied.reviews.length, 0);

    const secretBox = await openFixture('secret');
    const secret = view(secretBox, await runConnected(secretBox));
    assert.equal(secret.outcome.stop, 'CREDENTIAL_IN_REASON');
    assert.equal(secret.tasks.length, 0);
    assert.equal(secret.verificationResults.length, 0);
    assert.equal(secret.reviews.length, 0);
    assert.equal(secret.coreCalls, 0);
  });

  it('does not call a process, the frozen pipeline, an agent, or the live review', () => {
    const source = readFileSync(new URL('./improvement-verification-fixture.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('child_process'), false);
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('executeImprovementTask'), false);
    assert.equal(source.includes('runChangeGateForExecution'), false);
    assert.equal(source.includes(liveReview), false);
    assert.equal(source.includes('resolveVerification'), true);
    assert.equal(source.includes('executeVerificationReReview'), true);
    assert.equal(source.includes('reenterReReviewDecision'), true);
    assert.equal(source.includes('evaluateLoopGuard'), true);
    assert.equal(source.split('runImprovementAutoLoop(').length, 2);
  });
});
