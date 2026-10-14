/**
 * Scope check stops an out-of-range change before the change gate.
 * It does not write, audit, or call a live review.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runImprovementAutoLoop } from './improvement-auto-loop';
import { evaluateImprovementChangeScope, type ImprovementScopeInput, type ImprovementScopeResult } from './improvement-scope-check';
import { PRODUCT_LOOP_GUARD_DEFAULTS } from './loop-guard';
import type { JuryMembership } from './records';

const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

function task(changedFiles: string[], patch: Partial<ImprovementScopeInput> = {}): ImprovementScopeInput {
  return {
    actorTenantId: 'tenant-a',
    taskTenantId: 'tenant-a',
    executionTenantId: 'tenant-a',
    workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    allowedPaths: [],
    objective: `${COPY} 만 수정한다.`,
    constraints: ['측정된 문구만 다듬는다.'],
    provenance: { sourceDecision: 'REWORD', workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' } },
    changedFiles,
    ...patch,
  };
}

test('scope allows only the file the task named', () => {
  const safe = evaluateImprovementChangeScope(task([COPY]));
  assert.deepEqual(safe, { status: 'SAFE', code: 'SAFE', reason: 'WITHIN_TASK_SCOPE' });
  assert.deepEqual(evaluateImprovementChangeScope(task([COPY])), safe);
  const extra = evaluateImprovementChangeScope(task([COPY, 'prisma/schema.prisma']));
  assert.equal(extra.status, 'BLOCKED');
  assert.equal(extra.code, 'FORBIDDEN_SCHEMA');
  assert.equal(JSON.stringify(extra).includes('postgres://'), false);
});

test('scope blocks sensitive files, empty changes, traversal, and another tenant', () => {
  for (const file of ['.env', '.env.local', 'credentials.json', 'auth.config.ts', 'security.yaml', 'vercel.json', 'Dockerfile']) {
    const result = evaluateImprovementChangeScope(task([file]));
    assert.equal(result.status, 'BLOCKED', file);
    assert.notEqual(result.code, 'SAFE', file);
  }
  for (const file of ['../outside.txt', '/absolute/path.txt', 'workspace/../outside.txt', 'workspace/mock-aisle/../../outside.txt']) {
    assert.equal(evaluateImprovementChangeScope(task([file])).code, 'PATH_ESCAPE', file);
  }
  assert.equal(evaluateImprovementChangeScope(task([])).code, 'NO_CHANGES');
  assert.equal(evaluateImprovementChangeScope(task([COPY], { executionTenantId: 'tenant-b' })).code, 'TENANT_MISMATCH');
  assert.equal(evaluateImprovementChangeScope(task(['prisma/schema.prisma'], { linkEscape: true })).code, 'PATH_ESCAPE');
  const named = evaluateImprovementChangeScope(task(['prisma/schema.prisma'], { objective: 'prisma/schema.prisma 만 검토한다.', constraints: [] }));
  assert.equal(named.status, 'SAFE');
});

test('full auto reaches the change gate only when the scope is safe', async () => {
  const safe = await once([COPY], 'GATED');
  assert.equal(safe.outcome.stop, 'CHANGE_GATE_GATED');
  assert.equal(safe.agents, 1);
  assert.equal(safe.gates, 1);
  assert.equal(safe.rereviews, 0);
  assert.equal(safe.cores, 0);

  for (const files of [[COPY, 'prisma/schema.prisma'], ['.env'], ['credentials.json'], ['prisma/schema.prisma'], ['auth.config.ts'], ['vercel.json'], [], ['../outside.txt'], ['/absolute/path.txt'], ['workspace/../outside.txt'], ['workspace/mock-aisle/../../outside.txt']]) {
    const blocked = await once(files, 'APPROVED');
    assert.equal(blocked.outcome.stop, 'SCOPE_BLOCKED', files.join(','));
    assert.equal(blocked.agents, 1, files.join(','));
    assert.equal(blocked.gates, 0, files.join(','));
    assert.equal(blocked.rereviews, 0);
    assert.equal(blocked.cores, 0);
    assert.equal(JSON.stringify(blocked.outcome).includes('postgres://'), false);
  }

  const foreign = await once([COPY], 'GATED', { executionTenantId: 'tenant-b' });
  assert.equal(foreign.outcome.stop, 'TENANT_MISMATCH');
  assert.equal(foreign.gates, 0);

  const first = harness([COPY], 'APPROVED');
  const completed = await runImprovementAutoLoop(command(), first.io);
  assert.equal(completed.stop, 'ACCEPT');
  assert.equal(first.agents, 1);
  const again = await runImprovementAutoLoop(command(), first.io);
  assert.equal(again.stop, 'ALREADY_COMPLETED');
  assert.equal(first.agents, 1);
  assert.equal(first.scopes, 1);

  const shared = harness([COPY], 'GATED');
  const [left, right] = await Promise.all([runImprovementAutoLoop(command(), shared.io), runImprovementAutoLoop(command(), shared.io)]);
  assert.equal(left.stop, 'CHANGE_GATE_GATED');
  assert.equal(right.stop, 'CHANGE_GATE_GATED');
  assert.deepEqual(shared.checks[0], shared.checks[1]);
  assert.equal(shared.agents, 1);
  assert.equal(shared.gates, 1);
  assert.equal(shared.rereviews, 0);
});

function command() {
  return {
    userId: owner.userId,
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T07:00:00.000Z',
    rootReviewResultId: 'root-1',
  };
}

async function once(files: string[], gateStatus: string, patch: Partial<ImprovementScopeInput> = {}) {
  const box = harness(files, gateStatus, patch);
  const outcome = await runImprovementAutoLoop(command(), box.io);
  return { outcome, agents: box.agents, gates: box.gates, rereviews: box.rereviews, cores: box.cores };
}

function harness(files: string[], gateStatus: string, patch: Partial<ImprovementScopeInput> = {}) {
  const box = { agents: 0, gates: 0, rereviews: 0, cores: 0, scopes: 0, checks: [] as ImprovementScopeResult[], done: false };
  let execution: string | null = null;
  let gate: string | null = null;
  const input = task(files, patch);
  const io = {
    async iteration(step: { reviewResultId: string }) {
      if (step.reviewResultId !== 'root-1') {
        return {
          ok: true as const,
          decision: 'ACCEPT' as const,
          nextAction: 'NONE' as const,
          cycleStatus: 'COMPLETED',
          guard: 'ALLOWED',
          verificationTaskId: null,
          decisionTaskId: null,
          improvementTaskId: null,
          cycleId: 'cycle-1',
        };
      }
      return {
        ok: true as const,
        decision: 'REWORD' as const,
        nextAction: 'IMPROVEMENT' as const,
        cycleStatus: 'ACTIVE',
        guard: 'ALLOWED',
        verificationTaskId: null,
        decisionTaskId: 'decision-1',
        improvementTaskId: 'improvement-1',
        cycleId: 'cycle-1',
      };
    },
    async policy() {
      return PRODUCT_LOOP_GUARD_DEFAULTS;
    },
    async counters() {
      return { iteration: 1, verificationAttempts: 0, sameDecisionCount: 1, sameConflictCount: 0, runtimeMs: null, costUsd: null };
    },
    async alreadyDone() {
      return box.done;
    },
    async markDone() {
      box.done = true;
    },
    async preflight() {
      return { status: 'SAFE' as const, code: 'SAFE' as const };
    },
    async agent() {
      if (execution) return { ok: true as const, executionId: execution, status: 'COMPLETED' };
      execution = 'exec-1';
      box.agents += 1;
      return { ok: true as const, executionId: execution, status: 'COMPLETED' };
    },
    async scope() {
      box.scopes += 1;
      const result = evaluateImprovementChangeScope(input);
      box.checks.push(result);
      return result;
    },
    async gate() {
      if (!gate) {
        gate = 'gate-1';
        box.gates += 1;
      }
      return { ok: true as const, id: gate, status: gateStatus };
    },
    async rereview() {
      box.rereviews += 1;
      box.cores += 1;
      return { ok: true as const, reviewResultId: 'review-2', coreRuns: 1 };
    },
    async verification() {
      return { ok: false as const, reason: 'VERIFICATION_STOPPED', status: 'INCONCLUSIVE' };
    },
    async verificationReview() {
      return { ok: false as const, reason: 'VERIFICATION_STOPPED' };
    },
  };
  return {
    get agents() {
      return box.agents;
    },
    get gates() {
      return box.gates;
    },
    get rereviews() {
      return box.rereviews;
    },
    get cores() {
      return box.cores;
    },
    get scopes() {
      return box.scopes;
    },
    get checks() {
      return box.checks;
    },
    io,
  };
}
