/**
 * One isolated improvement cycle through the existing modules.
 * Run: node --import tsx --test src/lib/jury-product/improvement-loop-fixture.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { openFixture, removeFixtureFile, runConnected, view } from './improvement-loop-fixture';

const liveReview = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const liveCycle = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

describe('improvement loop fixture', () => {
  it('closes one REWORD cycle at ACCEPT through the existing modules', async () => {
    const box = await openFixture('accept');
    try {
      const first = view(box, await runConnected(box));
      assert.equal(first.outcome.stop, 'ACCEPT');
      assert.equal(first.outcome.ok, true);
      assert.equal(first.executions.length, 1);
      assert.equal(first.executions[0]?.status, 'COMPLETED');
      assert.equal(first.adapterCalls, 1);
      assert.equal(first.gates.length, 1);
      assert.equal(first.gates[0]?.status, 'APPROVED');
      assert.equal(first.gates[0]?.changedFiles.length >= 1, true);
      assert.equal(first.gates[0]?.discrepancy, false);
      assert.equal(first.gates[0]?.credentialDetected, false);
      assert.equal(first.gates[0]?.riskLevel === 'LOW' || first.gates[0]?.riskLevel === 'MEDIUM', true);
      assert.equal(first.gates[0]?.testsPassed, true);
      assert.equal(first.reviews.length, 1);
      assert.equal(first.reviews[0]?.status, 'EXECUTED');
      assert.equal(first.requests.length, 1);
      assert.equal(first.results.length, 1);
      assert.equal(first.results[0]?.expectedDecision, 'ACCEPT');
      assert.equal(first.childDecision, 'ACCEPT');
      assert.equal(first.cycleStatus, 'COMPLETED');
      assert.equal(first.tasks.length, 1);
      assert.equal(first.tasks.some((task) => task.reviewResultId === first.results[0]?.id), false);
      assert.equal(first.improvements.length, 1);
      assert.equal(first.improvements[0]?.status, 'OPEN');
      assert.equal(first.coreCalls, 1);
      assert.equal(first.outcome.agentRuns, 1);
      assert.equal(first.outcome.gateRuns, 1);
      assert.equal(first.outcome.rereviewRuns, 1);
      assert.equal(first.outcome.coreRuns, 1);
      assert.equal(first.cycleId === liveCycle, false);
      assert.equal(first.results[0]?.id === liveReview, false);

      const second = view(box, await runConnected(box));
      assert.equal(second.outcome.stop, 'ACCEPT');
      assert.equal(second.executions.length, 1);
      assert.equal(second.gates.length, 1);
      assert.equal(second.reviews.length, 1);
      assert.equal(second.results.length, 1);
      assert.equal(second.coreCalls, 1);
      assert.equal(second.adapterCalls, 1);
      assert.equal(second.cycleStatus, 'COMPLETED');
      assert.equal(second.cycleId, first.cycleId);
    } finally {
      await removeFixtureFile();
    }
  });

  it('keeps one of each row when two loops share the fixture', async () => {
    const box = await openFixture('accept');
    try {
      const [left, right] = await Promise.all([runConnected(box), runConnected(box)]);
      const done = view(box, left.ok ? left : right);
      assert.equal(done.executions.length, 1);
      assert.equal(done.gates.length, 1);
      assert.equal(done.reviews.length, 1);
      assert.equal(done.requests.length, 1);
      assert.equal(done.results.length, 1);
      assert.equal(done.improvements.length, 1);
      assert.equal(done.coreCalls, 1);
      assert.equal(done.adapterCalls, 1);
      assert.equal(done.cycleStatus, 'COMPLETED');
      assert.equal(left.stop === 'ACCEPT' || right.stop === 'ACCEPT', true);
    } finally {
      await removeFixtureFile();
    }
  });

  it('stops when the agent fails and does not open a gate', async () => {
    const box = await openFixture('agent-fail');
    const done = view(box, await runConnected(box));
    assert.equal(done.outcome.stop, 'AGENT_FAILED');
    assert.equal(done.executions.length, 1);
    assert.equal(done.executions[0]?.status, 'BLOCKED');
    assert.equal(done.gates.length, 0);
    assert.equal(done.reviews.length, 0);
    assert.equal(done.results.length, 0);
    assert.equal(done.coreCalls, 0);
  });

  it('stops on a gated change and does not re-review', async () => {
    const box = await openFixture('gated');
    try {
      const done = view(box, await runConnected(box));
      assert.equal(done.outcome.stop, 'CHANGE_GATE_GATED');
      assert.equal(done.gates.length, 1);
      assert.equal(done.gates[0]?.status, 'GATED');
      assert.equal(done.reviews.length, 0);
      assert.equal(done.results.length, 0);
      assert.equal(done.coreCalls, 0);
    } finally {
      await removeFixtureFile();
    }
  });

  it('stops on a blocked change and does not re-review', async () => {
    const box = await openFixture('blocked');
    try {
      const done = view(box, await runConnected(box));
      assert.equal(done.outcome.stop, 'CHANGE_GATE_BLOCKED');
      assert.equal(done.gates.length, 1);
      assert.equal(done.gates[0]?.status, 'BLOCKED');
      assert.equal(done.reviews.length, 0);
      assert.equal(done.coreCalls, 0);
    } finally {
      await removeFixtureFile();
    }
  });

  it('stops when re-review is not approved and creates no next task', async () => {
    const box = await openFixture('rereview-refused');
    try {
      const before = box.tasks.length;
      const done = view(box, await runConnected(box));
      assert.equal(done.outcome.stop, 'RE-REVIEW_NOT_APPROVED');
      assert.equal(done.reviews.length, 0);
      assert.equal(done.results.length, 0);
      assert.equal(done.tasks.length, before);
      assert.equal(done.coreCalls, 0);
      assert.equal(done.cycleStatus, 'ACTIVE');
    } finally {
      await removeFixtureFile();
    }
  });

  it('does not call a process, the frozen pipeline, or the live review', () => {
    const source = readFileSync(new URL('./improvement-loop-fixture.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('child_process'), false);
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('inspectAllowlistedWorkspace'), false);
    assert.equal(source.includes('persistImprovementAutoLoop'), false);
    assert.equal(source.includes(liveReview), false);
    assert.equal(source.includes('executeImprovementTask'), true);
    assert.equal(source.includes('runChangeGateForExecution'), true);
    assert.equal(source.includes('runApprovedGateReReview'), true);
    assert.equal(source.includes('reenterReReviewDecision'), true);
    assert.equal(source.split('runImprovementAutoLoop(').length, 2);
  });
});
