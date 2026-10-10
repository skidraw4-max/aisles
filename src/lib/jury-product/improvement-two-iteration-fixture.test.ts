/**
 * Two existing loop steps in one isolated cycle.
 * Run: node --import tsx --test src/lib/jury-product/improvement-two-iteration-fixture.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { JuryMembership } from './records';
import { openTwoIteration, removeTwoIterationFile, runTwoIteration, viewTwoIteration } from './improvement-two-iteration-fixture';

const liveReview = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const liveCycle = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const auditor: JuryMembership = {
  id: 'mem-phase33-auditor',
  tenantId: 'tenant-phase33',
  userId: 'user-auditor',
  role: 'VIEWER',
  createdAt: '2026-10-02T00:00:00.000Z',
};
const foreign: JuryMembership = {
  id: 'mem-phase33-foreign',
  tenantId: 'tenant-other',
  userId: 'user-other',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

describe('two iteration loop fixture', () => {
  it('walks REWORD into VERIFY and then ACCEPT', async () => {
    const box = await openTwoIteration('accept');
    try {
      const first = viewTwoIteration(box, await runTwoIteration(box));
      assert.equal(first.outcome.stop, 'ACCEPT');
      assert.equal(first.outcome.ok, true);
      assert.equal(first.cycleStatus, 'COMPLETED');
      assert.equal(first.improvements.length, 1);
      assert.equal(first.improvements[0]?.status, 'OPEN');
      assert.equal(first.executions.length, 1);
      assert.equal(first.executions[0]?.status, 'COMPLETED');
      assert.equal(first.agentCalls, 1);
      assert.equal(first.gates.length, 1);
      assert.equal(first.gates[0]?.status, 'APPROVED');
      assert.equal((first.gates[0]?.changedFiles.length ?? 0) >= 1, true);
      assert.equal(first.gates[0]?.discrepancy, false);
      assert.equal(first.gates[0]?.credentialDetected, false);
      assert.equal(first.gates[0]?.riskLevel === 'LOW' || first.gates[0]?.riskLevel === 'MEDIUM', true);
      assert.equal(first.gates[0]?.testsPassed, true);
      assert.equal(first.changeGateReviews.length, 1);
      assert.equal(first.changeGateReviews[0]?.status, 'EXECUTED');
      assert.equal(first.verifyResults.length, 1);
      assert.equal(first.verifyResults[0]?.expectedDecision, 'VERIFY');
      assert.equal(first.tasks.filter((task) => task.taskType === 'REWORD').length, 1);
      assert.equal(first.verificationTasks.length, 1);
      assert.equal(first.verificationResults.length, 1);
      assert.equal(first.verificationResults[0]?.status, 'RESOLVED');
      assert.equal(first.verificationReviews.length, 1);
      assert.equal(first.verificationReviews[0]?.status, 'EXECUTED');
      assert.equal(first.verificationRequests.length, 1);
      assert.equal(first.acceptResults.length, 1);
      assert.equal(first.acceptResults[0]?.expectedDecision, 'ACCEPT');
      assert.equal(first.childDecision, 'ACCEPT');
      assert.equal(first.coreCalls, 2);
      assert.equal(first.outcome.agentRuns, 1);
      assert.equal(first.outcome.gateRuns, 1);
      assert.equal(first.outcome.rereviewRuns, 2);
      assert.equal(first.outcome.coreRuns, 2);
      assert.equal(first.cycleId === liveCycle, false);
      assert.equal(first.acceptResults[0]?.id === liveReview, false);
      assert.equal(first.protected.updatedAt, '2026-10-01T16:33:57.676Z');

      const second = viewTwoIteration(box, await runTwoIteration(box));
      assert.equal(second.outcome.stop === 'ACCEPT' || second.outcome.stop === 'COMPLETED', true);
      assert.equal(second.cycleId, first.cycleId);
      assert.equal(second.cycleStatus, 'COMPLETED');
      assert.equal(second.executions.length, 1);
      assert.equal(second.gates.length, 1);
      assert.equal(second.changeGateReviews.length, 1);
      assert.equal(second.verifyResults.length, 1);
      assert.equal(second.verificationTasks.length, 1);
      assert.equal(second.verificationResults.length, 1);
      assert.equal(second.verificationReviews.length, 1);
      assert.equal(second.acceptResults.length, 1);
      assert.equal(second.coreCalls, 2);
    } finally {
      await removeTwoIterationFile();
    }
  });

  it('keeps one of each row when two loops share the fixture', async () => {
    const box = await openTwoIteration('accept');
    try {
      const [left, right] = await Promise.all([runTwoIteration(box), runTwoIteration(box)]);
      const done = viewTwoIteration(box, left.stop === 'ACCEPT' ? left : right);
      assert.equal(done.improvements.length, 1);
      assert.equal(done.executions.length, 1);
      assert.equal(done.gates.length, 1);
      assert.equal(done.changeGateReviews.length, 1);
      assert.equal(done.verifyResults.length, 1);
      assert.equal(done.verificationTasks.length, 1);
      assert.equal(done.verificationResults.length, 1);
      assert.equal(done.verificationReviews.length, 1);
      assert.equal(done.acceptResults.length, 1);
      assert.equal(done.coreCalls, 2);
      assert.equal(done.cycleStatus, 'COMPLETED');
      assert.equal(left.stop === 'ACCEPT' || right.stop === 'ACCEPT', true);
    } finally {
      await removeTwoIterationFile();
    }
  });

  it('stops a failed agent before the gate and the second iteration', async () => {
    const box = await openTwoIteration('agent-fail');
    const outcome = viewTwoIteration(box, await runTwoIteration(box));
    assert.equal(outcome.outcome.stop, 'AGENT_FAILED');
    assert.equal(outcome.executions.length, 1);
    assert.equal(outcome.executions[0]?.status, 'BLOCKED');
    assert.equal(outcome.gates.length, 0);
    assert.equal(outcome.changeGateReviews.length, 0);
    assert.equal(outcome.verifyResults.length, 0);
    assert.equal(outcome.verificationTasks.length, 0);
    assert.equal(outcome.coreCalls, 0);
  });

  it('stops a gated change before re-review', async () => {
    const box = await openTwoIteration('gated');
    try {
      const done = viewTwoIteration(box, await runTwoIteration(box));
      assert.equal(done.outcome.stop, 'CHANGE_GATE_GATED');
      assert.equal(done.gates.length, 1);
      assert.equal(done.gates[0]?.status, 'GATED');
      assert.equal(done.changeGateReviews.length, 0);
      assert.equal(done.verificationTasks.length, 0);
      assert.equal(done.coreCalls, 0);
    } finally {
      await removeTwoIterationFile();
    }
  });

  it('stops when the change-gate re-review is not approved', async () => {
    const box = await openTwoIteration('rereview-refused');
    try {
      const done = viewTwoIteration(box, await runTwoIteration(box));
      assert.equal(done.outcome.stop, 'RE-REVIEW_NOT_APPROVED');
      assert.equal(done.verifyResults.length, 0);
      assert.equal(done.verificationTasks.length, 0);
      assert.equal(done.coreCalls, 0);
    } finally {
      await removeTwoIterationFile();
    }
  });

  it('stops an inconclusive verification before its re-review', async () => {
    const box = await openTwoIteration('inconclusive');
    try {
      const done = viewTwoIteration(box, await runTwoIteration(box));
      assert.equal(done.outcome.stop, 'VERIFICATION_STOPPED');
      assert.equal(done.verifyResults[0]?.expectedDecision, 'VERIFY');
      assert.equal(done.verificationResults.length, 1);
      assert.equal(done.verificationResults[0]?.status, 'INCONCLUSIVE');
      assert.equal(done.verificationReviews.length, 0);
      assert.equal(done.acceptResults.length, 0);
      assert.equal(done.cycleStatus, 'ACTIVE');
      assert.equal(done.coreCalls, 1);
    } finally {
      await removeTwoIterationFile();
    }
  });

  it('blocks the verification re-review when verification attempts reach the guard', async () => {
    const box = await openTwoIteration('verification-guard');
    try {
      const done = viewTwoIteration(box, await runTwoIteration(box));
      assert.equal(done.outcome.stop, 'LOOP_GUARD_BLOCKED');
      assert.equal(done.verificationResults.length, 1);
      assert.equal(done.verificationReviews.length, 0);
      assert.equal(done.acceptResults.length, 0);
      assert.equal(done.coreCalls, 1);
      assert.equal(done.cycleStatus, 'BLOCKED');
      assert.equal(done.blockedReason, 'MAX_VERIFICATION_ATTEMPTS');
    } finally {
      await removeTwoIterationFile();
    }
  });

  it('blocks the next iteration when maxIterations is 2', async () => {
    const box = await openTwoIteration('max-iterations');
    try {
      const done = viewTwoIteration(box, await runTwoIteration(box));
      assert.equal(done.outcome.stop, 'LOOP_GUARD_BLOCKED');
      assert.equal(done.blockedReason, 'MAX_ITERATIONS');
      assert.equal(done.cycleStatus, 'BLOCKED');
      assert.equal(done.executions.length, 1);
      assert.equal(done.agentCalls, 1);
      assert.equal(done.verificationTasks.length, 0);
      assert.equal(done.verificationResults.length, 0);
      assert.equal(done.acceptResults.length, 0);
      assert.equal(done.coreCalls, 1);
    } finally {
      await removeTwoIterationFile();
    }
  });

  it('refuses an auditor, another tenant, and a credential before an execution', async () => {
    const auditorBox = await openTwoIteration('accept');
    const denied = viewTwoIteration(auditorBox, await runTwoIteration(auditorBox, auditor));
    assert.equal(denied.outcome.stop, 'FORBIDDEN');
    assert.equal(denied.executions.length, 0);
    assert.equal(denied.coreCalls, 0);

    const tenantBox = await openTwoIteration('accept');
    const tenant = viewTwoIteration(tenantBox, await runTwoIteration(tenantBox, foreign));
    assert.equal(tenant.outcome.stop, 'TENANT_MISMATCH');
    assert.equal(tenant.executions.length, 0);

    const secretBox = await openTwoIteration('secret');
    const leaked = viewTwoIteration(secretBox, await runTwoIteration(secretBox));
    assert.equal(leaked.outcome.stop, 'CREDENTIAL_IN_REASON');
    assert.equal(leaked.tasks.length, 0);
    assert.equal(leaked.executions.length, 0);
    assert.equal(leaked.coreCalls, 0);
  });

  it('does not call a process, the frozen pipeline, or the live review', () => {
    const source = readFileSync(new URL('./improvement-two-iteration-fixture.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('child_process'), false);
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes(liveReview), false);
    assert.equal(source.includes('executeImprovementTask'), true);
    assert.equal(source.includes('runChangeGateForExecution'), true);
    assert.equal(source.includes('runApprovedGateReReview'), true);
    assert.equal(source.includes('resolveVerification'), true);
    assert.equal(source.includes('executeVerificationReReview'), true);
    assert.equal(source.includes('reenterReReviewDecision'), true);
    assert.equal(source.includes('evaluateLoopGuard'), true);
    assert.equal(source.split('runImprovementAutoLoop(').length, 2);
  });
});
